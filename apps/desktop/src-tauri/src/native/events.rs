use super::*;
use table_attention::AttentionLadder;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
pub(super) fn hide_and_exit(app: &AppHandle) {
    for label in ["main", "tumbler", "approval"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
    app.exit(0);
}
pub(super) fn request_quit(app: &AppHandle) {
    let handle = app.clone();
    let actor = app.state::<DesktopState>().actor.clone();
    tauri::async_runtime::spawn(async move {
        if let Ok(summary) = actor
            .execute::<QuitSummary>(
                Caller {
                    label: "main".into(),
                    token: None,
                },
                Action::QuitSummary,
            )
            .await
        {
            if summary.pending.is_empty() {
                hide_and_exit(&handle);
                return;
            }
            let message = format!(
                "{} pending decisions: {}. {}",
                summary.pending.len(),
                summary
                    .pending
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", "),
                summary.on_quit
            );
            let app = handle.clone();
            handle
                .dialog()
                .message(message)
                .title("Quit The Table?")
                .buttons(MessageDialogButtons::OkCancel)
                .show(move |confirmed| {
                    if confirmed {
                        tauri::async_runtime::spawn(async move {
                            if actor
                                .execute::<()>(
                                    Caller {
                                        label: "main".into(),
                                        token: None,
                                    },
                                    Action::QuitConfirm(QuitArgs {
                                        confirmation_id: summary.confirmation_id,
                                    }),
                                )
                                .await
                                .is_ok()
                            {
                                hide_and_exit(&app);
                            }
                        });
                    }
                });
        }
    });
}
pub(super) async fn produce(
    app: AppHandle,
    mut events: tokio::sync::broadcast::Receiver<WalletEvent>,
) {
    let mut ladder = AttentionLadder::default();
    let mut previous = Vec::<DealId>::new();
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
    let mut visual_previous = None;
    let mut first_run_previous = None;
    let mut fault_previous = None;
    loop {
        let event = tokio::select! {event=events.recv()=>match event{
            Ok(event)=>event,
            Err(tokio::sync::broadcast::error::RecvError::Closed)=>break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_))=>{
                let actor=app.state::<DesktopState>().actor.clone();
                if let Ok(deals)=actor.execute::<Vec<Deal>>(Caller{label:"main".into(),token:None},Action::ListDeals).await{for deal in deals{let _=app.emit_to("main","deal:changed",DealChanged{mode:deal.mode,deal});}}
                if let Ok(runs)=actor.execute::<Vec<RunSnapshot>>(Caller{label:"main".into(),token:None},Action::Runs).await{for run in runs{let _=app.emit_to("main","agent:changed",run);}}
                if let Ok(settings)=actor.execute::<SettingsSnapshot>(Caller{label:"main".into(),token:None},Action::Settings).await{let _=app.emit_to("main","settings:changed",&settings);let _=app.emit_to("tumbler","settings:changed",settings);}
                match actor.execute::<AttentionSnapshot>(Caller{label:"main".into(),token:None},Action::Attention).await{Ok(snapshot)=>WalletEvent::Attention(snapshot),Err(error)=>WalletEvent::Fault(error)}
            }
        },_=interval.tick()=>{
            let state=app.state::<DesktopState>();
            if state.surface.lock().ok().is_some_and(|s|s.dragging) && !table_os::left_mouse_pressed() && let Some(t)=app.get_webview_window("tumbler"){
                let _=tumbler_snap(t,app.clone(),app.state::<DesktopState>());
            }
            let data=state.attention.lock().ok().and_then(|s|s.clone());
            let surface=state.surface.lock().ok().map(|s|(s.preferences.clone(),s.last_interaction));
            if let (Some(data),Some((preferences,last)))=(data,surface){
                notify_due(&app,&data,&preferences,&mut ladder).await;
                let now=table_core::Clock::now(&table_runtime::SystemClock);
                let visual=VisualState{opacity_percent:if preferences.quiet{table_attention::quiet_opacity_percent(&data.items,last,now)}else{100},
                    breathe:!preferences.dnd && !table_os::notifications_suppressed() && data.items.iter().any(|i|i.kind==table_attention::AttnKind::Gate && i.deadline.is_some_and(|d|d>now&&d.saturating_sub(now)<=7200))};
                if let Ok(encoded)=serde_json::to_string(&visual) && visual_previous.as_ref()!=Some(&encoded){visual_previous=Some(encoded);let _=app.emit_to("tumbler","tumbler:visual",visual);}
            }
            continue;
        }};
        let state = app.state::<DesktopState>();
        match event {
            WalletEvent::Agent(data) => {
                let _ = app.emit_to("main", "agent:changed", data);
            }
            WalletEvent::Deal(data) => {
                let _ = app.emit_to("main", "deal:changed", data);
            }
            WalletEvent::Pinned(data) => {
                let _ = app.emit_to("main", "pairing:pinned", data);
            }
            WalletEvent::Receipt(data) => {
                let _ = app.emit_to("main", "receipt:created", &data);
                let _ = app.emit_to("tumbler", "receipt:created", data);
            }
            WalletEvent::Fault(error) => {
                if let Ok(encoded) = serde_json::to_string(&error)
                    && fault_previous.as_ref() != Some(&encoded)
                {
                    fault_previous = Some(encoded);
                    let _ = app.emit_to("main", "wallet:error", error);
                }
            }
            WalletEvent::Settings(settings) => {
                if !settings.first_run
                    && first_run_previous != Some(false)
                    && let Some(t) = app.get_webview_window("tumbler")
                {
                    if first_run_previous == Some(true)
                        && let Some(main) = app.get_webview_window("main")
                        && let (Ok(p), Ok(size)) = (main.outer_position(), main.outer_size())
                    {
                        if let Ok(mut s) = state.surface.lock() {
                            s.anchor = Some(tauri::PhysicalPosition::new(
                                p.x.saturating_add(i32::try_from(size.width).unwrap_or(i32::MAX)),
                                p.y,
                            ));
                            s.snap = Snap::MainRight;
                        }
                        let _ = set_form(&app, Form::Rest);
                    }
                    if let Ok(hwnd) = t.hwnd() {
                        table_os::show_without_activation(hwnd.0 as isize);
                    }
                }
                first_run_previous = Some(settings.first_run);
                let _ = app.emit_to("main", "settings:changed", &settings);
                let _ = app.emit_to("tumbler", "settings:changed", &settings);
                let _ = app.emit_to("approval", "settings:changed", settings);
            }
            WalletEvent::Attention(data) => {
                let preferences = state
                    .surface
                    .lock()
                    .ok()
                    .map(|s| s.preferences.clone())
                    .unwrap_or_default();

                for item in &data.items {
                    let show = matches!(
                        item.kind,
                        table_attention::AttnKind::Gate | table_attention::AttnKind::Hold
                    );
                    if show
                        && !previous.contains(&item.deal_id)
                        && let Some(t) = app.get_webview_window("tumbler")
                        && !t.is_visible().unwrap_or(false)
                    {
                        let _ = set_form(&app, Form::Rest);
                        let _ = t.set_focusable(false);
                        if let Ok(hwnd) = t.hwnd() {
                            table_os::show_without_activation(hwnd.0 as isize);
                        }
                    }
                }
                notify_due(&app, &data, &preferences, &mut ladder).await;
                previous = data.items.iter().map(|i| i.deal_id).collect();
                if let Ok(mut snapshot) = state.attention.lock() {
                    *snapshot = Some(data.clone());
                }
                let _ = app.emit_to("main", "attention:changed", &data);
                let _ = app.emit_to("tumbler", "attention:changed", &data);
                if let Some(tray) = app.tray_by_id("wallet") {
                    let _ = tray.set_icon(Some(tray_icon(!data.items.is_empty())));
                }
                let _ = emit_status(&app);
                let selected = state.selected.lock().ok().and_then(|id| *id);
                if let Some(id) = selected
                    && app.get_webview_window("approval").is_some()
                    && let Ok(summary) = state
                        .actor
                        .execute::<ApprovalSummary>(
                            Caller {
                                label: "approval".into(),
                                token: None,
                            },
                            Action::Summary(id),
                        )
                        .await
                {
                    let _ = app.emit_to("approval", "approval:summary", summary);
                }
            }
        }
    }
}

