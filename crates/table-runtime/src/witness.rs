//! The buyer wallet's witness of the house's record (T9). After a HOUSE deal is receipted the
//! wallet fetches the house's signed head and keeps it beside the receipt; later it fetches the
//! head again, with the house's signed hash at the newest kept row count, and keeps that too. A
//! shorter, restarted or rewritten record shows as evidence on the deal (`DealEvidence`); nothing
//! here moves, holds or releases money, and a failed fetch only waits to try again.
//!
//! Network IO runs outside the actor, like relay delivery; only the actor writes the ledger.
use crate::{Runtime, app};
use table_client::CommandError;
use table_core::{DealId, Timestamp};
use table_proto::{SignedHouseHead, SignedHousePrefix};

/// A later look at the house's record, at most this often (seconds).
pub(crate) const CHECK_EVERY: i64 = 900;
/// A head older than the receipt is waited for this long (seconds) before it is kept anyway: the
/// house refreshes its head once a minute, and the two clocks may differ.
pub(crate) const COVER_WAIT: i64 = 300;
/// Retry after a head that does not cover the receipt yet.
const COVER_RETRY: i64 = 20;

#[derive(Debug, Default)]
pub(crate) struct Witness {
    busy: bool,
    retry_at: i64,
    failures: u8,
    checked_at: i64,
}
/// What one fetch brought back, handed to the actor.
pub(crate) struct WitnessFetch {
    pub(crate) awaiting: Vec<(DealId, Timestamp)>,
    pub(crate) head: Option<SignedHouseHead>,
    pub(crate) prefix: Option<SignedHousePrefix>,
}

impl Runtime {
    /// Starts one fetch when a receipted HOUSE deal has no head yet, or a check is due.
    pub(crate) fn start_witness(&mut self) -> Result<(), CommandError> {
        let now = self.clock.now();
        if self.witness.busy || now < self.witness.retry_at || self.house_release.is_none() {
            return Ok(());
        }
        let (Some(api), Some(sender)) = (self.relay.clone(), self.actor_sender.clone()) else {
            return Ok(());
        };
        let ledger = &self.pipeline.wallet.ledger;
        let awaiting = app(ledger.house_deals_awaiting_head())?;
        let anchor = app(ledger.house_anchor())?.map(|k| k.head.head);
        let due = anchor.is_some() && now >= self.witness.checked_at.saturating_add(CHECK_EVERY);
        if awaiting.is_empty() && !due {
            return Ok(());
        }
        self.witness.busy = true;
        tokio::spawn(async move {
            let head = api.house_head().await.ok();
            let prefix = match (&head, anchor) {
                (Some(h), Some(a)) if h.head.epoch == a.epoch && h.head.row_count > a.row_count => {
                    api.house_prefix(a.row_count).await.ok()
                }
                _ => None,
            };
            if let Some(sender) = sender.upgrade() {
                let _ = sender
                    .send(crate::actor::Message::WitnessFinished(Box::new(
                        WitnessFetch {
                            awaiting,
                            head,
                            prefix,
                        },
                    )))
                    .await;
            }
        });
        Ok(())
    }
    /// Keeps what a fetch brought back. A head or prefix the release pin does not verify is never
    /// kept; the wallet waits and asks again.
    pub(crate) fn witness_finished(&mut self, fetch: WitnessFetch) -> Result<(), CommandError> {
        self.witness.busy = false;
        let now = self.clock.now();
        let Some(release) = self.house_release.clone() else {
            return Ok(());
        };
        let Some(head) = fetch.head.filter(|h| h.verify(&release).is_ok()) else {
            self.witness.failures = self.witness.failures.saturating_add(1).min(5);
            self.witness.retry_at = now.saturating_add(30_i64 << self.witness.failures);
            return Ok(());
        };
        let prefix = fetch.prefix.filter(|p| p.verify(&release).is_ok());
        self.witness.failures = 0;
        self.witness.retry_at = 0;
        self.witness.checked_at = now;
        let ledger = &mut self.pipeline.wallet.ledger;
        if fetch.awaiting.is_empty() {
            return app(ledger.keep_house_head(&release, None, &head, prefix.as_ref(), now));
        }
        for (deal, receipted_at) in fetch.awaiting {
            // Keep a head signed after the receipt, so it covers the deal's last rows; wait a
            // little for one (the house refreshes once a minute) before keeping any.
            if head.head.at <= receipted_at && now < receipted_at.saturating_add(COVER_WAIT) {
                self.witness.retry_at = now.saturating_add(COVER_RETRY);
                continue;
            }
            match ledger.keep_house_head(&release, Some(deal), &head, prefix.as_ref(), now) {
                // The deal is no longer a receipted HOUSE purchase: nothing to keep for it.
                Ok(()) | Err(table_ledger::LedgerError::Conflict) => {}
                Err(e) => return app(Err(e)),
            }
        }
        Ok(())
    }
}
