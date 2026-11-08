//! The board assistant's door (conversational home, `assistant_ask`): one bounded, tool-less
//! turn of a native engine over text the main window built from its board digest. The reply is
//! returned as raw JSON text and is UNTRUSTED: the client validates it (`validateReply`), and a
//! proposal it carries only ever opens the approval window. Nothing here can move money: the
//! child has no tools, no wallet grant and no MCP server, and the door holds no wallet handle.
//!
//! Limits: input size, one turn in flight, a per-minute count, a whole-turn deadline, an output
//! cap and the CLI's own per-call budget (`ASSISTANT_BUDGET_USD`). Isolation: before the first
//! real question of a session, a canned conformance turn must show the inventory the assistant
//! profile allows (`StreamParser`, `Profile::Assistant`); every later turn checks it again, and
//! one failure closes the door until the app restarts.
use crate::{Error, NativeEngine, RunLimits};
use async_trait::async_trait;
use serde_json::Value;
use std::{collections::VecDeque, sync::Arc, sync::Mutex, time::Duration};
use tokio::time::Instant;

/// The largest prompt text (question plus board digest) one turn accepts, in bytes.
pub const ASSISTANT_INPUT_MAX: usize = 128 * 1024;
/// The most a turn's stdout may carry in all, in bytes (the dev bridge's cap).
pub const ASSISTANT_OUTPUT_MAX: usize = 64 * 1024;
/// The largest system prompt the door accepts.
pub const ASSISTANT_PROMPT_MAX: usize = 16 * 1024;
/// Questions admitted per rolling minute (refused-as-invalid ones are not counted; failed ones are).
pub const ASSISTANT_PER_MINUTE: usize = 6;
/// The inventory must arrive within `init`; the whole turn within `total` (the dev bridge's 60 s).
pub const ASSISTANT_LIMITS: RunLimits = RunLimits {
    init: Duration::from_secs(15),
    total: Duration::from_secs(60),
};
/// The input of the conformance turn: no owner data at all.
pub const ASSISTANT_CONFORMANCE_INPUT: &str = "This is the wallet's own start-up check, not a \
question from Maya. Reply with an empty say and no ops.\n\n<board>\n{}\n</board>\n";

/// The pinned system prompt and reply schema (the shell embeds them; the client's test binds
/// them to `lib/assistant/prompt.ts` and `vocabulary.ts`).
#[derive(Debug, Clone)]
pub struct AssistantSpec {
    system_prompt: String,
    schema: String,
}
impl AssistantSpec {
    pub fn new(system_prompt: &str, schema: &Value) -> Result<Self, Error> {
        let schema = schema
            .is_object()
            .then(|| schema.to_string())
            .ok_or(Error::Invalid)?;
        if system_prompt.trim().is_empty()
            || system_prompt.len() > ASSISTANT_PROMPT_MAX
            || schema.len() > crate::ASSISTANT_SCHEMA_MAX
        {
            return Err(Error::Invalid);
        }
        Ok(Self {
            system_prompt: system_prompt.into(),
            schema,
        })
    }
    pub fn system_prompt(&self) -> &str {
        &self.system_prompt
    }
    pub fn schema(&self) -> &str {
        &self.schema
    }
}

/// One assistant turn. `NativeEngine` is the real one; tests substitute a fake.
#[async_trait]
pub trait AssistantTurn: Send + Sync + std::fmt::Debug {
    async fn turn(&self, input: &str, spec: &AssistantSpec) -> Result<Value, Error>;
}
#[async_trait]
impl AssistantTurn for NativeEngine {
    async fn turn(&self, input: &str, spec: &AssistantSpec) -> Result<Value, Error> {
        self.assistant_turn(input, spec).await
    }
}

/// Why a question was not answered. The shell maps each to a plain-words `CommandError`; the
/// client falls back to its scripted engine on every one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssistantRefusal {
    /// No engine found, or it could not be started or ended badly.
    Unavailable,
    /// This platform cannot contain the child.
    Unsupported,
    /// The conformance check failed (now or earlier this session): the door stays shut.
    Isolation,
    /// Another question is in flight.
    Busy,
    /// Too many questions this minute.
    Limited,
    /// The question text is empty or too large.
    Invalid,
    /// The turn passed its deadline; its process tree was killed.
    Timeout,
    /// The engine answered outside the stream contract or without a reply.
    BadOutput,
}
impl AssistantRefusal {
    fn from_engine(error: &Error) -> Self {
        match error {
            Error::Isolation => Self::Isolation,
            Error::Timeout => Self::Timeout,
            Error::Invalid => Self::BadOutput,
            Error::Unsupported => Self::Unsupported,
            Error::Closed
            | Error::Cancelled
            | Error::Process
            | Error::Spawn
            | Error::Attach
            | Error::Pipe
            | Error::Exit { .. } => Self::Unavailable,
        }
    }
}

