//! Subscription rescue in the shell: the owner's labelled replay of a failed renewal, the
//! rescue read for the Rescue page and the approval window, and the scheduler's rescue pass.
//! The money steps live in table-app `rescue.rs`; nothing here calls PayPal itself.
use crate::{Runtime, app, invalid};
use table_client::*;
use table_core::*;
use table_ledger::Recipient;

/// The plain-words refusal when no signed rescue rules exist.
pub const NO_RESCUE_RULES: &str = "Sign rules for fixing failed renewals first.";
/// The plain-words refusal of a decision on a fix whose one invoice send already ended.
pub const RESCUE_ENDED: &str = "This fix already ended; nothing was sent.";
/// The plain-words refusal of one watch too many.
pub const WATCH_FULL: &str =
    "You're watching as many subscriptions as your wallet reads. Stop watching one first.";
/// The plain-words refusal of stopping a subscription that is not watched.
pub const NOT_WATCHED: &str = "That subscription isn't being watched.";

impl Runtime {
    /// The active mandate whose rules allow rescue, if any (the latest one signed).
    fn rescue_mandate(&self) -> Result<Option<OpenMandate>, CommandError> {
        let owner = self.owner()?.verifying_key();
        Ok(app(self.pipeline.wallet.ledger.list_mandates(&owner))?
            .into_iter()
            .filter(|m| m.refusal.is_none() && lever_clause(&m.mandate.payload).is_some())
            .map(|m| m.mandate)
            .next_back())
    }

    /// Record a failed renewal the owner replays (labelled REPLAY) and open its rescue under the
    /// signed rescue rules. The new deal is selected in the approval window.
    pub(crate) fn rescue_replay(&mut self, args: RescueReplayArgs) -> Result<Deal, CommandError> {
        let Some(mandate) = self.rescue_mandate()? else {
            return Err(CommandError {
                code: ErrorCode::Invalid,
                message: NO_RESCUE_RULES.into(),
            });
        };
        let recipient = Recipient::new(args.subscriber_email.trim()).map_err(|_| CommandError {
            code: ErrorCode::Invalid,
            message: "That is not an email address.".into(),
        })?;
        if !table_ledger::valid_subscription_id(&args.subscription_id) {
            return Err(CommandError {
                code: ErrorCode::Invalid,
                message: "That is not a PayPal subscription id.".into(),
            });
        }
        self.select_agent(mandate.payload.agent_key)?;
        let now = self.clock.now();
        let id = DealId(ulid::Ulid::new());
        let deal = self.pipeline.rescue_open(
            id,
            &table_app::RenewalFailure {
                source: RescueSource::Replay,
                subscription_id: args.subscription_id,
                recipient,
                plan: args.plan,
                cycle: args.amount,
                failed_payments: 1,
                failed_at: now,
                next_retry_at: None,
            },
            (mandate.payload.id, mandate.payload.version),
            now,
        )?;
        self.selected = Some(deal.id);
        self.selected_pairing = None;
        self.approval_target = Some(ApprovalTarget::Deal);
        self.approval_draft = None;
        Ok(deal)
    }

