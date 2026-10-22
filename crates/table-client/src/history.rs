//! The Rewind history and "Your safety record" DTOs.
use serde::{Deserialize, Serialize};
use table_core::{DealId, H256};
use ts_rs::TS;
/// The Rewind read: one deal or every deal, optionally within `[from, to)` (Unix seconds, as every
/// other timestamp in the contract).
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealHistoryArgs {
    #[serde(default)]
    #[ts(optional = nullable)]
    pub deal_id: Option<DealId>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub from: Option<i64>,
    #[serde(default)]
    #[ts(optional = nullable)]
    pub to: Option<i64>,
}
/// The newest steps, oldest first. `truncated` is set when older steps in the window were left out.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealHistory {
    pub steps: Vec<HistoryStep>,
    pub truncated: bool,
}
/// One step of a deal, projected from a verified audit row (and the PayPal calls it recorded).
/// Closed facts only: no detail text, payload, request id or counterparty words ever cross.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct HistoryStep {
    pub at: i64,
    pub deal_id: DealId,
    /// The audit row this step stands for (the money step's own row when rows were folded).
    pub seq: u64,
    pub kind: HistoryKind,
    pub state_after: Option<table_core::DealState>,
    pub authority: HistoryAuthority,
    pub paypal: HistoryPaypal,
    /// On a safe default that cites them (attention-ladder-1): the rungs of the attention ladder
    /// the owner was offered for that deadline before it, oldest first; empty when the card was
    /// never shown. Absent on every other step, and on a default recorded before rungs were.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub rungs: Option<Vec<table_core::RungMark>>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HistoryKind {
    Created,
    OfferSent,
    OfferReceived,
    AcceptSent,
    AcceptReceived,
    OwnerAccepted,
    Agreed,
    Proposed,
    Countersigned,
    PayLinkSent,
    PayLinkReceived,
    ApprovalNotice,
    OrderCreated,
    ApprovedByBuyer,
    Authorized,
    Captured,
    Voided,
    AutoVoided,
    ReceiptSent,
    ReceiptReceived,
    Receipted,
    /// The seller's receipt arrived before the owner opened the PayPal link, so the wallet
    /// refused it: the seller's word alone. Nothing changed on the deal; no money moved.
    ReceiptRefused,
    ReportingChecked,
    Reconciled,
    WithdrawSent,
    WithdrawReceived,
    Withdrawn,
    Expired,
    Lapsed,
    Refused,
    IntentRefused,
    ShieldHeld,
    HoldReleased,
    Mismatch,
    Failed,
    Refunded,
    Disputed,
    /// PayPal's answer to a money step never arrived; the wallet is asking PayPal what happened.
    CheckingWithPaypal,
    Other,
    /// A subscriber's renewal failed and a rescue fix waits for the owner.
    RenewalFailed,
    /// The rescue invoice was made at PayPal (a draft nobody is asked to pay yet).
    InvoiceCreated,
    /// The rescue invoice was sent to the subscriber by PayPal.
    InvoiceSent,
    /// PayPal shows the rescue invoice paid.
    InvoicePaid,
    /// Shop around: another seller's table agreed first, so the group rule withdrew this one with
    /// a signed WITHDRAW. No money moved.
    GroupWithdrawn,
    /// The seller said a buyer's deal was paid, and PayPal's statement never showed it within the
    /// wallet's 72-hour window: the deal ends here. This wallet moved no money.
    Unconfirmed,
}
/// Who decided a step, from the typed `decided_by` the chain recorded (never inferred from text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum HistoryAuthority {
    /// The owner, in the approval window.
    Owner,
    /// A rule the owner signed; `clause` when the row names it.
    SignedRule {
        clause: Option<u8>,
    },
    /// The seller mandate on an order the buyer approved at PayPal.
    SellerMandate,
    HouseMandate,
    /// A deadline passed: no money moves, or a hold is voided.
    SafeDefault,
    /// The owner's agent proposed or signed it; never the authority on a money call.
    AgentIntent,
    None,
    /// The shop-around rule the owner chose: the first table to agree wins, the others are
    /// withdrawn. It only ever withdraws; never the authority on a money call.
    GroupRule,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum HistoryPaypal {
    /// PayPal was not asked at this step.
    None,
    Call {
        method: PaypalMethod,
        outcome: PaypalOutcome,
    },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PaypalMethod {
    CreateOrder,
    Authorize,
    Capture,
    Void,
    ReadOrder,
    Reporting,
    Other,
    CreateInvoice,
    SendInvoice,
    ReadInvoice,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PaypalOutcome {
    Ok,
    Failed,
    Unknown,
}

/// "Your safety record" (ops-and-delivery-1 slice 2): the whole-ledger money-authority check the
/// hostile-agent gauntlet runs, run on the owner's own ledger. Every number is counted in Rust
/// from the verified audit chain and each deal's verified export; the webview only draws it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SafetyRecord {
    /// When the check ran (Unix seconds).
    pub checked_at: i64,
    /// Records in the audit chain.
    pub records: u64,
    /// The chain's head when it verifies; `None` when it does not.
    pub head: Option<H256>,
    /// The whole audit chain verifies, record by record.
    pub intact: bool,
    /// Deals in the ledger, and how many of the newest were checked (at most `SAFETY_DEALS`).
    pub deals_total: u64,
    pub deals_checked: u32,
    /// Checked deals whose signed message history verified.
    pub transcripts_verified: u32,
    /// Money steps at PayPal on the checked deals, by who decided them.
    pub money: SafetyMoney,
    /// Agent requests the wallet refused on the checked deals, and by kind of reason.
    pub refusals: u32,
    pub refusal_families: Vec<SafetyRefusalCount>,
    /// Deals the rules refused, and the PayPal calls recorded on them (must be 0).
    pub refused_deals: u32,
    pub refused_deal_calls: u32,
    /// Every break of the invariant found (must be empty), at most `SAFETY_VIOLATIONS` of them;
    /// `violations_total` counts them all.
    pub violations: Vec<SafetyViolation>,
    pub violations_total: u32,
    /// Refusal-trail gaps since the wallet started: refusals over the audit rate cap that were
    /// counted but not written, and refusals whose audit write failed.
    pub unrecorded_refusals: u64,
    pub refusal_write_failures: u64,
}
/// Deals the safety record checks at most (the newest); `deals_checked` says how many it did.
pub const SAFETY_DEALS: u32 = 1000;
/// Violations the safety record lists at most; `violations_total` counts them all.
pub const SAFETY_VIOLATIONS: usize = 50;
/// Money steps (create, authorize, capture, void, invoice) by the authority each stood on.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SafetyMoney {
    /// The owner, in the approval window.
    pub owner: u32,
    /// A rule the owner signed (the countersign under the ask-me threshold).
    pub signed_rule: u32,
    /// The owner's signed shop rules collecting what a buyer approved at PayPal.
    pub shop_rules: u32,
    /// The house seller's signed rules.
    pub house_rules: u32,
    /// A deadline's safe default, and how many of those were cancellations (voids).
    pub safe_default: u32,
    pub safe_default_voids: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SafetyRefusalCount {
    pub family: SafetyRefusalFamily,
    pub count: u32,
}
/// Why the wallet said no to an agent, grouped from the closed refusal codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SafetyRefusalFamily {
    /// A rule the owner signed (limits, price range, offers left, the ask-me threshold, payees,
    /// wallet-wide limits, a shop-around table already won).
    YourRules,
    /// The scam check held the deal.
    ScamCheck,
    /// Out of turn, after the deal closed, while paused, or from an ended or unready session.
    OutOfTurn,
    /// Something the agent's role has no tool for, or another deal than its own.
    NotAllowed,
    /// A request the wallet could not use (malformed, bad numbers, no market price, busy).
    Unusable,
    /// An older record that names no reason code.
    Older,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SafetyViolation {
    /// The deal it is on; `None` for the chain itself.
    pub deal_id: Option<DealId>,
    pub kind: SafetyViolationKind,
    /// The precise finding for Details (names steps, rules and paths; never the other side's words).
    pub detail: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum SafetyViolationKind {
    /// A money step with no authority that fits it.
    Authority,
    /// A money call at PayPal with no recorded money step behind it.
    UntrackedCall,
    /// Something stored about PayPal carries the other side's words.
    CounterpartyText,
    /// A deal the rules refused reached PayPal.
    RefusedDealCalled,
    /// The independent proof checker disagreed with the record.
    VerifierCheck,
    /// The audit chain does not verify.
    ChainBroken,
    /// A deal's evidence does not verify.
    EvidenceUnreadable,
}
