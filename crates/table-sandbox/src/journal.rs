//! What the outside agent asked and what answered it, one entry per MCP request. The entries are
//! read off the wallet's own answers (the closed refusal code, its clause and the signed rule's
//! words); nothing here decides anything. Agent-supplied arguments are kept as data and only ever
//! rendered as text.
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;

/// The most entries kept; the oldest go first.
const KEEP: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    /// The wallet answered the call.
    Answered,
    /// The wallet (or its MCP door) refused it with a closed code.
    Refused,
    /// A protocol step (initialize, tools/list, a notification): no tool ran.
    Protocol,
    /// The request never reached a tool: a bad request, an HTTP refusal or a fault.
    Error,
}
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub seq: u64,
    /// Unix milliseconds when the request arrived.
    pub at: u64,
    pub method: String,
    pub tool: Option<String>,
    /// The agent's own arguments, as sent.
    pub args: Option<Value>,
    pub outcome: Outcome,
    /// The closed refusal code, when refused.
    pub code: Option<String>,
    /// The signed rule's number, when one answered.
    pub clause: Option<u8>,
    /// Which rule answered, in plain words.
    pub rule: String,
    /// The signed rule's own words for a refusal (for example the bound a price crossed).
    pub detail: Option<String>,
    /// The wallet's fixed sentence to the agent.
    pub told: Option<String>,
    /// Requests the buyer wallet's PayPal client had tried to send, after this call.
    pub paypal: u64,
    pub ms: u64,
    /// Which table (world) the call went to.
    pub table: u32,
}
impl Entry {
    /// A line the sandbox itself writes (a fresh table opening), not an agent's call.
    pub fn marker(table: u32, at: u64, rule: String, paypal: u64) -> Self {
        Self {
            seq: 0,
            at,
            method: "sandbox/table".into(),
            tool: None,
            args: None,
            outcome: Outcome::Protocol,
            code: None,
            clause: None,
            rule,
            detail: None,
            told: None,
            paypal,
            ms: 0,
            table,
        }
    }
}

#[derive(Debug, Default)]
pub struct Journal {
    entries: Mutex<Vec<Entry>>,
    /// The latest table the agent read (`table_view`'s answer), as the wallet projected it.
    table: Mutex<Option<Value>>,
}
impl Journal {
    pub fn push(&self, mut entry: Entry) -> Entry {
        if let Ok(mut entries) = self.entries.lock() {
            entry.seq = entries.last().map_or(1, |last| last.seq.saturating_add(1));
            entries.push(entry.clone());
            if entries.len() > KEEP {
                let extra = entries.len() - KEEP;
                entries.drain(..extra);
            }
        }
        entry
    }
    pub fn after(&self, seq: u64) -> Vec<Entry> {
        self.entries
            .lock()
            .map(|entries| entries.iter().filter(|e| e.seq > seq).cloned().collect())
            .unwrap_or_default()
    }
    pub fn all(&self) -> Vec<Entry> {
        self.after(0)
    }
    pub fn set_table(&self, table: Option<Value>) {
        if let Ok(mut held) = self.table.lock() {
            *held = table;
        }
    }
    pub fn table(&self) -> Option<Value> {
        self.table.lock().ok().and_then(|t| t.clone())
    }
}

