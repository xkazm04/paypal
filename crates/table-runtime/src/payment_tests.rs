//! Payments and settlement through the real actor: the owner decides, the wallet checks,
//! and money moves only on a verified order, once.
use super::*;

#[tokio::test]
async fn safe_withdraw_is_signed_without_unlock_and_does_not_call_paypal() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.execute(caller("tumbler", None), Action::Withdraw(deal.id))
        .await
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Withdrawn
    );
    r.pipeline.wallet.ledger.verify_transcript(deal.id).unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn actor_payments_require_label_token_unlock_selected_hash_and_attempt() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    let args = decision(&mut r, deal.id);
    for caller in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
        caller("approval", Some(&token)),
    ] {
        assert!(
            r.execute(
                caller,
                Action::Decision(args.clone(), Decision::Countersign)
            )
            .await
            .is_err()
        );
    }
    unlock_runtime(&mut r);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args.clone(), Decision::Countersign)
        )
        .await
        .is_err()
    );
    r.selected = Some(deal.id);
    let mut wrong = args.clone();
    wrong.terms_hash = H256::ZERO;
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(wrong, Decision::Countersign)
        )
        .await
        .is_err()
    );
    let mut wrong = args;
    wrong.attempt = 2;
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(wrong, Decision::Countersign)
        )
        .await
        .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
}
#[tokio::test]
async fn real_actor_countersign_verified_browser_link_poll_and_seller_capture() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    let created: Deal = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args.clone(), Decision::Countersign),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(created.state, DealState::AwaitingApproval);
    // The order now exists, so the checklist the countersign was taken on is stale.
    let stale = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::OpenBrowser),
        )
        .await
        .unwrap_err();
    assert_eq!(stale.message, crate::SUMMARY_CHANGED);
    let args = decision(&mut r, deal.id);
    let url: String = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::OpenBrowser),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert!(url.starts_with("https://www.sandbox.paypal.com/"));
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    let paths = &http.0.lock().unwrap().paths;
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.ends_with("/checkout/orders"))
            .count(),
        1
    );
    assert_eq!(paths.iter().filter(|p| p.ends_with("/capture")).count(), 1);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
    r.pipeline.wallet.ledger.verify_transcript(deal.id).unwrap();
}
#[tokio::test]
async fn owner_void_requires_ticket_and_is_durable_once() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    let args = decision(&mut r, deal.id);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert!(
        r.execute(
            caller("main", Some(&token)),
            Action::Decision(args.clone(), Decision::Void)
        )
        .await
        .is_err()
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args.clone(), Decision::Void),
    )
    .await
    .unwrap();
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Void)
        )
        .await
        .is_err()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Voided
    );
    assert_eq!(
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with("/void"))
            .count(),
        1
    );
}
/// An owner's capture whose answer was lost, then the deal's mandate revoked: with no agent key
/// the read-back still runs and the deadline still releases the hold, and nothing captures.
/// Before, the tick returned before both and the money stayed held at PayPal.
#[tokio::test]
async fn a_revoked_mandate_never_freezes_an_open_capture_past_its_deadline() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    http.0.lock().unwrap().fail_capture = true;
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Capture),
        )
        .await
        .is_err()
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    http.0.lock().unwrap().fail_capture = false;
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, clock.now())
        .unwrap();
    assert!(r.select_signer(deal.id).is_err());
    let count = |http: &OfflineHttp, end: &str| {
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with(end))
            .count()
    };
    // The client's own retries of the one lost request, all under its one request id.
    let (reads, captures) = (
        count(&http, "/authorizations/AUTH1"),
        count(&http, "/capture"),
    );
    assert!(captures >= 1);
    // Inside the deadline: read back (the hold is there, nothing captured), and nothing is sent.
    clock.0.fetch_add(60, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(count(&http, "/authorizations/AUTH1"), reads + 1);
    assert_eq!(count(&http, "/capture"), captures);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    // At the deadline: the capture closes not done and the safe default voids the hold.
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    clock.0.store(due + 1, Ordering::SeqCst);
    r.tick().await.unwrap();
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(
        ledger.get_deal(deal.id).unwrap().state,
        DealState::AutoVoided
    );
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    assert!(!r.pipeline.signer_missing);
    assert_eq!(count(&http, "/capture"), captures);
    assert_eq!(count(&http, "/void"), 1);
    let ids: std::collections::BTreeSet<_> = ledger
        .paypal_call_requests(deal.id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/capture"))
        .map(|(_, _, request)| request)
        .collect();
    assert_eq!(ids.len(), 1, "one capture request id");
    let state = http.0.lock().unwrap();
    assert_eq!(
        (state.authorization, state.captured),
        (Some("VOIDED"), false)
    );
}
#[tokio::test]
async fn failed_void_does_not_starve_another_deadline_or_retry_unknown_money() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (held, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &held, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(held.id);
    let args = decision(&mut r, held.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    let (other, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(other.id, 101, None, 100)
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .set_deadline(held.id, 101, Some(100), 100)
        .unwrap();
    http.0.lock().unwrap().fail_void = true;
    clock.0.store(2000, Ordering::SeqCst);
    assert!(r.tick().await.is_err());
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(other.id).unwrap().state,
        DealState::Withdrawn
    );
    // The owner sees the open question honestly: a HOLD card that only opens the deal, worded
    // as checking with PayPal, and the deal's evidence says the same.
    let card = r
        .attention()
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.deal_id == held.id)
        .unwrap();
    assert_eq!(card.kind, table_attention::AttnKind::Hold);
    assert_eq!(
        card.actions,
        vec![table_attention::TumblerAction::OpenInTable]
    );
    assert!(
        card.headline.starts_with("Checking with PayPal"),
        "{}",
        card.headline
    );
    assert_eq!(card.on_silence, table_attention::MONEY_CHECK_SILENCE);
    assert_eq!(card.money_check.map(|c| c.step), Some(MoneyCheckStep::Void));
    let evidence = r.pipeline.wallet.ledger.deal_evidence(held.id).unwrap();
    assert_eq!(
        evidence.money_check.map(|c| c.step),
        Some(MoneyCheckStep::Void)
    );
    assert!(
        r.forecast(clock.now())
            .unwrap()
            .iter()
            .all(|l| l.deal_id != held.id),
        "no step or default is promised while PayPal is being asked"
    );
    // The unknown void is read back (T10): PayPal still holds the money, so the same void is
    // sent again once under its one request id, never a second operation. When that fails too,
    // the wallet stops asking and parks the step for the owner; the deal stays held.
    for _ in 0..6 {
        clock.0.fetch_add(1000, Ordering::SeqCst);
        let _ = r.tick().await;
    }
    let ledger = &r.pipeline.wallet.ledger;
    let void_requests: std::collections::BTreeSet<_> = ledger
        .paypal_call_requests(held.id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/void"))
        .map(|(_, _, request)| request)
        .collect();
    assert_eq!(
        void_requests.into_iter().collect::<Vec<_>>(),
        vec![
            table_paypal::RequestId::for_operation(held.id, 1, "void")
                .unwrap()
                .as_str()
                .to_owned()
        ]
    );
    let outcomes: Vec<_> = ledger
        .resolutions(
            table_paypal::RequestId::for_operation(held.id, 1, "void")
                .unwrap()
                .as_str(),
        )
        .unwrap()
        .into_iter()
        .map(|(_, outcome)| outcome)
        .collect();
    assert_eq!(outcomes, ["resent", "deferred", "needs_owner"]);
    assert_eq!(
        ledger.operation_count(held.id).unwrap(),
        3,
        "create, authorize, void"
    );
    assert_eq!(
        ledger.get_deal(held.id).unwrap().state,
        DealState::Authorized
    );
    assert_eq!(
        ledger.money_check(held.id).unwrap().unwrap().state,
        MoneyCheckState::Parked
    );
}
