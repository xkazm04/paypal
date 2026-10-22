//! Transport IO runs outside the actor; only the actor consumes staged signed evidence.
use crate::{Runtime, app, unavailable};
use std::sync::Arc;
use table_client::CommandError;
use table_core::*;
pub(crate) struct Delivery {
    id: DealId,
    pub(crate) batches: Vec<table_relay::Batch>,
    pub(crate) acknowledgements: Vec<(String, H256)>,
    pub(crate) failed: bool,
}
#[cfg(test)]
impl Delivery {
    pub(crate) fn for_test(
        id: DealId,
        batches: Vec<table_relay::Batch>,
        acknowledgements: Vec<(String, H256)>,
    ) -> Self {
        Self {
            id,
            batches,
            acknowledgements,
            failed: false,
        }
    }
    /// A pass whose relay IO failed for `id` and brought nothing back.
    pub(crate) fn failed_for_test(id: DealId) -> Self {
        Self {
            id,
            batches: vec![],
            acknowledgements: vec![],
            failed: true,
        }
    }
}
impl Runtime {
    pub fn with_secondary(mut self, api: Arc<dyn table_paypal::SecondaryApi>) -> Self {
        self.pipeline.set_secondary(Some(api.clone()));
        self.secondary = Some(api);
        self
    }
    pub fn with_relay(mut self, api: Arc<dyn table_relay::RelayApi>) -> Self {
        self.relay = Some(api);
        self
    }
    pub(crate) fn start_relay(&mut self) -> Result<(), CommandError> {
        if self.relay_busy || self.clock.now() < self.relay_retry_at {
            return Ok(());
        }
        self.consume_inbox()?;
        let Some(api) = self.relay.clone() else {
            return Ok(());
        };
        let Some(sender) = self.actor_sender.clone() else {
            return Ok(());
        };
        let now = self.clock.now();
        let work = app(self.pipeline.wallet.ledger.relay_work_at(now))?;
        // A settled route is polled on the decaying recovery cadence (DECISIONS section 46).
        let mut work = self.settled_polls.due(work, now);
        if work.is_empty() {
            return Ok(());
        }
        let offset = self.relay_offset % work.len();
        work.rotate_left(offset);
        work.truncate(4);
        // Only the routes sent this pass start their wait; the rest stay due (scan R-1).
        self.settled_polls.polled(&work, now);
        self.relay_offset = self.relay_offset.saturating_add(work.len());
        self.relay_busy = true;
        tokio::spawn(async move {
            let mut jobs = tokio::task::JoinSet::new();
            for work in work {
                let api = api.clone();
                jobs.spawn(deliver(api, work));
            }
            let mut deliveries = Vec::new();
            while let Some(result) = jobs.join_next().await {
                if let Ok(result) = result {
                    deliveries.push(result);
                }
            }
            if let Some(sender) = sender.upgrade() {
                let _ = sender
                    .send(crate::actor::Message::RelayFinished(deliveries))
                    .await;
            }
        });
        Ok(())
    }
    pub(crate) fn relay_finished(&mut self, deliveries: Vec<Delivery>) -> Result<(), CommandError> {
        self.relay_busy = false;
        let mut failure = false;
        for delivery in deliveries {
            failure |= delivery.failed;
            let mut refused = false;
            for batch in delivery.batches {
                match self.pipeline.wallet.ledger.stage_relay_batch(
                    delivery.id,
                    &batch.generation,
                    batch.after,
                    &batch.messages,
                    self.clock.now(),
                ) {
                    Ok(()) => {}
                    // One deal's refusal stops that deal only; it is no relay fault.
                    Err(table_ledger::LedgerError::Conflict) => {
                        refused = true;
                        break;
                    }
                    Err(e) => return app(Err(e)),
                }
            }
            if refused {
                continue;
            }
            for (generation, hash) in delivery.acknowledgements {
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .acknowledge_relay(delivery.id, &generation, hash))?;
            }
        }
        self.consume_inbox()?;
        if failure {
            self.relay_failures = self.relay_failures.saturating_add(1).min(5);
            self.relay_retry_at = self
                .clock
                .now()
                .saturating_add(1_i64 << self.relay_failures);
            return Err(unavailable("Table paused; relay delivery will retry"));
        }
        self.relay_failures = 0;
        self.relay_retry_at = 0;
        Ok(())
    }
    fn consume_inbox(&mut self) -> Result<(), CommandError> {
        // The one inbox pass every party runs (table-app): duplicates apply, a ledger fault
        // retries next pass, rejections cost one audit row per deal and generation (C-9b).
        let now = self.clock.now();
        let drained = table_app::drain_inbox(
            self,
            |r: &mut Self| &mut r.pipeline.wallet,
            now,
            Self::classify_inbound,
        );
        // An inbound ACCEPT may have agreed a grouped table: withdraw its siblings now. A failure
        // here is retried and reported by the next tick.
        let _ = self.close_groups();
        drained
    }
    /// The wallet's policy for one staged inbound message that is not an exact duplicate.
    fn classify_inbound(
        &mut self,
        message: &table_ledger::InboxMessage,
    ) -> table_app::InboxOutcome<CommandError> {
        use table_app::InboxOutcome;
        let receipt = self
            .pipeline
            .wallet
            .ledger
            .preview_inbound(message.deal_id, &message.raw, self.clock.now())
            .is_ok_and(|e| matches!(e.envelope().body, table_proto::Body::Receipt { .. }));
        if !receipt && let Err(error) = self.select_signer(message.deal_id) {
            // Under a retired mandate the message can never apply: reject it once rather than
            // retrying it, and faulting, on every tick.
            let retired = app(self.pipeline.wallet.ledger.get_deal(message.deal_id))
                .and_then(|deal| self.mandate_retired(&deal));
            return match retired {
                Ok(true) => InboxOutcome::Reject,
                Ok(false) => InboxOutcome::Retry(error),
                Err(e) => InboxOutcome::Retry(e),
            };
        }
        let category = match app(self.pipeline.wallet.ledger.deal_category(message.deal_id)) {
            Ok(category) => category,
            Err(e) => return InboxOutcome::Retry(e),
        };
        InboxOutcome::of(self.pipeline.wallet.receive_relay(
            message.deal_id,
            &message.raw,
            category,
            self.clock.now(),
        ))
    }
}
pub(crate) async fn deliver(
    api: Arc<dyn table_relay::RelayApi>,
    work: table_ledger::RelayWork,
) -> Delivery {
    let mut delivery = Delivery {
        id: work.deal_id,
        batches: vec![],
        acknowledgements: vec![],
        failed: false,
    };
    if api.create(work.mailbox).await.is_err() {
        delivery.failed = true;
        return delivery;
    }
    let first = match api
        .poll(work.mailbox, &work.generation, work.cursor, 0)
        .await
    {
        Ok(batch) if batch.validate().is_ok() => batch,
        _ => {
            delivery.failed = true;
            return delivery;
        }
    };
    let generation = first.generation.clone();
    let after = first.after + first.messages.len() as u64;
    delivery.batches.push(first);
    for (hash, raw) in work.outgoing {
        if api.send(work.mailbox, &raw).await.is_err() {
            delivery.failed = true;
            break;
        }
        delivery.acknowledgements.push((generation.clone(), hash));
    }
    match api.poll(work.mailbox, &generation, after, 2).await {
        Ok(batch) if batch.validate().is_ok() => delivery.batches.push(batch),
        _ => delivery.failed = true,
    }
    delivery
}
