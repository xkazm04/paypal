//! Wallet-wide limits (T14): owner-signed envelope versions and the deals the exposure fold
//! reads. Append-only like mandates; every read re-verifies the owner's signature.
use crate::{AuditEntry, Ledger, LedgerError, audit, hash_blob};
use ed25519_dalek::VerifyingKey;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use table_core::{
    Currency, DealId, DealState, ExposureDeal, Money, Side, SignedEnvelope, Timestamp,
    WalletEnvelope, canonical_bytes,
};
use table_proto::verify_wallet_envelope_signature;

/// The first AGREED transition of `{id}`, as the per-mandate velocity (usage_for) reads it.
const AGREED_ROW: &str = "SELECT {c} FROM audit_log WHERE deal_id={id} AND action='deal.transition' AND json_extract(detail_json,'$.to')='AGREED' ORDER BY seq LIMIT 1";

/// One stored version: (version, canonical body, commitment, owner signature, signed at).
type StoredEnvelope = (u32, String, Vec<u8>, Vec<u8>, i64);

fn text<T: serde::de::DeserializeOwned>(value: String) -> Result<T, LedgerError> {
    Ok(serde_json::from_value(Value::String(value))?)
}

impl Ledger {
    pub fn next_envelope_version(&self) -> Result<u32, LedgerError> {
        let latest: u32 = self.conn.query_row(
            "SELECT COALESCE(MAX(version),0) FROM wallet_envelopes",
            [],
            |r| r.get(0),
        )?;
        latest.checked_add(1).ok_or(LedgerError::Conflict)
    }
    /// Stores the next version of the owner's wallet limits after verifying the signature, with
    /// one `wallet_limit.signed` audit row in the same transaction.
    pub fn insert_wallet_envelope(
        &mut self,
        envelope: &SignedEnvelope,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let payload = &envelope.payload;
        verify_wallet_envelope_signature(payload, &envelope.owner_sig, owner)?;
        let commitment = payload.hash()?;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let latest: u32 = tx.query_row(
            "SELECT COALESCE(MAX(version),0) FROM wallet_envelopes",
            [],
            |r| r.get(0),
        )?;
        if payload.version != latest.checked_add(1).ok_or(LedgerError::Conflict)? {
            return Err(LedgerError::Conflict);
        }
        let body = String::from_utf8(canonical_bytes(payload)?)
            .map_err(|_| LedgerError::Integrity("UTF-8"))?;
        tx.execute(
            "INSERT INTO wallet_envelopes(version,body_json,body_hash,owner_sig,created_at) VALUES (?1,?2,?3,?4,?5)",
            params![payload.version, body, &commitment.0[..], envelope.owner_sig, at.to_string()],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "wallet_limit.signed".into(),
                deal_id: None,
                detail: json!({"version":payload.version,"commitment":commitment}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// The newest signed limits and when they were signed; `None` when none were ever signed.
    /// A row whose body, commitment or signature does not verify is an error, never `None`: the
    /// caller fails closed on it.
    pub fn active_wallet_envelope(
        &self,
        owner: &VerifyingKey,
    ) -> Result<Option<(SignedEnvelope, Timestamp)>, LedgerError> {
        let row: Option<StoredEnvelope> = self
            .conn
            .query_row(
                "SELECT version,body_json,body_hash,owner_sig,CAST(created_at AS INTEGER) FROM wallet_envelopes ORDER BY version DESC LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let Some((version, body, hash, owner_sig, at)) = row else {
            return Ok(None);
        };
        let payload: WalletEnvelope = serde_json::from_str(&body)?;
        if payload.version != version
            || canonical_bytes(&payload)? != body.as_bytes()
            || payload.hash()? != hash_blob(hash)?
        {
            return Err(LedgerError::Integrity("wallet limits row"));
        }
        verify_wallet_envelope_signature(&payload, &owner_sig, owner)?;
        Ok(Some((SignedEnvelope { payload, owner_sig }, at)))
    }
    /// Every buyer deal that was not released, with its first agreement moment: what the
    /// exposure fold reads (money out only; released deals never count).
    pub fn exposure_deals(&self) -> Result<Vec<ExposureDeal>, LedgerError> {
        let agreed = |c: &str| AGREED_ROW.replace("{c}", c).replace("{id}", "d.id");
        let sql = format!(
            "SELECT id,side,state,qty,unit_price_minor,currency,CAST(created_at AS INTEGER),({}),({}) FROM deals d WHERE side='buyer' AND state NOT IN ('REFUSED','WITHDRAWN','EXPIRED','VOIDED','AUTO_VOIDED')",
            agreed("seq"),
            agreed("CAST(at AS INTEGER)"),
        );
        let mut q = self.conn.prepare(&sql)?;
        let rows = q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, u32>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, i64>(6)?,
                r.get::<_, Option<i64>>(7)?,
                r.get::<_, Option<i64>>(8)?,
            ))
        })?;
        let mut deals = Vec::new();
        for row in rows {
            let (id, side, state, qty, minor, currency, created_at, seq, at) = row?;
            let currency: Currency = text(currency)?;
            deals.push(ExposureDeal {
                id: id
                    .parse::<DealId>()
                    .map_err(|_| LedgerError::Integrity("deal id"))?,
                side: text::<Side>(side)?,
                state: text::<DealState>(state)?,
                amount: Money::new(minor, currency)
                    .and_then(|m| m.checked_mul(qty))
                    .map_err(table_core::DomainError::from)?,
                created_at,
                agreed: seq.zip(at),
            });
        }
        Ok(deals)
    }
}
