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
    let build = include_str!("../build.rs");
    for command in table_client::COMMANDS {
        assert!(build.contains(&format!("\"{command}\"")));
    }
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
