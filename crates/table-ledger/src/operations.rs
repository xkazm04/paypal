//! Operation reservation and completion on the ledger, and the per-deal deadline.
use crate::repositories::{apply, insert_calls, json_text};
use crate::{AuditEntry, Ledger, LedgerError, PaypalCall, audit};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use table_core::{DealEvent, DealId, PaypalRefs, Timestamp};

#[derive(Debug)]
pub struct OperationOutcome<'a> {
    pub id: DealId,
    pub attempt: u8,
    pub operation: &'a str,
    pub calls: &'a [PaypalCall],
    pub refs: &'a PaypalRefs,
    pub event: Option<DealEvent>,
    pub at: Timestamp,
}

impl Ledger {
    pub fn reserve_operation(
        &mut self,
        id: DealId,
        attempt: u8,
        operation: &str,
        request_id: &str,
        authority: &table_core::DecidedBy,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !(1..=3).contains(&attempt) {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO operations(deal_id,attempt,operation,request_id,decided_by,status,started_at) VALUES (?1,?2,?3,?4,?5,'pending',?6)",params![id.to_string(),attempt,operation,request_id,json_text(authority)?,at])?;
        let mut detail =
            json!({"operation":operation,"request_id":request_id,"decided_by":authority});
        // An auto-void cites what the owner was shown before it (attention-ladder-1).
        if matches!(authority, table_core::DecidedBy::SafeDefault { .. }) {
            crate::attention::cite_rungs(&tx, id, &mut detail);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.authorized".into(),
                deal_id: Some(id),
                detail,
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn finish_operation(&mut self, outcome: OperationOutcome<'_>) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let OperationOutcome {
            id,
            attempt,
            operation,
            calls,
            refs,
            event,
            at,
        } = outcome;
        let authority:String=tx.query_row("SELECT decided_by FROM operations WHERE deal_id=?1 AND attempt=?2 AND operation=?3 AND status='pending'",params![id.to_string(),attempt,operation],|r|r.get(0))?;
        insert_calls(&tx, id, calls, at)?;
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
            apply(&tx, id, event, at)?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.observed".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"confirmed":event.is_some(),"decided_by":serde_json::from_str::<Value>(&authority)?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn set_deadline(
        &mut self,
        id: DealId,
        due: Timestamp,
        authorization_at: Option<Timestamp>,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        // The deadline drives auto-void and expiry, so every move of it is in the chain.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO deadlines(deal_id,due_at,authorization_at) VALUES (?1,?2,?3) ON CONFLICT(deal_id) DO UPDATE SET due_at=excluded.due_at,authorization_at=excluded.authorization_at",params![id.to_string(),due,authorization_at])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "deadline.set".into(),
                deal_id: Some(id),
                detail: json!({"due_at":due,"authorization_at":authorization_at}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn deadline(
        &self,
        id: DealId,
    ) -> Result<Option<(Timestamp, Option<Timestamp>)>, LedgerError> {
        Ok(self
            .conn
            .query_row(
                "SELECT due_at,authorization_at FROM deadlines WHERE deal_id=?1",
                [id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }
}
