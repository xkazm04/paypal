use crate::{ApprovalSession, Error, OwnerTicket, Wallet};
use std::sync::Arc;
use table_core::*;
use table_ledger::{HttpMethod, OperationOutcome, PaypalCall, PaypalPath};
use table_paypal::{CreateOrder, Observation, OrderStatus, PayPalApi, RequestId, ResourceId};
use table_proto::{Body, ShortText};
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
    /// The owner paused all agents: the read-back resolver sends nothing again under the
    /// clause-6 policy, exactly as the scheduler starts no create under it (T10).
    pub policy_paused: bool,
    /// The deal being ticked has no agent key to sign with (its mandate was revoked, or the key is
    /// gone). The read-back resolver then settles only what needs no signature (a void, a step
    /// PayPal shows not done) and sends nothing again but a void; a capture or a paid invoice
    /// PayPal confirms waits for the key, since its receipt is signed. The deadline's safe default
    /// still applies. Set by the runtime around one deal's tick, and cleared after it.
    pub signer_missing: bool,
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
        self.approval
            .validate(&ticket, id, deal.terms.hash()?, attempt, now)?;
        self.wallet.ledger.release_shield_hold(id, now)?;
        Ok(())
    }

    /// Retrieve the bound SETTLE, rechecking truth and mode before handing off to a browser.
    pub fn approval_link(&self, id: DealId, attempt: u8) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::AwaitingApproval
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || deal.mode == Mode::Replay
            || deal.shield.is_some_and(|v| v >= ShieldVerdict::Hold)
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
        if deal.state == DealState::Authorized
            && deal.shield.is_some_and(|v| v >= ShieldVerdict::Hold)
        {
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
            approval: ApprovalSession::new(now)?,
            policy_paused: false,
            signer_missing: false,
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
    pub(crate) fn shield(&self, deal: &Deal, now: Timestamp) -> Result<ShieldVerdict, Error> {
        // A rescue asks the owner's own subscriber to pay the owner: the payee, price and new-
        // counterparty rules guard money going out, so only a verdict raised on the deal applies.
        if deal.kind == DealKind::Rescue {
            return Ok(deal.shield.unwrap_or(ShieldVerdict::Clear));
        }
        let payee = self.wallet.settlement_payee(deal)?;
        if deal.shield.is_some_and(|v| v >= ShieldVerdict::Hold) {
            return Ok(deal.shield.unwrap_or(ShieldVerdict::Hold));
        }
        let rules = table_shield::rules(
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
        Ok(table_shield::combine(rules, deal.shield))
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
        if !shield_allows(self.shield(&deal, now)?, &decision, MoneyStep::Create) {
            return Err(Error::Permission);
        }
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
        if response.value.verify(expected).is_err() || response.value.status != OrderStatus::Created
        {
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
        }
        let url = match response
            .value
            .approval_url()
            .ok()
            .and_then(|url| table_proto::approval_url(url.as_str(), deal.mode).ok())
        {
            Some(url) => url,
            None => {
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
            }
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
        self.wallet
            .ledger
            .set_deadline(id, created_from.saturating_add(6 * 3600), None, now)?;
        let updated = self.wallet.ledger.get_deal(id)?;
        let envelope = self.wallet.signed(
            &updated,
            Body::Settle {
                order_id: ShortText::new(response.value.id)?,
                approve_url: ShortText::new(url.as_str().into())?,
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
        if r.value.id != order.as_str() || r.value.verify(&self.expected(&deal, attempt)?).is_err()
        {
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
        if !shield_allows(self.shield(&deal, now)?, &decision, MoneyStep::Authorize) {
            return Err(Error::Permission);
        }
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
        let authorization = r
            .value
            .purchase_units
            .first()
            .and_then(|u| u.payments.authorizations.first());
        let valid = r.value.id == resource.as_str()
            && r.value.status == OrderStatus::Completed
            && r.value.verify(&self.expected(&deal, attempt)?).is_ok()
            && r.value.purchase_units[0].payments.authorizations.len() == 1
            && authorization.is_some_and(|a| {
                a.status == "CREATED"
                    && a.amount.money().ok() == deal.terms.amount().ok()
                    && ResourceId::new(&a.id).is_ok()
            });
        let mut refs = deal.paypal.clone();
        if valid {
            refs.authorization = authorization.map(|a| a.id.clone());
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
        if !shield_allows(self.shield(&deal, now)?, &decision, MoneyStep::Capture) {
            return Err(Error::Permission);
        }
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
        let valid = r.value.status == "COMPLETED"
            && r.value.amount.money().ok() == Some(deal.terms.amount()?)
            && ResourceId::new(&r.value.id).is_ok();
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
        self.issue_receipt(id, r.value.id, now)
    }
    /// Sign and record the receipt for a capture PayPal confirmed, and move the deal to RECEIPTED.
    pub(crate) fn issue_receipt(
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
    pub async fn auto_void(
        &mut self,
        id: DealId,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        // A void is never sent while an earlier money step's outcome is unknown: a capture that
        // went through cannot be voided, and the books would say held while PayPal says paid.
        // The open step is read back first; while it stays open, nothing more is sent.
        if self.has_open_operation(id)? {
            self.resolve(id, None, now).await?;
            if self.has_open_operation(id)?
                || self.wallet.ledger.get_deal(id)?.state != DealState::Authorized
            {
                return Ok(());
            }
        }
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Invalid);
        }
        let due = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?.0;
        let held = deal.shield.is_some_and(|v| v >= ShieldVerdict::Hold);
        if now < due && !held {
            return Err(Error::Permission);
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
        // Unknown money outcomes are read back first (T10), each on its own backoff.
        match self.resolve_due(now).await {
            Ok(done) => changed.extend(done.into_iter().map(|(id, _)| id)),
            Err(error) => failure = Some(error),
        }
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
        let Some((due, _)) = self.wallet.ledger.deadline(id)? else {
            return Ok(false);
        };
        if due > now || deal.state.terminal() || deal.mode == Mode::Replay {
            return Ok(false);
        }
        if self.has_open_operation(id)? {
            self.resolve(id, None, now).await?;
            let deal = self.wallet.ledger.get_deal(id)?;
            if let Some(open) = self.wallet.ledger.open_operations(Some(id))?.first() {
                if open.operation == "create" && deal.state == DealState::Settling {
                    // The answer carrying the order and its approval link never arrived, so no
                    // one was ever sent a link to approve: the deal lapses and no money moves.
                    self.wallet.ledger.close_operation(
                        id,
                        open.attempt,
                        "create",
                        table_ledger::CheckReason::Lapsed,
                        now,
                    )?;
                    self.wallet.ledger.apply_deadline_default(id, now)?;
                    return Ok(true);
                }
                return Ok(false);
            }
            if deal.state.terminal() {
                return Ok(true);
            }
        }
        let deal = self.wallet.ledger.get_deal(id)?;
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