async fn notify_due(
    app: &AppHandle,
    data: &AttentionSnapshot,
    preferences: &TumblerPreferences,
    ladder: &mut AttentionLadder,
) {
    let dnd = preferences.dnd || !preferences.notifications || table_os::notifications_suppressed();
    ladder.forget_absent(&data.items);
    for item in &data.items {
        let effects = ladder.evaluate(
            item,
            table_core::Clock::now(&table_runtime::SystemClock),
            dnd,
            false,
        );
        if effects.notify
            && let Some(deadline) = item.deadline
            && app
                .state::<DesktopState>()
                .actor
                .execute::<bool>(
                    Caller {
                        label: "tumbler".into(),
                        token: None,
                    },
                    Action::ClaimNotification {
                        deal_id: item.deal_id,
                        deadline,
                    },
                )
                .await
                .unwrap_or(false)
        {
            // The plugin's desktop builder discards action callbacks. Use its
            // underlying WinRT wrapper so clicks only route to the matching card.
            let click_app = app.clone();
            let id = item.deal_id;
            let _ = tauri_winrt_notification::Toast::new(&app.config().identifier)
                .title("The Table · decision due")
                .text1(&format!(
                    "{}. If ignored: {}",
                    item.headline, item.on_silence
                ))
                .sound(None)
                .on_activated(move |_| {
                    let app = click_app.clone();
                    let main_app = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        let _ = set_form(&main_app, Form::Card);
                        let _ = summon(&main_app, false);
                        let _ = main_app.emit_to(
                            "tumbler",
                            "tumbler:selected",
                            DealArgs { deal_id: id },
                        );
                    });
                    Ok(())
                })
                .show();
        }
    }
}
