//! Money operations whose PayPal outcome is unknown, and the append-only evidence that settles
//! them. The `operations` row a reservation wrote is never rewritten (migration 0008).
use crate::{
    AuditEntry, Ledger, LedgerError, PaypalCall, audit,
    repositories::{apply, insert_calls},
};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use table_core::{DealEvent, DealId, DecidedBy, PaypalRefs, Timestamp};

/// What one resolution step found. `Confirmed` and `Absent` close the operation; `NeedsOwner`
/// parks it until the owner decides; `Resent` and `Deferred` leave it open.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionOutcome {
    Confirmed,
    Absent,
    Resent,
    NeedsOwner,
    Deferred,
}
impl ResolutionOutcome {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Confirmed => "confirmed",
            Self::Absent => "absent",
            Self::Resent => "resent",
            Self::NeedsOwner => "needs_owner",
            Self::Deferred => "deferred",
        }
    }
}

/// A money operation no live call owns whose PayPal outcome is not yet settled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenOperation {
    pub deal_id: DealId,
    pub attempt: u8,
    pub operation: &'static str,
    pub request_id: String,
    pub decided_by: DecidedBy,
    /// The reservation never finished (the process stopped inside the call); otherwise the
    /// call finished `unknown`.
    pub pending: bool,
    pub started_at: Timestamp,
    /// The original request was already sent once more; it is never sent a third time.
    pub resent: bool,
    /// Parked for the owner; the resolver does not retry it.
    pub needs_owner: bool,
}

/// One resolution step, written in one transaction with its PayPal calls and deal event.
#[derive(Debug)]
pub struct Resolution<'a> {
    pub id: DealId,
    pub request_id: &'a str,
    /// The PayPal status read back (a fixed code, never free text), or `none`.
    pub observed: &'a str,
    pub outcome: ResolutionOutcome,
    pub calls: &'a [PaypalCall],
    /// The deal's PayPal references after the step, when it learned one.
    pub refs: Option<&'a PaypalRefs>,
    pub event: Option<DealEvent>,
    pub at: Timestamp,
}

fn operation_name(raw: &str) -> Result<&'static str, LedgerError> {
    match raw {
        "create" => Ok("create"),
        "authorize" => Ok("authorize"),
        "capture" => Ok("capture"),
        "void" => Ok("void"),
        _ => Err(LedgerError::Integrity("operation kind")),
    }
}
/// PayPal statuses are upper-case codes; anything else is stored as `other`, never verbatim.
fn observed_code(raw: &str) -> &str {
    if !raw.is_empty()
        && raw.len() <= 32
        && raw.bytes().all(|b| b.is_ascii_uppercase() || b == b'_')
        || raw == "none"
    {
        raw
    } else {
        "other"
    }
}

