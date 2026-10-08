use crate::{ApprovalSession, Error, OwnerTicket, Wallet};
use std::sync::Arc;
use table_core::*;
use table_ledger::{HttpMethod, OperationOutcome, PaypalCall, PaypalPath};
use table_paypal::{
    CreateOrder, Observation, Order, OrderStatus, PayPalApi, Payment, RequestId, ResourceId,
};
use table_proto::{Body, ShortText};
mod resolve;
pub(crate) use resolve::REQUEST_ID_KEPT_SECS;
pub use resolve::{PENDING_STALE_SECS, Resolve, SETTLE_SECS};
#[derive(Debug)]
pub enum Authority {
    Policy,
    SellerMandate,
    HouseMandate,
    Owner(OwnerTicket),
}
/// The money step a [`Pipeline::step_allowed`] check stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoneyStep {
    Create,
    Authorize,
    Capture,
}
impl MoneyStep {
    /// The operation name the ledger and the audit log use for this step.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Authorize => "authorize",
            Self::Capture => "capture",
        }
    }
}
/// What the scam shield says about a deal at a time, and why (shield slice 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShieldGate {
    /// The verdict before any release: what the deal row records.
    pub verdict: ShieldVerdict,
    /// The rule that decided `verdict`; `None` for a CLEAR and for a hold with no named rule.
    pub rule: Option<ShieldRule>,
    /// The verdict is a HOLD the owner released for the deal's current terms, and the release
    /// names every rule holding it. The money steps then judge it as ASK: the owner's decisions
    /// and the seller's money in pass, a clause-6 policy step still waits for the owner.
    pub released: bool,
}
impl ShieldGate {
    /// The verdict the money steps are judged by.
    pub const fn gating(&self) -> ShieldVerdict {
        if self.released {
            ShieldVerdict::Ask
        } else {
            self.verdict
        }
    }
}
/// One input to the shield's verdict: what the rules computed now, or what the deal row keeps.
#[derive(Debug, Clone, Copy)]
struct ShieldSource {
    verdict: ShieldVerdict,
    rule: Option<ShieldRule>,
}
/// Whether a recorded verdict still binds the deal whatever the rules say now. A raised verdict
/// (a second opinion, the order check's payee BLOCK, a settlement mismatch) and any HOLD or BLOCK
/// do; an ASK the rules computed (no market reference, a new counterparty) is judged again, so
/// a market price that lands later can clear it.
fn binds(verdict: ShieldVerdict, rule: Option<ShieldRule>) -> bool {
    verdict >= ShieldVerdict::Hold
        || !matches!(
            rule,
            Some(ShieldRule::NoMarketReference | ShieldRule::NewCounterpartyOverThreshold)
        )
}
/// The scam shield's gate on a money step, shared by `create`, `authorize`, `capture` and
/// [`Pipeline::step_allowed`] so their copies cannot drift. HOLD and BLOCK stop every step under
/// every authority. ASK passes the owner's decision and the house release everywhere, and the
/// seller mandate only on authorize and capture: `authority()` grants that mandate only on a
/// seller deal whose order the buyer already approved at PayPal, and receiving money on it
/// needs no click (acceptance H5). Every other ASK, including the seller's create on policy,
/// still waits for the owner.
pub(crate) fn shield_allows(shield: ShieldVerdict, decision: &DecidedBy, step: MoneyStep) -> bool {
    match shield {
        ShieldVerdict::Clear => true,
        ShieldVerdict::Ask => match decision {
            DecidedBy::Human { .. } | DecidedBy::HouseMandate { .. } => true,
            DecidedBy::SellerMandate { .. } => {
                matches!(step, MoneyStep::Authorize | MoneyStep::Capture)
            }
            DecidedBy::Policy { .. } | DecidedBy::SafeDefault { .. } => false,
        },
        ShieldVerdict::Hold | ShieldVerdict::Block => false,
    }
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
    /// When each rescue invoice was last read, so PAID is polled on a cadence.
    pub(crate) rescue_polled: std::collections::BTreeMap<DealId, Timestamp>,
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
                "void",
                &r.observations,
                &deal.paypal,
                Some(event),
                now,
            ),
            Err(e) => {
                self.complete(
                    deal,
                    attempt,
                    "void",
                    e.observations(),
                    &deal.paypal,
                    None,
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
    /// The shield's inputs for `deal` at `now`: what the deal row keeps, if it still binds the
    /// deal (first), and what the deterministic rules compute now. A BLOCK kept on the deal is
    /// final, so the rules are not consulted (`table_shield::evaluate`'s order).
    fn shield_sources(&self, deal: &Deal, now: Timestamp) -> Result<Vec<ShieldSource>, Error> {
        let kept = deal
            .shield_recorded()
            .filter(|v| binds(*v, deal.shield_rule))
            .map(|verdict| ShieldSource {
                verdict,
                rule: deal.shield_rule,
            });
        // A rescue asks the owner's own subscriber to pay the owner: the payee, price and new-
        // counterparty rules guard money going out, so only a verdict raised on the deal applies.
        if deal.kind == DealKind::Rescue {
            return Ok(vec![kept.unwrap_or(ShieldSource {
                verdict: ShieldVerdict::Clear,
                rule: None,
            })]);
        }
        let payee = self.wallet.settlement_payee(deal)?;
        if let Some(block) = kept.filter(|k| k.verdict == ShieldVerdict::Block) {
            return Ok(vec![block]);
        }
        let found = table_shield::explain(
            &table_shield::Case {
                expected_payee: &payee,
                actual_payee: &payee,
                friends_and_family: false,
                amount: deal.terms.amount()?,
                unit_price: deal.terms.unit_price,
                // The 40% rule runs on any reference; only a fresh one can clear the deal.
                market: deal.market.as_ref(),
                market_fresh: market_fresh(deal.market.as_ref(), now),
                first_seen: self
                    .wallet
                    .ledger
                    .counterparty_first_seen(&deal.counterparty)?,
                new_counterparty_threshold: Money::new(10000, deal.terms.currency)
                    .map_err(DomainError::from)?,
            },
            now,
        )?;
        let mut sources: Vec<ShieldSource> = kept.into_iter().collect();
        sources.push(ShieldSource {
            verdict: found.verdict,
            rule: found.rule,
        });
        Ok(sources)
    }
    /// The verdict is the most cautious input (a kept verdict can only add caution, as
    /// `table_shield::combine`). Its rule is a kept one's before a computed one's, and one the
    /// owner has not released before one they have. The release counts only when it names the
    /// rule of every input that holds.
    fn judge(deal: &Deal, sources: &[ShieldSource]) -> ShieldGate {
        let verdict = sources
            .iter()
            .map(|s| s.verdict)
            .max()
            .unwrap_or(ShieldVerdict::Clear);
        let covered = |s: &ShieldSource| {
            deal.shield_release
                .as_ref()
                .is_some_and(|r| r.covers(s.rule))
        };
        let top = || sources.iter().filter(|s| s.verdict == verdict);
        let released = verdict == ShieldVerdict::Hold && top().all(covered);
        let rule = top()
            .find(|s| !covered(s))
            .or_else(|| top().next())
            .and_then(|s| s.rule);
        ShieldGate {
            verdict,
            rule,
            released,
        }
    }
    /// What the shield says about `deal` at `now` and why, without recording it.
    pub fn shield_gate(&self, deal: &Deal, now: Timestamp) -> Result<ShieldGate, Error> {
        Ok(Self::judge(deal, &self.shield_sources(deal, now)?))
    }
    pub(crate) fn shield(&self, deal: &Deal, now: Timestamp) -> Result<ShieldVerdict, Error> {
        Ok(self.shield_gate(deal, now)?.gating())
    }
    /// The scam shield's gate on a real money step (shield slice 2): judges the step, records the
    /// verdict and its rule in the deal row (only when they changed), and on a refusal records it
    /// once per (deal, step, verdict) and refuses before any operation, countersign or PayPal call.
    fn shield_step(
        &mut self,
        deal: &Deal,
        decision: &DecidedBy,
        step: MoneyStep,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        let gate = self.shield_gate(deal, now)?;
        self.wallet.ledger.record_shield(
            deal.id,
            gate.verdict,
            gate.rule,
            deal.terms.hash()?,
            now,
        )?;
        if shield_allows(gate.gating(), decision, step) {
            return Ok(());
        }
        self.wallet.ledger.record_shield_refusal(
            deal.id,
            step.name(),
            attempt,
            gate.gating(),
            gate.rule,
            decision,
            now,
        )?;
        self.shield_refused = Some(deal.id);
        Err(Error::Permission)
    }
    /// Read-only: the scam shield verdict the money steps would judge this deal by at `now`.
    pub fn shield_verdict(&self, id: DealId, now: Timestamp) -> Result<ShieldVerdict, Error> {
        self.shield(&self.wallet.ledger.get_deal(id)?, now)
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
                    let deadline = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?;
                    if now >= deadline.0 || !self.wallet.ledger.has_countersign(id, attempt)? {
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
    #[allow(clippy::too_many_arguments)] // Private helper mirrors the typed ledger outcome.
    pub(crate) fn complete(
        &mut self,
        deal: &Deal,
        attempt: u8,
        operation: &str,
        observations: &[Observation],
        refs: &PaypalRefs,
        event: Option<DealEvent>,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.wallet.ledger.finish_operation(OperationOutcome {
            id: deal.id,
            attempt,
            operation,
            calls: &self.calls(deal.id, observations, now)?,
            refs,
            event,
            at: now,
        })?;
        Ok(())
    }
    pub async fn create(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Agreed
            || deal.mode == Mode::Replay
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Create, attempt, now)?;
        let expected = self.expected(&deal, attempt)?;
        expected.body().map_err(|_| Error::Invalid)?;
        self.countersign(&deal, attempt, &decision, now)?;
        let request =
            RequestId::for_operation(id, attempt, "create").map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "create",
            request.as_str(),
            &decision,
            now,
        )?;
        self.wallet
            .ledger
            .apply_event(id, DealEvent::BeginSettlement, now)?;
        self.send_create(&deal, attempt, &expected, &request, now, now)
            .await
    }
    /// Send the create reserved under `request` and finish its operation with PayPal's answer.
    /// The approval deadline runs from `created_from`: the reservation time on a re-send, so it
    /// never outlasts PayPal's own window for an order that may be older than this answer.
    pub(crate) async fn send_create(
        &mut self,
        deal: &Deal,
        attempt: u8,
        expected: &CreateOrder,
        request: &RequestId,
        created_from: Timestamp,
        now: Timestamp,
    ) -> Result<String, Error> {
        let id = deal.id;
        let deal = deal.clone();
        let response = match self.api.create_order(expected, request).await {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    "create",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let mut refs = deal.paypal.clone();
        refs.order = Some(response.value.id.clone());
        let Some(url) = self.created_link(&deal, expected, &response.value) else {
            self.raise_payee_mismatch(&deal, &response.value, expected, now)?;
            self.complete(
                &deal,
                attempt,
                "create",
                &response.observations,
                &refs,
                Some(DealEvent::Mismatch),
                now,
            )?;
            return Err(Error::Invalid);
        };
        self.complete(
            &deal,
            attempt,
            "create",
            &response.observations,
            &refs,
            Some(DealEvent::SettleVerified),
            now,
        )?;
        self.send_settle(
            id,
            attempt,
            response.value.id,
            &url,
            expected,
            created_from,
            now,
        )
    }
    /// The verified approval link of a freshly created order, or `None` when it fails the
    /// truth checks `create` runs: the order binding, status CREATED and one PayPal-host link.
    fn created_link(&self, deal: &Deal, expected: &CreateOrder, order: &Order) -> Option<String> {
        if order.verify(expected).is_err() || order.status != OrderStatus::Created {
            return None;
        }
        order
            .approval_url()
            .ok()
            .and_then(|url| table_proto::approval_url(url.as_str(), deal.mode).ok())
            .map(|url| url.as_str().to_owned())
    }
    /// Starts the approval window at `created` and signs and records the SETTLE to the buyer.
    #[allow(clippy::too_many_arguments)] // Private helper shared by create and its resolver.
    fn send_settle(
        &mut self,
        id: DealId,
        attempt: u8,
        order_id: String,
        url: &str,
        expected: &CreateOrder,
        created: Timestamp,
        now: Timestamp,
    ) -> Result<String, Error> {
        // The HOUSE pipeline (its release-pinned authority is installed) lets an unapproved
        // order lapse sooner, so an abandoned table frees its slot (HOUSE_APPROVAL_SECS).
        let window = if self.house.is_some() {
            HOUSE_APPROVAL_SECS
        } else {
            ORDER_APPROVAL_SECS
        };
        self.wallet
            .ledger
            .set_deadline(id, created.saturating_add(window), None, now)?;
        let updated = self.wallet.ledger.get_deal(id)?;
        let envelope = self.wallet.signed(
            &updated,
            Body::Settle {
                order_id: ShortText::new(order_id)?,
                approve_url: ShortText::new(url.into())?,
                amount: expected.amount,
                invoice_id: ShortText::new(invoice_id(id, attempt)?)?,
                intent: table_proto::Intent::Authorize,
                attempt,
            },
            now,
        )?;
        self.wallet.ledger.record_outbound(&envelope, now)?;
        Ok(envelope.raw().into())
    }
    /// The authorization id an authorize answer proves, or `None`: the order is the one
    /// authorized, COMPLETED, bound to the deal, and holds exactly one CREATED authorization
    /// of the deal's amount.
    fn verified_authorization(
        &self,
        deal: &Deal,
        attempt: u8,
        order_id: &str,
        order: &Order,
    ) -> Result<Option<String>, Error> {
        let authorization = order
            .purchase_units
            .first()
            .and_then(|u| u.payments.authorizations.first());
        let valid = order.id == order_id
            && order.status == OrderStatus::Completed
            && order.verify(&self.recorded_order(deal, attempt)?).is_ok()
            && order.purchase_units[0].payments.authorizations.len() == 1
            && authorization.is_some_and(|a| {
                a.status == "CREATED"
                    && a.amount.money().ok() == deal.terms.amount().ok()
                    && ResourceId::new(&a.id).is_ok()
            });
        Ok(authorization.filter(|_| valid).map(|a| a.id.clone()))
    }
    /// A capture answer proves the capture: COMPLETED, the deal's amount, a well-formed id.
    fn verified_capture(deal: &Deal, payment: &Payment) -> Result<bool, Error> {
        Ok(payment.status == "COMPLETED"
            && payment.amount.money().ok() == Some(deal.terms.amount()?)
            && ResourceId::new(&payment.id).is_ok())
    }
    /// Signs and records the receipt of a confirmed capture and moves the deal to RECEIPTED.
    fn send_receipt(
        &mut self,
        id: DealId,
        capture_id: String,
        now: Timestamp,
    ) -> Result<String, Error> {
        let updated = self.wallet.ledger.get_deal(id)?;
        let receipt = self.wallet.signed(
            &updated,
            Body::Receipt {
                capture_id: ShortText::new(capture_id)?,
                amount: updated.terms.amount()?,
                status: table_proto::ReceiptStatus::Completed,
                transcript_head: updated.transcript_head,
            },
            now,
        )?;
        self.wallet.ledger.record_outbound(&receipt, now)?;
        self.wallet.ledger.record_receipt(&receipt, now)?;
        self.wallet
            .ledger
            .apply_event(id, DealEvent::ReceiptVerified, now)?;
        Ok(receipt.raw().into())
    }
    /// The order check's half of the payee rule: an order PayPal shows paying another payee than
    /// the agreed one is a scam shield BLOCK on the deal (rule `payee_mismatch`), raised before the
    /// deal enters MISMATCH. It reads only PayPal's typed payee field, never a counterparty's words.
    fn raise_payee_mismatch(
        &mut self,
        deal: &Deal,
        order: &table_paypal::Order,
        expected: &CreateOrder,
        now: Timestamp,
    ) -> Result<(), Error> {
        let other = order
            .purchase_units
            .iter()
            .any(|u| u.payee.merchant_id != expected.merchant_id.as_str());
        if other {
            self.wallet.ledger.raise_shield_for(
                deal.id,
                ShieldVerdict::Block,
                ShieldRule::PayeeMismatch,
                now,
            )?;
        }
        Ok(())
    }
    pub async fn poll_approval(
        &mut self,
        id: DealId,
        attempt: u8,
        now: Timestamp,
    ) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::AwaitingApproval
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Invalid);
        }
        let order = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        let r = match self.api.get_order(&order).await {
            Ok(response) => response,
            Err(error) => {
                for call in self.calls(id, error.observations(), now)? {
                    self.wallet.ledger.record_paypal_call(&call, &[])?;
                }
                return Err(Error::Unavailable);
            }
        };
        for call in self.calls(id, &r.observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        let expected = self.expected(&deal, attempt)?;
        if r.value.id != order.as_str() || r.value.verify(&expected).is_err() {
            self.raise_payee_mismatch(&deal, &r.value, &expected, now)?;
            self.wallet
                .ledger
                .apply_event(id, DealEvent::Mismatch, now)?;
            return Err(Error::Invalid);
        }
        if r.value.status == OrderStatus::Approved {
            self.wallet
                .ledger
                .apply_event(id, DealEvent::OrderApproved, now)?;
            return Ok(true);
        }
        Ok(false)
    }
    pub async fn authorize(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Approved
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Authorize, attempt, now)?;
        self.countersign(&deal, attempt, &decision, now)?;
        let request =
            RequestId::for_operation(id, attempt, "authorize").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "authorize",
            request.as_str(),
            &decision,
            now,
        )?;
        self.send_authorize(&deal, attempt, &resource, &request, now)
            .await
    }
    /// Send the authorize reserved under `request` and finish its operation with PayPal's answer.
    pub(crate) async fn send_authorize(
        &mut self,
        deal: &Deal,
        attempt: u8,
        resource: &ResourceId,
        request: &RequestId,
        now: Timestamp,
    ) -> Result<(), Error> {
        let id = deal.id;
        let deal = deal.clone();
        let r = match self.api.authorize(resource, request).await {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    "authorize",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let authorization =
            self.verified_authorization(&deal, attempt, resource.as_str(), &r.value)?;
        let valid = authorization.is_some();
        let mut refs = deal.paypal.clone();
        if valid {
            refs.authorization = authorization;
        }
        self.complete(
            &deal,
            attempt,
            "authorize",
            &r.observations,
            &refs,
            if valid {
                Some(DealEvent::AuthorizationConfirmed)
            } else {
                None
            },
            now,
        )?;
        if !valid {
            return Err(Error::Invalid);
        }
        self.wallet
            .ledger
            .set_deadline(id, now.saturating_add(72 * 3600), Some(now), now)?;
        Ok(())
    }
    pub async fn capture(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Capture, attempt, now)?;
        let deadline = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?;
        if now >= deadline.0 {
            return Err(Error::Permission);
        }
        if !self.wallet.ledger.has_countersign(id, attempt)? {
            return Err(Error::Permission);
        }
        let request =
            RequestId::for_operation(id, attempt, "capture").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.authorization.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "capture",
            request.as_str(),
            &decision,
            now,
        )?;
        self.send_capture(&deal, attempt, &resource, &request, now)
            .await
    }
    /// Send the capture reserved under `request` and finish its operation with PayPal's answer;
    /// a confirmed capture signs and records the receipt.
    pub(crate) async fn send_capture(
        &mut self,
        deal: &Deal,
        attempt: u8,
        resource: &ResourceId,
        request: &RequestId,
        now: Timestamp,
    ) -> Result<String, Error> {
        let id = deal.id;
        let deal = deal.clone();
        let r = match self
            .api
            .capture(resource, deal.terms.amount()?, request)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    "capture",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let valid = Self::verified_capture(&deal, &r.value)?;
        let mut refs = deal.paypal.clone();
        if valid {
            refs.capture = Some(r.value.id.clone());
        }
        self.complete(
            &deal,
            attempt,
            "capture",
            &r.observations,
            &refs,
            if valid {
                Some(DealEvent::CaptureConfirmed)
            } else {
                None
            },
            now,
        )?;
        if !valid {
            return Err(Error::Invalid);
        }
        self.send_receipt(id, r.value.id, now)
    }
    pub async fn auto_void(
        &mut self,
        id: DealId,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Invalid);
        }
        let due = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?.0;
        let held = deal.shield_held();
        if now < due && !held {
            return Err(Error::Permission);
        }
        // An authorize or capture whose outcome is unknown is read back first, and a void left
        // unknown is settled (or sent once more) instead of reserved again. A capture PayPal
        // shows committed is confirmed and no void is sent; one still unknown, or a read-back
        // that failed, leaves the hold in place this tick, which moves no money.
        if !self.resolve_deal(id, Resolve::Deadline, now).await? {
            return Err(Error::Unavailable);
        }
        if self.wallet.ledger.get_deal(id)?.state != DealState::Authorized {
            return Ok(());
        }
        let authority = DecidedBy::SafeDefault {
            deadline: if held { now } else { due },
        };
        let request = RequestId::for_operation(id, attempt, "void").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.authorization.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "void",
            request.as_str(),
            &authority,
            now,
        )?;
        let event = if held {
            DealEvent::Void
        } else {
            DealEvent::AutoVoid
        };
        self.send_void(&deal, attempt, &resource, &request, event, now)
            .await
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
    /// The deadline default for one deal, if its deadline is due: auto-void an authorization,
    /// let any earlier state lapse. A money step whose outcome is unknown is read back first; while
    /// it stays unknown nothing is sent (no void after a capture that may have gone through), and
    /// only an order creation whose payment link never left the wallet lapses with its deal.
    pub async fn deadline_default(&mut self, id: DealId, now: Timestamp) -> Result<bool, Error> {
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
        }
        if deal.state == DealState::Authorized {
            self.auto_void(id, self.wallet.ledger.settled_attempt(id)?, now)
                .await?;
        } else if deal.state.pre_capture() {
            self.wallet.ledger.apply_deadline_default(id, now)?;
        } else {
            return Ok(false);
        }
        Ok(true)
    }
}
