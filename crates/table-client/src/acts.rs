//! Safe acts (docs/design/conversational-home-safe-acts.md): small, reversible owner actions the
//! main window may run, one at a time, after an explicit press. None of them moves, approves,
//! signs, captures, voids or releases money; each one can be undone by another act in the set.
//!
//! `assistant_act` is the one door the board uses for an act the assistant proposed: it runs the
//! act the wallet resolves from this closed enum and writes one `assistant.act` row to the audit
//! chain, with the words the owner was shown. The direct commands (`agent_pause`, `agent_resume`,
//! `deal_lapse_undo`) serve the console's own buttons and write no provenance row.
use crate::AgentSlot;
use serde::{Deserialize, Serialize};
use table_core::DealId;
use ts_rs::TS;

/// One agent, by its slot.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AgentArgs {
    pub agent: AgentSlot,
}

/// The closed set of acts an assistant proposal may lead to, each with its typed target only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "act", rename_all = "snake_case", deny_unknown_fields)]
pub enum AssistantAct {
    /// Every agent stops; nothing new starts (`pause_all_agents`).
    PauseAll {},
    /// The undo of `PauseAll` (`resume_all_agents`); starts nothing.
    ResumeAll {},
    /// Leave one ask to its silence outcome (`deal_let_lapse`): hidden until its deadline.
    LetLapse { deal_id: DealId },
    /// The undo of `LetLapse` (`deal_lapse_undo`): the ask is back on the owner's list.
    LapseUndo { deal_id: DealId },
    /// One agent stops; nothing new starts for it (`agent_pause`).
    PauseAgent { agent: AgentSlot },
    /// The undo of `PauseAgent` (`agent_resume`); starts nothing.
    ResumeAgent { agent: AgentSlot },
}
impl AssistantAct {
    /// The audit word for this act (closed; never caller text).
    pub const fn name(self) -> &'static str {
        match self {
            Self::PauseAll {} => "pause_all",
            Self::ResumeAll {} => "resume_all",
            Self::LetLapse { .. } => "let_lapse",
            Self::LapseUndo { .. } => "lapse_undo",
            Self::PauseAgent { .. } => "pause_agent",
            Self::ResumeAgent { .. } => "resume_agent",
        }
    }
    pub const fn deal(self) -> Option<DealId> {
        match self {
            Self::LetLapse { deal_id } | Self::LapseUndo { deal_id } => Some(deal_id),
            _ => None,
        }
    }
    pub const fn agent(self) -> Option<AgentSlot> {
        match self {
            Self::PauseAgent { agent } | Self::ResumeAgent { agent } => Some(agent),
            _ => None,
        }
    }
}

/// What the owner was shown when she pressed: the consent box's words (fixed product words and
/// the wallet's own facts, never assistant or counterparty text) and the board's fingerprint of
/// the resolved action. Bounded and plain; anything else is refused, never trimmed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct ConsentShown {
    pub words: String,
    pub fingerprint: String,
}
pub const CONSENT_WORDS_MAX: usize = 800;
pub const CONSENT_FINGERPRINT_MAX: usize = 160;
impl ConsentShown {
    /// Non-empty, within the caps, no control characters.
    pub fn is_plain(&self) -> bool {
        let ok = |s: &str, max: usize| {
            !s.trim().is_empty() && s.len() <= max && !s.chars().any(char::is_control)
        };
        ok(&self.words, CONSENT_WORDS_MAX) && ok(&self.fingerprint, CONSENT_FINGERPRINT_MAX)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AssistantActArgs {
    pub act: AssistantAct,
    pub consent: ConsentShown,
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    #[test]
    fn acts_parse_only_their_own_fields() {
        let a: AssistantAct = serde_json::from_str(r#"{"act":"pause_all"}"#).unwrap();
        assert_eq!(a, AssistantAct::PauseAll {});
        let a: AssistantAct =
            serde_json::from_str(r#"{"act":"pause_agent","agent":"shopper"}"#).unwrap();
        assert_eq!(a.agent(), Some(AgentSlot::Shopper));
        for bad in [
            r#"{"act":"pause_all","deal_id":"x"}"#,
            r#"{"act":"deal_capture"}"#,
            r#"{"act":"pause_agent","agent":"owner"}"#,
            r#"{"act":"let_lapse"}"#,
        ] {
            assert!(serde_json::from_str::<AssistantAct>(bad).is_err(), "{bad}");
        }
    }
    #[test]
    fn consent_words_are_bounded_and_plain() {
        let c = |w: &str, f: &str| ConsentShown {
            words: w.into(),
            fingerprint: f.into(),
        };
        assert!(c("Pause all your agents.", "pause_agents|paused=false").is_plain());
        assert!(!c("", "x").is_plain());
        assert!(!c("x", " ").is_plain());
        assert!(!c("line\nbreak", "x").is_plain());
        assert!(!c(&"a".repeat(CONSENT_WORDS_MAX + 1), "x").is_plain());
        assert!(!c("x", &"f".repeat(CONSENT_FINGERPRINT_MAX + 1)).is_plain());
    }
}
