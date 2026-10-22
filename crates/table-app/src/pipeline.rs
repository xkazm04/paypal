use crate::{ApprovalSession, Error, OwnerTicket, Wallet};
use std::sync::Arc;
use table_core::*;
use table_ledger::{HttpMethod, OperationOutcome, PaypalCall, PaypalPath};
use table_paypal::{CreateOrder, Observation, PayPalApi, RequestId, ResourceId};
use table_proto::Body;

/// What a finished PayPal operation produced: the calls it observed, the references it learned
/// and the deal event it earns, recorded together by [`Pipeline::complete`].
pub(crate) struct Completion<'a> {
    pub(crate) operation: &'a str,
    pub(crate) observations: &'a [Observation],
    pub(crate) refs: &'a PaypalRefs,
    pub(crate) event: Option<DealEvent>,
}
mod read_state;
mod resolve;
mod send;
mod shield_gate;
pub use read_state::READ_STATE_CAP;
pub(crate) use resolve::{
    Finding, PARKED_READ_SECS, PARKED_READ_WINDOW_SECS, REQUEST_ID_KEPT_SECS,
};
pub use resolve::{PENDING_STALE_SECS, Resolve, SETTLE_SECS};
pub(crate) use shield_gate::shield_allows;
pub use shield_gate::{MoneyStep, ShieldGate};
#[derive(Debug)]
pub enum Authority {
    Policy,
    SellerMandate,
    HouseMandate,
    Owner(OwnerTicket),
}
pub struct Pipeline {
    pub wallet: Wallet,
    pub approval: ApprovalSession,
    pub(crate) api: Arc<dyn PayPalApi>,
    house: Option<table_proto::HouseRelease>,
    /// When this process opened the pipeline: a reservation still `pending` from before it has
    /// no live call (see [`Pipeline::stale_before`]).
    started: Timestamp,
    /// The owner paused all agents: the read-back resolver sends nothing again under the
    /// clause-6 policy, exactly as the scheduler starts no create under it (T10).
    pub policy_paused: bool,
    /// The deal being ticked has no agent key to sign with (its mandate was revoked, or the key is
    /// gone). The read-back resolver then settles only what needs no signature (a void, a step
    /// PayPal shows not done) and sends nothing again but a void; a capture or a paid invoice
    /// PayPal confirms waits for the key, since its receipt is signed. The deadline's safe default
    /// still applies. Set by the runtime around one deal's tick, and cleared after it.
    pub signer_missing: bool,
    /// Set to the deal when a money step is refused by the scam shield (the refusal is in the
    /// audit log). The scheduler clears it before a step and reads it after, to tell a recorded
    /// refusal, which waits for the owner, from a fault.
    pub shield_refused: Option<DealId>,
    /// Invoicing, for the rescue invoice (set by the trusted shell; `None` sends no invoice).
    pub(crate) secondary: Option<Arc<dyn table_paypal::SecondaryApi>>,
    /// When each rescue invoice was last read, so PAID is polled on a cadence. Bounded like
    /// `rescue_read_backoff`.
    pub(crate) rescue_polled: std::collections::BTreeMap<DealId, Timestamp>,
    /// When each parked capture, void or lost send was last read back on its own, by request
    /// id, so the read is hourly (`PARKED_READ_SECS`). In memory only: a restart reads at once.
    /// Bounded like `rescue_read_backoff`.
    pub(crate) parked_read: std::collections::BTreeMap<String, Timestamp>,
    /// Failed read-backs of a lost invoice step, a lost authorize, capture or void, by request id
    /// (and of a sent invoice past its deadline, by `deadline-read:{deal id}`): how many in a row
    /// and when the next try is due. In memory only: a restart reads at once and counts from zero
    /// (the terminal needs-attention state itself is the parked resolution row, which is kept).
    ///
    /// These three maps are bounded (DECISIONS 52b). A deal's entries are dropped when the deal
    /// is terminal, an entry when its step is no longer open, and a money read's entry once the
    /// deal is `PARKED_READ_WINDOW_SECS` past its deadline (the window is durable, so nothing
    /// reads it then); see [`Pipeline::prune_read_state`]. Each map holds at most
    /// `read_state_cap` entries, and past it the entry with the oldest time is dropped. An entry
    /// dropped by the cap whose step is still open may be read sooner than its dropped schedule,
    /// but never sooner than `RESCUE_POLL_SECS` after the drop (`read_floor_until`) and never
    /// past the durable window; a failure counts again from one with the floor under it. Nothing
    /// is read on a 1 s tick for want of an entry.
    pub(crate) rescue_read_backoff: std::collections::BTreeMap<String, (u32, Timestamp)>,
    /// The most entries each of `rescue_polled`, `parked_read` and `rescue_read_backoff` holds
    /// ([`READ_STATE_CAP`]; a test lowers it).
    pub(crate) read_state_cap: usize,
    /// Until this time no read whose schedule entry is missing is made: the cap dropped an entry
    /// at most `RESCUE_POLL_SECS` ago, and the missing one may be it.
    pub(crate) read_floor_until: Timestamp,
    /// Seed of the backoff jitter (see `set_rescue_jitter_seed`).
    pub(crate) rescue_jitter_seed: u64,
    /// Owner tickets already spent on the one read of a sent rescue invoice past its deadline
    /// (deal, minted at, session generation): one ticket gives one read. In memory only; a ticket
    /// lives 60 seconds and dies with the session generation, so an entry older than that is
    /// dropped (its ticket no longer validates), as is every entry of a terminal deal: the set
    /// holds only the tickets minted in the last minute.
    pub(crate) rescue_owner_read: std::collections::BTreeSet<(DealId, Timestamp, u64)>,
    /// Owner tickets already spent on the one read of an open authorize (deal, minted at, session
    /// generation): one ticket gives one read. In memory only, as `rescue_owner_read`.
    pub(crate) authorize_owner_read: std::collections::BTreeSet<(DealId, Timestamp, u64)>,
}
impl std::fmt::Debug for Pipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Pipeline")
            .field("wallet", &self.wallet)
            .finish_non_exhaustive()
    }
}
impl Pipeline {
    /// Owner consent changes only clause-6 authority. All other checks use the same
    /// mandate, shield and ledger paths as settlement; no PayPal call is made here.
    pub fn owner_accept(
        &mut self,
        id: DealId,
        counter_hash: H256,
        category: Category,
        ticket: OwnerTicket,
        owner: &ed25519_dalek::SigningKey,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        self.approval
            .validate(&ticket, id, deal.terms.hash()?, 1, now)?;
        if owner.verifying_key() != self.wallet.owner {
            return Err(Error::Permission);
        }
        let (seq, terms_hash) = self.check_owner_accept(id, counter_hash, category, now)?;
        let proof = table_proto::OwnerAccept::sign(id, seq, terms_hash, counter_hash, owner)?;
        let envelope = self.wallet.signed(
            &deal,
            Body::Accept {
                offer_seq: seq,
                terms_hash,
                owner_accept: Some(proof),
            },
            now,
        )?;
        self.wallet.ledger.commit_negotiation(
            &envelope,
            table_ledger::Direction::Outbound,
            None,
            None,
            now,
        )?;
        Ok(())
    }
    pub fn check_owner_accept(
        &self,
        id: DealId,
        counter_hash: H256,
        category: Category,
        now: Timestamp,
    ) -> Result<(u32, H256), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.side != Side::Buyer
            || deal.kind != DealKind::Haggle
            || deal.mode != Mode::Sandbox
            || deal.state != DealState::Negotiating
            || self.shield(&deal, now)? >= ShieldVerdict::Hold
            || self
                .wallet
                .ledger
                .deadline(id)?
                .is_none_or(|(due, _)| due <= now)
            || self
                .wallet
                .ledger
                .negotiation_status(id)?
                .is_none_or(|s| s.own_accept)
        {
            return Err(Error::Permission);
        }
        self.wallet.check_mandate(id, category, now)?;
        // Shop around (T8): never offered once another table of the group agreed or holds our
        // one ACCEPT; the ledger refuses it again in the transaction that would record it.
        if self.wallet.ledger.group_accept_blocked(id, true)? {
            return Err(table_ledger::LedgerError::GroupClosed.into());
        }
        let (seq, hash, direction, counter) = self.wallet.ledger.last_proposal(id)?;
        let (offer_seq, terms_hash) = self.wallet.ledger.pending_offer(id)?;
        if !counter
            || direction != table_ledger::Direction::Inbound
            || counter_hash != hash
            || seq != offer_seq
            || terms_hash != deal.terms.hash()?
        {
            return Err(Error::Invalid);
        }
        Ok((seq, terms_hash))
    }
    pub async fn credentials_changed(&mut self) {
        self.api.credentials_changed().await;
    }
    /// Explicit owner void is a safe direction but still requires approval authority.
    pub async fn owner_void(
        &mut self,
        id: DealId,
        attempt: u8,
        ticket: OwnerTicket,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        self.approval
            .validate(&ticket, id, deal.terms.hash()?, attempt, now)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let request = RequestId::for_operation(id, attempt, "void").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.authorization.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "void",
            request.as_str(),
            &DecidedBy::Human { at: ticket.at },
            now,
        )?;
        self.send_void(&deal, attempt, &resource, &request, DealEvent::Void, now)
            .await
    }
    /// Send the void reserved under `request` and finish its operation with PayPal's answer.
    pub(crate) async fn send_void(
        &mut self,
        deal: &Deal,
        attempt: u8,
        resource: &ResourceId,
        request: &RequestId,
        event: DealEvent,
        now: Timestamp,
    ) -> Result<(), Error> {
        match self.api.void(resource, request).await {
            Ok(r) => self.complete(
                deal,
                attempt,
                Completion {
                    operation: "void",
                    observations: &r.observations,
                    refs: &deal.paypal,
                    event: Some(event),
                },
                now,
            ),
            Err(e) => {
                self.complete(
                    deal,
                    attempt,
                    Completion {
                        operation: "void",
                        observations: e.observations(),
                        refs: &deal.paypal,
                        event: None,
                    },
                    now,
                )?;
                Err(Error::Unavailable)
            }
        }
    }

    pub fn owner_release_hold(
        &mut self,
        id: DealId,
        attempt: u8,
        ticket: OwnerTicket,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        let terms = deal.terms.hash()?;
        self.approval.validate(&ticket, id, terms, attempt, now)?;
        // Only a HOLD is released, and only the rules holding it now, for these terms. A BLOCK
        // never is; a hold with no named rule (a settlement mismatch) is not either.
        let sources = self.shield_sources(&deal, now)?;
        let gate = Self::judge(&deal, &sources);
        if gate.verdict != ShieldVerdict::Hold {
            return Err(Error::Permission);
        }
        let rules = sources
            .iter()
            .filter(|s| s.verdict == ShieldVerdict::Hold)
            .map(|s| s.rule.ok_or(Error::Permission))
            .collect::<Result<Vec<_>, _>>()?;
        // The hold the owner saw is recorded first, then the release beside it.
        self.wallet
            .ledger
            .record_shield(id, gate.verdict, gate.rule, terms, now)?;
        self.wallet
            .ledger
            .release_shield_hold(id, &rules, terms, now)?;
        Ok(())
    }

    /// Retrieve the bound SETTLE, rechecking truth and mode before handing off to a browser.
    pub fn approval_link(&self, id: DealId, attempt: u8) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::AwaitingApproval
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || deal.mode == Mode::Replay
            || deal.shield_held()
        {
            return Err(Error::Permission);
        }
        self.wallet
            .ledger
            .verified_approval_link(id, attempt)
            .map_err(Into::into)
    }
    pub async fn apply_shield(
        &mut self,
        id: DealId,
        verdict: ShieldVerdict,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.wallet.ledger.raise_shield(id, verdict, now)?;
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state == DealState::Authorized && deal.shield_held() {
            self.auto_void(id, self.wallet.ledger.settled_attempt(id)?, now)
                .await?;
        }
        Ok(())
    }
    pub fn new(wallet: Wallet, api: Arc<dyn PayPalApi>, now: Timestamp) -> Result<Self, Error> {
        Ok(Self {
            wallet,
            api,
            house: None,
            started: now,
            approval: ApprovalSession::new(now)?,
            policy_paused: false,
            signer_missing: false,
            shield_refused: None,
            secondary: None,
            rescue_polled: std::collections::BTreeMap::new(),
            parked_read: std::collections::BTreeMap::new(),
            rescue_read_backoff: std::collections::BTreeMap::new(),
            read_state_cap: READ_STATE_CAP,
            read_floor_until: Timestamp::MIN,
            rescue_owner_read: std::collections::BTreeSet::new(),
            authorize_owner_read: std::collections::BTreeSet::new(),
            rescue_jitter_seed: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0x5eed, |d| d.as_nanos() as u64),
        })
    }
    /// Trusted shell setup only: the Invoicing client the rescue invoice goes through.
    pub fn set_secondary(&mut self, api: Option<Arc<dyn table_paypal::SecondaryApi>>) {
        self.secondary = api;
    }
    /// Trusted hosted setup only. No IPC or agent request can install this authority.
    pub fn enable_house(
        &mut self,
        release: table_proto::HouseRelease,
        mandate: &OpenMandate,
    ) -> Result<(), Error> {
        release
            .verify_mandate(mandate)
            .map_err(|_| Error::Permission)?;
        if release.owner_key != self.wallet.owner.to_bytes()
            || release.agent_key != self.wallet.agent_public_key().to_bytes()
        {
            return Err(Error::Permission);
        }
        if let Some(existing) = self
            .wallet
            .ledger
            .preference::<table_proto::HouseRelease>("house.release")?
        {
            if canonical_bytes(&existing).map_err(|_| Error::Invalid)?
                != canonical_bytes(&release).map_err(|_| Error::Invalid)?
            {
                return Err(Error::Permission);
            }
        } else {
            self.wallet
                .ledger
                .set_preference("house.release", &release)?;
        }
        self.house = Some(release);
        Ok(())
    }
    pub(crate) fn expected(&self, deal: &Deal, attempt: u8) -> Result<CreateOrder, Error> {
        let payee = self.wallet.settlement_payee(deal)?;
        Self::order_for(deal, attempt, payee)
    }
    /// The order a read-back must find: as `expected`, with the payee from the deal's mandate
    /// as recorded, so a mandate revoked while a step is open still lets PayPal's record be
    /// checked. A read-back grants nothing; every send takes `expected`.
    pub(crate) fn recorded_order(&self, deal: &Deal, attempt: u8) -> Result<CreateOrder, Error> {
        let payee = self.wallet.recorded_payee(deal)?;
        Self::order_for(deal, attempt, payee)
    }
    fn order_for(deal: &Deal, attempt: u8, payee: PayeeRef) -> Result<CreateOrder, Error> {
        Ok(CreateOrder {
            deal: deal.id,
            attempt,
            amount: deal.terms.amount()?,
            terms_hash: deal.terms.hash()?,
            merchant_id: ResourceId::new(payee.as_str()).map_err(|_| Error::Invalid)?,
        })
    }
    pub(crate) fn authority(
        &mut self,
        deal: &Deal,
        category: Category,
        authority: Authority,
        attempt: u8,
        now: Timestamp,
    ) -> Result<DecidedBy, Error> {
        // No PayPal step of a purchase runs on policy: only the owner's decision starts,
        // authorizes or captures it, whatever the amount and whatever clause 6 allows.
        if matches!(authority, Authority::Policy) && deal.kind == DealKind::Purchase {
            return Err(Error::Permission);
        }
        // A rescue invoice goes out only on the owner's decision in the approval window: no
        // signed rule, seller or house mandate, or safe default ever sends one.
        if deal.kind == DealKind::Rescue && !matches!(authority, Authority::Owner(_)) {
            return Err(Error::Permission);
        }
        let decision = self.wallet.mandate_check(deal, category, now)?;
        match authority {
            Authority::HouseMandate
                if deal.side == Side::Seller
                    && deal.kind == DealKind::Haggle
                    && deal.mode == Mode::Sandbox
                    && deal.terms.qty == 1
                    && deal.terms.delivery == Delivery::DigitalNow
                    && decision == MandateDecision::Allow =>
            {
                let release = self.house.as_ref().ok_or(Error::Permission)?;
                let mandate = self.wallet.ledger.active_mandate(
                    deal.mandate_id,
                    deal.mandate_version,
                    &self.wallet.owner,
                )?;
                release
                    .verify_mandate(&mandate)
                    .map_err(|_| Error::Permission)?;
                if self.wallet.settlement_payee(deal)? != release.payee {
                    return Err(Error::Permission);
                }
                Ok(DecidedBy::HouseMandate {
                    mandate_hash: release.mandate_commitment,
                })
            }
            Authority::Owner(ticket) => {
                self.approval
                    .validate(&ticket, deal.id, deal.terms.hash()?, attempt, now)?;
                Ok(DecidedBy::Human { at: ticket.at })
            }
            Authority::Policy if decision == MandateDecision::Allow => {
                Ok(DecidedBy::Policy { clause: 6 })
            }
            Authority::SellerMandate
                if deal.side == Side::Seller
                    && matches!(deal.state, DealState::Approved | DealState::Authorized) =>
            {
                let m = self.wallet.ledger.active_mandate(
                    deal.mandate_id,
                    deal.mandate_version,
                    &self.wallet.owner,
                )?;
                Ok(DecidedBy::SellerMandate {
                    mandate_hash: m.payload.hash()?,
                })
            }
            _ => Err(Error::Permission),
        }
    }
    pub(crate) fn countersign(
        &mut self,
        deal: &Deal,
        attempt: u8,
        decision: &DecidedBy,
        now: Timestamp,
    ) -> Result<(), Error> {
        if self.wallet.ledger.has_countersign(deal.id, attempt)? {
            return Ok(());
        }
        let m = self.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.wallet.owner,
        )?;
        let payee = self.wallet.settlement_payee(deal)?;
        let mut c = ClosedMandate {
            deal_id: deal.id,
            open_mandate_hash: m.payload.hash()?,
            terms_hash: deal.terms.hash()?,
            amount: deal.terms.amount()?,
            payee,
            invoice_id: invoice_id(deal.id, attempt)?,
            decided_by: decision.clone(),
            agent_sig: Vec::new(),
        };
        c.agent_sig = self.wallet.signer.sign_closed(&c)?;
        self.wallet.ledger.countersign(&c, attempt, now)?;
        Ok(())
    }
    /// Read-only: whether `create`, `authorize` or `capture` under `authority` would pass the
    /// checks it runs before its first write and its PayPal call, at `now`. It calls no PayPal,
    /// writes nothing, and runs the same `authority()` and `shield()` the step runs, so the
    /// walk-away forecast never copies their rules. The attempt is the one the scheduler passes.
    ///
    /// With `reached`, the deal is judged as if it already stood in the step's entry state, and
    /// the ledger checks the earlier steps satisfy on the way (attempt, countersign, capture
    /// deadline) are skipped: the forecast asks whether authorize would still pass if the buyer
    /// approved at a later `now`.
    ///
    /// A refusal is `Ok(false)`; a failed ledger read is an error. Owner tickets are checked
    /// only where they are spent, so `Authority::Owner` is refused here.
    pub fn step_allowed(
        &mut self,
        id: DealId,
        step: MoneyStep,
        category: Category,
        authority: Authority,
        now: Timestamp,
        reached: bool,
    ) -> Result<bool, Error> {
        if matches!(authority, Authority::Owner(_)) {
            return Err(Error::Permission);
        }
        let mut deal = self.wallet.ledger.get_deal(id)?;
        let entry = match step {
            MoneyStep::Create => DealState::Agreed,
            MoneyStep::Authorize => DealState::Approved,
            MoneyStep::Capture => DealState::Authorized,
        };
        if reached {
            deal.state = entry;
        }
        if deal.state != entry || deal.mode == Mode::Replay || self.has_open_operation(id)? {
            return Ok(false);
        }
        let attempt = match step {
            MoneyStep::Create => 1,
            MoneyStep::Authorize | MoneyStep::Capture => self.wallet.ledger.settled_attempt(id)?,
        };
        let gate = (|| -> Result<bool, Error> {
            let decision = self.authority(&deal, category, authority, attempt, now)?;
            if !shield_allows(self.shield(&deal, now)?, &decision, step) {
                return Ok(false);
            }
            match step {
                MoneyStep::Create => {
                    self.expected(&deal, attempt)?
                        .body()
                        .map_err(|_| Error::Invalid)?;
                }
                MoneyStep::Capture if !reached => {
                    if !self.capture_window_open(id, attempt, now)? {
                        return Ok(false);
                    }
                }
                MoneyStep::Authorize | MoneyStep::Capture => {}
            }
            Ok(true)
        })();
        match gate {
            Err(Error::Ledger(
                table_ledger::LedgerError::Sql(_)
                | table_ledger::LedgerError::Json(_)
                | table_ledger::LedgerError::Integrity(_),
            )) => gate,
            Err(_) => Ok(false),
            ok => ok,
        }
    }
    pub(crate) fn calls(
        &self,
        id: DealId,
        observations: &[Observation],
        now: Timestamp,
    ) -> Result<Vec<PaypalCall>, Error> {
        observations
            .iter()
            .map(|o| {
                Ok(PaypalCall {
                    deal_id: id,
                    method: if o.method == "GET" {
                        HttpMethod::Get
                    } else {
                        HttpMethod::Post
                    },
                    // Typed clients own query construction. The ledger stores only the
                    // allowlisted resource path; filter provenance is audited by the caller.
                    path: PaypalPath::new(o.path.split('?').next().unwrap_or("").to_owned())?,
                    request_id: if o.request_id.is_empty() {
                        format!("{id}-poll")
                    } else {
                        o.request_id.clone()
                    },
                    status: o.status,
                    debug_id: o
                        .body
                        .get("debug_id")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned),
                    response: o.body.clone(),
                    binding: o.binding.clone(),
                    at: now,
                })
            })
            .collect()
    }
    pub(crate) fn complete(
        &mut self,
        deal: &Deal,
        attempt: u8,
        completion: Completion<'_>,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.wallet.ledger.finish_operation(OperationOutcome {
            id: deal.id,
            attempt,
            operation: completion.operation,
            calls: &self.calls(deal.id, completion.observations, now)?,
            refs: completion.refs,
            event: completion.event,
            at: now,
        })?;
        Ok(())
    }
    /// Applies every due deadline default. One deal's failure (an unknown void) never starves
    /// the deals after it; the first error is returned once all of them were attempted.
    pub async fn tick(&mut self, now: Timestamp) -> Result<Vec<DealId>, Error> {
        let mut changed = Vec::new();
        let mut failure = None;
        for deal in self.wallet.ledger.list_deals()? {
            // A rescue's invoice is real even when its failure was replayed: it is polled and
            // its deadline applied whatever the mode (rescue.rs).
            if deal.kind == DealKind::Rescue {
                match self.rescue_tick(deal.id, now).await {
                    Ok(true) => changed.push(deal.id),
                    Ok(false) => {}
                    Err(error) => {
                        failure.get_or_insert(error);
                    }
                }
                continue;
            }
            if deal.mode == Mode::Replay {
                continue;
            }
            match self.deadline_default(deal.id, now).await {
                Ok(true) => changed.push(deal.id),
                Ok(false) => {}
                Err(error) => {
                    failure.get_or_insert(error);
                }
            }
        }
        failure.map_or(Ok(changed), Err)
    }
    /// Whether the deal's open operations are all a parked (owner-pending) capture or void, and
    /// at least one is open.
    fn only_parked_money_open(&self, id: DealId) -> Result<bool, Error> {
        let open = self
            .wallet
            .ledger
            .open_operations(Some(id), Timestamp::MAX)?;
        Ok(!open.is_empty()
            && open
                .iter()
                .all(|op| op.needs_owner && matches!(op.operation, "capture" | "void")))
    }
    /// The deadline default for one deal, if its deadline is due: auto-void an authorization,
    /// let any earlier state lapse. A money step whose outcome is unknown is read back first, a
    /// parked one included; while it stays unknown nothing is sent (no void after a capture that
    /// may have gone through), and only an order creation whose payment link never left the
    /// wallet lapses with its deal. An authorize still open (too young to read back, unreadable,
    /// or showing what no check accepts) keeps the deal from expiring: `Unavailable`. A read that
    /// shows something is made again on the next tick; a read that fails is not: the next waits
    /// out a capped exponential backoff with jitter (never under `RESCUE_POLL_SECS`), then comes
    /// once per `PARKED_READ_SECS` after `RESCUE_READ_ATTEMPTS` failures in a row, and none comes
    /// on the wallet's own initiative `PARKED_READ_WINDOW_SECS` past the deadline (the deal stays
    /// APPROVED and needs the owner; DECISIONS 52). A failed read ends, voids and sends nothing.
    /// One showing what no check accepts
    /// [`table_ledger::UNREAD_AUTHORIZE_SECS`] after its first attempt ends the deal in the
    /// read-back itself, and nothing is sent. An AUTHORIZED deal whose only open operations are
    /// a parked capture or void that the read-back could not settle (PayPal shows a status no
    /// check accepts, a different id or amount, or the read failed) answers `Ok(false)`: no end
    /// state is true, so the deal stays AUTHORIZED, nothing is sent, and the owner's money-check
    /// card already says to look in PayPal. Any other open operation keeps `Unavailable`. A lost
    /// capture or void whose read fails backs off and is read hourly the same way, and is not
    /// read on the wallet's own initiative `PARKED_READ_WINDOW_SECS` past the deadline
    /// (DECISIONS 52b): the default then answers as above without calling PayPal, nothing is
    /// voided or captured, and the deal keeps its state.
    /// After it the deal's read-schedule entries that no longer govern a read are dropped, all
    /// of them once it is terminal (`prune_read_state`).
    pub async fn deadline_default(&mut self, id: DealId, now: Timestamp) -> Result<bool, Error> {
        let result = self.deadline_default_once(id, now).await;
        self.prune_read_state(id, now)?;
        result
    }
    async fn deadline_default_once(&mut self, id: DealId, now: Timestamp) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.kind == DealKind::Rescue {
            return self.rescue_deadline(id, now).await;
        }
        // A HOUSE-paired buyer deal out for approval waits a grace past its deadline for the
        // HOUSE's RECEIPT (table-ledger `lapse_at`); every other deal lapses at its deadline.
        let Some(due) = self.wallet.ledger.lapse_at(id)? else {
            return Ok(false);
        };
        if due > now || deal.state.terminal() || deal.mode == Mode::Replay {
            return Ok(false);
        }
        let mut deal = deal;
        // An unknown authorize or capture is read back before the default voids or expires: a
        // hold PayPal placed is voided, not forgotten behind an EXPIRED deal.
        if deal.state.pre_capture() && deal.state != DealState::Authorized {
            self.resolve_deal(id, Resolve::Deadline, now).await?;
            deal = self.wallet.ledger.get_deal(id)?;
            if self
                .wallet
                .ledger
                .deadline(id)?
                .is_none_or(|(due, _)| due > now)
            {
                return Ok(true);
            }
            // The read-back ended the deal over an authorize PayPal never showed in a form a
            // check accepts (`end_unread_authorize`).
            if deal.state.terminal() {
                return Ok(true);
            }
            // PayPal may hold money for an authorize not yet settled: the deal does not expire
            // over it (the ledger refuses that too).
            if self
                .wallet
                .ledger
                .open_operations(Some(id), Timestamp::MAX)?
                .iter()
                .any(|op| op.operation == "authorize")
            {
                return Err(Error::Unavailable);
            }
        }
        if deal.state == DealState::Authorized {
            let attempt = self.wallet.ledger.settled_attempt(id)?;
            match self.auto_void(id, attempt, now).await {
                Err(Error::Unavailable) if self.only_parked_money_open(id)? => return Ok(false),
                result => result?,
            }
        } else if deal.state.pre_capture() {
            self.wallet.ledger.apply_deadline_default(id, now)?;
        } else {
            return Ok(false);
        }
        Ok(true)
    }
}
