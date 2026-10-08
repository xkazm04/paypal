//! T11 conformance: every IPC command, called the way the shell calls the runtime, from every
//! window label, locked and unlocked, with no / a wrong / the approval token, and (where the row
//! binds one) on the selected deal and on another deal. The runtime's answer must be exactly what
//! the authority table says: PERMISSION, LOCKED, or admitted (anything else). Offline: no cell may
//! reach PayPal.
use super::*;
use table_client::authority::{AUTHORITY, CommandAuthority, Enforcer, Selection};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Outcome {
    Permission,
    Locked,
    Admitted,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Token {
    None,
    Wrong,
    Valid,
}
/// What the table says one cell must answer.
fn expected(
    a: &CommandAuthority,
    label: &str,
    token: Token,
    locked: bool,
    on_selected: bool,
) -> Outcome {
    if !a.admits(label) || (a.token && token != Token::Valid) {
        return Outcome::Permission;
    }
    if a.unlock && locked {
        return Outcome::Locked;
    }
    let bound = match a.selection {
        Selection::Required => true,
        Selection::InApproval => label == "approval",
        Selection::None | Selection::PairingInApproval => false,
    };
    if bound && !on_selected {
        return Outcome::Permission;
    }
    Outcome::Admitted
}
fn outcome(result: &Result<(), CommandError>) -> Outcome {
    match result {
        Err(CommandError {
            code: ErrorCode::Permission,
            ..
        }) => Outcome::Permission,
        Err(CommandError {
            code: ErrorCode::Locked,
            ..
        }) => Outcome::Locked,
        _ => Outcome::Admitted,
    }
}

/// Commands whose gate (or part of it) runs in the actor handle, outside `Runtime::execute`:
/// they are called through a spawned actor. Every other command is called on
/// `Runtime::execute` directly, the function the actor runs for each shell message, which keeps
/// the matrix fast (no per-message attention fold, no ticks).
const ACTOR_LEVEL: [&str; 7] = [
    "unlock",
    "set_credentials",
    "market_refresh",
    "pairing_create",
    "pairing_join",
    "pairing_poll",
    "house_wake",
];
enum Wallet {
    Direct(Box<Runtime>),
    Actor(ActorHandle),
}
struct Fixture {
    wallet: Wallet,
    clock: Arc<TestClock>,
    http: Arc<OfflineHttp>,
    token: String,
    selected: Deal,
    other: Deal,
    preferences: TumblerPreferences,
}
impl Fixture {
    async fn new(through_actor: bool) -> Self {
        let (mut r, _, http, clock, _) = runtime(true);
        let (other, _) = setup(&mut r, Side::Buyer);
        let (selected, _) = setup(&mut r, Side::Buyer);
        r.selected = Some(selected.id);
        let preferences = r.preferences.clone();
        let token = r.pipeline.approval.token("approval").unwrap().to_owned();
        let wallet = if through_actor {
            Wallet::Actor(spawn(r).0)
        } else {
            Wallet::Direct(Box::new(r))
        };
        Self {
            wallet,
            clock,
            http,
            token,
            selected,
            other,
            preferences,
        }
    }
    async fn set_locked(&mut self, locked: bool) {
        if locked {
            // Past the 15-minute idle lock from the last privileged act.
            self.clock.0.fetch_add(901, Ordering::SeqCst);
        }
        let now = self.clock.now();
        let is_locked = match &mut self.wallet {
            Wallet::Direct(r) => {
                if !locked {
                    unlock_runtime(r);
                }
                r.pipeline.approval.locked(now)
            }
            Wallet::Actor(actor) => {
                if !locked {
                    actor
                        .unlock(caller("approval", Some(&self.token)), 0)
                        .await
                        .unwrap();
                }
                actor
                    .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
                    .await
                    .unwrap()
                    .locked
            }
        };
        assert_eq!(is_locked, locked);
    }
    async fn exec(&mut self, c: &Caller, action: Action) -> Result<Value, CommandError> {
        let c = Caller {
            label: c.label.clone(),
            token: c.token.clone(),
        };
        match &mut self.wallet {
            Wallet::Direct(r) => r.execute(c, action).await,
            Wallet::Actor(actor) => actor.execute(c, action).await,
        }
    }
    fn actor(&self) -> &ActorHandle {
        match &self.wallet {
            Wallet::Actor(actor) => actor,
            Wallet::Direct(_) => panic!("this command is called through the actor"),
        }
    }
    fn caller(&self, label: &str, token: Token) -> Caller {
        caller(
            label,
            match token {
                Token::None => None,
                Token::Wrong => Some("not-the-approval-token"),
                Token::Valid => Some(&self.token),
            },
        )
    }
    /// The command as the shell's handler sends it to the runtime, with plausible arguments.
    async fn call(
        &mut self,
        command: &str,
        c: Caller,
        on_selected: bool,
    ) -> Result<(), CommandError> {
        let deal = if on_selected {
            self.selected.clone()
        } else {
            self.other.clone()
        };
        let (other_id, other_mandate) = (self.other.id, self.other.mandate_id);
        let id = deal.id;
        let money = |minor| Money::new(minor, Currency::USD).unwrap();
        let mandate = MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1_000_000,
        };
        let create = DealCreateArgs {
            kind: DealKind::Haggle,
            side: Side::Buyer,
            counterparty: deal.counterparty.clone(),
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            category: Category::Parts,
            terms: deal.terms.clone(),
        };
        let decision = DecisionArgs {
            counter_hash: None,
            deal_id: id,
            attempt: 1,
            terms_hash: H256::ZERO,
            checks_hash: None,
        };
        let payee = PayeeRef::new("merchant").unwrap();
        let preferences = self.preferences.clone();
        let value = match command {
            "deal_snooze" => self.exec(&c, Action::Snooze(id)).await,
            "approval_selection" => self.exec(&c, Action::ApprovalSelection).await,
            "deal_display" => self.exec(&c, Action::Display(id)).await,
            "deal_transcript" => self.exec(&c, Action::Transcript(id)).await,
            "counterparty_list" => self.exec(&c, Action::Counterparties).await,
            "approval_pairing" => self.exec(&c, Action::ApprovalPairing).await,
            "deal_owner_accept" => {
                self.exec(&c, Action::Decision(decision, Decision::OwnerAccept))
                    .await
            }
            "get_settings" => self.exec(&c, Action::Settings).await,
            "list_deals" => self.exec(&c, Action::ListDeals).await,
            "get_deal" => self.exec(&c, Action::Deal(id)).await,
            "deal_evidence" => self.exec(&c, Action::Evidence(id)).await,
            "deal_reconcile" => {
                self.exec(
                    &c,
                    Action::Reconcile(ReconcileArgs {
                        deal_id: id,
                        start: 0,
                        end: 100,
                    }),
                )
                .await
            }
            "engine_status" => self.exec(&c, Action::Engines).await,
            "attention_list" => self.exec(&c, Action::Attention).await,
            "approval_open" => {
                self.exec(
                    &c,
                    Action::OpenApproval(ApprovalOpenArgs {
                        deal_id: Some(id),
                        pairing: None,
                        target: None,
                        draft: None,
                    }),
                )
                .await
            }
            "approval_summary" => self.exec(&c, Action::Summary(id)).await,
            "approval_token" => self.exec(&c, Action::Token).await,
            "deal_withdraw" => self.exec(&c, Action::Withdraw(id)).await,
            "deal_let_lapse" => self.exec(&c, Action::LetLapse(id)).await,
            "unlock" => return self.actor().unlock(c, 0).await,
            "deal_countersign" => {
                self.exec(&c, Action::Decision(decision, Decision::Countersign))
                    .await
            }
            "deal_capture" => {
                self.exec(&c, Action::Decision(decision, Decision::Capture))
                    .await
            }
            "deal_void" => {
                self.exec(&c, Action::Decision(decision, Decision::Void))
                    .await
            }
            "shield_release" => {
                self.exec(&c, Action::Decision(decision, Decision::ReleaseHold))
                    .await
            }
            "rescue_approve" => {
                self.exec(&c, Action::Decision(decision, Decision::Rescue))
                    .await
            }
            "open_paypal_in_browser" => {
                self.exec(&c, Action::Decision(decision, Decision::OpenBrowser))
                    .await
            }
            "set_credentials" => {
                return self
                    .actor()
                    .set_credentials(
                        c,
                        CredentialArgs::PaypalSandbox,
                        0,
                        &credentials::UnsupportedCredentialPrompt,
                    )
                    .await;
            }
            "engine_select" => {
                self.exec(&c, Action::Engine(table_engine::EngineId::CodexCli))
                    .await
            }
            "mandate_list" => self.exec(&c, Action::Mandates).await,
            "mandate_sign" => self.exec(&c, Action::Sign(mandate)).await,
            "mandate_revoke" => {
                self.exec(&c, Action::Revoke(MandateRevokeArgs { id: other_mandate }))
                    .await
            }
            "band_set" => {
                self.exec(
                    &c,
                    Action::Band(BandArgs {
                        deal_id: id,
                        floor: None,
                        ceiling: None,
                    }),
                )
                .await
            }
            "pairing_create" => {
                self.exec(
                    &c,
                    Action::PairCreate(PairingCreateArgs {
                        side: Side::Seller,
                        payee,
                    }),
                )
                .await
            }
            "pairing_join" => {
                self.exec(
                    &c,
                    Action::PairJoin(PairingJoinArgs {
                        code: "TBL-not-a-code".into(),
                        peer: None,
                        side: Side::Buyer,
                        payee,
                    }),
                )
                .await
            }
            "pairing_poll" => {
                self.exec(
                    &c,
                    Action::PairPoll(PairingPollArgs {
                        code: "TBL-not-a-code".into(),
                    }),
                )
                .await
            }
            "pairing_confirm" => {
                self.exec(
                    &c,
                    Action::PairConfirm(PairingConfirmArgs {
                        pairing_id: H256::ZERO,
                        words: ["a".into(), "b".into(), "c".into(), "d".into()],
                        display_name: "Peer".into(),
                    }),
                )
                .await
            }
            "settings_write" => self.exec(&c, Action::Preferences(preferences)).await,
            "deal_create" => self.exec(&c, Action::Create(create)).await,
            "deal_join" => {
                self.exec(
                    &c,
                    Action::Join(DealJoinArgs {
                        deal_id: other_id,
                        create,
                    }),
                )
                .await
            }
            "pause_all_agents" => self.exec(&c, Action::Pause).await,
            "resume_all_agents" => self.exec(&c, Action::Resume).await,
            "agent_start" => self.exec(&c, Action::Start(id)).await,
            "agent_runs" => self.exec(&c, Action::Runs).await,
            "market_refresh" => {
                return self
                    .actor()
                    .market_refresh(
                        c,
                        MarketRefreshArgs {
                            deal_id: id,
                            product_id: "product-1".into(),
                        },
                    )
                    .await
                    .map(|_| ());
            }
            "quit_summary" => self.exec(&c, Action::QuitSummary).await,
            "quit_confirm" => {
                self.exec(
                    &c,
                    Action::QuitConfirm(QuitArgs {
                        confirmation_id: H256::ZERO,
                    }),
                )
                .await
            }
            "counterparty_note" => self.exec(&c, Action::CounterpartyNote(id)).await,
            "pairing_abort" => {
                self.exec(
                    &c,
                    Action::PairAbort(PairingAbortArgs {
                        pairing_id: None,
                        code: None,
                    }),
                )
                .await
            }
            "house_wake" => self.exec(&c, Action::HouseWake).await,
            "approval_handoff" => self.exec(&c, Action::ApprovalHandoff).await,
            "audit_page" => {
                self.exec(
                    &c,
                    Action::AuditPage(AuditPageArgs {
                        before: None,
                        limit: 5,
                    }),
                )
                .await
            }
            "owner_facts" => self.exec(&c, Action::OwnerFacts).await,
            "book_query" => {
                self.exec(&c, Action::BookQuery(BookQueryArgs { query: json!({}) }))
                    .await
            }
            "deal_export_proof" => self.exec(&c, Action::ExportProof(id)).await,
            "deal_history" => {
                self.exec(&c, Action::DealHistory(DealHistoryArgs::default()))
                    .await
            }
            "mandate_simulate" => {
                self.exec(
                    &c,
                    Action::Simulate(MandateSimulateArgs {
                        draft: mandate,
                        from: None,
                        to: None,
                    }),
                )
                .await
            }
            "envelope_sign" => {
                self.exec(
                    &c,
                    Action::EnvelopeSign(EnvelopeSignArgs {
                        currency: Currency::USD,
                        max_out_day: money(50_000),
                        max_held: money(30_000),
                        max_deals_day: 4,
                        expires: 500_000,
                    }),
                )
                .await
            }
            "envelope_get" => self.exec(&c, Action::EnvelopeGet).await,
            "rescue_replay" => {
                self.exec(
                    &c,
                    Action::RescueReplay(RescueReplayArgs {
                        subscription_id: "I-NOT-A-SUBSCRIPTION".into(),
                        subscriber_email: "not an email".into(),
                        plan: ItemRef::new("plan").unwrap(),
                        amount: money(900),
                    }),
                )
                .await
            }
            "rescue_book" => self.exec(&c, Action::RescueBook).await,
            "deal_group_open" => {
                self.exec(
                    &c,
                    Action::GroupOpen(DealGroupOpenArgs {
                        deal_ids: vec![id, other_id],
                    }),
                )
                .await
            }
            "deal_groups" => self.exec(&c, Action::Groups).await,
            "rescue_watch_add" => {
                self.exec(
                    &c,
                    Action::RescueWatchAdd(RescueWatchArgs {
                        subscription_id: "I-NOT-A-SUBSCRIPTION".into(),
                        subscriber_email: "not an email".into(),
                        plan: ItemRef::new("plan").unwrap(),
                    }),
                )
                .await
            }
            "rescue_watch_stop" => {
                self.exec(
                    &c,
                    Action::RescueWatchStop(RescueWatchStopArgs {
                        subscription_id: "I-NOT-WATCHED".into(),
                    }),
                )
                .await
            }
            other => panic!("no conformance call for {other}: add it here when adding the row"),
        };
        value.map(|_| ())
    }
}

