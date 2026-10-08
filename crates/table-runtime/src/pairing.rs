//! Signed identity exchange with an owner-confirmed short authentication string.
use crate::{Action, ActorHandle, Caller};
use crate::{
    Runtime, app, invalid, permission, service::PendingPair, unavailable,
    vault::existing_signing_key,
};
use ed25519_dalek::{Signer, VerifyingKey};
use table_client::*;
use table_core::*;
use table_ledger::{Counterparty, PairedVia};
use table_proto::{PairingCode, ShortText, pairing_words};

fn main_caller() -> Caller {
    Caller {
        label: "main".into(),
        token: None,
    }
}
/// The authority table's label gate for the pairing commands that do IO outside the actor (none
/// of them takes a token); the actions they run inside the actor are gated again there.
fn check_pairing_caller(caller: &Caller, command: &str) -> Result<(), CommandError> {
    if !table_client::authority::admits(command, &caller.label) {
        return Err(permission());
    }
    Ok(())
}
fn refused(message: &str) -> CommandError {
    CommandError {
        code: ErrorCode::Refused,
        message: message.into(),
    }
}
/// The wallet's words for a HOUSE that did not seat us. Pairing moves no money, so each says so.
fn house_error(error: table_relay::Error) -> (Result<PairingWords, CommandError>, HouseState) {
    use table_relay::{Error, Refusal};
    match error {
        Error::Full => (
            Err(refused("The house is full right now. No money moved.")),
            HouseState::Ready,
        ),
        Error::Refused(Refusal::DailyLimit) => (
            Err(refused(
                "The house has hit its limit for today. No money moved.",
            )),
            HouseState::Ready,
        ),
        Error::Refused(Refusal::Other) => (
            Err(refused("The house turned this table down. No money moved.")),
            HouseState::Ready,
        ),
        Error::Unavailable | Error::Invalid => (
            Err(unavailable(
                "The house is waking or could not be reached. No money moved.",
            )),
            HouseState::Idle,
        ),
    }
}
struct HouseWake<'a> {
    actor: &'a ActorHandle,
    active: bool,
}
impl Drop for HouseWake<'_> {
    fn drop(&mut self) {
        if self.active {
            let (reply, _) = tokio::sync::oneshot::channel();
            let _ = self.actor.sender.try_send(crate::actor::Message::Execute(
                main_caller(),
                Box::new(Action::HouseStatus(HouseState::Idle)),
                reply,
            ));
        }
    }
}
impl ActorHandle {
    pub(crate) async fn relay_pairing_create(
        &self,
        caller: Caller,
        args: PairingCreateArgs,
    ) -> Result<PairingOffer, CommandError> {
        check_pairing_caller(&caller, "pairing_create")?;
        let _permit = self
            .pairing_jobs
            .try_acquire()
            .map_err(|_| unavailable("Too many pairing requests"))?;
        let offer: PairingOffer = self.execute_local(caller, Action::PairCreate(args)).await?;
        if let Some(api) = &self.relay {
            self.publish_pairing(api.as_ref(), &offer.bundle).await?;
        }
        Ok(offer)
    }
    pub(crate) async fn relay_pairing_join(
        &self,
        caller: Caller,
        mut args: PairingJoinArgs,
    ) -> Result<PairingWords, CommandError> {
        check_pairing_caller(&caller, "pairing_join")?;
        let _permit = self
            .pairing_jobs
            .try_acquire()
            .map_err(|_| unavailable("Too many pairing requests"))?;
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        if code.expose_for_pairing() == "HOUSE" {
            let _house_permit = self
                .house_jobs
                .try_acquire()
                .map_err(|_| unavailable("House pairing is already waking"))?;
            if args.side != Side::Buyer || args.peer.is_some() {
                return Err(invalid());
            }
            let api = self
                .relay
                .as_ref()
                .ok_or_else(|| unavailable("Relay is not configured"))?;
            let offer: PairingOffer = self
                .execute_local(
                    main_caller(),
                    Action::HouseOffer(PairingCreateArgs {
                        side: args.side,
                        payee: args.payee,
                    }),
                )
                .await?;
            self.execute_local::<()>(main_caller(), Action::HouseStatus(HouseState::Waking))
                .await?;
            let mut wake = HouseWake {
                actor: self,
                active: true,
            };
            let response = api
                .house_table(&table_proto::HouseRequest {
                    buyer: offer.bundle,
                })
                .await;
            // A house that answered, even with a no, is awake; one that did not is back to idle.
            // `Unavailable` stays reserved for a build with no house pinned.
            let (result, house) = match response {
                Ok(response) => (
                    self.execute_local(main_caller(), Action::HousePair(response))
                        .await,
                    HouseState::Ready,
                ),
                Err(e) => house_error(e),
            };
            self.execute_local::<()>(main_caller(), Action::HouseStatus(house))
                .await?;
            wake.active = false;
            return result;
        }
        if args.peer.is_none() {
            let api = self
                .relay
                .as_ref()
                .ok_or_else(|| unavailable("Relay is not configured"))?;
            args.peer = self
                .discover_pairing(api.as_ref(), &code, args.side, None)
                .await?;
            if args.peer.is_none() {
                return Err(unavailable("Pairing offer is not available yet"));
            }
        }
        let words: PairingWords = self.execute_local(caller, Action::PairJoin(args)).await?;
        if let Some(api) = &self.relay {
            self.publish_pairing(api.as_ref(), &words.reply).await?;
        }
        Ok(words)
    }
    /// Wakes the hosted HOUSE seller with a plain request to its co-hosted service, through the
    /// same house state the HOUSE pairing uses (idle -> waking -> ready). No money, no pairing,
    /// no signed data: it only shortens the cold start before "Sit down with the house".
    pub(crate) async fn house_wake(&self, caller: Caller) -> Result<HouseState, CommandError> {
        check_pairing_caller(&caller, "house_wake")?;
        let settings: SettingsSnapshot =
            self.execute_local(main_caller(), Action::Settings).await?;
        if settings.house == HouseState::Unavailable {
            return Err(unavailable(
                "HOUSE release identity is not pinned in this build",
            ));
        }
        let api = self
            .relay
            .as_ref()
            .ok_or_else(|| unavailable("Relay is not configured"))?;
        let _house_permit = self
            .house_jobs
            .try_acquire()
            .map_err(|_| unavailable("House is already waking"))?;
        self.execute_local::<()>(main_caller(), Action::HouseStatus(HouseState::Waking))
            .await?;
        let mut wake = HouseWake {
            actor: self,
            active: true,
        };
        if api.wake().await.is_err() {
            // The guard puts the house back to idle: a failed wake is retryable, not a fault.
            return Err(unavailable(
                "House is waking or temporarily unavailable; retry",
            ));
        }
        self.execute_local::<()>(main_caller(), Action::HouseStatus(HouseState::Ready))
            .await?;
        wake.active = false;
        Ok(HouseState::Ready)
    }
    pub(crate) async fn relay_pairing_poll(
        &self,
        caller: Caller,
        args: PairingPollArgs,
    ) -> Result<Option<PairingWords>, CommandError> {
        check_pairing_caller(&caller, "pairing_poll")?;
        let _permit = self
            .pairing_jobs
            .try_acquire()
            .map_err(|_| unavailable("Too many pairing requests"))?;
        let offer: PairingOffer = self.execute_local(caller, Action::PairOffer(args)).await?;
        let api = self
            .relay
            .as_ref()
            .ok_or_else(|| unavailable("Relay is not configured"))?;
        let code = PairingCode::parse(&offer.code).map_err(|_| invalid())?;
        // Re-publishing the identical offer also repairs volatile relay mailbox loss.
        self.publish_pairing(api.as_ref(), &offer.bundle).await?;
        let peer = self
            .discover_pairing(
                api.as_ref(),
                &code,
                offer.bundle.identity.side,
                Some(offer.bundle.identity_hash().map_err(|_| invalid())?),
            )
            .await?;
        let Some(peer) = peer else {
            return Ok(None);
        };
        self.execute_local(
            main_caller(),
            Action::PairJoin(PairingJoinArgs {
                code: offer.code,
                peer: Some(peer),
                side: offer.bundle.identity.side,
                payee: offer.bundle.identity.payee,
            }),
        )
        .await
        .map(Some)
    }
    async fn publish_pairing(
        &self,
        api: &dyn table_relay::RelayApi,
        bundle: &SignedPairingIdentity,
    ) -> Result<(), CommandError> {
        let raw: String = self
            .execute_local(main_caller(), Action::PairWire(bundle.clone()))
            .await?;
        api.create(bundle.identity.code_hash)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))?;
        api.send(bundle.identity.code_hash, &raw)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))
    }
    async fn discover_pairing(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &PairingCode,
        own_side: Side,
        reply_to: Option<H256>,
    ) -> Result<Option<SignedPairingIdentity>, CommandError> {
        let batch = api
            .poll(code.mailbox_hash(), "", 0, 0)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))?;
        batch.validate().map_err(|_| invalid())?;
        let mut candidate: Option<SignedPairingIdentity> = None;
        for raw in batch.messages {
            let Ok(bundle) = SignedPairingIdentity::from_jws(&raw) else {
                continue;
            };
            if bundle.identity.code_hash != code.mailbox_hash()
                || bundle.identity.side == own_side
                || bundle.identity.in_reply_to != reply_to
            {
                continue;
            }
            if let Some(previous) = &candidate
                && previous.identity_hash().map_err(|_| invalid())?
                    != bundle.identity_hash().map_err(|_| invalid())?
            {
                return Err(permission()); // Never select an arbitrary identity from conflicting replies.
            }
            candidate = Some(bundle);
        }
        Ok(candidate)
    }
}
impl Runtime {
    pub(crate) fn pairing_create(
        &mut self,
        args: PairingCreateArgs,
    ) -> Result<PairingOffer, CommandError> {
        self.prune_pairings();
        if self.pairing_count() >= 64 {
            return Err(unavailable("Too many pending pairings"));
        }
        let mut entropy = [0; 16];
        getrandom::fill(&mut entropy).map_err(|_| unavailable("Randomness unavailable"))?;
        let code = PairingCode::from_entropy(entropy);
        self.make_offer(args, code)
    }
    fn make_offer(
        &mut self,
        args: PairingCreateArgs,
        code: PairingCode,
    ) -> Result<PairingOffer, CommandError> {
        let owner = self.owner()?;
        let agent = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| unavailable("Agent key unavailable"))?;
        let identity = PairingIdentity {
            code_hash: code.mailbox_hash(),
            owner_key: owner.verifying_key().to_bytes(),
            agent_key: agent.verifying_key().to_bytes(),
            side: args.side,
            payee: args.payee,
            expires: self.clock.now().saturating_add(86400),
            in_reply_to: None,
        };
        let bytes = canonical_bytes(&identity).map_err(|_| invalid())?;
        let offer = PairingOffer {
            code: code.expose_for_pairing().into(),
            bundle: SignedPairingIdentity {
                identity,
                owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
                agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
            },
        };
        self.pairing_offers
            .insert(code.mailbox_hash(), offer.clone());
        Ok(offer)
    }

    pub(crate) fn pairing_join(
        &mut self,
        args: PairingJoinArgs,
    ) -> Result<PairingWords, CommandError> {
        let now = self.clock.now();
        self.prune_pairings();
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        let bundle = args.peer.as_ref().ok_or_else(invalid)?;
        let peer = &bundle.identity;
        if code.expose_for_pairing() == "HOUSE" {
            return Err(unavailable(
                "Release-pinned house pairing is deferred to P4",
            ));
        }
        if peer.side == args.side
            || peer.code_hash != code.mailbox_hash()
            || peer.expires <= now
            || peer.expires > now.saturating_add(86400)
        {
            return Err(invalid());
        }
        bundle.verify().map_err(|_| permission())?;
        let pairing_id = bundle.identity_hash().map_err(|_| invalid())?;
        if let Some(existing) = self.pending.get(&pairing_id) {
            if existing.words.reply.identity.side != args.side
                || existing.words.reply.identity.payee != args.payee
            {
                return Err(invalid());
            }
            return Ok(existing.words.clone());
        }
        if !self.pairing_offers.contains_key(&peer.code_hash) && self.pairing_count() >= 64 {
            return Err(unavailable("Too many pending pairings"));
        }
        if self
            .pending
            .values()
            .any(|p| p.peer.identity.code_hash == peer.code_hash)
        {
            return Err(permission());
        }
        let initiating = self.pairing_offers.get(&code.mailbox_hash());
        match initiating {
            Some(offer)
                if offer.bundle.identity.side == args.side
                    && offer.bundle.identity.payee == args.payee
                    && peer.expires == offer.bundle.identity.expires
                    && peer.in_reply_to
                        == Some(offer.bundle.identity_hash().map_err(|_| invalid())?) => {}
            None if peer.in_reply_to.is_none() => {}
            _ => return Err(invalid()),
        }
        let own = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| unavailable("Agent key unavailable"))?
            .verifying_key()
            .to_bytes();
        if peer.agent_key == own {
            return Err(invalid());
        }
        let (buyer, seller) = if args.side == Side::Buyer {
            (own, peer.agent_key)
        } else {
            (peer.agent_key, own)
        };
        let words = PairingWords {
            house_table: None,
            pairing_id,
            words: pairing_words(buyer, seller, &code).map(String::from),
            reply: if let Some(offer) = initiating {
                offer.bundle.clone()
            } else {
                let owner = self.owner()?;
                let agent =
                    existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
                        .map_err(|_| unavailable("Agent key unavailable"))?;
                let identity = PairingIdentity {
                    code_hash: code.mailbox_hash(),
                    owner_key: owner.verifying_key().to_bytes(),
                    agent_key: own,
                    side: args.side,
                    payee: args.payee,
                    expires: peer.expires,
                    in_reply_to: Some(pairing_id),
                };
                let bytes = canonical_bytes(&identity).map_err(|_| invalid())?;
                SignedPairingIdentity {
                    identity,
                    owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
                    agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
                }
            },
        };
        self.pending.insert(
            words.pairing_id,
            PendingPair {
                house: false,
                peer: args.peer.ok_or_else(invalid)?,
                words: words.clone(),
            },
        );
        Ok(words)
    }

    pub(crate) fn pairing_confirm(
        &mut self,
        args: PairingConfirmArgs,
    ) -> Result<KeyId, CommandError> {
        let pending = self.pending.get(&args.pairing_id).ok_or_else(invalid)?;
        if pending.words.words != args.words || pending.peer.identity.expires <= self.clock.now() {
            return Err(invalid());
        }
        let peer = &pending.peer.identity;
        let key_id =
            table_proto::key_id(&VerifyingKey::from_bytes(&peer.agent_key).map_err(|_| invalid())?)
                .map_err(table_app::Error::from)?;
        let cp = Counterparty {
            key_id: key_id.clone(),
            owner_key: peer.owner_key,
            agent_key: peer.agent_key,
            display_name: ShortText::new(args.display_name).map_err(table_app::Error::from)?,
            paired_via: if pending.house {
                PairedVia::House
            } else {
                PairedVia::Code
            },
            words_confirmed_at: Some(self.clock.now()),
            declared_payee: peer.payee.clone(),
            first_seen: self.clock.now(),
        };
        if let Some(table) = &pending.words.house_table {
            app(self
                .pipeline
                .wallet
                .ledger
                .set_preference(&format!("house.table.{}", table.deal_id), table))?;
        }
        if let Some((hash, owner, payee)) =
            app(self.pipeline.wallet.ledger.counterparty_binding(&key_id))?
        {
            let (paired, house, _) = app(self.pipeline.wallet.ledger.counterparty_policy(&key_id))?;
            if !pending.house
                || !paired
                || !house
                || hash != peer.code_hash
                || owner != peer.owner_key
                || payee != peer.payee
            {
                return Err(permission());
            }
        } else {
            app(self
                .pipeline
                .wallet
                .ledger
                .insert_paired_counterparty(&cp, peer.code_hash))?;
        }
        let code_hash = peer.code_hash;
        self.pending.remove(&args.pairing_id);
        self.pairing_offers.remove(&code_hash);
        Ok(key_id)
    }
    /// Forgets a pending pairing before anything is pinned: by id (and the creator's offer for the
    /// same code) or by the creator's own code (and any pending join on it). Idempotent: a
    /// pairing that already lapsed or was confirmed leaves nothing to abort.
    pub(crate) fn pairing_abort(&mut self, args: &PairingAbortArgs) -> Result<(), CommandError> {
        let code_hash = match (&args.pairing_id, &args.code) {
            (Some(id), None) => self.pending.get(id).map(|p| p.peer.identity.code_hash),
            (None, Some(code)) => Some(
                PairingCode::parse(code)
                    .map_err(|_| invalid())?
                    .mailbox_hash(),
            ),
            _ => return Err(invalid()),
        };
        if let Some(id) = &args.pairing_id {
            self.pending.remove(id);
        }
        if let Some(hash) = code_hash {
            self.pairing_offers.remove(&hash);
            self.pending
                .retain(|_, p| p.peer.identity.code_hash != hash);
        }
        if self
            .selected_pairing
            .is_some_and(|id| !self.pending.contains_key(&id))
        {
            self.selected_pairing = None;
        }
        Ok(())
    }
    fn prune_pairings(&mut self) {
        let now = self.clock.now();
        self.pending.retain(|_, p| p.peer.identity.expires > now);
        self.pairing_offers
            .retain(|_, p| p.bundle.identity.expires > now);
    }
    fn pairing_count(&self) -> usize {
        self.pairing_offers.len()
            + self
                .pending
                .values()
                .filter(|p| !self.pairing_offers.contains_key(&p.peer.identity.code_hash))
                .count()
    }
    pub(crate) fn pairing_offer(
        &mut self,
        args: PairingPollArgs,
    ) -> Result<PairingOffer, CommandError> {
        self.prune_pairings();
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        self.pairing_offers
            .get(&code.mailbox_hash())
            .cloned()
            .ok_or_else(invalid)
    }
    pub(crate) fn pairing_wire(
        &self,
        bundle: SignedPairingIdentity,
    ) -> Result<String, CommandError> {
        let key = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| unavailable("Agent key unavailable"))?;
        if bundle.identity.owner_key != self.owner()?.verifying_key().to_bytes()
            || bundle.identity.expires <= self.clock.now()
        {
            return Err(invalid());
        }
        bundle.to_jws(&key).map_err(|_| invalid())
    }
    pub(crate) fn house_offer(
        &mut self,
        args: PairingCreateArgs,
    ) -> Result<PairingOffer, CommandError> {
        if args.side != Side::Buyer {
            return Err(invalid());
        }
        self.prune_pairings();
        let release = self
            .house_release
            .as_ref()
            .ok_or_else(|| unavailable("HOUSE release identity is not pinned in this build"))?;
        let key = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| invalid())?;
        let mut seed = key.verifying_key().to_bytes().to_vec();
        seed.extend_from_slice(&release.mandate_commitment.0);
        let hash = H256::digest(&seed);
        let mut entropy = [0; 16];
        entropy.copy_from_slice(&hash.0[..16]);
        let code = PairingCode::from_entropy(entropy);
        if let Some(offer) = self.pairing_offers.get(&code.mailbox_hash()) {
            if offer.bundle.identity.payee != args.payee {
                return Err(invalid());
            }
            return Ok(offer.clone());
        }
        if self.pairing_count() >= 64 {
            return Err(unavailable("Too many pending pairings"));
        }
        self.make_offer(args, code)
    }
    pub(crate) fn house_pair(
        &mut self,
        response: table_proto::HouseResponse,
    ) -> Result<PairingWords, CommandError> {
        let release = self.house_release.as_ref().ok_or_else(invalid)?;
        let offer = self
            .pairing_offers
            .get(&response.seller.identity.code_hash)
            .cloned()
            .ok_or_else(invalid)?;
        response
            .verify(release, &offer.bundle, self.clock.now())
            .map_err(|_| permission())?;
        let mut words = self.pairing_join(PairingJoinArgs {
            code: offer.code,
            side: Side::Buyer,
            payee: offer.bundle.identity.payee,
            peer: Some(response.seller),
        })?;
        words.house_table = Some(response.table);
        let pending = self
            .pending
            .get_mut(&words.pairing_id)
            .ok_or_else(invalid)?;
        pending.house = true;
        pending.words = words.clone();
        Ok(words)
    }
}
