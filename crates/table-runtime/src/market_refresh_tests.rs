//! Native market refresh: the owner is checked before any I/O, and bound terms and mandate are
//! rechecked before a price is kept.
use super::*;

#[tokio::test]
async fn native_market_refresh_checks_owner_before_io_and_rechecks_bound_terms_and_mandate() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    let market = Arc::new(MarketFixture {
        calls: AtomicUsize::new(0),
    });
    r.attach_market(market.clone());
    let binding = r.prepare_market(deal.id).unwrap();
    // No market-watch rule names the item, and the item is named by a market product id: the
    // item itself is the product.
    assert_eq!(binding.product_id, "monitor");
    let reference = MarketRef::certified_prices(
        "monitor",
        H256::ZERO,
        &[Money::new(1300, Currency::USD).unwrap()],
        100,
    )
    .unwrap();
    let mut stale = binding.clone();
    stale.terms_hash = H256::digest(b"stale");
    assert!(r.store_market(stale, reference.clone()).is_err());
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, 100)
        .unwrap();
    assert!(r.store_market(binding, reference).is_err());
    let (actor, _events) = spawn(r);
    for label in ["main", "tumbler"] {
        assert!(
            actor
                .market_refresh(
                    caller(label, Some(&token)),
                    MarketRefreshArgs {
                        deal_id: deal.id,
                        product_id: "product1".into()
                    }
                )
                .await
                .is_err()
        );
    }
    assert!(
        actor
            .market_refresh(
                caller("approval", Some(&token)),
                MarketRefreshArgs {
                    deal_id: deal.id,
                    product_id: "product1".into()
                }
            )
            .await
            .is_err()
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 0);
    assert!(http.0.lock().unwrap().paths.is_empty());
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    r.attach_market(market.clone());
    // market-data-2: a record for a product the rules do not bind to the deal's item is
    // refused, and a record that is not re-checkable is not stored by the owner's refresh.
    let binding = r.prepare_market(deal.id).unwrap();
    let other = MarketRef::certified_prices(
        "product1",
        H256::ZERO,
        &[Money::new(1300, Currency::USD).unwrap()],
        100,
    )
    .unwrap();
    assert!(r.store_market(binding.clone(), other).is_err());
    let older = MarketRef::from_comparables(
        vec![Money::new(1300, Currency::USD).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    assert!(r.store_market(binding, older).is_err());
    // The deal keeps the record its setup stored; neither refused record replaced it.
    let kept = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().market;
    assert_eq!(
        kept.unwrap().certificate.unwrap().raw_sha256,
        H256::digest(b"similar")
    );
    let (actor, _events) = spawn(r);
    assert!(
        actor
            .market_refresh(
                caller("approval", Some(&token)),
                MarketRefreshArgs {
                    deal_id: deal.id,
                    product_id: "product1".into(),
                },
            )
            .await
            .is_err()
    );
    assert_eq!(
        market.calls.load(Ordering::SeqCst),
        0,
        "a product not bound to the item is refused before any market call"
    );
    let reference = actor
        .market_refresh(
            caller("approval", Some(&token)),
            MarketRefreshArgs {
                deal_id: deal.id,
                product_id: "monitor".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(reference.median.minor(), 1300);
    assert_eq!(
        reference.certificate.as_ref().unwrap().product_id,
        "monitor"
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 1);
    let stored: Deal = actor
        .execute(caller("main", None), Action::Deal(deal.id))
        .await
        .unwrap();
    assert_eq!(stored.market.unwrap().median.minor(), 1300);
}
