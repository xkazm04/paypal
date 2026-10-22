//! The async relay half of pairing: the `ActorHandle` commands that talk to the relay and the HOUSE.
use crate::{Action, ActorHandle, Caller, invalid, permission, unavailable};
use table_client::*;
use table_core::*;
use table_proto::{PairingCode, PairingCommit, PairingReveal};

/// How long one join waits for the initiator's reveal before it asks the owner to try again. The
/// initiator's desk polls every 3 s and reveals in the poll that finds the reply.
const REVEAL_WAIT: std::time::Duration = if cfg!(test) {
    std::time::Duration::ZERO
} else {
    std::time::Duration::from_secs(8)
};
const REVEAL_POLL: std::time::Duration = std::time::Duration::from_secs(1);

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
            self.publish_commit(api.as_ref(), &offer.code).await?;
        }
        Ok(offer)
    }
    pub(crate) async fn relay_pairing_join(
        &self,
        caller: Caller,
        args: PairingJoinArgs,
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
        if args.peer.is_some() {
            // A reply handed over offline: only the initiator of this code can take one.
            return self.execute_local(caller, Action::PairJoin(args)).await;
        }
        let api = self
            .relay
            .as_ref()
            .ok_or_else(|| unavailable("Relay is not configured"))?;
        // Commit-then-reveal (DECISIONS section 47): answer the commit with our signed reply, and
        // compute words only once the initiator's reveal opens that commit.
        let Some(commit) = self.discover_commit(api.as_ref(), &code, args.side).await? else {
            return Err(unavailable("Pairing offer is not available yet"));
        };
        let poll = PairingPollArgs {
            code: args.code.clone(),
        };
        let reply: SignedPairingIdentity = self
            .execute_local(main_caller(), Action::PairAnswer(args, commit))
            .await?;
        self.publish_pairing(api.as_ref(), &reply).await?;
        let deadline = tokio::time::Instant::now() + REVEAL_WAIT;
        loop {
            let reveals = self.discover_reveals(api.as_ref(), &code).await?;
            if !reveals.is_empty() || tokio::time::Instant::now() >= deadline {
                return self
                    .execute_local(main_caller(), Action::PairRevealed(poll, reveals))
                    .await;
            }
            tokio::time::sleep(REVEAL_POLL).await;
        }
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
            // A failed wake is retryable, not a fault: the house goes back to idle. The reset waits
            // for room in the actor's queue (the guard's `try_send` can be dropped when it is full
            // and stays only for a cancelled wake).
            self.execute_local::<()>(main_caller(), Action::HouseStatus(HouseState::Idle))
                .await?;
            wake.active = false;
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
        // Re-publishing the identical commit also repairs volatile relay mailbox loss.
        let commit = self.publish_commit(api.as_ref(), &offer.code).await?;
        let peer = self
            .discover_pairing(
                api.as_ref(),
                &code,
                offer.bundle.identity.side,
                Some(commit.commit),
            )
            .await?;
        let Some(peer) = peer else {
            return Ok(None);
        };
        let words: PairingWords = self
            .execute_local(
                main_caller(),
                Action::PairJoin(PairingJoinArgs {
                    code: offer.code.clone(),
                    peer: Some(peer),
                    side: offer.bundle.identity.side,
                    payee: offer.bundle.identity.payee,
                }),
            )
            .await?;
        // The joiner's key is now fixed in a held reply, so our bundle can be shown.
        let reveal: PairingReveal = self
            .execute_local(
                main_caller(),
                Action::PairRevealOf(PairingPollArgs { code: offer.code }),
            )
            .await?;
        self.publish_raw(
            api.as_ref(),
            commit.code_hash,
            &reveal.to_wire().map_err(|_| invalid())?,
        )
        .await?;
        Ok(Some(words))
    }
    async fn publish_pairing(
        &self,
        api: &dyn table_relay::RelayApi,
        bundle: &SignedPairingIdentity,
    ) -> Result<(), CommandError> {
        let raw: String = self
            .execute_local(main_caller(), Action::PairWire(bundle.clone()))
            .await?;
        self.publish_raw(api, bundle.identity.code_hash, &raw).await
    }
    async fn publish_commit(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &str,
    ) -> Result<PairingCommit, CommandError> {
        let commit: PairingCommit = self
            .execute_local(
                main_caller(),
                Action::PairCommit(PairingPollArgs { code: code.into() }),
            )
            .await?;
        self.publish_raw(
            api,
            commit.code_hash,
            &commit.to_wire().map_err(|_| invalid())?,
        )
        .await?;
        Ok(commit)
    }
    async fn publish_raw(
        &self,
        api: &dyn table_relay::RelayApi,
        code_hash: H256,
        raw: &str,
    ) -> Result<(), CommandError> {
        api.create(code_hash)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))?;
        api.send(code_hash, raw)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))
    }
    async fn mailbox(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &PairingCode,
    ) -> Result<Vec<String>, CommandError> {
        let batch = api
            .poll(code.mailbox_hash(), "", 0, 0)
            .await
            .map_err(|_| unavailable("Pairing relay unavailable"))?;
        batch.validate().map_err(|_| invalid())?;
        Ok(batch.messages)
    }
    /// The one commit for this code from the other side; conflicting commits fail closed.
    async fn discover_commit(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &PairingCode,
        own_side: Side,
    ) -> Result<Option<PairingCommit>, CommandError> {
        let mut candidate: Option<PairingCommit> = None;
        for raw in self.mailbox(api, code).await? {
            let Ok(commit) = PairingCommit::from_wire(&raw) else {
                continue;
            };
            if commit.code_hash != code.mailbox_hash() || commit.side == own_side {
                continue;
            }
            if candidate
                .as_ref()
                .is_some_and(|previous| *previous != commit)
            {
                return Err(permission());
            }
            candidate = Some(commit);
        }
        Ok(candidate)
    }
    /// Every well-formed reveal for this code; the runtime aborts on any that does not open.
    async fn discover_reveals(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &PairingCode,
    ) -> Result<Vec<PairingReveal>, CommandError> {
        Ok(self
            .mailbox(api, code)
            .await?
            .iter()
            .filter_map(|raw| PairingReveal::from_wire(raw).ok())
            .filter(|reveal| reveal.bundle.identity.code_hash == code.mailbox_hash())
            .collect())
    }
    async fn discover_pairing(
        &self,
        api: &dyn table_relay::RelayApi,
        code: &PairingCode,
        own_side: Side,
        reply_to: Option<H256>,
    ) -> Result<Option<SignedPairingIdentity>, CommandError> {
        let mut candidate: Option<SignedPairingIdentity> = None;
        for raw in self.mailbox(api, code).await? {
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
