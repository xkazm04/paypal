//! Subscription rescue, one lever: DISCOUNT_THIS_CYCLE end to end (DECISIONS 13, design §7).
//!
//! A failed renewal opens a rescue deal at AGREED with one fix the wallet computed inside the
//! owner's signed fixes clause (clause 8). Nothing goes to PayPal until the owner approves that
//! fix in the approval window; the approval then makes one invoice for this cycle's discounted
//! amount and sends it, each step a reserved operation with one request id and the owner's
//! decision as its recorded authority. The wallet learns the answer only from PayPal: it reads
//! the invoice until PAID, then signs a receipt. Money counts as recovered only from that receipt
//! on a failure PayPal itself reported (table-ledger `rescue.rs`).
//!
//! Silence never moves money: an unapproved fix lapses at PayPal's next retry and PayPal retries
//! by itself; a sent invoice that is never paid expires; nothing is ever collected by the wallet.
//! No agent tool reaches any of this.
//!
//! A REPLAY failure (a recorded failure the owner replays, since PayPal documents no way to fail
//! a sandbox renewal) leads to a real sandbox invoice on the owner's decision, as the design says,
//! but its deal keeps the REPLAY mode and never counts as recovered.
use crate::pipeline::shield_allows;
use crate::{
    Authority, Error, MoneyStep, OwnerTicket, Pipeline, REQUEST_ID_WINDOW_SECS, Resolution,
};
use table_core::*;
use table_ledger::{
    CheckReason, OpenOperation, Recipient, RescueCase, RescueWatch, subscriber_key,
};
use table_paypal::{
    Invoice, InvoiceRequest, Observation, RequestId, ResourceId, SecondaryApi,
    rescue_invoice_number,
};
use table_proto::{Body, ShortText};

/// PayPal retries a failed payment "every 5 days" (.research/paypal-platform.md §1.5 [S]): when
/// the failure carries no next retry time, the fix waits that long for the owner.
pub const RESCUE_RETRY_DEFAULT_SECS: i64 = 5 * 86400;
/// How long a sent rescue invoice is read for PAID before the deal expires (a wallet choice; the
/// invoice stays open at PayPal, but a later payment is not counted).
pub const RESCUE_INVOICE_OPEN_SECS: i64 = 30 * 86400;
/// The cadence of the PAID read while an invoice is open.
pub const RESCUE_POLL_SECS: i64 = 60;
/// Invoice statuses that prove the send went through. From the research's list (DRAFT, SENT,
/// SCHEDULED, PAID, PARTIALLY_PAID, REFUNDED, PARTIALLY_REFUNDED, CANCELLED, [S-spec, approximate]);
/// anything else leaves a lost send parked.
const SENT_STATUSES: &[&str] = &["SENT", "PAID", "PARTIALLY_PAID"];
const PAID: &str = "PAID";
const DRAFT: &str = "DRAFT";
const CANCELLED: &str = "CANCELLED";

/// A renewal that failed, as the wallet learned it.
#[derive(Debug, Clone)]
pub struct RenewalFailure {
    pub source: RescueSource,
    pub subscription_id: String,
    pub recipient: Recipient,
    /// The plan, as the owner's own item reference (shown as the deal's title).
    pub plan: ItemRef,
    /// The missed cycle at the plan's price.
    pub cycle: Money,
    pub failed_payments: u32,
    pub failed_at: Timestamp,
    pub next_retry_at: Option<Timestamp>,
}

/// What one read of a watched subscription did.
#[derive(Debug, Clone)]
pub enum WatchRead {
    /// The day's read budget is used up: nothing was read or written.
    OverBudget,
    /// PayPal's answer could not be used; the watch backs off and reads again later.
    Unreadable,
    /// Read; no fix opened (`Paid`, `Handled` or `NoFix`).
    Seen(WatchVerdict),
    /// Read, and the failure's one fix opened, PayPal-reported, waiting for the owner.
    Opened(Box<Deal>),
}

fn refusal(reason: &str) -> Error {
    Error::Refused(Refusal {
        clause: 8,
        reason: reason.into(),
    })
}

impl Pipeline {
    fn invoicing(&self) -> Result<std::sync::Arc<dyn SecondaryApi>, Error> {
        self.secondary.clone().ok_or(Error::Unavailable)
    }

