//! market-data-2: a re-checkable market record is stored only for the product the deal's rules
//! bind to its item, and goes into the hash chain whole, so the snapshot a deal is agreed on can
//! be computed again from the wallet's own rows.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::*;
use crate::tests::setup;

fn record(product: &str, prices: &[i64]) -> MarketRef {
    let money: Vec<Money> = prices
        .iter()
        .map(|m| Money::new(*m, Currency::USD).unwrap())
        .collect();
    let mut band =
        MarketRef::certified_prices(product, H256::digest(b"raw bytes"), &money, 100).unwrap();
    band.cached = true;
    band
}

#[test]
fn a_market_record_for_a_product_not_bound_to_the_deals_item_is_refused() {
    let (mut ledger, deal, ..) = setup();
    assert_eq!(deal.terms.item_ref.as_str(), "monitor");
    let before = ledger.audit_count().unwrap();
    // No market-watch rule names the item; the item itself is the bound product.
    assert!(matches!(
        ledger.store_market_reference(deal.id, &record("another-product", &[1010, 2020]), 100),
        Err(LedgerError::Conflict)
    ));
    assert_eq!(ledger.audit_count().unwrap(), before);
    assert!(ledger.get_deal(deal.id).unwrap().market.is_none());

    let bound = record("monitor", &[2020, 1010]);
    ledger.store_market_reference(deal.id, &bound, 100).unwrap();
    let stored = ledger.get_deal(deal.id).unwrap().market.unwrap();
    assert_eq!(stored.median.minor(), 1515);
    let (rows, _) = ledger.audit_page(None, 1000).unwrap();
    let observed = rows
        .iter()
        .rfind(|r| r.deal_id == Some(deal.id) && r.action == "market.observed")
        .unwrap();
    // The row carries the whole record and its digest; the market client's cache flag is not
    // part of what was observed.
    let kept: MarketRef = serde_json::from_value(observed.detail["reference"].clone()).unwrap();
    kept.validate().unwrap();
    assert!(!kept.cached);
    assert_eq!(
        kept.certificate.as_ref().unwrap().comparables[0].minor,
        1010
    );
    assert_eq!(
        serde_json::from_value::<H256>(observed.detail["digest"].clone()).unwrap(),
        bound.digest().unwrap().unwrap()
    );
    // Not agreed yet: the evidence shows the latest record, not committed.
    let fair = ledger.deal_evidence(deal.id).unwrap().fair_price.unwrap();
    assert_eq!(
        (fair.state, fair.committed, fair.prices),
        (FairPriceState::Rechecked, false, 2)
    );

    // An older record (no certificate) is still accepted and reads as not re-checkable.
    let older = MarketRef::from_comparables(
        vec![Money::new(1500, Currency::USD).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    ledger.store_market_reference(deal.id, &older, 101).unwrap();
    let fair = ledger.deal_evidence(deal.id).unwrap().fair_price.unwrap();
    assert_eq!(fair.state, FairPriceState::NotRecheckable);
    ledger.verify_audit().unwrap();
}
