//! A deal's evidence as one self-contained file that a third party can check offline.
//!
//! The bundle carries public keys, signed messages, redacted PayPal evidence and the deal's audit
//! rows. It never carries a private key or a credential. The transcript is the signed JWS list
//! exactly as stored, so an inbound NOTE's text travels inside its JWS (dropping it would break
//! the chain); the verifier checks its signature and never prints or interprets it.
use crate::ProtocolError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use table_core::{ClosedMandate, Deal, DecidedBy, H256, OpenMandate, Timestamp, canonical_bytes};

pub const PROOF_FORMAT: &str = "table.proof.v1";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofBundle {
    pub format: String,
    pub exported_at: Timestamp,
    pub deal: Deal,
    /// The owner key the exporting wallet trusts. A checker compares its key id with the one the
    /// owner shows them; everything else in the bundle is anchored to it.
    pub owner_key: [u8; 32],
    pub mandate: OpenMandate,
    pub counterparty: ProofCounterparty,
    pub transcript: Vec<ProofEnvelope>,
    pub closed_mandates: Vec<ProofClosed>,
    pub operations: Vec<ProofOperation>,
    pub paypal_calls: Vec<ProofCall>,
    pub receipts: Vec<ProofReceipt>,
    pub audit: Vec<ProofAuditRow>,
    pub audit_head: ProofAuditHead,
    /// Commitment over every field above, signed by the deal's agent key.
    pub evidence_head: H256,
    pub evidence_sig: Vec<u8>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofCounterparty {
    pub agent_key: [u8; 32],
    pub owner_key: [u8; 32],
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofEnvelope {
    pub inbound: bool,
    pub raw: String,
    /// The wallet's receive/send time, used as "now" when the expiry window is re-checked.
    pub received_at: Timestamp,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofClosed {
    pub attempt: u8,
    pub mandate: ClosedMandate,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofOperation {
    pub attempt: u8,
    pub operation: String,
    pub decided_by: DecidedBy,
    pub status: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofCall {
    pub method: String,
    pub path: String,
    pub status: Option<i64>,
    /// The redacted body exactly as stored.
    pub body: Value,
    /// Identifier-only binding facts (custom_id, invoice_id, payee merchant id, amount).
    pub binding: Option<Value>,
    pub at: Timestamp,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofReceipt {
    pub raw: String,
    pub capture_id: Option<String>,
    pub amount_minor: Option<i64>,
    pub transcript_head: H256,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofAuditRow {
    pub seq: i64,
    pub at: Timestamp,
    pub actor: String,
    pub action: String,
    /// Canonical JSON text, byte for byte as hashed.
    pub detail_json: String,
    pub prev_hash: H256,
    pub hash: H256,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofAuditHead {
    pub seq: i64,
    pub hash: H256,
}
impl ProofBundle {
    /// Domain-separated commitment over every field except the evidence head and signature.
    pub fn evidence_commitment(&self) -> Result<H256, ProtocolError> {
        let mut value = serde_json::to_value(self)?;
        if let Some(object) = value.as_object_mut() {
            object.remove("evidence_head");
            object.remove("evidence_sig");
        }
        Ok(H256::digest(&canonical_bytes(&(PROOF_FORMAT, value))?))
    }
}