    /// The rescue view of one deal; None for a deal that is not a rescue.
    pub(crate) fn rescue_view(&self, id: DealId) -> Result<Option<RescueView>, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let Some(case) = app(ledger.rescue_case(id))? else {
            return Ok(None);
        };
        let deal = app(ledger.get_deal(id))?;
        Ok(Some(RescueView {
            deal_id: id,
            source: case.source,
            text: invoice_text(&case.offer),
            offer: case.offer,
            failed_payments: case.failed_payments,
            next_retry_at: case.next_retry_at,
            recipient: case.recipient.masked(),
            invoice: deal.paypal.order,
            counted: app(ledger.rescue_counted(id))?,
        }))
    }

    pub(crate) fn rescue_book(&self) -> Result<RescueBook, CommandError> {
        let mut cases = Vec::new();
        for deal in app(self.pipeline.wallet.ledger.list_deals())? {
            if deal.kind == DealKind::Rescue
                && let Some(view) = self.rescue_view(deal.id)?
            {
                cases.push(view);
            }
        }
        Ok(RescueBook {
            cases,
            recovered: app(self.pipeline.wallet.ledger.rescue_recovered())?,
            watching: self.rescue_watch_views()?,
            watch_reads_today: app(self
                .pipeline
                .wallet
                .ledger
                .rescue_watch_reads_today(self.clock.now()))?,
            watch_reads_max: RESCUE_WATCH_READS_DAY,
        })
    }

    /// The owner's watch list, masked, with what the wallet last learned of each.
    fn rescue_watch_views(&self) -> Result<Vec<RescueWatchView>, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        app(ledger.rescue_watches())?
            .into_iter()
            .map(|w| {
                let state = match w.last_failed {
                    _ if w.tries > 0 => RescueWatchState::CantRead,
                    None => RescueWatchState::Waiting,
                    Some(0) => RescueWatchState::Paid,
                    Some(_) if app(ledger.rescue_watch_handled(&w.subscription_id))? => {
                        RescueWatchState::FixOpened
                    }
                    Some(_) => RescueWatchState::FailedNoFix,
                };
                Ok(RescueWatchView {
                    recipient: w.recipient.masked(),
                    subscription_id: w.subscription_id,
                    plan: w.plan,
                    state,
                    added_at: w.added_at,
                    last_read_at: w.last_read_at,
                    next_read_at: w.next_read_at,
                })
            })
            .collect()
    }

    /// The owner adds a subscription to watch (approval window, privileged). Only under signed
    /// rescue rules; nothing is read here: the scheduler's next pass reads it.
    pub(crate) fn rescue_watch_add(
        &mut self,
        args: RescueWatchArgs,
    ) -> Result<Vec<RescueWatchView>, CommandError> {
        if self.rescue_mandate()?.is_none() {
            return Err(CommandError {
                code: ErrorCode::Invalid,
                message: NO_RESCUE_RULES.into(),
            });
        }
        let recipient = Recipient::new(args.subscriber_email.trim()).map_err(|_| CommandError {
            code: ErrorCode::Invalid,
            message: "That is not an email address.".into(),
        })?;
        let id = args.subscription_id.trim();
        if !table_ledger::valid_subscription_id(id) {
            return Err(CommandError {
                code: ErrorCode::Invalid,
                message: "That is not a PayPal subscription id.".into(),
            });
        }
        let now = self.clock.now();
        match self.pipeline.wallet.ledger.watch_subscription(
            id,
            &recipient,
            &args.plan,
            RESCUE_WATCH_MAX,
            now,
        ) {
            Ok(()) => {}
            Err(table_ledger::LedgerError::Conflict) => {
                return Err(CommandError {
                    code: ErrorCode::Invalid,
                    message: WATCH_FULL.into(),
                });
            }
            Err(e) => return app(Err(e)),
        }
        self.rescue_watch_views()
    }

    /// The owner stops watching a subscription (approval window, privileged).
    pub(crate) fn rescue_watch_stop(
        &mut self,
        args: &RescueWatchStopArgs,
    ) -> Result<Vec<RescueWatchView>, CommandError> {
        let now = self.clock.now();
        match self
            .pipeline
            .wallet
            .ledger
            .stop_watching(args.subscription_id.trim(), now)
        {
            Ok(()) => {}
            Err(table_ledger::LedgerError::NotFound) => {
                return Err(CommandError {
                    code: ErrorCode::Invalid,
                    message: NOT_WATCHED.into(),
                });
            }
            Err(e) => return app(Err(e)),
        }
        self.rescue_watch_views()
    }

    /// The scheduler's watch pass: reads due watched subscriptions from PayPal (GET only), at most
    /// [`RESCUE_WATCH_PER_TICK`] a tick and [`RESCUE_WATCH_READS_DAY`] a UTC day, under the newest
    /// signed rescue rules. A failure opens its one fix (table-app `rescue_watch_read`); the fix
    /// waits for the owner's decision. Nothing runs while agents are paused, without rescue
    /// rules, or without the PayPal connection.
    pub(crate) async fn tick_rescue_watch(&mut self, now: i64) -> Result<(), CommandError> {
        if self.paused || self.secondary.is_none() {
            return Ok(());
        }
        let ledger = &self.pipeline.wallet.ledger;
        if app(ledger.rescue_watch_reads_today(now))? >= RESCUE_WATCH_READS_DAY {
            return Ok(());
        }
        let due = app(ledger.due_rescue_watches(now, RESCUE_WATCH_PER_TICK))?;
        if due.is_empty() {
            return Ok(());
        }
        let Some(mandate) = self.rescue_mandate()? else {
            return Ok(());
        };
        // The fix is computed under the rules' own agent key; without it nothing is read.
        if self.select_agent(mandate.payload.agent_key).is_err() {
            return Ok(());
        }
        let rules = (mandate.payload.id, mandate.payload.version);
        for watch in due {
            let id = DealId(ulid::Ulid::new());
            match self
                .pipeline
                .rescue_watch_read(&watch, id, rules, RESCUE_WATCH_READS_DAY, now)
                .await
            {
                // Over the day's budget, or rules not in force now: nothing more this tick.
                Ok(table_app::WatchRead::OverBudget) | Err(table_app::Error::Permission) => break,
                Ok(_) => {}
                Err(e) => return Err(e.into()),
            }
        }
        Ok(())
    }

    /// Whether the owner's approve is the next step: a fix waiting at AGREED, or a made invoice
    /// never sent and no step still being checked with PayPal.
    pub(crate) fn rescue_releasable(&self, deal: &Deal) -> Result<bool, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let open = self.pipeline.has_open_operation(deal.id)?;
        let live = app(ledger.deadline(deal.id))?.is_some_and(|(due, _)| due > self.clock.now());
        Ok(live
            && !open
            && match deal.state {
                DealState::Agreed => true,
                // A send that already ended (closed not done) is never offered again.
                DealState::Settling => {
                    deal.paypal.order.is_some()
                        && app(ledger.rescue_decision(deal.id))?.is_some()
                        && !app(ledger.rescue_send_reserved(deal.id))?
                }
                _ => false,
            })
    }

    /// The scheduler's pass over one rescue deal, any mode: read back a lost step, apply a due
    /// deadline, read a sent invoice. Never starts a create or a send.
    pub(crate) async fn tick_rescue(&mut self, deal: &Deal, now: i64) -> Result<(), CommandError> {
        // A confirmed PAID is signed with the deal's own agent key. Without it (its mandate
        // revoked, or the key gone) a lost step is still read back and a due deadline still
        // applies, but PAID waits for the key and nothing is sent (table-app `signer_missing`).
        self.pipeline.signer_missing = self.select_signer(deal.id).is_err();
        let result = self.pipeline.rescue_tick(deal.id, now).await;
        self.pipeline.signer_missing = false;
        result?;
        Ok(())
    }
}

/// Used by the dispatcher: a rescue_replay with a malformed amount or plan is INVALID.
pub(crate) fn check_replay_args(args: &RescueReplayArgs) -> Result<(), CommandError> {
    if args.amount.minor() == 0 {
        return Err(invalid());
    }
    Ok(())
}
