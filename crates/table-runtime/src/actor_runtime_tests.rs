//! The wallet actor end to end: recheck and scripted runs, preferences across restart, the quit
//! confirm, the shield hold, settings and reconcile.
use super::*;

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
    // A second start on the same deal says so, not "paused" or "limit".
    let again = actor
        .execute::<RunSnapshot>(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap_err();
    assert_eq!(again.message, crate::engines::ALREADY_RUNNING);
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
    let paused = actor
        .execute::<RunSnapshot>(caller("main", None), Action::Start(deal.id))
        .await
        .unwrap_err();
    assert_eq!(paused.message, crate::engines::AGENTS_PAUSED);
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
            .execute::<ResumeReport>(caller("tumbler", None), Action::Resume)
            .await
            .is_err()
    );
    // Resume restarts nothing and reports the tables waiting on our agent: this deal was never
    // listed, so no offer can go out on it yet and the report is empty (resume_tests.rs pins a
    // non-empty one).
    let report: ResumeReport = actor
        .execute(caller("main", None), Action::Resume)
        .await
        .unwrap();
    assert_eq!(report, ResumeReport { waiting: vec![] });
    assert!(
        actor
            .execute::<Vec<RunSnapshot>>(caller("main", None), Action::Runs)
            .await
            .unwrap()
            .iter()
            .all(|r| r.state != RunState::Running && r.state != RunState::Starting)
    );
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
#[test]
fn settings_tell_whether_the_house_is_connected_without_the_counterparty_list() {
    let (mut r, _, _, _, _) = runtime(true);
    assert!(!r.settings().unwrap().house_connected);
    fn insert(r: &mut Runtime, name: &str, via: PairedVia) {
        let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), name).unwrap());
        r.pipeline
            .wallet
            .ledger
            .insert_counterparty(&Counterparty {
                key_id: peer.key_id().unwrap(),
                owner_key: peer.public_key().to_bytes(),
                agent_key: peer.public_key().to_bytes(),
                display_name: ShortText::new("Peer".into()).unwrap(),
                paired_via: via,
                words_confirmed_at: Some(100),
                declared_payee: PayeeRef::new("merchant").unwrap(),
                first_seen: 0,
            })
            .unwrap();
    }
    insert(&mut r, "code-peer", PairedVia::Code);
    assert!(!r.settings().unwrap().house_connected);
    insert(&mut r, "house-peer", PairedVia::House);
    assert!(r.settings().unwrap().house_connected);
}
/// robustness-1 (c): the unconfirmed-reason claims a statement read only when one was made, and
/// says only what is true either way when that is unknown.
#[test]
fn the_unconfirmed_reason_claims_a_statement_read_only_when_one_was_made() {
    use crate::actor::unconfirmed_reason;
    assert!(unconfirmed_reason(Some(true)).contains("did not show"));
    let none = unconfirmed_reason(Some(false));
    assert!(none.contains("did not check") && !none.contains("did not show"));
    let unknown = unconfirmed_reason(None);
    assert!(!unknown.contains("did not show") && !unknown.contains("never showed"));
}
/// robustness-1 (c): the owner's statement check, through the runtime, on a deal that already
/// ended UNCONFIRMED. A read that finds nothing leaves it UNCONFIRMED and keeps the read in the
/// record; a read that matches ends it RECONCILED. Nothing else is refused for that state.
#[tokio::test]
async fn an_owner_reconcile_through_the_runtime_on_an_unconfirmed_deal_ends_reconciled() {
    let (mut r, vault, http, clock, _) = runtime(true);
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
    let state = |r: &Runtime| r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
    assert_eq!(state(&r), DealState::Unconfirmed);
    // The statement shows nothing: still UNCONFIRMED, the read is in the record.
    reconcile_main(&mut r, deal.id, 100 + CORROBORATION_SECS)
        .await
        .unwrap();
    assert_eq!(state(&r), DealState::Unconfirmed);
    // The statement shows the payment (a buyer's debit): RECONCILED.
    http.0.lock().unwrap().reporting = Some(json!([{"transaction_info":{
        "transaction_id":"CAPTURE1","transaction_status":"S",
        "transaction_amount":{"currency_code":"USD","value":format!("-{}", deal.terms.amount().unwrap().decimal())}}}]));
    reconcile_main(&mut r, deal.id, 100 + CORROBORATION_SECS)
        .await
        .unwrap();
    assert_eq!(state(&r), DealState::Reconciled);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// The owner's public key is the one the wallet was built with: the publish pass and the deal
/// reads verify against it from memory and never ask the OS keychain for the owner's secret.
#[tokio::test]
async fn reads_verify_against_the_owner_key_in_memory_not_the_keychain() {
    struct Recording(MemoryVault, Mutex<Vec<String>>);
    impl Vault for Recording {
        fn read(
            &self,
            name: &str,
        ) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, vault::VaultError> {
            self.1.lock().unwrap().push(name.into());
            self.0.read(name)
        }
        fn write(&self, name: &str, value: &[u8]) -> Result<(), vault::VaultError> {
            self.0.write(name, value)
        }
    }
    let vault = Arc::new(Recording(MemoryVault::default(), Mutex::default()));
    let clock = Arc::new(TestClock(AtomicI64::new(100)));
    let api = Arc::new(table_paypal::Client::sandbox(
        Arc::new(OfflineHttp::default()),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    let hello = Arc::new(Hello {
        calls: AtomicUsize::new(0),
        verified: true,
    });
    let mut r = Runtime::new(
        Ledger::in_memory().unwrap(),
        vault.clone(),
        hello,
        api,
        clock,
    )
    .unwrap();
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    vault.1.lock().unwrap().clear();
    r.settings().unwrap();
    assert_eq!(
        *vault.1.lock().unwrap(),
        ["paypal.sandbox", "channel3"],
        "settings reads the two credential entries only"
    );
    vault.1.lock().unwrap().clear();
    r.execute(caller("main", None), Action::Display(deal.id))
        .await
        .unwrap();
    r.mandate_retired(&deal).unwrap();
    r.summary(deal.id).unwrap();
    assert!(
        !vault.1.lock().unwrap().iter().any(|n| n == "owner"),
        "{:?}",
        vault.1.lock().unwrap()
    );
}

/// The fifth run at once is refused with its own reason, for a deal no run is on.
#[test]
fn a_start_past_the_run_limit_says_so() {
    let (mut r, _, _, _, _) = runtime(true);
    let engine = Arc::new(WaitingEngine {
        cancellations: AtomicUsize::new(0),
    });
    r.engines.push((
        engine,
        table_engine::EngineInfo {
            id: table_engine::EngineId::ClaudeCode,
            available: true,
            version: Some("offline-fixture".into()),
            reason: None,
        },
    ));
    r.engine = table_engine::EngineId::ClaudeCode;
    let rt = tokio::runtime::Runtime::new().unwrap();
    let _guard = rt.enter();
    let (server_actor, _) = spawn(runtime(true).0);
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(server_actor.sender.downgrade())),
        8765,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    r.mcp = Some((server, "http://127.0.0.1:8765/mcp".into()));
    let (tx, _rx) = tokio::sync::mpsc::channel(1);
    r.actor_sender = Some(tx.downgrade());
    let deals: Vec<Deal> = (0..5).map(|_| setup(&mut r, Side::Seller).0).collect();
    for deal in &deals[..4] {
        r.start_agent(deal.id).unwrap();
    }
    let error = r.start_agent(deals[4].id).unwrap_err();
    assert_eq!(error.message, crate::engines::RUN_LIMIT);
    drop(tx);
}
