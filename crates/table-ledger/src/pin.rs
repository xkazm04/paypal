//! A counterparty pin can be revoked by the owner or expire (standard
//! device-pairing/revocation-and-expiry). A pin that is neither passes; a revoked or expired one
//! is refused with its own error, so the owner and the audit trail can tell the three apart.
//! Revoking sets `counterparties.revoked_at`; it never touches `audit_log` except to append.
use crate::{AuditEntry, Ledger, LedgerError, audit};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior};
use serde_json::json;
use table_core::{KeyId, Timestamp};

/// Whether a confirmed pin may be relied on at an instant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PinState {
    Live,
    Revoked,
    Expired,
}
impl PinState {
    pub fn live(self) -> bool {
        self == PinState::Live
    }
}
fn state(conn: &Connection, key: &KeyId, now: Timestamp) -> Result<PinState, LedgerError> {
    let (revoked, expires): (Option<Timestamp>, Option<Timestamp>) = conn.query_row(
        "SELECT revoked_at,expires_at FROM counterparties WHERE key_id=?1",
        [key.as_str()],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(if revoked.is_some() {
        PinState::Revoked
    } else if expires.is_some_and(|at| now >= at) {
        PinState::Expired
    } else {
        PinState::Live
    })
}
/// The pin check at the gate: `Ok` for a live pin, a distinct error for a revoked or expired one.
pub(crate) fn require_live(
    conn: &Connection,
    key: &KeyId,
    now: Timestamp,
) -> Result<(), LedgerError> {
    match state(conn, key, now)? {
        PinState::Live => Ok(()),
        PinState::Revoked => Err(LedgerError::PinRevoked),
        PinState::Expired => Err(LedgerError::PinExpired),
    }
}
impl Ledger {
    pub fn pin_state(&self, key: &KeyId, now: Timestamp) -> Result<PinState, LedgerError> {
        state(&self.conn, key, now)
    }
    /// Revoke a confirmed pin. Idempotent: a second revoke changes nothing and writes no row.
    /// Unknown or never-confirmed counterparties are `NotFound`: there is no pin to revoke.
    pub fn revoke_counterparty(&mut self, key: &KeyId, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let row: Option<(Option<String>, Option<Timestamp>)> = tx
            .query_row(
                "SELECT words_confirmed_at,revoked_at FROM counterparties WHERE key_id=?1",
                [key.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        match row {
            None | Some((None, _)) => return Err(LedgerError::NotFound),
            Some((_, Some(_))) => return Ok(()),
            Some((Some(_), None)) => {}
        }
        tx.execute(
            "UPDATE counterparties SET revoked_at=?2 WHERE key_id=?1",
            rusqlite::params![key.as_str(), at],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "counterparty.revoked".into(),
                deal_id: None,
                detail: json!({"key_id": key}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// Set (or clear, with `None`) when a pin lapses. A revoked pin stays revoked.
    pub fn set_counterparty_expiry(
        &mut self,
        key: &KeyId,
        expires_at: Option<Timestamp>,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = tx.execute(
            "UPDATE counterparties SET expires_at=?2 WHERE key_id=?1 AND words_confirmed_at IS NOT NULL",
            rusqlite::params![key.as_str(), expires_at],
        )?;
        if changed == 0 {
            return Err(LedgerError::NotFound);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "counterparty.expiry_set".into(),
                deal_id: None,
                detail: json!({"key_id": key, "expires_at": expires_at}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// `counterparty_policy` with the pin check applied: `paired` is false for a pin that is
    /// revoked or expired at `now`.
    pub fn counterparty_policy_at(
        &self,
        key: &KeyId,
        now: Timestamp,
    ) -> Result<(bool, bool, table_core::PayeeRef), LedgerError> {
        let (paired, house, payee) = self.counterparty_policy(key)?;
        Ok((paired && state(&self.conn, key, now)?.live(), house, payee))
    }
}