    /// Open the rescue deal for a failed renewal: the fix is computed from the signed fixes
    /// clause, and the mandate check and `check_offer` run on the exact deal before it is
    /// written. No PayPal call; nothing is written when a rule refuses.
    pub fn rescue_open(
        &mut self,
        id: DealId,
        failure: &RenewalFailure,
        mandate: (MandateId, u32),
        now: Timestamp,
    ) -> Result<Deal, Error> {
        let m = self
            .wallet
            .ledger
            .active_mandate(mandate.0, mandate.1, &self.wallet.owner)?;
        if m.payload.agent_key != self.wallet.agent_public_key().to_bytes() {
            return Err(Error::Permission);
        }
        let (_, max_bp, max_discount) =
            lever_clause(&m.payload).ok_or_else(|| refusal("fixes clause missing"))?;
        let offer = propose_discount(failure.cycle, max_bp, max_discount)
            .map_err(|_| refusal("no discount your rules allow fits this renewal"))?;
        let payee = match m.payload.clauses.iter().find_map(|c| match c {
            Clause::Payees { payees } => Some(payees.as_slice()),
            _ => None,
        }) {
            Some([payee]) => payee.clone(),
            _ => return Err(Error::Invalid),
        };
        let deal = Deal {
            id,
            created_at: now,
            updated_at: now,
            kind: DealKind::Rescue,
            side: Side::Seller,
            counterparty: subscriber_key(&failure.subscription_id)?,
            terms: Terms {
                item_ref: failure.plan.clone(),
                qty: 1,
                unit_price: offer.invoice,
                currency: offer.invoice.currency(),
                delivery: Delivery::DigitalNow,
            },
            state: DealState::Pairing,
            mandate_id: mandate.0,
            mandate_version: mandate.1,
            transcript_head: H256::ZERO,
            paypal: PaypalRefs::default(),
            mode: match failure.source {
                RescueSource::Replay => Mode::Replay,
                RescueSource::Paypal => Mode::Sandbox,
            },
            market: None,
            shield: None,
            decided_by: None,
            shield_rule: None,
            shield_release: None,
        };
        let usage = self.wallet.ledger.usage_for(&deal, now)?;
        m.payload.check(
            &Intent {
                kind: deal.kind,
                side: deal.side,
                role: Role::Rescue,
                category: Category::Service,
                terms: &deal.terms,
                counterparty: &deal.counterparty,
                paired: false,
                house: false,
                payee: &payee,
                rounds_used: 0,
            },
            usage,
            now,
        )?;
        check_offer(&m.payload, &offer, &deal.terms)?;
        let due = failure
            .next_retry_at
            .filter(|at| *at > now)
            .unwrap_or(now.saturating_add(RESCUE_RETRY_DEFAULT_SECS));
        self.wallet.ledger.open_rescue(
            &deal,
            &RescueCase {
                source: failure.source,
                subscription_id: failure.subscription_id.clone(),
                recipient: failure.recipient.clone(),
                offer,
                failed_payments: failure.failed_payments,
                failed_at: failure.failed_at,
                next_retry_at: failure.next_retry_at,
            },
            &payee,
            Category::Service,
            due,
            now,
        )?;
        Ok(self.wallet.ledger.get_deal(id)?)
    }

    /// The rescue rules a detection reads under: active now, carrying the fixes clause and pinning
    /// this wallet's selected agent key. Checked before any subscription read.
    fn rescue_rules_ready(&self, mandate: (MandateId, u32), now: Timestamp) -> Result<(), Error> {
        let m = self
            .wallet
            .ledger
            .active_mandate(mandate.0, mandate.1, &self.wallet.owner)?;
        if lever_clause(&m.payload).is_none()
            || m.payload.agent_key != self.wallet.agent_public_key().to_bytes()
            || now < m.payload.not_before
            || now >= m.payload.expires
        {
            return Err(Error::Permission);
        }
        Ok(())
    }

    /// One subscription read (a GET, never a write) and what it says in the fields detection
    /// uses; None when the read failed or is not this subscription.
    async fn read_subscription(
        &mut self,
        subscription: &ResourceId,
    ) -> Result<(Vec<Observation>, Option<SubscriptionFacts>), Error> {
        let api = self.invoicing()?;
        let (observations, value) = match api.get_subscription(subscription).await {
            Ok(r) => (r.observations, Some(r.value)),
            Err(e) => (e.observations().to_vec(), None),
        };
        let facts = value
            .filter(|s| s.id == subscription.as_str())
            .and_then(|s| {
                let billing = s.billing_info?;
                Some(SubscriptionFacts {
                    live: matches!(s.status.as_str(), "ACTIVE" | "SUSPENDED"),
                    failed_payments: billing.failed_payments_count,
                    owed: billing
                        .outstanding_balance
                        .and_then(|owed| owed.money().ok()),
                })
            });
        Ok((observations, facts))
    }