/// What `assistant_status` reports: whether a question would be tried at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AssistantStatus {
    pub available: bool,
    pub refusal: Option<AssistantRefusal>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Conformance {
    Unknown,
    Passed,
    Failed,
}
#[derive(Debug)]
struct DoorState {
    busy: bool,
    recent: VecDeque<Instant>,
    conformance: Conformance,
}

#[derive(Debug)]
pub struct AssistantDoor {
    engine: Option<Arc<dyn AssistantTurn>>,
    spec: AssistantSpec,
    state: Mutex<DoorState>,
}
/// Releases the in-flight slot however the turn ends (an error, a panic, a dropped future).
struct Slot<'a>(&'a Mutex<DoorState>);
impl Drop for Slot<'_> {
    fn drop(&mut self) {
        if let Ok(mut s) = self.0.lock() {
            s.busy = false;
        }
    }
}
impl AssistantDoor {
    /// `engine` is `None` when no assistant-capable engine is installed.
    pub fn new(engine: Option<Arc<dyn AssistantTurn>>, spec: AssistantSpec) -> Self {
        Self {
            engine,
            spec,
            state: Mutex::new(DoorState {
                busy: false,
                recent: VecDeque::new(),
                conformance: Conformance::Unknown,
            }),
        }
    }
    pub fn status(&self) -> AssistantStatus {
        let refusal = if self.engine.is_none() {
            Some(AssistantRefusal::Unavailable)
        } else if cfg!(not(windows)) {
            Some(AssistantRefusal::Unsupported)
        } else {
            match self.state.lock() {
                Ok(s) if s.conformance == Conformance::Failed => Some(AssistantRefusal::Isolation),
                Ok(_) => None,
                Err(_) => Some(AssistantRefusal::Unavailable),
            }
        };
        AssistantStatus {
            available: refusal.is_none(),
            refusal,
        }
    }
    /// One question: `input` is the question and the board digest as the client built them.
    /// Returns the reply as compact JSON text (an object), never validated here.
    pub async fn ask(&self, input: &str) -> Result<String, AssistantRefusal> {
        if input.trim().is_empty() || input.len() > ASSISTANT_INPUT_MAX {
            return Err(AssistantRefusal::Invalid);
        }
        let engine = self.engine.as_ref().ok_or(AssistantRefusal::Unavailable)?;
        let conformance = {
            let mut s = self
                .state
                .lock()
                .map_err(|_| AssistantRefusal::Unavailable)?;
            if s.conformance == Conformance::Failed {
                return Err(AssistantRefusal::Isolation);
            }
            if s.busy {
                return Err(AssistantRefusal::Busy);
            }
            let now = Instant::now();
            while s
                .recent
                .front()
                .is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(60))
            {
                s.recent.pop_front();
            }
            if s.recent.len() >= ASSISTANT_PER_MINUTE {
                return Err(AssistantRefusal::Limited);
            }
            s.recent.push_back(now);
            s.busy = true;
            s.conformance
        };
        let _slot = Slot(&self.state);
        if conformance == Conformance::Unknown {
            // No owner data goes to an engine whose inventory this session has not seen.
            match engine.turn(ASSISTANT_CONFORMANCE_INPUT, &self.spec).await {
                Ok(_) => self.set(Conformance::Passed),
                Err(error) => {
                    if matches!(error, Error::Isolation) {
                        self.set(Conformance::Failed);
                    }
                    return Err(AssistantRefusal::from_engine(&error));
                }
            }
        }
        let value = engine.turn(input, &self.spec).await.map_err(|error| {
            if matches!(error, Error::Isolation) {
                self.set(Conformance::Failed);
            }
            AssistantRefusal::from_engine(&error)
        })?;
        let text = value
            .is_object()
            .then(|| value.to_string())
            .ok_or(AssistantRefusal::BadOutput)?;
        if text.len() > ASSISTANT_OUTPUT_MAX {
            return Err(AssistantRefusal::BadOutput);
        }
        Ok(text)
    }
    fn set(&self, conformance: Conformance) {
        if let Ok(mut s) = self.state.lock()
            && s.conformance != Conformance::Failed
        {
            s.conformance = conformance;
        }
    }
}
