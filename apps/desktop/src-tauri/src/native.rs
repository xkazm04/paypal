//! Native shell: views send all wallet commands to one Rust actor.
mod commands;
mod events;
mod routing;
mod surface;
use commands::*;
use routing::*;
use serde::de::DeserializeOwned;
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use surface::*;
use table_attention::{AttentionSnapshot, Form, Rect, Snap};
use table_client::*;
use table_core::{Deal, DealId};
use table_runtime::{Action, ActorHandle, Caller, Decision, WalletEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
#[derive(Debug)]
struct DesktopState {
    actor: ActorHandle,
    selected: Mutex<Option<DealId>>,
    route: Mutex<Option<DealId>>,
    surface: Mutex<Surface>,
    attention: Mutex<Option<AttentionSnapshot>>,
    /// Bumped by every surface change; only the last one in a quiet window is persisted.
    persisted: std::sync::atomic::AtomicU64,
}
#[derive(Debug)]
struct Surface {
    anchor: Option<tauri::PhysicalPosition<i32>>,
    form: Form,
    preferences: TumblerPreferences,
    dragging: bool,
    snap: Snap,
    main_position: Option<tauri::PhysicalPosition<i32>>,
    last_interaction: i64,
}
fn invalid() -> CommandError {
    CommandError {
        code: ErrorCode::Invalid,
        message: "Invalid native window command".into(),
    }
}
fn label(window: &WebviewWindow, allowed: &[&str]) -> Result<(), CommandError> {
    if allowed.contains(&window.label()) {
        Ok(())
    } else {
        Err(table_app::Error::Permission.into())
    }
}
fn caller(window: &WebviewWindow, request: Option<&tauri::ipc::Request<'_>>) -> Caller {
    Caller {
        label: window.label().into(),
        token: request
            .and_then(|r| r.headers().get("x-wallet-ipc"))
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned),
    }
}
async fn ask<T: DeserializeOwned>(
    window: &WebviewWindow,
    state: &DesktopState,
    request: Option<&tauri::ipc::Request<'_>>,
    action: Action,
) -> Result<T, CommandError> {
    state.actor.execute(caller(window, request), action).await
}
fn summon(app: &AppHandle, stack: bool) -> Result<(), tauri::Error> {
    if let Some(t) = app.get_webview_window("tumbler") {
        if stack {
            let _ = set_form(app, Form::Stack);
        }
        t.set_focusable(true)?;
        t.show()?;
        t.set_focus()?;
        let _ = emit_status(app);
    }
    Ok(())
}
fn tray_icon(dot: bool) -> tauri::image::Image<'static> {
    let mut rgba = vec![0u8; 16 * 16 * 4];
    for y in 2..14 {
        for x in 2..14 {
            let i = (y * 16 + x) * 4;
            rgba[i..i + 4].copy_from_slice(&[190, 155, 85, 255]);
        }
    }
    if dot {
        for y in 1..5 {
            for x in 11..15 {
                let i = (y * 16 + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[255, 200, 40, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, 16, 16)
}
pub fn run() -> Result<(), tauri::Error> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let _ = summon(app, true);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == ShortcutState::Pressed
                        && let Some(t) = app.get_webview_window("tumbler")
                    {
                        if t.is_visible().unwrap_or(false) {
                            let _ = t.hide();
                        } else {
                            let _ = summon(app, false);
                        }
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_settings,
            approval_selection,
            deal_display,
            deal_transcript,
            counterparty_list,
            list_deals,
            get_deal,
            deal_evidence,
            deal_reconcile,
            engine_status,
            attention_list,
            main_open,
            approval_open,
            approval_summary,
            approval_pairing,
            approval_token,
            tumbler_set_form,
            tumbler_pin,
            tumbler_drag,
            tumbler_snap,
            deal_export_proof,
            proof_check,
            deal_withdraw,
            deal_let_lapse,
            deal_snooze,
            unlock,
            deal_countersign,
            deal_owner_accept,
            deal_capture,
            deal_void,
            shield_release,
            rescue_approve,
            open_paypal_in_browser,
            set_credentials,
            engine_select,
            mandate_list,
            mandate_sign,
            mandate_revoke,
            band_set,
            pairing_create,
            pairing_join,
            pairing_poll,
            pairing_confirm,
            settings_write,
            deal_create,
            deal_join,
            pause_all_agents,
            resume_all_agents,
            agent_start,
            agent_runs,
            market_refresh,
            quit_summary,
            quit_confirm,
            counterparty_note,
            pairing_abort,
            house_wake,
            approval_handoff,
            audit_page,
            owner_facts,
            book_query,
            mandate_simulate
        ])
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let vault: Arc<dyn table_runtime::vault::Vault> =
                Arc::new(table_runtime::vault::KeyringVault);
            let clock: Arc<dyn table_core::Clock> = Arc::new(table_runtime::SystemClock);
            let market = Arc::new(table_market::Client::new(
                Arc::new(table_paypal::http::ReqwestTransport::new()?),
                Arc::new(table_runtime::VaultMarketKey(vault.clone())),
                clock.clone(),
            ));
            let api = Arc::new(table_paypal::Client::sandbox(
                Arc::new(table_paypal::http::ReqwestTransport::new()?),
                Arc::new(table_runtime::vault::VaultCredentials(vault.clone())),
                clock.clone(),
                Arc::new(table_paypal::http::ExponentialBackoff),
            ));
            let mut runtime = table_runtime::Runtime::new(
                table_ledger::Ledger::open(&data.join("wallet.sqlite"))?,
                vault,
                Arc::new(table_os::WindowsHello),
                api.clone(),
                clock,
            )
            .map_err(|_| std::io::Error::other("Wallet initialization failed"))?;
            runtime = runtime.with_secondary(api);
            if let Ok(origin) = std::env::var("TABLE_RELAY_URL") {
                runtime = runtime
                    .with_relay(Arc::new(table_relay::Client::new(&origin).map_err(
                        |_| std::io::Error::other("Invalid relay deployment origin"),
                    )?));
            }
            runtime.attach_market(market);
            tauri::async_runtime::block_on(runtime.attach_native_engines(data.join("agents")))
                .map_err(|_| std::io::Error::other("Engine attachment failed"))?;
            let settings = runtime
                .settings()
                .map_err(|_| std::io::Error::other("Wallet settings failed"))?;
            let preferences = settings.preferences;
            let (actor, events) =
                tauri::async_runtime::block_on(table_runtime::spawn_networked(runtime))
                    .map_err(|_| std::io::Error::other("Wallet MCP attachment failed"))?;
            app.manage(DesktopState {
                actor,
                selected: Mutex::new(None),
                route: Mutex::new(None),
                surface: Mutex::new(Surface {
                    anchor: preferences
                        .position
                        .map(|p| tauri::PhysicalPosition::new(p.x, p.y)),
                    form: preferences.form,
                    preferences: preferences.clone(),
                    dragging: false,
                    snap: preferences.snap,
                    main_position: None,
                    last_interaction: table_core::Clock::now(&table_runtime::SystemClock),
                }),
                attention: Mutex::new(None),
                persisted: std::sync::atomic::AtomicU64::new(0),
            });
            tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("The Table")
                .inner_size(1440.0, 900.0)
                .visible(false)
                .build()?;
            if let Some(main) = app.get_webview_window("main") {
                position_main(&main).map_err(|_| std::io::Error::other("Main placement failed"))?;
                main.show()?;
                app.state::<DesktopState>()
                    .surface
                    .lock()
                    .map_err(|_| std::io::Error::other("Surface lock failed"))?
                    .main_position = main.outer_position().ok();
            }
            tauri::WebviewWindowBuilder::new(
                app,
                "tumbler",
                WebviewUrl::App("tumbler.html".into()),
            )
            .title("The Tumbler")
            .inner_size(88.0, 88.0)
            .decorations(false)
            .transparent(true)
            .shadow(false)
            .skip_taskbar(true)
            .always_on_top(preferences.pinned)
            .focusable(false)
            .visible(false)
            .build()?;
            let _ = set_form(app.handle(), preferences.form);
            let menu = tauri::menu::Menu::with_items(
                app,
                &[
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "main",
                        "Open The Table",
                        true,
                        None::<&str>,
                    )?,
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "tumbler",
                        "Show / put away the Tumbler",
                        true,
                        None::<&str>,
                    )?,
                    &tauri::menu::MenuItem::with_id(
                        app,
                        "pause",
                        "Pause all agents",
                        true,
                        None::<&str>,
                    )?,
                    &tauri::menu::MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?,
                ],
            )?;
            tauri::tray::TrayIconBuilder::with_id("wallet")
                .icon(tray_icon(false))
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        tauri::tray::TrayIconEvent::Click {
                            button: tauri::tray::MouseButton::Left,
                            button_state: tauri::tray::MouseButtonState::Up,
                            ..
                        }
                    ) {
                        let _ = summon(tray.app_handle(), false);
                    }
                })
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "main" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "tumbler" => {
                        if let Some(t) = app.get_webview_window("tumbler") {
                            if t.is_visible().unwrap_or(false) {
                                let _ = t.hide();
                            } else {
                                let _ = summon(app, false);
                            }
                        }
                    }
                    "pause" => {
                        let actor = app.state::<DesktopState>().actor.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = actor
                                .execute::<()>(
                                    Caller {
                                        label: "main".into(),
                                        token: None,
                                    },
                                    Action::Pause,
                                )
                                .await;
                        });
                    }
                    "quit" => events::request_quit(app),
                    _ => {}
                })
                .build(app)?;
            app.global_shortcut().register("Ctrl+Shift+Space")?;
            tauri::async_runtime::spawn(events::produce(app.handle().clone(), events));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event
                && matches!(window.label(), "main" | "tumbler")
            {
                api.prevent_close();
                let _ = window.hide();
                let _ = emit_status(window.app_handle());
            }
            if window.label() == "tumbler" {
                let state = window.app_handle().state::<DesktopState>();
                match event {
                    tauri::WindowEvent::Moved(position) => {
                        if let Ok(mut s) = state.surface.lock()
                            && s.dragging
                        {
                            s.anchor = Some(*position);
                        }
                    }
                    tauri::WindowEvent::ScaleFactorChanged { .. } => {
                        let form = state.surface.lock().ok().map(|s| s.form);
                        if let Some(form) = form {
                            let _ = set_form(window.app_handle(), form);
                        }
                    }
                    _ => {}
                }
            }
            if window.label() == "main"
                && let tauri::WindowEvent::Moved(position) = event
            {
                let state = window.app_handle().state::<DesktopState>();
                let form = if let Ok(mut s) = state.surface.lock() {
                    let previous = s.main_position.replace(*position);
                    if window.is_visible().unwrap_or(false)
                        && !window.is_minimized().unwrap_or(true)
                        && matches!(s.snap, Snap::MainLeft | Snap::MainRight | Snap::MainCorner)
                    {
                        if let (Some(previous), Some(anchor)) = (previous, s.anchor) {
                            s.anchor = Some(tauri::PhysicalPosition::new(
                                anchor
                                    .x
                                    .saturating_add(position.x.saturating_sub(previous.x)),
                                anchor
                                    .y
                                    .saturating_add(position.y.saturating_sub(previous.y)),
                            ));
                        }
                        Some(s.form)
                    } else {
                        None
                    }
                } else {
                    None
                };
                if let Some(form) = form {
                    let _ = set_form(window.app_handle(), form);
                }
            }
        })
        .run(tauri::generate_context!())
}
