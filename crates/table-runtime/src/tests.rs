#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "agent_surface_tests.rs"]
mod agent_surface_tests;
#[path = "authority_tests.rs"]
mod authority_tests;
#[path = "checks_tests.rs"]
mod checks_tests;
#[path = "client_tests.rs"]
mod client_tests;
#[path = "forecast_tests.rs"]
mod forecast_tests;
#[path = "groups_tests.rs"]
mod groups_tests;
#[path = "h5_tests.rs"]
mod h5_tests;
#[path = "history_tests.rs"]
mod history_tests;
#[path = "ladder_tests.rs"]
mod ladder_tests;
#[path = "limits_tests.rs"]
mod limits_tests;
#[path = "market_watch_tests.rs"]
mod market_watch_tests;
#[path = "policy_tests.rs"]
pub(crate) mod policy_tests;
#[path = "proof_tests.rs"]
mod proof_tests;
#[path = "quit_tests.rs"]
mod quit_tests;
#[path = "relay_tests.rs"]
mod relay_tests;
#[path = "rescue_tests.rs"]
mod rescue_tests;
#[path = "safety_tests.rs"]
mod safety_tests;
#[path = "simulate_tests.rs"]
mod simulate_tests;
use super::*;
use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, AtomicUsize, Ordering},
};
use table_client::*;
use table_core::*;
use table_ledger::{Counterparty, Ledger, PairedVia};
use table_paypal::http::*;
use table_proto::{AgentSigner, Body, Envelope, ShortText};
use vault::{MemoryVault, Vault, VaultCredentials, signing_key};

