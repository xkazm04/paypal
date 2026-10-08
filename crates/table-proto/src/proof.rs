//! A deal's evidence as one self-contained file that a third party can check offline.
//!
//! The bundle carries public keys, signed messages, redacted PayPal evidence and the deal's audit
//! rows. It never carries a private key or a credential. The transcript is the signed JWS list
//! exactly as stored, so an inbound NOTE's text travels inside its JWS (dropping it would break
//! the chain); the verifier checks its signature and never prints or interprets it.
//!
//! Two formats verify. `table.proof.v1` is the first; `table.proof.v2` (what export writes now)
//! adds the permissions fingerprint of the exporting build, each PayPal call's and operation's
//! request id, the deal's shop-around group (ids, states and the group's audit rows) and the HOUSE
//! heads kept beside a HOUSE receipt with the release pin they verify against. Every v2 field is
//! absent from a v1 file, so a v1 file reads and commits exactly as before. v2 adds no
//! counterparty free text.
use crate::{HouseRelease, ProtocolError, SignedHouseHead, SignedHousePrefix};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use table_core::{
    ClosedMandate, Deal, DealId, DealState, DecidedBy, GroupId, H256, OpenMandate, Timestamp,
    canonical_bytes,
};

/// The first proof format; files saved in it keep verifying under its own rules.
pub const PROOF_FORMAT_V1: &str = "table.proof.v1";
/// The format export writes.
pub const PROOF_FORMAT: &str = "table.proof.v2";
/// Most HOUSE heads one file carries: the receipt head and the newest later checks.
pub const PROOF_HOUSE_HEADS: usize = 1000;

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
    /// v2: the permissions fingerprint (T11 authority manifest) of the build that saved the file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authority_manifest: Option<H256>,
    /// v2: the shop-around group this deal was one table of (T8), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<ProofGroup>,
    /// v2: the HOUSE heads kept beside this deal's receipt (T9), if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub house: Option<ProofHouse>,
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
    /// v2: the one PayPal request id the operation was reserved under (the wallet's own id).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
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
    /// v2: the request id the call was sent under (the wallet's own id, never PayPal's).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
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
/// The shop-around group a deal was one table of: every table with its state and its group audit
/// rows (`group.opened`, `group.won`, `group.withdrawn`), each hashed over that table's deal id.
/// Ids, states and typed rows only: no item text, no counterparty text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofGroup {
    pub id: GroupId,
    pub opened_at: Timestamp,
    pub winner: Option<DealId>,
    pub tables: Vec<ProofGroupTable>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofGroupTable {
    pub deal_id: DealId,
    pub state: DealState,
    pub rows: Vec<ProofAuditRow>,
}
/// The HOUSE's signed heads this wallet kept beside the deal's receipt and after it, with the
/// release pin (public data compiled into the wallet) they verify against.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofHouse {
    pub release: HouseRelease,
    pub heads: Vec<ProofHouseHead>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProofHouseHead {
    /// True for the head kept beside this deal's receipt; false for a later check.
    pub receipt: bool,
    pub head: SignedHouseHead,
    pub prefix: Option<SignedHousePrefix>,
    pub kept_at: Timestamp,
}
impl ProofBundle {
    /// Domain-separated commitment over every field except the evidence head and signature. The
    /// domain is the file's own format: a v1 file commits exactly as it always did, and a v2
    /// file relabelled v1 no longer matches its signature.
    pub fn evidence_commitment(&self) -> Result<H256, ProtocolError> {
        let mut value = serde_json::to_value(self)?;
        if let Some(object) = value.as_object_mut() {
            object.remove("evidence_head");
            object.remove("evidence_sig");
        }
        Ok(H256::digest(&canonical_bytes(&(
            self.format.as_str(),
            value,
        ))?))
    }
    /// Whether the file carries any field the first format did not have.
    pub fn has_v2_fields(&self) -> bool {
        self.authority_manifest.is_some()
            || self.group.is_some()
            || self.house.is_some()
            || self.operations.iter().any(|o| o.request_id.is_some())
            || self.paypal_calls.iter().any(|c| c.request_id.is_some())
    }
}
