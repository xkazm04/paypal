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
    "product_search",
];
pub fn wallet_tool(name: &str) -> bool {
    name.strip_prefix("mcp__wallet__")
        .is_some_and(|n| TOOLS.contains(&n))
}
/// The one tool an assistant turn may list and call: the CLI's own carrier for `--json-schema`
/// output (measured on claude-code 2.1.316: the init lists exactly it, and the model answers
/// with one `tool_use` of it). It reaches nothing outside the process: its input is the reply.
pub const STRUCTURED_OUTPUT_TOOL: &str = "StructuredOutput";
#[derive(Debug)]
pub struct StreamParser {
    engine: EngineId,
    profile: Profile,
    initialized: bool,
    terminal: Option<TerminalVerdict>,
    failed: bool,
    /// An assistant turn's `structured_output`, from its clean terminal result.
    structured: Option<Value>,
}
impl StreamParser {
    pub fn new(engine: EngineId, profile: Profile) -> Self {
        Self {
            engine,
            profile,
            initialized: false,
            terminal: None,
            failed: false,
            structured: None,
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
                t.as_str().is_none_or(|n| match self.profile {
                    Profile::Agent => !wallet_tool(n),
                    Profile::Toolless => true,
                    Profile::Assistant => n != STRUCTURED_OUTPUT_TOOL,
                })
            }) || (self.profile == Profile::Agent && (tools.is_empty() || servers.len() != 1))
                || servers.iter().any(|s| {
                    self.profile != Profile::Agent
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
                if self.profile == Profile::Assistant && verdict == TerminalVerdict::Clean {
                    self.structured = v.get("structured_output").cloned();
                }
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
                        Some("tool_use") if self.profile == Profile::Assistant => {
                            // The reply itself; it is read from the terminal result.
                            if c.get("name").and_then(Value::as_str) != Some(STRUCTURED_OUTPUT_TOOL)
                            {
                                return Err(Error::Isolation);
                            }
                        }
                        Some("thinking" | "redacted_thinking")
                            if self.profile == Profile::Assistant => {}
                        Some("tool_use") => {
                            let name = c
                                .get("name")
                                .and_then(Value::as_str)
                                .ok_or(Error::Invalid)?;
                            if self.profile != Profile::Agent || !wallet_tool(name) {
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
            // claude-code reports a retried API call (rate limit, overload) as its own system
            // event (research 2.1). It names no tool and carries no text; every other system
            // subtype after init stays unknown and fails closed.
            "system"
                if self.engine == EngineId::ClaudeCode
                    && v.get("subtype").and_then(Value::as_str) == Some("api_retry") =>
            {
                Ok(Vec::new())
            }
            // An assistant turn: the CLI acknowledges its own structured-output call as a user
            // message of tool results only, and reports its rate-limit window. Neither carries a
            // tool, text or authority; any other content fails closed.
            "user" if self.profile == Profile::Assistant => {
                let content = v
                    .pointer("/message/content")
                    .and_then(Value::as_array)
                    .ok_or(Error::Invalid)?;
                if content
                    .iter()
                    .all(|c| c.get("type").and_then(Value::as_str) == Some("tool_result"))
                {
                    Ok(Vec::new())
                } else {
                    Err(Error::Invalid)
                }
            }
            "rate_limit_event" if self.profile == Profile::Assistant => Ok(Vec::new()),
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
                        if self.profile != Profile::Agent || !wallet_tool(&name) {
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
    /// An assistant turn's reply: the `structured_output` of a clean terminal result, and only
    /// when every line of the stream was accepted.
    pub fn structured_output(&self) -> Option<&Value> {
        if self.failed || self.terminal != Some(TerminalVerdict::Clean) {
            return None;
        }
        self.structured.as_ref()
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