/// The shell answers these itself (window surface), checking the label against the table; the
/// runtime never sees them. Pinned here so a new shell-only row is a deliberate choice.
const SHELL_ONLY: [&str; 6] = [
    "main_open",
    "tumbler_set_form",
    "tumbler_pin",
    "tumbler_drag",
    "tumbler_snap",
    "proof_check",
];

/// One command's cells against a fresh wallet (an admitted call may change state: pause,
/// withdraw, sign). Returns the cell count and every disagreement with the table.
async fn command_matrix(a: &'static CommandAuthority) -> (usize, Vec<String>) {
    let mut fx = Fixture::new(ACTOR_LEVEL.contains(&a.name)).await;
    let mut cells = 0;
    let mut mismatches = Vec::new();
    // A token is only worth varying three ways where the row asks for one.
    let tokens: &[Token] = if a.token {
        &[Token::None, Token::Wrong, Token::Valid]
    } else {
        &[Token::None, Token::Valid]
    };
    for locked in [true, false] {
        fx.set_locked(locked).await;
        // A label the shell never assigns is refused for every command.
        let labels: &[&str] = if locked {
            &["main", "tumbler", "approval", "devtools"]
        } else {
            &["main", "tumbler", "approval"]
        };
        for &label in labels {
            for &token in tokens {
                let bound = a.selection == Selection::Required
                    || (a.selection == Selection::InApproval && label == "approval");
                for on_selected in if bound { vec![true, false] } else { vec![true] } {
                    let result = fx.call(a.name, fx.caller(label, token), on_selected).await;
                    let got = outcome(&result);
                    let want = expected(a, label, token, locked, on_selected);
                    cells += 1;
                    if got != want {
                        mismatches.push(format!(
                            "{} from {label} ({token:?} token, {}, {}): got {got:?} {result:?}, table says {want:?}",
                            a.name,
                            if locked { "locked" } else { "unlocked" },
                            if on_selected { "selected deal" } else { "another deal" },
                        ));
                    }
                    if locked && got == Outcome::Admitted && a.name == "unlock" {
                        fx.set_locked(true).await;
                    }
                }
            }
        }
        // Nothing in the phase changed the lock behind the matrix's back.
        let now = fx.clock.now();
        let still = match &mut fx.wallet {
            Wallet::Direct(r) => r.pipeline.approval.locked(now),
            Wallet::Actor(actor) => {
                actor
                    .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
                    .await
                    .unwrap()
                    .locked
            }
        };
        assert_eq!(still, locked, "{}", a.name);
    }
    assert!(
        fx.http.0.lock().unwrap().paths.is_empty(),
        "{} reached PayPal during the matrix",
        a.name
    );
    (cells, mismatches)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn every_command_answers_label_lock_and_token_exactly_as_the_authority_table_says() {
    let shell: Vec<&str> = AUTHORITY
        .iter()
        .filter(|a| a.enforcer == Enforcer::Shell)
        .map(|a| a.name)
        .collect();
    assert_eq!(shell, SHELL_ONLY);
    let mut jobs = tokio::task::JoinSet::new();
    for a in AUTHORITY.iter().filter(|a| a.enforcer == Enforcer::Runtime) {
        jobs.spawn(command_matrix(a));
    }
    let mut cells = 0;
    let mut mismatches = Vec::new();
    while let Some(done) = jobs.join_next().await {
        let (n, mut m) = done.unwrap();
        cells += n;
        mismatches.append(&mut m);
    }
    mismatches.sort();
    assert!(mismatches.is_empty(), "{}", mismatches.join("\n"));
    assert!(cells > 700, "{cells}");
}

#[test]
fn every_action_names_a_command_in_the_table_or_is_internal() {
    // Every runtime-enforced row is reached by at least one action (the matrix above calls each),
    // and an action's command is always a table row.
    for a in AUTHORITY {
        assert!(table_client::authority::authority(a.name).is_some());
    }
    let id = setup(&mut runtime(true).0, Side::Buyer).0.id;
    for action in [
        Action::Settings,
        Action::Deal(id),
        Action::Decision(
            DecisionArgs {
                counter_hash: None,
                deal_id: id,
                attempt: 1,
                terms_hash: H256::ZERO,
                checks_hash: None,
            },
            Decision::Capture,
        ),
        Action::CheckPrivilege,
        Action::HouseWake,
    ] {
        let command = action.command().unwrap();
        assert!(
            table_client::authority::authority(command).is_some(),
            "{command}"
        );
    }
    assert!(Action::Handoff(id).command().is_none());
    assert!(Action::Select(Some(id)).command().is_none());
}

#[tokio::test]
async fn the_settings_snapshot_carries_the_manifest_fingerprint() {
    let (r, _, _, _, _) = runtime(true);
    let (actor, _) = spawn(r);
    for label in ["main", "tumbler", "approval"] {
        let settings: SettingsSnapshot = actor
            .execute(caller(label, None), Action::Settings)
            .await
            .unwrap();
        assert_eq!(
            settings.authority_manifest,
            table_client::authority::manifest().unwrap().hex()
        );
        assert_eq!(settings.authority_manifest.len(), 64);
    }
}
