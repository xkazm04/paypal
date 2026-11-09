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

/// A market whose search, product and similar answers are fixed, counting the calls.
#[derive(Debug)]
struct Finder {
    calls: AtomicUsize,
    unit: Money,
    no_key: bool,
}
impl Finder {
    fn hit(id: &str, minor: i64) -> ProductHit {
        ProductHit {
            id: id.into(),
            title: Some(format!("Title of {id}")),
            brand: None,
            price_minor: Some(minor),
            currency: Some(Currency::USD),
            shop: Some("shop.example".into()),
        }
    }
    fn offer(shop: &str, minor: i64) -> table_core::ShopOffer {
        table_core::ShopOffer {
            shop: shop.into(),
            price: Money::new(minor, Currency::USD).unwrap(),
        }
    }
    fn gate(&self) -> Result<(), table_market::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.no_key {
            Err(table_market::Error::NoKey)
        } else {
            Ok(())
        }
    }
}
#[async_trait]
impl table_market::MarketApi for Finder {
    async fn comparables(&self, _: &str, _: Currency) -> Result<MarketRef, table_market::Error> {
        unreachable!()
    }
    async fn start_tracking(&self, _: &str) -> Result<(), table_market::Error> {
        unreachable!()
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, table_market::Error> {
        unreachable!()
    }
    async fn search(
        &self,
        _: &str,
        _: Currency,
        _: usize,
    ) -> Result<Vec<ProductHit>, table_market::Error> {
        self.gate()?;
        Ok(vec![Self::hit("found-1", 100)])
    }
    async fn lookup(&self, _: &str) -> Result<ProductHit, table_market::Error> {
        self.gate()?;
        Ok(Self::hit("found-2", 100))
    }
    async fn product(
        &self,
        id: &str,
        _: Currency,
    ) -> Result<table_market::ProductDetail, table_market::Error> {
        self.gate()?;
        let unit = self.unit.minor();
        Ok(table_market::ProductDetail {
            hit: Self::hit(id, unit),
            offers: vec![
                Self::offer("dear.example", unit + 500),
                Self::offer("cheap.example", unit - 500),
                Self::offer("same.example", unit),
            ],
        })
    }
    async fn similar(
        &self,
        _: &str,
        _: Currency,
        _: usize,
    ) -> Result<Vec<ProductHit>, table_market::Error> {
        self.gate()?;
        // A different product that is cheaper: it is a comparable, never "the same item cheaper".
        Ok(vec![
            Self::hit("other-1", self.unit.minor() - 2_000),
            Self::hit("other-2", self.unit.minor() + 1_000),
        ])
    }
}

#[tokio::test]
async fn comparables_name_a_cheaper_shop_for_the_identical_product_only_and_write_nothing() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Buyer);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    let finder = Arc::new(Finder {
        calls: AtomicUsize::new(0),
        unit: deal.terms.unit_price,
        no_key: false,
    });
    r.attach_market(finder.clone());
    // The steps the actor runs for these commands read the ledger and write nothing to it.
    let rows = r.pipeline.wallet.ledger.audit_count().unwrap();
    r.execute(caller("approval", Some(&token)), Action::MarketSearchGate)
        .await
        .unwrap();
    r.execute(caller("approval", Some(&token)), Action::MarketLookupGate)
        .await
        .unwrap();
    let binding: crate::market::ComparablesBinding = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::ComparablesPrepare(deal.id),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(binding.product_id, "monitor");
    assert_eq!(r.pipeline.wallet.ledger.audit_count().unwrap(), rows);
    let (actor, _events) = spawn(r);
    let answer = actor
        .market_comparables(
            caller("approval", Some(&token)),
            MarketComparablesArgs { deal_id: deal.id },
        )
        .await
        .unwrap();
    assert_eq!(
        answer
            .comparables
            .iter()
            .map(|c| c.id.as_str())
            .collect::<Vec<_>>(),
        ["other-1", "other-2"]
    );
    // One shop is cheaper on the identical product id; the cheaper different product is not it.
    assert_eq!(answer.cheaper.len(), 1, "{answer:?}");
    assert_eq!(answer.cheaper[0].shop, "cheap.example");
    assert_eq!(answer.cheaper[0].saving_minor, 500);
    // The finder reads touch no PayPal path and no price check is counted.
    assert!(http.0.lock().unwrap().paths.is_empty());
    let facts: OwnerFacts = actor
        .execute(caller("main", None), Action::OwnerFacts)
        .await
        .unwrap();
    assert!(facts.market_watch.iter().all(|w| w.used_today == 0));
    // Another window, or no token, is refused before any market call.
    let before = finder.calls.load(Ordering::SeqCst);
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        assert!(
            actor
                .market_search(
                    who,
                    MarketSearchArgs {
                        query: "monitor".into()
                    }
                )
                .await
                .is_err()
        );
    }
    assert_eq!(finder.calls.load(Ordering::SeqCst), before);
    let hits = actor
        .market_search(
            caller("approval", Some(&token)),
            MarketSearchArgs {
                query: "monitor".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(hits[0].id, "found-1");
    let hit = actor
        .market_lookup(
            caller("approval", Some(&token)),
            MarketLookupArgs {
                url: "https://shop.example/p".into(),
            },
        )
        .await
        .unwrap();
    assert_eq!(hit.id, "found-2");
}

#[tokio::test]
async fn a_missing_market_key_is_told_calmly_and_a_seller_is_never_told_of_a_cheaper_shop() {
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Seller);
    r.selected = Some(deal.id);
    let token = unlock_runtime(&mut r);
    let finder = Arc::new(Finder {
        calls: AtomicUsize::new(0),
        unit: deal.terms.unit_price,
        no_key: false,
    });
    r.attach_market(finder);
    let (actor, _events) = spawn(r);
    let answer = actor
        .market_comparables(
            caller("approval", Some(&token)),
            MarketComparablesArgs { deal_id: deal.id },
        )
        .await
        .unwrap();
    assert!(answer.cheaper.is_empty());
    assert_eq!(answer.comparables.len(), 2);

    let (mut r, _, _, _, _) = runtime(true);
    let token = unlock_runtime(&mut r);
    r.attach_market(Arc::new(Finder {
        calls: AtomicUsize::new(0),
        unit: Money::new(1, Currency::USD).unwrap(),
        no_key: true,
    }));
    let (actor, _events) = spawn(r);
    let error = actor
        .market_search(
            caller("approval", Some(&token)),
            MarketSearchArgs {
                query: "monitor".into(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Unavailable));
    assert_eq!(error.message, crate::market::NO_MARKET_KEY);
}
