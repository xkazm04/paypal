//! Versioned IPC contract shared with the desktop shell and generated TypeScript.
use serde::{Deserialize, Serialize};
use table_attention::{AttentionSnapshot, Form, Placement};
pub use table_core::{CounterpartyDisplay, CounterpartyNote, DealDisplay, TranscriptStep};
use table_core::{Deal, DealId, H256, Mode};
pub use table_proto::{PairingIdentity, SignedPairingIdentity};
use ts_rs::TS;
pub mod authority;
mod authority_table;
pub mod ladder;
pub mod playbooks;
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    Locked,
    Permission,
    /// A signed mandate clause refused the intent: a policy answer, not malformed input.
    Refused,
    Invalid,
    NotFound,
    Unavailable,
    LedgerTrust,
    Unsupported,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CommandError {
    pub code: ErrorCode,
    pub message: String,
}
impl From<table_app::Error> for CommandError {
    fn from(error: table_app::Error) -> Self {
        let code = match &error {
            table_app::Error::Locked => ErrorCode::Locked,
            table_app::Error::Permission => ErrorCode::Permission,
            table_app::Error::Refused(_) | table_app::Error::Agent(_) => ErrorCode::Refused,
            table_app::Error::Invalid
            | table_app::Error::Domain(_)
            | table_app::Error::Protocol(_) => ErrorCode::Invalid,
            table_app::Error::Unavailable => ErrorCode::Unavailable,
            table_app::Error::Ledger(table_ledger::LedgerError::NotFound) => ErrorCode::NotFound,
            // Shop around: another table of the group already agreed. A refusal, not a fault.
            table_app::Error::Ledger(table_ledger::LedgerError::GroupClosed) => ErrorCode::Refused,
            table_app::Error::Ledger(_) => ErrorCode::LedgerTrust,
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealArgs {
    pub deal_id: DealId,
}
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DecisionArgs {
    pub deal_id: DealId,
    pub attempt: u8,
    pub terms_hash: H256,
    // Required for owner ACCEPT. Digest of the exact latest signed counter.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub counter_hash: Option<H256>,
    /// The `ApprovalSummary.checks_hash` the owner decided on. Required for every money
    /// decision except the safe direction (void); Rust recomputes the checklist at decision time
    /// and refuses an absent or different hash before any PayPal call or write.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub checks_hash: Option<H256>,
}
impl std::fmt::Debug for DecisionArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DecisionArgs")
            .field("deal_id", &self.deal_id)
            .finish_non_exhaustive()
    }
}
#[derive(Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct UnlockArgs {}
impl std::fmt::Debug for UnlockArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UnlockArgs { [REDACTED] }")
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct FormArgs {
    pub form: Form,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PinArgs {
    pub pinned: bool,
}
#[derive(Clone, Serialize, Deserialize, TS)]
pub struct IpcHeaders {
    #[serde(rename = "X-Wallet-Ipc")]
    pub ipc_token: String,
}
impl std::fmt::Debug for IpcHeaders {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("IpcHeaders { [REDACTED] }")
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct SettingsSnapshot {
    pub house: HouseState,
    pub mode: Mode,
    pub locked: bool,
    pub native_reauth_available: bool,
    pub payment_executor_configured: bool,
    /// Suppress spend/cost/stopped meters until their accounting sources are attached.
    pub meters_available: bool,
    pub client_pending: bool,
    pub first_run: bool,
    pub channel3_configured: bool,
    pub agents_paused: bool,
    pub selected_engine: table_engine::EngineId,
    pub preferences: TumblerPreferences,
    pub relay_available: bool,
    /// Lowercase hex fingerprint of the authority table this build enforces (who may call each
    /// command); the same value as `AUTHORITY_MANIFEST` in `bindings/authority.ts`.
    pub authority_manifest: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum HouseState {
    Unavailable,
    Idle,
    Waking,
    Ready,
}

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

/// Selects native credential UI. No IPC argument or result can contain a secret.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum CredentialArgs {
    PaypalSandbox,
    Channel3,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum AgentSlot {
    Negotiator,
    Shopper,
    Assistant,
}
impl AgentSlot {
    pub const fn key_name(self) -> &'static str {
        match self {
            Self::Negotiator => "agent.negotiator",
            Self::Shopper => "agent.shopper",
            Self::Assistant => "agent.assistant",
        }
    }
}
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct BandArgs {
    pub deal_id: DealId,
    pub floor: Option<table_core::Money>,
    pub ceiling: Option<table_core::Money>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TumblerPreferences {
    pub pinned: bool,
    pub position: Option<PuckPosition>,
    pub form: Form,
    pub quiet: bool,
    pub dnd: bool,
    pub notifications: bool,
    pub snap: table_attention::Snap,
}
impl Default for TumblerPreferences {
    fn default() -> Self {
        Self {
            pinned: true,
            position: None,
            form: Form::Rest,
            quiet: true,
            dnd: false,
            notifications: true,
            snap: table_attention::Snap::Free,
        }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct PuckPosition {
    pub x: i32,
    pub y: i32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct EngineSelectArgs {
    pub engine: table_engine::EngineId,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentStartArgs {
    pub deal_id: DealId,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MarketRefreshArgs {
    pub deal_id: DealId,
    pub product_id: String,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Starting,
    Running,
    Clean,
    Failed,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RunSnapshot {
    pub run: table_core::RunId,
    pub deal_id: DealId,
    pub engine: table_engine::EngineId,
    pub mode: Mode,
    pub state: RunState,
    /// The fixed role playbook an agent app run was started with (its system prompt, shown
    /// word for word in the run's details); null for the policy negotiator, which reads none.
    /// Older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub playbook: Option<table_core::Playbook>,
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
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealCreateArgs {
    pub kind: table_core::DealKind,
    pub side: table_core::Side,
    pub counterparty: table_core::KeyId,
    pub mandate_id: table_core::MandateId,
    pub mandate_version: u32,
    pub terms: table_core::Terms,
    pub category: table_core::Category,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealJoinArgs {
    pub deal_id: DealId,
    pub create: DealCreateArgs,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReconcileArgs {
    pub deal_id: DealId,
    pub start: i64,
    pub end: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct QuitSummary {
    /// Binds the pending deals and every line below; quit_confirm refuses if any changed.
    pub confirmation_id: H256,
    pub pending: Vec<DealId>,
    pub on_quit: String,
    /// What will not happen while the wallet is off, one line per pending deal the forecast moves
    /// money for (or that waits). None when the forecast could not be read; older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub while_off: Option<Vec<table_attention::QuitLine>>,
    /// What PayPal still does by itself (a payment request or a hold running out). None when the
    /// forecast could not be read; older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub at_paypal: Option<Vec<table_attention::QuitLine>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct QuitArgs {
    pub confirmation_id: H256,
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
/// A failed renewal and its one fix, as the wallet computed and stored it. No subscriber or
/// agent text: the invoice wording is the wallet's fixed template filled with these numbers.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueView {
    pub deal_id: DealId,
    pub source: table_core::RescueSource,
    pub offer: table_core::RescueOffer,
    pub text: table_core::InvoiceText,
    pub failed_payments: u32,
    /// PayPal's own next retry, when known.
    #[ts(optional = nullable)]
    pub next_retry_at: Option<i64>,
    /// The subscriber's address, masked ("s•••@example.com").
    pub recipient: String,
    /// The PayPal invoice, once made.
    #[ts(optional = nullable)]
    pub invoice: Option<String>,
    /// PayPal showed it paid and the wallet receipted it, on a failure PayPal reported: this is
    /// the only money counted as recovered.
    pub counted: bool,
}
/// Shop around (T8): group open buyer tables for one item, each with a different paired seller,
/// under one signed mandate. The first table to agree wins; the wallet withdraws the others with
/// a signed WITHDRAW. Grouping only restricts: it moves no money and grants nothing.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealGroupOpenArgs {
    pub deal_ids: Vec<DealId>,
}
/// One table of a shop-around group: typed, signed prices only (never the seller's words).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct GroupTable {
    pub deal_id: DealId,
    pub counterparty: table_core::KeyId,
    pub state: table_core::DealState,
    /// The seller's latest signed price (listing or counter); null before any.
    pub seller_price: Option<table_core::Money>,
    /// Our latest signed offer; null before any.
    pub our_price: Option<table_core::Money>,
    /// Withdrawn by the group rule because another table agreed first.
    pub closed_by_group: bool,
}
/// A shop-around group as the owner sees it: one buyer intent, several sellers, one winner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealGroupView {
    pub group_id: table_core::GroupId,
    pub item_ref: table_core::ItemRef,
    pub opened_at: i64,
    /// The table that agreed; null while the sellers are still bargaining.
    pub winner: Option<DealId>,
    /// Oldest table first.
    pub tables: Vec<GroupTable>,
}
/// Every rescue, and the recovered money (one total per currency, never summed across them).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueBook {
    pub cases: Vec<RescueView>,
    pub recovered: Vec<table_core::Money>,
    /// The owner's own subscriptions the wallet reads for a failed renewal, oldest first.
    pub watching: Vec<RescueWatchView>,
    /// Subscription reads made today (UTC) and the most the wallet makes in a day.
    pub watch_reads_today: u32,
    pub watch_reads_max: u32,
}
/// Watch one of the owner's own subscriptions for a failed renewal (approval, privileged). The
/// wallet reads it from PayPal every few hours, read only; a failure opens one fix that waits for
/// the owner, PayPal-reported, so what it brings in can count.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchArgs {
    /// The PayPal subscription id to watch.
    pub subscription_id: String,
    /// The subscriber's email address a fix's invoice goes to, as the owner enters it (the
    /// subscription read does not supply it).
    pub subscriber_email: String,
    /// The plan, as your own item name.
    pub plan: table_core::ItemRef,
}
/// Stop watching one subscription (approval, privileged). A fix it already opened is unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchStopArgs {
    pub subscription_id: String,
}
/// What the wallet last learned about a watched subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RescueWatchState {
    /// Not read yet.
    Waiting,
    /// The last read showed no failed payment.
    Paid,
    /// The current failure already has its one fix.
    FixOpened,
    /// A failure the wallet does not fix on its own (more than one cycle owed, or the rules do
    /// not allow a fix): it is shown, nothing is sent.
    FailedNoFix,
    /// The last reads could not be used; the wallet tries again later.
    CantRead,
}
/// One watched subscription, as the Rescue page and the approval window show it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchView {
    pub subscription_id: String,
    /// The subscriber's address, masked ("s•••@example.com").
    pub recipient: String,
    pub plan: table_core::ItemRef,
    pub state: RescueWatchState,
    pub added_at: i64,
    #[ts(optional = nullable)]
    pub last_read_at: Option<i64>,
    pub next_read_at: i64,
}
/// A failed renewal the owner records as a labelled replay: PayPal documents no way to fail a
/// sandbox renewal. The deal carries the REPLAY mode; its invoice is real, never counted.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueReplayArgs {
    /// The PayPal subscription id the failure is about.
    pub subscription_id: String,
    /// The subscriber's email address the invoice goes to.
    pub subscriber_email: String,
    /// The plan, as your own item name.
    pub plan: table_core::ItemRef,
    /// The cycle's price at the plan.
    pub amount: table_core::Money,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealChanged {
    pub deal: Deal,
    pub mode: Mode,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ReceiptEvent {
    pub deal_id: DealId,
    pub evidence: table_core::DealEvidence,
    pub mode: Mode,
    pub state: table_core::DealState,
    pub on_silence: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TumblerHandoff {
    pub deal_id: DealId,
    pub approve_until: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MandateListEntry {
    #[serde(flatten)]
    #[ts(flatten)]
    pub mandate: table_core::OpenMandate,
    pub agent: AgentSlot,
    /// Set when the signed policy no longer fits the wallet's rules: nothing acts under it
    /// until it is signed again, and it can still be withdrawn.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub refusal: Option<table_core::Refusal>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct MainRoute {
    pub deal_id: Option<DealId>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct OrientationEvent {
    pub form: Form,
    pub placement: Placement,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct TumblerStatus {
    pub visible: bool,
    pub form: Form,
    pub count: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct VisualState {
    pub opacity_percent: u8,
    pub breathe: bool,
}
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
/// Aggregate rows, grouped by currency and mode first: amounts in minor units, market distance in
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
/// No real proof file comes near this; a larger one is refused before it is parsed.
pub const PROOF_FILE_LIMIT: usize = 8 * 1024 * 1024;
/// Check a proof file's bytes with the same verifier as the command-line tool. Pure: no IO.
pub fn check_proof_file(bytes: &[u8]) -> Result<ProofReport, CommandError> {
    let refuse = |message: &str| CommandError {
        code: ErrorCode::Unsupported,
        message: message.into(),
    };
    if bytes.len() > PROOF_FILE_LIMIT {
        return Err(refuse(
            "This file is far larger than any proof file, so it was not checked.",
        ));
    }
    let bundle: table_proto::ProofBundle = serde_json::from_slice(bytes).map_err(|_| {
        refuse("This file is not a proof file saved by this wallet, so there is nothing to check.")
    })?;
    let report = table_verify::verify_bundle(&bundle);
    let own = authority::manifest_hex();
    Ok(ProofReport {
        deal_id: report.deal,
        mode: report.mode,
        owner_key_id: report.owner_key_id.clone(),
        verified: report.verified(),
        same_version: report
            .authority_manifest
            .as_deref()
            .map(|theirs| own == Some(theirs)),
        authority_manifest: report.authority_manifest,
        checks: report
            .checks
            .into_iter()
            .map(|c| ProofCheckLine {
                id: c.id.into(),
                ok: c.ok,
                checked: c.checked,
                applies: c.applies,
                detail: c.detail,
            })
            .collect(),
    })
}
/// Type-level command signature. The shell receives non-null arguments under `args`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct Command<A, R> {
    pub args: A,
    pub result: R,
}
#[derive(Debug, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CommandContract {
    pub approval_selection: Command<(), Option<DealId>>,
    pub deal_display: Command<DealArgs, DealDisplay>,
    pub deal_transcript: Command<DealArgs, Vec<TranscriptStep>>,
    pub counterparty_list: Command<(), Vec<CounterpartyDisplay>>,
    pub get_settings: Command<(), SettingsSnapshot>,
    pub list_deals: Command<(), Vec<Deal>>,
    pub get_deal: Command<DealArgs, Deal>,
    pub deal_evidence: Command<DealArgs, table_core::DealEvidence>,
    pub deal_reconcile: Command<ReconcileArgs, table_core::DealEvidence>,
    pub engine_status: Command<(), Vec<table_engine::EngineInfo>>,
    pub attention_list: Command<(), AttentionSnapshot>,
    pub main_open: Command<MainRoute, ()>,
    pub approval_open: Command<ApprovalOpenArgs, ()>,
    pub approval_summary: Command<DealArgs, ApprovalSummary>,
    pub approval_pairing: Command<(), Option<PendingPairing>>,
    pub approval_token: Command<(), String>,
    pub tumbler_set_form: Command<FormArgs, ()>,
    pub tumbler_pin: Command<PinArgs, ()>,
    pub deal_withdraw: Command<DealArgs, ()>,
    pub deal_let_lapse: Command<DealArgs, ()>,
    pub deal_snooze: Command<DealArgs, ()>,
    pub unlock: Command<UnlockArgs, ()>,
    pub deal_countersign: Command<DecisionArgs, Deal>,
    pub deal_owner_accept: Command<DecisionArgs, Deal>,
    pub deal_capture: Command<DecisionArgs, Deal>,
    pub deal_void: Command<DecisionArgs, Deal>,
    pub shield_release: Command<DecisionArgs, Deal>,
    pub rescue_approve: Command<DecisionArgs, Deal>,
    pub open_paypal_in_browser: Command<DecisionArgs, ()>,
    pub set_credentials: Command<CredentialArgs, ()>,
    pub engine_select: Command<EngineSelectArgs, ()>,
    pub mandate_list: Command<(), Vec<MandateListEntry>>,
    pub mandate_sign: Command<MandateSignArgs, table_core::OpenMandate>,
    pub mandate_revoke: Command<MandateRevokeArgs, ()>,
    pub band_set: Command<BandArgs, table_core::OpenMandate>,
    pub pairing_create: Command<PairingCreateArgs, PairingOffer>,
    pub pairing_join: Command<PairingJoinArgs, PairingWords>,
    pub pairing_poll: Command<PairingPollArgs, Option<PairingWords>>,
    pub pairing_confirm: Command<PairingConfirmArgs, table_core::KeyId>,
    pub settings_write: Command<TumblerPreferences, ()>,
    pub deal_create: Command<DealCreateArgs, Deal>,
    pub deal_join: Command<DealJoinArgs, Deal>,
    pub pause_all_agents: Command<(), ()>,
    pub resume_all_agents: Command<(), ()>,
    pub agent_start: Command<AgentStartArgs, RunSnapshot>,
    pub agent_runs: Command<(), Vec<RunSnapshot>>,
    pub market_refresh: Command<MarketRefreshArgs, table_core::MarketRef>,
    pub quit_summary: Command<(), QuitSummary>,
    pub quit_confirm: Command<QuitArgs, ()>,
    pub tumbler_drag: Command<(), ()>,
    pub tumbler_snap: Command<(), table_attention::Snap>,
    pub counterparty_note: Command<DealArgs, Option<CounterpartyNote>>,
    pub pairing_abort: Command<PairingAbortArgs, ()>,
    pub house_wake: Command<(), HouseState>,
    pub approval_handoff: Command<(), ApprovalHandoff>,
    pub audit_page: Command<AuditPageArgs, AuditPage>,
    pub owner_facts: Command<(), OwnerFacts>,
    pub book_query: Command<BookQueryArgs, BookAnswer>,
    /// Saves the deal's signed proof bundle through a native save dialog; false if cancelled.
    pub deal_export_proof: Command<DealArgs, bool>,
    /// Checks a proof file the owner picks in a native open dialog; null if cancelled.
    pub proof_check: Command<(), Option<ProofReport>>,
    /// Who decided each money step: the verified audit chain as closed steps (main only).
    pub deal_history: Command<DealHistoryArgs, DealHistory>,
    /// What-if before signing: a draft replayed over recorded deals. Read-only, approval only.
    pub mandate_simulate: Command<MandateSimulateArgs, MandateSimulation>,
    /// Signs the wallet-wide limits with the owner key (approval window, privileged).
    pub envelope_sign: Command<EnvelopeSignArgs, table_core::SignedEnvelope>,
    /// The wallet-wide limits and live exposure numbers only (main, tumbler, approval).
    pub envelope_get: Command<(), table_core::ExposureView>,
    /// Records a failed renewal as a labelled replay and opens its rescue (approval, privileged).
    pub rescue_replay: Command<RescueReplayArgs, Deal>,
    /// Every rescue and the recovered money, read from the wallet (main and approval).
    pub rescue_book: Command<(), RescueBook>,
    /// Shop around (T8): groups open buyer tables for one item; first to agree wins (main).
    pub deal_group_open: Command<DealGroupOpenArgs, DealGroupView>,
    /// Every shop-around group with each seller's latest signed price (main).
    pub deal_groups: Command<(), Vec<DealGroupView>>,
    /// Watches one of the owner's subscriptions for a failed renewal (approval, privileged).
    pub rescue_watch_add: Command<RescueWatchArgs, Vec<RescueWatchView>>,
    /// Stops watching one subscription (approval, privileged).
    pub rescue_watch_stop: Command<RescueWatchStopArgs, Vec<RescueWatchView>>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct EventContract {
    #[serde(rename = "tumbler:handoff")]
    pub tumbler_handoff: TumblerHandoff,
    #[serde(rename = "agent:changed")]
    pub agent_changed: RunSnapshot,
    #[serde(rename = "settings:changed")]
    pub settings_changed: SettingsSnapshot,
    #[serde(rename = "wallet:error")]
    pub wallet_error: CommandError,
    #[serde(rename = "tumbler:visual")]
    pub tumbler_visual: VisualState,
    #[serde(rename = "tumbler:selected")]
    pub tumbler_selected: DealArgs,
    #[serde(rename = "attention:changed")]
    pub attention_snapshot: AttentionSnapshot,
    #[serde(rename = "deal:changed")]
    pub deal_changed: DealChanged,
    #[serde(rename = "receipt:created")]
    pub receipt: ReceiptEvent,
    #[serde(rename = "tumbler:orient")]
    pub orientation: OrientationEvent,
    #[serde(rename = "tumbler:form")]
    pub form: Form,
    #[serde(rename = "tumbler:status")]
    pub tumbler_status: TumblerStatus,
    #[serde(rename = "approval:summary")]
    pub approval_summary: ApprovalSummary,
    #[serde(rename = "main:route")]
    pub main_route: MainRoute,
    #[serde(rename = "pairing:pinned")]
    pub pairing_pinned: PairingPinned,
}
/// Every IPC command and the release set, derived from the authority table (`authority_table.rs`).
pub use authority::{COMMANDS, RELEASE_COMMANDS};
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
#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod proof_file_tests {
    use super::*;
    #[test]
    fn a_file_that_is_not_a_bundle_or_too_large_is_refused_in_plain_words() {
        for bytes in [&b"hello"[..], b"{}", b"{\"format\":\"table.proof.v1\"}"] {
            let error = check_proof_file(bytes).unwrap_err();
            assert!(matches!(error.code, ErrorCode::Unsupported));
            assert!(
                error.message.contains("not a proof file"),
                "{}",
                error.message
            );
        }
        let error = check_proof_file(&vec![b' '; PROOF_FILE_LIMIT + 1]).unwrap_err();
        assert!(matches!(error.code, ErrorCode::Unsupported));
        assert!(error.message.contains("larger"), "{}", error.message);
    }
}
