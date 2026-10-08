use super::*;
#[tauri::command]
pub(super) async fn deal_snooze(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::Snooze(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn approval_selection(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Option<DealId>, CommandError> {
    ask(&window, &state, None, Action::ApprovalSelection).await
}
#[tauri::command]
pub(super) async fn deal_display(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<DealDisplay, CommandError> {
    ask(&window, &state, None, Action::Display(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn deal_transcript(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<Vec<TranscriptStep>, CommandError> {
    ask(&window, &state, None, Action::Transcript(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn counterparty_list(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<CounterpartyDisplay>, CommandError> {
    ask(&window, &state, None, Action::Counterparties).await
}
#[tauri::command]
pub(super) async fn counterparty_note(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<Option<CounterpartyNote>, CommandError> {
    ask(
        &window,
        &state,
        None,
        Action::CounterpartyNote(args.deal_id),
    )
    .await
}
#[tauri::command]
pub(super) async fn pairing_abort(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: PairingAbortArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::PairAbort(args)).await
}
#[tauri::command]
pub(super) async fn house_wake(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<HouseState, CommandError> {
    ask(&window, &state, None, Action::HouseWake).await
}
#[tauri::command]
pub(super) async fn approval_handoff(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<ApprovalHandoff, CommandError> {
    ask(&window, &state, None, Action::ApprovalHandoff).await
}
#[tauri::command]
pub(super) async fn audit_page(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: AuditPageArgs,
) -> Result<AuditPage, CommandError> {
    ask(&window, &state, None, Action::AuditPage(args)).await
}
#[tauri::command]
pub(super) async fn deal_history(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealHistoryArgs,
) -> Result<DealHistory, CommandError> {
    ask(&window, &state, None, Action::DealHistory(args)).await
}
#[tauri::command]
pub(super) async fn owner_facts(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<OwnerFacts, CommandError> {
    ask(&window, &state, None, Action::OwnerFacts).await
}
#[tauri::command]
pub(super) async fn book_query(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: BookQueryArgs,
) -> Result<BookAnswer, CommandError> {
    ask(&window, &state, None, Action::BookQuery(args)).await
}
#[tauri::command]
pub(super) async fn approval_pairing(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Option<PendingPairing>, CommandError> {
    ask(&window, &state, None, Action::ApprovalPairing).await
}
#[tauri::command]
pub(super) async fn deal_owner_accept(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::OwnerAccept),
    )
    .await
}
#[tauri::command]
pub(super) async fn get_settings(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<SettingsSnapshot, CommandError> {
    ask(&window, &state, None, Action::Settings).await
}
#[tauri::command]
pub(super) async fn list_deals(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<Deal>, CommandError> {
    ask(&window, &state, None, Action::ListDeals).await
}
#[tauri::command]
pub(super) async fn get_deal(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<Deal, CommandError> {
    ask(&window, &state, None, Action::Deal(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn deal_evidence(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<table_core::DealEvidence, CommandError> {
    ask(&window, &state, None, Action::Evidence(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn deal_reconcile(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: ReconcileArgs,
) -> Result<table_core::DealEvidence, CommandError> {
    ask(&window, &state, None, Action::Reconcile(args)).await
}
#[tauri::command]
pub(super) async fn attention_list(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<AttentionSnapshot, CommandError> {
    ask(&window, &state, None, Action::Attention).await
}
#[tauri::command]
pub(super) async fn approval_summary(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<ApprovalSummary, CommandError> {
    ask(&window, &state, None, Action::Summary(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn approval_token(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<String, CommandError> {
    ask(&window, &state, None, Action::Token).await
}
#[tauri::command]
pub(super) async fn deal_withdraw(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::Withdraw(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn deal_let_lapse(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::LetLapse(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn deal_countersign(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::Countersign),
    )
    .await
}
#[tauri::command]
pub(super) async fn deal_capture(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::Capture),
    )
    .await
}
#[tauri::command]
pub(super) async fn deal_void(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::Void),
    )
    .await
}
#[tauri::command]
pub(super) async fn shield_release(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::ReleaseHold),
    )
    .await
}
#[tauri::command]
pub(super) async fn rescue_approve(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<Deal, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::Rescue),
    )
    .await
}
#[tauri::command]
pub(super) async fn set_credentials(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: CredentialArgs,
) -> Result<(), CommandError> {
    label(&window, "set_credentials")?;
    let hwnd = window.hwnd().map_err(|_| invalid())?.0 as isize;
    state
        .actor
        .set_credentials(
            caller(&window, Some(&request)),
            args,
            hwnd,
            &table_os::WindowsCredentialPrompt,
        )
        .await
}
#[tauri::command]
pub(super) async fn engine_select(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: EngineSelectArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::Engine(args.engine)).await
}
#[tauri::command]
pub(super) async fn mandate_list(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<MandateListEntry>, CommandError> {
    ask(&window, &state, None, Action::Mandates).await
}
#[tauri::command]
pub(super) async fn mandate_sign(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: MandateSignArgs,
) -> Result<table_core::OpenMandate, CommandError> {
    ask(&window, &state, Some(&request), Action::Sign(args)).await
}
#[tauri::command]
pub(super) async fn mandate_revoke(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: MandateRevokeArgs,
) -> Result<(), CommandError> {
    ask(&window, &state, Some(&request), Action::Revoke(args)).await
}
#[tauri::command]
pub(super) async fn band_set(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: BandArgs,
) -> Result<table_core::OpenMandate, CommandError> {
    ask(&window, &state, Some(&request), Action::Band(args)).await
}
#[tauri::command]
pub(super) async fn pairing_create(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: PairingCreateArgs,
) -> Result<PairingOffer, CommandError> {
    ask(&window, &state, None, Action::PairCreate(args)).await
}
#[tauri::command]
pub(super) async fn pairing_join(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: PairingJoinArgs,
) -> Result<PairingWords, CommandError> {
    ask(&window, &state, None, Action::PairJoin(args)).await
}
#[tauri::command]
pub(super) async fn pairing_poll(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: PairingPollArgs,
) -> Result<Option<PairingWords>, CommandError> {
    ask(&window, &state, None, Action::PairPoll(args)).await
}
#[tauri::command]
pub(super) async fn pairing_confirm(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: PairingConfirmArgs,
) -> Result<table_core::KeyId, CommandError> {
    ask(&window, &state, Some(&request), Action::PairConfirm(args)).await
}
#[tauri::command]
pub(super) async fn deal_create(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DealCreateArgs,
) -> Result<Deal, CommandError> {
    ask(&window, &state, Some(&request), Action::Create(args)).await
}
#[tauri::command]
pub(super) async fn deal_join(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DealJoinArgs,
) -> Result<Deal, CommandError> {
    ask(&window, &state, Some(&request), Action::Join(args)).await
}
#[tauri::command]
pub(super) async fn pause_all_agents(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::Pause).await
}
#[tauri::command]
pub(super) async fn quit_summary(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<QuitSummary, CommandError> {
    ask(&window, &state, None, Action::QuitSummary).await
}
#[tauri::command]
pub(super) async fn engine_status(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<table_engine::EngineInfo>, CommandError> {
    ask(&window, &state, None, Action::Engines).await
}
#[tauri::command]
pub(super) async fn agent_start(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: AgentStartArgs,
) -> Result<RunSnapshot, CommandError> {
    ask(&window, &state, None, Action::Start(args.deal_id)).await
}
#[tauri::command]
pub(super) async fn agent_runs(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<RunSnapshot>, CommandError> {
    ask(&window, &state, None, Action::Runs).await
}
#[tauri::command]
pub(super) async fn resume_all_agents(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<(), CommandError> {
    ask(&window, &state, None, Action::Resume).await
}
#[tauri::command]
pub(super) async fn market_refresh(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: MarketRefreshArgs,
) -> Result<table_core::MarketRef, CommandError> {
    state
        .actor
        .market_refresh(caller(&window, Some(&request)), args)
        .await
}
#[tauri::command]
pub(super) async fn deal_export_proof(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealArgs,
) -> Result<bool, CommandError> {
    use tauri_plugin_dialog::DialogExt;
    let bundle: table_proto::ProofBundle =
        ask(&window, &state, None, Action::ExportProof(args.deal_id)).await?;
    let bytes = serde_json::to_vec_pretty(&bundle).map_err(|_| invalid())?;
    // The owner picks where the file goes; the webview never sees a path or the bytes.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .set_file_name(format!("{}.tableproof", args.deal_id))
        .add_filter("Table proof", &["tableproof"])
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|_| invalid())? else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|_| invalid())?;
    std::fs::write(path, bytes).map_err(|_| invalid())?;
    Ok(true)
}
#[tauri::command]
pub(super) async fn proof_check(
    window: WebviewWindow,
) -> Result<Option<ProofReport>, CommandError> {
    use std::io::Read;
    use tauri_plugin_dialog::DialogExt;
    label(&window, "proof_check")?;
    // The owner picks the file; the webview never sees a path or the bytes, only the report.
    let (sender, receiver) = tokio::sync::oneshot::channel();
    window
        .dialog()
        .file()
        .add_filter("Table proof", &["tableproof"])
        .pick_file(move |path| {
            let _ = sender.send(path);
        });
    let Some(path) = receiver.await.map_err(|_| invalid())? else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| invalid())?;
    // One byte past the cap is enough for check_proof_file to refuse an oversized file.
    let limit = u64::try_from(PROOF_FILE_LIMIT).map_err(|_| invalid())?;
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(limit + 1).read_to_end(&mut bytes))
        .map_err(|_| CommandError {
            code: ErrorCode::Unavailable,
            message: "That file could not be opened, so it was not checked.".into(),
        })?;
    check_proof_file(&bytes).map(Some)
}
#[tauri::command]
pub(super) async fn mandate_simulate(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: MandateSimulateArgs,
) -> Result<MandateSimulation, CommandError> {
    ask(&window, &state, None, Action::Simulate(args)).await
}
#[tauri::command]
pub(super) async fn envelope_sign(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: EnvelopeSignArgs,
) -> Result<table_core::SignedEnvelope, CommandError> {
    ask(&window, &state, Some(&request), Action::EnvelopeSign(args)).await
}
#[tauri::command]
pub(super) async fn envelope_get(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<table_core::ExposureView, CommandError> {
    ask(&window, &state, None, Action::EnvelopeGet).await
}
#[tauri::command]
pub(super) async fn rescue_replay(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: RescueReplayArgs,
) -> Result<Deal, CommandError> {
    let deal: Deal = ask(&window, &state, Some(&request), Action::RescueReplay(args)).await?;
    // Rust selected the new rescue deal for this window: the shell's summary pushes follow it.
    *state.selected.lock().map_err(|_| invalid())? = Some(deal.id);
    Ok(deal)
}
#[tauri::command]
pub(super) async fn rescue_book(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<RescueBook, CommandError> {
    ask(&window, &state, None, Action::RescueBook).await
}
#[tauri::command]
pub(super) async fn deal_group_open(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    args: DealGroupOpenArgs,
) -> Result<DealGroupView, CommandError> {
    ask(&window, &state, None, Action::GroupOpen(args)).await
}
#[tauri::command]
pub(super) async fn deal_groups(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<Vec<DealGroupView>, CommandError> {
    ask(&window, &state, None, Action::Groups).await
}
#[tauri::command]
pub(super) async fn rescue_watch_add(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: RescueWatchArgs,
) -> Result<Vec<RescueWatchView>, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::RescueWatchAdd(args),
    )
    .await
}
#[tauri::command]
pub(super) async fn rescue_watch_stop(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: RescueWatchStopArgs,
) -> Result<Vec<RescueWatchView>, CommandError> {
    ask(
        &window,
        &state,
        Some(&request),
        Action::RescueWatchStop(args),
    )
    .await
}
#[tauri::command]
pub(super) async fn safety_record(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
) -> Result<SafetyRecord, CommandError> {
    ask(&window, &state, None, Action::SafetyRecord).await
}
