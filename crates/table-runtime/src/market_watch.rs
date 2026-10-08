//! Market watch (T15): the scheduler keeps a watched item's market reference fresh under the
//! owner's signed market-watch rule, within the rule's daily allowance.
//!
//! Authority: the owner chose, in a signed rule, which market product prices which item and how
//! many price checks a day the wallet may make. A check only reads market prices: no PayPal call,
//! no money step, no agent input (an agent can neither choose a product nor start a check).
//!
//! Order of a check: the actor plans it (deal open and watched, reference due, allowance left,
//! the deal still stands under its rules), records it as one `market.checked` audit row (the
//! allowance is counted from those rows, so it is never exceeded), then the fetch runs outside
//! the actor on a spawned task. Its answer comes back as a message; the actor rechecks that the
//! deal, its terms, its mandate version and the rule's product still match before storing the
//! reference exactly as an owner refresh does (`market.observed`).
use crate::{Runtime, app, market::MarketBinding, permission};
use table_client::{CommandError, MarketWatchFact};
use table_core::*;
use table_ledger::{LedgerError, MarketCheck};

/// After a failed fetch the deal waits this long before its next price check (each try counts
/// against the day's allowance).
pub(crate) const MARKET_WATCH_RETRY_SECS: i64 = 120;

/// One planned price check, already recorded, waiting for the market service's answer.
#[derive(Debug, Clone)]
pub(crate) struct WatchJob {
    pub(crate) binding: MarketBinding,
    pub(crate) item_ref: ItemRef,
    pub(crate) product_id: String,
}

