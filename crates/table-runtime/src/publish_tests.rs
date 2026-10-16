//! When the actor publishes wallet events: after a ledger write, after a message that changes
//! published state outside the ledger (the OS keychain, the house, the unlock), and on the 1 s
//! tick. Never after a pure read, a read-only agent tool or a streamed engine event: each of those
//! used to run the whole-wallet pass (every deal, the attention stack with its forecast, settings
//! with three OS keychain reads), so a fan-out of N reads cost O(N^2).
use super::*;
use std::time::Duration;
use tokio::sync::broadcast;

/// A memory vault that counts reads: each one is an OS keychain read in the app.
#[derive(Default)]
struct CountingVault {
    inner: MemoryVault,
    reads: AtomicUsize,
}
impl CountingVault {
    fn reads(&self) -> usize {
        self.reads.load(Ordering::SeqCst)
    }
}
impl Vault for CountingVault {
    fn read(&self, name: &str) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, vault::VaultError> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.inner.read(name)
    }
    fn write(&self, name: &str, value: &[u8]) -> Result<(), vault::VaultError> {
        self.inner.write(name, value)
    }
}
/// A runtime over a counting vault whose publish tick is held for the length of a test.
fn counted() -> (
    Runtime,
    Arc<CountingVault>,
    Arc<OfflineHttp>,
    Arc<TestClock>,
    Arc<AtomicUsize>,
) {
    let vault = Arc::new(CountingVault::default());
    let http = Arc::new(OfflineHttp::default());
    let clock = Arc::new(TestClock(AtomicI64::new(100)));
    let api = Arc::new(table_paypal::Client::sandbox(
        http.clone(),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    let mut r = Runtime::new(
        Ledger::in_memory().unwrap(),
        vault.clone(),
        Arc::new(Hello {
            calls: AtomicUsize::new(0),
            verified: true,
        }),
        api,
        clock.clone(),
    )
    .unwrap();
    r.publish_tick = Duration::from_secs(3600);
    let passes = r.publish_passes.clone();
    (r, vault, http, clock, passes)
}
/// Waits for the first pass (the tick's immediate first fire) to publish settings.
async fn settled(events: &mut broadcast::Receiver<WalletEvent>) {
    tokio::time::timeout(Duration::from_secs(10), async {
        while !matches!(events.recv().await.unwrap(), WalletEvent::Settings(_)) {}
    })
    .await
    .unwrap();
}
/// Everything published so far, without waiting.
fn drain(events: &mut broadcast::Receiver<WalletEvent>) -> Vec<WalletEvent> {
    let mut out = Vec::new();
    loop {
        match events.try_recv() {
            Ok(event) => out.push(event),
            Err(broadcast::error::TryRecvError::Lagged(_)) => {}
            Err(_) => return out,
        }
    }
}
/// A read the actor answers after it has finished with every earlier message.
async fn barrier(actor: &ActorHandle, id: DealId) {
    actor
        .execute::<Deal>(caller("main", None), Action::Deal(id))
        .await
        .unwrap();
}
fn deal_events(events: &[WalletEvent], id: DealId) -> Vec<&Deal> {
    events
        .iter()
        .filter_map(|e| match e {
            WalletEvent::Deal(changed) if changed.deal.id == id => Some(&changed.deal),
            _ => None,
        })
        .collect()
}
fn settings_events(events: &[WalletEvent]) -> Vec<&SettingsSnapshot> {
    events
        .iter()
        .filter_map(|e| match e {
            WalletEvent::Settings(s) => Some(s),
            _ => None,
        })
        .collect()
}

/// Case 1. Negative control: drop the gate (publish after every message) and this counts
/// >= 900 keychain reads.
#[tokio::test]
async fn a_hundred_deal_reads_run_no_publish_pass_and_read_no_keychain() {
    let (mut r, vault, _, _, passes) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    setup(&mut r, Side::Buyer);
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    barrier(&actor, a.id).await;
    let (reads, before) = (vault.reads(), passes.load(Ordering::SeqCst));
    for _ in 0..100 {
        barrier(&actor, a.id).await;
    }
    assert_eq!(
        vault.reads() - reads,
        0,
        "keychain reads for 100 deal reads"
    );
    assert_eq!(passes.load(Ordering::SeqCst) - before, 0, "publish passes");
    assert!(drain(&mut events).is_empty());
}
/// Case 2 (guard): a write still publishes before the next reply.
#[tokio::test]
async fn a_withdraw_publishes_its_deal_once_before_the_next_reply() {
    let (mut r, _, _, _, _) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    barrier(&actor, a.id).await;
    drain(&mut events);
    actor
        .execute::<()>(caller("main", None), Action::Withdraw(a.id))
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    let sent = drain(&mut events);
    let deals = deal_events(&sent, a.id);
    assert_eq!(deals.len(), 1, "{sent:?}");
    assert_eq!(deals[0].state, DealState::Withdrawn);
    assert!(
        sent.iter().any(|e| matches!(e, WalletEvent::Attention(_))),
        "{sent:?}"
    );
}
/// Case 3 (guard): deal_reconcile is tier Read in the authority table, yet it writes. The
/// trigger is the ledger's write count, never the command's tier.
#[tokio::test]
async fn a_reconcile_that_writes_publishes_its_deal_and_receipt() {
    let (mut r, vault, http, clock, _) = counted();
    credentials(vault.as_ref());
    let api = Arc::new(table_paypal::Client::sandbox(
        http.clone(),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    r.secondary = Some(api.clone());
    r.pipeline.set_secondary(Some(api));
    let deal = receipted_on_the_sellers_word(&mut r);
    clock.0.store(100 + CORROBORATION_SECS, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Unconfirmed
    );
    http.0.lock().unwrap().reporting = Some(json!([{"transaction_info":{
        "transaction_id":"CAPTURE1","transaction_status":"S",
        "transaction_amount":{"currency_code":"USD","value":format!("-{}", deal.terms.amount().unwrap().decimal())}}}]));
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    barrier(&actor, deal.id).await;
    drain(&mut events);
    actor
        .execute::<Value>(
            caller("main", None),
            Action::Reconcile(ReconcileArgs {
                deal_id: deal.id,
                start: 0,
                end: 100 + CORROBORATION_SECS,
            }),
        )
        .await
        .unwrap();
    barrier(&actor, deal.id).await;
    let sent = drain(&mut events);
    let deals = deal_events(&sent, deal.id);
    assert_eq!(deals.len(), 1, "{sent:?}");
    assert_eq!(deals[0].state, DealState::Reconciled);
    assert!(
        sent.iter().any(
            |e| matches!(e, WalletEvent::Receipt(r) if r.deal_id == deal.id && r.state == DealState::Reconciled)
        ),
        "{sent:?}"
    );
}
/// A buyer deal with the seller's listing in, a native run live on it, and the actor settled.
async fn live_run() -> (
    ActorHandle,
    broadcast::Receiver<WalletEvent>,
    Deal,
    RunSnapshot,
    Arc<CountingVault>,
    Arc<AtomicUsize>,
) {
    let (mut r, vault, _, _, passes) = counted();
    let (deal, peer) = setup(&mut r, Side::Buyer);
    client_tests::counter(&mut r, &deal, &peer, 1200);
    r.engines.push((
        Arc::new(WaitingEngine {
            cancellations: AtomicUsize::new(0),
        }),
        table_engine::EngineInfo {
            id: table_engine::EngineId::ClaudeCode,
            available: true,
            version: Some("offline-fixture".into()),
            reason: None,
        },
    ));
    r.engine = table_engine::EngineId::ClaudeCode;
    let (actor, mut events) = spawn(r);
    // An in-process router only: no sockets, no network.
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(actor.sender.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    actor
        .sender
        .send(crate::actor::Message::AttachMcp(
            server,
            "http://127.0.0.1:8765/mcp".into(),
        ))
        .await
        .unwrap();
    settled(&mut events).await;
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let runs: Vec<RunSnapshot> = actor
                .execute(caller("main", None), Action::Runs)
                .await
                .unwrap();
            if runs
                .iter()
                .any(|r| r.run == run.run && r.state == RunState::Running)
            {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    barrier(&actor, deal.id).await;
    drain(&mut events);
    (actor, events, deal, run, vault, passes)
}
async fn intent(
    actor: &ActorHandle,
    run: RunId,
    deal: &Deal,
    tool: &str,
    arguments: Value,
) -> Result<Value, table_app::Error> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    actor
        .sender
        .send(crate::actor::Message::Agent(
            run,
            table_app::AgentScope {
                deal_id: deal.id,
                role: table_app::AgentRole::Negotiator,
                category: Category::Parts,
            },
            table_app::AgentRequest::decode(tool, arguments).unwrap(),
            tx,
        ))
        .await
        .unwrap();
    rx.await.unwrap()
}
/// Case 4. A read-only agent tool runs no pass; an accepted offer moves the transcript head, a
/// ledger write, so its deal is published.
#[tokio::test]
async fn a_table_view_runs_no_pass_and_an_accepted_offer_publishes_its_deal() {
    let (actor, mut events, deal, run, vault, passes) = live_run().await;
    let (reads, before) = (vault.reads(), passes.load(Ordering::SeqCst));
    intent(&actor, run.run, &deal, "table_view", json!({}))
        .await
        .unwrap();
    barrier(&actor, deal.id).await;
    assert_eq!(passes.load(Ordering::SeqCst) - before, 0, "publish passes");
    // What is left is the intent's own signer selection, never the pass's settings reads.
    assert!(vault.reads() - reads < 6, "{}", vault.reads() - reads);
    assert!(drain(&mut events).is_empty());
    let head = deal.transcript_head;
    intent(
        &actor,
        run.run,
        &deal,
        "send_offer",
        json!({"deal_id":deal.id,"price":"12.00","delivery":{"type":"digital_now"}}),
    )
    .await
    .unwrap();
    barrier(&actor, deal.id).await;
    let sent = drain(&mut events);
    let deals = deal_events(&sent, deal.id);
    assert_eq!(deals.len(), 1, "{sent:?}");
    assert_ne!(deals[0].transcript_head, head);
}
/// Case 5. A native run's text stream runs no pass; its end publishes the run's state.
#[tokio::test]
async fn streamed_engine_text_runs_no_pass_and_the_run_end_is_published() {
    let (actor, mut events, deal, run, vault, passes) = live_run().await;
    let (reads, before) = (vault.reads(), passes.load(Ordering::SeqCst));
    for n in 0..50 {
        actor
            .sender
            .send(crate::actor::Message::Engine(
                run.run,
                table_engine::EngineEvent::Text {
                    text: format!("thinking {n}"),
                },
            ))
            .await
            .unwrap();
    }
    barrier(&actor, deal.id).await;
    assert_eq!(passes.load(Ordering::SeqCst) - before, 0, "publish passes");
    assert_eq!(vault.reads() - reads, 0, "keychain reads");
    assert!(drain(&mut events).is_empty());
    actor
        .sender
        .send(crate::actor::Message::EngineFinished(
            run.run,
            Ok(table_engine::TerminalVerdict::Clean),
        ))
        .await
        .unwrap();
    barrier(&actor, deal.id).await;
    let sent = drain(&mut events);
    assert!(
        sent.iter().any(
            |e| matches!(e, WalletEvent::Agent(s) if s.run == run.run && s.state == RunState::Clean)
        ),
        "{sent:?}"
    );
}
/// Case 6 (guard): the house state lives in memory, with no ledger write, and is published
/// before the next reply.
#[tokio::test]
async fn a_house_status_change_is_published_before_the_next_reply() {
    let (mut r, _, _, _, _) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    barrier(&actor, a.id).await;
    drain(&mut events);
    actor
        .execute::<()>(caller("main", None), Action::HouseStatus(HouseState::Ready))
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    let sent = drain(&mut events);
    let settings = settings_events(&sent);
    assert_eq!(settings.len(), 1, "{sent:?}");
    assert_eq!(settings[0].house, HouseState::Ready);
}
/// Case 7 (guard): a verified re-auth unlocks in memory and is published before the next reply,
/// not at the next tick.
#[tokio::test]
async fn an_unlock_is_published_before_the_next_reply() {
    let (mut r, _, _, _, _) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    let token: String = actor
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    drain(&mut events);
    actor
        .unlock(caller("approval", Some(&token)), 0)
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    let sent = drain(&mut events);
    let settings = settings_events(&sent);
    assert_eq!(settings.len(), 1, "{sent:?}");
    assert!(!settings[0].locked);
}
/// Case 8 (guard): with no message at all, the tick still publishes a deadline default.
#[tokio::test]
async fn the_tick_publishes_a_deadline_default_with_no_message() {
    let (mut r, _, _, clock, _) = counted();
    r.publish_tick = Duration::from_secs(1);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let (_actor, mut events) = spawn(r);
    settled(&mut events).await;
    clock.0.store(102, Ordering::SeqCst);
    let receipt = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if let WalletEvent::Receipt(receipt) = events.recv().await.unwrap() {
                break receipt;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(receipt.deal_id, deal.id);
    assert_eq!(receipt.state, DealState::Withdrawn);
}
/// Case 9 (guard, coordinator): saving credentials writes the OS keychain; the settings it
/// changes are published before the next reply, whether or not a ledger row came with it.
#[tokio::test]
async fn saved_credentials_are_published_before_the_next_reply() {
    let (mut r, _, _, _, _) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    let (actor, mut events) = spawn(r);
    settled(&mut events).await;
    let token: String = actor
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    actor
        .unlock(caller("approval", Some(&token)), 0)
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    drain(&mut events);
    actor
        .execute::<()>(
            caller("approval", Some(&token)),
            Action::Credentials(paypal_entry(&random_text(), &random_text())),
        )
        .await
        .unwrap();
    barrier(&actor, a.id).await;
    let sent = drain(&mut events);
    let settings = settings_events(&sent);
    assert_eq!(settings.len(), 1, "{sent:?}");
    assert!(settings[0].payment_executor_configured);
}
/// The ledger's write count moves on a write and never on a read: the trigger the actor uses.
#[test]
fn the_ledger_write_count_moves_on_a_write_and_not_on_a_read() {
    let (mut r, _, _, _, _) = counted();
    let (a, _) = setup(&mut r, Side::Seller);
    let ledger = &mut r.pipeline.wallet.ledger;
    let before = ledger.write_count();
    ledger.get_deal(a.id).unwrap();
    ledger.list_deals().unwrap();
    ledger.deal_evidence(a.id).unwrap();
    assert_eq!(ledger.write_count(), before);
    ledger.set_preference("publish.probe", &true).unwrap();
    assert!(ledger.write_count() > before);
}
/// Every message that changes published state outside the ledger stays loud: the keychain
/// write, the house state, the engine choice, pause and resume, the unlock, the MCP attachment
/// and a run's end. deal_reconcile is tier Read and still loud.
#[test]
fn messages_that_change_state_outside_the_ledger_always_publish() {
    use crate::actor::Message;
    let id = DealId(ulid::Ulid::new());
    for action in [
        Action::Credentials(paypal_entry("id", "secret")),
        Action::HouseStatus(HouseState::Ready),
        Action::Engine(table_engine::EngineId::Scripted),
        Action::Pause,
        Action::Resume,
        Action::Preferences(TumblerPreferences::default()),
        Action::Select(Some(id)),
        Action::Token,
        Action::Reconcile(ReconcileArgs {
            deal_id: id,
            start: 0,
            end: 1,
        }),
    ] {
        assert!(!action.reads_only(), "{action:?}");
    }
    for action in [
        Action::Deal(id),
        Action::Display(id),
        Action::Evidence(id),
        Action::Transcript(id),
        Action::Settings,
        Action::Attention,
    ] {
        assert!(action.reads_only(), "{action:?}");
    }
    let (tx, _) = tokio::sync::oneshot::channel();
    assert!(
        !Message::FinishUnlock(
            caller("approval", None),
            0,
            crate::actor::VerifiedReauth,
            tx
        )
        .quiet()
    );
    let (tx, _) = tokio::sync::oneshot::channel();
    assert!(!Message::BeginUnlock(caller("approval", None), tx).quiet());
    assert!(
        !Message::EngineFinished(RunId(ulid::Ulid::new()), Err(table_engine::Error::Closed))
            .quiet()
    );
    let (tx, _) = tokio::sync::oneshot::channel();
    assert!(!Message::Execute(caller("main", None), Box::new(Action::Pause), tx).quiet());
    let (tx, _) = tokio::sync::oneshot::channel();
    assert!(Message::Execute(caller("main", None), Box::new(Action::Deal(id)), tx).quiet());
    assert!(
        Message::Engine(
            RunId(ulid::Ulid::new()),
            table_engine::EngineEvent::Text { text: "x".into() }
        )
        .quiet()
    );
}
/// The MCP attachment is loud too (it needs a server, so it has its own case).
#[test]
fn attaching_the_mcp_server_publishes() {
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(tx.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    assert!(!crate::actor::Message::AttachMcp(server, "http://127.0.0.1:8765/mcp".into()).quiet());
}
