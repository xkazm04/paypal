//! The resolver: a money operation whose PayPal outcome is unknown reaches PayPal's truth
//! exactly once, before any new attempt at its step.
//!
//! A read-back (GET) is an observation and grants nothing. What it shows is applied only after
//! the same truth checks the step itself runs (`Order::verify`, the amount and status checks).
//! An operation PayPal shows never committed may be sent once more: the original request, with
//! the same PayPal-Request-Id and the same recorded authority, which is re-checked first. A new
//! operation identity is never minted. What the resolver cannot settle is parked for the owner
//! with one audit row and is not sent again, with one exception: at the deal's deadline a parked
//! void goes once more under its own request id, the safe default being its authority. A parked
//! authorize, capture or void is read again only once the deadline passed (at most hourly, inside
//! `PARKED_READ_WINDOW_SECS`) or on the owner's ticket.
use super::send::Settle;
use super::{Authority, MoneyStep, Pipeline, shield_allows};
use crate::Error;
use table_core::*;
use table_ledger::{
    LedgerError, OpenOperation, Resolution, ResolutionOutcome as Outcome, UNREAD_AUTHORIZE_SECS,
};
use table_paypal::{Observation, OrderStatus, RequestId, ResourceId};

/// A reservation still `pending` this long after it started has no live call: the longest one
/// awaited PayPal call takes plus slack, the HOUSE's `HEARTBEAT_STALE`
/// (services/house-seller/src/hosted.rs).
pub const PENDING_STALE_SECS: i64 = 190;
/// PayPal keeps a PayPal-Request-Id for 6 hours (.research/paypal-platform.md, Orders v2
/// idempotency [S-spec]); a create re-sent inside it returns the first order, not a second.
pub(crate) const REQUEST_ID_KEPT_SECS: i64 = 6 * 3600;
/// A call whose answer was lost in this process is read back no sooner than this after it
/// started: PayPal may still be committing it, and a read that races the commit sees the old
/// state. A reservation left `pending` by a stopped call has no such wait.
pub const SETTLE_SECS: i64 = 5;
/// The least time between two deadline read-backs of one parked capture or void, and of a lost
/// authorize, capture or void whose read failed `RESCUE_READ_ATTEMPTS` times in a row. A parked
/// step's outcome can change only on PayPal's side, and one read an hour keeps the deadline's
/// read-back from asking PayPal every second. The time is kept in memory (`Pipeline`), so a
/// restart reads at once.
pub const PARKED_READ_SECS: i64 = 3600;
/// The total time the wallet itself keeps reading a parked step on its own, counted from a durable
/// timestamp (the deal's deadline, or the request id's window ending, whichever starts those
/// reads), never from in-memory park state. A lost authorize, capture or void is read past its
/// deal's deadline for this long too, counted from that deadline; after it the deal keeps its
/// state with the step open (or parked) and needs the owner (DECISIONS 52, 52b). 30 days is the
/// open horizon of a sent rescue invoice (`RESCUE_INVOICE_OPEN_SECS`): an invoice PayPal could not
/// be read about for that long past its deadline is an outage or a lost cause, and 720 hourly
/// reads are all it costs. After it the
/// deal stays parked and needs the owner, who can still ask for a read; nothing is expired.
pub const PARKED_READ_WINDOW_SECS: i64 = 30 * 86400;

/// Why the resolver runs, which decides what it may send again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Resolve {
    /// Before a deal's next step: an operation PayPal shows never committed is sent once more
    /// under its own recorded authority when that authority still holds.
    Advance(Category),
    /// At a deadline or a shield hold: read back only. Nothing but a safe-default void is sent
    /// again; a create is left to the deadline default, and an uncommitted authorize or capture
    /// is given up so the safe default can follow.
    Deadline,
}

/// What one resolver step found and what it changes: the per-step inputs of [`Pipeline::record`].
/// The raw `observations` become the resolution's calls there.
pub(crate) struct Finding<'a> {
    observed: &'a str,
    outcome: Outcome,
    observations: &'a [Observation],
    refs: Option<&'a PaypalRefs>,
    event: Option<DealEvent>,
}

