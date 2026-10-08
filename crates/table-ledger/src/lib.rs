//! SQLite repositories with atomic protocol ingestion and append-only chained audit evidence.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod audit;
mod bundle;
pub mod redaction;
pub mod repositories;
pub use audit::{AuditEntry, AuditRecord};
pub use redaction::*;
pub use repositories::*;
use rusqlite::{Connection, TransactionBehavior};
use std::path::Path;
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
}
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
        if version > 12 {
            return Err(LedgerError::Integrity("newer schema"));
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
            tx.execute_batch(include_str!("../migrations/0008_resolver.sql"))?;
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
        tx.execute_batch("PRAGMA user_version=12;")?;
        tx.commit()?;
        let ledger = Self { conn };
        ledger.verify_audit()?;
        Ok(ledger)
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
pub use rescue::*;
mod resolver;
pub use relay::*;
pub use resolver::*;
mod glass;
pub use glass::*;
mod witness;
pub use witness::*;
mod groups;
mod market_watch;
pub use groups::*;
#[cfg(test)]
mod groups_tests;
#[cfg(test)]
mod rescue_tests;
#[cfg(test)]
mod tests;
pub use market_watch::*;
