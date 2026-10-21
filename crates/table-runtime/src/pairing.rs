//! Signed identity exchange with an owner-confirmed short authentication string.
use crate::{
    Runtime, app, invalid, permission,
    service::{AwaitingReveal, OfferCommit, PendingPair},
    unavailable,
    vault::existing_signing_key,
};
use ed25519_dalek::{Signer, VerifyingKey};
use table_client::*;
use table_core::*;
use table_ledger::{Counterparty, PairedVia};
use table_proto::{PairingCode, PairingCommit, PairingReveal, ShortText, pairing_words};

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
        let mut nonce = [0; 32];
        getrandom::fill(&mut nonce).map_err(|_| unavailable("Randomness unavailable"))?;
        let offer = self.make_offer(args, code)?;
        let (commit, reveal) = PairingCommit::seal(&offer.bundle, nonce).map_err(|_| invalid())?;
        self.pairing_commits
            .insert(commit.code_hash, OfferCommit { commit, reveal });
        Ok(offer)
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
        // Only the initiator of this code takes a bare reply: its own offer must be held, and the
        // reply must answer the commit it published (the bundle hash for a HOUSE offer, which has
        // no commit and is pinned by release identity instead). A joiner gets words only from a
        // reveal that opens a commit (`pairing_revealed`).
        let offer = self
            .pairing_offers
            .get(&code.mailbox_hash())
            .ok_or_else(invalid)?;
        let answers = match self.pairing_commits.get(&code.mailbox_hash()) {
            Some(sealed) => sealed.commit.commit,
            None => offer.bundle.identity_hash().map_err(|_| invalid())?,
        };
        if offer.bundle.identity.side != args.side
            || offer.bundle.identity.payee != args.payee
            || peer.expires != offer.bundle.identity.expires
            || peer.in_reply_to != Some(answers)
        {
            return Err(invalid());
        }
        let reply = offer.bundle.clone();
        let peer = args.peer.ok_or_else(invalid)?;
        self.seat_pair(&code, pairing_id, peer, reply)
    }
    /// Computes the words for a verified peer bundle and holds the pair until the owner confirms.
    fn seat_pair(
        &mut self,
        code: &PairingCode,
        pairing_id: H256,
        peer: SignedPairingIdentity,
        reply: SignedPairingIdentity,
    ) -> Result<PairingWords, CommandError> {
        let own = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| unavailable("Agent key unavailable"))?
            .verifying_key()
            .to_bytes();
        if peer.identity.agent_key == own || reply.identity.agent_key != own {
            return Err(invalid());
        }
        let (buyer, seller) = if reply.identity.side == Side::Buyer {
            (own, peer.identity.agent_key)
        } else {
            (peer.identity.agent_key, own)
        };
        let words = PairingWords {
            house_table: None,
            pairing_id,
            words: pairing_words(buyer, seller, code).map(String::from),
            reply,
        };
        self.pending.insert(
            words.pairing_id,
            PendingPair {
                house: false,
                peer,
                words: words.clone(),
            },
        );
        Ok(words)
    }
    /// The initiator's commit for its own offer, to publish in place of the bundle.
    pub(crate) fn pairing_commit(
        &mut self,
        args: &PairingPollArgs,
    ) -> Result<PairingCommit, CommandError> {
        self.prune_pairings();
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        self.pairing_commits
            .get(&code.mailbox_hash())
            .map(|sealed| sealed.commit.clone())
            .ok_or_else(invalid)
    }
    /// The initiator's reveal, given only once a joiner's reply to this code is held as a pending
    /// pair: by then the joiner's key is fixed, so the reveal cannot help anyone choose it.
    pub(crate) fn pairing_reveal_of(
        &mut self,
        args: &PairingPollArgs,
    ) -> Result<PairingReveal, CommandError> {
        self.prune_pairings();
        let hash = PairingCode::parse(&args.code)
            .map_err(|_| invalid())?
            .mailbox_hash();
        let sealed = self.pairing_commits.get(&hash).ok_or_else(invalid)?;
        if !self
            .pending
            .values()
            .any(|p| !p.house && p.peer.identity.code_hash == hash)
        {
            return Err(invalid());
        }
        Ok(sealed.reveal.clone())
    }
    /// The joiner's signed reply to a commit. No words yet: they wait for the reveal.
    pub(crate) fn pairing_answer(
        &mut self,
        args: PairingJoinArgs,
        commit: PairingCommit,
    ) -> Result<SignedPairingIdentity, CommandError> {
        let now = self.clock.now();
        self.prune_pairings();
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        let hash = code.mailbox_hash();
        if code.expose_for_pairing() == "HOUSE"
            || args.peer.is_some()
            || commit.side == args.side
            || commit.code_hash != hash
            || commit.expires <= now
            || commit.expires > now.saturating_add(86400)
            || self.pairing_offers.contains_key(&hash)
        {
            return Err(invalid());
        }
        let held = match self.awaiting_reveal.get(&hash) {
            Some(waiting) => Some((&waiting.commit.commit, &waiting.reply)),
            None => self
                .pending
                .values()
                .find(|p| !p.house && p.peer.identity.code_hash == hash)
                .and_then(|p| {
                    p.words
                        .reply
                        .identity
                        .in_reply_to
                        .as_ref()
                        .map(|answered| (answered, &p.words.reply))
                }),
        };
        if let Some((answered, reply)) = held {
            if *answered != commit.commit {
                return Err(permission());
            }
            if reply.identity.side != args.side || reply.identity.payee != args.payee {
                return Err(invalid());
            }
            return Ok(reply.clone());
        }
        if self.pairing_count() >= 64 {
            return Err(unavailable("Too many pending pairings"));
        }
        let owner = self.owner()?;
        let agent = existing_signing_key(self.vault.as_ref(), AgentSlot::Negotiator.key_name())
            .map_err(|_| unavailable("Agent key unavailable"))?;
        let identity = PairingIdentity {
            code_hash: hash,
            owner_key: owner.verifying_key().to_bytes(),
            agent_key: agent.verifying_key().to_bytes(),
            side: args.side,
            payee: args.payee,
            expires: commit.expires,
            in_reply_to: Some(commit.commit),
        };
        let bytes = canonical_bytes(&identity).map_err(|_| invalid())?;
        let reply = SignedPairingIdentity {
            identity,
            owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
            agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
        };
        self.awaiting_reveal.insert(
            hash,
            AwaitingReveal {
                commit,
                reply: reply.clone(),
            },
        );
        Ok(reply)
    }
    /// Opens the answered commit with the reveals the relay holds. No reveal yet: no words. Any
    /// reveal that does not open the commit (another bundle or nonce) ends the pairing: nothing is
    /// held, so nothing can be confirmed or pinned.
    pub(crate) fn pairing_revealed(
        &mut self,
        args: &PairingPollArgs,
        reveals: Vec<PairingReveal>,
    ) -> Result<PairingWords, CommandError> {
        self.prune_pairings();
        let code = PairingCode::parse(&args.code).map_err(|_| invalid())?;
        let hash = code.mailbox_hash();
        if let Some((id, pair)) = self
            .pending
            .iter()
            .find(|(_, p)| !p.house && p.peer.identity.code_hash == hash)
            && !self.pairing_offers.contains_key(&hash)
        {
            let id = *id;
            let peer = pair.peer.identity_hash().map_err(|_| invalid())?;
            let words = pair.words.clone();
            if reveals
                .iter()
                .all(|r| r.bundle.identity_hash().ok() == Some(peer))
            {
                return Ok(words);
            }
            self.pending.remove(&id);
            return Err(permission());
        }
        let waiting = self.awaiting_reveal.get(&hash).ok_or_else(invalid)?;
        let Some(first) = reveals.first() else {
            return Err(unavailable("Pairing offer is not available yet"));
        };
        let first_hash = first.bundle.identity_hash().map_err(|_| invalid())?;
        if reveals.iter().any(|r| {
            r.opens(&waiting.commit).is_err() || r.bundle.identity_hash().ok() != Some(first_hash)
        }) {
            self.awaiting_reveal.remove(&hash);
            return Err(permission());
        }
        let waiting = self.awaiting_reveal.remove(&hash).ok_or_else(invalid)?;
        let peer = first.bundle.clone();
        self.seat_pair(&code, first_hash, peer, waiting.reply)
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
        // Kept only once the pin is accepted: a refused confirm leaves no table to join.
        if let Some(table) = &pending.words.house_table {
            app(self
                .pipeline
                .wallet
                .ledger
                .set_preference(&house_table_key(&key_id, table.deal_id), table))?;
        }
        let code_hash = peer.code_hash;
        self.pending.remove(&args.pairing_id);
        self.pairing_offers.remove(&code_hash);
        self.pairing_commits.remove(&code_hash);
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
            self.pairing_commits.remove(&hash);
            self.awaiting_reveal.remove(&hash);
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
        self.pairing_commits.retain(|_, c| c.commit.expires > now);
        self.awaiting_reveal.retain(|_, w| w.commit.expires > now);
    }
    fn pairing_count(&self) -> usize {
        self.pairing_offers.len()
            + self.awaiting_reveal.len()
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

/// The preference that keeps a house's table: bound to the house key that served it as well as
/// the deal id, so a table kept from one house is never read back against another. An older
/// `house.table.<deal_id>` preference is under a different key and is never read.
pub(crate) fn house_table_key(key_id: &KeyId, deal_id: DealId) -> String {
    format!("house.table.{key_id}.{deal_id}")
}
