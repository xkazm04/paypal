//! Subscription rescue in the shell: the owner's labelled replay of a failed renewal, the
//! rescue read for the Rescue page and the approval window, and the scheduler's rescue pass.
//! The money steps live in table-app `rescue.rs`; nothing here calls PayPal itself.
use crate::{Runtime, app, invalid};
use table_client::*;
use table_core::*;
use table_ledger::Recipient;

/// The plain-words refusal when no signed rescue rules exist.
pub const NO_RESCUE_RULES: &str = "Sign rules for fixing failed renewals first.";

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
        })
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
                DealState::Settling => {
                    deal.paypal.order.is_some() && app(ledger.rescue_decision(deal.id))?.is_some()
                }
                _ => false,
            })
    }

    /// The scheduler's pass over one rescue deal, any mode: read back a lost step, apply a due
    /// deadline, read a sent invoice. Never starts a create or a send.
    pub(crate) async fn tick_rescue(&mut self, deal: &Deal, now: i64) -> Result<(), CommandError> {
        // A confirmed PAID is signed with the deal's own agent key; without it, nothing moves.
        if self.select_signer(deal.id).is_err() {
            if app(self.pipeline.wallet.ledger.deadline(deal.id))?
                .is_some_and(|(due, _)| due <= now)
                && deal.state == DealState::Agreed
            {
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .apply_deadline_default(deal.id, now))?;
            }
            return Ok(());
        }
        self.pipeline.rescue_tick(deal.id, now).await?;
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
