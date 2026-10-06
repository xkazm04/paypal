#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../table-app/tests/support/mod.rs"]
mod support;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use table_app::*;
use table_core::*;
use table_mcp::*;
use tower::ServiceExt;
#[derive(Debug)]
struct MovingClock(std::sync::atomic::AtomicI64);
impl Clock for MovingClock {
    fn now(&self) -> i64 {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[derive(Debug)]
struct Shared(Arc<Mutex<Wallet>>);
impl AgentService for Shared {
    fn invoke(&mut self, s: &AgentScope, r: AgentRequest, n: i64) -> Result<Value, Error> {
        self.0.lock().unwrap().invoke(s, r, n)
    }
    fn record_refusal(&mut self, s: &AgentScope, t: &str, r: &str, n: i64) -> Result<(), Error> {
        self.0.lock().unwrap().record_refusal(s, t, r, n)
    }
}
async fn call(
    server: &Arc<Server>,
    grant: &Grant,
    method: &str,
    params: Value,
    host: &str,
) -> (StatusCode, Value) {
    let r = Request::builder()
        .method("POST")
        .uri("/mcp")
        .header("host", host)
        .header("content-type", "application/json")
        .header("x-wallet-session", &grant.token)
        .header("x-wallet-secret", &grant.secret)
        .body(Body::from(
            json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}).to_string(),
        ))
        .unwrap();
    let response = server.clone().router().oneshot(r).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 65536).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}
