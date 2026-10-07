//! Walk-away forecast inputs: what the scheduler would do to every open deal if the owner does
//! nothing, read from the ledger and the pipeline's own gates.
use crate::{Runtime, app};
use table_app::{Authority, MoneyStep};
use table_attention::{ForecastContext, ForecastLine, ForecastSource};
use table_client::CommandError;
use table_core::*;

/// The forecast looks this far ahead.
pub(crate) const FORECAST_HORIZON_SECS: i64 = 72 * 3600;

impl Runtime {
    /// Built from every deal, not from the attention sources: those skip lapse-chosen and
    /// snoozed deals, which still meet their deadline.
    pub(crate) fn forecast(&mut self, now: Timestamp) -> Result<Vec<ForecastLine>, CommandError> {
        #[cfg(test)]
        if self.fail_forecast {
            return Err(crate::unavailable("Forecast unavailable"));
        }
        let ctx = ForecastContext {
            now,
            horizon_secs: FORECAST_HORIZON_SECS,
            paused: self.paused,
            executor_configured: self.settings()?.payment_executor_configured,
        };
        let mut sources = Vec::new();
        for deal in app(self.pipeline.wallet.ledger.list_deals())? {
            if deal.mode == Mode::Replay || deal.state.terminal() {
                continue;
            }
            sources.push(self.forecast_source(&deal, now, ctx.horizon_secs)?);
        }
        Ok(table_attention::forecast(&sources, &ctx))
    }
    fn forecast_source(
        &mut self,
        deal: &Deal,
        now: Timestamp,
        horizon_secs: i64,
    ) -> Result<ForecastSource, CommandError> {
        let deadline = app(self.pipeline.wallet.ledger.deadline(deal.id))?.map(|d| d.0);
        let lapse_chosen = app(self
            .pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id)))?
        .unwrap_or(false);
        let mandate_retired = self.mandate_retired(deal)?;
        let mut policy_create_allowed = false;
        let mut seller_mandate_until = None;
        // The scheduler selects the deal's signer before its pipeline calls; without one every
        // gate refuses, and so does the scheduler.
        if deal.side == Side::Seller
            && !lapse_chosen
            && !mandate_retired
            && self.select_signer(deal.id).is_ok()
        {
            let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
            match deal.state {
                DealState::Agreed => {
                    policy_create_allowed = self.pipeline.step_allowed(
                        deal.id,
                        MoneyStep::Create,
                        category,
                        Authority::Policy,
                        now,
                        false,
                    )?;
                }
                DealState::AwaitingApproval | DealState::Approved | DealState::Authorized => {
                    let cap = deadline
                        .filter(|d| *d > now)
                        .unwrap_or(now.saturating_add(horizon_secs));
                    seller_mandate_until =
                        self.seller_mandate_window(deal.id, category, now, cap)?;
                }
                _ => {}
            }
        }
        Ok(ForecastSource {
            deal_id: deal.id,
            display_number: app(self.pipeline.wallet.ledger.display_number(deal.id))?,
            state: deal.state,
            side: deal.side,
            kind: deal.kind,
            delivery: deal.terms.delivery.clone(),
            amount: deal.terms.amount().map_err(table_app::Error::from)?,
            deadline,
            mode: deal.mode,
            lapse_chosen,
            mandate_retired,
            policy_create_allowed,
            seller_mandate_until,
        })
    }
    /// The end of the window `[now, until)` in which authorize and capture under the seller
    /// mandate pass the pipeline's gate, judged as if the deal had reached them; capped at
    /// `cap`. A binary search over the real gate finds that end without copying its rules; it
    /// is valid because, with the ledger frozen while the owner is away, this gate can only turn
    /// from pass to refusal:
    /// - the shield stops the seller mandate only on HOLD or BLOCK, and neither depends on the
    ///   time: the price rule runs on the market reference whatever its age, and a stored
    ///   verdict or payee does not age. What does age (the reference going stale, the
    ///   counterparty's first day ending) moves only between ASK and CLEAR, and both pass;
    /// - the mandate refuses from its expiry and its band deadline on, and its start lies before
    ///   the deal's agreement; the velocity window is the deal's own agreement day.
    ///
    /// A gate refusing now forecasts no money moving, so any case this misses fails closed.
    fn seller_mandate_window(
        &mut self,
        id: DealId,
        category: Category,
        now: Timestamp,
        cap: Timestamp,
    ) -> Result<Option<Timestamp>, CommandError> {
        let mut passes = |at| {
            self.pipeline.step_allowed(
                id,
                MoneyStep::Authorize,
                category,
                Authority::SellerMandate,
                at,
                true,
            )
        };
        if !passes(now)? {
            return Ok(None);
        }
        if passes(cap)? {
            return Ok(Some(cap));
        }
        let (mut pass, mut refuse) = (now, cap);
        while refuse.saturating_sub(pass) > 1 {
            let mid = pass + (refuse - pass) / 2;
            if passes(mid)? {
                pass = mid;
            } else {
                refuse = mid;
            }
        }
        Ok(Some(refuse))
    }
}
