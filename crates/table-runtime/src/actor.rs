use crate::{Decision, Runtime, invalid, unavailable};
use serde::de::DeserializeOwned;
use std::sync::Arc;
use table_client::*;
use table_core::*;
use tokio::sync::{broadcast, mpsc, oneshot};

#[derive(Debug)]
pub enum Action {
    Settings,
    ListDeals,
    Deal(DealId),
    Evidence(DealId),
    Reconcile(ReconcileArgs),
    Attention,
    Summary(DealId),
    ApprovalSelection,
    Display(DealId),
    Transcript(DealId),
    Counterparties,
    CounterpartyNote(DealId),
    Token,
    Select(Option<DealId>),
    SelectPairing(H256),
    OpenApproval(ApprovalOpenArgs),
    ApprovalHandoff,
    AuditPage(AuditPageArgs),
    OwnerFacts,
    BookQuery(BookQueryArgs),
    ApprovalPairing,
    Credentials(crate::vault::CredentialEntry),
    CheckPrivilege,
    ClaimNotification { deal_id: DealId, deadline: i64 },
    ReleaseNotification { deal_id: DealId, deadline: i64 },
    Engine(table_engine::EngineId),
    Engines,
    Start(DealId),
    Runs,
    MarketPrepare(DealId),
    MarketStore(crate::market::MarketBinding, MarketRef),
    Resume,
    Mandates,
    Sign(MandateSignArgs),
    Revoke(MandateRevokeArgs),
    Band(BandArgs),
    PairCreate(PairingCreateArgs),
    HouseOffer(PairingCreateArgs),
    HousePair(table_proto::HouseResponse),
    HouseStatus(HouseState),
    PairJoin(PairingJoinArgs),
    PairPoll(PairingPollArgs),
    PairOffer(PairingPollArgs),
    PairWire(SignedPairingIdentity),
    PairConfirm(PairingConfirmArgs),
    PairAbort(PairingAbortArgs),
    HouseWake,
    Preferences(TumblerPreferences),
    Withdraw(DealId),
    LetLapse(DealId),
    Snooze(DealId),
    Decision(DecisionArgs, Decision),
    Create(DealCreateArgs),
    Join(DealJoinArgs),
    Pause,
    QuitSummary,
    QuitConfirm(QuitArgs),
    Handoff(DealId),
    ExportProof(DealId),
    DealHistory(DealHistoryArgs),
    Simulate(MandateSimulateArgs),
    EnvelopeSign(EnvelopeSignArgs),
    EnvelopeGet,
    RescueReplay(RescueReplayArgs),
    RescueBook,
    GroupOpen(DealGroupOpenArgs),
    Groups,
}
impl Action {
    /// The IPC command this action serves, whose row in the authority table
    /// (`table_client::authority`) gates it before anything else runs. `None` for the shell's
    /// and the runtime's own internal steps, which keep their literal label checks.
    pub fn command(&self) -> Option<&'static str> {
        Some(match self {
            Action::Settings => "get_settings",
            Action::ListDeals => "list_deals",
            Action::Deal(_) => "get_deal",
            Action::Evidence(_) => "deal_evidence",
            Action::Reconcile(_) => "deal_reconcile",
            Action::Attention => "attention_list",
            Action::Summary(_) => "approval_summary",
            Action::ApprovalSelection => "approval_selection",
            Action::Display(_) => "deal_display",
            Action::Transcript(_) => "deal_transcript",
            Action::Counterparties => "counterparty_list",
            Action::CounterpartyNote(_) => "counterparty_note",
            Action::Token => "approval_token",
            Action::OpenApproval(_) => "approval_open",
            Action::ApprovalHandoff => "approval_handoff",
            Action::AuditPage(_) => "audit_page",
            Action::OwnerFacts => "owner_facts",
            Action::BookQuery(_) => "book_query",
            Action::ApprovalPairing => "approval_pairing",
            // set_credentials checks privilege before the OS prompt, then stores the entry.
            Action::Credentials(_) | Action::CheckPrivilege => "set_credentials",
            Action::Engine(_) => "engine_select",
            Action::Engines => "engine_status",
            Action::Start(_) => "agent_start",
            Action::Runs => "agent_runs",
            // market_refresh binds the deal before the lookup and stores the answer after it.
            Action::MarketPrepare(_) | Action::MarketStore(..) => "market_refresh",
            Action::Resume => "resume_all_agents",
            Action::Mandates => "mandate_list",
            Action::Sign(_) => "mandate_sign",
            Action::Revoke(_) => "mandate_revoke",
            Action::Band(_) => "band_set",
            Action::PairCreate(_) => "pairing_create",
            Action::PairJoin(_) => "pairing_join",
            Action::PairPoll(_) | Action::PairOffer(_) => "pairing_poll",
            Action::PairConfirm(_) => "pairing_confirm",
            Action::PairAbort(_) => "pairing_abort",
            Action::HouseWake => "house_wake",
            Action::Preferences(_) => "settings_write",
            Action::Withdraw(_) => "deal_withdraw",
            Action::LetLapse(_) => "deal_let_lapse",
            Action::Snooze(_) => "deal_snooze",
            Action::Decision(_, decision) => decision.name(),
            Action::Create(_) => "deal_create",
            Action::Join(_) => "deal_join",
            Action::Pause => "pause_all_agents",
            Action::QuitSummary => "quit_summary",
            Action::QuitConfirm(_) => "quit_confirm",
            Action::ExportProof(_) => "deal_export_proof",
            Action::DealHistory(_) => "deal_history",
            Action::Simulate(_) => "mandate_simulate",
            Action::EnvelopeSign(_) => "envelope_sign",
            Action::EnvelopeGet => "envelope_get",
            Action::RescueReplay(_) => "rescue_replay",
            Action::RescueBook => "rescue_book",
            Action::GroupOpen(_) => "deal_group_open",
            Action::Groups => "deal_groups",
            Action::Select(_)
            | Action::SelectPairing(_)
            | Action::ClaimNotification { .. }
            | Action::ReleaseNotification { .. }
            | Action::HouseOffer(_)
            | Action::HousePair(_)
            | Action::HouseStatus(_)
            | Action::PairWire(_)
            | Action::Handoff(_) => return None,
        })
    }
    /// The deal an action names, for the table's selected-deal column.
    pub(crate) fn deal(&self) -> Option<DealId> {
        match self {
            Action::Deal(id)
            | Action::Evidence(id)
            | Action::Summary(id)
            | Action::Display(id)
            | Action::Transcript(id)
            | Action::CounterpartyNote(id)
            | Action::Start(id)
            | Action::MarketPrepare(id)
            | Action::Withdraw(id)
            | Action::LetLapse(id)
            | Action::Snooze(id)
            | Action::Handoff(id)
            | Action::ExportProof(id) => Some(*id),
            Action::Reconcile(args) => Some(args.deal_id),
            Action::Band(args) => Some(args.deal_id),
            Action::MarketStore(binding, _) => Some(binding.deal_id),
            Action::Decision(args, _) => Some(args.deal_id),
            Action::Join(args) => Some(args.deal_id),
            _ => None,
        }
    }
}
pub struct Caller {
    pub label: String,
    pub token: Option<String>,
}
impl std::fmt::Debug for Caller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Caller")
            .field("label", &self.label)
            .finish_non_exhaustive()
    }
}
pub(crate) enum Message {
    RelayFinished(Vec<crate::relay::Delivery>),
    WitnessFinished(Box<crate::witness::WitnessFetch>),
    Agent(
        RunId,
        table_app::AgentScope,
        table_app::AgentRequest,
        oneshot::Sender<Result<serde_json::Value, table_app::Error>>,
    ),
    AgentRefused(
        table_app::AgentScope,
        String,
        table_core::RefusalCode,
        oneshot::Sender<Result<(), table_app::Error>>,
    ),
    Engine(RunId, table_engine::EngineEvent),
    EngineFinished(
        RunId,
        Result<table_engine::TerminalVerdict, table_engine::Error>,
    ),
    AttachMcp(Arc<table_mcp::Server>, String),
    Execute(
        Caller,
        Box<Action>,
        oneshot::Sender<Result<serde_json::Value, CommandError>>,
    ),
    BeginUnlock(Caller, oneshot::Sender<Result<u64, CommandError>>),
    FinishUnlock(
        Caller,
        u64,
        VerifiedReauth,
        oneshot::Sender<Result<(), CommandError>>,
    ),
    /// A market-watch price check's answer, fetched outside the actor (T15).
    MarketWatched(
        Box<crate::market_watch::WatchJob>,
        Result<MarketRef, table_market::Error>,
    ),
}
/// Created only after the injected OS verifier succeeds, and never deserializable.
pub(crate) struct VerifiedReauth;
impl table_app::NativeReauth for VerifiedReauth {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
#[derive(Debug, Clone)]
pub enum WalletEvent {
    Agent(RunSnapshot),
    Settings(SettingsSnapshot),
    Attention(table_attention::AttentionSnapshot),
    Deal(Box<DealChanged>),
    Receipt(ReceiptEvent),
    Fault(CommandError),
    Pinned(PairingPinned),
}
#[derive(Clone)]
pub struct ActorHandle {
    pub(crate) sender: mpsc::Sender<Message>,
    reauth: Arc<dyn crate::reauth::OsReauth>,
    pub(crate) market: Option<Arc<dyn table_market::MarketApi>>,
    pub(crate) relay: Option<Arc<dyn table_relay::RelayApi>>,
    pub(crate) pairing_jobs: Arc<tokio::sync::Semaphore>,
    pub(crate) house_jobs: Arc<tokio::sync::Semaphore>,
}
impl std::fmt::Debug for ActorHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ActorHandle")
    }
}
impl ActorHandle {
    pub async fn set_credentials(
        &self,
        caller: Caller,
        provider: CredentialArgs,
        window: isize,
        prompt: &dyn crate::credentials::CredentialPrompt,
    ) -> Result<(), CommandError> {
        self.execute::<()>(
            Caller {
                label: caller.label.clone(),
                token: caller.token.clone(),
            },
            Action::CheckPrivilege,
        )
        .await?;
        let entry = prompt.prompt(provider, window).await?;
        self.execute(caller, Action::Credentials(entry)).await
    }
    pub async fn execute<T: DeserializeOwned>(
        &self,
        caller: Caller,
        action: Action,
    ) -> Result<T, CommandError> {
        // Pairing IO belongs to this caller future, outside the serialized actor.
        let value = match action {
            Action::PairCreate(args) => {
                serde_json::to_value(self.relay_pairing_create(caller, args).await?)
            }
            Action::PairJoin(args) => {
                serde_json::to_value(self.relay_pairing_join(caller, args).await?)
            }
            Action::PairPoll(args) => {
                serde_json::to_value(self.relay_pairing_poll(caller, args).await?)
            }
            Action::HouseWake => serde_json::to_value(self.house_wake(caller).await?),
            other => return self.execute_local(caller, other).await,
        }
        .map_err(|_| invalid())?;
        serde_json::from_value(value).map_err(|_| invalid())
    }
    pub(crate) async fn execute_local<T: DeserializeOwned>(
        &self,
        caller: Caller,
        action: Action,
    ) -> Result<T, CommandError> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(Message::Execute(caller, Box::new(action), tx))
            .await
            .map_err(|_| unavailable("Wallet actor stopped"))?;
        serde_json::from_value(
            rx.await
                .map_err(|_| unavailable("Wallet actor stopped"))??,
        )
        .map_err(|_| invalid())
    }
    pub async fn unlock(&self, caller: Caller, window: isize) -> Result<(), CommandError> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(Message::BeginUnlock(
                Caller {
                    label: caller.label.clone(),
                    token: caller.token.clone(),
                },
                tx,
            ))
            .await
            .map_err(|_| unavailable("Wallet actor stopped"))?;
        let generation = rx
            .await
            .map_err(|_| unavailable("Wallet actor stopped"))??;
        // The OS prompt is outside the actor, so pending re-auth cannot stall deadline defaults.
        self.reauth.authenticate(window).await?;
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(Message::FinishUnlock(
                caller,
                generation,
                VerifiedReauth,
                tx,
            ))
            .await
            .map_err(|_| unavailable("Wallet actor stopped"))?;
        rx.await.map_err(|_| unavailable("Wallet actor stopped"))?
    }
}
pub fn spawn(mut runtime: Runtime) -> (ActorHandle, broadcast::Receiver<WalletEvent>) {
    let (sender, receiver) = mpsc::channel(64);
    let (events, listen) = broadcast::channel(128);
    runtime.actor_sender = Some(sender.downgrade());
    let handle = ActorHandle {
        sender,
        reauth: runtime.reauth.clone(),
        market: runtime.market.clone(),
        relay: runtime.relay.clone(),
        pairing_jobs: Arc::new(tokio::sync::Semaphore::new(4)),
        house_jobs: Arc::new(tokio::sync::Semaphore::new(1)),
    };
    tokio::spawn(run(runtime, receiver, events));
    (handle, listen)
}
/// Desktop-only network attachment. Tests use `spawn` and in-process MCP routers.
pub async fn spawn_networked(
    runtime: Runtime,
) -> Result<(ActorHandle, broadcast::Receiver<WalletEvent>), CommandError> {
    let clock = runtime.clock.clone();
    let listener = table_mcp::Server::bind()
        .await
        .map_err(|_| unavailable("Loopback MCP bind failed"))?;
    let port = listener
        .local_addr()
        .map_err(|_| unavailable("Loopback address unavailable"))?
        .port();
    let (handle, events) = spawn(runtime);
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(handle.sender.downgrade())),
        port,
        clock,
    )?;
    handle
        .sender
        .send(Message::AttachMcp(
            server.clone(),
            format!("http://127.0.0.1:{port}/mcp"),
        ))
        .await
        .map_err(|_| unavailable("Wallet actor stopped"))?;
    let sender = handle.sender.downgrade();
    tokio::spawn(async move {
        let serving = axum::serve(listener, server.router()).with_graceful_shutdown(async move {
            loop {
                if sender.upgrade().is_none() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
        });
        let _ = serving.await;
    });
    Ok((handle, events))
}

