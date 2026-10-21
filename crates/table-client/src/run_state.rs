//! The agent run-state and quit DTOs.
use serde::{Deserialize, Serialize};
use table_core::{DealId, H256, Mode};
use ts_rs::TS;
/// What `resume_all_agents` found once the pause was cleared: the tables waiting on our agent,
/// soonest deadline first. Resume starts none of them; each restart is the owner's `agent_start`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ResumeReport {
    pub waiting: Vec<WaitingTable>,
}
/// A table whose next move is ours (the agent may send or accept an offer now), with no run on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct WaitingTable {
    pub deal_id: DealId,
    /// When the table lapses if nobody answers (the earlier of the band's and the deal's own).
    pub deadline: i64,
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
