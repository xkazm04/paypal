//! T10: the ledger side of the read-back resolver. A money operation whose PayPal outcome is not
//! known (`unknown`, or `pending` because the process stopped inside the call) stays reserved under
//! its one request id. These writes record what the wallet learned from PayPal afterwards; none of
//! them mints a request id or rewrites the operation's `decided_by`.
use crate::repositories::{OperationOutcome, apply, json_text};
use crate::{AuditEntry, Ledger, LedgerError, audit, redact_paypal};
use rusqlite::{Connection, OptionalExtension, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use table_core::{DealId, DecidedBy, MoneyCheck, MoneyCheckState, MoneyCheckStep, Timestamp};

/// Why an operation's check is parked, or how it was closed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CheckReason {
    /// PayPal could not be read.
    Unreadable,
    /// PayPal answered, but its record does not settle what happened.
    Ambiguous,
    /// PayPal shows the step did not happen and only the owner's fresh decision may send it again.
    NeedsOwner,
    /// PayPal shows the step did not happen, and the mandate, the shield or a pause refuses it now.
    Refused,
    /// PayPal shows the step did not happen, but PayPal keeps a request id only so long; past that
    /// window a re-send could not be told apart from a new request.
    Window,
    /// Closed: PayPal shows the step happened.
    Confirmed,
    /// Closed: PayPal shows the step did not happen, and its authority has lapsed.
    NotDone,
    /// Closed: the deadline default ended the deal while the step stayed unconfirmed. Used only
    /// for an order creation whose payment link never left the wallet.
    Lapsed,
}
impl CheckReason {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Unreadable => "unreadable",
            Self::Ambiguous => "ambiguous",
            Self::NeedsOwner => "needs_owner",
            Self::Refused => "refused",
            Self::Window => "window",
            Self::Confirmed => "confirmed",
            Self::NotDone => "not_done",
            Self::Lapsed => "lapsed",
        }
    }
    fn parse(text: &str) -> Result<Self, LedgerError> {
        Ok(match text {
            "unreadable" => Self::Unreadable,
            "ambiguous" => Self::Ambiguous,
            "needs_owner" => Self::NeedsOwner,
            "refused" => Self::Refused,
            "window" => Self::Window,
            "confirmed" => Self::Confirmed,
            "not_done" => Self::NotDone,
            "lapsed" => Self::Lapsed,
            _ => return Err(LedgerError::Integrity("operation check reason")),
        })
    }
    pub const fn closes(self) -> bool {
        matches!(self, Self::Confirmed | Self::NotDone | Self::Lapsed)
    }
}

/// A money operation whose PayPal outcome is not known and whose check is not closed.
#[derive(Debug, Clone)]
pub struct OpenOperation {
    pub deal_id: DealId,
    pub attempt: u8,
    pub operation: String,
    /// The one request id this operation was reserved with. A re-send uses exactly this.
    pub request_id: String,
    pub decided_by: DecidedBy,
    pub started_at: Timestamp,
    /// The row was never finished: the process stopped inside the PayPal call.
    pub interrupted: bool,
    /// Set once a check parked it.
    pub parked: Option<CheckReason>,
    pub tries: u32,
    pub resends: u32,
    /// When the next check is due; `None` before the first check (due at once).
    pub next_at: Option<Timestamp>,
}
impl OpenOperation {
    pub fn due(&self, now: Timestamp) -> bool {
        self.next_at.is_none_or(|at| at <= now)
    }
}

const OPEN_SQL: &str = "SELECT o.deal_id,o.attempt,o.operation,o.request_id,o.decided_by,o.started_at,o.status,c.state,c.reason,c.tries,c.resends,c.next_at FROM operations o LEFT JOIN operation_checks c ON c.deal_id=o.deal_id AND c.attempt=o.attempt AND c.operation=o.operation WHERE o.status IN ('pending','unknown') AND (c.state IS NULL OR c.state!='closed')";

type OpenRow = (
    String,
    u8,
    String,
    String,
    String,
    Timestamp,
    String,
    Option<String>,
    Option<String>,
    Option<u32>,
    Option<u32>,
    Option<Timestamp>,
);

