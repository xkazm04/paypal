//! Mandate changes through the runtime: versions revoke and re-bind deals, and a band change that
//! would clear the only bound is refused.
use super::*;

#[tokio::test]
async fn a_retired_mandate_leaves_deals_to_their_deadline_without_repeating_faults() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let ledger = &mut r.pipeline.wallet.ledger;
    assert_eq!(ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
    ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    ledger
        .stage_relay_batch(deal.id, &"a".repeat(32), 0, &["aaa.bbb.ccc".into()], 100)
        .unwrap();
    ledger.revoke_mandate(deal.mandate_id, 100).unwrap();
    r.tick().await.unwrap();
    r.start_relay().unwrap();
    let ledger = &r.pipeline.wallet.ledger;
    assert!(ledger.pending_inbox().unwrap().is_empty());
    assert_eq!(ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
    clock.0.store(999_999, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .state
            .terminal()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn a_band_change_that_clears_the_only_bound_is_refused_and_nothing_moves() {
    let (mut r, _, http, _, _) = runtime(true);
    // A sell-only mandate: its agents need a least-you'll-take.
    let (deal, _) = setup(&mut r, Side::Seller);
    let token = unlock_runtime(&mut r);
    r.execute(caller("main", None), Action::Select(Some(deal.id)))
        .await
        .unwrap();
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Band(BandArgs {
                deal_id: deal.id,
                floor: None,
                ceiling: Some(Money::new(2000, Currency::USD).unwrap()),
            }),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert!(
        error
            .message
            .contains("band lacks the side the allowed roles use"),
        "{error:?}"
    );
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(ledger.next_mandate_version(deal.mandate_id).unwrap(), 2);
    assert_eq!(ledger.get_deal(deal.id).unwrap().mandate_version, 1);
    ledger
        .active_mandate(deal.mandate_id, 1, &r.owner().unwrap().verifying_key())
        .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn signed_mandate_versions_revoke_and_band_only_change_selected_unsettled_deal() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    let token = unlock_runtime(&mut r);
    let args = BandArgs {
        deal_id: deal.id,
        floor: Some(Money::new(1100, Currency::USD).unwrap()),
        ceiling: Some(Money::new(2000, Currency::USD).unwrap()),
    };
    assert!(
        r.execute(caller("approval", Some(&token)), Action::Band(args.clone()))
            .await
            .is_err()
    );
    r.execute(caller("main", None), Action::Select(Some(deal.id)))
        .await
        .unwrap();
    let m: OpenMandate = serde_json::from_value(
        r.execute(caller("approval", Some(&token)), Action::Band(args))
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(m.payload.version, 2);
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .mandate_version,
        2
    );
    r.execute(
        caller("approval", Some(&token)),
        Action::Revoke(MandateRevokeArgs {
            id: deal.mandate_id,
        }),
    )
    .await
    .unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .active_mandate(deal.mandate_id, 2, &r.owner().unwrap().verifying_key())
            .is_err()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}
