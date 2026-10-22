//! SQLite repositories with atomic protocol ingestion and append-only chained audit evidence.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod attention;
pub mod audit;
mod audit_detail;
mod bundle;
pub use bundle::LedgerExport;
mod pin;
pub mod redaction;
pub mod repositories;
pub use pin::PinState;
mod snapshot;
pub use attention::{RUNG_ACTION, RungRow, SilenceEvidence, rung_chain_hash};
pub use audit::{AuditEntry, AuditRecord};
pub use redaction::*;
pub use repositories::*;
mod counterparties;
mod countersign;
pub use counterparties::*;
mod mandates;
mod negotiation;
mod operations;
pub use operations::OperationOutcome;
mod stores;
mod transcript;
use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;
pub use stores::*;
use table_core::{DomainError, H256};
use table_proto::ProtocolError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LedgerError {
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error(transparent)]
    Domain(#[from] DomainError),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    #[error("ledger integrity failure: {0}")]
    Integrity(&'static str),
    #[error("record not found")]
    NotFound,
    #[error("conflicting or stale write")]
    Conflict,
    /// Shop around (T8): another table in this deal's group already agreed, or holds the group's
    /// one outstanding ACCEPT. A refusal of the intent, not a fault.
    #[error("another table in this group already agreed")]
    GroupClosed,
    /// The counterparty pin was revoked by the owner.
    #[error("counterparty pin revoked")]
    PinRevoked,
    /// The counterparty pin has expired.
    #[error("counterparty pin expired")]
    PinExpired,
}
const SCHEMA_VERSION: i64 = 16;
/// Deliberately no public raw-SQL/connection API. Only typed repositories cross this edge.
#[derive(Debug)]
pub struct Ledger {
    pub(crate) conn: Connection,
}
impl Ledger {
    pub fn in_memory() -> Result<Self, LedgerError> {
        Self::from_connection(Connection::open_in_memory()?)
    }
    pub fn open(path: &Path) -> Result<Self, LedgerError> {
        Self::from_connection(Connection::open(path)?)
    }
    fn from_connection(mut conn: Connection) -> Result<Self, LedgerError> {
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;")?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version > SCHEMA_VERSION {
            return Err(LedgerError::Integrity("newer schema"));
        }
        let migrating = version < SCHEMA_VERSION;
        if migrating {
            // No restore point, no migration: a failure here refuses the open.
            snapshot::take(&conn, version)?;
        }
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        if version < 1 {
            tx.execute_batch(include_str!("../migrations/0001_table.sql"))?;
        }
        if version < 2 {
            tx.execute_batch(include_str!("../migrations/0002_integrity.sql"))?;
        }
        if version < 3 {
            tx.execute_batch(include_str!("../migrations/0003_execution.sql"))?;
        }
        if version < 4 {
            tx.execute_batch(include_str!("../migrations/0004_native.sql"))?;
        }
        if version < 5 {
            tx.execute_batch(include_str!("../migrations/0005_relay.sql"))?;
        }
        if version < 6 {
            tx.execute_batch(include_str!("../migrations/0006_client.sql"))?;
        }
        if version < 7 {
            tx.execute_batch(include_str!("../migrations/0007_binding.sql"))?;
        }
        if version < 8 {
            tx.execute_batch(include_str!("../migrations/0008_resolution.sql"))?;
        }
        if version < 9 {
            tx.execute_batch(include_str!("../migrations/0009_wallet_limits.sql"))?;
        }
        if version < 10 {
            tx.execute_batch(include_str!("../migrations/0010_house_heads.sql"))?;
        }
        if version < 11 {
            tx.execute_batch(include_str!("../migrations/0011_rescue.sql"))?;
        }
        if version < 12 {
            tx.execute_batch(include_str!("../migrations/0012_deal_groups.sql"))?;
        }
        if version < 13 {
            tx.execute_batch(include_str!("../migrations/0013_shield_record.sql"))?;
        }
        if version < 14 {
            tx.execute_batch(include_str!("../migrations/0014_rescue_watch.sql"))?;
        }
        // The older-schema tests step user_version back without dropping this column.
        let has_reset_column: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('relay_routes') WHERE name='generation_at')",
            [],
            |r| r.get(0),
        )?;
        if version < 15 && !has_reset_column {
            tx.execute_batch(include_str!("../migrations/0015_relay_reset.sql"))?;
        }
        // The older-schema tests step user_version back without dropping these columns.
        let has_pin_columns: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('counterparties') WHERE name='revoked_at')",
            [],
            |r| r.get(0),
        )?;
        if version < 16 && !has_pin_columns {
            tx.execute_batch(include_str!("../migrations/0016_pin_expiry.sql"))?;
        }
        tx.execute_batch(&format!("PRAGMA user_version={SCHEMA_VERSION};"))?;
        tx.commit()?;
        if migrating {
            snapshot::prune(&conn);
        }
        let ledger = Self { conn };
        ledger.verify_audit()?;
        Ok(ledger)
    }
    /// How many rows this ledger's connection has inserted, updated or deleted since it opened
    /// (SQLite `total_changes`). It only ever grows, so a caller that saw a value can tell
    /// whether anything was written since. A count, never SQL: no statement crosses this edge.
    pub fn write_count(&self) -> u64 {
        self.conn.total_changes()
    }
}
pub(crate) fn hash_blob(blob: Vec<u8>) -> Result<H256, LedgerError> {
    Ok(H256(
        blob.try_into()
            .map_err(|_| LedgerError::Integrity("hash length"))?,
    ))
}
pub(crate) fn count(value: i64) -> Result<u64, LedgerError> {
    u64::try_from(value).map_err(|_| LedgerError::Integrity("negative count"))
}
mod book;
pub use book::book_query_rejection;
mod display;
mod house;
mod limits;
pub use house::*;
mod receipt;
mod relay;
mod rescue;
pub use relay::*;
pub use rescue::*;
mod resolution;
pub use resolution::*;
mod glass;
pub use glass::*;
mod witness;
pub use witness::*;
mod groups;
mod market_watch;
mod shield;
pub use groups::*;
pub use shield::ShieldRefusal;
#[cfg(test)]
mod groups_tests;
#[cfg(test)]
mod live_deals_tests;
#[cfg(test)]
mod relay_clock_tests;
#[cfg(test)]
mod rescue_tests;
#[cfg(test)]
mod shield_tests;
#[cfg(test)]
mod tests;
pub use market_watch::*;
mod rescue_watch;
pub use rescue_watch::*;
