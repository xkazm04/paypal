use serde::{Deserialize, Serialize};
use table_attention::{Form, Placement};
use table_core::{DealId, Mode};
use ts_rs::TS;
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
    /// The owner has chosen an agent app through `engine_select` (the ledger preference exists),
    /// including the practice agent. False on a new wallet, whose `scripted` is only a default.
    pub engine_chosen: bool,
    /// The house seller is connected (a counterparty pinned through HOUSE). A boolean only, so a
    /// window that may not read `counterparty_list` (the Tumbler) can tell the first-run path's
    /// practice step is done without any counterparty word reaching it.
    pub house_connected: bool,
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
pub struct TumblerHandoff {
    pub deal_id: DealId,
    pub approve_until: i64,
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
