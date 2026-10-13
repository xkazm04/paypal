//! Credential entry and the vault: values are validated and trimmed, failed writes never leave a
//! date behind, and buyer availability needs unlock but no local PayPal keys.
use super::*;

#[tokio::test]
async fn buyer_browser_availability_needs_unlock_but_no_local_paypal_credentials() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Buyer);
    for event in [
        DealEvent::ListingVerified,
        DealEvent::OfferVerified,
        DealEvent::TwoAcceptsVerified,
    ] {
        r.pipeline
            .wallet
            .ledger
            .apply_event(deal.id, event, 100)
            .unwrap();
    }
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let body = Body::Settle {
        order_id: ShortText::new("ORDER1".into()).unwrap(),
        approve_url: ShortText::new(
            "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1".into(),
        )
        .unwrap(),
        amount: deal.terms.amount().unwrap(),
        invoice_id: ShortText::new(invoice_id(deal.id, 1).unwrap()).unwrap(),
        intent: table_proto::Intent::Authorize,
        attempt: 1,
    };
    let e = Envelope {
        v: 1,
        typ: body.typ(),
        deal_id: deal.id,
        seq: 1,
        prev: H256::ZERO,
        iss: peer.key_id().unwrap(),
        aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
        iat: 100,
        exp: 700,
        nonce,
        body,
    };
    r.pipeline
        .wallet
        .receive_relay(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    assert!(!r.summary(deal.id).unwrap().can_open_paypal);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    r.pipeline
        .approval
        .unlock("approval", &token, &crate::actor::VerifiedReauth, 100)
        .unwrap();
    r.selected = Some(deal.id);
    let summary = r.summary(deal.id).unwrap();
    assert!(summary.can_open_paypal);
    assert!(!summary.can_release);
    assert!(!r.settings().unwrap().payment_executor_configured);
    assert!(!r.pipeline.wallet.ledger.handed_off(deal.id).unwrap());
    let url = r
        .decide(
            "approval",
            Some(&token),
            DecisionArgs {
                counter_hash: None,
                deal_id: deal.id,
                attempt: 1,
                terms_hash: summary.terms_hash,
                checks_hash: Some(summary.checks_hash),
            },
            Decision::OpenBrowser,
        )
        .await
        .unwrap();
    assert_eq!(
        url,
        "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"
    );
    // The owner's decision alone records the handoff, before the link opens and whatever the
    // Tumbler's Handoff then does: a seller receipt after it is no longer refused.
    assert!(r.pipeline.wallet.ledger.handed_off(deal.id).unwrap());
    assert!(
        r.execute(caller("main", None), Action::Handoff(deal.id))
            .await
            .is_err()
    );
    let handoff: TumblerHandoff = serde_json::from_value(
        r.execute(caller("approval", None), Action::Handoff(deal.id))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(handoff.deal_id, deal.id);
    assert_eq!(handoff.approve_until, 21700);
    assert!(r.pipeline.wallet.ledger.handed_off(deal.id).unwrap());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn credentials_are_privileged_write_only_and_never_appear_in_settings() {
    let (r, vault, http, _, _) = runtime(true);
    let (actor, _events) = spawn(r);
    let token = actor
        .execute::<String>(caller("approval", None), Action::Token)
        .await
        .unwrap();
    let id = random_text();
    let secret = random_text();
    let args = || vault::CredentialEntry::PaypalSandbox {
        client_id: zeroize::Zeroizing::new(id.clone()),
        client_secret: zeroize::Zeroizing::new(secret.clone()),
    };
    assert!(
        actor
            .execute::<()>(caller("main", Some(&token)), Action::Credentials(args()))
            .await
            .is_err()
    );
    assert!(
        actor
            .execute::<()>(
                caller("approval", Some(&token)),
                Action::Credentials(args())
            )
            .await
            .is_err()
    );
    assert!(vault.read("paypal.sandbox").unwrap().is_none());
    actor
        .unlock(caller("approval", Some(&token)), 1)
        .await
        .unwrap();
    actor
        .execute::<()>(
            caller("approval", Some(&token)),
            Action::Credentials(args()),
        )
        .await
        .unwrap();
    let settings = actor
        .execute::<SettingsSnapshot>(caller("main", None), Action::Settings)
        .await
        .unwrap();
    let json = serde_json::to_string(&settings).unwrap();
    assert!(!json.contains(&id));
    assert!(!json.contains(&secret));
    assert!(settings.payment_executor_configured);
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[test]
fn credential_values_that_fail_validation_write_nothing() {
    let long = "x".repeat(1025);
    for bad in ["", "   \t ", long.as_str(), "ab\u{7}cd"] {
        for entry in [
            paypal_entry(bad, "secret"),
            paypal_entry("id", bad),
            vault::CredentialEntry::Channel3 {
                key: zeroize::Zeroizing::new(bad.into()),
            },
        ] {
            let (mut r, vault, _, _, _) = runtime(true);
            assert!(r.credentials(entry).is_err(), "{bad:?}");
            assert!(vault.read("paypal.sandbox").unwrap().is_none());
            assert!(vault.read("channel3").unwrap().is_none());
            for name in ["paypal.sandbox", "channel3"] {
                let date = r
                    .pipeline
                    .wallet
                    .ledger
                    .preference::<i64>(&format!("credential.{name}.stored_at"))
                    .unwrap();
                assert!(date.is_none());
            }
        }
    }
}
#[test]
fn credential_values_are_stored_trimmed() {
    let (mut r, vault, _, _, _) = runtime(true);
    r.credentials(paypal_entry("  id-1 \n", "\tsecret-1  "))
        .unwrap();
    let stored = vault.read("paypal.sandbox").unwrap().unwrap();
    assert_eq!(
        serde_json::from_slice::<(String, String)>(&stored).unwrap(),
        ("id-1".to_string(), "secret-1".to_string())
    );
    let date = r
        .pipeline
        .wallet
        .ledger
        .preference::<i64>("credential.paypal.sandbox.stored_at")
        .unwrap();
    assert!(date.is_some());
}
#[test]
fn a_failed_vault_write_reports_the_error_and_writes_no_date() {
    let mut date_written = false;
    let err = configuration::store_credential(&FailingVault, "paypal.sandbox", b"k", |_| {
        date_written = true;
        Ok::<(), ()>(())
    })
    .unwrap_err();
    assert_eq!(err.message, "OS secret store write failed");
    assert!(!date_written);
}
#[test]
fn a_failed_date_write_after_a_vault_success_still_saves_the_keys() {
    let vault = MemoryVault::default();
    configuration::store_credential(&vault, "paypal.sandbox", b"keys", |_| {
        Err::<(), _>("ledger")
    })
    .unwrap();
    assert_eq!(&**vault.read("paypal.sandbox").unwrap().unwrap(), b"keys");
}
#[test]
fn a_replace_whose_date_write_fails_does_not_keep_the_old_date() {
    let (mut r, vault, _, _, _) = runtime(true);
    r.credentials(paypal_entry("id-1", "secret-1")).unwrap();
    let old = r.owner_facts().unwrap().credentials[0].stored_at;
    assert!(old.is_some());
    let key = "credential.paypal.sandbox.stored_at";
    let ledger = &mut r.pipeline.wallet.ledger;
    configuration::store_credential(vault.as_ref(), "paypal.sandbox", b"new-keys", |keep| {
        if keep {
            Err("ledger")
        } else {
            ledger
                .set_preference(key, &None::<i64>)
                .map_err(|_| "ledger")
        }
    })
    .unwrap();
    let fact = &r.owner_facts().unwrap().credentials[0];
    assert!(fact.stored);
    assert_eq!(fact.stored_at, None);
    assert_eq!(
        &**vault.read("paypal.sandbox").unwrap().unwrap(),
        b"new-keys"
    );
}
#[tokio::test]
async fn missing_credentials_and_unavailable_engine_are_explicit() {
    let (mut r, _, http, _, _) = runtime(true);
    assert!(r.settings().unwrap().first_run);
    assert!(!r.settings().unwrap().payment_executor_configured);
    assert!(
        r.execute(
            caller("main", None),
            Action::Engine(table_engine::EngineId::CodexCli)
        )
        .await
        .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