async fn run(
    mut runtime: Runtime,
    mut receiver: mpsc::Receiver<Message>,
    events: broadcast::Sender<WalletEvent>,
) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut previous = Vec::<Deal>::new();
    let mut attention = None;
    let mut attention_faulted = false;
    let mut settings_previous = None;
    let mut runs_previous = Vec::<RunSnapshot>::new();
    loop {
        tokio::select! {
            message=receiver.recv()=>match message{
                Some(Message::Execute(caller,action,reply))=>{let _=reply.send(runtime.execute(caller,*action).await); for event in runtime.emitted.drain(..){let _=events.send(event);}},
                Some(Message::BeginUnlock(caller,reply))=>{let _=reply.send(if table_client::authority::admits("unlock",&caller.label){runtime.pipeline.approval.begin_unlock(&caller.label,caller.token.as_deref().unwrap_or("")).map_err(Into::into)}else{Err(crate::permission())});},
                Some(Message::FinishUnlock(caller,generation,proof,reply))=>{let _=reply.send(runtime.pipeline.approval.finish_unlock(&caller.label,caller.token.as_deref().unwrap_or(""),generation,&proof,runtime.clock.now()).map_err(Into::into));},
                Some(Message::AttachMcp(server,url))=>{runtime.mcp=Some((server,url));},
                Some(Message::RelayFinished(deliveries))=>{if let Err(error)=runtime.relay_finished(deliveries){let _=events.send(WalletEvent::Fault(error));}},
                Some(Message::WitnessFinished(fetch))=>{if let Err(error)=runtime.witness_finished(*fetch){let _=events.send(WalletEvent::Fault(error));}},
                Some(Message::Agent(run,scope,request,reply))=>{let _=reply.send(runtime.agent_intent(run,&scope,request));},
                Some(Message::AgentRefused(scope,tool,code,reply))=>{let now=runtime.clock.now(); let _=reply.send(table_app::AgentService::record_refusal(&mut runtime.pipeline.wallet,&scope,&tool,code,now));},
                Some(Message::Engine(run,event))=>{match runtime.engine_event(run,event){Ok(Some(snapshot))=>{let _=events.send(WalletEvent::Agent(snapshot));},Ok(None)=>{},Err(error)=>{let _=runtime.finish_run(run,RunState::Failed); let _=events.send(WalletEvent::Fault(error));}}},
                Some(Message::EngineFinished(run,result))=>{let state=if matches!(result,Ok(table_engine::TerminalVerdict::Clean)){RunState::Clean}else{RunState::Failed}; match runtime.finish_run(run,state){Ok(Some(snapshot))=>{let _=events.send(WalletEvent::Agent(snapshot));},Ok(None)=>{},Err(error)=>{let _=events.send(WalletEvent::Fault(error));}}},
                Some(Message::MarketWatched(job,result))=>{if let Err(error)=runtime.market_watched(*job,result){let _=events.send(WalletEvent::Fault(error));}},
                None=>break,
            },
            _=interval.tick()=>{
                if let Err(error)=runtime.start_relay(){let _=events.send(WalletEvent::Fault(error));}
                if let Err(error)=runtime.start_witness(){let _=events.send(WalletEvent::Fault(error));}
                if let Err(error)=runtime.tick().await{let _=events.send(WalletEvent::Fault(error));}
            },
        }
        if let Ok(deals) = runtime.pipeline.wallet.ledger.list_deals() {
            for deal in &deals {
                let old = previous.iter().find(|d| d.id == deal.id);
                if old.and_then(|d| serde_json::to_string(d).ok())
                    != serde_json::to_string(deal).ok()
                {
                    let _ = events.send(WalletEvent::Deal(Box::new(DealChanged {
                        deal: deal.clone(),
                        mode: deal.mode,
                    })));
                    if old.is_some_and(|d| d.state != deal.state)
                        && (deal.state.terminal() || deal.state == DealState::Receipted)
                    {
                        let _ = events.send(WalletEvent::Receipt(ReceiptEvent {
                            deal_id: deal.id,
                            evidence: match runtime.pipeline.wallet.ledger.deal_evidence(deal.id) {
                                Ok(e) => e,
                                Err(_) => continue,
                            },
                            mode: deal.mode,
                            state: deal.state,
                            on_silence: match deal.state {
                                DealState::Receipted
                                    if deal.side == Side::Buyer
                                        && deal.kind != DealKind::Purchase =>
                                {
                                    "Seller attested payment; PayPal reporting is pending"
                                }
                                DealState::Receipted => "Payment captured and receipt verified",
                                DealState::Withdrawn
                                | DealState::Expired
                                | DealState::Voided
                                | DealState::AutoVoided => {
                                    "Deadline or safe decision completed; no capture was made"
                                }
                                _ => "Verified ledger status updated",
                            }
                            .into(),
                        }));
                    }
                }
            }
            previous = deals;
        }
        if let Some(event) =
            attention_event(runtime.attention(), &mut attention, &mut attention_faulted)
        {
            let _ = events.send(event);
        }
        if let Ok(settings) = runtime.settings()
            && let Ok(encoded) = serde_json::to_string(&settings)
            && settings_previous.as_ref() != Some(&encoded)
        {
            settings_previous = Some(encoded);
            let _ = events.send(WalletEvent::Settings(settings));
        }
        let snapshots = runtime.run_snapshots();
        for snapshot in &snapshots {
            if !runs_previous
                .iter()
                .any(|old| old.run == snapshot.run && old.state == snapshot.state)
            {
                let _ = events.send(WalletEvent::Agent(snapshot.clone()));
            }
        }
        runs_previous = snapshots;
    }
    let _ = runtime.cancel_runs();
}

/// What the 1 s tick publishes for one `attention()` read. A failed read is a visible `Fault`
/// once per failure streak, and drops the cached snapshot so the first good read after it is
/// published even if it equals the stack the Tumbler held before the failure.
pub(crate) fn attention_event(
    read: Result<table_attention::AttentionSnapshot, CommandError>,
    cache: &mut Option<String>,
    faulted: &mut bool,
) -> Option<WalletEvent> {
    match read {
        Err(error) => {
            *cache = None;
            if std::mem::replace(faulted, true) {
                None
            } else {
                Some(WalletEvent::Fault(error))
            }
        }
        Ok(snapshot) => {
            *faulted = false;
            let encoded = serde_json::to_string(&snapshot).ok()?;
            if cache.as_ref() == Some(&encoded) {
                return None;
            }
            *cache = Some(encoded);
            Some(WalletEvent::Attention(snapshot))
        }
    }
}