    /// Detection from PayPal itself: read one of the owner's subscriptions and open a rescue only
    /// when PayPal shows exactly one failed payment and an outstanding balance (that cycle). The
    /// rescue mandate is checked before the read; the read is recorded under the new deal's id.
    // UNVERIFIED: that `billing_info.outstanding_balance` after one failed payment is exactly that
    // cycle's price, and the `subscriber` email is not read (the owner supplies the recipient).
    #[allow(clippy::too_many_arguments)] // The owner's inputs plus the deal and mandate ids.
    pub async fn rescue_detect(
        &mut self,
        id: DealId,
        subscription: &ResourceId,
        recipient: Recipient,
        plan: ItemRef,
        mandate: (MandateId, u32),
        now: Timestamp,
    ) -> Result<Option<Deal>, Error> {
        self.rescue_rules_ready(mandate, now)?;
        let (observations, facts) = self.read_subscription(subscription).await?;
        let Some(WatchVerdict::Open { cycle }) = facts.map(|f| watch_verdict(&f, false)) else {
            return Ok(None);
        };
        self.rescue_detected(
            id,
            subscription,
            recipient,
            plan,
            cycle,
            &observations,
            mandate,
            now,
        )
        .map(Some)
    }

    /// One read of a watched subscription by the scheduler's watch pass (the owner's watch list,
    /// read-only at PayPal). The rescue rules are checked first, then the read is reserved against
    /// the day's budget (one audit row, before PayPal is asked), then made. A failure opens its one
    /// fix only when this run of failures has none yet (`rescue_watch_handled`); the deal opens at
    /// AGREED, PayPal-reported, and waits for the owner. Nothing here writes at PayPal.
    pub async fn rescue_watch_read(
        &mut self,
        watch: &RescueWatch,
        id: DealId,
        mandate: (MandateId, u32),
        max_reads_day: u32,
        now: Timestamp,
    ) -> Result<WatchRead, Error> {
        self.rescue_rules_ready(mandate, now)?;
        let subscription =
            ResourceId::new(watch.subscription_id.clone()).map_err(|_| Error::Invalid)?;
        match self.wallet.ledger.reserve_rescue_watch_read(
            &watch.subscription_id,
            max_reads_day,
            now,
        ) {
            Ok(_) => {}
            Err(table_ledger::LedgerError::Conflict) => return Ok(WatchRead::OverBudget),
            Err(e) => return Err(e.into()),
        }
        let (observations, facts) = self.read_subscription(&subscription).await?;
        let Some(facts) = facts else {
            self.wallet
                .ledger
                .record_rescue_watch_read(&watch.subscription_id, None, now)?;
            return Ok(WatchRead::Unreadable);
        };
        self.wallet.ledger.record_rescue_watch_read(
            &watch.subscription_id,
            Some(facts.failed_payments),
            now,
        )?;
        let handled = self
            .wallet
            .ledger
            .rescue_watch_handled(&watch.subscription_id)?;
        let verdict = watch_verdict(&facts, handled);
        let WatchVerdict::Open { cycle } = verdict else {
            return Ok(WatchRead::Seen(verdict));
        };
        match self.rescue_detected(
            id,
            &subscription,
            watch.recipient.clone(),
            watch.plan.clone(),
            cycle,
            &observations,
            mandate,
            now,
        ) {
            Ok(deal) => Ok(WatchRead::Opened(Box::new(deal))),
            // The rules refuse this fix (over a limit, no discount fits), or a rescue of this
            // subscription is still live: nothing was written, and the next read asks again.
            Err(Error::Refused(_) | Error::Ledger(table_ledger::LedgerError::Conflict)) => {
                Ok(WatchRead::Seen(WatchVerdict::NoFix))
            }
            Err(e) => Err(e),
        }
    }

