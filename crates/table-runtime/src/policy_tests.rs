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
pub(crate) struct Loopback(pub(crate) Arc<Mutex<Option<axum::Router>>>);
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
pub(crate) fn envelope(
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
    assert_eq!(r.runs.len(), crate::engines::MAX_RUNS);
    let mut armed: Vec<DealId> = r.runs.values().map(|a| a.scope.deal_id).collect();
    armed.sort();
    armed.dedup();
    assert_eq!(armed.len(), crate::engines::MAX_RUNS, "one run per deal");
    // Further ticks start nothing while the four slots are held.
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), crate::engines::MAX_RUNS);
    assert!(armed.iter().all(|id| deals.iter().any(|d| d.id == *id)));
    // A freed slot is refilled by the next tick, up to the cap again and never beyond.
    let freed = *r.runs.keys().next().unwrap();
    r.finish_run(freed, RunState::Cancelled).unwrap();
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), crate::engines::MAX_RUNS);
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
            qty: Some(deal.terms.qty),
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

#[tokio::test]
async fn a_run_whose_finish_row_fails_to_write_is_still_listed_as_ended() {
    let (mut r, _, _tx) = parked_runtime(1).await;
    r.tick().await.unwrap();
    let run = *r.runs.keys().next().unwrap();
    r.fail_run_audit = true;
    assert!(r.finish_run(run, RunState::Failed).is_err());
    let listed: Vec<_> = r
        .run_snapshots()
        .into_iter()
        .filter(|s| s.state == RunState::Failed)
        .collect();
    assert_eq!(listed.len(), 1, "the ended run stays visible as ended");
    assert!(r.runs.is_empty());
}

#[tokio::test]
async fn a_failed_native_run_names_its_cause_in_the_run_end_audit_row() {
    let (mut r, _deals, _tx) = parked_runtime(1).await;
    r.tick().await.unwrap();
    let run = *r.runs.keys().next().unwrap();
    let cause = table_engine::Error::Exit { code: Some(2) }.cause();
    r.finish_run_because(run, RunState::Failed, cause).unwrap();
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, u16::MAX).unwrap();
    let finished: Vec<_> = rows
        .into_iter()
        .filter(|a| a.action == "run.finish")
        .collect();
    assert_eq!(finished.len(), 1);
    assert_eq!(finished[0].detail["cause"], "exit:2");
    assert_eq!(finished[0].detail["state"], "failed");
}

