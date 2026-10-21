#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde_json::Value;
/// Every `.rs` file under `src/`, read from disk: the source guards below scan the whole shell,
/// so a file added later (or one a hand list forgot) cannot hold an unguarded emit or handler.
fn shell_sources() -> String {
    fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
                out.push(path);
            }
        }
    }
    let mut files = Vec::new();
    walk(
        &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    files.sort();
    assert!(files.len() >= 10, "{files:?}");
    files
        .iter()
        .map(|f| std::fs::read_to_string(f).unwrap())
        .collect::<Vec<_>>()
        .concat()
}
#[test]
fn w3_release_set_is_approval_only_and_all_commands_are_declared() {
    let capabilities = [
        include_str!("../capabilities/main.json"),
        include_str!("../capabilities/tumbler.json"),
        include_str!("../capabilities/approval.json"),
    ];
    let mut granted = std::collections::BTreeSet::new();
    for raw in capabilities {
        let v: Value = serde_json::from_str(raw).unwrap();
        assert!(v.get("remote").is_none());
        let label = v["identifier"].as_str().unwrap();
        for p in v["permissions"].as_array().unwrap() {
            let p = p.as_str().unwrap();
            assert_ne!(p, "core:default");
            if let Some(command) = p.strip_prefix("allow-") {
                let command = command.replace('-', "_");
                assert!(table_client::COMMANDS.contains(&command.as_str()));
                granted.insert(command.clone());
                if table_client::RELEASE_COMMANDS.contains(&command.as_str()) {
                    assert_eq!(label, "approval");
                }
            }
        }
        let selector = v
            .get("windows")
            .or_else(|| v.get("webviews"))
            .unwrap()
            .as_array()
            .unwrap();
        assert_eq!(selector.len(), 1);
        assert_eq!(selector[0], label);
    }
    assert_eq!(granted.len(), table_client::COMMANDS.len());
    // build.rs hands Tauri the authority table's own command list (T11), included by path.
    let build = include_str!("../build.rs");
    assert!(build.contains("#[path = \"../../../crates/table-client/src/authority_table.rs\"]"));
    assert!(build.contains(".commands(authority_table::COMMANDS)"));
    assert!(
        !build.contains("\"get_settings\""),
        "build.rs keeps no hand list"
    );
    // A command declared and granted but not registered fails only at runtime; compare the
    // generate_handler! list with COMMANDS in both directions.
    let native = include_str!("../src/native.rs");
    let list = native
        .split("generate_handler![")
        .nth(1)
        .and_then(|rest| rest.split(']').next())
        .unwrap();
    let registered: std::collections::BTreeSet<&str> = list
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect();
    let commands: std::collections::BTreeSet<&str> =
        table_client::COMMANDS.iter().copied().collect();
    assert_eq!(registered, commands);
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert!(config["app"]["windows"].as_array().unwrap().is_empty());
}
/// The webview's security settings, written out by hand: a loosened CSP, an extra capability or a
/// global IPC object passes every other gate, so each is pinned here and changed only on purpose.
#[test]
fn the_webview_security_config_is_pinned() {
    let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let app = config["app"].as_object().unwrap();
    // No `withGlobalTauri` (window.__TAURI__ for any script) or other app-level switch.
    let app_keys: Vec<&str> = app.keys().map(String::as_str).collect();
    assert_eq!(app_keys, ["security", "windows"]);
    // Only csp and the capability list: no devCsp, assetProtocol, headers or
    // dangerousDisableAssetCspModification.
    let security = app["security"].as_object().unwrap();
    let security_keys: Vec<&str> = security.keys().map(String::as_str).collect();
    assert_eq!(security_keys, ["capabilities", "csp"]);
    // Exactly the three generated capabilities are enabled, one per window label...
    let listed: Vec<&str> = security["capabilities"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c.as_str().unwrap())
        .collect();
    let labels = table_client::authority::WindowLabel::ALL.map(|l| l.as_str());
    assert_eq!(listed, labels);
    // ...and no other capability file sits beside them.
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
    let mut files: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    files.sort();
    let mut expected: Vec<String> = labels.iter().map(|l| format!("{l}.json")).collect();
    expected.sort();
    assert_eq!(files, expected);
    // The content security policy, directive by directive.
    let csp = security["csp"].as_str().unwrap();
    let directives: std::collections::BTreeMap<&str, Vec<&str>> = csp
        .split(';')
        .map(|d| {
            let mut words = d.split_whitespace();
            (words.next().unwrap(), words.collect())
        })
        .collect();
    let pinned: std::collections::BTreeMap<&str, Vec<&str>> = [
        ("default-src", vec!["'self'"]),
        ("connect-src", vec!["ipc:", "http://ipc.localhost"]),
        ("style-src", vec!["'self'"]),
        ("script-src", vec!["'self'"]),
        ("object-src", vec!["'none'"]),
        ("frame-src", vec!["'none'"]),
    ]
    .into();
    assert_eq!(directives, pinned, "{csp}");
}
#[test]
fn client_reads_and_snooze_have_their_precise_label_grants() {
    let capabilities = [
        include_str!("../capabilities/main.json"),
        include_str!("../capabilities/tumbler.json"),
        include_str!("../capabilities/approval.json"),
    ];
    for (command, labels) in [
        ("approval-selection", vec!["approval"]),
        ("approval-pairing", vec!["approval"]),
        ("deal-owner-accept", vec!["approval"]),
        ("deal-display", vec!["main", "tumbler", "approval"]),
        ("deal-transcript", vec!["main", "approval"]),
        ("counterparty-list", vec!["main", "approval"]),
        ("deal-snooze", vec!["tumbler"]),
        ("counterparty-note", vec!["main"]),
        ("pairing-abort", vec!["main", "approval"]),
        ("house-wake", vec!["main"]),
        ("approval-handoff", vec!["approval"]),
        ("audit-page", vec!["main"]),
        ("owner-facts", vec!["main", "approval"]),
        ("book-query", vec!["main"]),
        ("proof-check", vec!["main"]),
        ("deal-history", vec!["main"]),
        ("mandate-simulate", vec!["approval"]),
        ("envelope-sign", vec!["approval"]),
        ("envelope-get", vec!["main", "tumbler", "approval"]),
        ("rescue-replay", vec!["approval"]),
        ("rescue-book", vec!["main", "approval"]),
    ] {
        for raw in capabilities {
            let v: Value = serde_json::from_str(raw).unwrap();
            let label = v["identifier"].as_str().unwrap();
            let granted = v["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|p| p.as_str() == Some(&format!("allow-{command}")));
            assert_eq!(granted, labels.contains(&label), "{command} on {label}");
        }
    }
}
#[test]
fn shell_answered_commands_check_their_own_row_of_the_authority_table() {
    // The commands the shell answers itself never reach the runtime's gate, so each handler must
    // call the table-driven `label(&window, "<command>")` with its own name.
    let sources = shell_sources();
    for a in table_client::authority::AUTHORITY
        .iter()
        .filter(|a| a.enforcer == table_client::authority::Enforcer::Shell)
    {
        let handler = sources
            .split(&format!("fn {}(", a.name))
            .nth(1)
            .and_then(|rest| rest.split("#[tauri::command]").next())
            .unwrap_or_else(|| panic!("no handler for {}", a.name));
        assert!(
            handler.contains(&format!("label(&window, \"{}\")?;", a.name)),
            "{} must check its own row",
            a.name
        );
    }
    // Every label() call names a real row, and no hand-kept label list is left in the shell.
    for call in sources.split("label(&window, \"").skip(1) {
        let name = call.split('"').next().unwrap();
        assert!(table_client::authority::authority(name).is_some(), "{name}");
    }
    assert!(!sources.contains("label(&window, &["));
}
#[test]
fn every_token_row_forwards_the_ipc_header_to_its_gate() {
    // A row that needs the approval token is checked against the X-Wallet-Ipc header of the call;
    // a handler that passes no request reaches the gate with no token, so the owner's command is
    // refused every time. Each such handler must hand its request on.
    let sources = shell_sources();
    let mut checked = 0;
    for a in table_client::authority::AUTHORITY
        .iter()
        .filter(|a| a.token)
    {
        let handler = sources
            .split(&format!("fn {}(", a.name))
            .nth(1)
            .and_then(|rest| rest.split("#[tauri::command]").next())
            .unwrap_or_else(|| panic!("no handler for {}", a.name));
        assert!(
            handler.contains("request: tauri::ipc::Request<'_>")
                && handler.contains("Some(&request)"),
            "{} needs the approval token but does not forward the request",
            a.name
        );
        checked += 1;
    }
    assert!(checked >= 20, "{checked}");
}
#[test]
fn every_window_event_goes_through_the_table_driven_emit() {
    // Who is told each event is a row in the authority table (`EVENTS`); the shell sends through
    // one helper that reads it, never a hand-written (window, event) pair.
    let events = include_str!("../src/native/events.rs");
    let sources = shell_sources();
    assert!(
        !sources.contains("emit_to(\""),
        "a literal emit_to(\"<window>\", ...) bypasses the authority table"
    );
    assert!(
        !sources.contains(".emit(\""),
        "a broadcast reaches every window"
    );
    // The helper's own emit_to, over the row's labels, is the only one left.
    assert_eq!(sources.matches("emit_to(").count(), 1);
    assert!(sources.contains("emit_to(label.as_str(), event.name(), event)"));
    // Lag recovery re-sends settings through the helper, so it reaches the event's full
    // audience (main, tumbler and approval), as the normal path does.
    let lag = events
        .split("RecvError::Lagged")
        .nth(1)
        .and_then(|rest| rest.split("interval.tick()").next())
        .unwrap();
    assert!(lag.contains("WindowEvent::SettingsChanged(&settings)"));
    assert_eq!(
        table_client::authority::event_audience("settings:changed").map(<[_]>::len),
        Some(3)
    );
}
#[test]
fn every_tumbler_show_and_hide_reports_its_status() {
    // Main's status line shows whether the Tumbler is out (`tumbler:status`); a show or hide that
    // does not report leaves it wrong until the next attention change.
    let sources = shell_sources();
    let body = |name: &str| {
        sources
            .split(&format!("fn {name}("))
            .nth(1)
            .and_then(|rest| rest.split("\n}\n").next())
            .unwrap_or_else(|| panic!("no fn {name}"))
    };
    // The hotkey and the tray's entry share one toggle, whose hide reports the new state.
    let toggle = body("toggle_tumbler");
    assert!(toggle.contains("t.hide()") && toggle.contains("emit_status(app)"));
    assert_eq!(sources.matches("toggle_tumbler(app)").count(), 2);
    assert_eq!(
        sources.matches("t.hide()").count(),
        1,
        "hide through toggle_tumbler"
    );
    // Every arrival without focus goes through one helper, which reports it.
    let quiet = body("show_quietly");
    assert!(quiet.contains("show_without_activation(") && quiet.contains("emit_status(app)"));
    assert_eq!(sources.matches("show_without_activation(").count(), 1);
    // A summon reports too.
    assert!(body("summon").contains("emit_status(app)"));
}
#[test]
fn the_tray_menu_is_built_from_and_answered_by_the_tray_model() {
    // Every tray click goes through `TrayModel::command`, so a menu that changed since it was
    // shown (Pause became Resume, a deal settled) cannot run what it no longer shows.
    let native = include_str!("../src/native.rs");
    let events = include_str!("../src/native/events.rs");
    let menu = native
        .split(".on_menu_event(")
        .nth(1)
        .and_then(|rest| rest.split(".build(app)").next())
        .unwrap();
    assert!(menu.contains(".command(event.id.as_ref())"));
    for id in ["main", "tumbler", "pause", "resume", "quit"] {
        assert!(!native.contains(&format!("\"{id}\" =>")), "{id}");
        assert!(!native.contains(&format!("with_id(app, \"{id}\"")), "{id}");
    }
    // Resume runs as the tray's Pause does: as main, with no token.
    assert!(menu.contains("Some(TrayCommand::Pause) => tray_action(app, Action::Pause)"));
    assert!(menu.contains("Some(TrayCommand::Resume) => tray_action(app, Action::Resume)"));
    // A deal entry opens its card through the same route as the decision toast.
    assert!(menu.contains("Some(TrayCommand::OpenCard(id)) => events::open_card(app, id)"));
    let toast = events.split("fn show_toast(").nth(1).unwrap();
    assert!(toast.contains("open_card(&main_app, id)"));
    assert_eq!(
        [native, events]
            .concat()
            .matches("WindowEvent::TumblerSelected(")
            .count(),
        1,
        "one route to a card"
    );
    // The tray follows the attention snapshot and the paused state.
    assert!(events.contains("WalletEvent::Settings(settings)"));
    assert_eq!(events.matches("refresh_tray(&app)").count(), 3);
}
