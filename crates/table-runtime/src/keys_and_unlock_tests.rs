//! Keys and unlock: lost keys fail closed, signing needs the approval label and token, and the
//! OS prompt never runs before the privileged path.
use super::*;

/// A wallet over `ledger` and `vault`, the way the desktop starts one.
fn build(ledger: Ledger, vault: Arc<MemoryVault>) -> Result<Runtime, CommandError> {
    let clock = Arc::new(TestClock(AtomicI64::new(100)));
    Runtime::new(
        ledger,
        vault.clone(),
        Arc::new(Hello {
            calls: AtomicUsize::new(0),
            verified: true,
        }),
        Arc::new(table_paypal::Client::sandbox(
            Arc::new(OfflineHttp::default()),
            Arc::new(VaultCredentials(vault)),
            clock.clone(),
            Arc::new(NoDelay),
        )),
        clock,
    )
}
/// A fresh on-disk ledger path under the gitignored build directory.
fn temporary(label: &str) -> std::path::PathBuf {
    let mut entropy = [0; 16];
    getrandom::fill(&mut entropy).unwrap();
    let name: String = entropy.iter().map(|b| format!("{b:02x}")).collect();
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.build/tmp");
    std::fs::create_dir_all(&directory).unwrap();
    directory.join(format!("{label}-{name}.sqlite3"))
}
/// A copy of the keyring without the entry `lost`.
fn without(original: &MemoryVault, lost: &str) -> Arc<MemoryVault> {
    let vault = Arc::new(MemoryVault::default());
    for key in [
        "owner",
        "agent.negotiator",
        "agent.shopper",
        "agent.assistant",
    ] {
        if key != lost
            && let Some(value) = original.read(key).unwrap()
        {
            vault.write(key, &value).unwrap();
        }
    }
    vault
}

