#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::{any::TypeId, collections::HashSet, path::PathBuf};
use ts_rs::{Config, TS, TypeVisitor};

struct Verify {
    root: PathBuf,
    config: Config,
    visited: HashSet<TypeId>,
    produced: std::collections::BTreeSet<String>,
}
impl TypeVisitor for Verify {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        if !self.visited.insert(TypeId::of::<T>()) {
            return;
        }
        if let Some(path) = T::output_path() {
            if let Some(name) = path.file_name() {
                self.produced.insert(name.to_string_lossy().into_owned());
            }
            let expected = T::export_to_string(&self.config).unwrap();
            let actual = std::fs::read_to_string(self.root.join(&path)).unwrap();
            assert_eq!(
                actual.replace("\r\n", "\n"),
                expected.replace("\r\n", "\n"),
                "stale binding: {}; run generate-bindings",
                path.display()
            );
        }
        T::visit_dependencies(self);
    }
}
#[test]
fn checked_in_bindings_match_every_rust_command_event_and_dependency() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../bindings");
    let mut verify = Verify {
        config: Config::new().with_out_dir(&root).with_large_int("number"),
        root,
        visited: HashSet::new(),
        produced: ["authority.ts", "playbooks.ts", "ladder.ts", "dealStates.ts"]
            .map(String::from)
            .into(),
    };
    verify.visit::<table_client::CommandContract>();
    verify.visit::<table_client::EventContract>();
    verify.visit::<table_client::CommandError>();
    verify.visit::<table_client::IpcHeaders>();
    verify.visit::<table_attention::LadderSchedule>();
    // An orphan is a bindings/*.ts no root reaches: a removed Rust type's stale, importable file.
    let orphans: Vec<String> = std::fs::read_dir(&verify.root)
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|n| n.ends_with(".ts") && !verify.produced.contains(n))
        .collect();
    assert!(
        orphans.is_empty(),
        "orphan bindings {orphans:?} are produced by no type; run `cargo run -p table-client --bin generate-bindings`"
    );
    // Both directions: a contract field missing from COMMANDS would escape every grant test.
    let decl = table_client::CommandContract::decl(&verify.config);
    let contract: std::collections::BTreeSet<&str> = decl
        .split(": Command<")
        .filter_map(|before| {
            before
                .rsplit(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
                .next()
        })
        .filter(|name| !name.is_empty())
        .collect();
    let commands: std::collections::BTreeSet<&str> =
        table_client::COMMANDS.iter().copied().collect();
    assert_eq!(contract, commands);
}
#[test]
fn checked_in_authority_files_match_the_authority_table() {
    // T11: the mock's gate table and the three capability files are generated from one table.
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let read = |path: PathBuf| {
        std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
            .replace("\r\n", "\n")
    };
    let ts = read(manifest.join("../../bindings/authority.ts"));
    assert_eq!(
        ts,
        table_client::authority::typescript().unwrap(),
        "stale bindings/authority.ts; run generate-bindings"
    );
    assert!(ts.contains(table_client::authority::manifest_hex().unwrap()));
    // The role playbooks the owner reads verbatim are generated from prompts/*.md.
    assert_eq!(
        read(manifest.join("../../bindings/playbooks.ts")),
        table_client::playbooks::typescript().unwrap(),
        "stale bindings/playbooks.ts; run generate-bindings"
    );
    // The attention ladder's one schedule, as the Tumbler reads it (attention-ladder-1).
    assert_eq!(
        read(manifest.join("../../bindings/ladder.ts")),
        table_client::ladder::typescript().unwrap(),
        "stale bindings/ladder.ts; run generate-bindings"
    );
    // The deal-state sets the windows and the mock read, from table-core's predicates.
    assert_eq!(
        read(manifest.join("../../bindings/dealStates.ts")),
        table_client::deal_states::typescript().unwrap(),
        "stale bindings/dealStates.ts; run generate-bindings"
    );
    // Who is told each event, for the mock's event delivery (generated, never a hand list).
    assert!(ts.contains("\nexport const EVENT_AUDIENCE = {\n"));
    assert!(ts.contains("\n  \"settings:changed\": [\"main\", \"tumbler\", \"approval\"],\n"));
    let capabilities = manifest.join("../../apps/desktop/src-tauri/capabilities");
    for (file, contents) in table_client::authority::capability_files().unwrap() {
        assert_eq!(
            read(capabilities.join(&file)),
            contents,
            "stale capabilities/{file}; run generate-bindings"
        );
    }
}
#[test]
fn wire_numbers_tags_and_closed_decisions_match_the_client_contract() {
    let config = Config::new().with_large_int("number");
    let join: table_client::PairingJoinArgs = serde_json::from_value(serde_json::json!({
        "code":"TBL-00000000000000000000000000000001", "side":"buyer", "payee":"merchant"
    }))
    .unwrap();
    assert!(join.peer.is_none());
    assert!(
        table_client::PairingJoinArgs::decl(&config)
            .contains("peer?: SignedPairingIdentity | null")
    );
    let money = table_core::Money::new(1234, table_core::Currency::USD).unwrap();
    assert_eq!(
        serde_json::to_value(money).unwrap(),
        serde_json::json!({"minor":1234,"currency":"USD"})
    );
    assert!(table_core::Money::decl(&config).contains("minor: number"));
    assert!(table_core::DealId::decl(&config).contains("= string"));
    assert!(table_core::H256::decl(&config).contains("[number, number"));
    let args = serde_json::json!({"deal_id":"01ARZ3NDEKTSV4RRFFQ69G5FAV", "attempt":1,
        "terms_hash":vec![0;32], "approved":true});
    assert!(serde_json::from_value::<table_client::DecisionArgs>(args).is_err());
    assert!(serde_json::from_value::<table_client::CredentialArgs>(serde_json::json!({"provider":"paypal_sandbox","client_secret":"must-not-be-an-ipc-field"})).is_err());
    assert_eq!(
        serde_json::to_value(table_client::CredentialArgs::PaypalSandbox).unwrap(),
        "paypal_sandbox"
    );
    assert_eq!(
        serde_json::to_value(table_client::ErrorCode::Locked).unwrap(),
        "LOCKED"
    );
    let refused = table_client::CommandError::from(table_app::Error::Refused(
        table_core::Refusal::new(3, "amount above max_amount"),
    ));
    assert_eq!(serde_json::to_value(refused.code).unwrap(), "REFUSED");
    let malformed = table_client::CommandError::from(table_app::Error::Invalid);
    assert_eq!(serde_json::to_value(malformed.code).unwrap(), "INVALID");
    assert_eq!(
        serde_json::to_value(table_engine::EngineId::CodexCli).unwrap(),
        "codex-cli"
    );
    assert_eq!(
        serde_json::to_value(table_attention::Form::Handoff).unwrap(),
        "handoff"
    );
}
#[test]
fn every_event_has_one_audience_row_and_one_typed_emit() {
    // `EventContract`'s serde names and payload types, read from its own declaration.
    let config = Config::new().with_large_int("number");
    let decl = table_client::EventContract::decl(&config);
    let parts: Vec<&str> = decl.split('"').collect();
    let contract: std::collections::BTreeSet<(String, String)> = parts
        .iter()
        .skip(1)
        .step_by(2)
        .zip(parts.iter().skip(2).step_by(2))
        .map(|(name, rest)| {
            let ty = rest
                .trim_start_matches(':')
                .split(',')
                .next()
                .unwrap()
                .trim();
            ((*name).to_owned(), ty.to_owned())
        })
        .collect();
    assert_eq!(contract.len(), 15, "{decl}");
    // Both directions: an event without an audience row would reach no window; a row without
    // an event would grant nothing and hide a typo.
    let names: std::collections::BTreeSet<&str> =
        contract.iter().map(|(name, _)| name.as_str()).collect();
    let rows: std::collections::BTreeSet<&str> = table_client::authority::EVENTS
        .iter()
        .map(|e| e.name)
        .collect();
    assert_eq!(names, rows);
    // The shell's typed emit carries each event's own payload type under its own name.
    let typed: std::collections::BTreeSet<(String, String)> =
        table_client::WindowEvent::contract(&config)
            .into_iter()
            .map(|(name, ty)| (name.to_owned(), ty))
            .collect();
    assert_eq!(typed, contract);
}
