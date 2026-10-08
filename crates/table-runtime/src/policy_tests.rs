#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Policy negotiator: loopback helpers shared with the relay tests, the mandate falsifier and the
//! re-arming bounds. No sockets: the MCP router is driven in process.
use super::*;
use axum::{
    body::{Body as HttpBody, to_bytes},
    http::Request,
};
use table_engine::{EngineAdapter, EngineId, EngineInfo, McpGrant, McpTransport, PolicyEngine};
use tower::ServiceExt;

/// Hands each JSON-RPC request to the wallet's real MCP router, headers and all.
#[derive(Clone, Default)]
pub(crate) struct Loopback(Arc<Mutex<Option<axum::Router>>>);
impl std::fmt::Debug for Loopback {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Loopback")
    }
}
#[async_trait]
impl McpTransport for Loopback {
    async fn post(&self, grant: &McpGrant, body: Value) -> Result<Value, table_engine::Error> {
        let router = self
            .0
            .lock()
            .map_err(|_| table_engine::Error::Process)?
            .clone()
            .ok_or(table_engine::Error::Process)?;
        let authority = grant
            .url
            .strip_prefix("http://")
            .and_then(|rest| rest.split('/').next())
            .ok_or(table_engine::Error::Invalid)?;
        let request = Request::post("/mcp")
            .header("host", authority)
            .header("content-type", "application/json")
            .header("x-wallet-secret", &grant.secret)
            .header("x-wallet-session", &grant.token)
            .body(HttpBody::from(body.to_string()))
            .map_err(|_| table_engine::Error::Invalid)?;
        let response = router
            .oneshot(request)
            .await
            .map_err(|_| table_engine::Error::Process)?;
        if !response.status().is_success() {
            return Err(table_engine::Error::Process);
        }
        let bytes = to_bytes(response.into_body(), 1 << 20)
            .await
            .map_err(|_| table_engine::Error::Process)?;
        serde_json::from_slice(&bytes).map_err(|_| table_engine::Error::Invalid)
    }
}
fn info() -> EngineInfo {
    EngineInfo {
        id: EngineId::Scripted,
        available: true,
        version: Some("1".into()),
        reason: None,
    }
}
/// Installs the policy negotiator on a runtime, wired to a loopback the test attaches later.
pub(crate) fn install(r: &mut Runtime) -> Loopback {
    let loopback = Loopback::default();
    r.engines.push((
        Arc::new(PolicyEngine::new(Arc::new(loopback.clone()))),
        info(),
    ));
    loopback
}
/// Attaches an in-process MCP server for this actor, like `spawn_networked` minus the socket.
pub(crate) async fn attach(actor: &ActorHandle, loopback: &Loopback, port: u16) {
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(actor.sender.downgrade())),
        port,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    *loopback.0.lock().unwrap() = Some(server.clone().router());
    actor
        .sender
        .send(crate::actor::Message::AttachMcp(
            server,
            format!("http://127.0.0.1:{port}/mcp"),
        ))
        .await
        .unwrap();
}
pub(crate) async fn runs(actor: &ActorHandle) -> Vec<RunSnapshot> {
    actor
        .execute(caller("main", None), Action::Runs)
        .await
        .unwrap()
}
/// Waits until every run has ended and returns the history.
pub(crate) async fn settled(actor: &ActorHandle) -> Vec<RunSnapshot> {
    tokio::time::timeout(std::time::Duration::from_secs(10), async {
        loop {
            let all = runs(actor).await;
            if !all.is_empty()
                && all
                    .iter()
                    .all(|r| !matches!(r.state, RunState::Starting | RunState::Running))
            {
                return all;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}
fn envelope(
    r: &Runtime,
    deal: &Deal,
    peer: &AgentSigner,
    seq: u32,
    body: Body,
    typ: table_proto::MsgType,
) -> String {
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    peer.sign(&Envelope {
        v: 1,
        typ,
        deal_id: deal.id,
        seq,
        prev: current.transcript_head,
        iss: peer.key_id().unwrap(),
        aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
        iat: 100,
        exp: 700,
        nonce,
        body,
    })
    .unwrap()
}
/// A seller deal whose peer has just made an offer nobody has answered.
fn offered(r: &mut Runtime) -> Deal {
    let (deal, peer) = setup(r, Side::Seller);
    r.pipeline.wallet.list(deal.id, 100).unwrap();
    let raw = envelope(
        r,
        &deal,
        &peer,
        1,
        Body::Offer {
            price: deal.terms.unit_price,
            delivery: deal.terms.delivery.clone(),
        },
        table_proto::MsgType::Offer,
    );
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    let deal = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(deal.state, DealState::Negotiating);
    deal
}
/// Occupies its run slot forever, like a long native run.
#[derive(Debug)]
struct Parked;
#[async_trait]
impl EngineAdapter for Parked {
    fn id(&self) -> EngineId {
        EngineId::Scripted
    }
    async fn probe(&self) -> Result<EngineInfo, table_engine::Error> {
        unreachable!("tests inject inventory")
    }
    async fn run(
        &self,
        _: table_engine::AgentJob,
        _: McpGrant,
        tx: tokio::sync::mpsc::Sender<table_engine::EngineEvent>,
    ) -> Result<table_engine::TerminalVerdict, table_engine::Error> {
        tx.send(table_engine::EngineEvent::Init {
            engine: EngineId::Scripted,
        })
        .await
        .map_err(|_| table_engine::Error::Closed)?;
        std::future::pending().await
    }
    async fn structured(
        &self,
        _: &str,
        _: &table_engine::Schema,
    ) -> Result<Value, table_engine::Error> {
        Err(table_engine::Error::Invalid)
    }
    fn cancel(&self, _: RunId) {}
}
/// A runtime with `deals` unanswered offers, parked runs and an in-process MCP server, but no
/// actor loop: the test drives `tick` itself.
async fn parked_runtime(
    deals: usize,
) -> (
    Runtime,
    Vec<Deal>,
    tokio::sync::mpsc::Sender<crate::actor::Message>,
) {
    let (mut r, _, _, _, _) = runtime(true);
    let all: Vec<Deal> = (0..deals).map(|_| offered(&mut r)).collect();
    r.engines.push((Arc::new(Parked), info()));
    let (tx, _rx) = tokio::sync::mpsc::channel(64);
    // Keep the receiver alive: dropping it would make the senders' messages fail.
    std::mem::forget(_rx);
    r.actor_sender = Some(tx.downgrade());
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(tx.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    r.mcp = Some((server, "http://127.0.0.1:8765/mcp".into()));
    (r, all, tx)
}

#[tokio::test]
async fn rearming_never_exceeds_four_runs_or_one_run_per_deal() {
    let (mut r, deals, _tx) = parked_runtime(6).await;
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 4);
    let mut armed: Vec<DealId> = r.runs.values().map(|a| a.scope.deal_id).collect();
    armed.sort();
    armed.dedup();
    assert_eq!(armed.len(), 4, "one run per deal");
    // Further ticks start nothing while the four slots are held.
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 4);
    assert!(armed.iter().all(|id| deals.iter().any(|d| d.id == *id)));
    // A freed slot is refilled by the next tick, up to the cap again and never beyond.
    let freed = *r.runs.keys().next().unwrap();
    r.finish_run(freed, RunState::Cancelled).unwrap();
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 4);
}

#[tokio::test]
async fn rearming_starts_nothing_while_paused_or_under_another_engine() {
    let (mut r, _, _tx) = parked_runtime(2).await;
    r.paused = true;
    r.tick().await.unwrap();
    assert!(r.runs.is_empty());
    r.paused = false;
    r.engine = EngineId::ClaudeCode;
    r.tick().await.unwrap();
    assert!(r.runs.is_empty(), "a native engine owns its own haggling");
    r.engine = EngineId::Scripted;
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 2);
}

#[tokio::test]
async fn a_peer_message_arms_one_run_and_a_refused_answer_is_not_retried_until_the_table_moves() {
    let (mut r, deals, _tx) = parked_runtime(1).await;
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 1);
    let run = *r.runs.keys().next().unwrap();
    r.finish_run(run, RunState::Clean).unwrap();
    // Same transcript head, no reply yet: the run already happened, so the tick stays quiet.
    r.tick().await.unwrap();
    assert!(r.runs.is_empty());
    assert_eq!(r.armed.get(&deals[0].id), Some(&deals[0].transcript_head));
}

