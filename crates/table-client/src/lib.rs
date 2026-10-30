//! Versioned IPC contract shared with the desktop shell and generated TypeScript.
use serde::{Deserialize, Serialize};
use table_attention::{AttentionSnapshot, Form};
pub use table_core::{CounterpartyDisplay, CounterpartyNote, DealDisplay, TranscriptStep};
use table_core::{Deal, DealId, H256, Mode};
pub use table_proto::{PairingIdentity, SignedPairingIdentity};
use ts_rs::TS;
mod approval;
pub mod authority;
pub use approval::*;
mod authority_table;
pub mod deal_states;
mod facts;
pub use facts::*;
mod history;
pub use history::*;
pub mod ladder;
mod mandate;
pub use mandate::*;
mod pairing;
pub use pairing::*;
mod rescue;
pub use rescue::*;
mod run_state;
pub use run_state::*;
mod settings;
pub use settings::*;
pub mod playbooks;
pub mod tray;
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
            // A revoked or expired pin is the owner's own decision or a lapse: a refusal, not a fault.
            table_app::Error::Ledger(
                table_ledger::LedgerError::PinRevoked | table_ledger::LedgerError::PinExpired,
            ) => ErrorCode::Refused,
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
    /// Every slot, in the order they are provisioned. The one list; a test pins it to the
    /// variants the wire format names.
    pub const ALL: [Self; 3] = [Self::Negotiator, Self::Shopper, Self::Assistant];
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
pub struct BandArgs {
    pub deal_id: DealId,
    pub floor: Option<table_core::Money>,
    pub ceiling: Option<table_core::Money>,
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
/// Revoke the pin of one counterparty (approval, privileged).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct CounterpartyRevokeArgs {
    pub key_id: table_core::KeyId,
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
    /// Clears the sticky pause and lists the tables waiting on our agent; it starts none of them.
    pub resume_all_agents: Command<(), ResumeReport>,
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
    /// "Your safety record": the whole-ledger money-authority check on the owner's ledger (main).
    pub safety_record: Command<(), SafetyRecord>,
    /// Revokes a counterparty pin: the key is refused from then on (approval, privileged).
    pub counterparty_revoke: Command<CounterpartyRevokeArgs, ()>,
    /// Wallet-limits what-if: draft limits replayed over recorded purchases. Read-only, approval.
    pub envelope_simulate: Command<EnvelopeSimulateArgs, MandateSimulation>,
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
/// Declares [`WindowEvent`]: one variant per `EventContract` field, borrowing its payload, with
/// the field's serde name. `tests/bindings.rs` checks every (name, payload type) pair against
/// `EventContract` and every name against the authority table's `EVENTS`, in both directions.
macro_rules! window_events {
    ($($variant:ident($payload:ty) = $name:literal,)*) => {
        /// One window event, typed: its name and payload travel together, so a misspelt name or a
        /// payload of the wrong shape does not compile. Who is told it is the event's row in the
        /// authority table ([`WindowEvent::audience`]); the desktop shell sends every event
        /// through one helper that reads that row, never to a hand-written window label.
        #[derive(Debug, Clone, Copy)]
        pub enum WindowEvent<'a> {
            $($variant(&'a $payload),)*
        }
        impl WindowEvent<'_> {
            /// The event's wire name (its `EventContract` serde name).
            pub const fn name(&self) -> &'static str {
                match self {
                    $(Self::$variant(_) => $name,)*
                }
            }
            /// `(event name, TypeScript payload type)` for every variant, for the bindings test.
            pub fn contract(config: &ts_rs::Config) -> Vec<(&'static str, String)> {
                vec![$(($name, <$payload as TS>::name(config)),)*]
            }
        }
        impl Serialize for WindowEvent<'_> {
            /// The payload alone, exactly as the `EventContract` field serializes.
            fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                match self {
                    $(Self::$variant(payload) => payload.serialize(serializer),)*
                }
            }
        }
    };
}
window_events! {
    TumblerHandoff(TumblerHandoff) = "tumbler:handoff",
    AgentChanged(RunSnapshot) = "agent:changed",
    SettingsChanged(SettingsSnapshot) = "settings:changed",
    WalletError(CommandError) = "wallet:error",
    TumblerVisual(VisualState) = "tumbler:visual",
    TumblerSelected(DealArgs) = "tumbler:selected",
    AttentionChanged(AttentionSnapshot) = "attention:changed",
    DealChanged(DealChanged) = "deal:changed",
    ReceiptCreated(ReceiptEvent) = "receipt:created",
    TumblerOrient(OrientationEvent) = "tumbler:orient",
    TumblerForm(Form) = "tumbler:form",
    TumblerStatus(TumblerStatus) = "tumbler:status",
    ApprovalSummary(ApprovalSummary) = "approval:summary",
    MainRoute(MainRoute) = "main:route",
    PairingPinned(PairingPinned) = "pairing:pinned",
}
impl WindowEvent<'_> {
    /// Every window this event is sent to: its row in the authority table (`authority::EVENTS`).
    /// An event without a row reaches no window; the bindings test keeps every event's row.
    pub fn audience(&self) -> &'static [authority::WindowLabel] {
        authority::event_audience(self.name()).unwrap_or(&[])
    }
}
/// Every IPC command and the release set, derived from the authority table (`authority_table.rs`).
pub use authority::{COMMANDS, RELEASE_COMMANDS};
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
    /// `AgentSlot::ALL` is every variant, once: the exhaustive match stops compiling when a slot
    /// is added, and each slot's wire name is its key name.
    #[test]
    fn the_agent_slot_list_holds_every_variant_once() {
        let index = |slot: AgentSlot| match slot {
            AgentSlot::Negotiator => 0,
            AgentSlot::Shopper => 1,
            AgentSlot::Assistant => 2,
        };
        let mut seen: Vec<usize> = AgentSlot::ALL.into_iter().map(index).collect();
        seen.sort_unstable();
        assert_eq!(seen, [0, 1, 2]);
        for slot in AgentSlot::ALL {
            let wire = serde_json::to_value(slot).unwrap();
            assert_eq!(format!("agent.{}", wire.as_str().unwrap()), slot.key_name());
        }
    }
    /// The rules draft Main's "Say it" hands to the approval window, exactly as the client sends it
    /// (typed clause shapes, an empty payee list, an item band): it reads as the `Rules` variant,
    /// and a field it does not know is refused (the draft is closed, like every other).
    #[test]
    fn a_rules_draft_reads_as_the_client_sends_it() {
        let sent = r#"{"type":"rules","agent":"negotiator","not_before":1793358240,"expires":1793379600,"clauses":[
            {"type":"roles","roles":["buy"]},
            {"type":"counterparties","rule":{"type":"paired"}},
            {"type":"per_deal","kind":"haggle","max_amount":{"minor":34000,"currency":"USD"},"categories":["office"]},
            {"type":"band","item_refs":["monitor-27-4k"],"floor":null,"ceiling":{"minor":34000,"currency":"USD"},"max_rounds":6,"deadline":1793379600},
            {"type":"velocity","max_deals_day":2,"max_total_day":{"minor":34000,"currency":"USD"}},
            {"type":"human_present_over","amount":{"minor":32000,"currency":"USD"}},
            {"type":"payees","payees":[]}]}"#;
        let draft: ApprovalDraft = serde_json::from_str(sent).unwrap();
        let ApprovalDraft::Rules {
            agent,
            not_before,
            expires,
            clauses,
        } = draft
        else {
            panic!("not the rules variant");
        };
        assert_eq!(agent, AgentSlot::Negotiator);
        assert!(expires > not_before);
        assert_eq!(clauses.len(), 7);
        let with_extra = sent.replacen(
            r#""agent":"negotiator""#,
            r#""agent":"negotiator","sign":true"#,
            1,
        );
        assert!(serde_json::from_str::<ApprovalDraft>(&with_extra).is_err());
    }
}
