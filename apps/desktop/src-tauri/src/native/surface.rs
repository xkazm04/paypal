use super::*;

pub(super) fn monitor_work(window: &WebviewWindow) -> Result<(Rect, f64), CommandError> {
    let monitor = window
        .current_monitor()
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let work = Rect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        width: f64::from(area.size.width),
        height: f64::from(area.size.height),
    }
    .logical(scale)
    .map_err(|_| invalid())?;
    Ok((work, scale))
}

/// Set outer bounds, accounting for native chrome after moving to the target
/// monitor. Physical coordinates avoid using the old monitor's DPI for position.
pub(super) fn put_outer_rect(
    window: &WebviewWindow,
    rect: Rect,
    scale: f64,
) -> Result<(), CommandError> {
    window
        .set_position(tauri::LogicalPosition::new(rect.x, rect.y).to_physical::<i32>(scale))
        .map_err(|_| invalid())?;
    let outer = window.outer_size().map_err(|_| invalid())?;
    let inner = window.inner_size().map_err(|_| invalid())?;
    let desired: tauri::PhysicalSize<u32> =
        tauri::LogicalSize::new(rect.width, rect.height).to_physical(scale);
    window
        .set_size(tauri::PhysicalSize::new(
            desired
                .width
                .saturating_sub(outer.width.saturating_sub(inner.width))
                .max(1),
            desired
                .height
                .saturating_sub(outer.height.saturating_sub(inner.height))
                .max(1),
        ))
        .map_err(|_| invalid())
}

pub(super) fn position_main(window: &WebviewWindow) -> Result<(), CommandError> {
    let (work, scale) = monitor_work(window)?;
    let rect = table_attention::main_start_rect(work).map_err(|_| invalid())?;
    put_outer_rect(window, rect, scale)
}

pub(super) fn position_approval(
    approval: &WebviewWindow,
    opener: &WebviewWindow,
) -> Result<(), CommandError> {
    let (work, scale) = monitor_work(opener)?;
    let origin = opener.outer_position().map_err(|_| invalid())?;
    let size = opener.outer_size().map_err(|_| invalid())?;
    let opener_rect = Rect {
        x: f64::from(origin.x),
        y: f64::from(origin.y),
        width: f64::from(size.width),
        height: f64::from(size.height),
    }
    .logical(scale)
    .map_err(|_| invalid())?;
    let rect = table_attention::approval_rect(opener_rect, work).map_err(|_| invalid())?;
    put_outer_rect(approval, rect, scale)
}

