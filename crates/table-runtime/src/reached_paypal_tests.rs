//! A decision whose PayPal request was reserved or sent and then failed is told apart, at the
//! client, from a refusal before any call: `UNAVAILABLE` with `REACHED_PAYPAL`, never the
//! pipeline's own error, which the window would read as "nothing was done". The rule is the
//! ledger's operation count before and after the call (service.rs `after_paypal`).
use super::*;

fn captures(http: &OfflineHttp) -> usize {
    http.0
        .lock()
        .unwrap()
        .paths
        .iter()
        .filter(|p| p.ends_with("/capture"))
        .count()
}
fn capture_requests(r: &Runtime, id: DealId) -> usize {
    r.pipeline
        .wallet
        .ledger
        .paypal_call_requests(id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/capture"))
        .map(|(_, _, request)| request)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}
/// A seller deal held at PayPal and ready for the owner's capture.
async fn authorized(r: &mut Runtime) -> (Deal, String) {
    let (deal, peer) = setup_delivery(r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(r, &deal, &peer);
    let token = unlock_runtime(r);
    r.selected = Some(deal.id);
    let args = decision(r, deal.id);
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
    (deal, token)
}
async fn capture(r: &mut Runtime, id: DealId, token: &str) -> CommandError {
    let args = decision(r, id);
    r.execute(
        caller("approval", Some(token)),
        Action::Decision(args, Decision::Capture),
    )
    .await
    .unwrap_err()
}
fn reached(error: &CommandError) {
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, crate::REACHED_PAYPAL);
    for banned in ["nothing was done", "Not paid", "try again"] {
        assert!(!error.message.contains(banned), "{}", error.message);
    }
}

/// (a) The capture's answer is lost: the operation stays open for the read-back, the deal stays
/// Authorized, and one capture request id was ever used.
#[tokio::test]
async fn a_capture_whose_answer_is_lost_reads_as_reached_paypal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    http.0.lock().unwrap().fail_capture = true;
    let error = capture(&mut r, deal.id, &token).await;
    reached(&error);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    assert!(captures(&http) >= 1);
    // The client's own retries of the one request all carry its one request id.
    assert_eq!(capture_requests(&r, deal.id), 1);
}

/// (b) PayPal answered, but not with a payment the wallet can verify: the operation is closed
/// "unknown" (open for the read-back), no capture is recorded and the deal stays Authorized.
#[tokio::test]
async fn a_capture_answer_that_does_not_verify_reads_as_reached_paypal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    http.0.lock().unwrap().unverified_capture = true;
    let error = capture(&mut r, deal.id, &token).await;
    reached(&error);
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Authorized);
    assert!(after.paypal.capture.is_none());
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    assert_eq!(captures(&http), 1);
    assert_eq!(capture_requests(&r, deal.id), 1);
}

/// (c) A receipt that fails after CaptureConfirmed leaves the deal CAPTURED with a confirmed,
/// not open, operation. The rule counts operations, so it reads that shape as reached. The
/// failure itself cannot be driven from a fixture: the receipt is signed and stored in the
/// pipeline with the deal's own key and ledger, and no fake reaches either without a non-test
/// change (no dependency may be added for a second database connection). So this drives the
/// rule on the ledger shape, not execute().
#[tokio::test]
async fn a_confirmed_operation_with_the_deal_moved_reads_as_reached_paypal() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, _) = authorized(&mut r).await;
    let before = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    r.pipeline
        .wallet
        .ledger
        .reserve_operation(
            deal.id,
            1,
            "capture",
            "request-c",
            &table_core::DecidedBy::Policy { clause: 6 },
            r.clock.now(),
        )
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .finish_operation(table_ledger::OperationOutcome {
            id: deal.id,
            attempt: 1,
            operation: "capture",
            calls: &[],
            refs: &deal.paypal,
            event: Some(table_core::DealEvent::CaptureConfirmed),
            at: r.clock.now(),
        })
        .unwrap();
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    let error = r.after_paypal(deal.id, before, permission());
    reached(&error);
    // No operation reserved: the pipeline's own refusal stands, code and message.
    let now = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let refusal = r.after_paypal(deal.id, now, permission());
    assert!(matches!(refusal.code, ErrorCode::Permission), "{refusal:?}");
    assert_ne!(refusal.message, crate::REACHED_PAYPAL);
}

/// The owner's authorize whose answer is lost: the deal stays Approved, the authorize is open.
#[tokio::test]
async fn an_authorize_whose_answer_is_lost_reads_as_reached_paypal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    http.0.lock().unwrap().awaiting_payer = true;
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    // The buyer approved on PayPal; the wallet's poll would record it (the tick would also
    // authorize under the clause 6 rule, which this test keeps out of the way).
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, table_core::DealEvent::OrderApproved, r.clock.now())
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Approved
    );
    http.0.lock().unwrap().fail_authorize = true;
    let args = decision(&mut r, deal.id);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Countersign),
        )
        .await
        .unwrap_err();
    reached(&error);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Approved
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
}

