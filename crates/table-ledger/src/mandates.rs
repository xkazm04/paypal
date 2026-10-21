//! Mandate reads and writes on the ledger: the integrity-checked row readers and the owner's
//! sign, rebind, list and revoke operations.
use crate::repositories::{ListedMandate, json_text, read_deal};
use crate::{AuditEntry, Ledger, LedgerError, audit, hash_blob};
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use table_core::{
    DealId, DealState, MandateId, OpenMandate, Timestamp, canonical_bytes, commitment,
};
use table_proto::{ProtocolError, verify_mandate_signature};

pub(crate) fn read_mandate(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM mandates WHERE id=?1 AND version=?2 AND status='active')",
        params![id.to_string(), version],
        |r| r.get(0),
    )?;
    if !active {
        return Err(LedgerError::NotFound);
    }
    read_mandate_evidence(conn, id, version)
}
pub(crate) fn read_mandate_evidence(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let mandate = read_mandate_row(conn, id, version)?;
    mandate.payload.hash()?;
    Ok(mandate)
}
/// The stored row checked for integrity (commitment, canonical body, id and version) but not
/// against today's `validate()` rules. Callers decide what a policy refusal means; nothing may
/// act on a mandate read only through this.
fn read_mandate_row(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let (body, hash, sig): (String, Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT body_json,body_hash,owner_sig FROM mandates WHERE id=?1 AND version=?2",
            params![id.to_string(), version],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    let mandate = OpenMandate {
        payload: serde_json::from_str(&body)?,
        owner_sig: sig,
    };
    if commitment(&mandate.payload)? != hash_blob(hash)?
        || json_text(&mandate.payload)? != body
        || mandate.payload.id != id
        || mandate.payload.version != version
    {
        return Err(LedgerError::Integrity("stored mandate"));
    }
    Ok(mandate)
}

impl Ledger {
    pub fn next_mandate_version(&self, id: MandateId) -> Result<u32, LedgerError> {
        let last: u32 = self.conn.query_row(
            "SELECT COALESCE(MAX(version),0) FROM mandates WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        last.checked_add(1).ok_or(LedgerError::Conflict)
    }
    pub fn rebind_mandate(
        &mut self,
        id: DealId,
        version: u32,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, id)?;
        if !matches!(
            deal.state,
            DealState::Pairing | DealState::Listed | DealState::Negotiating | DealState::Agreed
        ) || deal.paypal.order.is_some()
        {
            return Err(LedgerError::Conflict);
        }
        read_mandate(&tx, deal.mandate_id, version)?;
        tx.execute(
            "UPDATE deals SET mandate_version=?1,updated_at=?3 WHERE id=?2",
            params![version, id.to_string(), at.to_string()],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "deal.mandate_rebound".into(),
                deal_id: Some(id),
                detail: json!({"version":version}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// Every active mandate for the owner's list. One the owner signed that today's
    /// `validate()` refuses (an older wallet's policy) is listed with that refusal so it can be
    /// signed again or withdrawn; `active_mandate` still refuses it, so nothing acts under it.
    /// Any other integrity failure, a bad signature above all, still fails the whole list.
    pub fn list_mandates(&self, owner: &VerifyingKey) -> Result<Vec<ListedMandate>, LedgerError> {
        let mut statement = self
            .conn
            .prepare("SELECT id,version FROM mandates WHERE status='active' ORDER BY id")?;
        let ids = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|(id, version)| {
                let id = id
                    .parse()
                    .map_err(|_| LedgerError::Integrity("mandate ID"))?;
                let mandate = read_mandate_row(&self.conn, id, version)?;
                let Err(refusal) = mandate.payload.validate() else {
                    return Ok(ListedMandate {
                        mandate: self.active_mandate(id, version, owner)?,
                        refusal: None,
                    });
                };
                // verify_mandate_signature refuses before it checks the signature; check the
                // owner's signature here so a forged row is still tampering, not a stale policy.
                let sig = Signature::from_slice(&mandate.owner_sig)
                    .map_err(|_| ProtocolError::Signature)?;
                owner
                    .verify_strict(&canonical_bytes(&mandate.payload)?, &sig)
                    .map_err(|_| ProtocolError::Signature)?;
                Ok(ListedMandate {
                    mandate,
                    refusal: Some(refusal),
                })
            })
            .collect()
    }
    pub fn insert_mandate(
        &mut self,
        mandate: &OpenMandate,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        verify_mandate_signature(&mandate.payload, &mandate.owner_sig, owner)?;
        let payload = &mandate.payload;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let latest: u32 = tx.query_row(
            "SELECT COALESCE(MAX(version),0) FROM mandates WHERE id=?1",
            [payload.id.to_string()],
            |r| r.get(0),
        )?;
        if payload.version != latest.checked_add(1).ok_or(LedgerError::Conflict)? {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "UPDATE mandates SET status='superseded' WHERE id=?1 AND status='active'",
            [payload.id.to_string()],
        )?;
        tx.execute("INSERT INTO mandates(id,version,kind,body_json,body_hash,owner_sig,agent_pubkey,status,created_at) VALUES (?1,?2,'open',?3,?4,?5,?6,'active',?7)",params![payload.id.to_string(),payload.version,json_text(payload)?,&payload.hash()?.0[..],mandate.owner_sig,&payload.agent_key[..],at.to_string()])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "mandate.signed".into(),
                deal_id: None,
                detail: json!({"id":payload.id,"version":payload.version,"commitment":payload.hash()?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn active_mandate(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError> {
        let m = read_mandate(&self.conn, id, version)?;
        verify_mandate_signature(&m.payload, &m.owner_sig, owner)?;
        Ok(m)
    }
    /// Historical signed evidence only. Never use this to grant execution authority.
    pub fn mandate_evidence(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError> {
        let m = read_mandate_evidence(&self.conn, id, version)?;
        verify_mandate_signature(&m.payload, &m.owner_sig, owner)?;
        Ok(m)
    }
    pub fn revoke_mandate(&mut self, id: MandateId, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE mandates SET status='revoked' WHERE id=?1 AND status='active'",
            [id.to_string()],
        )? != 1
        {
            return Err(LedgerError::NotFound);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "mandate.revoked".into(),
                deal_id: None,
                detail: json!({"id":id}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