pub(super) fn persist_surface(app: &AppHandle) -> Result<(), CommandError> {
    let state = app.state::<DesktopState>();
    let preferences = {
        let mut s = state.surface.lock().map_err(|_| invalid())?;
        s.preferences.position = s.anchor.map(|p| PuckPosition { x: p.x, y: p.y });
        s.preferences.form = s.form;
        s.preferences.snap = s.snap;
        s.preferences.clone()
    };
    let actor = state.actor.clone();
    // A drag of the main window with the Tumbler snapped to it moves the surface on every
    // Moved event; write once the surface has been still for a moment, not once per event.
    let generation = state
        .persisted
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        .wrapping_add(1);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        let latest = app
            .state::<DesktopState>()
            .persisted
            .load(std::sync::atomic::Ordering::SeqCst);
        if latest != generation {
            return;
        }
        let _ = actor
            .execute::<()>(
                Caller {
                    label: "tumbler".into(),
                    token: None,
                },
                Action::Preferences(preferences),
            )
            .await;
    });
    Ok(())
}
#[tauri::command]
pub(super) fn tumbler_drag(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<(), CommandError> {
    label(&window, "tumbler_drag")?;
    set_form(&app, Form::Rest)?;
    state.surface.lock().map_err(|_| invalid())?.dragging = true;
    window.start_dragging().map_err(|_| invalid())
}
#[tauri::command]
pub(super) fn tumbler_snap(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
) -> Result<Snap, CommandError> {
    label(&window, "tumbler_snap")?;
    let monitor = window
        .current_monitor()
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    let scale = monitor.scale_factor();
    let area = monitor.work_area();
    let work = Rect {
        x: f64::from(area.position.x),
        y: f64::from(area.position.y),
        width: f64::from(area.size.width),
        height: f64::from(area.size.height),
    }
    .logical(scale)
    .map_err(|_| invalid())?;
    let origin: tauri::LogicalPosition<f64> = window
        .outer_position()
        .map_err(|_| invalid())?
        .to_logical(scale);
    let main = app
        .get_webview_window("main")
        .filter(|m| m.is_visible().unwrap_or(false) && !m.is_minimized().unwrap_or(true));
    let main_rect = main.and_then(|m| {
        let p = m.outer_position().ok()?;
        let s = m.outer_size().ok()?;
        Rect {
            x: f64::from(p.x),
            y: f64::from(p.y),
            width: f64::from(s.width),
            height: f64::from(s.height),
        }
        .logical(scale)
        .ok()
    });
    let result = table_attention::snap(
        Rect {
            x: origin.x,
            y: origin.y,
            width: 88.0,
            height: 88.0,
        },
        work,
        main_rect,
    )
    .map_err(|_| invalid())?;
    {
        let mut s = state.surface.lock().map_err(|_| invalid())?;
        s.anchor =
            Some(tauri::LogicalPosition::new(result.anchor.x, result.anchor.y).to_physical(scale));
        s.snap = result.class;
        s.dragging = false;
    }
    set_form(&app, result.form)?;
    Ok(result.class)
}
pub(super) fn set_form(app: &AppHandle, form: Form) -> Result<(), CommandError> {
    let t = app.get_webview_window("tumbler").ok_or_else(invalid)?;
    let monitor = t
        .current_monitor()
        .map_err(|_| invalid())?
        .ok_or_else(invalid)?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let logical_work = Rect {
        x: f64::from(work.position.x),
        y: f64::from(work.position.y),
        width: f64::from(work.size.width),
        height: f64::from(work.size.height),
    }
    .logical(scale)
    .map_err(|_| invalid())?;
    let state = app.state::<DesktopState>();
    let mut surface = state.surface.lock().map_err(|_| invalid())?;
    let origin = match surface.anchor {
        Some(origin) => origin,
        None => t.outer_position().map_err(|_| invalid())?,
    };
    let logical_origin: tauri::LogicalPosition<f64> = origin.to_logical(scale);
    let placement = table_attention::place(
        Rect {
            x: logical_origin.x,
            y: logical_origin.y,
            width: 88.0,
            height: 88.0,
        },
        logical_work,
        form,
    )
    .map_err(|_| invalid())?;
    let puck = table_attention::place(
        Rect {
            x: logical_origin.x,
            y: logical_origin.y,
            width: 88.0,
            height: 88.0,
        },
        logical_work,
        Form::Rest,
    )
    .map_err(|_| invalid())?
    .rect;
    surface.anchor = Some(tauri::LogicalPosition::new(puck.x, puck.y).to_physical(scale));
    surface.form = form;
    surface.last_interaction = table_core::Clock::now(&table_runtime::SystemClock);
    drop(surface);
    t.set_size(tauri::LogicalSize::new(
        placement.rect.width,
        placement.rect.height,
    ))
    .map_err(|_| invalid())?;
    t.set_position(tauri::LogicalPosition::new(
        placement.rect.x,
        placement.rect.y,
    ))
    .map_err(|_| invalid())?;
    app.emit_to("tumbler", "tumbler:form", form)
        .map_err(|_| invalid())?;
    app.emit_to(
        "tumbler",
        "tumbler:orient",
        OrientationEvent { form, placement },
    )
    .map_err(|_| invalid())?;
    persist_surface(app)?;
    emit_status(app)?;
    Ok(())
}
pub(super) fn emit_status(app: &AppHandle) -> Result<(), CommandError> {
    let t = app.get_webview_window("tumbler").ok_or_else(invalid)?;
    let state = app.state::<DesktopState>();
    let form = state.surface.lock().map_err(|_| invalid())?.form;
    app.emit_to(
        "main",
        "tumbler:status",
        TumblerStatus {
            visible: t.is_visible().map_err(|_| invalid())?,
            form,
            count: state
                .attention
                .lock()
                .map_err(|_| invalid())?
                .as_ref()
                .map_or(0, |s| u32::try_from(s.items.len()).unwrap_or(u32::MAX)),
        },
    )
    .map_err(|_| invalid())
}
#[tauri::command]
pub(super) fn tumbler_set_form(
    window: WebviewWindow,
    app: AppHandle,
    args: FormArgs,
) -> Result<(), CommandError> {
    label(&window, "tumbler_set_form")?;
    set_form(&app, args.form)
}
#[tauri::command]
pub(super) fn tumbler_pin(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, DesktopState>,
    args: PinArgs,
) -> Result<(), CommandError> {
    label(&window, "tumbler_pin")?;
    window
        .set_always_on_top(args.pinned)
        .map_err(|_| invalid())?;
    state
        .surface
        .lock()
        .map_err(|_| invalid())?
        .preferences
        .pinned = args.pinned;
    persist_surface(&app)
}
