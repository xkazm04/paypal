//! Closed safe display shapes. Raw envelopes and peer prose never cross IPC.
use crate::{DealId, KeyId, Money, PayeeRef, Timestamp};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealDisplay {
    pub deal_id: DealId,
    pub label: String,
    pub title: String,
    pub deadline: Option<Timestamp>,
    pub on_silence: Option<String>,
    pub band: Option<DisplayBand>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DisplayBand {
    pub floor: Option<Money>,
    pub ceiling: Option<Money>,
    pub max_rounds: u8,
    pub rounds_used: u32,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptBy {
    You,
    Them,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TranscriptType {
    Listing,
    Offer,
    Counter,
    Accept,
    Withdraw,
    Settle,
    Receipt,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TranscriptStep {
    pub seq: u32,
    pub by: TranscriptBy,
    pub typ: TranscriptType,
    pub price: Option<Money>,
    pub at: Timestamp,
    pub verified: bool,
}
/// How a counterparty's identity was pinned: all four words confirmed by the owner, the HOUSE
/// seller's release-pinned key, or a key on file with no owner confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CounterpartyPairing {
    WordsConfirmed,
    HousePinned,
    Unpaired,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CounterpartyDisplay {
    pub key_id: KeyId,
    pub display_name: String,
    pub house: bool,
    pub first_seen: Timestamp,
    pub deals_closed: u32,
    pub pairing: CounterpartyPairing,
    /// The payee the counterparty declared in its signed pairing identity (a closed identifier,
    /// never prose). Settlement checks it again; this is the fact, not a permission.
    pub declared_payee: Option<PayeeRef>,
}
/// Longest note the main window is ever handed, in characters (the protocol's NOTE bound).
pub const NOTE_MAX_CHARS: usize = 280;
/// A counterparty's own words from a signed NOTE: untrusted, quarantined plain text. Length-capped,
/// never parsed, never given to an agent or the Tumbler; only the main window reads it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CounterpartyNote {
    pub deal_id: DealId,
    pub seq: u32,
    pub at: Timestamp,
    pub text: String,
}
