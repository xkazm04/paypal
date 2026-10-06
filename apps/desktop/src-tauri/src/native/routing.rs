use super::*;
use tauri_plugin_opener::OpenerExt;
#[tauri::command]
pub(super) async fn main_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: MainRoute,
) -> Result<(), CommandError> {
    label(&window, &["main", "tumbler"])?;
    if let Some(id) = args.deal_id {
        let _: Deal = state
            .actor
            .execute(
                Caller {
                    label: "main".into(),
                    token: None,
                },
                Action::Deal(id),
            )
            .await?;
        *state.route.lock().map_err(|_| invalid())? = Some(id);
    }
    let main = app.get_webview_window("main").ok_or_else(invalid)?;
    main.show().map_err(|_| invalid())?;
    main.set_focus().map_err(|_| invalid())?;
    app.emit_to(
        "main",
        "main:route",
        MainRoute {
            deal_id: *state.route.lock().map_err(|_| invalid())?,
        },
    )
    .map_err(|_| invalid())
}
#[tauri::command]
pub(super) async fn approval_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: ApprovalOpenArgs,
) -> Result<(), CommandError> {
    if args.deal_id.is_some() && args.pairing.is_some() {
        return Err(invalid());
    }
    // Rust checks the target, the selection and any draft (pre-fill only) before a window opens.
    ask::<()>(&window, &state, None, Action::OpenApproval(args.clone())).await?;
    if let Some(previous) = app.get_webview_window("approval") {
        previous.close().map_err(|_| invalid())?;
    }
    *state.selected.lock().map_err(|_| invalid())? = args.deal_id;
    let approval = tauri::WebviewWindowBuilder::new(
        &app,
        "approval",
        WebviewUrl::App(PathBuf::from("approval.html")),
    )
    .title("Owner review · The Table")
    // The Diff (client v2): 620 px prototype + 20 % = 744 px wide; tall enough for the twin
    // header, six diff rows and the footer without scrolling the body.
    .inner_size(744.0, 660.0)
    .min_inner_size(744.0, 560.0)
    .resizable(false)
    .minimizable(false)
    .visible(false)
    .build()
    .map_err(|_| invalid())?;
    if let Err(error) = position_approval(&approval, &window) {
        let _ = approval.close();
        return Err(error);
    }
    approval.show().map_err(|_| invalid())?;
    approval.set_focus().map_err(|_| invalid())?;
    if let Some(id) = args.deal_id {
        let data: ApprovalSummary = state
            .actor
            .execute(
                Caller {
                    label: "approval".into(),
                    token: None,
                },
                Action::Summary(id),
            )
            .await?;
        app.emit_to("approval", "approval:summary", data)
            .map_err(|_| invalid())?;
    }
    Ok(())
}
#[tauri::command]
pub(super) async fn unlock(
    window: WebviewWindow,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: UnlockArgs,
) -> Result<(), CommandError> {
    let _ = args;
    label(&window, &["approval"])?;
    let hwnd = window.hwnd().map_err(|_| invalid())?.0 as isize;
    state
        .actor
        .unlock(caller(&window, Some(&request)), hwnd)
        .await
}
#[tauri::command]
pub(super) async fn open_paypal_in_browser(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
    args: DecisionArgs,
) -> Result<(), CommandError> {
    let id = args.deal_id;
    let url: String = ask(
        &window,
        &state,
        Some(&request),
        Action::Decision(args, Decision::OpenBrowser),
    )
    .await?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| invalid())?;
    let handoff: TumblerHandoff = ask(&window, &state, None, Action::Handoff(id)).await?;
    app.emit_to("tumbler", "tumbler:handoff", handoff)
        .map_err(|_| invalid())?;
    set_form(&app, Form::Handoff)?;
    Ok(())
}
#[tauri::command]
pub(super) async fn settings_write(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: TumblerPreferences,
) -> Result<(), CommandError> {
    ask::<()>(&window, &state, None, Action::Preferences(args.clone())).await?;
    {
        let mut s = state.surface.lock().map_err(|_| invalid())?;
        s.anchor = args
            .position
            .map(|p| tauri::PhysicalPosition::new(p.x, p.y));
        s.preferences = args.clone();
    }
    if let Some(t) = app.get_webview_window("tumbler") {
        t.set_always_on_top(args.pinned).map_err(|_| invalid())?;
    }
    set_form(&app, args.form)
}
#[tauri::command]
pub(super) async fn quit_confirm(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: QuitArgs,
) -> Result<(), CommandError> {
    ask::<()>(&window, &state, None, Action::QuitConfirm(args)).await?;
    events::hide_and_exit(&app);
    Ok(())
}
