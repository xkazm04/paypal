//! The sandbox end to end over loopback HTTP, as an outside agent app would drive it: connect,
//! list the tools, read the table, be refused at the signed limit, haggle inside it, be refused
//! when agreeing needs the owner, reach for a money tool that does not exist. PayPal is asked
//! nothing throughout. No network: every socket is 127.0.0.1, PayPal is a recorder.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

struct Harness {
    url: String,
    http: reqwest::Client,
    app: Arc<table_sandbox::front::App>,
    _sandbox: table_sandbox::Sandbox,
}
impl Harness {
    async fn boot() -> Self {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let sandbox = table_sandbox::boot(port).await.unwrap();
        let app = sandbox.app.clone();
        tokio::spawn(axum::serve(listener, app.clone().router()).into_future());
        Self {
            url: format!("http://127.0.0.1:{port}"),
            http: reqwest::Client::builder().no_proxy().build().unwrap(),
            app,
            _sandbox: sandbox,
        }
    }
    async fn rpc(&self, id: u64, method: &str, params: Value) -> Value {
        self.http
            .post(format!("{}/mcp", self.url))
            .json(&json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }
    async fn call(&self, id: u64, tool: &str, arguments: Value) -> Value {
        self.rpc(id, "tools/call", json!({"name":tool,"arguments":arguments}))
            .await["result"]
            .clone()
    }
    async fn table(&self) -> Value {
        self.call(0, "table_view", json!({})).await["structuredContent"].clone()
    }
    /// Reads the table until `ready` holds (the house answers through the relay pump).
    async fn table_until(&self, ready: impl Fn(&Value) -> bool) -> Value {
        tokio::time::timeout(Duration::from_secs(60), async {
            loop {
                let table = self.table().await;
                if ready(&table) {
                    return table;
                }
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
        })
        .await
        .expect("the house answered in time")
    }
}
fn refusal(result: &Value) -> (&str, Option<u64>) {
    assert_eq!(result["isError"], true, "{result}");
    let wire = &result["structuredContent"];
    (wire["code"].as_str().unwrap(), wire["clause"].as_u64())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_outside_agent_is_told_no_at_the_signed_limit_and_paypal_is_never_asked() {
    let h = Harness::boot().await;
    let init = h
        .rpc(1, "initialize", json!({"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}))
        .await;
    assert_eq!(init["result"]["serverInfo"]["name"], "table-wallet");
    // The negotiator's compiled-in playbook rides along as the server's instructions.
    assert!(
        init["result"]["instructions"]
            .as_str()
            .unwrap()
            .starts_with("# Role: buyer haggler")
    );

    // The negotiator's catalog: five tools, none of them pays.
    let tools = h.rpc(2, "tools/list", json!({})).await;
    let names: Vec<&str> = tools["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        [
            "table_view",
            "market_reference",
            "send_offer",
            "accept_offer",
            "withdraw_offer"
        ]
    );

    // The house's listing arrives through the wallet's own relay pump.
    let table = h
        .table_until(|t| {
            t["allowed"]
                .as_array()
                .unwrap()
                .contains(&json!("send_offer"))
        })
        .await;
    let deal = table["deal_id"].as_str().unwrap().to_owned();
    assert_eq!(table["price"]["minor"], table_sandbox::HOUSE_ASK);
    assert_eq!(
        table["band"]["ceiling"]["minor"],
        table_sandbox::RULE_CEILING
    );

    // Over the signed ceiling: refused by rule 4, which names its bound.
    let over = h
        .call(
            3,
            "send_offer",
            json!({"deal_id":deal,"price":"400.00","delivery":{"type":"digital_now"}}),
        )
        .await;
    assert_eq!(refusal(&over), ("outside_band", Some(4)));
    assert!(
        over["structuredContent"]["detail"]
            .as_str()
            .unwrap()
            .contains("340.00")
    );
    // Inside the band: signed and sent; the house counters.
    let offer = h
        .call(
            5,
            "send_offer",
            json!({"deal_id":deal,"price":"150.00","delivery":{"type":"digital_now"}}),
        )
        .await;
    assert_eq!(offer["isError"], false, "{offer}");
    let table = h.table_until(|t| !t["pending_offer_seq"].is_null()).await;
    let seq = table["pending_offer_seq"].as_u64().unwrap();
    let counter = table["their_last_price"]["minor"].as_i64().unwrap();
    assert!(counter > table_sandbox::RULE_IN_PERSON && counter <= table_sandbox::HOUSE_ASK);

    // Agreeing over the in-person line: only the owner can, and the owner is not here.
    let accept = h
        .call(6, "accept_offer", json!({"deal_id":deal,"offer_seq":seq}))
        .await;
    assert_eq!(refusal(&accept), ("owner_approval", Some(6)));

    // A money tool does not exist for an agent at all.
    let pay = h.call(7, "pay_now", json!({"amount":"329.00"})).await;
    assert_eq!(refusal(&pay).0, "tool_absent");

    // Nothing reached PayPal, from either wallet.
    assert_eq!(h.app.recorders.buyer.asked(), 0);
    assert_eq!(h.app.recorders.house.asked(), 0);

    // The journal saw every call with the rule that answered it.
    let journal = h.app.journal.all();
    let refused: Vec<_> = journal
        .iter()
        .filter(|e| e.outcome == table_sandbox::journal::Outcome::Refused)
        .map(|e| (e.code.clone().unwrap(), e.clause))
        .collect();
    assert_eq!(
        refused,
        [
            ("outside_band".to_owned(), Some(4)),
            ("owner_approval".to_owned(), Some(6)),
            ("tool_absent".to_owned(), None),
        ]
    );
    assert!(journal.iter().all(|e| e.paypal == 0));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_front_door_refuses_browsers_and_foreign_hosts() {
    let h = Harness::boot().await;
    let body = json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}});
    let origin = h
        .http
        .post(format!("{}/mcp", h.url))
        .header("origin", "https://example.test")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(origin.status(), 403);
    let host = h
        .http
        .post(format!("{}/mcp", h.url))
        .header("host", "rebind.example.test")
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(host.status(), 403);
    // The live page is served with a script-only CSP and reads the same facts.
    let page = h.http.get(format!("{}/", h.url)).send().await.unwrap();
    assert_eq!(page.status(), 200);
    assert!(
        page.headers()["content-security-policy"]
            .to_str()
            .unwrap()
            .contains("script-src 'self'")
    );
    let state: Value = h
        .http
        .get(format!("{}/api/state", h.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(state["paypal"]["buyer"], 0);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_fresh_table_is_a_new_house_and_wallet_under_the_same_rule() {
    let h = Harness::boot().await;
    let ready = |t: &Value| {
        t["allowed"]
            .as_array()
            .unwrap()
            .contains(&json!("send_offer"))
    };
    let first = h.table_until(ready).await;
    let fresh = h
        .http
        .post(format!("{}/api/fresh", h.url))
        .header("x-sandbox", "fresh")
        .send()
        .await
        .unwrap();
    assert_eq!(fresh.status(), 200);
    // Without the page's header the door stays shut.
    let forged = h
        .http
        .post(format!("{}/api/fresh", h.url))
        .send()
        .await
        .unwrap();
    assert_eq!(forged.status(), 403);
    let second = h.table_until(ready).await;
    assert_ne!(first["deal_id"], second["deal_id"]);
    assert_eq!(second["history"].as_array().unwrap().len(), 1);
    let over = h
        .call(
            9,
            "send_offer",
            json!({"deal_id":second["deal_id"],"price":"341.00","delivery":{"type":"digital_now"}}),
        )
        .await;
    assert_eq!(refusal(&over), ("outside_band", Some(4)));
    // The wallet's own whole-ledger check reads clean, and names the refusal.
    let state = h.app.snapshot().await;
    assert_eq!(state["table_number"], 2);
    assert_eq!(state["safety"]["intact"], true);
    assert_eq!(state["safety"]["violations_total"], 0);
    assert_eq!(state["safety"]["refused_deal_calls"], 0);
    assert!(
        h.app
            .journal
            .all()
            .iter()
            .any(|e| e.method == "sandbox/table" && e.table == 2)
    );
}