#[tokio::test]
async fn buyer_policy_above_the_signed_ceiling_is_refused_and_leaves_no_paypal_rows() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Buyer);
    let raw = envelope(
        &r,
        &deal,
        &peer,
        1,
        Body::Listing {
            item_ref: deal.terms.item_ref.clone(),
            ask: deal.terms.unit_price,
            delivery: deal.terms.delivery.clone(),
        },
        table_proto::MsgType::Listing,
    );
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Listed
    );
    // The signed band tops out at 25.00; this policy is configured for 99.99 against a market
    // that says 80.00, so it opens at 50.00.
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(
            deal.id,
            &MarketRef::from_comparables(
                vec![Money::new(8000, Currency::USD).unwrap()],
                100,
                H256::ZERO,
            )
            .unwrap(),
            100,
        )
        .unwrap();
    let money = |n| Some(Money::new(n, Currency::USD).unwrap());
    r.brief_tamper = Some((money(5000), money(9999)));
    let loopback = install(&mut r);
    let (actor, _) = spawn(r);
    attach(&actor, &loopback, 8765).await;
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap();
    assert_eq!(run.mode, Mode::ScriptedEngine);
    // The run ends cleanly: a refusal is the mandate working, not an engine fault.
    let ended = settled(&actor).await;
    assert!(ended.iter().all(|r| r.state == RunState::Clean));
    let page: AuditPage = actor
        .execute(
            caller("main", None),
            Action::AuditPage(AuditPageArgs {
                before: None,
                limit: 100,
            }),
        )
        .await
        .unwrap();
    assert!(
        page.rows
            .iter()
            .any(|row| row.action == "intent.refused" && row.deal_id == Some(deal.id))
    );
    let steps: Vec<TranscriptStep> = actor
        .execute(caller("main", None), Action::Transcript(deal.id))
        .await
        .unwrap();
    assert!(steps.iter().all(|s| s.typ == TranscriptType::Listing));
    let answer: BookAnswer = actor
        .execute(
            caller("main", None),
            Action::BookQuery(BookQueryArgs {
                query: json!({"view":"paypal_calls","metrics":["count"]}),
            }),
        )
        .await
        .unwrap();
    assert!(
        answer
            .rows
            .iter()
            .all(|row| row["count"].as_u64().unwrap_or(0) == 0)
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

/// E2, the wallet's half: every run the scripted engine starts reports the scripted-engine mode,
/// the field the agent card's "Practice agent" badge reads (client `RunBadge`, tested in
/// `runWords.test.tsx`). A run reported under any other mode would lose its label.
#[tokio::test]
async fn e2_every_scripted_engine_run_carries_the_mode_its_agent_card_labels() {
    let (mut r, _, _tx) = parked_runtime(3).await;
    r.tick().await.unwrap();
    let snapshots = r.run_snapshots();
    assert_eq!(snapshots.len(), 3);
    for run in snapshots {
        assert_eq!(run.engine, EngineId::Scripted);
        assert_eq!(run.mode, Mode::ScriptedEngine);
    }
}
