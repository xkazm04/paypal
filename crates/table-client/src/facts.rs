//! The Book audit page, owner facts, book query and proof report DTOs.
use crate::{AgentSlot, CredentialArgs};
use serde::{Deserialize, Serialize};
use table_core::{DealId, Mode};
use ts_rs::TS;
/// A page of the audit chain for Book, newest first. `before` is an exclusive sequence number
/// (absent = from the newest); `limit` is 1 to 200.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AuditPageArgs {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub before: Option<u64>,
    pub limit: u16,
}
/// One verified audit row, projected to closed facts: who, what, when, which deal, and the typed
/// decision and transition the row records. The row's free detail never crosses IPC.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AuditRow {
    pub seq: u64,
    pub at: i64,
    pub actor: String,
    pub action: String,
    pub deal_id: Option<DealId>,
    pub decided_by: Option<table_core::DecidedBy>,
    pub from: Option<table_core::DealState>,
    pub to: Option<table_core::DealState>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AuditPage {
    pub rows: Vec<AuditRow>,
    /// Pass as `before` for the next (older) page; null when this page reached the first row.
    pub next_before: Option<u64>,
}
/// Read-only owner facts for Settings and Book: nothing here is a secret or a permission.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct OwnerFacts {
    pub locked: bool,
    /// Seconds until the approval window idle-locks; null while it is locked.
    pub lock_in: Option<i64>,
    pub last_reporting_poll: Option<ReportingPoll>,
    pub engines: Vec<EngineProbe>,
    pub credentials: Vec<CredentialFact>,
    pub agents: Vec<AgentRosterEntry>,
    /// The rule sets in force that keep market prices fresh (T15), with today's price checks.
    pub market_watch: Vec<MarketWatchFact>,
    /// The id of the owner's public key (SHA-256 of it, 64 hex characters): the key a proof file
    /// of this wallet names, so a person checking one compares it with this. Public; the private
    /// key never leaves the OS keychain.
    pub owner_key_id: table_core::KeyId,
}
/// A rule set in force with a market-watch rule (T15): the items whose market price the wallet
/// keeps fresh, and today's price checks against the rule's daily allowance. Reading market
/// prices moves no money.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MarketWatchFact {
    pub mandate_id: table_core::MandateId,
    pub mandate_version: u32,
    pub agent: AgentSlot,
    pub items: Vec<table_core::WatchedItem>,
    pub max_per_day: u16,
    /// Price checks made today (UTC day), counted from the audit log.
    pub used_today: u32,
    /// Today's allowance is used up: no price is checked again until the next UTC day.
    pub used_up: bool,
}
/// The latest own-account Transaction Search call: when, and the HTTP status PayPal answered
/// (0 = no response).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReportingPoll {
    pub at: i64,
    pub status: u16,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct EngineProbe {
    pub id: table_engine::EngineId,
    /// When this session probed the executable (null: never resolved).
    pub probed_at: Option<i64>,
    pub available: bool,
    pub version: Option<String>,
    pub detail: Option<String>,
}
/// Whether a credential is in the OS keyring and when it was stored. Never the secret.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CredentialFact {
    pub kind: CredentialArgs,
    pub stored: bool,
    /// Null when stored before this was recorded, or not stored.
    pub stored_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentRosterEntry {
    pub slot: AgentSlot,
    pub engine: table_engine::EngineId,
    /// Fixed Rust text: what this slot is for.
    pub does: String,
    /// Active mandates whose signed agent key is this slot's.
    pub mandates: Vec<table_core::MandateId>,
    pub running: u32,
}
/// The owner's read-only Book query. `query` is a closed BookQuery, taken raw so that a rejection
/// (schema or rule) comes back as INVALID with the reason verbatim; it is never SQL.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct BookQueryArgs {
    pub query: serde_json::Value,
}
/// Aggregate rows, grouped by currency, mode and direction (out or in) first: amounts in minor units, market distance in
/// basis points. Read on a read-only connection; nothing is written.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct BookAnswer {
    pub query: table_core::BookQuery,
    pub rows: Vec<serde_json::Value>,
}
/// One verifier check, keyed by its stable id; the client words it, `detail` is the verifier's own
/// line and comes from the file, so it is shown only as text.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProofCheckLine {
    pub id: String,
    pub ok: bool,
    /// False when the file lacks the record this check compares, so it could not be made (`ok`
    /// is false too; the file is not verified).
    pub checked: bool,
    /// False when the deal has nothing of the kind this check is about (or the file is in the
    /// first proof format): the line reads "not checked" and neither passes nor holds the file
    /// back.
    pub applies: bool,
    pub detail: String,
}
/// The offline verifier's report on a proof file the owner picked. Values come from the file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ProofReport {
    pub deal_id: DealId,
    pub mode: Mode,
    /// The full id of the owner key the file names (64 hex characters), or "invalid".
    pub owner_key_id: String,
    pub verified: bool,
    pub checks: Vec<ProofCheckLine>,
    /// The permissions fingerprint the file names (hex; null in a first-format file).
    pub authority_manifest: Option<String>,
    /// Whether that fingerprint is this wallet's own: the file was saved by a build with the same
    /// permissions. Null when the file names none.
    pub same_version: Option<bool>,
}
