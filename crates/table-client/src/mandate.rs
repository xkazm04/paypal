//! The mandate, wallet-limits envelope and what-if simulation DTOs.
use crate::AgentSlot;
use serde::{Deserialize, Serialize};
use table_core::DealId;
use ts_rs::TS;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MandateSignArgs {
    pub id: Option<table_core::MandateId>,
    pub agent: AgentSlot,
    pub clauses: Vec<table_core::Clause>,
    pub not_before: i64,
    pub expires: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MandateRevokeArgs {
    pub id: table_core::MandateId,
}
/// The owner's wallet-wide limits to sign (T14): one currency, three numbers and an expiry. The
/// wallet picks the next version and signs with the owner key; nothing here loosens a mandate.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeSignArgs {
    pub currency: table_core::Currency,
    pub max_out_day: table_core::Money,
    pub max_held: table_core::Money,
    pub max_deals_day: u16,
    pub expires: i64,
}
/// Wallet-limits what-if before signing: the draft exactly as `envelope_sign` takes it, replayed
/// over the purchases agreed in a window. Read-only: nothing is signed, written or sent to PayPal.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct EnvelopeSimulateArgs {
    pub draft: EnvelopeSignArgs,
    /// Window start, Unix seconds. Default: seven days before `to`.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub from: Option<i64>,
    /// Window end, Unix seconds. Default: now.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub to: Option<i64>,
}
/// What-if before signing: the draft exactly as `mandate_sign` takes it, replayed over the deals
/// recorded in a window. Read-only: nothing is signed, written or sent to PayPal.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MandateSimulateArgs {
    pub draft: MandateSignArgs,
    /// Window start, Unix seconds. Default: seven days before `to`.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub from: Option<i64>,
    /// Window end, Unix seconds. Default: now.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub to: Option<i64>,
}
/// One mandate's answer to one recorded intent, from `MandatePayload::check` itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SimulatedVerdict {
    Allow,
    /// The owner would be asked (clause 6 above its threshold).
    Ask {
        clause: u8,
    },
    /// The clause that refuses first, with the check's own reason.
    Refuse {
        clause: u8,
        reason: String,
    },
    /// A fact the intent needs is not on record, so nothing is guessed.
    NotSimulated,
}
/// A recorded deal under the rules in force (`before`) and under the draft (`after`). Only
/// owner-bound facts: no counterparty words.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SimulatedLine {
    pub deal_id: DealId,
    /// The deal's display label ("D-0193").
    pub label: String,
    /// The deal's title as Main shows it (owner-bound, never counterparty words).
    pub title: String,
    /// The item the deal is bound to, as the band clause names items.
    pub item_ref: table_core::ItemRef,
    pub kind: table_core::DealKind,
    pub side: table_core::Side,
    /// When the deal was recorded (Unix seconds); 0 = not on record.
    pub at: i64,
    /// The deal total; null when the recorded terms have no valid total.
    #[ts(optional = nullable)]
    pub amount: Option<table_core::Money>,
    pub unit_price: table_core::Money,
    pub before: SimulatedVerdict,
    pub after: SimulatedVerdict,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MandateSimulation {
    /// The window actually replayed, Unix seconds.
    pub from: i64,
    pub to: i64,
    pub lines: Vec<SimulatedLine>,
    /// Lines whose intent could not be rebuilt from the record (both verdicts not simulated).
    pub not_simulated: u32,
}
