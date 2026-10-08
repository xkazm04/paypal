//! Evidence of informed silence (attention-ladder-1): each rung of the attention ladder the owner
//! was actually offered for a deal's deadline is one append-only `attention.rung` audit row
//! (closed names, the deadline and a time; never words of the other side), written at most once
//! per (deal, deadline, rung). A safe default cites the chain of those rows by hash, so a lapse or
//! an auto-void can say what the owner was shown before it, and the chain proves it.
use crate::audit::{self, AuditEntry};
use crate::{Ledger, LedgerError, count, hash_blob};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::Serialize;
use serde_json::{Value, json};
use table_core::{DealId, H256, LadderRung, NotifySuppression, RungMark, Timestamp};

/// The audit action of a rung row.
pub const RUNG_ACTION: &str = "attention.rung";

/// One recorded rung with the audit row that holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RungRow {
    pub seq: u64,
    pub deadline: Timestamp,
    pub mark: RungMark,
    /// The audit row's own chained hash.
    pub hash: H256,
}
/// What a safe default cites: the deadline whose rungs it read, the hash over those rows in order
/// ([`rung_chain_hash`]), how many there were and the last one. With no rung recorded the hash is
/// the empty chain's (all zero) and `last_rung` is absent: the owner was never shown the card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SilenceEvidence {
    pub rung_deadline: Timestamp,
    pub rung_chain_hash: H256,
    pub rung_count: u64,
    pub last_rung: Option<LadderRung>,
}
/// The hash over a deadline's rung rows in order: `chain(… chain(chain(0, h1), h2) …, hn)` over
/// each row's own audit hash. Anyone holding the audit rows recomputes it.
pub fn rung_chain_hash<'a>(rows: impl IntoIterator<Item = &'a H256>) -> H256 {
    rows.into_iter()
        .fold(H256::ZERO, |acc, row| H256::chain(acc, &row.0))
}
fn rung_rows(
    conn: &Connection,
    deal: DealId,
    deadline: Option<Timestamp>,
) -> Result<Vec<RungRow>, LedgerError> {
    let mut statement = conn.prepare(
        "SELECT seq,detail_json,hash,at FROM audit_log WHERE deal_id=?1 AND action=?2 AND (?3 IS NULL OR json_extract(detail_json,'$.deadline')=?3) ORDER BY seq",
    )?;
    let rows = statement
        .query_map(params![deal.to_string(), RUNG_ACTION, deadline], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Vec<u8>>(2)?,
                r.get::<_, String>(3)?,
            ))
        })?
        .map(|row| {
            let (seq, detail, hash, at) = row?;
            let detail: Value = serde_json::from_str(&detail)?;
            let field = |key: &str| detail.get(key).cloned().unwrap_or(Value::Null);
            Ok(RungRow {
                seq: count(seq)?,
                deadline: serde_json::from_value(field("deadline"))?,
                mark: RungMark {
                    rung: serde_json::from_value(field("rung"))?,
                    at: at
                        .parse()
                        .map_err(|_| LedgerError::Integrity("audit timestamp"))?,
                    reason: serde_json::from_value(field("reason"))?,
                },
                hash: hash_blob(hash)?,
            })
        })
        .collect::<Result<Vec<_>, LedgerError>>()?;
    Ok(rows)
}
/// The evidence for the deal's recorded deadline, read inside the caller's transaction.
pub(crate) fn silence_evidence(
    conn: &Connection,
    deal: DealId,
) -> Result<Option<SilenceEvidence>, LedgerError> {
    let due: Option<Timestamp> = rusqlite::OptionalExtension::optional(conn.query_row(
        "SELECT due_at FROM deadlines WHERE deal_id=?1",
        [deal.to_string()],
        |r| r.get(0),
    ))?;
    let Some(due) = due else {
        return Ok(None);
    };
    let rows = rung_rows(conn, deal, Some(due))?;
    Ok(Some(SilenceEvidence {
        rung_deadline: due,
        rung_chain_hash: rung_chain_hash(rows.iter().map(|r| &r.hash)),
        rung_count: u64::try_from(rows.len()).unwrap_or(u64::MAX),
        last_rung: rows.last().map(|r| r.mark.rung),
    }))
}
/// Adds the deal's silence evidence to a safe default's audit detail. A failed read leaves the
/// detail as it was: the default never waits on, or fails for, a rung.
pub(crate) fn cite_rungs(conn: &Connection, deal: DealId, detail: &mut Value) {
    let Ok(Some(evidence)) = silence_evidence(conn, deal) else {
        return;
    };
    if let (Value::Object(detail), Ok(Value::Object(fields))) =
        (detail, serde_json::to_value(evidence))
    {
        detail.extend(fields);
    }
}
impl Ledger {
    /// Appends one rung row unless this deal's deadline already has that rung; returns whether a
    /// row was written. Rows are never changed or removed.
    pub fn record_rung(
        &mut self,
        deal: DealId,
        deadline: Timestamp,
        rung: LadderRung,
        reason: Option<NotifySuppression>,
        at: Timestamp,
    ) -> Result<bool, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let seen: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM audit_log WHERE deal_id=?1 AND action=?2 AND json_extract(detail_json,'$.deadline')=?3 AND json_extract(detail_json,'$.rung')=?4)",
            params![deal.to_string(), RUNG_ACTION, deadline, rung.name()],
            |r| r.get(0),
        )?;
        if seen {
            return Ok(false);
        }
        let mut detail = json!({"deadline": deadline, "rung": rung});
        if let Some(reason) = reason {
            detail["reason"] = serde_json::to_value(reason)?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "attention".into(),
                action: "attention.rung".into(),
                deal_id: Some(deal),
                detail,
            },
        )?;
        tx.commit()?;
        Ok(true)
    }
    /// A deal's recorded rungs in order, for one deadline or all of them.
    pub fn rungs(
        &self,
        deal: DealId,
        deadline: Option<Timestamp>,
    ) -> Result<Vec<RungRow>, LedgerError> {
        rung_rows(&self.conn, deal, deadline)
    }
    /// What a safe default applied now would cite for this deal.
    pub fn silence_evidence(&self, deal: DealId) -> Result<Option<SilenceEvidence>, LedgerError> {
        silence_evidence(&self.conn, deal)
    }
}
