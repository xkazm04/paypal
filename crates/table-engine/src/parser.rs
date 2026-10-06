use crate::*;
use serde_json::Value;
/// Every tool the wallet MCP server serves to some role, and nothing it does not serve.
pub const TOOLS: &[&str] = &[
    "table_view",
    "market_reference",
    "send_offer",
    "accept_offer",
    "withdraw_offer",
    "propose_purchase",
    "book_query",
];
pub fn wallet_tool(name: &str) -> bool {
    name.strip_prefix("mcp__wallet__")
        .is_some_and(|n| TOOLS.contains(&n))
}
#[derive(Debug)]
pub struct StreamParser {
    engine: EngineId,
    profile: Profile,
    initialized: bool,
    terminal: Option<TerminalVerdict>,
    failed: bool,
}
impl StreamParser {
    pub fn new(engine: EngineId, profile: Profile) -> Self {
        Self {
            engine,
            profile,
            initialized: false,
            terminal: None,
            failed: false,
        }
    }
    pub fn line(&mut self, line: &str) -> Result<Vec<EngineEvent>, Error> {
        let result = self.parse(line);
        if result.is_err() {
            self.failed = true;
        }
        result
    }
    fn parse(&mut self, line: &str) -> Result<Vec<EngineEvent>, Error> {
        if self.failed || line.len() > 65536 {
            return Err(Error::Invalid);
        }
        let v: Value = serde_json::from_str(line).map_err(|_| Error::Invalid)?;
        let typ = v
            .get("type")
            .and_then(Value::as_str)
            .ok_or(Error::Invalid)?;
        if typ == "system" && v.get("subtype").and_then(Value::as_str) == Some("init") {
            if self.initialized {
                return Err(Error::Isolation);
            }
            let tools = v
                .get("tools")
                .and_then(Value::as_array)
                .ok_or(Error::Isolation)?;
            let servers = v
                .get("mcp_servers")
                .and_then(Value::as_array)
                .ok_or(Error::Isolation)?;
            if tools.iter().any(|t| {
                t.as_str()
                    .is_none_or(|n| self.profile == Profile::Toolless || !wallet_tool(n))
            }) || (self.profile == Profile::Agent && (tools.is_empty() || servers.len() != 1))
                || servers.iter().any(|s| {
                    self.profile == Profile::Toolless
                        || s.get("name").and_then(Value::as_str) != Some("wallet")
                        || s.get("status").and_then(Value::as_str) != Some("connected")
                })
                || v.get("mcp_server_errors")
                    .is_some_and(|e| e.as_array().is_none_or(|a| !a.is_empty()))
            {
                return Err(Error::Isolation);
            }
            self.initialized = true;
            return Ok(vec![EngineEvent::Init {
                engine: self.engine,
            }]);
        }
        // thread.started alone is NOT a tool inventory. Without an attested inventory, reject.
        if !self.initialized {
            return Err(Error::Isolation);
        }
        if self.terminal.is_some() {
            return Err(Error::Invalid);
        }
        match typ {
            "result" => {
                let subtype = v
                    .get("subtype")
                    .and_then(Value::as_str)
                    .ok_or(Error::Invalid)?;
                let is_error = v
                    .get("is_error")
                    .and_then(Value::as_bool)
                    .ok_or(Error::Invalid)?;
                let verdict = if is_error || subtype != "success" {
                    TerminalVerdict::ErrorReported {
                        subtype: subtype.into(),
                        text: v.get("result").and_then(Value::as_str).unwrap_or("").into(),
                    }
                } else {
                    TerminalVerdict::Clean
                };
                self.terminal = Some(verdict.clone());
                Ok(vec![EngineEvent::Result { verdict }])
            }
            "assistant" => {
                let content = v
                    .pointer("/message/content")
                    .and_then(Value::as_array)
                    .ok_or(Error::Invalid)?;
                let mut events = Vec::new();
                for c in content {
                    match c.get("type").and_then(Value::as_str) {
                        Some("text") => events.push(EngineEvent::Text {
                            text: c
                                .get("text")
                                .and_then(Value::as_str)
                                .ok_or(Error::Invalid)?
                                .into(),
                        }),
                        Some("tool_use") => {
                            let name = c
                                .get("name")
                                .and_then(Value::as_str)
                                .ok_or(Error::Invalid)?;
                            if self.profile == Profile::Toolless || !wallet_tool(name) {
                                return Err(Error::Isolation);
                            }
                            events.push(EngineEvent::ToolCall {
                                name: name.into(),
                                arguments: c.get("input").cloned().ok_or(Error::Invalid)?,
                            });
                        }
                        _ => return Err(Error::Invalid),
                    }
                }
                Ok(events)
            }
            "thread.started" => Ok(Vec::new()),
            "item.started" | "item.completed" => {
                let kind = v
                    .pointer("/item/type")
                    .and_then(Value::as_str)
                    .ok_or(Error::Invalid)?;
                // Codex reports each item twice. Both are checked; each yields one event:
                // a message once it is complete, a tool call when it starts.
                let started = typ == "item.started";
                match kind {
                    "agent_message" if started => Ok(Vec::new()),
                    "agent_message" => Ok(vec![EngineEvent::Text {
                        text: v
                            .pointer("/item/text")
                            .and_then(Value::as_str)
                            .ok_or(Error::Invalid)?
                            .into(),
                    }]),
                    "mcp_tool_call" => {
                        let server = v
                            .pointer("/item/server")
                            .and_then(Value::as_str)
                            .ok_or(Error::Invalid)?;
                        let tool = v
                            .pointer("/item/tool")
                            .and_then(Value::as_str)
                            .ok_or(Error::Invalid)?;
                        let name = format!("mcp__{server}__{tool}");
                        if self.profile == Profile::Toolless || !wallet_tool(&name) {
                            return Err(Error::Isolation);
                        }
                        if !started {
                            return Ok(Vec::new());
                        }
                        Ok(vec![EngineEvent::ToolCall {
                            name,
                            arguments: v.pointer("/item/arguments").cloned().unwrap_or(Value::Null),
                        }])
                    }
                    "reasoning" => Ok(Vec::new()),
                    _ => Err(Error::Isolation),
                }
            }
            "turn.completed" => {
                self.terminal = Some(TerminalVerdict::Clean);
                Ok(vec![EngineEvent::Result {
                    verdict: TerminalVerdict::Clean,
                }])
            }
            "turn.failed" | "error" => {
                let verdict = TerminalVerdict::ErrorReported {
                    subtype: typ.into(),
                    text: v
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .into(),
                };
                self.terminal = Some(verdict.clone());
                Ok(vec![EngineEvent::Result { verdict }])
            }
            "turn.started" => Ok(Vec::new()),
            _ => Err(Error::Invalid),
        }
    }
    pub fn finish(&self) -> TerminalVerdict {
        if self.failed {
            TerminalVerdict::ErrorReported {
                subtype: "isolation_or_stream_failure".into(),
                text: "Engine stream rejected".into(),
            }
        } else {
            self.terminal
                .clone()
                .unwrap_or(TerminalVerdict::MissingTerminalFact)
        }
    }
}
