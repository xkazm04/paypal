//! The approval window DTOs: how it is opened, what it is handed, and what it shows.
use crate::RescueView;
use serde::{Deserialize, Serialize};
use table_core::{Deal, DealId, H256};
use ts_rs::TS;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ApprovalOpenArgs {
    pub deal_id: Option<DealId>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub pairing: Option<H256>,
    /// What the window opens on. Absent: a deal, a pairing, or owner configuration, as before.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub target: Option<ApprovalTarget>,
    /// Main's pre-fill. A suggestion only: the approval window shows it, the owner may change it,
    /// and Rust re-checks and signs it there. Main never signs.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub draft: Option<ApprovalDraft>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalTarget {
    Deal,
    Pairing,
    Credentials,
    Mandate,
    Unlock,
    /// Record a failed renewal as a labelled replay (rescue_replay).
    Rescue,
    /// Watch the owner's subscriptions for a failed renewal (rescue_watch_add).
    RescueWatch,
}
/// A draft carried from Main to the approval window. Closed shapes and typed values only.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ApprovalDraft {
    /// A new band for the selected deal (band_set): target deal.
    Band {
        floor: Option<table_core::Money>,
        ceiling: Option<table_core::Money>,
    },
    /// A new floor for one seller mandate's band, named by an item it covers: target mandate.
    Floor {
        mandate_id: table_core::MandateId,
        item_ref: table_core::ItemRef,
        floor: table_core::Money,
    },
    /// The rescue lever the owner picked in Main: target deal (a rescue).
    Lever { lever: table_core::RescueLever },
    /// A table with a connected counterparty: target none (owner configuration). With `house`,
    /// the house's practice table to join as the buyer (open_approval checks it against the table
    /// Rust kept at pairing_confirm, and deal_join checks it again); without, a table to open as
    /// the seller. The owner still picks the rules and confirms in the approval window.
    Table {
        counterparty: table_core::KeyId,
        house: Option<HouseTableDraft>,
    },
    /// A whole set of rules the owner said in one sentence in Main (the deterministic reader in
    /// the client's lib/say; no model). The approval window's editor opens on them, filled in.
    /// Shape only: nothing is signed here, `validate()` runs when the owner signs, and the owner may
    /// change any part first. A part the reader was not sure of is left out for the editor to show
    /// as missing. Target: mandate, no deal.
    Rules {
        agent: crate::AgentSlot,
        not_before: i64,
        expires: i64,
        clauses: Vec<table_core::Clause>,
        /// The rule (its number, 1 to 9) the editor scrolls to and marks: "Change it in the form" on a
        /// part of the sentence. Absent: the editor opens at the top.
        #[serde(default)]
        #[ts(optional = nullable)]
        focus: Option<u8>,
    },
}
/// The most clauses a rules draft may carry: one of each kind (Clause::number is 1 to 9).
pub const MAX_RULES_DRAFT_CLAUSES: usize = 9;
/// The house's practice table as pairing_join returned it (`PairingWords.house_table`), carried in
/// a draft. The same fields as the signed table; never trusted, re-checked by Rust.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct HouseTableDraft {
    pub negotiation_deadline: i64,
    pub deal_id: DealId,
    pub terms: table_core::Terms,
    pub category: table_core::Category,
}
/// What the approval window was opened for, read by that window only. `target` null means owner
/// configuration (the legacy `deal_id: null` open).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ApprovalHandoff {
    pub target: Option<ApprovalTarget>,
    pub deal_id: Option<DealId>,
    pub draft: Option<ApprovalDraft>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ApprovalSummary {
    pub deal: Deal,
    pub evidence: table_core::DealEvidence,
    pub attempt: u8,
    pub terms_hash: H256,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub counter_hash: Option<H256>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub can_owner_accept: bool,
    pub locked: bool,
    pub can_release: bool,
    pub can_open_paypal: bool,
    pub unavailable_reason: Option<String>,
    /// The checklist the pipeline composed from the predicates that gate the decision; the
    /// window renders it verbatim and never adds a line of its own.
    pub checks: Vec<table_core::ApprovalCheck>,
    /// Domain-separated digest of `checks` (`table_core::checks_hash`); a decision sends it back.
    pub checks_hash: H256,
    /// On a rescue deal: the failed renewal, its one fix and the invoice's fixed wording. Older
    /// shells omit it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub rescue: Option<RescueView>,
}
