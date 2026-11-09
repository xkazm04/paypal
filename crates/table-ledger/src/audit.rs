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
    checked(row).map(|(prev, hash, _)| (prev, hash))
}
/// As [`check`], also returning the row's time.
fn checked(row: StoredRow) -> Result<(H256, H256, Timestamp), LedgerError> {
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
    Ok((prev, hash, at))
}
pub(crate) fn verify(conn: &Connection) -> Result<H256, LedgerError> {
    walk(conn, |_, _| {})
}
/// Verifies the whole chain, handing each row's (hash, time) to `each` in order; returns the head.
pub(crate) fn walk(
    conn: &Connection,
    mut each: impl FnMut(H256, Timestamp),
) -> Result<H256, LedgerError> {
    let mut statement = conn.prepare(&format!("SELECT {COLUMNS} FROM audit_log ORDER BY seq"))?;
    let mut rows = statement.query([])?;
    let mut previous = H256::ZERO;
    let mut expected_seq = 1_i64;
    while let Some(row) = rows.next()? {
        let row = stored(row)?;
        if row.seq != expected_seq {
            return Err(LedgerError::Integrity("audit sequence/previous hash"));
        }
        let (prev, hash, at) = checked(row)?;
        if prev != previous {
            return Err(LedgerError::Integrity("audit sequence/previous hash"));
        }
        each(hash, at);
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
    // The append door: allowlist, scrub, cap. The sanitized detail is what is hashed and stored.
    let clean = crate::audit_detail::sanitize(&entry.action, &entry.detail)?;
    let row = AuditPreimage {
        seq,
        at: entry.at,
        actor: &entry.actor,
        action: &entry.action,
        deal_id: entry.deal_id,
        detail_json: &clean,
    };
    let hash = H256::chain(previous, &canonical_bytes(&row)?);
    let detail =
        String::from_utf8(canonical_bytes(&clean)?).map_err(|_| LedgerError::Integrity("UTF-8"))?;
    conn.execute("INSERT INTO audit_log(seq,at,actor,action,deal_id,detail_json,prev_hash,hash) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![seq,entry.at.to_string(),entry.actor,entry.action,entry.deal_id.map(|id|id.to_string()),detail,&previous.0[..],&hash.0[..]])?;
    Ok(hash)
}
/// The text a filter is matched against, one lowercase line per audit row: the action, the
/// actor, the status change (`from`, `to`) and the decision (`decided_by`) the row's detail
/// records, and the stored item of the deal it belongs to (`deals.item_ref`; a deal's title is
/// not stored, it is read from the market). Underscores read as spaces on both sides. `?1` is
/// the needle: empty matches every row.
const MATCHES: &str = "(?1='' OR instr(lower(replace(a.action||' '||a.actor||' '||coalesce(json_extract(a.detail_json,'$.from'),'')||' '||coalesce(json_extract(a.detail_json,'$.to'),'')||' '||coalesce(json_extract(a.detail_json,'$.decided_by'),'')||' '||coalesce(d.item_ref,''),'_',' ')),?1)>0)";
/// One page of the audit chain as the Record asks for it.
#[derive(Debug, Clone, Copy)]
pub struct AuditQuery<'a> {
    /// The cursor, an exclusive sequence number: rows older than it when `newest_first`, newer
    /// than it otherwise; absent starts from the first row in that order.
    pub before: Option<u64>,
    pub limit: u16,
    /// A substring (ASCII case-insensitive, `_` as a space) a row must contain; blank = all rows.
    pub filter: Option<&'a str>,
    pub newest_first: bool,
}
impl AuditQuery<'_> {
    fn needle(&self) -> String {
        self.filter
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .replace('_', " ")
    }
}
/// A page and how the whole matching set stands.
#[derive(Debug, Clone)]
pub struct AuditSearch {
    pub rows: Vec<AuditRecord>,
    /// Whether more matching rows follow this page in the chosen order.
    pub more: bool,
    /// Every row matching the filter, whatever the cursor.
    pub total_matching: u64,
}
/// The columns a projection reads, as stored: seq, at, actor, action, deal_id, detail_json.
type RecordRow = (i64, String, String, String, Option<String>, String);
fn record_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<RecordRow> {
    Ok((
        r.get(0)?,
        r.get(1)?,
        r.get(2)?,
        r.get(3)?,
        r.get(4)?,
        r.get(5)?,
    ))
}
/// One stored row as an [`AuditRecord`]; a row that does not decode is an integrity fault.
fn record(
    (seq, at, actor, action, deal_id, detail): RecordRow,
) -> Result<AuditRecord, LedgerError> {
    Ok(AuditRecord {
        seq: u64::try_from(seq).map_err(|_| LedgerError::Integrity("audit sequence"))?,
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
            .query_map(params![before, i64::from(limit) + 1], record_row)?
            .map(|row| record(row?))
            .collect::<Result<Vec<_>, LedgerError>>()?;
        let more = rows.len() > usize::from(limit);
        rows.truncate(usize::from(limit));
        Ok((rows, more))
    }
    /// A stamp that differs between two reads whenever anything was written to the database in
    /// between: this connection's own writes (`total_changes`) and every other connection's
    /// commits (`PRAGMA data_version`). Equal stamps mean no row of any table changed.
    pub fn change_stamp(&self) -> Result<(u64, i64), LedgerError> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA data_version", [], |r| r.get(0))?;
        Ok((self.write_count(), version))
    }
    /// The whole chain verified, unless it already verified and nothing has been written to the
    /// database (by this connection or any other) since: then no row can have changed, so the
    /// answer is the same and the walk is skipped. Any write at all, an audit append or a raw
    /// edit alike, makes the next call walk the whole chain again; a failure is never cached.
    fn verified_chain(&self) -> Result<(), LedgerError> {
        let stamp = self.change_stamp()?;
        if self.audit_checked.get() == Some(stamp) {
            return Ok(());
        }
        self.audit_checked.set(None);
        verify(&self.conn)?;
        self.audit_checked.set(Some(stamp));
        Ok(())
    }
    /// A page of the chain for the Record, the filter and the order run in SQL so the answer is
    /// about every row. See [`AuditQuery`]. The chain is verified first (see `verified_chain`);
    /// a broken chain is an error, never a page.
    pub fn audit_search(&self, query: &AuditQuery<'_>) -> Result<AuditSearch, LedgerError> {
        self.verified_chain()?;
        let needle = query.needle();
        let total = self.conn.query_row(
            &format!("SELECT COUNT(*) FROM audit_log a LEFT JOIN deals d ON d.id=a.deal_id WHERE {MATCHES}"),
            [&needle],
            |r| r.get::<_, i64>(0),
        )?;
        let (cursor, order) = if query.newest_first {
            ("a.seq<?2", "DESC")
        } else {
            ("a.seq>?2", "ASC")
        };
        let after = query.before.map_or(
            if query.newest_first {
                i64::MAX
            } else {
                i64::MIN
            },
            |b| i64::try_from(b).unwrap_or(i64::MAX),
        );
        let mut statement = self.conn.prepare(&format!(
            "SELECT a.seq,a.at,a.actor,a.action,a.deal_id,a.detail_json FROM audit_log a LEFT JOIN deals d ON d.id=a.deal_id WHERE {MATCHES} AND {cursor} ORDER BY a.seq {order} LIMIT ?3"
        ))?;
        let mut rows = statement
            .query_map(
                params![needle, after, i64::from(query.limit) + 1],
                record_row,
            )?
            .map(|row| record(row?))
            .collect::<Result<Vec<_>, LedgerError>>()?;
        let more = rows.len() > usize::from(query.limit);
        rows.truncate(usize::from(query.limit));
        Ok(AuditSearch {
            rows,
            more,
            total_matching: u64::try_from(total).unwrap_or(0),
        })
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
    /// Deal-scoped rows for the history projection, oldest first: one deal or every deal, within
    /// `[from, to)` when given, at most the newest `limit` of them. The whole chain is verified
    /// before any row is returned; a broken chain is an error, never a partial list. Returns the
    /// rows and whether older matching rows were left out.
    pub fn history_rows(
        &self,
        deal: Option<DealId>,
        from: Option<Timestamp>,
        to: Option<Timestamp>,
        limit: u32,
    ) -> Result<(Vec<AuditRecord>, bool), LedgerError> {
        verify(&self.conn)?;
        let mut statement = self.conn.prepare(
            "SELECT seq,at,actor,action,deal_id,detail_json FROM audit_log WHERE deal_id IS NOT NULL AND (?1 IS NULL OR deal_id=?1) AND CAST(at AS INTEGER)>=?2 AND CAST(at AS INTEGER)<?3 ORDER BY seq DESC LIMIT ?4",
        )?;
        let mut rows = statement
            .query_map(
                params![
                    deal.map(|d| d.to_string()),
                    from.unwrap_or(i64::MIN),
                    to.unwrap_or(i64::MAX),
                    i64::from(limit) + 1
                ],
                record_row,
            )?
            .map(|row| record(row?))
            .collect::<Result<Vec<_>, LedgerError>>()?;
        let more = rows.len() > usize::try_from(limit).unwrap_or(usize::MAX);
        rows.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
        rows.reverse();
        Ok((rows, more))
    }
    /// A deal's `owner.decision` rows, newest first, at most `limit` of them. A read for the
    /// approval window's summary, which polls: it does not verify the whole chain on every call
    /// (what it returns is shown, never trusted to gate a decision).
    pub fn owner_decisions(
        &self,
        deal: DealId,
        limit: u32,
    ) -> Result<Vec<AuditRecord>, LedgerError> {
        let mut statement = self.conn.prepare(
            "SELECT seq,at,actor,action,deal_id,detail_json FROM audit_log WHERE deal_id=?1 AND action='owner.decision' ORDER BY seq DESC LIMIT ?2",
        )?;
        statement
            .query_map(params![deal.to_string(), i64::from(limit)], record_row)?
            .map(|row| record(row?))
            .collect()
    }
    /// The HTTP statuses of the PayPal calls a deal recorded at `at` (0 = no response).
    pub fn paypal_statuses_at(&self, id: DealId, at: Timestamp) -> Result<Vec<u16>, LedgerError> {
        let mut statement = self
            .conn
            .prepare("SELECT status FROM paypal_calls WHERE deal_id=?1 AND at=?2 ORDER BY id")?;
        let statuses = statement
            .query_map(params![id.to_string(), at.to_string()], |r| {
                r.get::<_, Option<i64>>(0)
            })?
            .map(|s| Ok(s?.and_then(|s| u16::try_from(s).ok()).unwrap_or(0)))
            .collect::<Result<Vec<_>, LedgerError>>()?;
        Ok(statuses)
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

#[cfg(test)]
mod legacy_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn rows_written_before_the_door_existed_stay_as_they_are_and_still_verify() {
        let mut ledger = Ledger::in_memory().unwrap();
        // A row exactly as the old append wrote it: unsanitized detail, hashed and stored verbatim.
        let old = json!({"reason": "Bearer abc.def", "secret_note": "jo@example.com"});
        let row = AuditPreimage {
            seq: 1,
            at: 50,
            actor: "owner",
            action: "mandate.revoked",
            deal_id: None,
            detail_json: &old,
        };
        let hash = H256::chain(H256::ZERO, &canonical_bytes(&row).unwrap());
        let stored = String::from_utf8(canonical_bytes(&old).unwrap()).unwrap();
        ledger
            .conn
            .execute(
                "INSERT INTO audit_log(seq,at,actor,action,deal_id,detail_json,prev_hash,hash) VALUES (1,'50','owner','mandate.revoked',NULL,?1,?2,?3)",
                params![stored, &H256::ZERO.0[..], &hash.0[..]],
            )
            .unwrap();
        ledger.verify_audit().unwrap();
        // New appends chain onto it through the door, and the whole chain still verifies.
        ledger
            .append_audit(&AuditEntry {
                at: 60,
                actor: "owner".into(),
                action: "mandate.revoked".into(),
                deal_id: None,
                detail: json!({"id": "m1", "note": "x"}),
            })
            .unwrap();
        ledger.verify_audit().unwrap();
        let kept: String = ledger
            .conn
            .query_row("SELECT detail_json FROM audit_log WHERE seq=1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kept, stored);
    }
}