/// The demo haggle as the shipped practice agent plays it (tiger 2026-10-24, scope item C3). The
/// limits are the film's: the most Maya pays is $340 over six offers, and above $250 she decides.
/// The market is p25 $300 / median $330. Dan lists at $340 and his counters stay inside her range:
/// a buyer table cannot open on a listing above the ceiling (the deal's terms are mandate-checked
/// when it is created), and a counter above it is refused at intake.
/// The engine runs for real through the wallet's MCP door; the test pumps the actor's messages
/// itself, so it can sign Dan's next counter between runs. Every price asserted here is what the
/// wallet signs, so a film built from this list shows what the app does.
#[tokio::test]
async fn the_demo_haggle_is_what_the_practice_agent_signs_and_it_stops_at_the_ask_me_line() {
    let usd = |n| Money::new(n, Currency::USD).unwrap();
    let (mut r, _, http, _, _) = runtime(true);
    let mut limits = clauses(Side::Buyer, DealKind::Haggle);
    if let Clause::PerDeal { max_amount, .. } = &mut limits[2] {
        *max_amount = usd(50_000);
    }
    if let Clause::Band {
        floor,
        ceiling,
        max_rounds,
        ..
    } = &mut limits[3]
    {
        *floor = None;
        *ceiling = Some(usd(34_000));
        *max_rounds = 6;
    }
    if let Clause::HumanPresentOver { amount } = &mut limits[5] {
        *amount = usd(25_000);
    }
    let (deal, peer) = setup_priced(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        limits,
        usd(34_000),
    );
    let comparables = [30_000, 30_000, 33_000, 36_000, 36_000].map(usd);
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(
            deal.id,
            &MarketRef::certified_prices("monitor", H256::digest(b"similar"), &comparables, 100)
                .unwrap(),
            100,
        )
        .unwrap();

    // The run's MCP door, bridged to a channel this test drains as the actor loop does.
    let loopback = install(&mut r);
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    r.actor_sender = Some(tx.downgrade());
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(tx.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    *loopback.0.lock().unwrap() = Some(server.clone().router());
    r.mcp = Some((server, "http://127.0.0.1:8765/mcp".into()));
    let ours = |r: &Runtime| -> Vec<i64> {
        r.pipeline
            .wallet
            .ledger
            .deal_transcript(deal.id)
            .unwrap()
            .iter()
            .filter(|s| s.by == TranscriptBy::You)
            .filter_map(|s| s.price.map(|p| p.minor()))
            .collect()
    };

    let raw = envelope(
        &r,
        &deal,
        &peer,
        1,
        Body::Listing {
            item_ref: deal.terms.item_ref.clone(),
            ask: deal.terms.unit_price,
            qty: Some(deal.terms.qty),
            delivery: deal.terms.delivery.clone(),
        },
        table_proto::MsgType::Listing,
    );
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    // Maya presses Start agent: it opens at the low end of the typical price.
    r.start_agent(deal.id).unwrap();
    pump(&mut r, &mut rx).await;
    assert_eq!(ours(&r), [30_000]);

    // Dan comes down; each counter re-arms one run that answers on the agent's line, which climbs
    // from $300 toward the typical price ($330) over its five answers.
    let dan = [33_900, 33_600, 33_400, 33_300, 32_900];
    for price in dan {
        let seq = r
            .pipeline
            .wallet
            .ledger
            .deal_transcript(deal.id)
            .unwrap()
            .iter()
            .map(|s| s.seq)
            .max()
            .unwrap()
            + 1;
        let raw = envelope(
            &r,
            &deal,
            &peer,
            seq,
            Body::Counter {
                price: usd(price),
                delivery: deal.terms.delivery.clone(),
            },
            table_proto::MsgType::Counter,
        );
        r.pipeline
            .wallet
            .receive_haggle(deal.id, &raw, Category::Parts, 100)
            .unwrap_or_else(|e| panic!("{price}: {e:?}, ours {:?}", ours(&r)));
        r.tick().await.unwrap();
        assert_eq!(r.runs.len(), 1, "Dan's counter {price} arms one run");
        pump(&mut r, &mut rx).await;
    }
    // Five offers signed, all inside her range. The agent would take Dan's $329 (its line has
    // reached $330), but $329 is above $250, so the wallet refuses its ACCEPT and asks Maya.
    assert_eq!(ours(&r), [30_000, 30_600, 31_200, 31_800, 32_400]);
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, u16::MAX).unwrap();
    let refused: Vec<_> = rows
        .iter()
        .filter(|a| a.action == "intent.refused" && a.deal_id == Some(deal.id))
        .filter(|a| a.detail["layer"] == "wallet")
        .collect();
    assert_eq!(refused.len(), 1, "{refused:#?}");
    assert_eq!(refused[0].detail["tool"], "accept_offer");
    assert_eq!(refused[0].detail["clause"], 6);
    let attention: table_attention::AttentionSnapshot = serde_json::from_value(
        r.execute(caller("main", None), Action::Attention)
            .await
            .unwrap(),
    )
    .unwrap();
    let gate = attention
        .items
        .iter()
        .find(|i| i.deal_id == deal.id)
        .expect("a gate for Maya");
    assert_eq!(gate.clause.as_ref().map(|c| c.number), Some(6));
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Negotiating);
    assert_eq!(after.terms.unit_price, usd(32_900));
    // Nothing reached PayPal, and nothing was agreed for her.
    assert!(http.0.lock().unwrap().paths.is_empty());
}

/// Drains the messages a policy run sends the actor, handled by the same runtime methods the
/// actor loop calls, until no run is left.
pub(crate) async fn pump(
    r: &mut Runtime,
    rx: &mut tokio::sync::mpsc::Receiver<crate::actor::Message>,
) {
    use crate::actor::Message as M;
    while !r.runs.is_empty() {
        let message = tokio::time::timeout(std::time::Duration::from_secs(10), rx.recv())
            .await
            .unwrap()
            .unwrap();
        match message {
            M::Agent(run, scope, request, reply) => {
                let _ = reply.send(r.agent_intent(run, &scope, request));
            }
            M::AgentRefused(scope, tool, code, reply) => {
                let now = r.clock.now();
                let _ = reply.send(table_app::AgentService::record_refusal(
                    &mut r.pipeline.wallet,
                    &scope,
                    &tool,
                    code,
                    now,
                ));
            }
            M::AgentMcpOutcome(scope, tool, outcome, reply) => {
                let now = r.clock.now();
                let _ = reply.send(table_app::AgentService::record_mcp_outcome(
                    &mut r.pipeline.wallet,
                    &scope,
                    &tool,
                    outcome,
                    now,
                ));
            }
            M::Engine(run, event) => {
                r.engine_event(run, event).unwrap();
            }
            M::EngineFinished(run, result) => {
                let state = if matches!(result, Ok(table_engine::TerminalVerdict::Clean)) {
                    RunState::Clean
                } else {
                    RunState::Failed
                };
                r.finish_run_because(run, state, None).unwrap();
            }
            _ => {}
        }
    }
}