    /// Open the PayPal-reported rescue a read found, and record that read under the new deal.
    #[allow(clippy::too_many_arguments)] // The read's facts plus the deal and mandate ids.
    fn rescue_detected(
        &mut self,
        id: DealId,
        subscription: &ResourceId,
        recipient: Recipient,
        plan: ItemRef,
        cycle: Money,
        observations: &[Observation],
        mandate: (MandateId, u32),
        now: Timestamp,
    ) -> Result<Deal, Error> {
        let secret = recipient.expose().to_owned();
        let deal = self.rescue_open(
            id,
            &RenewalFailure {
                source: RescueSource::Paypal,
                subscription_id: subscription.as_str().into(),
                recipient,
                plan,
                cycle,
                failed_payments: 1,
                failed_at: now,
                next_retry_at: None,
            },
            mandate,
            now,
        )?;
        // The read's body is reduced to an allowlist; the subscriber's email is removed besides.
        for call in self.calls(id, observations, now)? {
            self.wallet
                .ledger
                .record_paypal_call(&call, &[secret.as_str()])?;
        }
        Ok(deal)
    }

    /// Read-only: whether the fix's one invoice send ended without sending: it was reserved, is
    /// no longer open, and the deal still waits at SETTLING with its invoice a draft (a send
    /// PayPal showed not done, closed). Such a fix is never sent again, not even on a fresh
    /// owner decision, so the decision is refused before anything is written.
    pub fn rescue_send_ended(&self, id: DealId) -> Result<bool, Error> {
        Ok(
            self.wallet.ledger.get_deal(id)?.state == DealState::Settling
                && !self.has_open_operation(id)?
                && self.wallet.ledger.rescue_send_reserved(id)?,
        )
    }

    /// The owner's decision on the fix (approval window only, through the runtime's privileged
    /// gate and checks hash). On AGREED it creates the invoice and sends it; on a SETTLING deal
    /// whose invoice exists but was never sent, it sends it. A step whose PayPal answer was lost is
    /// read back first, and with this fresh ticket a send PayPal shows not done may go again
    /// under its own request id.
    pub async fn rescue_approve(
        &mut self,
        id: DealId,
        ticket: OwnerTicket,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.kind != DealKind::Rescue || deal.side != Side::Seller {
            return Err(Error::Permission);
        }
        if self.has_open_operation(id)? {
            self.resolve(id, Some(ticket), now).await?;
            return Ok(());
        }
        if self.rescue_send_ended(id)?
            || self
                .wallet
                .ledger
                .deadline(id)?
                .is_none_or(|(due, _)| due <= now)
        {
            return Err(Error::Permission);
        }
        let api = self.invoicing()?;
        let category = self.wallet.ledger.deal_category(id)?;
        // The mandate check (with the fixes clause) and the owner ticket, before any write.
        let decision = self.authority(&deal, category, Authority::Owner(ticket), 1, now)?;
        if !shield_allows(self.shield(&deal, now)?, &decision, MoneyStep::Create) {
            return Err(Error::Permission);
        }
        match deal.state {
            DealState::Agreed => {
                let case = self.wallet.ledger.rescue_case(id)?.ok_or(Error::Invalid)?;
                let request = invoice_request(&deal, &case)?;
                request.body().map_err(|_| Error::Invalid)?;
                self.countersign(&deal, 1, &decision, now)?;
                let rid = RequestId::for_operation(id, 1, "invoice-create")
                    .map_err(|_| Error::Invalid)?;
                self.wallet.ledger.reserve_operation(
                    id,
                    1,
                    "invoice-create",
                    rid.as_str(),
                    &decision,
                    now,
                )?;
                self.wallet
                    .ledger
                    .apply_event(id, DealEvent::BeginSettlement, now)?;
                self.send_invoice_create(api.as_ref(), &deal, &request, &rid, now)
                    .await?;
                self.send_rescue_invoice(api.as_ref(), id, &decision, now)
                    .await
            }
            DealState::Settling
                if deal.paypal.order.is_some()
                    && self.wallet.ledger.rescue_decision(id)?.is_some() =>
            {
                self.send_rescue_invoice(api.as_ref(), id, &decision, now)
                    .await
            }
            _ => Err(Error::Permission),
        }
    }

