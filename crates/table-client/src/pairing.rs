//! The pairing DTOs: the words ceremony, its offer and join arguments, and the redacting Debug impls.
use serde::{Deserialize, Serialize};
use table_core::H256;
use table_proto::SignedPairingIdentity;
use ts_rs::TS;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PendingPairing {
    pub pairing_id: H256,
    pub words: [String; 4],
    pub house: bool,
    // Fixed Rust-composed context; no peer-supplied name, payee, key or URL.
    pub display_context: String,
    /// When the signed pairing identities lapse; after it the words can no longer be confirmed.
    pub expires: i64,
}
/// Ends a pending pairing: by its id (words already on screen) or by the creator's own code
/// (waiting for a joiner). Exactly one. Aborting only restricts, so it needs no privilege.
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingAbortArgs {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub pairing_id: Option<H256>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub code: Option<String>,
}
impl std::fmt::Debug for PairingAbortArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PairingAbortArgs")
            .field("pairing_id", &self.pairing_id)
            .finish_non_exhaustive()
    }
}
/// Sent to Main after the owner confirmed the words in the approval window and Rust pinned the
/// peer. Identifiers only; the owner's local label is read from counterparty_list.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingPinned {
    pub pairing_id: H256,
    pub key_id: table_core::KeyId,
    pub house: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingCreateArgs {
    pub side: table_core::Side,
    pub payee: table_core::PayeeRef,
}
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingOffer {
    pub code: String,
    pub bundle: SignedPairingIdentity,
}
impl std::fmt::Debug for PairingOffer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PairingOffer { [REDACTED] }")
    }
}
#[derive(Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingJoinArgs {
    pub code: String,
    /// Omit for relay discovery; retained for explicitly offline bundle exchange.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub peer: Option<SignedPairingIdentity>,
    pub side: table_core::Side,
    pub payee: table_core::PayeeRef,
}
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingPollArgs {
    pub code: String,
}
impl std::fmt::Debug for PairingPollArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PairingPollArgs { [REDACTED] }")
    }
}
impl std::fmt::Debug for PairingJoinArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PairingJoinArgs { [REDACTED] }")
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingWords {
    pub house_table: Option<table_proto::HouseTable>,
    pub pairing_id: H256,
    pub words: [String; 4],
    pub reply: SignedPairingIdentity,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PairingConfirmArgs {
    pub pairing_id: H256,
    pub words: [String; 4],
    pub display_name: String,
}
