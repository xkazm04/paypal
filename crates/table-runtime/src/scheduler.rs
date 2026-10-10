//! Native deadlines and order polling continue independently of window lifetimes.
use crate::{Runtime, app};
use table_client::CommandError;
use table_core::*;
impl Runtime {
    pub async fn tick(&mut self) -> Result<(), CommandError> {
        let now = self.clock.now();
        // Deadlines are independent of pause, idle lock and the existence of any window.
        // A failed/unknown operation must never prevent processing unrelated deals.
        let mut failure = None;
        // Shop around (T8): a group another table won withdraws its other tables first, so no
        // policy run is armed on a table the group rule is closing.
        if let Err(error) = self.close_groups() {
            failure.get_or_insert(error);
        }
        let deals = app(self.pipeline.wallet.ledger.list_deals())?;
        for deal in deals {
            if deal.kind == DealKind::Rescue && !deal.state.terminal() {
                // A rescue invoice is real whatever the failure's mode (table-app rescue.rs).
                if let Err(error) = self.tick_rescue(&deal, now).await {
                    failure.get_or_insert(error);
                }
                continue;
            }
            if deal.mode == Mode::Replay || deal.state.terminal() {
                continue;
            }
            // A buyer's deal only the seller says is paid ends UNCONFIRMED once PayPal's statement
            // has not shown it for CORROBORATION_SECS. No PayPal call; no money moves.
            if deal.side == Side::Buyer && deal.state == DealState::Receipted {
                match app(self
                    .pipeline
                    .wallet
                    .ledger
                    .lapse_corroboration(deal.id, now))
                {
                    Ok(true) => continue,
                    Ok(false) => {}
                    Err(error) => {
                        failure.get_or_insert(error);
                        continue;
                    }
                }
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
        // The owner's watched subscriptions are read for a failed renewal (GET only); a fix it
        // opens waits at AGREED for the owner and is ticked from the next tick on.
        if let Err(error) = self.tick_rescue_watch(now).await {
            failure.get_or_insert(error);
        }
        failure.map_or(Ok(()), Err)
    }
    async fn tick_deal(&mut self, deal: &Deal, now: i64) -> Result<(), CommandError> {
        // A pause holds a clause-6 policy step's re-send (T10), as it starts no create.
        self.pipeline.policy_paused = self.paused;
        let unresolved = !self
            .pipeline
            .open_operations(Some(deal.id), now)?
            .is_empty();
        // Without the deal's own agent key (its mandate revoked, or the key gone) nothing PayPal
        // confirms could be signed: the read-back still settles what needs no signature and the
        // deadline still applies its safe default, but no capture is confirmed and nothing but a
        // void is sent until the key is available again.
        self.pipeline.signer_missing = unresolved && self.select_signer(deal.id).is_err();
        let result = self.tick_steps(deal, now, unresolved).await;
        self.pipeline.signer_missing = false;
        result
    }
    async fn tick_steps(
        &mut self,
        deal: &Deal,
        now: i64,
        unresolved: bool,
    ) -> Result<(), CommandError> {
        let due = app(self.pipeline.wallet.ledger.deadline(deal.id))?;
        if due.is_some_and(|d| d.0 <= now) {
            // The default reads an unknown authorize or capture back before it voids or
            // expires; a capture PayPal committed is receipted, which signs.
            self.pipeline.deadline_default(deal.id, now).await?;
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
        // A retired mandate grants nothing: the deadline branch above applies the default. An
        // open step is still read back, and sends nothing again but a safe-default void.
        if self.mandate_retired(deal)? {
            if unresolved {
                self.pipeline
                    .resolve_deal(deal.id, table_app::Resolve::Deadline, now)
                    .await?;
            }
            return Ok(());
        }
        // A money operation whose PayPal outcome is unknown reaches PayPal's truth before the
        // deal's next step; while one stays unresolved (parked for the owner, or PayPal not
        // answering) no step runs. A pause holds a policy step's re-send; the deadline does not
        // wait.
        let current;
        let deal = if unresolved {
            let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
            if !self
                .pipeline
                .resolve_deal(deal.id, table_app::Resolve::Advance(category), now)
                .await?
            {
                return Ok(());
            }
            current = app(self.pipeline.wallet.ledger.get_deal(deal.id))?;
            &current
        } else {
            deal
        };
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
            // A step the scam shield refuses was recorded once by the pipeline (shield slice 2)
            // and waits for the owner (the deal shows as held); it is no fault to report on
            // every tick. The deadline's safe default still applies.
            self.pipeline.shield_refused = None;
            if current.state == DealState::Approved {
                let result = self
                    .pipeline
                    .authorize(
                        current.id,
                        attempt,
                        category,
                        table_app::Authority::SellerMandate,
                        now,
                    )
                    .await;
                if self.shield_refused(current.id, &result) {
                    return Ok(());
                }
                result?;
            }
            if current.terms.delivery == Delivery::DigitalNow {
                let result = self
                    .pipeline
                    .capture(
                        current.id,
                        attempt,
                        category,
                        table_app::Authority::SellerMandate,
                        self.clock.now(),
                    )
                    .await;
                if self.shield_refused(current.id, &result) {
                    return Ok(());
                }
                result?;
            }
        }
        Ok(())
    }
    /// Whether `result` is the scam shield's recorded refusal of this deal's step.
    fn shield_refused<T>(&mut self, id: DealId, result: &Result<T, table_app::Error>) -> bool {
        let refused = matches!(result, Err(table_app::Error::Permission))
            && self.pipeline.shield_refused == Some(id);
        self.pipeline.shield_refused = None;
        refused
    }
}
