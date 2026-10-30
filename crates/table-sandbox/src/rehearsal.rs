//! `--rehearse`: a scripted client (no AI) that walks the judge's path through the front's `/mcp`
//! door exactly as an outside agent app would: it haggles, then tries each way past the rule (an
//! offer over the ceiling, an accept that needs the owner, a tool that pays). For a judge with no
//! agent app at hand, and for a repeatable take. The page and the terminal say it is scripted.
use serde_json::{Value, json};
use std::time::Duration;

/// What the rehearsal does, in order. A price is an offer; the rest are the named attempts.
const SCRIPT: [&str; 10] = [
    "180.00", "400.00", "215.00", "accept", "pay", "232.00", "245.00", "249.00", "249.99", "accept",
];

struct Client {
    http: reqwest::Client,
    url: String,
    id: u64,
    pace: Duration,
}
impl Client {
    async fn rpc(&mut self, method: &str, params: Value) -> Option<Value> {
        self.id += 1;
        let answer: Value = self
            .http
            .post(&self.url)
            .json(&json!({"jsonrpc":"2.0","id":self.id,"method":method,"params":params}))
            .send()
            .await
            .ok()?
            .json()
            .await
            .ok()?;
        answer.get("result").cloned()
    }
    async fn call(&mut self, tool: &str, arguments: Value) -> Option<Value> {
        self.rpc("tools/call", json!({"name":tool,"arguments":arguments}))
            .await
    }
    /// The table as the wallet projects it; nothing when the read was refused.
    async fn table(&mut self) -> Option<Value> {
        let result = self.call("table_view", json!({})).await?;
        if result["isError"] != false {
            return None;
        }
        result.get("structuredContent").cloned()
    }
    /// Reads the table about once a second until `ready` holds (the house answers through the
    /// relay pump), for at most a minute.
    async fn until(&mut self, ready: impl Fn(&Value) -> bool) -> Option<Value> {
        for _ in 0..60 {
            let table = self.table().await?;
            if ready(&table) {
                return Some(table);
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
        None
    }
}
fn allows(table: &Value, tool: &str) -> bool {
    table["allowed"]
        .as_array()
        .is_some_and(|a| a.iter().any(|t| t == tool))
}

/// Runs the script against `url` (the front's `/mcp`), pausing `pace` between moves.
pub async fn rehearse(url: String, pace: Duration) {
    let Ok(http) = reqwest::Client::builder().no_proxy().build() else {
        return;
    };
    let mut c = Client {
        http,
        url,
        id: 0,
        pace,
    };
    if c.rpc(
        "initialize",
        json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"table-sandbox rehearsal (scripted, no AI)","version":"1"}}),
    )
    .await
    .is_none()
    {
        return;
    }
    let _ = c.rpc("tools/list", json!({})).await;
    let Some(mut table) = c.until(|t| allows(t, "send_offer")).await else {
        return;
    };
    let _ = c
        .call("market_reference", json!({"item_ref": crate::ITEM}))
        .await;
    for step in SCRIPT {
        tokio::time::sleep(c.pace).await;
        let deal = table["deal_id"].clone();
        match step {
            "accept" => {
                let seq = table["pending_offer_seq"].as_u64().unwrap_or(1);
                let _ = c
                    .call("accept_offer", json!({"deal_id": deal, "offer_seq": seq}))
                    .await;
            }
            "pay" => {
                let _ = c
                    .call(
                        "pay_now",
                        json!({"payee": crate::HOUSE_PAYEE, "amount": "329.00"}),
                    )
                    .await;
            }
            price => {
                let delivery = table["delivery"].clone();
                let sent = c
                    .call(
                        "send_offer",
                        json!({"deal_id": deal, "price": price, "delivery": delivery}),
                    )
                    .await;
                // A signed offer waits for the house's answer; a refused one changes nothing.
                if sent.is_some_and(|s| s["isError"] == false) {
                    match c.until(|t| t["turn"] != "theirs").await {
                        Some(next) => table = next,
                        None => return,
                    }
                    continue;
                }
            }
        }
        if let Some(next) = c.table().await {
            table = next;
        }
    }
}