/// A refusal before any PayPal call keeps its code and message: a capture after the deadline
/// reserves nothing and sends nothing.
#[tokio::test]
async fn a_capture_refused_before_any_call_keeps_its_own_error() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    clock.0.store(due + 1, Ordering::SeqCst);
    let operations = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let error = capture(&mut r, deal.id, &token).await;
    assert_ne!(error.message, crate::REACHED_PAYPAL, "{error:?}");
    assert_eq!(
        r.pipeline.wallet.ledger.operation_count(deal.id).unwrap(),
        operations
    );
    assert_eq!(captures(&http), 0);
}

fn voids(r: &Runtime, id: DealId) -> usize {
    r.pipeline
        .wallet
        .ledger
        .paypal_call_requests(id)
        .unwrap()
        .into_iter()
        .filter(|(_, path, _)| path.ends_with("/void"))
        .map(|(_, _, request)| request)
        .collect::<std::collections::BTreeSet<_>>()
        .len()
}

/// The owner's void whose answer is lost: the hold may be released, so the window is told the
/// release may have reached PayPal and is not known yet (never "nothing was done"). The deal
/// stays Authorized with the void open for the deadline's read-back, under one request id.
#[tokio::test]
async fn a_void_whose_answer_is_lost_reads_as_reached_paypal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    http.0.lock().unwrap().fail_void = true;
    let args = decision(&mut r, deal.id);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Void),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, crate::VOID_REACHED_PAYPAL);
    for banned in ["nothing was done", "Not paid", "try again", "won’t send"] {
        assert!(!error.message.contains(banned), "{}", error.message);
    }
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    assert_eq!(voids(&r, deal.id), 1);
}

/// A void refused before any call (the wrong window) keeps its code and message and reserves
/// nothing.
#[tokio::test]
async fn a_void_refused_before_any_call_keeps_its_own_error() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    let operations = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let args = decision(&mut r, deal.id);
    let error = r
        .execute(
            caller("main", Some(&token)),
            Action::Decision(args.clone(), Decision::Void),
        )
        .await
        .unwrap_err();
    assert_ne!(error.message, crate::VOID_REACHED_PAYPAL, "{error:?}");
    assert_ne!(error.message, crate::REACHED_PAYPAL, "{error:?}");
    // Past the guard, a stale attempt is refused by the decision's own check.
    let mut stale = args;
    stale.attempt = 9;
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(stale, Decision::Void),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Invalid), "{error:?}");
    assert_eq!(
        r.pipeline.wallet.ledger.operation_count(deal.id).unwrap(),
        operations
    );
    assert_eq!(voids(&r, deal.id), 0);
    assert!(
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .all(|p| !p.ends_with("/void"))
    );
}

fn not_confirmed(error: &CommandError) {
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(error.message, crate::STEP_NOT_CONFIRMED);
    for banned in [
        "nothing was done",
        "Not paid",
        "try again",
        "may have reached",
    ] {
        assert!(!error.message.contains(banned), "{}", error.message);
    }
}
async fn second(r: &mut Runtime, id: DealId, token: &str, which: Decision) -> CommandError {
    let args = decision(r, id);
    r.execute(
        caller("approval", Some(token)),
        Action::Decision(args, which),
    )
    .await
    .unwrap_err()
}

/// A second hold while the first capture's operation is still open sends nothing, reserves
/// nothing and says the earlier step is not confirmed (never "nothing was done").
#[tokio::test]
async fn a_second_capture_while_the_first_is_open_is_not_confirmed_yet() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    http.0.lock().unwrap().fail_capture = true;
    reached(&capture(&mut r, deal.id, &token).await);
    let operations = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let sent = captures(&http);
    let error = capture(&mut r, deal.id, &token).await;
    not_confirmed(&error);
    assert_eq!(
        r.pipeline.wallet.ledger.operation_count(deal.id).unwrap(),
        operations
    );
    assert_eq!(captures(&http), sent);
    assert_eq!(capture_requests(&r, deal.id), 1);
}

/// The owner's void while the capture is open: the open operation is the capture's.
#[tokio::test]
async fn a_void_while_the_capture_is_open_is_not_confirmed_yet() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    http.0.lock().unwrap().fail_capture = true;
    reached(&capture(&mut r, deal.id, &token).await);
    let operations = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let sent = captures(&http);
    let error = second(&mut r, deal.id, &token, Decision::Void).await;
    not_confirmed(&error);
    assert_eq!(
        r.pipeline.wallet.ledger.operation_count(deal.id).unwrap(),
        operations
    );
    assert_eq!(voids(&r, deal.id), 0);
    assert_eq!(captures(&http), sent);
}

