//! T10 read-back resolver. A money step whose PayPal answer was lost (network loss, timeout, a
//! 2xx body that does not decode, or a process that stopped inside the call) stays reserved under
//! its one `PayPal-Request-Id`. The resolver reads PayPal's own record with a GET and then does
//! exactly one thing:
//! - **confirm**: PayPal shows the step happened. The operation is finished with the observed facts
//!   under its original `decided_by`, and the deal moves as if the answer had arrived.
//! - **re-send**: PayPal shows the step did not happen, and the step's original authority still
//!   holds now (the same gates: mandate, shield, deadline, an owner ticket that is still valid).
//!   The same request is sent again with the same request id, never a new one. A void is the
//!   safe direction: it goes again whoever decided it, with no ticket and no budget.
//! - **park**: PayPal could not be read, or its record does not settle the question, or the
//!   authority no longer holds. Nothing more is sent for the deal until it is settled; its
//!   deadline can only let it lapse or release a hold, never collect.
//!
//! A read-back GET is an observation: it grants nothing. The resolver never reserves an
//! operation, so it can never mint a request id.
use crate::pipeline::shield_allows;
use crate::{Authority, Error, MoneyStep, OwnerTicket, Pipeline};
use table_core::*;
use table_ledger::{CheckReason, OpenOperation, OperationOutcome};
use table_paypal::{Order, OrderStatus, RequestId, ResourceId};

/// What one check did to an open money operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolution {
    /// PayPal shows the step happened; the deal moved as if its answer had arrived.
    Confirmed,
    /// The step was sent again under its own request id. `confirmed`: that answer settled it.
    Resent { confirmed: bool },
    /// PayPal shows the step did not happen and its authority has lapsed; nothing was sent.
    NotDone,
    /// Still open; nothing more is sent until a later check settles it.
    Parked(CheckReason),
}

/// How long PayPal keeps a `PayPal-Request-Id`: "The server stores keys for 6 hours"
/// (.research/paypal-platform.md section 1.1, Orders v2 [S-spec]). Past it, a re-send could be
/// taken for a new request, so the resolver parks instead.
// UNVERIFIED: the research states the 6-hour key store for Orders v2 only; that the Payments v2
// capture applies the same window is assumed (design report section 7 states it generally).
pub const REQUEST_ID_WINDOW_SECS: i64 = 6 * 3600;
/// Re-sends per operation before the resolver only reads (a re-send whose answer is lost too).
/// A void, the safe default's or the owner's, has no budget: it is the safe direction and is
/// re-sent on each due check.
pub const MAX_RESENDS: u32 = 3;
/// Seconds before the next check after `tries` checks: 15 s doubling, capped at 15 min.
pub const fn check_backoff(tries: u32) -> i64 {
    let wait = 15_i64 << (if tries > 6 { 6 } else { tries });
    if wait > 900 { 900 } else { wait }
}

/// The authorization status PayPal reports while the money is held and nothing was collected
/// (the value `authorize` already checks).
const AUTHORIZATION_HELD: &str = "CREATED";
// UNVERIFIED: the authorization status after a void. The research names the webhook
// PAYMENT.AUTHORIZATION.VOIDED; the status value inside an order read is assumed to match.
const AUTHORIZATION_VOIDED: &str = "VOIDED";
/// The capture status `capture` already requires.
const CAPTURE_COMPLETED: &str = "COMPLETED";

/// The re-run authority must be the one the operation was decided under. An owner decision
/// matches any fresh, valid owner ticket; every rule-based authority must match exactly.
fn same_authority(stored: &DecidedBy, now: &DecidedBy) -> bool {
    match (stored, now) {
        (DecidedBy::Human { .. }, DecidedBy::Human { .. }) => true,
        (a, b) => a == b,
    }
}

