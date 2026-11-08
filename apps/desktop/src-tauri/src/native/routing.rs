use super::*;
use tauri_plugin_opener::OpenerExt;
#[tauri::command]
pub(super) async fn main_open(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: MainRoute,
) -> Result<(), CommandError> {
    label(&window, "main_open")?;
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
        // Opened from its Tumbler card: the owner's own act, recorded as a rung
        // (attention-ladder-1). A failed write never stops the window opening.
        if window.label() == "tumbler" {
            let _ = state
                .actor
                .execute::<()>(
                    Caller {
                        label: "tumbler".into(),
                        token: None,
                    },
                    Action::CardOpened(id),
                )
                .await;
        }
    }
    let main = app.get_webview_window("main").ok_or_else(invalid)?;
    main.show().map_err(|_| invalid())?;
    main.set_focus().map_err(|_| invalid())?;
    let route = MainRoute {
        deal_id: *state.route.lock().map_err(|_| invalid())?,
    };
    emit(&app, WindowEvent::MainRoute(&route))
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
    // The runtime admitted a sheet only for a setup step from main (configuration.rs).
    let sheet = match args.presentation {
        Some(ApprovalPresentation::Sheet) => sheet_of(args.target),
        _ => None,
    };
    // Docked: with The Table on screen, the approval window is its child (owned: always above it,
    // gone with it) and opens centred over it. Otherwise it opens beside its opener, as before.
    let dock = dock_target(&app);
    let (page, title, size) = match sheet {
        // A sheet: the one form (approval.html?bare=<kind>, the same page, label, token and gates),
        // frameless, its own size, centred over The Table.
        Some(s) => (format!("approval.html?bare={}", s.bare), s.title, s.size),
        // The Diff (client v2): 620 px prototype + 20 % = 744 px wide; tall enough for the twin
        // header, six diff rows and the footer without scrolling the body.
        None => (
            "approval.html".to_owned(),
            "Owner review · The Table",
            table_attention::APPROVAL_SIZE,
        ),
    };
    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, "approval", WebviewUrl::App(PathBuf::from(page)))
            .on_navigation(super::navigation::permits)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .title(title)
            .inner_size(size.0, size.1)
            .resizable(false)
            .minimizable(false)
            .visible(false);
    builder = if sheet.is_some() {
        builder.decorations(false).skip_taskbar(true)
    } else {
        builder.min_inner_size(744.0, 560.0)
    };
    if let Some(main) = dock.as_ref() {
        builder = builder.parent(main).map_err(|_| invalid())?;
    }
    let approval = builder.build().map_err(|_| invalid())?;
    if let Err(error) = position_approval(
        &approval,
        dock.as_ref().unwrap_or(&window),
        dock.is_some(),
        size,
    ) {
        let _ = approval.close();
        return Err(error);
    }
    if sheet.is_some() {
        // Main dims while the sheet is up; the sheet's own close (done, ✕, Esc, or a newer
        // approval window replacing it) lifts it. A late close of an older sheet carries its
        // older serial, which main ignores.
        let serial = state
            .sheet_serial
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
            + 1;
        let handle = app.clone();
        approval.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = emit(
                    &handle,
                    WindowEvent::ApprovalSheet(&ApprovalSheet {
                        open: false,
                        serial,
                    }),
                );
            }
        });
        emit(
            &app,
            WindowEvent::ApprovalSheet(&ApprovalSheet { open: true, serial }),
        )?;
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
        emit(&app, WindowEvent::ApprovalSummary(&data))?;
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
    label(&window, "unlock")?;
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
    emit(&app, WindowEvent::TumblerHandoff(&handoff))?;
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

/// A setup step shown as a sheet: the bare form's kind, the window title and its logical size
/// (fixed per step; a long form scrolls inside, so the window needs no resize permission).
#[derive(Clone, Copy)]
struct SheetStep {
    bare: &'static str,
    title: &'static str,
    size: (f64, f64),
}

fn sheet_of(target: Option<ApprovalTarget>) -> Option<SheetStep> {
    Some(match target? {
        ApprovalTarget::Credentials => SheetStep {
            bare: "keys",
            title: "PayPal sandbox keys · The Table",
            size: (520.0, 460.0),
        },
        ApprovalTarget::Mandate => SheetStep {
            bare: "rules",
            title: "Sign your agents’ rules · The Table",
            size: (560.0, 620.0),
        },
        ApprovalTarget::Pairing => SheetStep {
            bare: "pairing",
            title: "Confirm the practice shop · The Table",
            size: (520.0, 460.0),
        },
        _ => return None,
    })
}
