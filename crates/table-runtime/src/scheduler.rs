//! Native deadlines and order polling continue independently of window lifetimes.
use crate::{Runtime, app};
use table_client::CommandError;
use table_core::*;
impl Runtime {
    pub async fn tick(&mut self) -> Result<(), CommandError> {
        let now = self.clock.now();
        // Deadlines are independent of pause, idle lock and the existence of any window.
        // A failed/unknown operation must never prevent processing unrelated deals.
        let deals = app(self.pipeline.wallet.ledger.list_deals())?;
        let mut failure = None;
        for deal in deals {
            if deal.mode == Mode::Replay || deal.state.terminal() {
                continue;
            }
            let result = self.tick_deal(&deal, now).await;
            if let Err(error) = result {
                failure.get_or_insert(error);
            }
        }
        // Watched items' market prices are fetched outside the actor; an answer lands on a
        // later turn of the loop, and a step it lets through runs on the tick after (T15).
        if let Err(error) = self.start_market_watch(now) {
            failure.get_or_insert(error);
        }
        failure.map_or(Ok(()), Err)
    }
    async fn tick_deal(&mut self, deal: &Deal, now: i64) -> Result<(), CommandError> {
        // A money step whose PayPal outcome is unknown is read back from PayPal first (T10),
        // on its own backoff. A confirmed step signs with the deal's own agent key.
        self.pipeline.policy_paused = self.paused;
        if self.pipeline.has_open_operation(deal.id)? {
            // Without the deal's own agent key nothing PayPal confirms could be signed: the deal
            // stays as it is, and nothing is sent, until the key is available again.
            if self.select_signer(deal.id).is_err() {
                return Ok(());
            }
            self.pipeline.resolve(deal.id, None, now).await?;
            let current = app(self.pipeline.wallet.ledger.get_deal(deal.id))?;
            if current.state.terminal() {
                return Ok(());
            }
        }
        let deal = &app(self.pipeline.wallet.ledger.get_deal(deal.id))?;
        let due = app(self.pipeline.wallet.ledger.deadline(deal.id))?;
        if due.is_some_and(|d| d.0 <= now) {
            // Auto-void an authorization, let anything earlier lapse; a step still unknown
            // blocks every send (pipeline `deadline_default`).
            self.pipeline.deadline_default(deal.id, now).await?;
            return Ok(());
        }
        // Nothing more is sent for a deal while one of its money steps is unknown.
        if self.pipeline.has_open_operation(deal.id)? {
            return Ok(());
        }
        // Dismissal chooses the deadline default and cannot be interpreted as assent.
        if app(self
            .pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id)))?
        .unwrap_or(false)
        {
            return Ok(());
        }
        // A retired mandate grants nothing: the deadline branch above applies the default.
        if self.mandate_retired(deal)? {
            return Ok(());
        }
        self.arm_policy_run(deal);
        if !self.paused && deal.state == DealState::Agreed && deal.side == Side::Seller {
            self.select_signer(deal.id)?;
            let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
            if self.settings()?.payment_executor_configured {
                let result = self
                    .pipeline
                    .create(deal.id, 1, category, table_app::Authority::Policy, now)
                    .await;
                if let Err(error) = result
                    && !matches!(error, table_app::Error::Permission)
                {
                    return Err(error.into());
                }
            }
            return Ok(());
        }
        if deal.state == DealState::AwaitingApproval
            && (deal.side == Side::Seller
                || (deal.kind == DealKind::Purchase
                    && app(self.pipeline.wallet.ledger.handed_off(deal.id))?))
            && self
                .last_poll
                .get(&deal.id)
                .is_none_or(|at| now.saturating_sub(*at) >= 10)
        {
            self.last_poll.insert(deal.id, now);
            self.pipeline
                .poll_approval(
                    deal.id,
                    app(self.pipeline.wallet.ledger.settled_attempt(deal.id))?,
                    now,
                )
                .await?;
        }
        let current = app(self.pipeline.wallet.ledger.get_deal(deal.id))?;
        if current.side == Side::Seller
            && matches!(current.state, DealState::Approved | DealState::Authorized)
        {
            self.select_signer(current.id)?;
            let category = app(self.pipeline.wallet.ledger.deal_category(current.id))?;
            let attempt = app(self.pipeline.wallet.ledger.settled_attempt(current.id))?;
            if current.state == DealState::Approved {
                self.pipeline
                    .authorize(
                        current.id,
                        attempt,
                        category,
                        table_app::Authority::SellerMandate,
                        now,
                    )
                    .await?;
            }
            if current.terms.delivery == Delivery::DigitalNow {
                self.pipeline
                    .capture(
                        current.id,
                        attempt,
                        category,
                        table_app::Authority::SellerMandate,
                        self.clock.now(),
                    )
                    .await?;
            }
        }
        Ok(())
    }
}