impl Pipeline {
    /// Whether the deal has a money operation whose outcome is not settled. While it has, no new
    /// money step starts for it.
    pub fn has_open_operation(&self, id: DealId) -> Result<bool, Error> {
        Ok(!self.wallet.ledger.open_operations(Some(id))?.is_empty())
    }
    /// Check every open operation whose next check is due (the HOUSE at startup and each tick).
    /// One deal's failure never stops the others; the first error is returned after all ran.
    pub async fn resolve_due(
        &mut self,
        now: Timestamp,
    ) -> Result<Vec<(DealId, Resolution)>, Error> {
        let mut done = Vec::new();
        let mut failure = None;
        let mut seen = std::collections::HashSet::new();
        for op in self.wallet.ledger.open_operations(None)? {
            // One check per deal per pass: its oldest open operation.
            if !seen.insert(op.deal_id) || !op.due(now) {
                continue;
            }
            match self.resolve_one(&op, None, now).await {
                Ok(Some(r)) => done.push((op.deal_id, r)),
                Ok(None) => {}
                Err(e) => {
                    failure.get_or_insert(e);
                }
            }
        }
        failure.map_or(Ok(done), Err)
    }
    /// Check the deal's oldest open operation if its next check is due. With an owner ticket
    /// (a fresh decision in the approval window) it is checked now, and a step the owner decided
    /// may be sent again under that ticket.
    pub async fn resolve(
        &mut self,
        id: DealId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Option<Resolution>, Error> {
        let Some(op) = self
            .wallet
            .ledger
            .open_operations(Some(id))?
            .into_iter()
            .next()
        else {
            return Ok(None);
        };
        if ticket.is_none() && !op.due(now) {
            return Ok(None);
        }
        self.resolve_one(&op, ticket, now).await
    }
    async fn resolve_one(
        &mut self,
        op: &OpenOperation,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Option<Resolution>, Error> {
        let deal = self.wallet.ledger.get_deal(op.deal_id)?;
        // A rescue's invoice is real even when its failure was replayed (rescue.rs).
        if (deal.mode == Mode::Replay && deal.kind != DealKind::Rescue) || deal.state.terminal() {
            return Ok(None);
        }
        // The stored request id must be the one derived from the deal, attempt and operation:
        // anything else is not a request this wallet may send again.
        let request = match RequestId::for_operation(deal.id, op.attempt, &op.operation) {
            Ok(r) if r.as_str() == op.request_id => r,
            _ => return self.park(op, CheckReason::Ambiguous, now).map(Some),
        };
        let resolution = match op.operation.as_str() {
            "create" => {
                self.resolve_create(&deal, op, &request, ticket, now)
                    .await?
            }
            "authorize" => {
                self.resolve_authorize(&deal, op, &request, ticket, now)
                    .await?
            }
            "capture" => {
                self.resolve_capture(&deal, op, &request, ticket, now)
                    .await?
            }
            "void" => self.resolve_void(&deal, op, &request, now).await?,
            "invoice-create" if deal.kind == DealKind::Rescue => {
                self.resolve_invoice_create(&deal, op, now).await?
            }
            "invoice-send" if deal.kind == DealKind::Rescue => {
                self.resolve_invoice_send(&deal, op, &request, ticket, now)
                    .await?
            }
            _ => self.park(op, CheckReason::Ambiguous, now)?,
        };
        Ok(Some(resolution))
    }
    pub(crate) fn park(
        &mut self,
        op: &OpenOperation,
        reason: CheckReason,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        self.wallet.ledger.park_operation(
            op.deal_id,
            op.attempt,
            &op.operation,
            reason,
            now.saturating_add(check_backoff(op.tries)),
            now,
        )?;
        Ok(Resolution::Parked(reason))
    }
    pub(crate) fn not_done(
        &mut self,
        op: &OpenOperation,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        self.wallet.ledger.close_operation(
            op.deal_id,
            op.attempt,
            &op.operation,
            CheckReason::NotDone,
            now,
        )?;
        Ok(Resolution::NotDone)
    }
    pub(crate) fn deadline_passed(&self, id: DealId, now: Timestamp) -> Result<bool, Error> {
        Ok(self
            .wallet
            .ledger
            .deadline(id)?
            .is_some_and(|(due, _)| due <= now))
    }
    /// After a re-send: settled when its answer finished the operation, else parked to be read
    /// again later.
    pub(crate) fn after_resend(
        &mut self,
        op: &OpenOperation,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        let still_open = self
            .wallet
            .ledger
            .open_operations(Some(op.deal_id))?
            .iter()
            .any(|o| o.attempt == op.attempt && o.operation == op.operation);
        if still_open {
            self.park(op, CheckReason::Unreadable, now)?;
        }
        Ok(Resolution::Resent {
            confirmed: !still_open,
        })
    }
    /// The gates the step ran before its first send, run again now: the request id window, the
    /// re-send budget, a chosen lapse or a pause, the authority (mandate and, for an owner
    /// decision, a valid owner ticket), the same authority as recorded, and the shield. `None`
    /// means the step may be sent again; otherwise the reason to park.
    pub(crate) fn resend_gate(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        step: MoneyStep,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Option<CheckReason>, Error> {
        if now.saturating_sub(op.started_at) >= REQUEST_ID_WINDOW_SECS {
            return Ok(Some(CheckReason::Window));
        }
        if op.resends >= MAX_RESENDS {
            return Ok(Some(CheckReason::NeedsOwner));
        }
        // Without the deal's agent key no answer could be signed: only a void goes again.
        if self.signer_missing {
            return Ok(Some(CheckReason::Refused));
        }
        let lapse = self
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id))?
            .unwrap_or(false);
        let authority = match (&op.decided_by, ticket) {
            (DecidedBy::Human { .. }, Some(ticket)) => Authority::Owner(ticket),
            (DecidedBy::Human { .. }, None) => return Ok(Some(CheckReason::NeedsOwner)),
            (DecidedBy::Policy { .. }, _) if self.policy_paused => {
                return Ok(Some(CheckReason::Refused));
            }
            (DecidedBy::Policy { .. }, _) => Authority::Policy,
            (DecidedBy::SellerMandate { .. }, _) => Authority::SellerMandate,
            (DecidedBy::HouseMandate { .. }, _) => Authority::HouseMandate,
            // A safe default never starts a create, an authorize or a capture.
            (DecidedBy::SafeDefault { .. }, _) => return Ok(Some(CheckReason::Refused)),
        };
        let human = matches!(authority, Authority::Owner(_));
        if lapse && !human {
            return Ok(Some(CheckReason::Refused));
        }
        let category = match self.wallet.ledger.deal_category(deal.id) {
            Ok(c) => c,
            Err(table_ledger::LedgerError::NotFound) => return Ok(Some(CheckReason::Refused)),
            Err(e) => return Err(e.into()),
        };
        let refused = if human {
            CheckReason::NeedsOwner
        } else {
            CheckReason::Refused
        };
        let decided = match self.authority(deal, category, authority, op.attempt, now) {
            Ok(d) => d,
            Err(
                e @ Error::Ledger(
                    table_ledger::LedgerError::Sql(_)
                    | table_ledger::LedgerError::Json(_)
                    | table_ledger::LedgerError::Integrity(_),
                ),
            ) => return Err(e),
            Err(_) => return Ok(Some(refused)),
        };
        if !same_authority(&op.decided_by, &decided)
            || !shield_allows(self.shield(deal, now)?, &decided, step)
        {
            return Ok(Some(refused));
        }
        Ok(None)
    }
    /// One read of the order, recorded in `paypal_calls` either way. `None` when PayPal could
    /// not be read.
    async fn read_order(
        &mut self,
        id: DealId,
        order: &ResourceId,
        now: Timestamp,
    ) -> Result<Option<Order>, Error> {
        let (observations, order) = match self.api.get_order(order).await {
            Ok(r) => (r.observations, Some(r.value)),
            Err(e) => (e.observations().to_vec(), None),
        };
        for call in self.calls(id, &observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        Ok(order)
    }
    /// The order read back, checked against the deal: same order id and every binding
    /// `Order::verify` checks. `Err(reason)` parks.
    async fn read_bound_order(
        &mut self,
        deal: &Deal,
        attempt: u8,
        now: Timestamp,
    ) -> Result<Result<Order, CheckReason>, Error> {
        let Some(order_id) = deal
            .paypal
            .order
            .as_deref()
            .and_then(|o| ResourceId::new(o).ok())
        else {
            return Ok(Err(CheckReason::Ambiguous));
        };
        let Some(order) = self.read_order(deal.id, &order_id, now).await? else {
            return Ok(Err(CheckReason::Unreadable));
        };
        if order.id != order_id.as_str()
            || order.verify(&self.recorded_order(deal, attempt)?).is_err()
        {
            return Ok(Err(CheckReason::Ambiguous));
        }
        Ok(Ok(order))
    }
    pub(crate) fn confirm(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        refs: &PaypalRefs,
        event: DealEvent,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.wallet.ledger.resolve_confirmed(OperationOutcome {
            id: deal.id,
            attempt: op.attempt,
            operation: &op.operation,
            calls: &[],
            refs,
            event: Some(event),
            at: now,
        })?;
        Ok(())
    }

    /// A create has no read-back: the order id is in the answer that was lost, and PayPal offers
    /// no read by request id. PayPal keeps the request id for 6 hours [S-spec] and a retried create
    /// with the same id produces one order (design acceptance F2), so inside that window the same
    /// request is sent again under the same gates, and its answer settles the question either
    /// way. Outside it, or when a gate refuses, the deal waits for its deadline, where it lapses:
    /// its approval link never left the wallet.
    async fn resolve_create(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        if deal.state != DealState::Settling {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        if self.deadline_passed(deal.id, now)? {
            return self.park(op, CheckReason::Refused, now);
        }
        if let Some(reason) = self.resend_gate(deal, op, MoneyStep::Create, ticket, now)? {
            return self.park(op, reason, now);
        }
        let expected = self.expected(deal, op.attempt)?;
        if expected.body().is_err() {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        self.wallet
            .ledger
            .reopen_operation(deal.id, op.attempt, &op.operation, now)?;
        // A refused or unreadable answer finishes or leaves the operation as `send_create` does.
        let _ = self
            .send_create(deal, op.attempt, &expected, request, op.started_at, now)
            .await;
        self.after_resend(op, now)
    }

    /// Authorize: the order shows one authorization holding the deal's amount (it happened), or
    /// is still APPROVED with none (it did not).
    async fn resolve_authorize(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        if deal.state != DealState::Approved {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let order = match self.read_bound_order(deal, op.attempt, now).await? {
            Ok(order) => order,
            Err(reason) => return self.park(op, reason, now),
        };
        let unit = &order.purchase_units[0];
        let amount = deal.terms.amount()?;
        match (&order.status, unit.payments.authorizations.as_slice()) {
            (OrderStatus::Completed, [a])
                if a.status == AUTHORIZATION_HELD
                    && a.amount.money().ok() == Some(amount)
                    && ResourceId::new(&a.id).is_ok()
                    && unit.payments.captures.is_empty() =>
            {
                let mut refs = deal.paypal.clone();
                refs.authorization = Some(a.id.clone());
                self.confirm(deal, op, &refs, DealEvent::AuthorizationConfirmed, now)?;
                // The hold started no later than the request; the 72 h decision window counts
                // from there, so it never outlasts PayPal's honor period.
                self.wallet.ledger.set_deadline(
                    deal.id,
                    op.started_at.saturating_add(72 * 3600),
                    Some(op.started_at),
                    now,
                )?;
                Ok(Resolution::Confirmed)
            }
            (OrderStatus::Approved, []) if unit.payments.captures.is_empty() => {
                if self.deadline_passed(deal.id, now)? {
                    return self.not_done(op, now);
                }
                if let Some(reason) =
                    self.resend_gate(deal, op, MoneyStep::Authorize, ticket, now)?
                {
                    return self.park(op, reason, now);
                }
                let resource = ResourceId::new(order.id).map_err(|_| Error::Invalid)?;
                self.wallet
                    .ledger
                    .reopen_operation(deal.id, op.attempt, &op.operation, now)?;
                let _ = self
                    .send_authorize(deal, op.attempt, &resource, request, now)
                    .await;
                self.after_resend(op, now)
            }
            _ => self.park(op, CheckReason::Ambiguous, now),
        }
    }

    /// The deal's own authorization in the order read back, if it is there exactly once.
    fn own_authorization<'a>(deal: &Deal, order: &'a Order) -> Option<&'a table_paypal::Payment> {
        let id = deal.paypal.authorization.as_deref()?;
        let mut matches = order.purchase_units[0]
            .payments
            .authorizations
            .iter()
            .filter(|a| a.id == id);
        let one = matches.next()?;
        matches.next().is_none().then_some(one)
    }

    /// Capture: the order shows one completed capture of the deal's amount (it happened: the
    /// receipt is signed as the answer would have), or none while the authorization is still
    /// held (it did not).
    // UNVERIFIED: that an order read lists an authorization's captures under
    // purchase_units[].payments.captures. The research documents GET /v2/checkout/orders/{id} and
    // the capture's id, status and amount; the nesting is the shape `Payments` already decodes.
    async fn resolve_capture(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        if deal.state != DealState::Authorized {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let order = match self.read_bound_order(deal, op.attempt, now).await? {
            Ok(order) => order,
            Err(reason) => return self.park(op, reason, now),
        };
        let Some(held) = Self::own_authorization(deal, &order) else {
            return self.park(op, CheckReason::Ambiguous, now);
        };
        let amount = deal.terms.amount()?;
        match order.purchase_units[0].payments.captures.as_slice() {
            [c] if c.status == CAPTURE_COMPLETED
                && c.amount.money().ok() == Some(amount)
                && ResourceId::new(&c.id).is_ok() =>
            {
                // The receipt is signed with the deal's agent key: without it, the confirmed
                // capture waits for the key, and nothing is sent.
                if self.signer_missing {
                    return self.park(op, CheckReason::NeedsOwner, now);
                }
                let mut refs = deal.paypal.clone();
                refs.capture = Some(c.id.clone());
                self.confirm(deal, op, &refs, DealEvent::CaptureConfirmed, now)?;
                self.issue_receipt(deal.id, c.id.clone(), now)?;
                Ok(Resolution::Confirmed)
            }
            [] if held.status == AUTHORIZATION_HELD => {
                // Past the deadline the capture's authority is gone: the safe default releases
                // the hold instead, now that PayPal shows nothing was collected.
                if self.deadline_passed(deal.id, now)? {
                    return self.not_done(op, now);
                }
                if let Some(reason) = self.resend_gate(deal, op, MoneyStep::Capture, ticket, now)? {
                    return self.park(op, reason, now);
                }
                if !self.wallet.ledger.has_countersign(deal.id, op.attempt)? {
                    return self.park(op, CheckReason::Refused, now);
                }
                let resource = ResourceId::new(held.id.clone()).map_err(|_| Error::Invalid)?;
                self.wallet
                    .ledger
                    .reopen_operation(deal.id, op.attempt, &op.operation, now)?;
                let _ = self
                    .send_capture(deal, op.attempt, &resource, request, now)
                    .await;
                self.after_resend(op, now)
            }
            _ => self.park(op, CheckReason::Ambiguous, now),
        }
    }

    /// Void: the authorization shows VOIDED with nothing captured (it happened), or still held
    /// (it did not). A void is the safe direction (the safe-default authority: it releases a hold
    /// and can never collect), so a void PayPal shows not done is sent again with its own request
    /// id on every due check, whoever decided it: a safe default, or the owner, whose decision to
    /// void stands and needs no second click. Its record keeps the original `decided_by`.
    async fn resolve_void(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        now: Timestamp,
    ) -> Result<Resolution, Error> {
        if deal.state != DealState::Authorized {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let order = match self.read_bound_order(deal, op.attempt, now).await? {
            Ok(order) => order,
            Err(reason) => return self.park(op, reason, now),
        };
        let Some(held) = Self::own_authorization(deal, &order) else {
            return self.park(op, CheckReason::Ambiguous, now);
        };
        // Money was collected: a void cannot undo it, and the owner must see it.
        if !order.purchase_units[0].payments.captures.is_empty() {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        let event = match op.decided_by {
            DecidedBy::SafeDefault { .. }
                if !deal.shield.is_some_and(|v| v >= ShieldVerdict::Hold) =>
            {
                DealEvent::AutoVoid
            }
            DecidedBy::SafeDefault { .. } | DecidedBy::Human { .. } => DealEvent::Void,
            _ => return self.park(op, CheckReason::Ambiguous, now),
        };
        if held.status == AUTHORIZATION_VOIDED {
            self.confirm(deal, op, &deal.paypal.clone(), event, now)?;
            return Ok(Resolution::Confirmed);
        }
        if held.status != AUTHORIZATION_HELD {
            return self.park(op, CheckReason::Ambiguous, now);
        }
        // Re-sent on every due check, on the check backoff, with no budget: a void can never
        // move money, and PayPal refuses a second void of the same authorization.
        let resource = ResourceId::new(held.id.clone()).map_err(|_| Error::Invalid)?;
        self.wallet
            .ledger
            .reopen_operation(deal.id, op.attempt, &op.operation, now)?;
        let _ = self
            .send_void(deal, op.attempt, &resource, request, event, now)
            .await;
        self.after_resend(op, now)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn checks_back_off_from_15_seconds_to_a_15_minute_cap() {
        let waits: Vec<i64> = (0..10).map(check_backoff).collect();
        assert_eq!(waits, [15, 30, 60, 120, 240, 480, 900, 900, 900, 900]);
        assert_eq!(check_backoff(u32::MAX), 900);
    }
    #[test]
    fn an_owner_decision_matches_any_owner_decision_and_rules_match_exactly() {
        let human = |at| DecidedBy::Human { at };
        assert!(same_authority(&human(1), &human(2)));
        assert!(same_authority(
            &DecidedBy::Policy { clause: 6 },
            &DecidedBy::Policy { clause: 6 }
        ));
        assert!(!same_authority(
            &DecidedBy::SellerMandate {
                mandate_hash: H256::ZERO
            },
            &DecidedBy::SellerMandate {
                mandate_hash: H256([1; 32])
            }
        ));
        assert!(!same_authority(&human(1), &DecidedBy::Policy { clause: 6 }));
    }
}