impl Runtime {
    /// Plans and records the price checks due at `now`; the caller runs each fetch outside the
    /// actor and hands its answer to [`Runtime::market_watched`]. Nothing is planned without a
    /// market client and a stored market key, or while agents are paused. A deal whose facts
    /// cannot be read is not checked (fail closed: nothing is fetched).
    pub(crate) fn plan_market_watch(
        &mut self,
        now: Timestamp,
    ) -> Result<Vec<WatchJob>, CommandError> {
        if self.market.is_none() || self.paused {
            return Ok(Vec::new());
        }
        self.market_watch_retry.retain(|_, at| *at > now);
        self.market_watch_used_up
            .retain(|_, day_end| *day_end > now);
        let mut key_stored = None;
        let mut jobs = Vec::new();
        for deal in app(self.pipeline.wallet.ledger.list_deals())? {
            if let Ok(Some(job)) = self.plan_one(&deal, now, &mut key_stored) {
                jobs.push(job);
            }
        }
        Ok(jobs)
    }
    fn plan_one(
        &mut self,
        deal: &Deal,
        now: Timestamp,
        key_stored: &mut Option<bool>,
    ) -> Result<Option<WatchJob>, CommandError> {
        if deal.mode == Mode::Replay
            || deal.state.terminal()
            || !market_watch_open(deal.state, deal.side)
            || self.market_watch_busy.contains(&deal.id)
            || self
                .market_watch_retry
                .get(&deal.id)
                .is_some_and(|at| *at > now)
            || !market_refresh_due(deal.market.as_ref(), now)
        {
            return Ok(None);
        }
        // "Let it lapse" and an unknown PayPal step stop every automatic step on the deal.
        if app(self
            .pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id)))?
        .unwrap_or(false)
            || self.pipeline.has_open_operation(deal.id)?
        {
            return Ok(None);
        }
        let mandate = match self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ) {
            Ok(m) => m,
            // A retired mandate's rule watches nothing.
            Err(LedgerError::NotFound) => return Ok(None),
            Err(e) => return app(Err(e)),
        };
        let watch = mandate.payload.market_watch_for(&deal.terms.item_ref);
        let Some((_, max_per_day)) = watch else {
            return Ok(None);
        };
        // A used-up allowance is remembered until the day ends, so the audit log is not counted
        // again every second; a re-signed rule is a new version with its own entry.
        let rule = (deal.mandate_id, deal.mandate_version, max_per_day);
        if self
            .market_watch_used_up
            .get(&rule)
            .is_some_and(|day_end| now < *day_end)
        {
            return Ok(None);
        }
        let used = app(self
            .pipeline
            .wallet
            .ledger
            .market_checks_today(deal.mandate_id, now))?;
        if used >= u32::from(max_per_day) {
            self.market_watch_used_up
                .insert(rule, market_watch_day(now).1);
        }
        let MarketWatchStep::Refresh { product_id } = market_watch_step(
            deal.state,
            deal.side,
            watch,
            deal.market.as_ref(),
            used,
            now,
        ) else {
            return Ok(None);
        };
        if !*key_stored.get_or_insert(self.vault.read("channel3").ok().flatten().is_some()) {
            return Ok(None);
        }
        // The deal must still stand under its rules, as for the owner's own refresh.
        self.select_signer(deal.id)?;
        let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
        self.pipeline
            .wallet
            .check_mandate(deal.id, category, now)
            .map_err(|_| permission())?;
        let binding = MarketBinding {
            deal_id: deal.id,
            terms_hash: deal.terms.hash().map_err(table_app::Error::from)?,
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            currency: deal.terms.currency,
        };
        let product_id = product_id.to_owned();
        match self.pipeline.wallet.ledger.reserve_market_check(
            &MarketCheck {
                deal_id: deal.id,
                mandate_id: deal.mandate_id,
                mandate_version: deal.mandate_version,
                mandate_hash: mandate.payload.hash().map_err(table_app::Error::from)?,
                item_ref: &deal.terms.item_ref,
                product_id: &product_id,
                max_per_day,
            },
            now,
        ) {
            Ok(_) => {}
            Err(LedgerError::Conflict) => {
                self.market_watch_used_up
                    .insert(rule, market_watch_day(now).1);
                return Ok(None);
            }
            Err(e) => return app(Err(e)),
        }
        self.market_watch_busy.insert(deal.id);
        Ok(Some(WatchJob {
            binding,
            item_ref: deal.terms.item_ref.clone(),
            product_id,
        }))
    }
    /// Runs the due price checks: each fetch on its own task, outside the actor; its answer comes
    /// back to the actor as a message. Without an actor (a bare runtime) nothing is planned.
    pub(crate) fn start_market_watch(&mut self, now: Timestamp) -> Result<(), CommandError> {
        let (Some(market), Some(sender)) = (self.market.clone(), self.actor_sender.clone()) else {
            return Ok(());
        };
        for job in self.plan_market_watch(now)? {
            let market = market.clone();
            let sender = sender.clone();
            tokio::spawn(async move {
                let result = market
                    .comparables(&job.product_id, job.binding.currency)
                    .await;
                if let Some(sender) = sender.upgrade() {
                    let _ = sender
                        .send(crate::actor::Message::MarketWatched(Box::new(job), result))
                        .await;
                }
            });
        }
        Ok(())
    }
    /// The market service's answer to a planned check. Stored only if the deal, its terms, its
    /// mandate version and the rule's product still match; a failed fetch waits
    /// [`MARKET_WATCH_RETRY_SECS`] before the next check.
    pub(crate) fn market_watched(
        &mut self,
        job: WatchJob,
        result: Result<MarketRef, table_market::Error>,
    ) -> Result<(), CommandError> {
        let id = job.binding.deal_id;
        self.market_watch_busy.remove(&id);
        let now = self.clock.now();
        let Ok(reference) = result else {
            self.market_watch_retry
                .insert(id, now.saturating_add(MARKET_WATCH_RETRY_SECS));
            return Ok(());
        };
        if !self.market_watch_still_bound(&job, now)? {
            return Ok(());
        }
        match self
            .pipeline
            .wallet
            .ledger
            .store_market_reference(id, &reference, now)
        {
            Ok(()) => {
                self.market_watch_retry.remove(&id);
                Ok(())
            }
            // An answer in another currency or from the future is not stored.
            Err(LedgerError::Conflict | LedgerError::Domain(_)) => {
                self.market_watch_retry
                    .insert(id, now.saturating_add(MARKET_WATCH_RETRY_SECS));
                Ok(())
            }
            Err(e) => app(Err(e)),
        }
    }
    fn market_watch_still_bound(
        &mut self,
        job: &WatchJob,
        now: Timestamp,
    ) -> Result<bool, CommandError> {
        let deal = app(self.pipeline.wallet.ledger.get_deal(job.binding.deal_id))?;
        if deal.mode == Mode::Replay
            || deal.state.terminal()
            || !market_watch_open(deal.state, deal.side)
            || deal.terms.item_ref != job.item_ref
            || deal.terms.hash().map_err(table_app::Error::from)? != job.binding.terms_hash
            || deal.mandate_id != job.binding.mandate_id
            || deal.mandate_version != job.binding.mandate_version
            || deal.terms.currency != job.binding.currency
        {
            return Ok(false);
        }
        let mandate = match self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ) {
            Ok(m) => m,
            Err(LedgerError::NotFound) => return Ok(false),
            Err(e) => return app(Err(e)),
        };
        if mandate
            .payload
            .market_watch_for(&deal.terms.item_ref)
            .is_none_or(|(watched, _)| watched.product_id != job.product_id)
        {
            return Ok(false);
        }
        if self.select_signer(deal.id).is_err() {
            return Ok(false);
        }
        let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
        Ok(self
            .pipeline
            .wallet
            .check_mandate(deal.id, category, now)
            .is_ok())
    }
    /// Owner facts: each rule set in force with a market-watch rule, its watched items and the
    /// day's price checks against the allowance.
    pub(crate) fn market_watch_facts(&self) -> Result<Vec<MarketWatchFact>, CommandError> {
        let now = self.clock.now();
        let mut facts = Vec::new();
        for entry in self.mandate_list()? {
            if entry.refusal.is_some() {
                continue;
            }
            let payload = &entry.mandate.payload;
            if now < payload.not_before || now >= payload.expires {
                continue;
            }
            for clause in &payload.clauses {
                if let Clause::MarketWatch {
                    items,
                    max_refreshes_day,
                } = clause
                {
                    let used = app(self
                        .pipeline
                        .wallet
                        .ledger
                        .market_checks_today(payload.id, now))?;
                    facts.push(MarketWatchFact {
                        mandate_id: payload.id,
                        mandate_version: payload.version,
                        agent: entry.agent,
                        items: items.clone(),
                        max_per_day: *max_refreshes_day,
                        used_today: used,
                        used_up: used >= u32::from(*max_refreshes_day),
                    });
                }
            }
        }
        Ok(facts)
    }
}
