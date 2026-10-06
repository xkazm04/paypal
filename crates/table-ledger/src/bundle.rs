//! Exports one deal's evidence as a ProofBundle. The ledger fills every field from stored,
//! already-verified rows; the caller (the runtime) signs the evidence head with the deal's agent key.
use crate::{Ledger, LedgerError, hash_blob};
use ed25519_dalek::VerifyingKey;
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use table_core::{ClosedMandate, DealId, H256, Timestamp};
use table_proto::{
    PROOF_FORMAT, ProofAuditHead, ProofAuditRow, ProofBundle, ProofCall, ProofClosed,
    ProofCounterparty, ProofEnvelope, ProofOperation, ProofReceipt,
};

fn timestamp(text: String) -> Result<Timestamp, LedgerError> {
    text.parse()
        .map_err(|_| LedgerError::Integrity("stored timestamp"))
}
fn key(blob: Vec<u8>, what: &'static str) -> Result<[u8; 32], LedgerError> {
    blob.try_into().map_err(|_| LedgerError::Integrity(what))
}

impl Ledger {
    /// Unsigned bundle for `id`. Refuses to export evidence that does not verify here first:
    /// the transcript and the whole audit chain are re-checked before anything is copied.
    pub fn export_proof(
        &self,
        id: DealId,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<ProofBundle, LedgerError> {
        self.verify_transcript(id)?;
        let head_hash = self.verify_audit()?;
        let deal = self.get_deal(id)?;
        // Historical evidence: a revoked or superseded mandate still proves what was signed.
        let mandate = self.mandate_evidence(deal.mandate_id, deal.mandate_version, owner)?;
        let (agent_key, owner_key): (Vec<u8>, Vec<u8>) = self.conn.query_row(
            "SELECT agent_pubkey,owner_pubkey FROM counterparties WHERE key_id=?1",
            [deal.counterparty.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let counterparty = ProofCounterparty {
            agent_key: key(agent_key, "counterparty agent key")?,
            owner_key: key(owner_key, "counterparty owner key")?,
        };
        let deal_key = id.to_string();

        let mut statement = self.conn.prepare(
            "SELECT dir,raw_jws,received_at FROM envelopes WHERE deal_id=?1 ORDER BY rowid",
        )?;
        let transcript = statement
            .query_map([&deal_key], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(dir, raw, received)| {
                Ok(ProofEnvelope {
                    inbound: dir == "in",
                    raw,
                    received_at: timestamp(received)?,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;

        let mut statement = self.conn.prepare(
            "SELECT attempt,body_json,agent_sig FROM closed_mandates WHERE deal_id=?1 ORDER BY attempt",
        )?;
        let closed_mandates = statement
            .query_map([&deal_key], |r| {
                Ok((
                    r.get::<_, u8>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Vec<u8>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(attempt, body, sig)| {
                // Stored as the signing bytes (no signature) plus the signature column.
                let mut value: Value = serde_json::from_str(&body)?;
                let object = value
                    .as_object_mut()
                    .ok_or(LedgerError::Integrity("closed mandate body"))?;
                object.insert("agent_sig".into(), serde_json::to_value(sig)?);
                let mandate: ClosedMandate = serde_json::from_value(value)?;
                Ok(ProofClosed { attempt, mandate })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;

        let mut statement = self.conn.prepare(
            "SELECT attempt,operation,decided_by,status FROM operations WHERE deal_id=?1 ORDER BY rowid",
        )?;
        let operations = statement
            .query_map([&deal_key], |r| {
                Ok((
                    r.get::<_, u8>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(attempt, operation, decided_by, status)| {
                Ok(ProofOperation {
                    attempt,
                    operation,
                    decided_by: serde_json::from_str(&decided_by)?,
                    status,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;

        let mut statement = self.conn.prepare(
            "SELECT method,path,status,body_redacted,binding_json,at FROM paypal_calls WHERE deal_id=?1 ORDER BY id",
        )?;
        let paypal_calls = statement
            .query_map([&deal_key], |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, String>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(method, path, status, body, binding, at)| {
                Ok(ProofCall {
                    method: method.unwrap_or_default(),
                    path: path.unwrap_or_default(),
                    status,
                    body: body
                        .map(|b| serde_json::from_str(&b))
                        .transpose()?
                        .unwrap_or(Value::Null),
                    binding: binding.map(|b| serde_json::from_str(&b)).transpose()?,
                    at: timestamp(at)?,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;

        let receipts = self
            .conn
            .query_row(
                "SELECT raw_jws,capture_id,amount_minor,transcript_head FROM receipts WHERE deal_id=?1",
                [&deal_key],
                |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                        r.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )
            .optional()?
            .map(|(raw, capture_id, amount_minor, head)| {
                Ok::<_, LedgerError>(ProofReceipt {
                    raw,
                    capture_id,
                    amount_minor,
                    transcript_head: hash_blob(head)?,
                })
            })
            .transpose()?
            .into_iter()
            .collect();

        let mut statement = self.conn.prepare(
            "SELECT seq,at,actor,action,detail_json,prev_hash,hash FROM audit_log WHERE deal_id=?1 ORDER BY seq",
        )?;
        let audit = statement
            .query_map(params![deal_key], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Vec<u8>>(5)?,
                    r.get::<_, Vec<u8>>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(seq, at, actor, action, detail_json, prev, hash)| {
                Ok(ProofAuditRow {
                    seq,
                    at: timestamp(at)?,
                    actor,
                    action,
                    detail_json,
                    prev_hash: hash_blob(prev)?,
                    hash: hash_blob(hash)?,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;
        let head_seq: i64 =
            self.conn
                .query_row("SELECT COALESCE(MAX(seq),0) FROM audit_log", [], |r| {
                    r.get(0)
                })?;

        Ok(ProofBundle {
            format: PROOF_FORMAT.into(),
            exported_at: at,
            deal,
            owner_key: owner.to_bytes(),
            mandate,
            counterparty,
            transcript,
            closed_mandates,
            operations,
            paypal_calls,
            receipts,
            audit,
            audit_head: ProofAuditHead {
                seq: head_seq,
                hash: head_hash,
            },
            evidence_head: H256::ZERO,
            evidence_sig: Vec::new(),
        })
    }
}
