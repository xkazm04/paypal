//! Deadlines and attention: the scheduler never moves money on silence, rungs and notifications are
//! claimed once, and a faulting read is reported once per streak.
use super::*;

/// robustness-1 (b): a buyer's deal only the seller says is paid has a defined end. The scheduler
/// leaves it RECEIPTED until PayPal's statement has not shown it for 72 hours, then ends it
/// UNCONFIRMED, with no PayPal call and no money moved.
#[tokio::test]
async fn a_scheduler_tick_past_the_corroboration_window_ends_a_seller_attested_deal_unconfirmed() {
    let (mut r, _, http, clock, _) = runtime(true);
    let deal = receipted_on_the_sellers_word(&mut r);
    let state = |r: &Runtime| r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
    assert_eq!(state(&r), DealState::Receipted);
    clock
        .0
        .store(100 + CORROBORATION_SECS - 1, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(state(&r), DealState::Receipted);
    clock.0.store(100 + CORROBORATION_SECS, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(state(&r), DealState::Unconfirmed);
    r.tick().await.unwrap();
    assert_eq!(state(&r), DealState::Unconfirmed);
    let evidence = r.pipeline.wallet.ledger.deal_evidence(deal.id).unwrap();
    assert_eq!(evidence.receipt, ReceiptEvidence::SellerAttested);
    assert_eq!(evidence.reconciliation, Reconciliation::PendingReporting);
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    // The owner's history ends on one step, decided by the safe default.
    let history = r
        .deal_history(DealHistoryArgs {
            deal_id: Some(deal.id),
            ..Default::default()
        })
        .unwrap();
    let last = history.steps.last().unwrap();
    assert_eq!(last.kind, HistoryKind::Unconfirmed);
    assert_eq!(last.authority, HistoryAuthority::SafeDefault);
    assert_eq!(last.state_after, Some(DealState::Unconfirmed));
    assert_eq!(
        history
            .steps
            .iter()
            .filter(|s| s.kind == HistoryKind::Unconfirmed)
            .count(),
        1
    );
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn dismissal_never_assents_and_deadline_runs_while_locked_or_paused() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.execute(caller("main", None), Action::Pause)
        .await
        .unwrap();
    r.execute(caller("tumbler", None), Action::LetLapse(deal.id))
        .await
        .unwrap();
    assert!(r.attention().unwrap().items.is_empty());
    clock.0.store(900_001, Ordering::SeqCst);
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Withdrawn
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert!(r.settings().unwrap().locked);
}
#[tokio::test]
async fn actor_emits_real_changed_and_receipt_events_for_deadline_default() {
    let (mut r, _, _, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let (_actor, mut events) = spawn(r);
    // Wait for the initial deal projection before advancing the injected clock.
    while !matches!(events.recv().await.unwrap(), WalletEvent::Deal(_)) {}
    clock.0.store(102, Ordering::SeqCst);
    let receipt = tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            if let WalletEvent::Receipt(receipt) = events.recv().await.unwrap() {
                break receipt;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(receipt.deal_id, deal.id);
    assert_eq!(receipt.mode, Mode::Sandbox);
    assert_eq!(receipt.state, DealState::Withdrawn);
    assert!(receipt.on_silence.contains("no capture"));
}
#[tokio::test]
async fn notification_rung_is_claimed_once_and_remains_recorded() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 800, None, 100)
        .unwrap();
    let claim = || Action::ClaimNotification {
        deal_id: deal.id,
        deadline: 800,
    };
    assert_eq!(
        r.execute(caller("tumbler", None), claim()).await.unwrap(),
        json!(true)
    );
    assert_eq!(
        r.execute(caller("tumbler", None), claim()).await.unwrap(),
        json!(false)
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("notification.{}.800", deal.id))
            .unwrap()
            .unwrap()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn failing_attention_read_is_one_fault_per_streak_and_recovery_republishes() {
    let (r, _, _, _, _) = runtime(true);
    let fail = r.fail_attention.clone();
    fail.store(true, Ordering::SeqCst);
    let (_actor, mut events) = spawn(r);
    let mut faults = 0;
    let _ = tokio::time::timeout(std::time::Duration::from_millis(3500), async {
        loop {
            match events.recv().await {
                Ok(WalletEvent::Fault(_)) => faults += 1,
                Ok(WalletEvent::Attention(_)) => panic!("attention published while failing"),
                _ => {}
            }
        }
    })
    .await;
    assert_eq!(faults, 1, "a streak of failing ticks is one Fault");
    fail.store(false, Ordering::SeqCst);
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !matches!(events.recv().await, Ok(WalletEvent::Attention(_))) {}
    })
    .await
    .expect("first good read after the streak is published");
}

#[test]
fn attention_event_faults_once_and_clears_cache_on_error() {
    let snapshot = || table_attention::snapshot(&[], 100, 0, 0.0, false);
    let (mut cache, mut faulted) = (None, false);
    assert!(matches!(
        attention_event(Ok(snapshot()), &mut cache, &mut faulted),
        Some(WalletEvent::Attention(_))
    ));
    assert!(attention_event(Ok(snapshot()), &mut cache, &mut faulted).is_none());
    let error = || unavailable("down");
    assert!(matches!(
        attention_event(Err(error()), &mut cache, &mut faulted),
        Some(WalletEvent::Fault(_))
    ));
    assert!(cache.is_none());
    assert!(attention_event(Err(error()), &mut cache, &mut faulted).is_none());
    // The same stack as before the failure is published again.
    assert!(matches!(
        attention_event(Ok(snapshot()), &mut cache, &mut faulted),
        Some(WalletEvent::Attention(_))
    ));
}

#[tokio::test]
async fn notification_claim_refusals_and_release() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, 800, None, 100)
        .unwrap();
    let claim = |deal_id, deadline| Action::ClaimNotification { deal_id, deadline };
    let key = format!("notification.{}.800", deal.id);
    // Wrong label, wrong deadline, and a deadline more than 900 s away are all refused.
    assert!(
        r.execute(caller("main", None), claim(deal.id, 800))
            .await
            .is_err()
    );
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 799))
            .await
            .unwrap(),
        json!(false)
    );
    clock.0.store(-200, Ordering::SeqCst);
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(false)
    );
    // An unknown deal is not a Gate.
    clock.0.store(100, Ordering::SeqCst);
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            claim(DealId(ulid::Ulid::new()), 800)
        )
        .await
        .unwrap(),
        json!(false)
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&key)
            .unwrap()
            .is_none()
    );
    // Claim, release, claim again; release is for the tumbler only.
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(true)
    );
    let release = || Action::ReleaseNotification {
        deal_id: deal.id,
        deadline: 800,
    };
    assert!(r.execute(caller("main", None), release()).await.is_err());
    assert_eq!(
        r.pipeline.wallet.ledger.preference::<bool>(&key).unwrap(),
        Some(true)
    );
    r.execute(caller("tumbler", None), release()).await.unwrap();
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(true)
    );
    // Deadline already past: refused.
    clock.0.store(801, Ordering::SeqCst);
    r.execute(caller("tumbler", None), release()).await.unwrap();
    assert_eq!(
        r.execute(caller("tumbler", None), claim(deal.id, 800))
            .await
            .unwrap(),
        json!(false)
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn let_lapse_is_refused_on_a_hold_and_on_an_authorized_deal() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    // A shield Hold with a deadline.
    let (held, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(held.id, 800, None, 100)
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .raise_shield(held.id, ShieldVerdict::Hold, 100)
        .unwrap();
    assert!(
        r.execute(caller("tumbler", None), Action::LetLapse(held.id))
            .await
            .is_err()
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", held.id))
            .unwrap()
            .is_none()
    );
    // An Authorized deal.
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
    assert!(
        r.pipeline
            .wallet
            .ledger
            .deadline(deal.id)
            .unwrap()
            .is_some()
    );
    assert!(
        r.execute(caller("tumbler", None), Action::LetLapse(deal.id))
            .await
            .is_err()
    );
    assert!(
        r.pipeline
            .wallet
            .ledger
            .preference::<bool>(&format!("lapse.{}", deal.id))
            .unwrap()
            .is_none()
    );
    let _ = http;
}
#[tokio::test]
async fn a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins() {
    let (mut r, _, http, clock, _) = runtime(true);
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let make = |r: &mut Runtime, with_band: bool| {
        let mut list = clauses(Side::Buyer, DealKind::Purchase);
        if !with_band {
            list.retain(|c| !matches!(c, Clause::Band { .. }));
        }
        let mandate = r
            .sign_mandate(MandateSignArgs {
                id: None,
                agent: AgentSlot::Negotiator,
                clauses: list,
                not_before: 0,
                expires: 1_000_000,
            })
            .unwrap();
        r.create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap()
    };
    let banded = make(&mut r, true);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .deadline(banded.id)
            .unwrap()
            .unwrap()
            .0,
        900_000
    );
    let deal = make(&mut r, false);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .deadline(deal.id)
            .unwrap()
            .unwrap()
            .0,
        100 + 24 * 3600
    );
    r.pipeline
        .wallet
        .ledger
        .propose_purchase(&deal, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    clock.0.store(100 + 24 * 3600, Ordering::SeqCst);
    r.tick().await.unwrap();
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Withdrawn);
    assert!(matches!(
        after.decided_by,
        Some(DecidedBy::SafeDefault { .. })
    ));
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn a_tick_never_starts_an_order_for_a_cleared_purchase() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    assert!(r.settings().unwrap().payment_executor_configured);
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .propose_purchase(&deal, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
}
