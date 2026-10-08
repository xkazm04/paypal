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
            // Deal numbers and Rust-composed lines from the walk-away forecast; never ids.
            let message = table_attention::quit_message(
                summary.pending.len(),
                summary.while_off.as_deref(),
                summary.at_paypal.as_deref(),
                &summary.on_quit,
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
                            } else {
                                // What was shown changed (a deal, or what it does while off):
                                // ask again with the current lines instead of quitting silently.
                                request_quit(&app);
                            }
                        });
                    }
                });
        }
    });
}
/// Shows each failure streak once: the same fault again is dropped until a good attention read
/// ends the streak.
#[derive(Default)]
struct FaultDedupe(Option<String>);
impl FaultDedupe {
    fn is_new(&mut self, encoded: String) -> bool {
        if self.0.as_ref() == Some(&encoded) {
            return false;
        }
        self.0 = Some(encoded);
        true
    }
    fn clear(&mut self) {
        self.0 = None;
    }
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
    let mut fault_previous = FaultDedupe::default();
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
                    breathe:!preferences.dnd && !table_os::notifications_suppressed() && data.items.iter().any(|i|i.kind==table_attention::AttnKind::Gate && table_attention::LADDER.breathes(i.deadline,now))};
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
                    && fault_previous.is_new(encoded)
                {
                    let _ = app.emit_to("main", "wallet:error", &error);
                    let _ = app.emit_to("tumbler", "wallet:error", error);
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
                // A good read ends the failure streak: the next one is shown again.
                fault_previous.clear();
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
    // Why a due notification is held back, recorded as a rung (attention-ladder-1).
    let reason = if preferences.dnd {
        table_core::NotifySuppression::DoNotDisturb
    } else if !preferences.notifications {
        table_core::NotifySuppression::NotificationsOff
    } else {
        table_core::NotifySuppression::SystemQuiet
    };
    ladder.forget_absent(&data.items);
    for item in &data.items {
        let effects = ladder.evaluate(
            item,
            table_core::Clock::now(&table_runtime::SystemClock),
            dnd,
            false,
        );
        if effects.suppressed
            && let Some(deadline) = item.deadline
        {
            // The owner was not told: say so in the record. A failed write changes nothing.
            let _ = app
                .state::<DesktopState>()
                .actor
                .execute::<serde_json::Value>(
                    Caller {
                        label: "tumbler".into(),
                        token: None,
                    },
                    Action::NotificationSuppressed {
                        deal_id: item.deal_id,
                        deadline,
                        reason,
                    },
                )
                .await;
        }
        if effects.notify
            && let Some(deadline) = item.deadline
        {
            let id = item.deal_id;
            let state = app.state::<DesktopState>();
            let actor = &state.actor;
            let call = |action| async move {
                actor
                    .execute::<serde_json::Value>(
                        Caller {
                            label: "tumbler".into(),
                            token: None,
                        },
                        action,
                    )
                    .await
                    .map_err(|_| ())
            };
            let shown = notify_once(
                async || {
                    call(Action::ClaimNotification {
                        deal_id: id,
                        deadline,
                    })
                    .await
                    .is_ok_and(|v| v == serde_json::Value::Bool(true))
                },
                || show_toast(app, item),
                async || {
                    call(Action::ReleaseNotification {
                        deal_id: id,
                        deadline,
                    })
                    .await
                    .is_ok()
                },
            )
            .await;
            if shown == Some(false) {
                ladder.release(id, deadline);
            }
            if shown == Some(true) {
                // The owner was told: the Notified rung (attention-ladder-1).
                let _ = call(Action::NotificationShown {
                    deal_id: id,
                    deadline,
                })
                .await;
            }
        }
    }
}

/// Claim the rung, show the toast, and give the rung back if nothing was shown. Returns `None`
/// when the claim was refused, otherwise whether the toast showed. The log line carries only
/// the failure kind: no deal text, no counterparty words.
async fn notify_once(
    claim: impl AsyncFnOnce() -> bool,
    show: impl FnOnce() -> Result<(), String>,
    release: impl AsyncFnOnce() -> bool,
) -> Option<bool> {
    if !claim().await {
        return None;
    }
    match show() {
        Ok(()) => Some(true),
        Err(reason) => {
            eprintln!("The Table: decision notification not shown: {reason}");
            if !release().await {
                eprintln!("The Table: decision notification claim could not be released");
            }
            Some(false)
        }
    }
}

fn show_toast(app: &AppHandle, item: &table_attention::AttentionItem) -> Result<(), String> {
    // The plugin's desktop builder discards action callbacks. Use its
    // underlying WinRT wrapper so clicks only route to the matching card.
    let click_app = app.clone();
    let id = item.deal_id;
    tauri_winrt_notification::Toast::new(&app.config().identifier)
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
                let _ = main_app.emit_to("tumbler", "tumbler:selected", DealArgs { deal_id: id });
            });
            Ok(())
        })
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod notify_tests {
    use super::notify_once;
    use std::cell::Cell;

    /// A claim backed by one flag, like the durable preference: true once, false until released.
    struct Claim(Cell<bool>);
    impl Claim {
        async fn take(&self) -> bool {
            !self.0.replace(true)
        }
        async fn give_back(&self) -> bool {
            self.0.set(false);
            true
        }
    }

    #[tokio::test]
    async fn shown_toast_keeps_the_claim() {
        let claim = Claim(Cell::new(false));
        let shown = notify_once(|| claim.take(), || Ok(()), || claim.give_back()).await;
        assert_eq!(shown, Some(true));
        assert!(claim.0.get());
        // At most one notification: the second attempt is refused and never shows.
        let again = notify_once(
            || claim.take(),
            || panic!("shown twice"),
            || claim.give_back(),
        )
        .await;
        assert_eq!(again, None);
    }

    #[tokio::test]
    async fn failed_toast_releases_the_claim_so_a_later_attempt_can_claim() {
        let claim = Claim(Cell::new(false));
        let failed = notify_once(
            || claim.take(),
            || Err("no toast".to_owned()),
            || claim.give_back(),
        )
        .await;
        assert_eq!(failed, Some(false));
        assert!(!claim.0.get());
        let retry = notify_once(|| claim.take(), || Ok(()), || claim.give_back()).await;
        assert_eq!(retry, Some(true));
        assert!(claim.0.get());
    }

    #[tokio::test]
    async fn refused_claim_neither_shows_nor_releases() {
        let released = Cell::new(false);
        let shown = notify_once(
            || async { false },
            || panic!("shown without a claim"),
            || async {
                released.set(true);
                true
            },
        )
        .await;
        assert_eq!(shown, None);
        assert!(!released.get());
    }
}

#[cfg(test)]
mod fault_tests {
    use super::FaultDedupe;

    #[test]
    fn each_failure_streak_is_shown_once() {
        let mut fault = FaultDedupe::default();
        assert!(fault.is_new("unavailable".into()));
        assert!(!fault.is_new("unavailable".into()));
        // A different fault is a new event.
        assert!(fault.is_new("permission".into()));
        assert!(fault.is_new("unavailable".into()));
        // A good attention read ends the streak, so the same fault shows again.
        fault.clear();
        assert!(fault.is_new("unavailable".into()));
        assert!(!fault.is_new("unavailable".into()));
    }
}
