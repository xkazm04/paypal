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
    Agent(
        RunId,
        table_app::AgentScope,
        table_app::AgentRequest,
        oneshot::Sender<Result<serde_json::Value, table_app::Error>>,
    ),
    AgentRefused(
        table_app::AgentScope,
        String,
        String,
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
                Some(Message::BeginUnlock(caller,reply))=>{let _=reply.send(runtime.pipeline.approval.begin_unlock(&caller.label,caller.token.as_deref().unwrap_or("")).map_err(Into::into));},
                Some(Message::FinishUnlock(caller,generation,proof,reply))=>{let _=reply.send(runtime.pipeline.approval.finish_unlock(&caller.label,caller.token.as_deref().unwrap_or(""),generation,&proof,runtime.clock.now()).map_err(Into::into));},
                Some(Message::AttachMcp(server,url))=>{runtime.mcp=Some((server,url));},
                Some(Message::RelayFinished(deliveries))=>{if let Err(error)=runtime.relay_finished(deliveries){let _=events.send(WalletEvent::Fault(error));}},
                Some(Message::Agent(run,scope,request,reply))=>{let _=reply.send(runtime.agent_intent(run,&scope,request));},
                Some(Message::AgentRefused(scope,tool,reason,reply))=>{let now=runtime.clock.now(); let _=reply.send(table_app::AgentService::record_refusal(&mut runtime.pipeline.wallet,&scope,&tool,&reason,now));},
                Some(Message::Engine(run,event))=>{match runtime.engine_event(run,event){Ok(Some(snapshot))=>{let _=events.send(WalletEvent::Agent(snapshot));},Ok(None)=>{},Err(error)=>{let _=runtime.finish_run(run,RunState::Failed); let _=events.send(WalletEvent::Fault(error));}}},
                Some(Message::EngineFinished(run,result))=>{let state=if matches!(result,Ok(table_engine::TerminalVerdict::Clean)){RunState::Clean}else{RunState::Failed}; match runtime.finish_run(run,state){Ok(Some(snapshot))=>{let _=events.send(WalletEvent::Agent(snapshot));},Ok(None)=>{},Err(error)=>{let _=events.send(WalletEvent::Fault(error));}}},
                None=>break,
            },
            _=interval.tick()=>{
                if let Err(error)=runtime.start_relay(){let _=events.send(WalletEvent::Fault(error));}
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