    /// Create the invoice reserved under `request` and finish its operation with PayPal's answer:
    /// a DRAFT for exactly the deal's amount and reference is recorded as the deal's invoice.
    async fn send_invoice_create(
        &mut self,
        api: &dyn SecondaryApi,
        deal: &Deal,
        request: &InvoiceRequest,
        rid: &RequestId,
        now: Timestamp,
    ) -> Result<String, Error> {
        match api.create_invoice(request, rid).await {
            Ok(r) => {
                let valid = r.value.status == DRAFT && self.invoice_matches(deal, &r.value);
                let mut refs = deal.paypal.clone();
                refs.order = valid.then(|| r.value.id.clone());
                self.complete(
                    deal,
                    1,
                    "invoice-create",
                    &r.observations,
                    &refs,
                    Some(if valid {
                        DealEvent::InvoiceDrafted
                    } else {
                        DealEvent::Mismatch
                    }),
                    now,
                )?;
                if valid {
                    Ok(r.value.id)
                } else {
                    Err(Error::Invalid)
                }
            }
            Err(e) => {
                self.complete(
                    deal,
                    1,
                    "invoice-create",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                Err(Error::Unavailable)
            }
        }
    }

    /// Reserve and send the deal's drafted invoice under `decision`.
    async fn send_rescue_invoice(
        &mut self,
        api: &dyn SecondaryApi,
        id: DealId,
        decision: &DecidedBy,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        let invoice = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        let rid = RequestId::for_operation(id, 1, "invoice-send").map_err(|_| Error::Invalid)?;
        self.wallet
            .ledger
            .reserve_operation(id, 1, "invoice-send", rid.as_str(), decision, now)?;
        self.send_invoice(api, &deal, &invoice, &rid, now).await
    }

    /// Send the invoice reserved under `rid` and finish its operation with PayPal's answer.
    pub(crate) async fn send_invoice(
        &mut self,
        api: &dyn SecondaryApi,
        deal: &Deal,
        invoice: &ResourceId,
        rid: &RequestId,
        now: Timestamp,
    ) -> Result<(), Error> {
        match api.send_invoice(invoice, rid).await {
            Ok(r) => {
                self.complete(
                    deal,
                    1,
                    "invoice-send",
                    &r.observations,
                    &deal.paypal,
                    Some(DealEvent::SettleVerified),
                    now,
                )?;
                self.wallet.ledger.set_deadline(
                    deal.id,
                    now.saturating_add(RESCUE_INVOICE_OPEN_SECS),
                    None,
                    now,
                )?;
                Ok(())
            }
            Err(e) => {
                self.complete(
                    deal,
                    1,
                    "invoice-send",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                Err(Error::Unavailable)
            }
        }
    }

    /// The invoice PayPal returned is this deal's: same amount, and the deal's own reference and
    /// invoice number wherever PayPal echoes them.
    fn invoice_matches(&self, deal: &Deal, invoice: &Invoice) -> bool {
        let number = rescue_invoice_number(deal.id, 1).ok();
        ResourceId::new(&invoice.id).is_ok()
            && invoice
                .amount
                .as_ref()
                .and_then(|a| a.money().ok())
                .is_some_and(|a| deal.terms.amount().ok() == Some(a))
            && invoice.detail.as_ref().is_none_or(|d| {
                d.reference
                    .as_deref()
                    .is_none_or(|r| r == deal.id.to_string())
                    && d.invoice_number
                        .as_deref()
                        .is_none_or(|n| Some(n) == number.as_deref())
            })
    }

    /// Read the deal's sent invoice once. PAID for exactly the deal's amount, nothing still due:
    /// sign the receipt and move to RECEIPTED. CANCELLED: the rescue failed, nothing was paid.
    /// Anything else: keep waiting. Returns whether the deal changed.
    pub async fn rescue_poll(&mut self, id: DealId, now: Timestamp) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.kind != DealKind::Rescue || deal.state != DealState::AwaitingApproval {
            return Err(Error::Invalid);
        }
        let api = self.invoicing()?;
        let invoice = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.rescue_polled.insert(id, now);
        let r = match api.get_invoice(&invoice).await {
            Ok(r) => r,
            Err(e) => {
                for call in self.calls(id, e.observations(), now)? {
                    self.wallet.ledger.record_paypal_call(&call, &[])?;
                }
                return Err(Error::Unavailable);
            }
        };
        for call in self.calls(id, &r.observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        if r.value.id != invoice.as_str() || !self.invoice_matches(&deal, &r.value) {
            self.wallet
                .ledger
                .apply_event(id, DealEvent::Mismatch, now)?;
            return Ok(true);
        }
        let nothing_due = r
            .value
            .due_amount
            .as_ref()
            .is_none_or(|d| d.money().is_ok_and(|m| m.minor() == 0));
        match r.value.status.as_str() {
            // The receipt is signed with the deal's agent key: without it, PAID waits for it.
            PAID if nothing_due && self.signer_missing => Ok(false),
            PAID if nothing_due => {
                let receipt = self.wallet.signed(
                    &deal,
                    Body::Receipt {
                        capture_id: ShortText::new(invoice.as_str().into())?,
                        amount: deal.terms.amount()?,
                        status: table_proto::ReceiptStatus::Completed,
                        transcript_head: deal.transcript_head,
                    },
                    now,
                )?;
                self.wallet.ledger.record_rescue_paid(&receipt, now)?;
                Ok(true)
            }
            CANCELLED => {
                self.wallet.ledger.apply_event(id, DealEvent::Fail, now)?;
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// One scheduler pass over a rescue deal: read back a lost step, apply a due deadline, or
    /// read a sent invoice on its cadence. Never starts a create or a send.
    pub async fn rescue_tick(&mut self, id: DealId, now: Timestamp) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.kind != DealKind::Rescue
            || deal.state.terminal()
            || deal.state == DealState::Receipted
        {
            return Ok(false);
        }
        if self.has_open_operation(id)? {
            if self.secondary.is_none() {
                return Ok(false);
            }
            let resolved = self.resolve(id, None, now).await?;
            if self.has_open_operation(id)? {
                return self.rescue_deadline(id, now).await;
            }
            if resolved.is_some() {
                return Ok(true);
            }
        }
        if self
            .wallet
            .ledger
            .deadline(id)?
            .is_some_and(|(due, _)| due <= now)
        {
            return self.rescue_deadline(id, now).await;
        }
        let due_poll = self
            .rescue_polled
            .get(&id)
            .is_none_or(|at| now.saturating_sub(*at) >= RESCUE_POLL_SECS);
        if deal.state == DealState::AwaitingApproval && due_poll && self.secondary.is_some() {
            return self.rescue_poll(id, now).await;
        }
        Ok(false)
    }

    /// A rescue deal's deadline: nothing is sent and nothing is collected. An unapproved fix
    /// lapses (PayPal retries by itself); a draft never sent expires; a sent invoice is read
    /// once more, then expires if it is not paid. A send whose answer is still unknown keeps the
    /// deal open: that invoice may be with the subscriber.
    pub(crate) async fn rescue_deadline(
        &mut self,
        id: DealId,
        now: Timestamp,
    ) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        let Some((due, _)) = self.wallet.ledger.deadline(id)? else {
            return Ok(false);
        };
        if due > now || deal.state.terminal() || deal.state == DealState::Receipted {
            return Ok(false);
        }
        // A sent invoice may have been paid; its receipt needs the deal's agent key, so without
        // the key it is never expired unread.
        if deal.state == DealState::AwaitingApproval && self.signer_missing {
            return Ok(false);
        }
        if let Some(open) = self.wallet.ledger.open_operations(Some(id))?.first() {
            if open.operation == "invoice-create" && deal.state == DealState::Settling {
                // A draft is never shown to anyone: nobody was asked to pay.
                self.wallet.ledger.close_operation(
                    id,
                    open.attempt,
                    "invoice-create",
                    CheckReason::Lapsed,
                    now,
                )?;
                self.wallet.ledger.apply_deadline_default(id, now)?;
                return Ok(true);
            }
            return Ok(false);
        }
        if deal.state == DealState::AwaitingApproval
            && self.secondary.is_some()
            && self.rescue_poll(id, now).await.unwrap_or(false)
        {
            return Ok(true);
        }
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state.pre_capture() && !deal.state.terminal() {
            self.wallet.ledger.apply_deadline_default(id, now)?;
            return Ok(true);
        }
        Ok(false)
    }

    /// A lost invoice create: PayPal is searched by the deal's own invoice number. Exactly one
    /// invoice with this deal's number, reference and amount: it exists, and the deal records it
    /// (the owner then decides the send). Anything else parks; a create is never sent again, so
    /// a second invoice can never be made.
    pub(crate) async fn resolve_invoice_create(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        if deal.state != DealState::Settling || deal.paypal.order.is_some() {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let Ok(api) = self.invoicing() else {
            return self.park(op, CheckReason::Unreadable, now);
        };
        let number = rescue_invoice_number(deal.id, op.attempt).map_err(|_| Error::Invalid)?;
        let (observations, found) = match api.search_invoices(&number).await {
            Ok(r) => (r.observations, Some(r.value.items)),
            Err(e) => (e.observations().to_vec(), None),
        };
        for call in self.calls(deal.id, &observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        let Some(items) = found else {
            return self.park(op, CheckReason::Unreadable, now);
        };
        let ours: Vec<&Invoice> = items
            .iter()
            .filter(|i| {
                i.detail.as_ref().is_some_and(|d| {
                    d.invoice_number.as_deref() == Some(number.as_str())
                        && d.reference.as_deref() == Some(deal.id.to_string().as_str())
                }) && self.invoice_matches(deal, i)
            })
            .collect();
        let [invoice] = ours.as_slice() else {
            return self.park(op, CheckReason::Ambiguous, now);
        };
        if invoice.status != DRAFT {
            // Sent by someone else, paid or cancelled: not a state this wallet put it in.
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let mut refs = deal.paypal.clone();
        refs.order = Some(invoice.id.clone());
        self.confirm(deal, op, &refs, DealEvent::InvoiceDrafted, now)?;
        Ok(Resolution::Confirmed)
    }

    /// A lost invoice send: the invoice is read. SENT (or already paid): it went out. DRAFT: it
    /// did not, and only the owner's fresh decision sends it again, under the same request id,
    /// inside the fix's deadline and the request id's window; outside them it closes not done.
    pub(crate) async fn resolve_invoice_send(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        let Some(invoice) = deal
            .paypal
            .order
            .as_deref()
            .and_then(|o| ResourceId::new(o).ok())
        else {
            return self.park(op, CheckReason::Ambiguous, now);
        };
        if deal.state != DealState::Settling {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let Ok(api) = self.invoicing() else {
            return self.park(op, CheckReason::Unreadable, now);
        };
        let (observations, read) = match api.get_invoice(&invoice).await {
            Ok(r) => (r.observations, Some(r.value)),
            Err(e) => (e.observations().to_vec(), None),
        };
        for call in self.calls(deal.id, &observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        let Some(read) = read else {
            return self.park(op, CheckReason::Unreadable, now);
        };
        if read.id != invoice.as_str() || !self.invoice_matches(deal, &read) {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        if SENT_STATUSES.contains(&read.status.as_str()) {
            self.confirm(deal, op, &deal.paypal, DealEvent::SettleVerified, now)?;
            self.wallet.ledger.set_deadline(
                deal.id,
                op.started_at.saturating_add(RESCUE_INVOICE_OPEN_SECS),
                None,
                now,
            )?;
            return Ok(Resolution::Confirmed);
        }
        if read.status != DRAFT {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        // A draft never sent asked nobody to pay. Past the fix's deadline (PayPal's next retry)
        // or past the request id's window it is never sent again, not even on a fresh decision:
        // the step closes not done, and at the deadline its default applies (the fix expires and
        // PayPal retries by itself), so the subscription is free for a later rescue.
        let deadline_passed = self.deadline_passed(deal.id, now)?;
        if deadline_passed || now.saturating_sub(op.started_at) >= REQUEST_ID_WINDOW_SECS {
            let resolution = self.not_done(op, now)?;
            if deadline_passed {
                self.wallet.ledger.apply_deadline_default(deal.id, now)?;
            }
            return Ok(resolution);
        }
        if let Some(reason) = self.resend_gate(deal, op, MoneyStep::Create, ticket, now)? {
            return self.park(op, reason, now);
        }
        self.wallet
            .ledger
            .reopen_operation(deal.id, op.attempt, &op.operation, now)?;
        let _ = self
            .send_invoice(api.as_ref(), deal, &invoice, request, now)
            .await;
        self.after_resend(op, now)
    }
}

/// The invoice the owner approves: the rescue row's recipient and offer, the deterministic
/// invoice number and the fixed wording.
fn invoice_request(deal: &Deal, case: &RescueCase) -> Result<InvoiceRequest, Error> {
    if case.offer.invoice != deal.terms.amount()? {
        return Err(Error::Invalid);
    }
    Ok(InvoiceRequest {
        deal: deal.id,
        recipient_email: case.recipient.expose().into(),
        amount: case.offer.invoice,
        invoice_number: rescue_invoice_number(deal.id, 1).map_err(|_| Error::Invalid)?,
        text: invoice_text(&case.offer),
    })
}