#[derive(Debug)]
struct TestClock(AtomicI64);
impl Clock for TestClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Debug)]
struct Hello {
    calls: AtomicUsize,
    verified: bool,
}
#[async_trait]
impl reauth::OsReauth for Hello {
    fn supported(&self) -> bool {
        true
    }
    async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.verified {
            Ok(())
        } else {
            Err(permission())
        }
    }
}
#[derive(Debug)]
struct NoDelay;
#[async_trait]
impl Backoff for NoDelay {
    async fn wait(&self, _: u8) {}
}
#[derive(Debug, Default)]
struct ApiState {
    paths: Vec<String>,
    units: Option<Value>,
    fail_void: bool,
    /// The capture request is lost before PayPal sees it.
    fail_capture: bool,
    /// What PayPal holds after each money step, so an order read reflects it (T10 read-back).
    authorization: Option<&'static str>,
    captured: bool,
}
#[derive(Debug, Default)]
struct OfflineHttp(Mutex<ApiState>);
fn random_text() -> String {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    H256(bytes).hex()
}
#[derive(Debug)]
struct WaitingEngine {
    cancellations: AtomicUsize,
}
#[async_trait]
impl table_engine::EngineAdapter for WaitingEngine {
    fn id(&self) -> table_engine::EngineId {
        table_engine::EngineId::ClaudeCode
    }
    async fn probe(&self) -> Result<table_engine::EngineInfo, table_engine::Error> {
        unreachable!("Tests inject inventory; never probe a CLI")
    }
    async fn run(
        &self,
        _: table_engine::AgentJob,
        _: table_engine::McpGrant,
        tx: tokio::sync::mpsc::Sender<table_engine::EngineEvent>,
    ) -> Result<table_engine::TerminalVerdict, table_engine::Error> {
        tx.send(table_engine::EngineEvent::Init { engine: self.id() })
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
    fn cancel(&self, _: RunId) {
        self.cancellations.fetch_add(1, Ordering::SeqCst);
    }
}
#[tokio::test]
async fn actor_runs_recheck_scope_pause_cancels_revoke_stops_old_intents_and_resume_is_explicit() {
    use table_app::{AgentRequest, AgentRole, AgentScope};
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    let engine = Arc::new(WaitingEngine {
        cancellations: AtomicUsize::new(0),
    });
    r.engines.push((
        engine.clone(),
        table_engine::EngineInfo {
            id: table_engine::EngineId::ClaudeCode,
            available: true,
            version: Some("offline-fixture".into()),
            reason: None,
        },
    ));
    r.engine = table_engine::EngineId::ClaudeCode;
    let scope = AgentScope {
        deal_id: deal.id,
        role: AgentRole::Negotiator,
        category: Category::Parts,
    };
    assert!(
        r.agent_intent(
            RunId(ulid::Ulid::new()),
            &scope,
            AgentRequest::decode("table_view", json!({})).unwrap()
        )
        .is_err()
    );
    let (actor, _events) = spawn(r);
    // Attach only an in-process router: no sockets, no network in this test.
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(actor.sender.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    actor
        .sender
        .send(crate::actor::Message::AttachMcp(
            server.clone(),
            "http://127.0.0.1:8765/mcp".into(),
        ))
        .await
        .unwrap();
    assert!(
        actor
            .execute::<RunSnapshot>(caller("tumbler", None), Action::Start(deal.id))
            .await
            .is_err()
    );
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let snapshots: Vec<RunSnapshot> = actor
                .execute(caller("main", None), Action::Runs)
                .await
                .unwrap();
            if snapshots.iter().any(|r| r.state == RunState::Running) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        actor
            .execute::<RunSnapshot>(caller("main", None), Action::Start(deal.id))
            .await
            .is_err()
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run.run,
            scope.clone(),
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_ok());
    let mut wrong = scope.clone();
    wrong.category = Category::Compute;
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run.run,
            wrong,
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_err());
    clock.0.store(220, Ordering::SeqCst);
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run.run,
            scope.clone(),
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_err()); // queued calls also recheck run expiration
    actor
        .execute::<()>(caller("tumbler", None), Action::Pause)
        .await
        .unwrap();
    assert_eq!(engine.cancellations.load(Ordering::SeqCst), 1);
    let runs: Vec<RunSnapshot> = actor
        .execute(caller("main", None), Action::Runs)
        .await
        .unwrap();
    assert!(
        runs.iter()
            .any(|r| r.run == run.run && r.state == RunState::Cancelled)
    );
    assert!(
        actor
            .execute::<RunSnapshot>(caller("main", None), Action::Start(deal.id))
            .await
            .is_err()
    );
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run.run,
            scope.clone(),
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_err());
    assert!(
        actor
            .execute::<()>(caller("tumbler", None), Action::Resume)
            .await
            .is_err()
    );
    actor
        .execute::<()>(caller("main", None), Action::Resume)
        .await
        .unwrap();
    let resumed: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap();
    assert_ne!(run.run, resumed.run);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let snapshots: Vec<RunSnapshot> = actor
                .execute(caller("main", None), Action::Runs)
                .await
                .unwrap();
            if snapshots
                .iter()
                .any(|r| r.run == resumed.run && r.state == RunState::Running)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    // A queued call authenticated by the old grant must not borrow a new run
    // with the same deal/role/category after pause and explicit restart.
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run.run,
            scope.clone(),
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_err());
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            resumed.run,
            scope.clone(),
            AgentRequest::decode("table_view", json!({})).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_ok());
    let token: String = actor
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    actor
        .unlock(caller("approval", Some(&token)), 0)
        .await
        .unwrap();
    actor
        .execute::<()>(
            caller("approval", Some(&token)),
            Action::Revoke(MandateRevokeArgs {
                id: deal.mandate_id,
            }),
        )
        .await
        .unwrap();
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            resumed.run,
            scope,
            AgentRequest::decode(
                "withdraw_offer",
                json!({"deal_id":deal.id,"reason":"OTHER"}),
            )
            .unwrap(),
            tx,
        ))
        .await
        .unwrap();
    assert!(rx.await.unwrap().is_err()); // revoke affects a currently running session
    actor
        .execute::<()>(caller("main", None), Action::Pause)
        .await
        .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn scripted_run_is_labelled_and_invokes_checked_wallet_reads() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    let loopback = policy_tests::install(&mut r);
    let (actor, mut events) = spawn(r);
    policy_tests::attach(&actor, &loopback, 8765).await;
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap();
    assert_eq!(run.mode, Mode::ScriptedEngine);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !matches!(
            events.recv().await,
            Ok(WalletEvent::Agent(RunSnapshot {
                state: RunState::Clean,
                ..
            }))
        ) {}
    })
    .await
    .unwrap();
    let runs: Vec<RunSnapshot> = actor
        .execute(caller("main", None), Action::Runs)
        .await
        .unwrap();
    assert_eq!(runs.len(), 1);
    assert_eq!(runs[0].state, RunState::Clean);
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[async_trait]
impl Transport for OfflineHttp {
    async fn send(&self, request: Request) -> Result<Response, TransportError> {
        let mut s = self.0.lock().unwrap();
        s.paths.push(format!("{} {}", request.method, request.url));
        let url = request.url.as_str();
        if url.ends_with("/oauth2/token") {
            return Ok(Response {
                status: 200,
                body: json!({"access_token":random_text(),"expires_in":300}),
            });
        }
        if url.ends_with("/v2/checkout/orders") {
            let body = request.body.unwrap();
            s.units = Some(body["purchase_units"].clone());
            return Ok(Response {
                status: 201,
                body: json!({"id":"ORDER1","status":"CREATED","intent":"AUTHORIZE","purchase_units":s.units,"links":[{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"}]}),
            });
        }
        if url.ends_with("/orders/ORDER1") {
            if let Some(status) = s.authorization {
                let mut units = s.units.clone().unwrap();
                let amount = units[0]["amount"].clone();
                let captures = if s.captured {
                    json!([{"id":"CAPTURE1","status":"COMPLETED","amount":amount}])
                } else {
                    json!([])
                };
                units[0]["payments"] = json!({"authorizations":[{"id":"AUTH1","status":status,"amount":amount}],"captures":captures});
                return Ok(Response {
                    status: 200,
                    body: json!({"id":"ORDER1","status":"COMPLETED","intent":"AUTHORIZE","purchase_units":units}),
                });
            }
            return Ok(Response {
                status: 200,
                body: json!({"id":"ORDER1","status":"APPROVED","intent":"AUTHORIZE","purchase_units":s.units}),
            });
        }
        if url.ends_with("/orders/ORDER1/authorize") {
            s.authorization = Some("CREATED");
            let mut units = s.units.clone().unwrap();
            units[0]["payments"] = json!({"authorizations":[{"id":"AUTH1","status":"CREATED","amount":units[0]["amount"]}]});
            return Ok(Response {
                status: 201,
                body: json!({"id":"ORDER1","status":"COMPLETED","intent":"AUTHORIZE","purchase_units":units}),
            });
        }
        if url.ends_with("/authorizations/AUTH1/capture") {
            if s.fail_capture {
                return Err(TransportError);
            }
            s.authorization = Some("CAPTURED");
            s.captured = true;
            return Ok(Response {
                status: 201,
                body: json!({"id":"CAPTURE1","status":"COMPLETED","amount":s.units.as_ref().unwrap()[0]["amount"]}),
            });
        }
        if url.ends_with("/authorizations/AUTH1/void") {
            if s.fail_void {
                return Err(TransportError);
            }
            s.authorization = Some("VOIDED");
            return Ok(Response {
                status: 204,
                body: Value::Null,
            });
        }
        if url.ends_with("/authorizations/AUTH1")
            && let Some(status) = s.authorization
        {
            return Ok(Response {
                status: 200,
                body: json!({"id":"AUTH1","status":status,"amount":s.units.as_ref().unwrap()[0]["amount"]}),
            });
        }
        panic!("Unexpected offline HTTP operation");
    }
}
/// T1 parity: the wallet's own export of this deal verifies in full with the offline verifier.
fn assert_proof_verifies(r: &Runtime, id: DealId) -> table_proto::ProofBundle {
    let bundle = r.export_proof(id).unwrap();
    let report = table_verify::verify_bundle(&bundle);
    assert!(report.verified(), "{:#?}", report.checks);
    // The in-app "Check a proof file" reads the saved bytes with the same verifier.
    let file =
        table_client::check_proof_file(&serde_json::to_vec_pretty(&bundle).unwrap()).unwrap();
    assert!(file.verified && file.deal_id == id, "{file:?}");
    // Every line passed, or reads "not checked" because the deal has nothing of its kind.
    assert!(
        file.checks
            .iter()
            .all(|c| (c.ok && c.checked && c.applies) || (!c.ok && !c.checked && !c.applies)),
        "{file:?}"
    );
    // v2: the file names this build's permissions, and the in-app check says so.
    assert_eq!(bundle.format, table_proto::PROOF_FORMAT);
    assert_eq!(
        file.authority_manifest.as_deref(),
        table_client::authority::manifest_hex()
    );
    assert_eq!(file.same_version, Some(true));
    assert!(proof_line(&bundle, "permissions").ok);
    // The same evidence in the first format still verifies under the first format's rules, and
    // every second-format line reads "not checked" there.
    let v1 = as_v1(r, &bundle);
    let old = table_verify::verify_bundle(&v1);
    assert!(old.verified(), "{:#?}", old.checks);
    for id in V2_CHECKS {
        let line = old.checks.iter().find(|c| c.id == id).unwrap();
        assert!(!line.ok && !line.checked && !line.applies, "{line:?}");
    }
    let old_file = table_client::check_proof_file(&serde_json::to_vec(&v1).unwrap()).unwrap();
    assert!(old_file.verified && old_file.same_version.is_none());
    // The owner-key anchor is the whole key id, the one owner_facts shows the owner.
    let owner = table_proto::key_id(&r.pipeline.wallet.owner_public_key()).unwrap();
    assert_eq!(file.owner_key_id, owner.as_str());
    assert_eq!(report.owner_key_id, owner.as_str());
    assert_eq!(file.owner_key_id.len(), 64);
    let ids: Vec<_> = report.checks.iter().map(|c| c.id).collect();
    let file_ids: Vec<_> = file.checks.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, file_ids);
    bundle
}
/// The checks the second proof format adds.
pub(crate) const V2_CHECKS: [&str; 7] = [
    "market",
    "owner_saw",
    "one_request",
    "group",
    "shield",
    "house_record",
    "permissions",
];
/// One line of the offline verifier's report on `bundle`.
pub(crate) fn proof_line(bundle: &table_proto::ProofBundle, id: &str) -> table_verify::Check {
    table_verify::verify_bundle(bundle)
        .checks
        .into_iter()
        .find(|c| c.id == id)
        .unwrap()
}
/// `bundle` as a first-format file: no second-format field, re-signed by the deal's agent.
pub(crate) fn as_v1(r: &Runtime, bundle: &table_proto::ProofBundle) -> table_proto::ProofBundle {
    let mut v1 = bundle.clone();
    v1.format = table_proto::PROOF_FORMAT_V1.into();
    v1.authority_manifest = None;
    v1.group = None;
    v1.house = None;
    for op in &mut v1.operations {
        op.request_id = None;
    }
    for call in &mut v1.paypal_calls {
        call.request_id = None;
    }
    r.sign_proof(&mut v1).unwrap();
    v1
}
/// A forged copy of `bundle`, re-signed by the deal's own agent key so the signature holds:
/// only the check `id` can catch it, and it fails (never "not checked").
pub(crate) fn assert_forgery_fails(
    r: &Runtime,
    bundle: &table_proto::ProofBundle,
    id: &str,
    forge: impl FnOnce(&mut table_proto::ProofBundle),
) {
    let mut forged = bundle.clone();
    forge(&mut forged);
    r.sign_proof(&mut forged).unwrap();
    let report = table_verify::verify_bundle(&forged);
    let line = report.checks.iter().find(|c| c.id == id).unwrap();
    assert!(
        !line.ok && line.checked && line.applies,
        "{id} accepted a forgery: {line:?}"
    );
    assert!(proof_line(&forged, "evidence").ok, "re-signed");
    assert!(!report.verified());
    let file = table_client::check_proof_file(&serde_json::to_vec(&forged).unwrap()).unwrap();
    assert!(!file.verified);
    assert!(file.checks.iter().any(|c| c.id == id && !c.ok && c.checked));
}
fn caller(label: &str, token: Option<&str>) -> Caller {
    Caller {
        label: label.into(),
        token: token.map(str::to_owned),
    }
}
fn runtime(
    verified: bool,
) -> (
    Runtime,
    Arc<MemoryVault>,
    Arc<OfflineHttp>,
    Arc<TestClock>,
    Arc<Hello>,
) {
    let vault = Arc::new(MemoryVault::default());
    let http = Arc::new(OfflineHttp::default());
    let clock = Arc::new(TestClock(AtomicI64::new(100)));
    let hello = Arc::new(Hello {
        calls: AtomicUsize::new(0),
        verified,
    });
    let api = Arc::new(table_paypal::Client::sandbox(
        http.clone(),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    (
        Runtime::new(
            Ledger::in_memory().unwrap(),
            vault.clone(),
            hello.clone(),
            api,
            clock.clone(),
        )
        .unwrap(),
        vault,
        http,
        clock,
        hello,
    )
}
fn clauses(side: Side, kind: DealKind) -> Vec<Clause> {
    let money = |n| Money::new(n, Currency::USD).unwrap();
    vec![
        Clause::Roles {
            roles: vec![if side == Side::Buyer {
                Role::Buy
            } else {
                Role::Sell
            }],
        },
        Clause::Counterparties {
            rule: CpRule::Paired,
        },
        Clause::PerDeal {
            kind,
            max_amount: money(2500),
            categories: vec![Category::Parts],
        },
        Clause::Band {
            item_refs: vec![ItemRef::new("monitor").unwrap()],
            floor: Some(money(1000)),
            ceiling: Some(money(2500)),
            max_rounds: 12,
            deadline: 900_000,
        },
        Clause::Velocity {
            max_deals_day: 10,
            max_total_day: money(100_000),
        },
        Clause::HumanPresentOver {
            amount: money(1500),
        },
        Clause::Payees {
            payees: vec![PayeeRef::new("merchant").unwrap()],
        },
    ]
}
fn setup(r: &mut Runtime, side: Side) -> (Deal, AgentSigner) {
    setup_delivery(r, side, Delivery::DigitalNow)
}
fn setup_delivery(r: &mut Runtime, side: Side, delivery: Delivery) -> (Deal, AgentSigner) {
    let (deal, peer) = setup_unpriced(r, side, delivery);
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(
            deal.id,
            &MarketRef::certified_prices(
                deal.terms.item_ref.as_str(),
                H256::digest(b"similar"),
                &[deal.terms.unit_price],
                100,
            )
            .unwrap(),
            100,
        )
        .unwrap();
    (deal, peer)
}
/// A deal with no market reference: the shield asks for every agent authority.
fn setup_unpriced(r: &mut Runtime, side: Side, delivery: Delivery) -> (Deal, AgentSigner) {
    setup_with(r, side, delivery, clauses(side, DealKind::Haggle))
}
/// A deal with no market reference under a new mandate of these clauses.
fn setup_with(
    r: &mut Runtime,
    side: Side,
    delivery: Delivery,
    clauses: Vec<Clause>,
) -> (Deal, AgentSigner) {
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Haggle,
            side,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery,
            },
        })
        .unwrap();
    (deal, peer)
}
#[test]
fn a_deal_whose_relay_binding_fails_still_carries_its_silence_deadline() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Buyer);
    let key = peer.key_id().unwrap();
    // Filler deals sit under a second mandate so they never touch this mandate's velocity.
    let filler = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap()
        .payload
        .id;
    let ledger = &mut r.pipeline.wallet.ledger;
    ledger
        .pin_pairing_mailbox(&key, H256::digest(b"pairing code"))
        .unwrap();
    for n in 0..64_u32 {
        let mut d = deal.clone();
        d.id = format!("{:026}", 3000 + n).parse().unwrap();
        d.state = DealState::Pairing;
        d.mandate_id = filler;
        ledger.create_deal(&d, 100).unwrap();
        ledger
            .bind_relay(d.id, H256::digest(&n.to_be_bytes()), 100)
            .unwrap();
    }
    let before: Vec<_> = ledger.list_deals().unwrap().iter().map(|d| d.id).collect();
    assert!(
        r.create_deal(DealCreateArgs {
            kind: DealKind::Haggle,
            side: Side::Buyer,
            counterparty: key,
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            category: Category::Parts,
            terms: deal.terms.clone(),
        })
        .is_err()
    );
    let ledger = &r.pipeline.wallet.ledger;
    let orphan = ledger
        .list_deals()
        .unwrap()
        .into_iter()
        .find(|d| !before.contains(&d.id))
        .unwrap();
    assert!(ledger.deadline(orphan.id).unwrap().is_some());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn a_retired_mandate_leaves_deals_to_their_deadline_without_repeating_faults() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let ledger = &mut r.pipeline.wallet.ledger;
    assert_eq!(ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
    ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    ledger
        .stage_relay_batch(deal.id, &"a".repeat(32), 0, &["aaa.bbb.ccc".into()])
        .unwrap();
    ledger.revoke_mandate(deal.mandate_id, 100).unwrap();
    r.tick().await.unwrap();
    r.start_relay().unwrap();
    let ledger = &r.pipeline.wallet.ledger;
    assert!(ledger.pending_inbox().unwrap().is_empty());
    assert_eq!(ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
    clock.0.store(999_999, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .state
            .terminal()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
fn agree(r: &mut Runtime, deal: &Deal, peer: &AgentSigner) {
    r.pipeline.wallet.list(deal.id, 100).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let e = Envelope {
        v: 1,
        typ: table_proto::MsgType::Offer,
        deal_id: deal.id,
        seq: 1,
        prev: current.transcript_head,
        iss: peer.key_id().unwrap(),
        aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
        iat: 100,
        exp: 700,
        nonce,
        body: Body::Offer {
            price: deal.terms.unit_price,
            delivery: deal.terms.delivery.clone(),
        },
    };
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let e = Envelope {
        typ: table_proto::MsgType::Accept,
        seq: 2,
        prev: current.transcript_head,
        nonce,
        body: Body::Accept {
            owner_accept: None,
            offer_seq: 1,
            terms_hash: current.terms.hash().unwrap(),
        },
        ..e
    };
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    r.pipeline
        .wallet
        .accept(deal.id, 1, Category::Parts, 100)
        .unwrap();
}
fn credentials(vault: &dyn Vault) {
    vault
        .write(
            "paypal.sandbox",
            &serde_json::to_vec(&(random_text(), random_text())).unwrap(),
        )
        .unwrap();
}
#[tokio::test]
async fn buyer_browser_availability_needs_unlock_but_no_local_paypal_credentials() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Buyer);
    for event in [
        DealEvent::ListingVerified,
        DealEvent::OfferVerified,
        DealEvent::TwoAcceptsVerified,
    ] {
        r.pipeline
            .wallet
            .ledger
            .apply_event(deal.id, event, 100)
            .unwrap();
    }
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let body = Body::Settle {
        order_id: ShortText::new("ORDER1".into()).unwrap(),
        approve_url: ShortText::new(
            "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1".into(),
        )
        .unwrap(),
        amount: deal.terms.amount().unwrap(),
        invoice_id: ShortText::new(invoice_id(deal.id, 1).unwrap()).unwrap(),
        intent: table_proto::Intent::Authorize,
        attempt: 1,
    };
    let e = Envelope {
        v: 1,
        typ: body.typ(),
        deal_id: deal.id,
        seq: 1,
        prev: H256::ZERO,
        iss: peer.key_id().unwrap(),
        aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
        iat: 100,
        exp: 700,
        nonce,
        body,
    };
    r.pipeline
        .wallet
        .receive_relay(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    assert!(!r.summary(deal.id).unwrap().can_open_paypal);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    r.pipeline
        .approval
        .unlock("approval", &token, &crate::actor::VerifiedReauth, 100)
        .unwrap();
    r.selected = Some(deal.id);
    let summary = r.summary(deal.id).unwrap();
    assert!(summary.can_open_paypal);
    assert!(!summary.can_release);
    assert!(!r.settings().unwrap().payment_executor_configured);
    let url = r
        .decide(
            "approval",
            Some(&token),
            DecisionArgs {
                counter_hash: None,
                deal_id: deal.id,
                attempt: 1,
                terms_hash: summary.terms_hash,
                checks_hash: Some(summary.checks_hash),
            },
            Decision::OpenBrowser,
        )
        .await
        .unwrap();
    assert_eq!(
        url,
        "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"
    );
    assert!(
        r.execute(caller("main", None), Action::Handoff(deal.id))
            .await
            .is_err()
    );
    let handoff: TumblerHandoff = serde_json::from_value(
        r.execute(caller("approval", None), Action::Handoff(deal.id))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(handoff.deal_id, deal.id);
    assert_eq!(handoff.approve_until, 21700);
    assert!(r.pipeline.wallet.ledger.handed_off(deal.id).unwrap());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[derive(Debug)]
struct MarketFixture {
    calls: AtomicUsize,
}
#[async_trait]
impl table_market::MarketApi for MarketFixture {
    async fn comparables(
        &self,
        product: &str,
        currency: Currency,
    ) -> Result<MarketRef, table_market::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(MarketRef::certified_prices(
            product,
            H256::digest(b"similar"),
            &[Money::new(1300, currency).unwrap()],
            100,
        )
        .unwrap())
    }
    async fn start_tracking(&self, _: &str) -> Result<(), table_market::Error> {
        unreachable!()
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, table_market::Error> {
        unreachable!()
    }
}
#[tokio::test]
async fn native_market_refresh_checks_owner_before_io_and_rechecks_bound_terms_and_mandate() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    let market = Arc::new(MarketFixture {
        calls: AtomicUsize::new(0),
    });
    r.attach_market(market.clone());
    let binding = r.prepare_market(deal.id).unwrap();
    // No market-watch rule names the item, and the item is named by a market product id: the
    // item itself is the product.
    assert_eq!(binding.product_id, "monitor");
    let reference = MarketRef::certified_prices(
        "monitor",
        H256::ZERO,
        &[Money::new(1300, Currency::USD).unwrap()],
        100,
    )
    .unwrap();
    let mut stale = binding.clone();
    stale.terms_hash = H256::digest(b"stale");
    assert!(r.store_market(stale, reference.clone()).is_err());
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, 100)
        .unwrap();
    assert!(r.store_market(binding, reference).is_err());
    let (actor, _events) = spawn(r);
    for label in ["main", "tumbler"] {
        assert!(
            actor
                .market_refresh(
                    caller(label, Some(&token)),
                    MarketRefreshArgs {
                        deal_id: deal.id,
                        product_id: "product1".into()
                    }
                )
                .await
                .is_err()
        );
    }
    assert!(
        actor
            .market_refresh(
                caller("approval", Some(&token)),
                MarketRefreshArgs {
                    deal_id: deal.id,
                    product_id: "product1".into()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 0);
    assert!(http.0.lock().unwrap().paths.is_empty());
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    r.attach_market(market.clone());
    // market-data-2: a record for a product the rules do not bind to the deal's item is
    // refused, and a record that is not re-checkable is not stored by the owner's refresh.
    let binding = r.prepare_market(deal.id).unwrap();
    let other = MarketRef::certified_prices(
        "product1",
        H256::ZERO,
        &[Money::new(1300, Currency::USD).unwrap()],
        100,
    )
    .unwrap();
    assert!(r.store_market(binding.clone(), other).is_err());
    let older = MarketRef::from_comparables(
        vec![Money::new(1300, Currency::USD).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    assert!(r.store_market(binding, older).is_err());
    // The deal keeps the record its setup stored; neither refused record replaced it.
    let kept = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().market;
    assert_eq!(
        kept.unwrap().certificate.unwrap().raw_sha256,
        H256::digest(b"similar")
    );
    let (actor, _events) = spawn(r);
    assert!(
        actor
            .market_refresh(
                caller("approval", Some(&token)),
                MarketRefreshArgs {
                    deal_id: deal.id,
                    product_id: "product1".into(),
                },
            )
            .await
            .is_err()
    );
    assert_eq!(
        market.calls.load(Ordering::SeqCst),
        0,
        "a product not bound to the item is refused before any market call"
    );
    let reference = actor
        .market_refresh(
            caller("approval", Some(&token)),
            MarketRefreshArgs {
                deal_id: deal.id,
                product_id: "monitor".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(reference.median.minor(), 1300);
    assert_eq!(
        reference.certificate.as_ref().unwrap().product_id,
        "monitor"
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 1);
    let stored: Deal = actor
        .execute(caller("main", None), Action::Deal(deal.id))
        .await
        .unwrap();
    assert_eq!(stored.market.unwrap().median.minor(), 1300);
}
struct Verified;
impl table_app::NativeReauth for Verified {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
fn unlock_runtime(r: &mut Runtime) -> String {
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    r.pipeline
        .approval
        .unlock("approval", &token, &Verified, r.clock.now())
        .unwrap();
    token
}
/// The owner's decision on what the summary shows now, bound to its checklist hash.
fn decision(r: &mut Runtime, id: DealId) -> DecisionArgs {
    let deal = r.pipeline.wallet.ledger.get_deal(id).unwrap();
    DecisionArgs {
        counter_hash: None,
        deal_id: id,
        attempt: r.pipeline.wallet.ledger.settled_attempt(id).unwrap().max(1),
        terms_hash: deal.terms.hash().unwrap(),
        checks_hash: Some(r.approval_checks(id).unwrap().1),
    }
}

#[test]
fn vault_keys_persist_are_distinct_and_debug_never_exposes_them() {
    let vault = MemoryVault::default();
    let a = signing_key(&vault, "owner").unwrap();
    let b = signing_key(&vault, "agent").unwrap();
    assert_eq!(
        a.verifying_key(),
        signing_key(&vault, "owner").unwrap().verifying_key()
    );
    assert_ne!(a.verifying_key(), b.verifying_key());
    assert_eq!(format!("{vault:?}"), "MemoryVault { [REDACTED] }");
    vault.write("broken", &[0; 2]).unwrap();
    assert!(signing_key(&vault, "broken").is_err());
}
#[test]
fn a_lost_owner_key_fails_closed_once_the_wallet_has_history() {
    use crate::vault::{VaultError, existing_signing_key};
    let empty = MemoryVault::default();
    assert!(matches!(
        existing_signing_key(&empty, "owner"),
        Err(VaultError::Missing)
    ));
    assert!(empty.read("owner").unwrap().is_none());
    let build = |ledger: Ledger, vault: Arc<MemoryVault>| {
        let clock = Arc::new(TestClock(AtomicI64::new(100)));
        Runtime::new(
            ledger,
            vault.clone(),
            Arc::new(Hello {
                calls: AtomicUsize::new(0),
                verified: true,
            }),
            Arc::new(table_paypal::Client::sandbox(
                Arc::new(OfflineHttp::default()),
                Arc::new(VaultCredentials(vault)),
                clock.clone(),
                Arc::new(NoDelay),
            )),
            clock,
        )
    };
    let mut entropy = [0; 16];
    getrandom::fill(&mut entropy).unwrap();
    let name: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.build/tmp");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("owner-{name}.sqlite3"));
    let original = Arc::new(MemoryVault::default());
    let mut r = build(Ledger::open(&path).unwrap(), original.clone()).unwrap();
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Negotiator,
        clauses: clauses(Side::Buyer, DealKind::Purchase),
        not_before: 0,
        expires: 1000000,
    })
    .unwrap();
    drop(r);
    let lost = Arc::new(MemoryVault::default());
    assert!(build(Ledger::open(&path).unwrap(), lost.clone()).is_err());
    assert!(lost.read("owner").unwrap().is_none());
    assert!(build(Ledger::open(&path).unwrap(), original).is_ok());
    std::fs::remove_file(path).unwrap();
}
#[test]
fn signing_refuses_a_mandate_no_role_can_act_under() {
    let (mut r, ..) = runtime(false);
    // A sell-only mandate over a purchase kind could never allow an intent.
    let mut mismatched = clauses(Side::Seller, DealKind::Purchase);
    mismatched.retain(|c| c.number() != 4);
    let id = MandateId(ulid::Ulid::new());
    // A rule's answer, readable as REFUSED with its reason; never a ledger-trust fault.
    let error = r
        .sign_mandate(MandateSignArgs {
            id: Some(id),
            agent: AgentSlot::Negotiator,
            clauses: mismatched,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert!(
        error
            .message
            .contains("no role in the roles clause can act on the per-deal kind"),
        "{error:?}"
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .list_mandates(&r.owner().unwrap().verifying_key())
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.next_mandate_version(id).unwrap(),
        1
    );
}
#[tokio::test]
async fn a_band_change_that_clears_the_only_bound_is_refused_and_nothing_moves() {
    let (mut r, _, http, _, _) = runtime(true);
    // A sell-only mandate: its agents need a least-you'll-take.
    let (deal, _) = setup(&mut r, Side::Seller);
    let token = unlock_runtime(&mut r);
    r.execute(caller("main", None), Action::Select(Some(deal.id)))
        .await
        .unwrap();
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Band(BandArgs {
                deal_id: deal.id,
                floor: None,
                ceiling: Some(Money::new(2000, Currency::USD).unwrap()),
            }),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert!(
        error
            .message
            .contains("band lacks the side the allowed roles use"),
        "{error:?}"
    );
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(ledger.next_mandate_version(deal.mandate_id).unwrap(), 2);
    assert_eq!(ledger.get_deal(deal.id).unwrap().mandate_version, 1);
    ledger
        .active_mandate(deal.mandate_id, 1, &r.owner().unwrap().verifying_key())
        .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn signing_a_mandate_needs_the_approval_label_and_its_token() {
    let (mut r, ..) = runtime(false);
    let token = unlock_runtime(&mut r);
    let args = || MandateSignArgs {
        id: None,
        agent: AgentSlot::Negotiator,
        clauses: clauses(Side::Buyer, DealKind::Haggle),
        not_before: 0,
        expires: 1_000_000,
    };
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        let error = r.execute(who, Action::Sign(args())).await.unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    }
    let owner = r.owner().unwrap().verifying_key();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .list_mandates(&owner)
            .unwrap()
            .is_empty()
    );
    let m: OpenMandate = serde_json::from_value(
        r.execute(caller("approval", Some(&token)), Action::Sign(args()))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(m.payload.version, 1);
}
#[tokio::test]
async fn unlock_checks_origin_before_os_and_failure_keeps_lock() {
    let (r, _, http, _, hello) = runtime(false);
    let (actor, _events) = spawn(r);
    assert!(
        actor
            .execute::<String>(caller("main", None), Action::Token)
            .await
            .is_err()
    );
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    assert!(
        actor
            .unlock(caller("tumbler", Some(&token)), 1)
            .await
            .is_err()
    );
    assert_eq!(hello.calls.load(Ordering::SeqCst), 0);
    assert!(
        actor
            .unlock(caller("approval", Some(&token)), 1)
            .await
            .is_err()
    );
    assert_eq!(hello.calls.load(Ordering::SeqCst), 1);
    assert!(
        actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn successful_os_unlock_uses_completion_time_and_reads_do_not_refresh_idle() {
    let (r, _, _, clock, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    clock.0.store(999, Ordering::SeqCst);
    assert!(
        !actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
    clock.0.store(1000, Ordering::SeqCst);
    assert!(
        actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
}
#[tokio::test]
async fn credentials_are_privileged_write_only_and_never_appear_in_settings() {
    let (r, vault, http, _, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    let id = random_text();
    let secret = random_text();
    let args = || vault::CredentialEntry::PaypalSandbox {
        client_id: zeroize::Zeroizing::new(id.clone()),
        client_secret: zeroize::Zeroizing::new(secret.clone()),
    };
    assert!(
        actor
            .execute::<()>(caller("main", Some(&token)), Action::Credentials(args()))
            .await
            .is_err()
    );
    assert!(
        actor
            .execute::<()>(
                caller("approval", Some(&token)),
                Action::Credentials(args())
            )
            .await
            .is_err()
    );
    assert!(vault.read("paypal.sandbox").unwrap().is_none());
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    actor
        .execute::<()>(
            caller("approval", Some(&token)),
            Action::Credentials(args()),
        )
        .await
        .unwrap();
    let settings = actor
        .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
        .await
        .unwrap();
    let json = serde_json::to_string(&settings).unwrap();
    assert!(!json.contains(&id));
    assert!(!json.contains(&secret));
    assert!(settings.payment_executor_configured);
    assert!(http.0.lock().unwrap().paths.is_empty());
}
fn paypal_entry(id: &str, secret: &str) -> vault::CredentialEntry {
    vault::CredentialEntry::PaypalSandbox {
        client_id: zeroize::Zeroizing::new(id.into()),
        client_secret: zeroize::Zeroizing::new(secret.into()),
    }
}
#[test]
fn credential_values_that_fail_validation_write_nothing() {
    let long = "x".repeat(1025);
    for bad in ["", "   \t ", long.as_str(), "ab\u{7}cd"] {
        for entry in [
            paypal_entry(bad, "secret"),
            paypal_entry("id", bad),
            vault::CredentialEntry::Channel3 {
                key: zeroize::Zeroizing::new(bad.into()),
            },
        ] {
            let (mut r, vault, _, _, _) = runtime(true);
            assert!(r.credentials(entry).is_err(), "{bad:?}");
            assert!(vault.read("paypal.sandbox").unwrap().is_none());
            assert!(vault.read("channel3").unwrap().is_none());
            for name in ["paypal.sandbox", "channel3"] {
                let date = r
                    .pipeline
                    .wallet
                    .ledger
                    .preference::<i64>(&format!("credential.{name}.stored_at"))
                    .unwrap();
                assert!(date.is_none());
            }
        }
    }
}
#[test]
fn credential_values_are_stored_trimmed() {
    let (mut r, vault, _, _, _) = runtime(true);
    r.credentials(paypal_entry("  id-1 \n", "\tsecret-1  "))
        .unwrap();
    let stored = vault.read("paypal.sandbox").unwrap().unwrap();
    assert_eq!(
        serde_json::from_slice::<(String, String)>(&stored).unwrap(),
        ("id-1".to_string(), "secret-1".to_string())
    );
    let date = r
        .pipeline
        .wallet
        .ledger
        .preference::<i64>("credential.paypal.sandbox.stored_at")
        .unwrap();
    assert!(date.is_some());
}
struct FailingVault;
impl Vault for FailingVault {
    fn read(&self, _: &str) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, vault::VaultError> {
        Ok(None)
    }
    fn write(&self, _: &str, _: &[u8]) -> Result<(), vault::VaultError> {
        Err(vault::VaultError::Unavailable)
    }
}
#[test]
fn a_failed_vault_write_reports_the_error_and_writes_no_date() {
    let mut date_written = false;
    let err = configuration::store_credential(&FailingVault, "paypal.sandbox", b"k", || {
        date_written = true;
        Ok::<(), ()>(())
    })
    .unwrap_err();
    assert_eq!(err.message, "OS secret store write failed");
    assert!(!date_written);
}
#[test]
fn a_failed_date_write_after_a_vault_success_still_saves_the_keys() {
    let vault = MemoryVault::default();
    configuration::store_credential(&vault, "paypal.sandbox", b"keys", || Err::<(), _>("ledger"))
        .unwrap();
    assert_eq!(&**vault.read("paypal.sandbox").unwrap().unwrap(), b"keys");
}
#[tokio::test]
async fn pairing_requires_signed_identity_all_words_and_owner_authority() {
    let (mut a, _, _, _, _) = runtime(true);
    let (mut b, _, _, _, _) = runtime(true);
    let offer = b
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("merchant").unwrap(),
        })
        .unwrap();
    let mut altered = offer.bundle.clone();
    altered.identity.payee = PayeeRef::new("other").unwrap();
    assert!(
        a.pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(altered),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap()
        })
        .is_err()
    );
    let words = a
        .pairing_join(PairingJoinArgs {
            code: offer.code,
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    let token = unlock_runtime(&mut a);
    let mut wrong = words.words.clone();
    wrong[0] = "other".into();
    assert!(
        a.execute(
            caller("approval", Some(&token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: wrong,
                display_name: "Peer".into()
            })
        )
        .await
        .is_err()
    );
    let value = a
        .execute(
            caller("approval", Some(&token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: words.words,
                display_name: "Peer".into(),
            }),
        )
        .await
        .unwrap();
    let key: KeyId = serde_json::from_value(value).unwrap();
    assert!(
        a.pipeline
            .wallet
            .ledger
            .counterparty_policy(&key)
            .unwrap()
            .0
    );
}
#[tokio::test]
async fn signed_mandate_versions_revoke_and_band_only_change_selected_unsettled_deal() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    let token = unlock_runtime(&mut r);
    let args = BandArgs {
        deal_id: deal.id,
        floor: Some(Money::new(1100, Currency::USD).unwrap()),
        ceiling: Some(Money::new(2000, Currency::USD).unwrap()),
    };
    assert!(
        r.execute(caller("approval", Some(&token)), Action::Band(args.clone()))
            .await
            .is_err()
    );
    r.execute(caller("main", None), Action::Select(Some(deal.id)))
        .await
        .unwrap();
    let m: OpenMandate = serde_json::from_value(
        r.execute(caller("approval", Some(&token)), Action::Band(args))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(m.payload.version, 2);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .mandate_version,
        2
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Revoke(MandateRevokeArgs {
            id: deal.mandate_id,
        }),
    )
    .await
    .unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .active_mandate(deal.mandate_id, 2, &r.owner().unwrap().verifying_key())
            .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn safe_withdraw_is_signed_without_unlock_and_does_not_call_paypal() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.execute(caller("tumbler", None), Action::Withdraw(deal.id))
        .await
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Withdrawn
    );
    r.pipeline.wallet.ledger.verify_transcript(deal.id).unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn actor_payments_require_label_token_unlock_selected_hash_and_attempt() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    let args = decision(&mut r, deal.id);
    for caller in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
        caller("approval", Some(&token)),
    ] {
        assert!(
            r.execute(
                caller,
                Action::Decision(args.clone(), Decision::Countersign)
            )
            .await
            .is_err()
        );
    }
    unlock_runtime(&mut r);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args.clone(), Decision::Countersign)
        )
        .await
        .is_err()
    );
    r.selected = Some(deal.id);
    let mut wrong = args.clone();
    wrong.terms_hash = H256::ZERO;
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(wrong, Decision::Countersign)
        )
        .await
        .is_err()
    );
    let mut wrong = args;
    wrong.attempt = 2;
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(wrong, Decision::Countersign)
        )
        .await
        .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
}
#[tokio::test]
async fn dismissal_never_assents_and_deadline_runs_while_locked_or_paused() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.execute(caller("main", None), Action::Pause)
        .await
        .unwrap();
    r.execute(caller("tumbler", None), Action::LetLapse(deal.id))
        .await
        .unwrap();
    assert!(r.attention().unwrap().items.is_empty());
    clock.0.store(900_001, Ordering::SeqCst);
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Withdrawn
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert!(r.settings().unwrap().locked);
}
#[tokio::test]
async fn preferences_survive_actor_restart_without_persisting_secret_material() {
    let (mut r, _, _, _, _) = runtime(true);
    let p = TumblerPreferences {
        pinned: false,
        position: Some(PuckPosition { x: -400, y: 300 }),
        form: table_attention::Form::Tab,
        quiet: false,
        dnd: true,
        notifications: false,
        snap: table_attention::Snap::ScreenLeft,
    };
    r.execute(caller("main", None), Action::Preferences(p.clone()))
        .await
        .unwrap();
    let stored: TumblerPreferences = r
        .pipeline
        .wallet
        .ledger
        .preference("tumbler")
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(stored).unwrap(),
        serde_json::to_value(p).unwrap()
    );
    let vault = r.vault.clone();
    let api = Arc::new(table_paypal::Client::sandbox(
        Arc::new(OfflineHttp::default()),
        Arc::new(VaultCredentials(vault.clone())),
        r.clock.clone(),
        Arc::new(NoDelay),
    ));
    let mut restarted =
        Runtime::new(r.pipeline.wallet.ledger, vault, r.reauth, api, r.clock).unwrap();
    let settings = restarted.settings().unwrap();
    assert!(settings.locked);
    assert!(!settings.preferences.pinned);
    assert!(settings.preferences.dnd);
    assert_eq!(settings.preferences.position.unwrap().x, -400);
}

#[tokio::test]
async fn real_actor_countersign_verified_browser_link_poll_and_seller_capture() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    let created: Deal = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args.clone(), Decision::Countersign),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(created.state, DealState::AwaitingApproval);
    // The order now exists, so the checklist the countersign was taken on is stale.
    let stale = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::OpenBrowser),
        )
        .await
        .unwrap_err();
    assert_eq!(stale.message, crate::SUMMARY_CHANGED);
    let args = decision(&mut r, deal.id);
    let url: String = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::OpenBrowser),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert!(url.starts_with("https://www.sandbox.paypal.com/"));
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    let paths = &http.0.lock().unwrap().paths;
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.ends_with("/checkout/orders"))
            .count(),
        1
    );
    assert_eq!(paths.iter().filter(|p| p.ends_with("/capture")).count(), 1);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
    r.pipeline.wallet.ledger.verify_transcript(deal.id).unwrap();
}
#[tokio::test]
async fn owner_void_requires_ticket_and_is_durable_once() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    let args = decision(&mut r, deal.id);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert!(
        r.execute(
            caller("main", Some(&token)),
            Action::Decision(args.clone(), Decision::Void)
        )
        .await
        .is_err()
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args.clone(), Decision::Void),
    )
    .await
    .unwrap();
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Void)
        )
        .await
        .is_err()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Voided
    );
    assert_eq!(
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with("/void"))
            .count(),
        1
    );
}
/// An owner's capture whose answer was lost, then the deal's mandate revoked: with no agent key
/// the read-back still runs and the deadline still releases the hold, and nothing captures.
/// Before, the tick returned before both and the money stayed held at PayPal.
#[tokio::test]
async fn a_revoked_mandate_never_freezes_an_open_capture_past_its_deadline() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    http.0.lock().unwrap().fail_capture = true;
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Capture),
        )
        .await
        .is_err()
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    http.0.lock().unwrap().fail_capture = false;
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, clock.now())
        .unwrap();
    assert!(r.select_signer(deal.id).is_err());
    let count = |http: &OfflineHttp, end: &str| {
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with(end))
            .count()
    };
    // The client's own retries of the one lost request, all under its one request id.
    let (reads, captures) = (
        count(&http, "/authorizations/AUTH1"),
        count(&http, "/capture"),
    );
    assert!(captures >= 1);
    // Inside the deadline: read back (the hold is there, nothing captured), and nothing is sent.
    clock.0.fetch_add(60, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(count(&http, "/authorizations/AUTH1"), reads + 1);
    assert_eq!(count(&http, "/capture"), captures);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    // At the deadline: the capture closes not done and the safe default voids the hold.
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    clock.0.store(due + 1, Ordering::SeqCst);
    r.tick().await.unwrap();
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(
        ledger.get_deal(deal.id).unwrap().state,
        DealState::AutoVoided
    );
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    assert!(!r.pipeline.signer_missing);
    assert_eq!(count(&http, "/capture"), captures);
    assert_eq!(count(&http, "/void"), 1);
    let ids: std::collections::BTreeSet<_> = ledger
        .paypal_call_requests(deal.id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/capture"))
        .map(|(_, _, request)| request)
        .collect();
    assert_eq!(ids.len(), 1, "one capture request id");
    let state = http.0.lock().unwrap();
    assert_eq!(
        (state.authorization, state.captured),
        (Some("VOIDED"), false)
    );
}
#[tokio::test]
async fn failed_void_does_not_starve_another_deadline_or_retry_unknown_money() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (held, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &held, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(held.id);
    let args = decision(&mut r, held.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    let (other, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(other.id, 101, None, 100)
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .set_deadline(held.id, 101, Some(100), 100)
        .unwrap();
    http.0.lock().unwrap().fail_void = true;
    clock.0.store(2000, Ordering::SeqCst);
    assert!(r.tick().await.is_err());
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(other.id).unwrap().state,
        DealState::Withdrawn
    );
    // The owner sees the open question honestly: a HOLD card that only opens the deal, worded
    // as checking with PayPal, and the deal's evidence says the same.
    let card = r
        .attention()
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.deal_id == held.id)
        .unwrap();
    assert_eq!(card.kind, table_attention::AttnKind::Hold);
    assert_eq!(
        card.actions,
        vec![table_attention::TumblerAction::OpenInTable]
    );
    assert!(
        card.headline.starts_with("Checking with PayPal"),
        "{}",
        card.headline
    );
    assert_eq!(card.on_silence, table_attention::MONEY_CHECK_SILENCE);
    assert_eq!(card.money_check.map(|c| c.step), Some(MoneyCheckStep::Void));
    let evidence = r.pipeline.wallet.ledger.deal_evidence(held.id).unwrap();
    assert_eq!(
        evidence.money_check.map(|c| c.step),
        Some(MoneyCheckStep::Void)
    );
    assert!(
        r.forecast(clock.now())
            .unwrap()
            .iter()
            .all(|l| l.deal_id != held.id),
        "no step or default is promised while PayPal is being asked"
    );
    // The unknown void is read back (T10): PayPal still holds the money, so the same void is
    // sent again once under its one request id, never a second operation. When that fails too,
    // the wallet stops asking and parks the step for the owner; the deal stays held.
    for _ in 0..6 {
        clock.0.fetch_add(1000, Ordering::SeqCst);
        let _ = r.tick().await;
    }
    let ledger = &r.pipeline.wallet.ledger;
    let void_requests: std::collections::BTreeSet<_> = ledger
        .paypal_call_requests(held.id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/void"))
        .map(|(_, _, request)| request)
        .collect();
    assert_eq!(
        void_requests.into_iter().collect::<Vec<_>>(),
        vec![
            table_paypal::RequestId::for_operation(held.id, 1, "void")
                .unwrap()
                .as_str()
                .to_owned()
        ]
    );
    let outcomes: Vec<_> = ledger
        .resolutions(
            table_paypal::RequestId::for_operation(held.id, 1, "void")
                .unwrap()
                .as_str(),
        )
        .unwrap()
        .into_iter()
        .map(|(_, outcome)| outcome)
        .collect();
    assert_eq!(outcomes, ["resent", "deferred", "needs_owner"]);
    assert_eq!(
        ledger.operation_count(held.id).unwrap(),
        3,
        "create, authorize, void"
    );
    assert_eq!(
        ledger.get_deal(held.id).unwrap().state,
        DealState::Authorized
    );
    assert_eq!(
        ledger.money_check(held.id).unwrap().unwrap().state,
        MoneyCheckState::Parked
    );
}
#[tokio::test]
async fn quit_confirmation_includes_dismissed_gates_and_rejects_changed_set() {
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.execute(caller("tumbler", None), Action::LetLapse(deal.id))
        .await
        .unwrap();
    let summary: QuitSummary = serde_json::from_value(
        r.execute(caller("main", None), Action::QuitSummary)
            .await
            .unwrap(),
    )
    .unwrap();
    assert!(summary.pending.contains(&deal.id));
    r.execute(caller("tumbler", None), Action::Withdraw(deal.id))
        .await
        .unwrap();
    assert!(
        r.execute(
            caller("main", None),
            Action::QuitConfirm(QuitArgs {
                confirmation_id: summary.confirmation_id
            })
        )
        .await
        .is_err()
    );
}
#[tokio::test]
async fn missing_credentials_and_unavailable_engine_are_explicit() {
    let (mut r, _, http, _, _) = runtime(true);
    assert!(r.settings().unwrap().first_run);
    assert!(!r.settings().unwrap().payment_executor_configured);
    assert!(
        r.execute(
            caller("main", None),
            Action::Engine(table_engine::EngineId::CodexCli)
        )
        .await
        .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn keeping_the_practice_agent_is_a_recorded_choice_not_the_default() {
    let (mut r, _, http, _, _) = runtime(true);
    let fresh = r.settings().unwrap();
    assert!(!fresh.engine_chosen);
    assert_eq!(fresh.selected_engine, table_engine::EngineId::Scripted);
    r.execute(
        caller("main", None),
        Action::Engine(table_engine::EngineId::Scripted),
    )
    .await
    .unwrap();
    let kept = r.settings().unwrap();
    assert!(kept.engine_chosen);
    assert_eq!(kept.selected_engine, table_engine::EngineId::Scripted);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn shield_hold_release_is_owner_bound_and_block_can_never_be_released() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 100)
        .unwrap();
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("tumbler", Some(&token)),
            Action::Decision(args.clone(), Decision::ReleaseHold)
        )
        .await
        .is_err()
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args.clone(), Decision::ReleaseHold),
    )
    .await
    .unwrap();
    let released = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(released.shield, Some(ShieldVerdict::Ask));
    assert!(released.shield_released() && !released.shield_held());
    assert_eq!(released.decided_by, Some(DecidedBy::Human { at: 100 }));
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Block, 100)
        .unwrap();
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::ReleaseHold)
        )
        .await
        .is_err()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().shield,
        Some(ShieldVerdict::Block)
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn pending_os_prompt_does_not_block_actor_deadline_processing() {
    struct PendingHello {
        started: tokio::sync::Notify,
        finish: tokio::sync::Notify,
    }
    #[async_trait]
    impl reauth::OsReauth for PendingHello {
        fn supported(&self) -> bool {
            true
        }
        async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
            self.started.notify_one();
            self.finish.notified().await;
            Ok(())
        }
    }
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let hello = Arc::new(PendingHello {
        started: tokio::sync::Notify::new(),
        finish: tokio::sync::Notify::new(),
    });
    r.reauth = hello.clone();
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    let unlocker = actor.clone();
    let task =
        tokio::spawn(async move { unlocker.unlock(caller("approval", Some(&token)), 1).await });
    hello.started.notified().await;
    clock.0.store(102, Ordering::SeqCst);
    let updated = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let d = actor
                .execute::<Deal>(caller("main", None), Action::Deal(deal.id))
                .await
                .unwrap();
            if d.state == DealState::Withdrawn {
                break d;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(updated.state, DealState::Withdrawn);
    assert!(!task.is_finished());
    hello.finish.notify_one();
    task.await.unwrap().unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn actor_emits_real_changed_and_receipt_events_for_deadline_default() {
    let (mut r, _, _, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let (_actor, mut events) = spawn(r);
    // Wait for the initial deal projection before advancing the injected clock.
    while !matches!(events.recv().await.unwrap(), WalletEvent::Deal(_)) {}
    clock.0.store(102, Ordering::SeqCst);
    let receipt = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            if let WalletEvent::Receipt(receipt) = events.recv().await.unwrap() {
                break receipt;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(receipt.deal_id, deal.id);
    assert_eq!(receipt.mode, Mode::Sandbox);
    assert_eq!(receipt.state, DealState::Withdrawn);
    assert!(receipt.on_silence.contains("no capture"));
}
#[tokio::test]
async fn both_pairing_sides_compute_identical_words_and_exchange_signed_replies() {
    let (mut buyer, buyer_vault, _, _, _) = runtime(true);
    let (mut seller, _, _, _, _) = runtime(true);
    let offer = seller
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let buyer_words = buyer
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    // Even a correctly signed reply cannot attach to a different initiating offer.
    let mut wrong_reply = buyer_words.reply.clone();
    wrong_reply.identity.in_reply_to = Some(H256::ZERO);
    let bytes = canonical_bytes(&wrong_reply.identity).unwrap();
    use ed25519_dalek::Signer;
    wrong_reply.owner_signature = signing_key(buyer_vault.as_ref(), "owner")
        .unwrap()
        .sign(&bytes)
        .to_bytes()
        .to_vec();
    wrong_reply.agent_signature =
        signing_key(buyer_vault.as_ref(), AgentSlot::Negotiator.key_name())
            .unwrap()
            .sign(&bytes)
            .to_bytes()
            .to_vec();
    assert!(wrong_reply.verify().is_ok());
    assert!(
        seller
            .pairing_join(PairingJoinArgs {
                code: offer.code.clone(),
                peer: Some(wrong_reply),
                side: Side::Seller,
                payee: PayeeRef::new("seller").unwrap(),
            })
            .is_err()
    );
    let seller_words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code,
            peer: Some(buyer_words.reply),
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    assert_eq!(buyer_words.words, seller_words.words);
}

#[test]
fn pairing_offers_are_bounded_expire_and_are_consumed_on_confirmation() {
    let (mut buyer, _, http, _, _) = runtime(true);
    let (mut seller, _, _, clock, _) = runtime(true);
    let args = || PairingCreateArgs {
        side: Side::Seller,
        payee: PayeeRef::new("merchant").unwrap(),
    };
    let offer = seller.pairing_create(args()).unwrap();
    let buyer_words = buyer
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    let words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(buyer_words.reply),
            side: Side::Seller,
            payee: PayeeRef::new("merchant").unwrap(),
        })
        .unwrap();
    seller
        .pairing_confirm(PairingConfirmArgs {
            pairing_id: words.pairing_id,
            words: words.words,
            display_name: "Buyer".into(),
        })
        .unwrap();
    assert!(
        seller
            .pairing_offer(PairingPollArgs { code: offer.code })
            .is_err()
    );
    for _ in 0..64 {
        seller.pairing_create(args()).unwrap();
    }
    assert!(seller.pairing_create(args()).is_err());
    let extra = buyer
        .pairing_create(PairingCreateArgs {
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    assert!(
        seller
            .pairing_join(PairingJoinArgs {
                code: extra.code,
                peer: Some(extra.bundle),
                side: Side::Seller,
                payee: PayeeRef::new("merchant").unwrap(),
            })
            .is_err()
    );
    clock.0.store(86500, Ordering::SeqCst);
    assert!(seller.pairing_create(args()).is_ok());
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn native_credential_prompt_is_never_opened_before_privilege_and_cancel_writes_nothing() {
    struct CancelPrompt(AtomicUsize);
    #[async_trait]
    impl credentials::CredentialPrompt for CancelPrompt {
        async fn prompt(
            &self,
            _: CredentialArgs,
            _: isize,
        ) -> Result<vault::CredentialEntry, CommandError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(permission())
        }
    }
    let (r, vault, _, _, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let prompt = CancelPrompt(AtomicUsize::new(0));
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    assert!(
        actor
            .set_credentials(
                caller("main", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert!(
        actor
            .set_credentials(
                caller("approval", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert_eq!(prompt.0.load(Ordering::SeqCst), 0);
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    assert!(
        actor
            .set_credentials(
                caller("approval", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert_eq!(prompt.0.load(Ordering::SeqCst), 1);
    assert!(vault.read("paypal.sandbox").unwrap().is_none());
}

#[tokio::test]
async fn notification_rung_is_claimed_once_and_remains_recorded() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 800, None, 100)
        .unwrap();
    let claim = || Action::ClaimNotification {
        deal_id: deal.id,
        deadline: 800,
    };
    assert_eq!(
        r.execute(caller("tumbler", None), claim()).await.unwrap(),
        json!(true)
    );
    assert_eq!(
        r.execute(caller("tumbler", None), claim()).await.unwrap(),
        json!(false)
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("notification.{}.800", deal.id))
            .unwrap()
            .unwrap()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn failing_attention_read_is_one_fault_per_streak_and_recovery_republishes() {
    let (r, _, _, _, _) = runtime(true);
    let fail = r.fail_attention.clone();
    fail.store(true, Ordering::SeqCst);
    let (_actor, mut events) = spawn(r);
    let mut faults = 0;
    let _ = tokio::time::timeout(std::time::Duration::from_millis(3500), async {
        loop {
            match events.recv().await {
                Ok(WalletEvent::Fault(_)) => faults += 1,
                Ok(WalletEvent::Attention(_)) => panic!("attention published while failing"),
                _ => {}
            }
        }
    })
    .await;
    assert_eq!(faults, 1, "a streak of failing ticks is one Fault");
    fail.store(false, Ordering::SeqCst);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !matches!(events.recv().await, Ok(WalletEvent::Attention(_))) {}
    })
    .await
    .expect("first good read after the streak is published");
}

#[test]
fn attention_event_faults_once_and_clears_cache_on_error() {
    let snapshot = || table_attention::snapshot(&[], 100, 0, 0.0, false);
    let (mut cache, mut faulted) = (None, false);
    assert!(matches!(
        attention_event(Ok(snapshot()), &mut cache, &mut faulted),
        Some(WalletEvent::Attention(_))
    ));
    assert!(attention_event(Ok(snapshot()), &mut cache, &mut faulted).is_none());
    let error = || unavailable("down");
    assert!(matches!(
        attention_event(Err(error()), &mut cache, &mut faulted),
        Some(WalletEvent::Fault(_))
    ));
    assert!(cache.is_none());
    assert!(attention_event(Err(error()), &mut cache, &mut faulted).is_none());
    // The same stack as before the failure is published again.
    assert!(matches!(
        attention_event(Ok(snapshot()), &mut cache, &mut faulted),
        Some(WalletEvent::Attention(_))
    ));
}

#[tokio::test]
async fn notification_claim_refusals_and_release() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 800, None, 100)
        .unwrap();
    let claim = |deal_id, deadline| Action::ClaimNotification { deal_id, deadline };
    let key = format!("notification.{}.800", deal.id);
    // Wrong label, wrong deadline, and a deadline more than 900 s away are all refused.
    assert!(
        r.execute(caller("main", None), claim(deal.id, 800))
            .await
            .is_err()
    );
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 799))
            .await
            .unwrap(),
        json!(false)
    );
    clock.0.store(-200, Ordering::SeqCst);
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(false)
    );
    // An unknown deal is not a Gate.
    clock.0.store(100, Ordering::SeqCst);
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            claim(DealId(ulid::Ulid::new()), 800)
        )
        .await
        .unwrap(),
        json!(false)
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&key)
            .unwrap()
            .is_none()
    );
    // Claim, release, claim again; release is for the tumbler only.
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(true)
    );
    let release = || Action::ReleaseNotification {
        deal_id: deal.id,
        deadline: 800,
    };
    assert!(r.execute(caller("main", None), release()).await.is_err());
    assert_eq!(
        r.pipeline.wallet.ledger.preference::<bool>(&key).unwrap(),
        Some(true)
    );
    r.execute(caller("tumbler", None), release()).await.unwrap();
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(true)
    );
    // Deadline already past: refused.
    clock.0.store(801, Ordering::SeqCst);
    r.execute(caller("tumbler", None), release()).await.unwrap();
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(false)
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn let_lapse_is_refused_on_a_hold_and_on_an_authorized_deal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    // A shield Hold with a deadline.
    let (held, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(held.id, 800, None, 100)
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .raise_shield(held.id, ShieldVerdict::Hold, 100)
        .unwrap();
    assert!(
        r.execute(caller("tumbler", None), Action::LetLapse(held.id))
            .await
            .is_err()
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", held.id))
            .unwrap()
            .is_none()
    );
    // An Authorized deal.
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .deadline(deal.id)
            .unwrap()
            .is_some()
    );
    assert!(
        r.execute(caller("tumbler", None), Action::LetLapse(deal.id))
            .await
            .is_err()
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id))
            .unwrap()
            .is_none()
    );
    let _ = http;
}
#[tokio::test]
async fn a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins() {
    let (mut r, _, http, clock, _) = runtime(true);
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let make = |r: &mut Runtime, with_band: bool| {
        let mut list = clauses(Side::Buyer, DealKind::Purchase);
        if !with_band {
            list.retain(|c| !matches!(c, Clause::Band { .. }));
        }
        let mandate = r
            .sign_mandate(MandateSignArgs {
                id: None,
                agent: AgentSlot::Negotiator,
                clauses: list,
                not_before: 0,
                expires: 1_000_000,
            })
            .unwrap();
        r.create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap()
    };
    let banded = make(&mut r, true);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .deadline(banded.id)
            .unwrap()
            .unwrap()
            .0,
        900_000
    );
    let deal = make(&mut r, false);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .deadline(deal.id)
            .unwrap()
            .unwrap()
            .0,
        100 + 24 * 3600
    );
    r.pipeline
        .wallet
        .ledger
        .propose_purchase(&deal, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    clock.0.store(100 + 24 * 3600, Ordering::SeqCst);
    r.tick().await.unwrap();
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Withdrawn);
    assert!(matches!(
        after.decided_by,
        Some(DecidedBy::SafeDefault { .. })
    ));
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn a_tick_never_starts_an_order_for_a_cleared_purchase() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    assert!(r.settings().unwrap().payment_executor_configured);
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .propose_purchase(&deal, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
}