impl<'a> Finding<'a> {
    pub(crate) fn new(
        observed: &'a str,
        outcome: Outcome,
        observations: &'a [Observation],
    ) -> Self {
        Self {
            observed,
            outcome,
            observations,
            refs: None,
            event: None,
        }
    }
    pub(crate) fn refs(mut self, refs: &'a PaypalRefs) -> Self {
        self.refs = Some(refs);
        self
    }
    pub(crate) fn event(mut self, event: DealEvent) -> Self {
        self.event = Some(event);
        self
    }
}

fn order_code(status: &OrderStatus) -> &'static str {
    match status {
        OrderStatus::Created => "CREATED",
        OrderStatus::Saved => "SAVED",
        OrderStatus::Approved => "APPROVED",
        OrderStatus::Voided => "VOIDED",
        OrderStatus::Completed => "COMPLETED",
        OrderStatus::PayerActionRequired => "PAYER_ACTION_REQUIRED",
    }
}

impl Pipeline {
    /// A `pending` reservation started before this bound has no live call: every one from
    /// before this process opened the pipeline, and every one older than
    /// [`PENDING_STALE_SECS`].
    pub fn stale_before(&self, now: Timestamp) -> Timestamp {
        self.started
            .saturating_add(1)
            .max(now.saturating_sub(PENDING_STALE_SECS))
    }
    /// Whether the deal has a money operation whose outcome is not settled, a live call and a
    /// parked one included. While it has, no new money step starts for it.
    pub fn has_open_operation(&self, id: DealId) -> Result<bool, Error> {
        Ok(!self
            .wallet
            .ledger
            .open_operations(Some(id), Timestamp::MAX)?
            .is_empty())
    }
    /// Whether a re-send of `op` must wait: the deal has no agent key to sign what PayPal would
    /// confirm (only a void goes again without it), or the owner paused all agents and `op` was a
    /// clause-6 policy step. Waiting writes nothing; the next tick asks again.
    fn holds_resend(&self, op: &OpenOperation) -> bool {
        (self.signer_missing && op.operation != "void")
            || (self.policy_paused && matches!(op.decided_by, DecidedBy::Policy { .. }))
    }
    /// Money operations whose PayPal outcome is unknown and not yet settled, parked ones
    /// included, oldest first.
    pub fn open_operations(
        &self,
        id: Option<DealId>,
        now: Timestamp,
    ) -> Result<Vec<OpenOperation>, Error> {
        Ok(self
            .wallet
            .ledger
            .open_operations(id, self.stale_before(now))?)
    }
    /// Resolves every open operation of a deal, oldest first, and stops at the first that
    /// cannot be read back this time (`Unavailable`; the next tick tries again) or is still
    /// within [`SETTLE_SECS`]. Parked ones wait for the owner, except a parked authorize,
    /// capture or void once the deal's deadline passed: it is read back under
    /// [`Resolve::Deadline`], which grants nothing, so the safe default can settle it by what
    /// PayPal shows. A parked capture or void is read back at most once per
    /// [`PARKED_READ_SECS`]. An authorize, capture or void whose read failed waits out the rescue
    /// path's backoff (`deadline_read_failed`: capped exponential with per-request-id jitter,
    /// never under `RESCUE_POLL_SECS`, and once per [`PARKED_READ_SECS`] after
    /// `RESCUE_READ_ATTEMPTS` failures in a row); a read that succeeds clears it. The wallet's
    /// own reads of an authorize, capture or void end [`PARKED_READ_WINDOW_SECS`] after the
    /// deal's deadline (a durable time, so a restart does not reopen it; DECISIONS 52, 52b). One
    /// skipped for any of these is passed over like any parked step. The deal's read-schedule
    /// entries that no longer govern a read are then dropped (`prune_read_state`). `Ok(true)`
    /// when nothing is left open, so the deal's next step may run.
    pub async fn resolve_deal(
        &mut self,
        id: DealId,
        mode: Resolve,
        now: Timestamp,
    ) -> Result<bool, Error> {
        let at_deadline = self.deadline_passed(id, mode, now)?;
        // Durable (the ledger's deadline), so a restart does not reopen it.
        let window_closed = self
            .wallet
            .ledger
            .deadline(id)?
            .is_some_and(|(due, _)| now.saturating_sub(due) >= PARKED_READ_WINDOW_SECS);
        let result = async {
            for op in self.open_operations(Some(id), now)? {
                if op.needs_owner
                    && !(at_deadline && matches!(op.operation, "authorize" | "capture" | "void"))
                {
                    continue;
                }
                if !op.pending && now < op.started_at.saturating_add(SETTLE_SECS) {
                    break;
                }
                // A lost authorize, capture or void whose read failed waits out its backoff
                // (hourly once parked), and past the window only the owner can have it read: it
                // stays open, never taken as settled unread.
                if matches!(op.operation, "authorize" | "capture" | "void")
                    && !self.money_read_due(&op.request_id, window_closed, now)
                {
                    continue;
                }
                if op.needs_owner && matches!(op.operation, "capture" | "void") {
                    let recent = self.parked_read.get(&op.request_id).map_or_else(
                        || self.read_floor_holds(now),
                        |last| now < last.saturating_add(PARKED_READ_SECS),
                    );
                    if recent {
                        continue;
                    }
                    // Recorded before the read, so a read that fails is throttled too.
                    self.note_parked_read(&op.request_id, now);
                }
                self.resolve_one(&op, mode, now).await?;
            }
            Ok::<_, Error>(self.open_operations(Some(id), now)?.is_empty())
        }
        .await;
        self.prune_read_state(id, now)?;
        result
    }
    /// Whether the wallet may read a lost authorize, capture or void on its own now: inside the
    /// window past the deal's deadline, and its failed-read backoff is due. With no backoff entry
    /// it is due, unless the cap dropped an entry within `RESCUE_POLL_SECS` (the floor).
    fn money_read_due(&self, request_id: &str, window_closed: bool, now: Timestamp) -> bool {
        if window_closed {
            return false;
        }
        match self.rescue_read_backoff.get(request_id) {
            Some((_, next)) => now >= *next,
            None => !self.read_floor_holds(now),
        }
    }
    async fn resolve_one(
        &mut self,
        op: &OpenOperation,
        mode: Resolve,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(op.deal_id)?;
        let request = RequestId::for_operation(deal.id, op.attempt, op.operation)
            .map_err(|_| Error::Invalid)?;
        if request.as_str() != op.request_id {
            return Err(LedgerError::Integrity("operation request id").into());
        }
        // A rescue's invoice is real even when its failure was replayed (rescue.rs).
        if deal.mode == Mode::Replay && deal.kind != DealKind::Rescue {
            return Ok(());
        }
        match op.operation {
            "invoice-create" | "invoice-send" => self.resolve_invoice(&deal, op, None, now).await,
            // Confirming a create signs the SETTLE: without the agent key it waits.
            "create" if self.signer_missing => Ok(()),
            "create" => self.resolve_create(&deal, op, &request, mode, now).await,
            "authorize" => {
                self.resolve_authorize(&deal, op, &request, mode, false, now)
                    .await
            }
            _ => self.resolve_payment(&deal, op, &request, mode, now).await,
        }
    }
    /// A read-back at the deal's deadline (or past it): the only time a parked step is read
    /// again without the owner, and a void goes once more whoever decided it.
    fn deadline_passed(&self, id: DealId, mode: Resolve, now: Timestamp) -> Result<bool, Error> {
        Ok(mode == Resolve::Deadline
            && self
                .wallet
                .ledger
                .deadline(id)?
                .is_some_and(|(due, _)| due <= now))
    }
    pub(crate) fn record(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        finding: Finding<'_>,
        now: Timestamp,
    ) -> Result<(), Error> {
        let calls = self.calls(deal.id, finding.observations, now)?;
        self.wallet.ledger.record_resolution(Resolution {
            id: deal.id,
            request_id: &op.request_id,
            observed: finding.observed,
            outcome: finding.outcome,
            calls: &calls,
            refs: finding.refs,
            event: finding.event,
            at: now,
        })?;
        Ok(())
    }
    /// One audit row says the owner must decide; the resolver leaves it alone from then on.
    pub(crate) fn park(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        observed: &str,
        observations: &[Observation],
        now: Timestamp,
    ) -> Result<(), Error> {
        // Already waiting for the owner: one audit row says so, and a read that finds the same
        // again adds none.
        if op.needs_owner {
            return Ok(());
        }
        self.record(
            deal,
            op,
            Finding::new(observed, Outcome::NeedsOwner, observations),
            now,
        )
    }
    /// The read-back or re-send itself failed: its evidence is kept (one row for a run of
    /// failures) and the operation stays open for the next tick.
    pub(crate) fn defer(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        error: &table_paypal::Error,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.record(
            deal,
            op,
            Finding::new("none", Outcome::Deferred, error.observations()),
            now,
        )?;
        Err(Error::Unavailable)
    }
    /// Whether the original request may be sent once more. Policy, the seller mandate and the
    /// house mandate re-run `authority()` and the shield on the step's entry state and must
    /// yield the very authority recorded; an owner ticket is never reused (park); a safe
    /// default may send again only a void; a capture is never sent after the deadline. At the
    /// deadline a void goes again under its own request id whoever decided it: the safe
    /// default (AGENTS.md invariant 3) is its authority, and no ticket is reused for it.
    fn may_resend(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        mode: Resolve,
        now: Timestamp,
    ) -> Result<bool, Error> {
        if op.resent {
            return Ok(false);
        }
        let (step, entry) = match op.operation {
            "create" => (MoneyStep::Create, DealState::Agreed),
            "authorize" => (MoneyStep::Authorize, DealState::Approved),
            "capture" => (MoneyStep::Capture, DealState::Authorized),
            _ => {
                return Ok(matches!(op.decided_by, DecidedBy::SafeDefault { .. })
                    || self.deadline_passed(deal.id, mode, now)?);
            }
        };
        let Resolve::Advance(category) = mode else {
            return Ok(false);
        };
        let authority = match op.decided_by {
            DecidedBy::Policy { .. } => Authority::Policy,
            DecidedBy::SellerMandate { .. } => Authority::SellerMandate,
            DecidedBy::HouseMandate { .. } => Authority::HouseMandate,
            DecidedBy::Human { .. } | DecidedBy::SafeDefault { .. } => return Ok(false),
        };
        let mut deal = deal.clone();
        deal.state = entry;
        let gate = (|| -> Result<bool, Error> {
            let decision = self.authority(&deal, category, authority, op.attempt, now)?;
            if decision != op.decided_by
                || !shield_allows(self.shield(&deal, now)?, &decision, step)
            {
                return Ok(false);
            }
            if step == MoneyStep::Capture && !self.capture_window_open(deal.id, op.attempt, now)? {
                return Ok(false);
            }
            Ok(true)
        })();
        match gate {
            Err(Error::Ledger(
                LedgerError::Sql(_) | LedgerError::Json(_) | LedgerError::Integrity(_),
            )) => gate,
            Err(_) => Ok(false),
            ok => ok,
        }
    }
    /// create: read the order back when its id was recorded; otherwise re-POST the original
    /// request with the same PayPal-Request-Id inside PayPal's 6-hour window, which returns the
    /// first order if one was made. Past the window with no order id it is parked.
    async fn resolve_create(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        mode: Resolve,
        now: Timestamp,
    ) -> Result<(), Error> {
        // Only a deal still SETTLING waits on its create. At a deadline the default applies
        // (EXPIRED): no buyer was sent a link, so an order made there lapses unapproved.
        if deal.state != DealState::Settling || mode == Resolve::Deadline {
            return Ok(());
        }
        // As recorded: a mandate revoked while the step is open still lets PayPal's record be read.
        let expected = self.recorded_order(deal, op.attempt)?;
        let (order, observations) = if let Some(order_id) = deal.paypal.order.clone() {
            let resource = ResourceId::new(order_id.as_str()).map_err(|_| Error::Invalid)?;
            match self.api.get_order(&resource).await {
                Ok(r) if r.value.id == order_id => (r.value, r.observations),
                Ok(r) => return self.park(deal, op, "other", &r.observations, now),
                Err(e) => return self.defer(deal, op, &e, now),
            }
        } else {
            if now.saturating_sub(op.started_at) < REQUEST_ID_KEPT_SECS && self.holds_resend(op) {
                return Ok(());
            }
            if now.saturating_sub(op.started_at) >= REQUEST_ID_KEPT_SECS
                || !self.may_resend(deal, op, mode, now)?
            {
                return self.park(deal, op, "none", &[], now);
            }
            self.record(deal, op, Finding::new("none", Outcome::Resent, &[]), now)?;
            // Only a send takes the live mandate's payee.
            match self
                .api
                .create_order(&self.expected(deal, op.attempt)?, request)
                .await
            {
                Ok(r) => (r.value, r.observations),
                Err(e) => return self.defer(deal, op, &e, now),
            }
        };
        let status = order_code(&order.status);
        let Some(url) = self.created_link(deal, &expected, &order) else {
            return self.park(deal, op, status, &observations, now);
        };
        let mut refs = deal.paypal.clone();
        refs.order = Some(order.id.clone());
        self.record(
            deal,
            op,
            Finding::new(status, Outcome::Confirmed, &observations)
                .refs(&refs)
                .event(DealEvent::SettleVerified),
            now,
        )?;
        // The approval window is counted from the first attempt: never later than PayPal's.
        self.send_settle(
            Settle {
                id: deal.id,
                attempt: op.attempt,
                order_id: order.id,
                url: &url,
                expected: &expected,
                created: op.started_at,
            },
            now,
        )?;
        Ok(())
    }
    /// The owner's one read of an open authorize (their own ticket, through
    /// [`Pipeline::authorize`]; DECISIONS 52a). It is for a step the wallet no longer reads on its
    /// own initiative: one parked for the owner, or any once the deal's deadline passed. It
    /// ignores the wallet's own limits (the read backoff, the hourly park,
    /// [`PARKED_READ_WINDOW_SECS`]) and records what PayPal shows through `resolve_authorize`, as
    /// the wallet's read at that time would, except that it never sends the authorize again and
    /// never ends the deal unread. The only PayPal call is the GET of the order. A read that fails
    /// is `Unavailable`, keeps its call (`defer`) and leaves the wallet's schedule as it was. The
    /// ticket is spent whether or not the read succeeds; a refusal before the read spends nothing.
    pub(super) async fn owner_read_authorize(
        &mut self,
        deal: &Deal,
        attempt: u8,
        category: Category,
        ticket: crate::OwnerTicket,
        now: Timestamp,
    ) -> Result<(), Error> {
        // Checked as for any owner decision on this deal; unlike a money step it needs no mandate
        // or shield verdict, as nothing is decided and nothing moves.
        self.approval
            .validate(&ticket, deal.id, deal.terms.hash()?, attempt, now)?;
        let at_deadline = self.deadline_passed(deal.id, Resolve::Deadline, now)?;
        // A live call (a `pending` reservation not yet stale) is not listed, so it is never read
        // under the owner's ticket; nor is a step still settling at PayPal, nor one the wallet
        // still reads itself before the deadline.
        let Some(op) = self
            .open_operations(Some(deal.id), now)?
            .into_iter()
            .find(|op| op.operation == "authorize" && op.attempt == attempt)
        else {
            return Err(Error::Permission);
        };
        if (!op.pending && now < op.started_at.saturating_add(SETTLE_SECS))
            || !(at_deadline || op.needs_owner)
        {
            return Err(Error::Permission);
        }
        if !self
            .authorize_owner_read
            .insert((deal.id, ticket.at, ticket.generation))
        {
            return Err(Error::Permission);
        }
        let request =
            RequestId::for_operation(deal.id, attempt, "authorize").map_err(|_| Error::Invalid)?;
        if request.as_str() != op.request_id {
            return Err(LedgerError::Integrity("operation request id").into());
        }
        let mode = if at_deadline {
            Resolve::Deadline
        } else {
            Resolve::Advance(category)
        };
        self.resolve_authorize(deal, &op, &request, mode, true, now)
            .await
    }
    /// authorize: read the authorization back through the order. `owner`: the owner's one read
    /// (`owner_read_authorize`), which sends nothing again, ends nothing unread and leaves the
    /// failed-read backoff as it was.
    async fn resolve_authorize(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        mode: Resolve,
        owner: bool,
        now: Timestamp,
    ) -> Result<(), Error> {
        if deal.state != DealState::Approved {
            return Ok(());
        }
        let Some(order_id) = deal.paypal.order.clone() else {
            return self.park(deal, op, "none", &[], now);
        };
        let resource = ResourceId::new(order_id.as_str()).map_err(|_| Error::Invalid)?;
        // A failed read is never taken as an answer: it keeps its PayPal call (`defer`) and only
        // pushes the next read out (the rescue path's backoff, then hourly). It ends, voids,
        // sends and counts nothing; the deal stays APPROVED with the step open.
        let r = match self.api.get_order(&resource).await {
            Ok(r) => {
                self.rescue_read_backoff.remove(&op.request_id);
                r
            }
            Err(e) => {
                if !owner {
                    self.deadline_read_failed(&op.request_id, now);
                }
                return self.defer(deal, op, &e, now);
            }
        };
        if let Some(authorization) =
            self.verified_authorization(deal, op.attempt, &order_id, &r.value)?
        {
            return self.confirm_authorization(deal, op, authorization, &r.observations, now);
        }
        let status = order_code(&r.value.status);
        // The order is the deal's, still APPROVED and holds no authorization: the authorize
        // never committed.
        let untouched = r.value.id == order_id
            && r.value.status == OrderStatus::Approved
            && r.value
                .verify(&self.recorded_order(deal, op.attempt)?)
                .is_ok()
            && r.value.purchase_units[0].payments.authorizations.is_empty();
        if !untouched {
            // Read at the deadline UNREAD_AUTHORIZE_SECS after the first attempt and still no
            // record a check accepts: the deal ends on its deadline's safe default and nothing is
            // sent (no authorization id was verified to void). The step stays parked for the
            // owner, who looks at the payment in PayPal.
            if !owner
                && self.deadline_passed(deal.id, mode, now)?
                && now >= op.started_at.saturating_add(UNREAD_AUTHORIZE_SECS)
            {
                // A first park keeps this read with its row; a step parked earlier keeps it here.
                let calls = if op.needs_owner {
                    self.calls(deal.id, &r.observations, now)?
                } else {
                    self.park(deal, op, status, &r.observations, now)?;
                    Vec::new()
                };
                self.wallet
                    .ledger
                    .end_unread_authorize(deal.id, &op.request_id, &calls, now)?;
                return Ok(());
            }
            return self.park(deal, op, status, &r.observations, now);
        }
        if mode == Resolve::Deadline {
            return self.record(
                deal,
                op,
                Finding::new(status, Outcome::Absent, &r.observations),
                now,
            );
        }
        // The owner's ticket is not an authority to send: what the wallet would send again
        // waits, parked, for the deadline's read.
        if owner {
            return self.park(deal, op, status, &r.observations, now);
        }
        if self.holds_resend(op) {
            return Ok(());
        }
        if !self.may_resend(deal, op, mode, now)? {
            return self.park(deal, op, status, &r.observations, now);
        }
        self.record(
            deal,
            op,
            Finding::new(status, Outcome::Resent, &r.observations),
            now,
        )?;
        let r = match self.api.authorize(&resource, request).await {
            Ok(r) => r,
            Err(e) => return self.defer(deal, op, &e, now),
        };
        match self.verified_authorization(deal, op.attempt, &order_id, &r.value)? {
            Some(authorization) => {
                self.confirm_authorization(deal, op, authorization, &r.observations, now)
            }
            None => self.park(deal, op, order_code(&r.value.status), &r.observations, now),
        }
    }
    fn confirm_authorization(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        authorization: String,
        observations: &[Observation],
        now: Timestamp,
    ) -> Result<(), Error> {
        let mut refs = deal.paypal.clone();
        refs.authorization = Some(authorization);
        self.record(
            deal,
            op,
            Finding::new("CREATED", Outcome::Confirmed, observations)
                .refs(&refs)
                .event(DealEvent::AuthorizationConfirmed),
            now,
        )?;
        // The honor period is counted from the first attempt: never later than PayPal's.
        self.wallet.ledger.set_deadline(
            deal.id,
            op.started_at.saturating_add(72 * 3600),
            Some(op.started_at),
            now,
        )?;
        Ok(())
    }
    /// capture and void: read the authorization back.
    // UNVERIFIED: the authorization status values CREATED, CAPTURED and VOIDED and their
    // meaning are recalled from the Payments v2 spec, not quoted in .research; any other
    // status is parked for the owner.
    async fn resolve_payment(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        mode: Resolve,
        now: Timestamp,
    ) -> Result<(), Error> {
        let captured = matches!(deal.state, DealState::Captured | DealState::Receipted);
        if deal.state != DealState::Authorized && !(op.operation == "capture" && captured) {
            return Ok(());
        }
        let Some(authorization) = deal.paypal.authorization.clone() else {
            return self.park(deal, op, "none", &[], now);
        };
        let resource = ResourceId::new(authorization.as_str()).map_err(|_| Error::Invalid)?;
        // A failed read is never taken as an answer: it keeps its PayPal call (`defer`) and only
        // pushes the next read out (the rescue path's backoff, then hourly, DECISIONS 52b). It
        // captures, voids, sends, ends and counts nothing; the deal keeps its state, the step open.
        let r = match self.api.get_authorization(&resource).await {
            Ok(r) => r,
            Err(e) => {
                self.deadline_read_failed(&op.request_id, now);
                return self.defer(deal, op, &e, now);
            }
        };
        let observed = r.value.status.as_str();
        // A read that succeeded clears the count; a capture PayPal shows CAPTURED is read once
        // more through the order (`confirm_capture`), which clears or counts it then.
        let confirming = op.operation == "capture"
            && observed == "CAPTURED"
            && !captured
            && !self.signer_missing
            && r.value.id == authorization
            && r.value.amount.money().ok() == Some(deal.terms.amount()?);
        if !confirming {
            self.rescue_read_backoff.remove(&op.request_id);
        }
        if r.value.id != authorization || r.value.amount.money().ok() != Some(deal.terms.amount()?)
        {
            return self.park(deal, op, observed, &r.observations, now);
        }
        match (op.operation, observed) {
            ("capture", "CAPTURED") if captured => self.record(
                deal,
                op,
                Finding::new(observed, Outcome::Confirmed, &r.observations),
                now,
            ),
            // The receipt it confirms is signed with the deal's agent key: without it, wait.
            ("capture", "CAPTURED") if self.signer_missing => Ok(()),
            ("capture", "CAPTURED") => self.confirm_capture(deal, op, r.observations, now).await,
            ("capture", "VOIDED") if !captured => self.record(
                deal,
                op,
                Finding::new(observed, Outcome::Absent, &r.observations),
                now,
            ),
            ("capture", "CREATED") if !captured => {
                let due = self
                    .wallet
                    .ledger
                    .deadline(deal.id)?
                    .ok_or(Error::Invalid)?
                    .0;
                // At or after the deadline a capture is never sent again: the safe default
                // (a void) follows instead.
                if mode == Resolve::Deadline || now >= due {
                    return self.record(
                        deal,
                        op,
                        Finding::new(observed, Outcome::Absent, &r.observations),
                        now,
                    );
                }
                if self.holds_resend(op) {
                    return Ok(());
                }
                if !self.may_resend(deal, op, mode, now)? {
                    return self.park(deal, op, observed, &r.observations, now);
                }
                self.record(
                    deal,
                    op,
                    Finding::new(observed, Outcome::Resent, &r.observations),
                    now,
                )?;
                let p = match self
                    .api
                    .capture(&resource, deal.terms.amount()?, request)
                    .await
                {
                    Ok(p) => p,
                    Err(e) => return self.defer(deal, op, &e, now),
                };
                if !Self::verified_capture(deal, &p.value)? {
                    return self.park(deal, op, "other", &p.observations, now);
                }
                let mut refs = deal.paypal.clone();
                refs.capture = Some(p.value.id.clone());
                self.record(
                    deal,
                    op,
                    Finding::new("COMPLETED", Outcome::Confirmed, &p.observations)
                        .refs(&refs)
                        .event(DealEvent::CaptureConfirmed),
                    now,
                )?;
                self.send_receipt(deal.id, p.value.id, now)?;
                Ok(())
            }
            ("void", "VOIDED") => {
                let event = self.void_event(deal, op)?;
                self.record(
                    deal,
                    op,
                    Finding::new(observed, Outcome::Confirmed, &r.observations).event(event),
                    now,
                )
            }
            ("void", "CREATED") => {
                // A void is never sent beside a capture whose outcome is still unknown.
                if self
                    .open_operations(Some(deal.id), now)?
                    .iter()
                    .any(|o| o.operation == "capture")
                {
                    return Ok(());
                }
                if !self.may_resend(deal, op, mode, now)? {
                    return self.park(deal, op, observed, &r.observations, now);
                }
                self.record(
                    deal,
                    op,
                    Finding::new(observed, Outcome::Resent, &r.observations),
                    now,
                )?;
                let v = match self.api.void(&resource, request).await {
                    Ok(v) => v,
                    Err(e) => return self.defer(deal, op, &e, now),
                };
                let event = self.void_event(deal, op)?;
                self.record(
                    deal,
                    op,
                    Finding::new("VOIDED", Outcome::Confirmed, &v.observations).event(event),
                    now,
                )
            }
            _ => self.park(deal, op, observed, &r.observations, now),
        }
    }
    /// A capture the authorization shows CAPTURED: its id comes from the order's captures,
    /// held to the same checks as a capture answer.
    // UNVERIFIED: that GET /v2/checkout/orders/{id} of an AUTHORIZE order lists the capture
    // under purchase_units[].payments.captures once the authorization is captured.
    async fn confirm_capture(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        mut observations: Vec<Observation>,
        now: Timestamp,
    ) -> Result<(), Error> {
        let Some(order_id) = deal.paypal.order.clone() else {
            return self.park(deal, op, "CAPTURED", &observations, now);
        };
        let resource = ResourceId::new(order_id.as_str()).map_err(|_| Error::Invalid)?;
        let r = match self.api.get_order(&resource).await {
            Ok(r) => {
                self.rescue_read_backoff.remove(&op.request_id);
                r
            }
            Err(e) => {
                // Counted with the authorization's read: the capture is still unread.
                self.deadline_read_failed(&op.request_id, now);
                observations.extend_from_slice(e.observations());
                self.record(
                    deal,
                    op,
                    Finding::new("CAPTURED", Outcome::Deferred, &observations),
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        observations.extend(r.observations);
        let capture = match r.value.purchase_units.first() {
            Some(unit)
                if r.value.id == order_id
                    && r.value
                        .verify(&self.recorded_order(deal, op.attempt)?)
                        .is_ok()
                    && unit.payments.captures.len() == 1 =>
            {
                Some(&unit.payments.captures[0])
            }
            _ => None,
        };
        let Some(capture) = capture.filter(|c| Self::verified_capture(deal, c).unwrap_or(false))
        else {
            return self.park(deal, op, "CAPTURED", &observations, now);
        };
        let capture_id = capture.id.clone();
        let mut refs = deal.paypal.clone();
        refs.capture = Some(capture_id.clone());
        self.record(
            deal,
            op,
            Finding::new("CAPTURED", Outcome::Confirmed, &observations)
                .refs(&refs)
                .event(DealEvent::CaptureConfirmed),
            now,
        )?;
        self.send_receipt(deal.id, capture_id, now)?;
        Ok(())
    }
    /// The event a confirmed void applies, as `auto_void` and `owner_void` chose it: a safe
    /// default taken at the deal's deadline is AUTO_VOIDED; an owner's or a held one VOIDED.
    fn void_event(&self, deal: &Deal, op: &OpenOperation) -> Result<DealEvent, Error> {
        let due = self.wallet.ledger.deadline(deal.id)?.map(|d| d.0);
        Ok(match op.decided_by {
            DecidedBy::SafeDefault { deadline } if Some(deadline) == due => DealEvent::AutoVoid,
            _ => DealEvent::Void,
        })
    }
}
