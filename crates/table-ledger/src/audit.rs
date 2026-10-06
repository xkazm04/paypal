use crate::{Ledger, LedgerError, hash_blob};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use table_core::{DealId, H256, Timestamp, canonical_bytes};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuditEntry {
    pub at: Timestamp,
    pub actor: String,
    pub action: String,
    pub deal_id: Option<DealId>,
    pub detail: Value,
}
/// A verified audit row as read back for a projection. The runtime decides which of its facts may
/// cross IPC; `detail` itself never does.
#[derive(Debug, Clone)]
pub struct AuditRecord {
    pub seq: u64,
    pub at: Timestamp,
    pub actor: String,
    pub action: String,
    pub deal_id: Option<DealId>,
    pub detail: Value,
}
/// Exact preimage excludes hash fields; timestamps are integer Unix seconds in JCS.
#[derive(Debug, Serialize)]
struct AuditPreimage<'a> {
    seq: i64,
    at: Timestamp,
    actor: &'a str,
    action: &'a str,
    deal_id: Option<DealId>,
    detail_json: &'a Value,
}
/// The whole chain is re-verified on open, on demand (verify_audit) and on every append whose
/// sequence number is a multiple of this. Other appends check only the row they chain onto, so
/// an append costs O(1) instead of O(rows); a row altered offline is still caught by the next
/// open or checkpoint (owner decision, 2026-10-06).
pub(crate) const FULL_CHECK_EVERY: i64 = 500;
const COLUMNS: &str = "seq,at,actor,action,deal_id,detail_json,prev_hash,hash";
struct StoredRow {
    seq: i64,
    at: String,
    actor: String,
    action: String,
    deal_id: Option<String>,
    detail: String,
    prev: Vec<u8>,
    hash: Vec<u8>,
}
fn stored(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredRow> {
    Ok(StoredRow {
        seq: row.get(0)?,
        at: row.get(1)?,
        actor: row.get(2)?,
        action: row.get(3)?,
        deal_id: row.get(4)?,
        detail: row.get(5)?,
        prev: row.get(6)?,
        hash: row.get(7)?,
    })
}
/// Recomputes one row's hash from its stored predecessor link; returns (prev, hash).
fn check(row: StoredRow) -> Result<(H256, H256), LedgerError> {
    let prev = hash_blob(row.prev)?;
    let hash = hash_blob(row.hash)?;
    let at = row
        .at
        .parse()
        .map_err(|_| LedgerError::Integrity("audit timestamp"))?;
    let deal_id = row
        .deal_id
        .map(|s| s.parse())
        .transpose()
        .map_err(|_| LedgerError::Integrity("audit deal ID"))?;
    let value: Value = serde_json::from_str(&row.detail)?;
    if canonical_bytes(&value)? != row.detail.as_bytes() {
        return Err(LedgerError::Integrity("audit detail is not canonical"));
    }
    let preimage = AuditPreimage {
        seq: row.seq,
        at,
        actor: &row.actor,
        action: &row.action,
        deal_id,
        detail_json: &value,
    };
    if H256::chain(prev, &canonical_bytes(&preimage)?) != hash {
        return Err(LedgerError::Integrity("audit row hash"));
    }
    Ok((prev, hash))
}
pub(crate) fn verify(conn: &Connection) -> Result<H256, LedgerError> {
    let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM audit_log ORDER BY seq"))?;
    let mut rows = statement.query([])?;
    let mut previous = H256::ZERO;
    let mut expected_seq = 1_i64;
    while let Some(row) = rows.next()? {
        let row = stored(row)?;
        if row.seq != expected_seq {
            return Err(LedgerError::Integrity("audit sequence/previous hash"));
        }
        let (prev, hash) = check(row)?;
        if prev != previous {
            return Err(LedgerError::Integrity("audit sequence/previous hash"));
        }
        previous = hash;
        expected_seq = expected_seq
            .checked_add(1)
            .ok_or(LedgerError::Integrity("audit sequence overflow"))?;
    }
    Ok(previous)
}
/// The row an append chains onto: its own hash recomputed, its link to the row before it,
/// and a gap-free sequence. Returns (last seq, last hash).
fn tail(conn: &Connection) -> Result<(i64, H256), LedgerError> {
    let last = conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM audit_log ORDER BY seq DESC LIMIT 1"),
            [],
            stored,
        )
        .optional()?;
    let Some(last) = last else {
        return Ok((0, H256::ZERO));
    };
    let seq = last.seq;
    let rows: i64 = conn.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))?;
    if rows != seq {
        return Err(LedgerError::Integrity("audit sequence/previous hash"));
    }
    let (prev, hash) = check(last)?;
    let before = if seq > 1 {
        hash_blob(
            conn.query_row("SELECT hash FROM audit_log WHERE seq=?1", [seq - 1], |r| {
                r.get(0)
            })?,
        )?
    } else {
        H256::ZERO
    };
    if prev != before {
        return Err(LedgerError::Integrity("audit sequence/previous hash"));
    }
    Ok((seq, hash))
}
pub(crate) fn append(conn: &Connection, entry: &AuditEntry) -> Result<H256, LedgerError> {
    let (last, previous) = tail(conn)?;
    let seq = last
        .checked_add(1)
        .ok_or(LedgerError::Integrity("audit sequence overflow"))?;
    if seq % FULL_CHECK_EVERY == 0 && verify(conn)? != previous {
        return Err(LedgerError::Integrity("audit sequence/previous hash"));
    }
    if entry.at < 0 || entry.actor.is_empty() || entry.action.is_empty() {
        return Err(LedgerError::Integrity("invalid audit metadata"));
    }
    let row = AuditPreimage {
        seq,
        at: entry.at,
        actor: &entry.actor,
        action: &entry.action,
        deal_id: entry.deal_id,
        detail_json: &entry.detail,
    };
    let hash = H256::chain(previous, &canonical_bytes(&row)?);
    let detail = String::from_utf8(canonical_bytes(&entry.detail)?)
        .map_err(|_| LedgerError::Integrity("UTF-8"))?;
    conn.execute("INSERT INTO audit_log(seq,at,actor,action,deal_id,detail_json,prev_hash,hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![seq,entry.at.to_string(),entry.actor,entry.action,entry.deal_id.map(|id|id.to_string()),detail,&previous.0[..],&hash.0[..]])?;
    Ok(hash)
}
impl Ledger {
    pub fn verify_audit(&self) -> Result<H256, LedgerError> {
        verify(&self.conn)
    }
    /// One page of the chain, newest first (`before` is an exclusive sequence number). The whole
    /// chain is verified before any row is returned; a broken chain is an error, never a page.
    /// Returns the rows and whether older rows remain.
    pub fn audit_page(
        &self,
        before: Option<u64>,
        limit: u16,
    ) -> Result<(Vec<AuditRecord>, bool), LedgerError> {
        verify(&self.conn)?;
        let before = before.map_or(i64::MAX, |b| i64::try_from(b).unwrap_or(i64::MAX));
        let mut statement = self.conn.prepare(
            "SELECT seq,at,actor,action,deal_id,detail_json FROM audit_log WHERE seq<?1 ORDER BY seq DESC LIMIT ?2",
        )?;
        let mut rows = statement
            .query_map(params![before, i64::from(limit) + 1], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .map(|row| {
                let (seq, at, actor, action, deal_id, detail) = row?;
                Ok(AuditRecord {
                    seq: u64::try_from(seq)
                        .map_err(|_| LedgerError::Integrity("audit sequence"))?,
                    at: at
                        .parse()
                        .map_err(|_| LedgerError::Integrity("audit timestamp"))?,
                    actor,
                    action,
                    deal_id: deal_id
                        .map(|s| s.parse())
                        .transpose()
                        .map_err(|_| LedgerError::Integrity("audit deal ID"))?,
                    detail: serde_json::from_str(&detail)?,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;
        let more = rows.len() > usize::from(limit);
        rows.truncate(usize::from(limit));
        Ok((rows, more))
    }
    /// The latest own-account Transaction Search call and its HTTP status, from paypal_calls.
    pub fn last_reporting_poll(&self) -> Result<Option<(Timestamp, u16)>, LedgerError> {
        let row: Option<(String, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT at,status FROM paypal_calls WHERE method='GET' AND path='/v1/reporting/transactions' ORDER BY id DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        row.map(|(at, status)| {
            Ok((
                at.parse()
                    .map_err(|_| LedgerError::Integrity("paypal call timestamp"))?,
                status.and_then(|s| u16::try_from(s).ok()).unwrap_or(0),
            ))
        })
        .transpose()
    }
    pub fn append_audit(&mut self, entry: &AuditEntry) -> Result<H256, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let hash = append(&tx, entry)?;
        tx.commit()?;
        Ok(hash)
    }
    pub fn audit_count(&self) -> Result<u64, LedgerError> {
        crate::count(
            self.conn
                .query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get::<_, i64>(0))?,
        )
    }
}
