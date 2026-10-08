//! Market watch in the ledger (T15): every price check is an audit row written before the fetch,
//! and a day's allowance is never exceeded.
use super::*;

#[test]
fn price_checks_are_audited_first_counted_per_mandate_and_utc_day_and_never_exceed_the_allowance() {
    let (mut ledger, deal, ..) = setup();
    let item = ItemRef::new("monitor").unwrap();
    let other: MandateId = "00000000000000000000000009".parse().unwrap();
    let day = 86_400 * 20;
    let check = |mandate_id, max_per_day| MarketCheck {
        deal_id: deal.id,
        mandate_id,
        mandate_version: 1,
        mandate_hash: H256::digest(b"mandate"),
        item_ref: &item,
        product_id: "p-monitor",
        max_per_day,
    };
    let before = ledger.audit_count().unwrap();
    for n in 1..=3 {
        assert_eq!(
            ledger
                .reserve_market_check(&check(deal.mandate_id, 3), day + 100 + i64::from(n))
                .unwrap(),
            n
        );
    }
    // The fourth check of the day is refused and writes nothing.
    assert!(matches!(
        ledger.reserve_market_check(&check(deal.mandate_id, 3), day + 200),
        Err(LedgerError::Conflict)
    ));
    assert_eq!(ledger.audit_count().unwrap(), before + 3);
    assert_eq!(
        ledger
            .market_checks_today(deal.mandate_id, day + 86_399)
            .unwrap(),
        3
    );
    // Another mandate's rule has its own allowance; the next UTC day starts again.
    assert_eq!(ledger.market_checks_today(other, day + 300).unwrap(), 0);
    assert_eq!(
        ledger
            .reserve_market_check(&check(other, 3), day + 300)
            .unwrap(),
        1
    );
    assert_eq!(
        ledger
            .market_checks_today(deal.mandate_id, day + 86_400)
            .unwrap(),
        0
    );
    assert_eq!(
        ledger
            .reserve_market_check(&check(deal.mandate_id, 3), day + 86_400)
            .unwrap(),
        1
    );
    // A smaller allowance (a re-signed rule) counts what the day already used.
    assert!(matches!(
        ledger.reserve_market_check(&check(deal.mandate_id, 1), day + 86_401),
        Err(LedgerError::Conflict)
    ));
    let rows: Vec<(String, String)> = {
        let mut q = ledger
            .conn
            .prepare("SELECT actor,detail_json FROM audit_log WHERE action='market.checked' ORDER BY seq")
            .unwrap();
        q.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    };
    assert_eq!(rows.len(), 5);
    let detail: serde_json::Value = serde_json::from_str(&rows[0].1).unwrap();
    assert_eq!(rows[0].0, "market");
    assert_eq!(detail["product_id"], "p-monitor");
    assert_eq!(detail["item_ref"], "monitor");
    assert_eq!(detail["count"], 1);
    assert_eq!(detail["day"], day);
    ledger.verify_audit().unwrap();
}