#[test]
fn vault_keys_persist_are_distinct_and_debug_never_exposes_them() {
    let vault = MemoryVault::default();
    let a = signing_key(&vault, "owner").unwrap();
    let b = signing_key(&vault, "agent").unwrap();
    assert_eq!(
        a.verifying_key(),
        signing_key(&vault, "owner").unwrap().verifying_key()
    );
    assert_ne!(a.verifying_key(), b.verifying_key());
    assert_eq!(format!("{vault:?}"), "MemoryVault { [REDACTED] }");
    vault.write("broken", &[0; 2]).unwrap();
    assert!(signing_key(&vault, "broken").is_err());
}
#[test]
fn a_lost_owner_key_fails_closed_once_the_wallet_has_history() {
    use crate::vault::{VaultError, existing_signing_key};
    let empty = MemoryVault::default();
    assert!(matches!(
        existing_signing_key(&empty, "owner"),
        Err(VaultError::Missing)
    ));
    assert!(empty.read("owner").unwrap().is_none());
    let path = temporary("owner");
    let original = Arc::new(MemoryVault::default());
    let mut r = build(Ledger::open(&path).unwrap(), original.clone()).unwrap();
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Negotiator,
        clauses: clauses(Side::Buyer, DealKind::Purchase),
        not_before: 0,
        expires: 1000000,
    })
    .unwrap();
    drop(r);
    let lost = Arc::new(MemoryVault::default());
    assert!(build(Ledger::open(&path).unwrap(), lost.clone()).is_err());
    assert!(lost.read("owner").unwrap().is_none());
    assert!(build(Ledger::open(&path).unwrap(), original).is_ok());
    std::fs::remove_file(path).unwrap();
}
#[test]
fn a_lost_agent_key_fails_closed_only_for_a_slot_the_wallet_used() {
    let slots = [
        AgentSlot::Negotiator,
        AgentSlot::Shopper,
        AgentSlot::Assistant,
    ];
    let path = temporary("agents");
    let original = Arc::new(MemoryVault::default());
    // A fresh wallet mints every slot.
    let mut r = build(Ledger::open(&path).unwrap(), original.clone()).unwrap();
    for slot in slots {
        assert!(original.read(slot.key_name()).unwrap().is_some());
    }
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Shopper,
        clauses: clauses(Side::Buyer, DealKind::Purchase),
        not_before: 0,
        expires: 1000000,
    })
    .unwrap();
    drop(r);
    for slot in slots {
        assert!(original.read(slot.key_name()).unwrap().is_some());
    }
    let names: Vec<&str> = slots.iter().map(|s| s.key_name()).collect();
    assert_eq!(
        names,
        ["agent.negotiator", "agent.shopper", "agent.assistant"]
    );
    // The Shopper is bound by a mandate: losing it fails closed and mints nothing.
    let lost = without(&original, "agent.shopper");
    let error = build(Ledger::open(&path).unwrap(), lost.clone()).unwrap_err();
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, "Agent key provisioning failed");
    assert!(lost.read("agent.shopper").unwrap().is_none());
    // The Negotiator signs for the wallet: losing it fails closed too.
    let lost = without(&original, "agent.negotiator");
    assert!(build(Ledger::open(&path).unwrap(), lost.clone()).is_err());
    assert!(lost.read("agent.negotiator").unwrap().is_none());
    // The Assistant was never bound: its slot is minted as before.
    let lost = without(&original, "agent.assistant");
    assert!(build(Ledger::open(&path).unwrap(), lost.clone()).is_ok());
    assert!(lost.read("agent.assistant").unwrap().is_some());
    std::fs::remove_file(path).unwrap();
}
#[test]
fn a_lost_agent_key_bound_only_by_a_mandate_no_longer_active_fails_closed() {
    let sign = |r: &mut Runtime, id: Option<MandateId>, agent: AgentSlot| {
        r.sign_mandate(MandateSignArgs {
            id,
            agent,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1000000,
        })
        .unwrap()
        .payload
        .id
    };
    // (a) The Shopper's only mandate was revoked: its lost key still fails closed.
    let path = temporary("revoked");
    let original = Arc::new(MemoryVault::default());
    let mut r = build(Ledger::open(&path).unwrap(), original.clone()).unwrap();
    let id = sign(&mut r, None, AgentSlot::Shopper);
    r.pipeline.wallet.ledger.revoke_mandate(id, 101).unwrap();
    drop(r);
    let lost = without(&original, "agent.shopper");
    let error = build(Ledger::open(&path).unwrap(), lost.clone()).unwrap_err();
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, "Agent key provisioning failed");
    assert!(lost.read("agent.shopper").unwrap().is_none());
    assert!(build(Ledger::open(&path).unwrap(), original.clone()).is_ok());
    std::fs::remove_file(path).unwrap();
    // (b) The Assistant's mandate was superseded by one that binds the Shopper.
    let path = temporary("superseded");
    let original = Arc::new(MemoryVault::default());
    let mut r = build(Ledger::open(&path).unwrap(), original.clone()).unwrap();
    let id = sign(&mut r, None, AgentSlot::Assistant);
    sign(&mut r, Some(id), AgentSlot::Shopper);
    drop(r);
    let lost = without(&original, "agent.assistant");
    let error = build(Ledger::open(&path).unwrap(), lost.clone()).unwrap_err();
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, "Agent key provisioning failed");
    assert!(lost.read("agent.assistant").unwrap().is_none());
    assert!(build(Ledger::open(&path).unwrap(), original).is_ok());
    std::fs::remove_file(path).unwrap();
}
#[test]
fn signing_refuses_a_mandate_no_role_can_act_under() {
    let (mut r, ..) = runtime(false);
    // A sell-only mandate over a purchase kind could never allow an intent.
    let mut mismatched = clauses(Side::Seller, DealKind::Purchase);
    mismatched.retain(|c| c.number() != 4);
    let id = MandateId(ulid::Ulid::new());
    // A rule's answer, readable as REFUSED with its reason; never a ledger-trust fault.
    let error = r
        .sign_mandate(MandateSignArgs {
            id: Some(id),
            agent: AgentSlot::Negotiator,
            clauses: mismatched,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert!(
        error
            .message
            .contains("no role in the roles clause can act on the per-deal kind"),
        "{error:?}"
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .list_mandates(&r.owner().unwrap().verifying_key())
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.next_mandate_version(id).unwrap(),
        1
    );
}
#[tokio::test]
async fn signing_a_mandate_needs_the_approval_label_and_its_token() {
    let (mut r, ..) = runtime(false);
    let token = unlock_runtime(&mut r);
    let args = || MandateSignArgs {
        id: None,
        agent: AgentSlot::Negotiator,
        clauses: clauses(Side::Buyer, DealKind::Haggle),
        not_before: 0,
        expires: 1_000_000,
    };
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        let error = r.execute(who, Action::Sign(args())).await.unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    }
    let owner = r.owner().unwrap().verifying_key();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .list_mandates(&owner)
            .unwrap()
            .is_empty()
    );
    let m: OpenMandate = serde_json::from_value(
        r.execute(caller("approval", Some(&token)), Action::Sign(args()))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(m.payload.version, 1);
}
#[tokio::test]
async fn unlock_checks_origin_before_os_and_failure_keeps_lock() {
    let (r, _, http, _, hello) = runtime(false);
    let (actor, _events) = spawn(r);
    assert!(
        actor
            .execute::<String>(caller("main", None), Action::Token)
            .await
            .is_err()
    );
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    assert!(
        actor
            .unlock(caller("tumbler", Some(&token)), 1)
            .await
            .is_err()
    );
    assert_eq!(hello.calls.load(Ordering::SeqCst), 0);
    assert!(
        actor
            .unlock(caller("approval", Some(&token)), 1)
            .await
            .is_err()
    );
    assert_eq!(hello.calls.load(Ordering::SeqCst), 1);
    assert!(
        actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn successful_os_unlock_uses_completion_time_and_reads_do_not_refresh_idle() {
    let (r, _, _, clock, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    clock.0.store(999, Ordering::SeqCst);
    assert!(
        !actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
    clock.0.store(1000, Ordering::SeqCst);
    assert!(
        actor
            .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
            .await
            .unwrap()
            .locked
    );
}
#[tokio::test]
async fn pending_os_prompt_does_not_block_actor_deadline_processing() {
    struct PendingHello {
        started: tokio::sync::Notify,
        finish: tokio::sync::Notify,
    }
    #[async_trait]
    impl reauth::OsReauth for PendingHello {
        fn supported(&self) -> bool {
            true
        }
        async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
            self.started.notify_one();
            self.finish.notified().await;
            Ok(())
        }
    }
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let hello = Arc::new(PendingHello {
        started: tokio::sync::Notify::new(),
        finish: tokio::sync::Notify::new(),
    });
    r.reauth = hello.clone();
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    let unlocker = actor.clone();
    let task =
        tokio::spawn(async move { unlocker.unlock(caller("approval", Some(&token)), 1).await });
    hello.started.notified().await;
    clock.0.store(102, Ordering::SeqCst);
    let updated = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let d = actor
                .execute::<Deal>(caller("main", None), Action::Deal(deal.id))
                .await
                .unwrap();
            if d.state == DealState::Withdrawn {
                break d;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(updated.state, DealState::Withdrawn);
    assert!(!task.is_finished());
    hello.finish.notify_one();
    task.await.unwrap().unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn native_credential_prompt_is_never_opened_before_privilege_and_cancel_writes_nothing() {
    struct CancelPrompt(AtomicUsize);
    #[async_trait]
    impl credentials::CredentialPrompt for CancelPrompt {
        async fn prompt(
            &self,
            _: CredentialArgs,
            _: isize,
        ) -> Result<vault::CredentialEntry, CommandError> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(permission())
        }
    }
    let (r, vault, _, _, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let prompt = CancelPrompt(AtomicUsize::new(0));
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    assert!(
        actor
            .set_credentials(
                caller("main", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert!(
        actor
            .set_credentials(
                caller("approval", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert_eq!(prompt.0.load(Ordering::SeqCst), 0);
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    assert!(
        actor
            .set_credentials(
                caller("approval", Some(&token)),
                CredentialArgs::PaypalSandbox,
                1,
                &prompt
            )
            .await
            .is_err()
    );
    assert_eq!(prompt.0.load(Ordering::SeqCst), 1);
    assert!(vault.read("paypal.sandbox").unwrap().is_none());
}