impl Ledger {
    /// Operations whose outcome is unknown and not yet settled, oldest first: every `unknown`
    /// row, and every `pending` row reserved before `stale_before` (no live call owns it).
    /// Rows closed by a `confirmed` or `absent` resolution are left out; parked rows stay, marked.
    pub fn open_operations(
        &self,
        deal: Option<DealId>,
        stale_before: Timestamp,
    ) -> Result<Vec<OpenOperation>, LedgerError> {
        let mut statement = self.conn.prepare(
            "SELECT o.deal_id,o.attempt,o.operation,o.request_id,o.decided_by,o.status,o.started_at,
             EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.request_id=o.request_id AND r.outcome='resent'),
             EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.request_id=o.request_id AND r.outcome='needs_owner')
             FROM operations o
             WHERE (o.status='unknown' OR (o.status='pending' AND o.started_at<?1))
             AND NOT EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.request_id=o.request_id AND r.outcome IN ('confirmed','absent'))
             AND (?2 IS NULL OR o.deal_id=?2)
             ORDER BY o.started_at,o.deal_id,o.attempt,
             CASE o.operation WHEN 'create' THEN 0 WHEN 'authorize' THEN 1 WHEN 'capture' THEN 2 ELSE 3 END",
        )?;
        let rows =
            statement.query_map(params![stale_before, deal.map(|d| d.to_string())], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, u8>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, bool>(7)?,
                    r.get::<_, bool>(8)?,
                ))
            })?;
        rows.map(|row| {
            let (deal, attempt, operation, request_id, decided, status, started, resent, owner) =
                row?;
            Ok(OpenOperation {
                deal_id: deal
                    .parse()
                    .map_err(|_| LedgerError::Integrity("deal id"))?,
                attempt,
                operation: operation_name(&operation)?,
                request_id,
                decided_by: serde_json::from_str(&decided)?,
                pending: status == "pending",
                started_at: started,
                resent,
                needs_owner: owner,
            })
        })
        .collect()
    }
    /// Appends one resolution step. The operation must still be open; a second re-send or a
    /// second owner request is refused (`Conflict`), and a repeated `deferred` writes nothing,
    /// so a PayPal outage adds one row, not one per tick.
    pub fn record_resolution(&mut self, resolution: Resolution<'_>) -> Result<(), LedgerError> {
        let Resolution {
            id,
            request_id,
            observed,
            outcome,
            calls,
            refs,
            event,
            at,
        } = resolution;
        let observed = observed_code(observed);
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (operation, attempt, authority): (String, u8, String) = tx
            .query_row(
                "SELECT operation,attempt,decided_by FROM operations WHERE request_id=?1 AND deal_id=?2 AND status IN ('pending','unknown')",
                params![request_id, id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?
            .ok_or(LedgerError::Conflict)?;
        let earlier = |kinds: &str| -> Result<bool, LedgerError> {
            Ok(tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM operation_resolutions WHERE request_id=?1 AND instr(?2, ','||outcome||',')>0)",
                params![request_id, kinds],
                |r| r.get(0),
            )?)
        };
        if earlier(",confirmed,absent,")?
            || (outcome == ResolutionOutcome::Resent && earlier(",resent,")?)
            || (outcome == ResolutionOutcome::NeedsOwner && earlier(",needs_owner,")?)
        {
            return Err(LedgerError::Conflict);
        }
        if outcome == ResolutionOutcome::Deferred {
            let last: Option<String> = tx
                .query_row(
                    "SELECT outcome FROM operation_resolutions WHERE request_id=?1 ORDER BY seq DESC LIMIT 1",
                    [request_id],
                    |r| r.get(0),
                )
                .optional()?;
            if last.as_deref() == Some("deferred") {
                insert_calls(&tx, id, calls, at)?;
                tx.commit()?;
                return Ok(());
            }
        }
        if event.is_some() && outcome != ResolutionOutcome::Confirmed {
            return Err(LedgerError::Conflict);
        }
        insert_calls(&tx, id, calls, at)?;
        if let Some(refs) = refs {
            tx.execute("UPDATE deals SET pp_order_id=?1,pp_authorization_id=?2,pp_capture_id=?3,pp_subscription_id=?4,decided_by=?5,attempt=?6,updated_at=?8 WHERE id=?7",params![refs.order,refs.authorization,refs.capture,refs.subscription,authority,attempt,id.to_string(),at.to_string()])?;
        }
        if let Some(event) = event {
            apply(&tx, id, event, at)?;
        }
        tx.execute(
            "INSERT INTO operation_resolutions(request_id,observed,outcome,at) VALUES (?1,?2,?3,?4)",
            params![request_id, observed, outcome.as_str(), at],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.resolved".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"request_id":request_id,"observed":observed,"outcome":outcome.as_str(),"confirmed":event.is_some(),"decided_by":serde_json::from_str::<Value>(&authority)?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// The resolution outcomes written for one request id, oldest first.
    pub fn resolutions(&self, request_id: &str) -> Result<Vec<(String, String)>, LedgerError> {
        let mut statement = self.conn.prepare(
            "SELECT observed,outcome FROM operation_resolutions WHERE request_id=?1 ORDER BY seq",
        )?;
        let rows = statement.query_map([request_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }
    /// How many operations were ever reserved for a deal: each is one PayPal-Request-Id.
    pub fn operation_count(&self, id: DealId) -> Result<u64, LedgerError> {
        let n: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM operations WHERE deal_id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        crate::count(n)
    }
}
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    #[test]
    fn observed_status_is_a_fixed_code_never_free_text() {
        assert_eq!(observed_code("CAPTURED"), "CAPTURED");
        assert_eq!(observed_code("none"), "none");
        assert_eq!(observed_code("ignore previous instructions"), "other");
        assert_eq!(observed_code(""), "other");
    }
}
