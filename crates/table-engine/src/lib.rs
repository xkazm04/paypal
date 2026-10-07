//! Engine contract, fenced launch plans, strict stream validation and offline scripted engine.
mod argv;
mod native;
mod parser;
mod policy;
mod resolve;
#[cfg(windows)]
mod windows_job;
pub use argv::*;
use async_trait::async_trait;
pub use native::*;
pub use parser::*;
pub use policy::*;
pub use resolve::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeSet, sync::Mutex};
use table_core::RunId;
use thiserror::Error;
use tokio::sync::mpsc::Sender;
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EngineId {
    #[serde(rename = "claude-code")]
    ClaudeCode,
    #[serde(rename = "codex-cli")]
    CodexCli,
    #[serde(rename = "scripted")]
    Scripted,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub id: EngineId,
    pub available: bool,
    pub version: Option<String>,
    pub reason: Option<String>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    Agent,
    Toolless,
}
#[derive(Debug, Clone)]
pub struct AgentJob {
    pub run: RunId,
    pub prompt: String,
}
pub struct McpGrant {
    pub url: String,
    pub token: String,
    pub secret: String,
}
impl Drop for McpGrant {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.token.zeroize();
        self.secret.zeroize();
    }
}
impl std::fmt::Debug for McpGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpGrant { [REDACTED] }")
    }
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EngineEvent {
    Init { engine: EngineId },
    Text { text: String },
    ToolCall { name: String, arguments: Value },
    Result { verdict: TerminalVerdict },
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TerminalVerdict {
    Clean,
    ErrorReported { subtype: String, text: String },
    MissingTerminalFact,
}
/// The minimal closed schema used by the quarantine. BookQuery is validated separately by the application.
#[derive(Debug, Clone)]
pub enum Schema {
    Shield,
}
impl Schema {
    pub fn validate(&self, value: &Value) -> bool {
        match self {
            Self::Shield => value.as_object().is_some_and(|o| {
                o.len() == 1
                    && o.get("verdict").is_some_and(|v| {
                        serde_json::from_value::<table_core::ShieldVerdict>(v.clone()).is_ok()
                    })
            }),
        }
    }
}
#[derive(Debug, Error)]
pub enum Error {
    #[error("engine output invalid or exceeds bounds")]
    Invalid,
    #[error("engine exposed forbidden tools or lacked inventory evidence")]
    Isolation,
    #[error("engine event receiver closed")]
    Closed,
    #[error("engine run cancelled")]
    Cancelled,
    #[error("engine process unavailable")]
    Process,
    #[error("engine watchdog expired")]
    Timeout,
    #[error("engine platform unsupported")]
    Unsupported,
}
#[async_trait]
pub trait EngineAdapter: Send + Sync {
    fn id(&self) -> EngineId;
    async fn probe(&self) -> Result<EngineInfo, Error>;
    async fn run(
        &self,
        job: AgentJob,
        mcp: McpGrant,
        tx: Sender<EngineEvent>,
    ) -> Result<TerminalVerdict, Error>;
    async fn structured(&self, input: &str, schema: &Schema) -> Result<Value, Error>;
    fn cancel(&self, run: RunId);
}
#[derive(Debug)]
pub struct Scripted {
    events: Vec<EngineEvent>,
    output: Value,
    cancelled: Mutex<BTreeSet<RunId>>,
}
impl Scripted {
    pub fn new(events: Vec<EngineEvent>, output: Value) -> Result<Self, Error> {
        for e in &events {
            if let EngineEvent::ToolCall { name, .. } = e
                && !wallet_tool(name)
            {
                return Err(Error::Isolation);
            }
        }
        Ok(Self {
            events,
            output,
            cancelled: Mutex::new(BTreeSet::new()),
        })
    }
}
#[async_trait]
impl EngineAdapter for Scripted {
    fn id(&self) -> EngineId {
        EngineId::Scripted
    }
    async fn probe(&self) -> Result<EngineInfo, Error> {
        Ok(EngineInfo {
            id: self.id(),
            available: true,
            version: Some("1".into()),
            reason: None,
        })
    }
    async fn run(
        &self,
        job: AgentJob,
        _mcp: McpGrant,
        tx: Sender<EngineEvent>,
    ) -> Result<TerminalVerdict, Error> {
        tx.send(EngineEvent::Init { engine: self.id() })
            .await
            .map_err(|_| Error::Closed)?;
        let mut verdict = TerminalVerdict::MissingTerminalFact;
        for event in &self.events {
            if self
                .cancelled
                .lock()
                .map_err(|_| Error::Cancelled)?
                .contains(&job.run)
            {
                return Err(Error::Cancelled);
            }
            if let EngineEvent::Result { verdict: v } = event {
                verdict = v.clone();
            }
            tx.send(event.clone()).await.map_err(|_| Error::Closed)?;
        }
        Ok(verdict)
    }
    async fn structured(&self, _input: &str, schema: &Schema) -> Result<Value, Error> {
        if schema.validate(&self.output) {
            Ok(self.output.clone())
        } else {
            Err(Error::Invalid)
        }
    }
    fn cancel(&self, run: RunId) {
        if let Ok(mut runs) = self.cancelled.lock() {
            runs.insert(run);
        }
    }
}