/// What held, in the sandbox's own signed numbers: the rule's statement for a refusal code.
fn held(code: &str, clause: Option<u8>) -> String {
    use crate::front::dollars;
    match (code, clause) {
        ("outside_band", _) => format!("never offer over {}", dollars(crate::RULE_CEILING)),
        ("rounds_exhausted", _) => format!("at most {} offers", crate::RULE_ROUNDS),
        ("owner_approval", _) => format!(
            "agreeing over {} needs you in person",
            dollars(crate::RULE_IN_PERSON)
        ),
        ("deadline_passed", _) => "nothing is signed after the table's deadline".into(),
        ("mandate_clause", Some(1)) => "your agent may only buy".into(),
        ("mandate_clause", Some(2)) => "only the paired house seller".into(),
        ("mandate_clause", Some(3)) => {
            format!("at most {} on any one deal", dollars(crate::RULE_PER_DEAL))
        }
        ("mandate_clause", Some(5)) => "only so much a day".into(),
        ("mandate_clause", Some(7)) => "only the house seller may be paid".into(),
        ("mandate_clause", _) => "a rule you signed does not allow it".into(),
        ("wallet_limit", _) => "your wallet-wide limit".into(),
        ("not_your_turn", _) => "one offer at a time: wait for the house seller".into(),
        ("table_closed", _) => "this table is closed".into(),
        ("tool_absent", _) => "no such tool, and none of its tools can pay".into(),
        ("malformed_call", _) => "the call does not match the tool".into(),
        ("out_of_scope", _) => "only this table, this item".into(),
        ("market_unavailable", _) => "no market price is cached in the sandbox".into(),
        ("invalid_request", _) => "the wallet could not use the request".into(),
        ("session_not_enabled", _) => "the session is not enabled yet".into(),
        ("run_ended", _) => "the agent's turn ended".into(),
        ("paused", _) => "every agent is paused".into(),
        ("group_closed", _) => "another table already agreed".into(),
        ("shield_hold", _) => "the scam check holds the deal".into(),
        _ => "the wallet could not answer".into(),
    }
}

/// What answered a call that went through, by tool.
fn answered_words(tool: &str) -> &'static str {
    match tool {
        "table_view" => "read only: the table as the wallet sees it",
        "market_reference" => "read only: cached market prices",
        "send_offer" => "inside rule 4, your signed band: the wallet signed and sent it",
        "accept_offer" => "inside your rules: the wallet signed the accept, no money moved",
        "withdraw_offer" => "the wallet signed the walk-away",
        _ => "answered",
    }
}

