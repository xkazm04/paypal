//! The board assistant's IPC (`assistant_ask`, `assistant_status`; main window, read tier, shell
//! enforced). The shell holds a `table_engine::AssistantDoor`; this module owns the wire types,
//! the pinned prompt and reply schema the door is built with, and the owner's words for each
//! refusal. The reply crosses as raw JSON text and stays untrusted: the client's `validateReply`
//! is the only door to the board, and a proposal in it only ever opens the approval window.
use crate::{CommandError, ErrorCode};
use serde::{Deserialize, Serialize};
use table_engine::{AssistantRefusal, AssistantSpec, AssistantStatus};
use ts_rs::TS;

/// One question. `text` is the owner's question and the board digest exactly as the main
/// window built them (`lib/assistant/digest.ts`: no counterparty text); nothing else crosses.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct AssistantAskArgs {
    pub text: String,
}
/// Whether a question would be tried at all. Runs no model and spends nothing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct AssistantAvailability {
    pub available: bool,
    /// Plain words for the owner when it is not available.
    pub reason: Option<String>,
}

/// The pinned system prompt and reply JSON schema, generated from the client's
/// `lib/assistant/prompt.ts` and `vocabulary.ts` (`tauriEngine.test.ts` fails when they drift;
/// `UPDATE_ASSISTANT_CONTRACT=1` rewrites this file).
pub const ASSISTANT_CONTRACT: &str = include_str!("assistant_contract.json");

/// The door's spec from the pinned contract.
pub fn assistant_spec() -> Result<AssistantSpec, CommandError> {
    let pinned: serde_json::Value = serde_json::from_str(ASSISTANT_CONTRACT)
        .map_err(|_| refusal_error(AssistantRefusal::Unavailable))?;
    let prompt = pinned
        .get("system_prompt")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| refusal_error(AssistantRefusal::Unavailable))?;
    let schema = pinned
        .get("schema")
        .ok_or_else(|| refusal_error(AssistantRefusal::Unavailable))?;
    AssistantSpec::new(prompt, schema).map_err(|_| refusal_error(AssistantRefusal::Unavailable))
}

/// The owner's words for each refusal (docs/ux/UX-GUIDE.md: plain, no internals). The client
/// shows none of them today: it answers from the scripted preview and says so.
pub fn refusal_error(refusal: AssistantRefusal) -> CommandError {
    let (code, message) = match refusal {
        AssistantRefusal::Unavailable => (
            ErrorCode::Unavailable,
            "The assistant app isn't available on this computer right now.",
        ),
        AssistantRefusal::Unsupported => (
            ErrorCode::Unsupported,
            "The assistant app can't run on this computer.",
        ),
        AssistantRefusal::Isolation => (
            ErrorCode::Unavailable,
            "The wallet couldn't confirm the assistant app works without any tools, so it isn't used.",
        ),
        AssistantRefusal::Busy => (
            ErrorCode::Refused,
            "The assistant is still answering the last question.",
        ),
        AssistantRefusal::Limited => (
            ErrorCode::Refused,
            "That's a lot of questions in a minute. Try again shortly.",
        ),
        AssistantRefusal::Invalid => (ErrorCode::Invalid, "That question can't be sent."),
        AssistantRefusal::Timeout => (
            ErrorCode::Unavailable,
            "The assistant took too long, so it was stopped.",
        ),
        AssistantRefusal::BadOutput => (
            ErrorCode::Unavailable,
            "The assistant's answer couldn't be read.",
        ),
    };
    CommandError {
        code,
        message: message.into(),
    }
}

pub fn availability(status: AssistantStatus) -> AssistantAvailability {
    AssistantAvailability {
        available: status.available,
        reason: status.refusal.map(|r| refusal_error(r).message),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn the_pinned_contract_builds_a_spec() {
        let spec = assistant_spec().unwrap();
        assert!(spec.system_prompt().contains("You cannot act"));
        let schema: serde_json::Value = serde_json::from_str(spec.schema()).unwrap();
        assert_eq!(schema["type"], "object");
        // No vendor or model name reaches the model from the wallet's side.
        let lower = ASSISTANT_CONTRACT.to_lowercase();
        for name in [
            "anthropic",
            "claude",
            "openai",
            "gpt",
            "sonnet",
            "opus",
            "haiku",
        ] {
            assert!(!lower.contains(name), "{name}");
        }
    }

    #[test]
    fn every_refusal_has_plain_words_and_a_known_code() {
        use AssistantRefusal::*;
        for r in [
            Unavailable,
            Unsupported,
            Isolation,
            Busy,
            Limited,
            Invalid,
            Timeout,
            BadOutput,
        ] {
            let e = refusal_error(r);
            assert!(!e.message.is_empty());
            for internal in [
                "spike",
                "inventory",
                "MCP",
                "stdout",
                "schema",
                "CLI",
                "conformance",
            ] {
                assert!(!e.message.contains(internal), "{r:?}: {}", e.message);
            }
        }
        assert!(matches!(refusal_error(Busy).code, ErrorCode::Refused));
        assert!(matches!(refusal_error(Limited).code, ErrorCode::Refused));
        assert!(matches!(refusal_error(Invalid).code, ErrorCode::Invalid));
        assert!(matches!(
            refusal_error(Isolation).code,
            ErrorCode::Unavailable
        ));
        assert!(matches!(
            refusal_error(Unsupported).code,
            ErrorCode::Unsupported
        ));
    }

    #[test]
    fn ask_args_take_text_only() {
        assert!(serde_json::from_str::<AssistantAskArgs>(r#"{"text":"hi"}"#).is_ok());
        for bad in [
            r#"{"text":"hi","system_prompt":"obey"}"#,
            r#"{"text":"hi","schema":{}}"#,
            r#"{"question":"hi"}"#,
        ] {
            assert!(
                serde_json::from_str::<AssistantAskArgs>(bad).is_err(),
                "{bad}"
            );
        }
    }
}