fn open_rows(conn: &Connection, id: Option<DealId>) -> Result<Vec<OpenOperation>, LedgerError> {
    let sql = match id {
        Some(_) => format!("{OPEN_SQL} AND o.deal_id=?1 ORDER BY o.started_at,o.rowid"),
        None => format!("{OPEN_SQL} ORDER BY o.started_at,o.rowid"),
    };
    let mut q = conn.prepare(&sql)?;
    let map = |r: &rusqlite::Row<'_>| -> rusqlite::Result<OpenRow> {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
            r.get(7)?,
            r.get(8)?,
            r.get(9)?,
            r.get(10)?,
            r.get(11)?,
        ))
    };
    let rows = match id {
        Some(id) => q
            .query_map([id.to_string()], map)?
            .collect::<Result<Vec<_>, _>>()?,
        None => q.query_map([], map)?.collect::<Result<Vec<_>, _>>()?,
    };
    rows.into_iter()
        .map(
            |(
                deal,
                attempt,
                operation,
                request_id,
                decided,
                started,
                status,
                state,
                reason,
                tries,
                resends,
                next_at,
            )| {
                Ok(OpenOperation {
                    deal_id: deal
                        .parse()
                        .map_err(|_| LedgerError::Integrity("deal id"))?,
                    attempt,
                    operation,
                    request_id,
                    decided_by: serde_json::from_str(&decided)?,
                    started_at: started,
                    interrupted: status == "pending",
                    parked: match (state.as_deref(), reason) {
                        (Some("parked"), Some(reason)) => Some(CheckReason::parse(&reason)?),
                        _ => None,
                    },
                    tries: tries.unwrap_or(0),
                    resends: resends.unwrap_or(0),
                    next_at,
                })
            },
        )
        .collect()
}