/// Reads one JSON-RPC exchange into an entry (without its sequence number, time or counter).
pub fn read(request: Option<&Value>, status: u16, answer: Option<&Value>) -> Entry {
    let method = request
        .and_then(|r| r.get("method"))
        .and_then(Value::as_str)
        .unwrap_or("?")
        .to_owned();
    let params = request.and_then(|r| r.get("params"));
    let tool = (method == "tools/call")
        .then(|| params.and_then(|p| p.get("name")).and_then(Value::as_str))
        .flatten()
        .map(str::to_owned);
    let args = tool
        .as_ref()
        .and_then(|_| params.and_then(|p| p.get("arguments")).cloned());
    let mut entry = Entry {
        seq: 0,
        at: 0,
        method: method.clone(),
        tool: tool.clone(),
        args,
        outcome: Outcome::Protocol,
        code: None,
        clause: None,
        rule: String::new(),
        detail: None,
        told: None,
        paypal: 0,
        ms: 0,
        table: 0,
    };
    if !(200..300).contains(&status) {
        entry.outcome = Outcome::Error;
        entry.rule = match status {
            401 => "the wallet's MCP door: no valid session".into(),
            403 => "the door: loopback only, no browser pages".into(),
            _ => format!("the request was turned away (HTTP {status})"),
        };
        return entry;
    }
    let result = answer.and_then(|a| a.get("result"));
    if let Some(error) = answer.and_then(|a| a.get("error")) {
        entry.outcome = Outcome::Error;
        entry.rule = error
            .get("message")
            .and_then(Value::as_str)
            .map_or_else(|| "protocol error".into(), |m| format!("protocol: {m}"));
        return entry;
    }
    match method.as_str() {
        "initialize" => entry.rule = "connected to the wallet's MCP server".into(),
        "tools/list" => {
            let names: Vec<&str> = result
                .and_then(|r| r.get("tools"))
                .and_then(Value::as_array)
                .map(|tools| {
                    tools
                        .iter()
                        .filter_map(|t| t.get("name").and_then(Value::as_str))
                        .collect()
                })
                .unwrap_or_default();
            entry.rule = format!(
                "the negotiator's {} tools, none moves money: {}",
                names.len(),
                names.join(", ")
            );
        }
        "tools/call" => {
            let refused = result
                .and_then(|r| r.get("isError"))
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let wire = result.and_then(|r| r.get("structuredContent")).or(None);
            if refused {
                entry.outcome = Outcome::Refused;
                let wire = wire.cloned().or_else(|| {
                    result
                        .and_then(|r| r.pointer("/content/0/text"))
                        .and_then(Value::as_str)
                        .and_then(|t| serde_json::from_str(t).ok())
                });
                let code = wire
                    .as_ref()
                    .and_then(|w| w.get("code"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let clause = wire
                    .as_ref()
                    .and_then(|w| w.get("clause"))
                    .and_then(Value::as_u64)
                    .and_then(|c| u8::try_from(c).ok());
                entry.detail = wire
                    .as_ref()
                    .and_then(|w| w.get("detail"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                entry.told = wire
                    .as_ref()
                    .and_then(|w| w.get("text"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let budget = entry
                    .detail
                    .as_deref()
                    .is_some_and(|d| d.contains("tool-call budget"));
                let statement = held(code.as_deref().unwrap_or(""), clause);
                entry.rule = match (clause, code.as_deref()) {
                    (None, _) if budget => format!(
                        "The door held: {} calls a turn, a looping agent is cut off",
                        table_mcp::CALL_BUDGET
                    ),
                    (Some(clause), _) if clause > 0 => format!("Rule {clause} held: {statement}"),
                    (_, Some("tool_absent" | "malformed_call")) => {
                        format!("The door held: {statement}")
                    }
                    _ => format!("The wallet held: {statement}"),
                };
                entry.code = code;
                entry.clause = clause;
            } else {
                entry.outcome = Outcome::Answered;
                entry.rule = answered_words(tool.as_deref().unwrap_or("")).into();
            }
        }
        _ => entry.rule = "protocol".into(),
    }
    entry
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde_json::json;

    #[test]
    fn a_band_refusal_names_rule_four_and_the_signed_bound() {
        let request = json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"send_offer","arguments":{"price":"300.00"}}});
        let wire = json!({"code":"outside_band","clause":4,"text":"The price is outside the signed price range.","detail":"at most 250.00"});
        let answer = json!({"jsonrpc":"2.0","id":3,"result":{"isError":true,"content":[{"type":"text","text":wire.to_string()}],"structuredContent":wire}});
        let entry = read(Some(&request), 200, Some(&answer));
        assert_eq!(entry.outcome, Outcome::Refused);
        assert_eq!(entry.code.as_deref(), Some("outside_band"));
        assert_eq!(entry.clause, Some(4));
        assert_eq!(entry.rule, "Rule 4 held: never offer over $340.00");
        assert_eq!(entry.detail.as_deref(), Some("at most 250.00"));
        assert_eq!(entry.tool.as_deref(), Some("send_offer"));
    }

    #[test]
    fn a_refusal_read_from_text_alone_still_names_its_code() {
        let request = json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"pay_now","arguments":{}}});
        let wire = json!({"code":"tool_absent","clause":null,"text":"No such tool."});
        let answer = json!({"jsonrpc":"2.0","id":4,"result":{"isError":true,"content":[{"type":"text","text":wire.to_string()}]}});
        let entry = read(Some(&request), 200, Some(&answer));
        assert_eq!(entry.code.as_deref(), Some("tool_absent"));
        assert!(entry.rule.starts_with("The door held"));
    }

    #[test]
    fn the_journal_keeps_order_and_reads_after_a_sequence() {
        let journal = Journal::default();
        for _ in 0..3 {
            journal.push(read(None, 200, None));
        }
        assert_eq!(
            journal.after(1).iter().map(|e| e.seq).collect::<Vec<_>>(),
            [2, 3]
        );
    }
}