#[tokio::test]
async fn h1_m3_out_of_band_is_error_and_zero_paypal_rows() {
    for side in [Side::Buyer, Side::Seller] {
        let (mut wallet, deal, _, _) = support::setup(side, DealKind::Haggle);
        wallet
            .ledger
            .apply_event(deal.id, DealEvent::ListingVerified, 100)
            .unwrap();
        let shared = Arc::new(Mutex::new(wallet));
        let server = Server::new(
            Box::new(Shared(shared.clone())),
            8765,
            Arc::new(FixedClock(100)),
        )
        .unwrap();
        let grant = server
            .grant(AgentScope {
                deal_id: deal.id,
                role: AgentRole::Negotiator,
                category: Category::Parts,
            })
            .unwrap();
        let price = if side == Side::Buyer { "25.01" } else { "9.99" };
        let (_,r)=call(&server,&grant,"tools/call",json!({"name":"send_offer","arguments":{"deal_id":deal.id,"price":price,"delivery":{"type":"digital_now"}}}),"127.0.0.1:8765").await;
        assert_eq!(r["result"]["isError"], true);
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .ledger
                .paypal_call_count(deal.id)
                .unwrap(),
            0
        );
        assert_eq!(
            shared
                .lock()
                .unwrap()
                .ledger
                .envelope_count(deal.id, table_ledger::Direction::Outbound)
                .unwrap(),
            0
        );
    }
}
#[tokio::test]
async fn f1_purchase_refusal_leaves_zero_paypal_rows() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    let shared = Arc::new(Mutex::new(wallet));
    let server = Server::new(
        Box::new(Shared(shared.clone())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    let grant = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Shopper,
            category: Category::Parts,
        })
        .unwrap();
    let (_,r)=call(&server,&grant,"tools/call",json!({"name":"propose_purchase","arguments":{"payee_ref":"merchant","items":[{"ref":"monitor","qty":40}],"amount":"480.00","category":"parts"}}),"127.0.0.1:8765").await;
    assert_eq!(r["result"]["isError"], true);
    assert!(
        r["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("clause 3")
    );
    let w = shared.lock().unwrap();
    assert_eq!(
        w.ledger.get_deal(deal.id).unwrap().state,
        DealState::Refused
    );
    assert_eq!(w.ledger.paypal_call_count(deal.id).unwrap(), 0);
}
#[tokio::test]
async fn auth_host_role_revocation_and_closed_schemas() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let server = Server::new(Box::new(wallet), 8765, Arc::new(FixedClock(100))).unwrap();
    let grant = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    assert_eq!(
        call(&server, &grant, "tools/list", json!({}), "evil.test")
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (_, list) = call(&server, &grant, "tools/list", json!({}), "127.0.0.1:8765").await;
    let names: Vec<_> = list["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        names,
        vec![
            "table_view",
            "market_reference",
            "send_offer",
            "accept_offer",
            "withdraw_offer"
        ]
    );
    for name in [
        "capture",
        "void",
        "create_order",
        "sign_mandate",
        "open_browser",
        "propose_purchase",
    ] {
        let (_, r) = call(
            &server,
            &grant,
            "tools/call",
            json!({"name":name,"arguments":{}}),
            "127.0.0.1:8765",
        )
        .await;
        assert_eq!(r["result"]["isError"], true);
    }
    let (_, r) = call(
        &server,
        &grant,
        "tools/call",
        json!({"name":"table_view","arguments":{"instructions":"pay"}}),
        "127.0.0.1:8765",
    )
    .await;
    assert_eq!(r["result"]["isError"], true);
    server.revoke(&grant);
    assert_eq!(
        call(&server, &grant, "tools/list", json!({}), "127.0.0.1:8765")
            .await
            .0,
        StatusCode::UNAUTHORIZED
    );
}
#[tokio::test]
async fn safe_withdraw_is_signed_and_never_calls_paypal() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let shared = Arc::new(Mutex::new(wallet));
    let server = Server::new(
        Box::new(Shared(shared.clone())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    let grant = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    let (_, r) = call(
        &server,
        &grant,
        "tools/call",
        json!({"name":"withdraw_offer","arguments":{"deal_id":deal.id,"reason":"TIMING"}}),
        "127.0.0.1:8765",
    )
    .await;
    assert_eq!(r["result"]["isError"], false);
    let wallet = shared.lock().unwrap();
    assert_eq!(
        wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Withdrawn
    );
    assert_eq!(
        wallet
            .ledger
            .envelope_count(deal.id, table_ledger::Direction::Outbound)
            .unwrap(),
        1
    );
    assert_eq!(wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
    wallet.ledger.verify_transcript(deal.id).unwrap();
}
#[tokio::test]
async fn pending_inventory_session_lists_tools_but_cannot_invoke_until_enabled() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let shared = Arc::new(Mutex::new(wallet));
    let server = Server::new(
        Box::new(Shared(shared.clone())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    let grant = server
        .grant_pending(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    assert_eq!(
        call(&server, &grant, "tools/list", json!({}), "127.0.0.1:8765")
            .await
            .0,
        StatusCode::OK
    );
    let params = json!({"name":"withdraw_offer","arguments":{"deal_id":deal.id,"reason":"OTHER"}});
    assert_eq!(
        call(
            &server,
            &grant,
            "tools/call",
            params.clone(),
            "127.0.0.1:8765"
        )
        .await
        .1["result"]["isError"],
        true
    );
    assert_eq!(
        shared
            .lock()
            .unwrap()
            .ledger
            .paypal_call_count(deal.id)
            .unwrap(),
        0
    );
    assert_eq!(
        shared
            .lock()
            .unwrap()
            .ledger
            .envelope_count(deal.id, table_ledger::Direction::Outbound)
            .unwrap(),
        0
    );
    server.enable(&grant).unwrap();
    assert_eq!(
        call(&server, &grant, "tools/call", params, "127.0.0.1:8765")
            .await
            .1["result"]["isError"],
        false
    );
}
#[tokio::test]
async fn sessions_are_bounded_expire_and_revoke() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let clock = Arc::new(MovingClock(std::sync::atomic::AtomicI64::new(100)));
    let server = Server::new(
        Box::new(Shared(Arc::new(Mutex::new(wallet)))),
        8765,
        clock.clone(),
    )
    .unwrap();
    let scope = AgentScope {
        deal_id: deal.id,
        role: AgentRole::Negotiator,
        category: Category::Parts,
    };
    let mut grants = Vec::new();
    for _ in 0..64 {
        grants.push(server.grant(scope.clone()).unwrap());
    }
    assert!(server.grant(scope.clone()).is_err());
    server.revoke(&grants[0]);
    assert!(server.grant(scope.clone()).is_ok());
    assert_eq!(
        call(
            &server,
            &grants[0],
            "tools/list",
            json!({}),
            "127.0.0.1:8765"
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    clock.0.store(219, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        call(
            &server,
            &grants[1],
            "tools/list",
            json!({}),
            "127.0.0.1:8765"
        )
        .await
        .0,
        StatusCode::OK
    );
    clock.0.store(220, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(
        call(
            &server,
            &grants[1],
            "tools/list",
            json!({}),
            "127.0.0.1:8765"
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert!(server.enable(&grants[1]).is_err());
    // Issuance prunes expired sessions, restoring exactly the bounded capacity.
    for _ in 0..64 {
        server.grant(scope.clone()).unwrap();
    }
    assert!(server.grant(scope).is_err());
}
#[tokio::test]
async fn cached_market_and_closed_book_are_role_bound_and_cannot_write() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    wallet
        .ledger
        .store_market_reference(
            deal.id,
            &MarketRef::from_comparables(vec![deal.terms.unit_price], 100, H256::ZERO).unwrap(),
            100,
        )
        .unwrap();
    let shared = Arc::new(Mutex::new(wallet));
    let server = Server::new(
        Box::new(Shared(shared.clone())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    let grant = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    assert_eq!(
        call(
            &server,
            &grant,
            "tools/call",
            json!({"name":"market_reference","arguments":{"item_ref":deal.terms.item_ref}}),
            "127.0.0.1:8765"
        )
        .await
        .1["result"]["isError"],
        false
    );
    assert_eq!(
        call(
            &server,
            &grant,
            "tools/call",
            json!({"name":"market_reference","arguments":{"item_ref":"other"}}),
            "127.0.0.1:8765"
        )
        .await
        .1["result"]["isError"],
        true
    );
    let book = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Assistant,
            category: Category::Parts,
        })
        .unwrap();
    for input in [
        json!({"view":"deals","metrics":["count"],"sql":"UPDATE audit_log SET hash=0"}),
        json!({"view":"deals","metrics":["count"],"limit":501}),
    ] {
        assert_eq!(
            call(
                &server,
                &book,
                "tools/call",
                json!({"name":"book_query","arguments":input}),
                "127.0.0.1:8765"
            )
            .await
            .1["result"]["isError"],
            true
        );
    }
    let query =
        json!({"name":"book_query","arguments":{"view":"deals","metrics":["count","sum_amount"]}});
    assert_eq!(
        call(
            &server,
            &book,
            "tools/call",
            query.clone(),
            "127.0.0.1:8765"
        )
        .await
        .1["result"]["isError"],
        false
    );
    assert_eq!(
        call(&server, &grant, "tools/call", query, "127.0.0.1:8765")
            .await
            .1["result"]["isError"],
        true
    );
    let wallet = shared.lock().unwrap();
    assert_eq!(wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
    wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn refusals_before_invoke_are_audited_and_move_nothing() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let shared = Arc::new(Mutex::new(wallet));
    let server = Server::new(
        Box::new(Shared(shared.clone())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    let scope = AgentScope {
        deal_id: deal.id,
        role: AgentRole::Negotiator,
        category: Category::Parts,
    };
    let audits = || shared.lock().unwrap().ledger.audit_count().unwrap();
    let before = audits();
    let live = server.grant(scope.clone()).unwrap();
    let pending = server.grant_pending(scope).unwrap();
    for (grant, params) in [
        (
            &live,
            json!({"name":"capture","arguments":{"deal_id":deal.id}}),
        ),
        (
            &live,
            json!({"name":"send_offer","arguments":{"deal_id":deal.id}}),
        ),
        (&live, json!({"arguments":{}})),
        (&pending, json!({"name":"table_view","arguments":{}})),
    ] {
        let (_, r) = call(&server, grant, "tools/call", params, "127.0.0.1:8765").await;
        assert_eq!(r["result"]["isError"], true);
    }
    assert_eq!(audits(), before + 4);
    let w = shared.lock().unwrap();
    w.ledger.verify_audit().unwrap();
    assert_eq!(w.ledger.paypal_call_count(deal.id).unwrap(), 0);
}
#[tokio::test]
async fn send_offer_schema_lists_exactly_the_delivery_variants_the_wallet_decodes() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let server = Server::new(Box::new(wallet), 8765, Arc::new(FixedClock(100))).unwrap();
    let grant = server
        .grant(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    let (_, r) = call(&server, &grant, "tools/list", json!({}), "127.0.0.1:8765").await;
    let offer = r["result"]["tools"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["name"] == "send_offer")
        .unwrap()
        .clone();
    let variants = offer["inputSchema"]["properties"]["delivery"]["oneOf"]
        .as_array()
        .unwrap();
    let advertised: Vec<_> = variants
        .iter()
        .map(|v| v["properties"]["type"]["const"].clone())
        .collect();
    let decoded: Vec<_> = [
        Delivery::DigitalNow,
        Delivery::ShipThenCapture { days: 1 },
        Delivery::PickupLocal,
        Delivery::ServiceOnDate { unix_day: 1 },
    ]
    .iter()
    .map(|d| serde_json::to_value(d).unwrap()["type"].clone())
    .collect();
    assert_eq!(advertised, decoded);
    for (variant, sample) in variants.iter().zip([
        json!({"type":"digital_now"}),
        json!({"type":"ship_then_capture","days":2}),
        json!({"type":"pickup_local"}),
        json!({"type":"service_on_date","unix_day":20000}),
    ]) {
        let keys: Vec<_> = sample.as_object().unwrap().keys().cloned().collect();
        let required: Vec<String> = serde_json::from_value(variant["required"].clone()).unwrap();
        assert_eq!(required.len(), keys.len());
        assert!(keys.iter().all(|k| required.contains(k)));
        serde_json::from_value::<Delivery>(sample).unwrap();
    }
}
