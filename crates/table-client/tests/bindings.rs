#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::{any::TypeId, collections::HashSet, path::PathBuf};
use ts_rs::{Config, TS, TypeVisitor};

struct Verify {
    root: PathBuf,
    config: Config,
    visited: HashSet<TypeId>,
}
impl TypeVisitor for Verify {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        if !self.visited.insert(TypeId::of::<T>()) {
            return;
        }
        if let Some(path) = T::output_path() {
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
    };
    verify.visit::<table_client::CommandContract>();
    verify.visit::<table_client::EventContract>();
    verify.visit::<table_client::CommandError>();
    verify.visit::<table_client::IpcHeaders>();
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
    let refused =
        table_client::CommandError::from(table_app::Error::Refused(table_core::Refusal {
            clause: 3,
            reason: "amount above max_amount".into(),
        }));
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
