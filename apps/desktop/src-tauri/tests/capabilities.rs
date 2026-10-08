#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde_json::Value;
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
    let sources = [
        include_str!("../src/native.rs"),
        include_str!("../src/native/commands.rs"),
        include_str!("../src/native/routing.rs"),
        include_str!("../src/native/surface.rs"),
        include_str!("../src/native/events.rs"),
    ]
    .concat();
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
