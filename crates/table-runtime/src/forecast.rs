//! Walk-away forecast inputs: what the scheduler would do to every open deal if the owner does
//! nothing, read from the ledger and the pipeline's own gates.
use crate::{Runtime, app};
use std::sync::Arc;
use table_app::{Authority, MoneyStep};
use table_attention::{ForecastContext, ForecastLine, ForecastSource};
use table_client::CommandError;
use table_core::*;

/// The forecast looks this far ahead.
pub(crate) const FORECAST_HORIZON_SECS: i64 = 72 * 3600;

/// What the forecast reads of one open deal that only a ledger write can change: the row, its
/// deadline, the owner's "let it lapse", whether its mandate still stands, its label number, its
/// amount and its seller-attested receipt time. Nothing here depends on the clock.
#[derive(Debug, Clone)]
pub(crate) struct ForecastFacts {
    deal: Deal,
    deadline: Option<Timestamp>,
    lapse_chosen: bool,
    mandate_retired: bool,
    display_number: u32,
    amount: Money,
    receipt_at: Option<Timestamp>,
}

/// The facts of every deal the forecast covers, as read at one ledger change stamp
/// (`Ledger::change_stamp`) under one owner key. While both still hold nothing was written, so
/// every fact is the same and the reads are skipped.
///
/// What depends on the clock is never kept here: the pipeline's gates (judged at `now` on every
/// read, with the signer selected first as the scheduler does) and the walk-away fold itself
/// (`table_attention::forecast`, which places every deadline against `now`). So a deadline that
/// passes between two reads with no write changes the second read's lines exactly as an
/// uncached read would.
#[derive(Debug, Clone)]
pub(crate) struct ForecastCache {
    stamp: (u64, i64),
    owner: [u8; 32],
    facts: Arc<[ForecastFacts]>,
}

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
        let facts = self.forecast_facts()?;
        let mut sources = Vec::with_capacity(facts.len());
        for fact in facts.iter() {
            sources.push(self.forecast_source(fact, now, ctx.horizon_secs)?);
        }
        Ok(table_attention::forecast(&sources, &ctx))
    }
    /// The facts of every open deal, from the cache while the ledger's change stamp and the owner
    /// key are the ones it was read at; otherwise read again. The stamp is taken before the
    /// reads, so a write landing during them makes the next call read again. A failed read keeps
    /// nothing.
    fn forecast_facts(&mut self) -> Result<Arc<[ForecastFacts]>, CommandError> {
        let stamp = self.pipeline.wallet.ledger.change_stamp().ok();
        let owner = self.pipeline.wallet.owner_public_key().to_bytes();
        if let (Some(stamp), Some(cache)) = (stamp, &self.forecast_cache)
            && cache.stamp == stamp
            && cache.owner == owner
        {
            return Ok(cache.facts.clone());
        }
        self.forecast_cache = None;
        let mut facts = Vec::new();
        for deal in app(self.pipeline.wallet.ledger.list_live_deals())? {
            // A deal whose money step is being checked with PayPal is forecast nothing: no step
            // runs and no default is promised until PayPal's record settles it (T10).
            if deal.mode == Mode::Replay
                || deal.state.terminal()
                || self.pipeline.has_open_operation(deal.id)?
            {
                continue;
            }
            facts.push(self.forecast_fact(deal)?);
        }
        let facts: Arc<[ForecastFacts]> = facts.into();
        if let Some(stamp) = stamp {
            self.forecast_cache = Some(ForecastCache {
                stamp,
                owner,
                facts: facts.clone(),
            });
        }
        Ok(facts)
    }
    fn forecast_fact(&self, deal: Deal) -> Result<ForecastFacts, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        Ok(ForecastFacts {
            deadline: app(ledger.deadline(deal.id))?.map(|d| d.0),
            lapse_chosen: app(ledger.preference::<bool>(&format!("lapse.{}", deal.id)))?
                .unwrap_or(false),
            mandate_retired: self.mandate_retired(&deal)?,
            display_number: app(ledger.display_number(deal.id))?,
            amount: deal.terms.amount().map_err(table_app::Error::from)?,
            receipt_at: app(ledger.seller_attested_receipt_at(deal.id))?,
            deal,
        })
    }
    /// One deal's forecast input at `now`: its cached facts, and the pipeline's gates judged at
    /// `now` (never cached: a market reference ages, a mandate expires, a window closes).
    fn forecast_source(
        &mut self,
        fact: &ForecastFacts,
        now: Timestamp,
        horizon_secs: i64,
    ) -> Result<ForecastSource, CommandError> {
        let deal = &fact.deal;
        let deadline = fact.deadline;
        let lapse_chosen = fact.lapse_chosen;
        let mandate_retired = fact.mandate_retired;
        let mut policy_create_allowed = false;
        let mut seller_mandate_until = None;
        // The scheduler selects the deal's signer before its pipeline calls; without one every
        // gate refuses, and so does the scheduler. Only the states below have a gate, so the
        // signer is selected only for them.
        if deal.side == Side::Seller
            && matches!(
                deal.state,
                DealState::Agreed
                    | DealState::AwaitingApproval
                    | DealState::Approved
                    | DealState::Authorized
            )
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
            display_number: fact.display_number,
            state: deal.state,
            side: deal.side,
            kind: deal.kind,
            delivery: deal.terms.delivery.clone(),
            amount: fact.amount,
            deadline,
            mode: deal.mode,
            lapse_chosen,
            mandate_retired,
            policy_create_allowed,
            seller_mandate_until,
            receipt_at: fact.receipt_at,
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
    ///   the deal's agreement; the velocity window is the deal's own agreement day;
    /// - the market-watch rule (T15) never refreshes a seller deal past Agreed
    ///   (`table_core::market_watch_open`), so no new reference lands inside this window.
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
