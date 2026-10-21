//! The deadline and resolve paths of the rescue flow: what a deal does when its deadline passes,
//! and how the open invoice steps of a deal are read back.

use super::*;

impl Pipeline {
    /// A rescue deal's deadline: nothing is sent and nothing is collected. An unapproved fix
    /// lapses (PayPal retries by itself); a draft never sent expires; a sent invoice is read
    /// once more, then expires if it is not paid. A send whose answer is still unknown keeps the
    /// deal open: that invoice may be with the subscriber. A sent invoice ends at its deadline
    /// only after a read shows it unpaid, and without the invoicing client or the deal's agent
    /// key it waits until they come back.
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
        if let Some(open) = self
            .wallet
            .ledger
            .open_operations(Some(id), Timestamp::MAX)?
            .first()
        {
            if open.operation == "invoice-create" && deal.state == DealState::Settling {
                // A draft is never shown to anyone: nobody was asked to pay.
                self.wallet.ledger.record_resolution(Resolution {
                    id,
                    request_id: &open.request_id,
                    observed: "none",
                    outcome: Outcome::Absent,
                    calls: &[],
                    refs: None,
                    event: None,
                    at: now,
                })?;
                self.wallet.ledger.apply_deadline_default(id, now)?;
                return Ok(true);
            }
            return Ok(false);
        }
        if deal.state == DealState::AwaitingApproval {
            // A sent invoice is never expired unread: without the client, or while PayPal
            // cannot be read, it waits. A read that fails backs off (never under the poll
            // cadence) and, after RESCUE_READ_ATTEMPTS in a row, is parked and
            // read once an hour; it is still never expired unread.
            if self.secondary.is_none() {
                return Ok(false);
            }
            // The wallet's own reads end PARKED_READ_WINDOW_SECS after the deadline (a durable
            // time, so a restart does not reopen it). The deal then stays open and unread, never
            // expired. Only the owner's ticket reaches a read of it, once per ticket
            // (`rescue_owner_read`, through `rescue_approve`).
            if now.saturating_sub(due) >= PARKED_READ_WINDOW_SECS {
                return Ok(false);
            }
            let key = format!("deadline-read:{id}");
            let waits = self
                .rescue_read_backoff
                .get(&key)
                .is_some_and(|(_, next)| now < *next);
            let due_poll = self.rescue_polled.get(&id).map_or_else(
                || !self.read_floor_holds(now),
                |at| now.saturating_sub(*at) >= RESCUE_POLL_SECS,
            );
            if waits || !due_poll {
                return Ok(false);
            }
            match self.rescue_poll(id, now).await {
                Ok(true) => {
                    self.rescue_read_backoff.remove(&key);
                    return Ok(true);
                }
                Ok(false) => {
                    self.rescue_read_backoff.remove(&key);
                }
                Err(Error::Unavailable) => {
                    self.deadline_read_failed(&key, now);
                    return Ok(false);
                }
                Err(e) => return Err(e),
            }
        }
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state.pre_capture() && !deal.state.terminal() {
            self.wallet.ledger.apply_deadline_default(id, now)?;
            return Ok(true);
        }
        Ok(false)
    }

    /// A read past a deadline failed (its PayPal call is already kept): a sent invoice's, keyed
    /// `deadline-read:{deal id}`, or a lost authorize's order or a lost capture or void's
    /// authorization, keyed by its request id (`resolve_authorize`, `resolve_payment`, which count
    /// their failed reads before the deadline too). The next read waits out a capped exponential
    /// backoff with jitter, never shorter than the poll cadence ([`RESCUE_POLL_SECS`]). At
    /// [`RESCUE_READ_ATTEMPTS`] failures in a row it is parked and read once per
    /// [`PARKED_READ_SECS`] from then on. Nothing is expired, cancelled, sent, voided or counted.
    /// The entry is bounded (`note_read_backoff`, DECISIONS 52b).
    pub(crate) fn deadline_read_failed(&mut self, key: &str, now: Timestamp) {
        let before = self.rescue_read_backoff.get(key).map_or(0, |(n, _)| *n);
        let fails = (before + 1).min(RESCUE_READ_ATTEMPTS);
        let wait = if fails >= RESCUE_READ_ATTEMPTS {
            PARKED_READ_SECS
        } else {
            let jitter = jitter_of(self.rescue_jitter_seed, key, fails);
            rescue_read_backoff(fails, jitter).max(RESCUE_POLL_SECS)
        };
        self.note_read_backoff(key, (fails, now.saturating_add(wait)), now);
    }

    /// Reads back every open invoice step of a rescue deal, oldest first, and stops at the first
    /// that cannot be read this time. With an owner ticket (a fresh decision in the approval
    /// window) a parked send PayPal shows not done may go again, once. `true` when nothing is
    /// left open.
    pub(crate) async fn rescue_resolve(
        &mut self,
        id: DealId,
        mut ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<bool, Error> {
        for op in self.open_operations(Some(id), now)? {
            if op.needs_owner && ticket.is_none() {
                // A parked send waits for the owner until the fix's deadline or the request id's
                // window ends; then it is read (once an hour), so a draft closes not done.
                let due = self
                    .wallet
                    .ledger
                    .deadline(id)?
                    .map(|(due, _)| due)
                    .filter(|due| *due <= now);
                let ends = op.operation == "invoice-send"
                    && (due.is_some() || now.saturating_sub(op.started_at) >= REQUEST_ID_KEPT_SECS);
                if !ends {
                    continue;
                }
                // The hourly reads began at the earlier of the two ends and stop a window later,
                // measured from those durable times; after it only an owner ticket reads.
                let began = due
                    .unwrap_or(Timestamp::MAX)
                    .min(op.started_at.saturating_add(REQUEST_ID_KEPT_SECS));
                if now.saturating_sub(began) >= PARKED_READ_WINDOW_SECS {
                    continue;
                }
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
            if !op.pending && ticket.is_none() && now < op.started_at.saturating_add(SETTLE_SECS) {
                break;
            }
            // A step whose last read failed waits out its backoff; an owner ticket does not. With
            // no entry it waits only for the floor after the cap dropped one.
            if ticket.is_none()
                && self
                    .rescue_read_backoff
                    .get(&op.request_id)
                    .map_or_else(|| self.read_floor_holds(now), |(_, next)| now < *next)
            {
                break;
            }
            let deal = self.wallet.ledger.get_deal(id)?;
            self.resolve_invoice(&deal, &op, ticket.take(), now).await?;
        }
        Ok(self.open_operations(Some(id), now)?.is_empty())
    }

    /// A read-back of a lost step failed: the next try waits (capped exponential backoff with
    /// jitter, per request id). After [`RESCUE_READ_ATTEMPTS`] failures the step is parked for
    /// the owner, the one terminal needs-attention state: it is not read on the backoff again,
    /// and nothing is created, sent, captured or voided; only a fresh owner ticket moves it.
    pub(super) fn read_failed(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        observations: &[Observation],
        now: Timestamp,
    ) -> Result<(), Error> {
        // Already parked (the hourly read past its window, or an owner's ticket): nothing to
        // count toward, and parking again would write nothing, so the failed read's PayPal call
        // would be lost. It is kept like any other failure.
        if op.needs_owner {
            self.rescue_read_backoff.remove(&op.request_id);
            return self.wait(deal, op, observations, now);
        }
        let fails = self
            .rescue_read_backoff
            .get(&op.request_id)
            .map_or(0, |(n, _)| *n)
            + 1;
        if fails >= RESCUE_READ_ATTEMPTS {
            self.rescue_read_backoff.remove(&op.request_id);
            return self.park(deal, op, "none", observations, now);
        }
        let jitter = jitter_of(self.rescue_jitter_seed, &op.request_id, fails);
        self.note_read_backoff(
            &op.request_id,
            (
                fails,
                now.saturating_add(rescue_read_backoff(fails, jitter)),
            ),
            now,
        );
        self.wait(deal, op, observations, now)
    }
}