/// A second countersign while the authorize is open.
#[tokio::test]
async fn a_second_countersign_while_the_authorize_is_open_is_not_confirmed_yet() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    http.0.lock().unwrap().awaiting_payer = true;
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, table_core::DealEvent::OrderApproved, r.clock.now())
        .unwrap();
    http.0.lock().unwrap().fail_authorize = true;
    reached(&second(&mut r, deal.id, &token, Decision::Countersign).await);
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    let operations = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let authorizes = |http: &OfflineHttp| {
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with("/authorize"))
            .count()
    };
    let sent = authorizes(&http);
    let error = second(&mut r, deal.id, &token, Decision::Countersign).await;
    not_confirmed(&error);
    assert_eq!(
        r.pipeline.wallet.ledger.operation_count(deal.id).unwrap(),
        operations
    );
    assert_eq!(authorizes(&http), sent);
}

/// DECISIONS 52a: the countersign on a deal whose authorize was lost is the owner's one read of
/// it, through the same gate as every decision: the approval window, its token and an unlocked
/// session. Past the wallet's own read window, with the mandate expired meanwhile (a failing line
/// that would stop a money step), it reads the order once and confirms the hold PayPal shows. It
/// sends nothing.
#[tokio::test]
async fn a_countersign_on_a_lost_authorize_is_the_owners_one_read_and_only_in_the_window() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    http.0.lock().unwrap().awaiting_payer = true;
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, table_core::DealEvent::OrderApproved, r.clock.now())
        .unwrap();
    http.0.lock().unwrap().fail_authorize = true;
    reached(&second(&mut r, deal.id, &token, Decision::Countersign).await);
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    // PayPal placed the hold after all; nobody has read it since.
    http.0.lock().unwrap().authorization = Some("CREATED");
    let due = r
        .pipeline
        .wallet
        .ledger
        .deadline(deal.id)
        .unwrap()
        .unwrap()
        .0;
    let at = due + 31 * 86400;
    assert!(at > 1_000_000, "the test mandate has expired");
    clock.0.store(at, Ordering::SeqCst);
    // Every write at PayPal but the sign-in token (refreshed after the clock's jump).
    let posts = |http: &OfflineHttp| {
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.starts_with("POST") && !p.ends_with("/oauth2/token"))
            .count()
    };
    let reads = |http: &OfflineHttp| {
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.starts_with("GET") && p.ends_with("/orders/ORDER1"))
            .count()
    };
    let (gets, sent) = (reads(&http), posts(&http));
    // Locked (idle past 15 minutes), outside the approval window, and without the token.
    let args = decision(&mut r, deal.id);
    for (label, token) in [
        ("approval", Some(token.as_str())),
        ("main", Some(token.as_str())),
        ("approval", None),
    ] {
        assert!(
            r.execute(
                caller(label, token),
                Action::Decision(args.clone(), Decision::Countersign)
            )
            .await
            .is_err(),
            "{label}"
        );
    }
    let token = unlock_runtime(&mut r);
    for (label, token) in [("main", Some(token.as_str())), ("approval", None)] {
        assert!(
            r.execute(
                caller(label, token),
                Action::Decision(args.clone(), Decision::Countersign)
            )
            .await
            .is_err(),
            "{label}"
        );
    }
    assert_eq!(reads(&http), gets, "no read without the gate");
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Approved
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    assert_eq!(reads(&http), gets + 1, "one read");
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Authorized);
    assert_eq!(after.paypal.authorization.as_deref(), Some("AUTH1"));
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    assert_eq!(posts(&http), sent, "nothing sent");
}

/// A PERMISSION refusal with no open operation keeps its code: only an open operation turns it
/// into the not-confirmed answer.
#[tokio::test]
async fn a_permission_refusal_with_no_open_operation_stays_permission() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, _) = authorized(&mut r).await;
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    let now = r.pipeline.wallet.ledger.operation_count(deal.id).unwrap();
    let refusal = r.after_paypal(deal.id, now, permission());
    assert!(matches!(refusal.code, ErrorCode::Permission), "{refusal:?}");
    assert_ne!(refusal.message, crate::STEP_NOT_CONFIRMED);
}

/// The Rust sentences the window shows are hand-copied into lib/words.ts; this is the only check
/// before a merge that the two agree byte for byte.
#[test]
fn the_wallet_sentences_match_the_client_words_byte_for_byte() {
    let words = include_str!("../../../apps/desktop/client/src/lib/words.ts");
    for sentence in [
        crate::REACHED_PAYPAL,
        crate::VOID_REACHED_PAYPAL,
        crate::STEP_NOT_CONFIRMED,
        crate::SUMMARY_CHANGED,
        crate::CHECK_FAILED,
    ] {
        assert!(words.contains(&format!("'{sentence}'")), "{sentence}");
    }
}
