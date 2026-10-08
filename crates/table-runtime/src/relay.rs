//! Transport IO runs outside the actor; only the actor consumes staged signed evidence.
use crate::{Runtime, app, unavailable};
use std::sync::Arc;
use table_client::CommandError;
use table_core::*;
pub(crate) struct Delivery {
    id: DealId,
    batches: Vec<table_relay::Batch>,
    acknowledgements: Vec<(String, H256)>,
    failed: bool,
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
        let mut work = app(self.pipeline.wallet.ledger.relay_work())?;
        if work.is_empty() {
            return Ok(());
        }
        let offset = self.relay_offset % work.len();
        work.rotate_left(offset);
        work.truncate(4);
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
            for batch in delivery.batches {
                app(self.pipeline.wallet.ledger.stage_relay_batch(
                    delivery.id,
                    &batch.generation,
                    batch.after,
                    &batch.messages,
                ))?;
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
        let mut failure = None;
        for message in app(self.pipeline.wallet.ledger.pending_inbox())? {
            let duplicate = app(self
                .pipeline
                .wallet
                .ledger
                .has_envelope_hash(message.deal_id, H256::digest(message.raw.as_bytes())))?;
            let receipt = self
                .pipeline
                .wallet
                .ledger
                .preview_inbound(message.deal_id, &message.raw, self.clock.now())
                .is_ok_and(|e| matches!(e.envelope().body, table_proto::Body::Receipt { .. }));
            if !duplicate
                && !receipt
                && let Err(error) = self.select_signer(message.deal_id)
            {
                // Under a retired mandate the message can never apply: reject it once rather
                // than retrying it, and faulting, on every tick.
                let deal = app(self.pipeline.wallet.ledger.get_deal(message.deal_id))?;
                if self.mandate_retired(&deal)? {
                    app(self.pipeline.wallet.ledger.finish_inbox(
                        &message,
                        false,
                        self.clock.now(),
                    ))?;
                } else {
                    failure.get_or_insert(error);
                }
                continue;
            }
            let category = app(self.pipeline.wallet.ledger.deal_category(message.deal_id))?;
            let accepted = match self.pipeline.wallet.receive_relay(
                message.deal_id,
                &message.raw,
                category,
                self.clock.now(),
            ) {
                Ok(()) => true,
                Err(table_app::Error::Ledger(e))
                    if matches!(
                        e,
                        table_ledger::LedgerError::Sql(_) | table_ledger::LedgerError::Integrity(_)
                    ) =>
                {
                    failure.get_or_insert(table_app::Error::from(e).into());
                    continue;
                }
                Err(_) => false,
            };
            app(self
                .pipeline
                .wallet
                .ledger
                .finish_inbox(&message, accepted, self.clock.now()))?;
        }
        // An inbound ACCEPT may have agreed a grouped table: withdraw its siblings now. A failure
        // here is retried and reported by the next tick.
        let _ = self.close_groups();
        failure.map_or(Ok(()), Err)
    }
}
async fn deliver(api: Arc<dyn table_relay::RelayApi>, work: table_ledger::RelayWork) -> Delivery {
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