fn check_row(
    tx: &Transaction<'_>,
    id: DealId,
    attempt: u8,
    operation: &str,
) -> Result<Option<(String, String, u32, u32)>, LedgerError> {
    Ok(tx
        .query_row(
            "SELECT state,reason,tries,resends FROM operation_checks WHERE deal_id=?1 AND attempt=?2 AND operation=?3",
            params![id.to_string(), attempt, operation],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?)
}

/// The operation's request id and decided_by, if its outcome is still open.
fn open_operation(
    tx: &Transaction<'_>,
    id: DealId,
    attempt: u8,
    operation: &str,
) -> Result<(String, String), LedgerError> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT request_id,decided_by FROM operations WHERE deal_id=?1 AND attempt=?2 AND operation=?3 AND status IN ('pending','unknown')",
            params![id.to_string(), attempt, operation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let row = row.ok_or(LedgerError::Conflict)?;
    if check_row(tx, id, attempt, operation)?.is_some_and(|c| c.0 == "closed") {
        return Err(LedgerError::Conflict);
    }
    Ok(row)
}

/// Write the check row for `(deal, attempt, operation)`: its state and reason, `(tries, resends)`
/// and `(next_at, at)`.
fn upsert_check(
    tx: &Transaction<'_>,
    (id, attempt, operation): (DealId, u8, &str),
    state: &str,
    reason: CheckReason,
    (tries, resends): (u32, u32),
    (next_at, at): (Timestamp, Timestamp),
) -> Result<(), LedgerError> {
    tx.execute("INSERT INTO operation_checks(deal_id,attempt,operation,state,reason,tries,resends,next_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(deal_id,attempt,operation) DO UPDATE SET state=excluded.state,reason=excluded.reason,tries=excluded.tries,resends=excluded.resends,next_at=excluded.next_at,updated_at=excluded.updated_at",params![id.to_string(),attempt,operation,state,reason.as_str(),tries,resends,next_at,at])?;
    Ok(())
}

/// Finish an operation from one of `from` statuses with what PayPal answered. `resolving` marks a
/// finish that settles an earlier unknown outcome: it closes the check and says so in the audit.
pub(crate) fn finish(
    tx: &Transaction<'_>,
    outcome: &OperationOutcome<'_>,
    from: &[&str],
    resolving: bool,
) -> Result<(), LedgerError> {
    let OperationOutcome {
        id,
        attempt,
        operation,
        calls,
        refs,
        event,
        at,
    } = *outcome;
    let (status, request_id, authority): (String, String, String) = tx.query_row(
        "SELECT status,request_id,decided_by FROM operations WHERE deal_id=?1 AND attempt=?2 AND operation=?3",
        params![id.to_string(), attempt, operation],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    if !from.contains(&status.as_str()) {
        return Err(LedgerError::Conflict);
    }
    for call in calls {
        if call.deal_id != id {
            return Err(LedgerError::Conflict);
        }
        let body = redact_paypal(&call.response, &[]);
        let binding = call.binding.as_ref().map(json_text).transpose()?;
        tx.execute("INSERT INTO paypal_calls(deal_id,method,path,request_id,status,debug_id,body_redacted,at,binding_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id.to_string(),call.method.as_str(),call.path.as_str(),call.request_id,call.status,body.get("debug_id").and_then(Value::as_str),json_text(&body)?,at.to_string(),binding])?;
    }
    tx.execute(
        "UPDATE operations SET status=?1 WHERE deal_id=?2 AND attempt=?3 AND operation=?4",
        params![
            if event.is_some() {
                "confirmed"
            } else {
                "unknown"
            },
            id.to_string(),
            attempt,
            operation
        ],
    )?;
    tx.execute("UPDATE deals SET pp_order_id=?1,pp_authorization_id=?2,pp_capture_id=?3,pp_subscription_id=?4,decided_by=?5,attempt=?6,updated_at=?8 WHERE id=?7",params![refs.order,refs.authorization,refs.capture,refs.subscription,authority,attempt,id.to_string(),at.to_string()])?;
    if let Some(event) = event {
        apply(tx, id, event, at)?;
    }
    let decided_by = serde_json::from_str::<Value>(&authority)?;
    let check = check_row(tx, id, attempt, operation)?;
    if !resolving {
        audit::append(
            tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.observed".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"confirmed":event.is_some(),"decided_by":decided_by}),
            },
        )?;
    }
    // A finish that confirms an operation with an open check (a re-send's answer, or a read-back)
    // closes the check, and the chain says how the question was settled.
    if event.is_some() && (resolving || check.is_some()) {
        let (tries, resends) = check.map_or((0, 0), |c| (c.2, c.3));
        upsert_check(
            tx,
            (id, attempt, operation),
            "closed",
            CheckReason::Confirmed,
            (tries, resends),
            (at, at),
        )?;
        audit::append(
            tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.resolved".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"request_id":request_id,"outcome":if resolving {"confirmed"} else {"confirmed_after_resend"},"decided_by":decided_by}),
            },
        )?;
    }
    Ok(())
}

impl Ledger {
    /// Each recorded PayPal call of a deal as (method, path, request id), oldest first. Read-only;
    /// lets a check prove one operation never went out under two request ids.
    pub fn paypal_call_requests(
        &self,
        id: DealId,
    ) -> Result<Vec<(String, String, String)>, LedgerError> {
        let mut q = self.conn.prepare(
            "SELECT method,path,request_id FROM paypal_calls WHERE deal_id=?1 ORDER BY id",
        )?;
        let rows = q
            .query_map([id.to_string()], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }
    /// Every money operation whose outcome is not known and whose check is not closed, oldest
    /// first; for one deal when `id` is set.
    pub fn open_operations(&self, id: Option<DealId>) -> Result<Vec<OpenOperation>, LedgerError> {
        open_rows(&self.conn, id)
    }
    /// What the owner sees about the deal's oldest open money operation; `None` when there is none.
    pub fn money_check(&self, id: DealId) -> Result<Option<MoneyCheck>, LedgerError> {
        let Some(op) = open_rows(&self.conn, Some(id))?.into_iter().next() else {
            return Ok(None);
        };
        Ok(Some(MoneyCheck {
            step: MoneyCheckStep::parse(&op.operation)
                .ok_or(LedgerError::Integrity("operation kind"))?,
            state: if op.parked.is_some() {
                MoneyCheckState::Parked
            } else {
                MoneyCheckState::Checking
            },
            since: op.started_at,
            next_check: op.next_at,
        }))
    }
    /// PayPal shows the operation happened: finish it with the observed facts under its original
    /// `decided_by`, apply the event the answer would have applied, and close the check.
    pub fn resolve_confirmed(&mut self, outcome: OperationOutcome<'_>) -> Result<(), LedgerError> {
        if outcome.event.is_none() {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if check_row(&tx, outcome.id, outcome.attempt, outcome.operation)?
            .is_some_and(|c| c.0 == "closed")
        {
            return Err(LedgerError::Conflict);
        }
        finish(&tx, &outcome, &["pending", "unknown"], true)?;
        tx.commit()?;
        Ok(())
    }
    /// About to send the operation again with its own request id: the row goes back to pending
    /// (so its answer finishes it as usual) and the chain records the re-send.
    pub fn reopen_operation(
        &mut self,
        id: DealId,
        attempt: u8,
        operation: &str,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (request_id, authority) = open_operation(&tx, id, attempt, operation)?;
        let (tries, resends) =
            check_row(&tx, id, attempt, operation)?.map_or((0, 0), |c| (c.2, c.3));
        tx.execute(
            "UPDATE operations SET status='pending' WHERE deal_id=?1 AND attempt=?2 AND operation=?3",
            params![id.to_string(), attempt, operation],
        )?;
        upsert_check(
            &tx,
            (id, attempt, operation),
            "parked",
            CheckReason::Unreadable,
            (tries, resends.saturating_add(1)),
            (at, at),
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.resent".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"request_id":request_id,"decided_by":serde_json::from_str::<Value>(&authority)?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// The check could not settle the operation: try again at `next_at`. The chain gets a row the
    /// first time and whenever the reason changes, not on every retry.
    pub fn park_operation(
        &mut self,
        id: DealId,
        attempt: u8,
        operation: &str,
        reason: CheckReason,
        next_at: Timestamp,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if reason.closes() {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (request_id, _) = open_operation(&tx, id, attempt, operation)?;
        let before = check_row(&tx, id, attempt, operation)?;
        let (tries, resends) = before.as_ref().map_or((0, 0), |c| (c.2, c.3));
        upsert_check(
            &tx,
            (id, attempt, operation),
            "parked",
            reason,
            (tries.saturating_add(1), resends),
            (next_at, at),
        )?;
        if before.is_none_or(|c| c.0 != "parked" || c.1 != reason.as_str()) {
            audit::append(
                &tx,
                &AuditEntry {
                    at,
                    actor: "pipeline".into(),
                    action: "money.parked".into(),
                    deal_id: Some(id),
                    detail: json!({"operation":operation,"request_id":request_id,"reason":reason.as_str()}),
                },
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    /// Close the question without a PayPal step: PayPal showed the step did not happen and its
    /// authority lapsed (`NotDone`), or the deal's deadline default ends it (`Lapsed`). The
    /// operation row keeps `unknown`; it is never sent again.
    pub fn close_operation(
        &mut self,
        id: DealId,
        attempt: u8,
        operation: &str,
        reason: CheckReason,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !matches!(reason, CheckReason::NotDone | CheckReason::Lapsed) {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (request_id, authority) = open_operation(&tx, id, attempt, operation)?;
        let (tries, resends) =
            check_row(&tx, id, attempt, operation)?.map_or((0, 0), |c| (c.2, c.3));
        tx.execute(
            "UPDATE operations SET status='unknown' WHERE deal_id=?1 AND attempt=?2 AND operation=?3",
            params![id.to_string(), attempt, operation],
        )?;
        upsert_check(
            &tx,
            (id, attempt, operation),
            "closed",
            reason,
            (tries, resends),
            (at, at),
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.resolved".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"request_id":request_id,"outcome":reason.as_str(),"decided_by":serde_json::from_str::<Value>(&authority)?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
