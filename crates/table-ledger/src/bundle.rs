//! Exports one deal's evidence as a ProofBundle. The ledger fills every field from stored,
//! already-verified rows; the caller (the runtime) signs the evidence head with the deal's agent key.
use crate::{Ledger, LedgerError, hash_blob};
use ed25519_dalek::VerifyingKey;
use rusqlite::{OptionalExtension, params};
use serde_json::Value;
use table_core::{ClosedMandate, DealId, DealState, H256, Timestamp};
use table_proto::{
    HouseRelease, PROOF_FORMAT, PROOF_HOUSE_HEADS, ProofAuditHead, ProofAuditRow, ProofBundle,
    ProofCall, ProofClosed, ProofCounterparty, ProofEnvelope, ProofGroup, ProofGroupTable,
    ProofHouse, ProofHouseHead, ProofOperation, ProofReceipt,
};

fn timestamp(text: String) -> Result<Timestamp, LedgerError> {
    text.parse()
        .map_err(|_| LedgerError::Integrity("stored timestamp"))
}
fn key(blob: Vec<u8>, what: &'static str) -> Result<[u8; 32], LedgerError> {
    blob.try_into().map_err(|_| LedgerError::Integrity(what))
}
type RawRow = (i64, String, String, String, String, Vec<u8>, Vec<u8>);
/// The whole-ledger export behind the safety record ([`Ledger::export_proofs`]).
#[derive(Debug)]
pub struct LedgerExport {
    /// The verified audit chain's head.
    pub head: H256,
    /// Deals in the ledger (the export holds at most the newest `limit` of them).
    pub total: u64,
    /// Each exported deal's slice, or the deal and why its evidence would not export.
    pub deals: Vec<Result<ProofBundle, (DealId, LedgerError)>>,
}
/// Audit rows of one deal, oldest first; with `group_only`, only its shop-around rows.
fn audit_rows(
    conn: &rusqlite::Connection,
    deal: &str,
    group_only: bool,
) -> Result<Vec<ProofAuditRow>, LedgerError> {
    let sql = if group_only {
        "SELECT seq,at,actor,action,detail_json,prev_hash,hash FROM audit_log WHERE deal_id=?1 AND action IN ('group.opened','group.won','group.withdrawn') ORDER BY seq"
    } else {
        "SELECT seq,at,actor,action,detail_json,prev_hash,hash FROM audit_log WHERE deal_id=?1 ORDER BY seq"
    };
    let mut statement = conn.prepare(sql)?;
    statement
        .query_map(params![deal], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<Result<Vec<RawRow>, _>>()?
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
        .collect()
}

impl Ledger {
    /// Unsigned bundle for `id`. Refuses to export evidence that does not verify here first:
    /// the transcript and the whole audit chain are re-checked before anything is copied.
    /// `house` is the release pin the wallet keeps HOUSE heads against; the heads kept beside
    /// this deal's receipt travel with it. The caller adds the permissions fingerprint.
    pub fn export_proof(
        &self,
        id: DealId,
        owner: &VerifyingKey,
        at: Timestamp,
        house: Option<&HouseRelease>,
    ) -> Result<ProofBundle, LedgerError> {
        self.verify_transcript(id)?;
        let head_hash = self.verify_audit()?;
        self.export_at_head(id, owner, at, house, head_hash)
    }
    /// The newest `limit` deals' unsigned bundles for the whole-ledger safety record: the audit
    /// chain is verified once (a broken chain is an error, never a partial list), then each deal
    /// exports as [`Ledger::export_proof`] would (its transcript re-verified) or says why it
    /// could not. Returns the chain head, the number of deals in the ledger and the exports,
    /// oldest of the newest first.
    pub fn export_proofs(
        &self,
        limit: u32,
        owner: &VerifyingKey,
        at: Timestamp,
        house: Option<&HouseRelease>,
    ) -> Result<LedgerExport, LedgerError> {
        let head = self.verify_audit()?;
        let total = crate::count(
            self.conn
                .query_row("SELECT COUNT(*) FROM deals", [], |r| r.get::<_, i64>(0))?,
        )?;
        let mut statement = self
            .conn
            .prepare("SELECT id FROM deals ORDER BY id DESC LIMIT ?1")?;
        let mut ids = statement
            .query_map([i64::from(limit)], |r| r.get::<_, String>(0))?
            .map(|id| {
                id?.parse::<DealId>()
                    .map_err(|_| LedgerError::Integrity("deal id"))
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;
        ids.reverse();
        let deals = ids
            .into_iter()
            .map(|id| {
                self.verify_transcript(id)
                    .and_then(|_| self.export_at_head(id, owner, at, house, head))
                    .map_err(|e| (id, e))
            })
            .collect();
        Ok(LedgerExport { head, total, deals })
    }
    fn export_at_head(
        &self,
        id: DealId,
        owner: &VerifyingKey,
        at: Timestamp,
        house: Option<&HouseRelease>,
        head_hash: H256,
    ) -> Result<ProofBundle, LedgerError> {
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
            "SELECT attempt,operation,decided_by,status,request_id FROM operations WHERE deal_id=?1 ORDER BY rowid",
        )?;
        let operations = statement
            .query_map([&deal_key], |r| {
                Ok((
                    r.get::<_, u8>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(attempt, operation, decided_by, status, request_id)| {
                Ok(ProofOperation {
                    attempt,
                    operation,
                    decided_by: serde_json::from_str(&decided_by)?,
                    status,
                    request_id: Some(request_id),
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;

        let mut statement = self.conn.prepare(
            "SELECT method,path,status,body_redacted,binding_json,at,request_id FROM paypal_calls WHERE deal_id=?1 ORDER BY id",
        )?;
        let paypal_calls = statement
            .query_map([&deal_key], |r| {
                Ok((
                    (
                        r.get::<_, Option<String>>(0)?,
                        r.get::<_, Option<String>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, String>(5)?,
                    ),
                    r.get::<_, Option<String>>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|((method, path, status, body, binding, at), request_id)| {
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
                    request_id,
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

        let audit = audit_rows(&self.conn, &deal_key, false)?;
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
            authority_manifest: None,
            group: self.proof_group(id)?,
            house: house
                .map(|release| self.proof_house(id, release))
                .transpose()?
                .flatten(),
            evidence_head: H256::ZERO,
            evidence_sig: Vec::new(),
        })
    }
}
impl Ledger {
    /// The deal's shop-around group as the file carries it: every table's id, state and group
    /// rows. `None` when the deal was never grouped.
    fn proof_group(&self, id: DealId) -> Result<Option<ProofGroup>, LedgerError> {
        let Some(group) = self.group_of(id)? else {
            return Ok(None);
        };
        let record = self.deal_group(group)?;
        let tables = record
            .tables
            .iter()
            .map(|table| {
                let key = table.to_string();
                let state: String =
                    self.conn
                        .query_row("SELECT state FROM deals WHERE id=?1", [&key], |r| r.get(0))?;
                Ok(ProofGroupTable {
                    deal_id: *table,
                    state: serde_json::from_value::<DealState>(Value::String(state))?,
                    rows: audit_rows(&self.conn, &key, true)?,
                })
            })
            .collect::<Result<Vec<_>, LedgerError>>()?;
        Ok(Some(ProofGroup {
            id: group,
            opened_at: record.opened_at,
            winner: record.winner,
            tables,
        }))
    }
    /// The HOUSE heads kept beside the deal's receipt and the newest ones kept after it (at most
    /// `PROOF_HOUSE_HEADS` in all), with the release pin. `None` when no head was kept for it.
    fn proof_house(
        &self,
        id: DealId,
        release: &HouseRelease,
    ) -> Result<Option<ProofHouse>, LedgerError> {
        let Some(receipt) = self.house_receipt_head(id)? else {
            return Ok(None);
        };
        let later = self.house_heads_after(receipt.id, PROOF_HOUSE_HEADS.saturating_sub(1))?;
        let heads = std::iter::once(receipt)
            .chain(later)
            .map(|kept| ProofHouseHead {
                receipt: kept.deal_id == Some(id),
                head: kept.head,
                prefix: kept.prefix,
                kept_at: kept.kept_at,
            })
            .collect();
        Ok(Some(ProofHouse {
            release: release.clone(),
            heads,
        }))
    }
}
