//! Shield slice 2 (migration 0013): the recorded verdict, its rule and terms, the owner's
//! release bound to the released terms, and one refusal row per (deal, step, verdict).
#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::*;
use crate::tests::setup;
use rusqlite::params;
use table_core::*;

fn rows(ledger: &Ledger, id: DealId, action: &str) -> Vec<AuditRecord> {
    let (rows, _) = ledger.audit_page(None, 1000).unwrap();
    rows.into_iter()
        .filter(|r| r.deal_id == Some(id) && r.action == action)
        .collect()
}
/// Changes the deal's price the way a counter does (terms and their hash together).
fn reprice(ledger: &Ledger, id: DealId, minor: i64) {
    let mut terms = ledger.get_deal(id).unwrap().terms;
    terms.unit_price = Money::new(minor, terms.currency).unwrap();
    ledger
        .conn
        .execute(
            "UPDATE deals SET unit_price_minor=?1,terms_hash=?2 WHERE id=?3",
            params![minor, &terms.hash().unwrap().0[..], id.to_string()],
        )
        .unwrap();
}

#[test]
fn a_computed_verdict_is_recorded_once_with_its_rule_and_a_terms_change_judges_again() {
    let (mut ledger, deal, ..) = setup();
    let terms = deal.terms.hash().unwrap();
    let before = ledger.audit_count().unwrap();
    // An ASK the rules computed is bookkeeping, recorded once however often it is computed.
    for at in [101, 102, 103] {
        let wrote = ledger
            .record_shield(
                deal.id,
                ShieldVerdict::Ask,
                Some(ShieldRule::NoMarketReference),
                terms,
                at,
            )
            .unwrap();
        assert_eq!(wrote, at == 101);
    }
    assert_eq!(ledger.audit_count().unwrap(), before + 1);
    let checked = rows(&ledger, deal.id, "shield.checked");
    assert_eq!(checked.len(), 1);
    assert_eq!(checked[0].detail["rule"], "no_market_reference");
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield, Some(ShieldVerdict::Ask));
    assert_eq!(d.shield_rule, Some(ShieldRule::NoMarketReference));
    assert!(!d.shield_held());

    // A price HOLD is a pause the owner sees: `shield.raised`, and the deal is held.
    assert!(
        ledger
            .record_shield(
                deal.id,
                ShieldVerdict::Hold,
                Some(ShieldRule::PriceOverMarket),
                terms,
                104,
            )
            .unwrap()
    );
    let raised = rows(&ledger, deal.id, "shield.raised");
    assert_eq!(raised.len(), 1);
    assert_eq!(raised[0].detail["verdict"], "HOLD");
    assert_eq!(raised[0].detail["rule"], "price_over_market");
    assert!(ledger.get_deal(deal.id).unwrap().shield_held());

    // A counter changes the terms: the verdict computed for the old terms is not projected, so
    // the shield judges the new terms afresh at the next money step.
    reprice(&ledger, deal.id, 20000);
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!((d.shield, d.shield_rule), (None, None));
    assert!(!d.shield_held());
    let new_terms = d.terms.hash().unwrap();
    assert!(
        ledger
            .record_shield(deal.id, ShieldVerdict::Clear, None, new_terms, 105)
            .unwrap()
    );
    assert_eq!(
        ledger.get_deal(deal.id).unwrap().shield,
        Some(ShieldVerdict::Clear)
    );
    ledger.verify_audit().unwrap();
}

#[test]
fn a_raised_verdict_holds_whatever_the_terms_and_only_ever_goes_up() {
    let (mut ledger, deal, ..) = setup();
    let terms = deal.terms.hash().unwrap();
    ledger
        .raise_shield(deal.id, ShieldVerdict::Ask, 101)
        .unwrap();
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield, Some(ShieldVerdict::Ask));
    assert_eq!(d.shield_rule, Some(ShieldRule::ModelCaution));
    // A computed CLEAR or an equal ASK never lowers or renames a raised verdict.
    for (verdict, rule) in [
        (ShieldVerdict::Clear, None),
        (ShieldVerdict::Ask, Some(ShieldRule::NoMarketReference)),
    ] {
        assert!(
            !ledger
                .record_shield(deal.id, verdict, rule, terms, 102)
                .unwrap()
        );
    }
    // A higher computed verdict raises it further, and it stays raised across a terms change.
    assert!(
        ledger
            .record_shield(
                deal.id,
                ShieldVerdict::Hold,
                Some(ShieldRule::PriceOverMarket),
                terms,
                103,
            )
            .unwrap()
    );
    reprice(&ledger, deal.id, 100);
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield, Some(ShieldVerdict::Hold));
    assert_eq!(d.shield_rule, Some(ShieldRule::PriceOverMarket));
    assert!(d.shield_held());
}

#[test]
fn a_release_covers_its_terms_and_rules_only_and_a_block_is_never_released_or_lowered() {
    let (mut ledger, deal, ..) = setup();
    let terms = deal.terms.hash().unwrap();
    // Nothing to release yet, and a release for other terms is refused.
    assert!(matches!(
        ledger.release_shield_hold(deal.id, &[ShieldRule::ModelCaution], terms, 101),
        Err(LedgerError::Conflict)
    ));
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 101)
        .unwrap();
    assert!(matches!(
        ledger.release_shield_hold(deal.id, &[ShieldRule::ModelCaution], H256::ZERO, 102),
        Err(LedgerError::Conflict)
    ));
    assert!(matches!(
        ledger.release_shield_hold(deal.id, &[], terms, 102),
        Err(LedgerError::Conflict)
    ));
    ledger
        .release_shield_hold(deal.id, &[ShieldRule::ModelCaution], terms, 102)
        .unwrap();
    let d = ledger.get_deal(deal.id).unwrap();
    // The HOLD stays recorded (the release sits beside it, the owner's decision); the deal reads
    // ASK while the release covers it: the owner's decision is the check.
    assert_eq!(d.shield, Some(ShieldVerdict::Ask));
    assert_eq!(d.shield_recorded(), Some(ShieldVerdict::Hold));
    assert!(d.shield_released());
    let raw: String = ledger
        .conn
        .query_row(
            "SELECT shield_verdict FROM deals WHERE id=?1",
            [deal.id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(raw, "HOLD");
    assert_eq!(
        d.shield_release,
        Some(ShieldRelease {
            terms_hash: terms,
            rules: vec![ShieldRule::ModelCaution],
            at: 102,
        })
    );
    assert_eq!(d.decided_by, Some(DecidedBy::Human { at: 102 }));
    assert!(!d.shield_held());
    let released = rows(&ledger, deal.id, "shield.released");
    assert_eq!(released.len(), 1);
    assert_eq!(released[0].actor, "owner");
    assert_eq!(released[0].detail["decided_by"]["type"], "human");
    assert_eq!(released[0].detail["rules"][0], "model_caution");

    // Another rule is not covered by this release.
    let mut other = d.clone();
    other.shield = Some(ShieldVerdict::Hold);
    other.shield_rule = Some(ShieldRule::PriceOverMarket);
    assert!(other.shield_held());
    // A terms change drops the release: the raised HOLD holds again.
    reprice(&ledger, deal.id, 30000);
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield_release, None);
    assert_eq!(d.shield, Some(ShieldVerdict::Hold));
    assert!(d.shield_held());
    reprice(&ledger, deal.id, deal.terms.unit_price.minor());
    assert!(!ledger.get_deal(deal.id).unwrap().shield_held());
    // A new raised HOLD is new information: the release is dropped.
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 103)
        .unwrap();
    assert!(ledger.get_deal(deal.id).unwrap().shield_held());

    // A BLOCK is final: never released, never lowered, not even by a direct write.
    ledger
        .raise_shield_for(
            deal.id,
            ShieldVerdict::Block,
            ShieldRule::PayeeMismatch,
            104,
        )
        .unwrap();
    assert!(matches!(
        ledger.release_shield_hold(deal.id, &[ShieldRule::PayeeMismatch], terms, 105),
        Err(LedgerError::Conflict)
    ));
    for sql in [
        "UPDATE deals SET shield_verdict='HOLD' WHERE id=?1",
        "UPDATE deals SET shield_verdict=NULL WHERE id=?1",
        "UPDATE deals SET shield_release_json='{}' WHERE id=?1",
    ] {
        assert!(
            ledger.conn.execute(sql, [deal.id.to_string()]).is_err(),
            "{sql}"
        );
    }
    assert!(
        !ledger
            .record_shield(deal.id, ShieldVerdict::Clear, None, terms, 106)
            .unwrap()
    );
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield, Some(ShieldVerdict::Block));
    assert_eq!(d.shield_rule, Some(ShieldRule::PayeeMismatch));
    ledger.verify_audit().unwrap();
}

#[test]
fn a_released_raised_hold_does_not_hide_a_new_hold_for_another_rule() {
    let (mut ledger, deal, ..) = setup();
    let terms = deal.terms.hash().unwrap();
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 101)
        .unwrap();
    ledger
        .release_shield_hold(deal.id, &[ShieldRule::ModelCaution], terms, 102)
        .unwrap();
    assert!(!ledger.get_deal(deal.id).unwrap().shield_held());
    // The rules now hold the price too: the deal shows a hold naming the price rule, and the
    // release of the second opinion's caution stays beside it.
    let price = Some(ShieldRule::PriceOverMarket);
    assert!(
        ledger
            .record_shield(deal.id, ShieldVerdict::Hold, price, terms, 103)
            .unwrap()
    );
    let d = ledger.get_deal(deal.id).unwrap();
    assert!(d.shield_held());
    assert_eq!(d.shield, Some(ShieldVerdict::Hold));
    assert_eq!(d.shield_rule, price);
    assert_eq!(
        d.shield_release.as_ref().map(|r| r.rules.clone()),
        Some(vec![ShieldRule::ModelCaution])
    );
    let raised = rows(&ledger, deal.id, "shield.raised");
    let newest = raised.iter().max_by_key(|r| r.at).unwrap();
    assert_eq!(newest.detail["rule"], "price_over_market");
    // Judged again every tick, it is recorded once.
    assert!(
        !ledger
            .record_shield(deal.id, ShieldVerdict::Hold, price, terms, 104)
            .unwrap()
    );
    // The price stops holding: only the released caution is left, and the deal reads released.
    assert!(
        ledger
            .record_shield(
                deal.id,
                ShieldVerdict::Hold,
                Some(ShieldRule::ModelCaution),
                terms,
                105
            )
            .unwrap()
    );
    let d = ledger.get_deal(deal.id).unwrap();
    assert!(!d.shield_held() && d.shield_released());
    assert!(
        !ledger
            .record_shield(
                deal.id,
                ShieldVerdict::Hold,
                Some(ShieldRule::ModelCaution),
                terms,
                106
            )
            .unwrap()
    );
    // Without a release, a raised HOLD keeps its own rule (nothing is hidden).
    let (mut ledger, deal, ..) = setup();
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 101)
        .unwrap();
    assert!(
        !ledger
            .record_shield(deal.id, ShieldVerdict::Hold, price, terms, 102)
            .unwrap()
    );
    let d = ledger.get_deal(deal.id).unwrap();
    assert!(d.shield_held());
    assert_eq!(d.shield_rule, Some(ShieldRule::ModelCaution));
    ledger.verify_audit().unwrap();
}

#[test]
fn a_refused_step_is_recorded_once_per_step_and_verdict() {
    let (mut ledger, deal, ..) = setup();
    let seller = DecidedBy::SellerMandate {
        mandate_hash: H256::ZERO,
    };
    let refuse = |ledger: &mut Ledger, step, verdict, at| {
        ledger
            .record_shield_refusal(
                deal.id,
                step,
                1,
                verdict,
                Some(ShieldRule::PriceOverMarket),
                &seller,
                at,
            )
            .unwrap()
    };
    assert!(refuse(&mut ledger, "authorize", ShieldVerdict::Hold, 101));
    for at in 102..110 {
        assert!(!refuse(&mut ledger, "authorize", ShieldVerdict::Hold, at));
    }
    // Another step or another verdict is another refusal.
    assert!(refuse(&mut ledger, "capture", ShieldVerdict::Hold, 110));
    assert!(refuse(&mut ledger, "authorize", ShieldVerdict::Block, 111));
    let refused = rows(&ledger, deal.id, "shield.refused");
    assert_eq!(refused.len(), 3);
    let first = refused.iter().find(|r| r.at == 101).unwrap();
    assert_eq!(first.detail["step"], "authorize");
    assert_eq!(first.detail["rule"], "price_over_market");
    assert_eq!(first.detail["refused_authority"]["type"], "seller_mandate");
    // A refusal is recorded, never a PayPal call.
    assert_eq!(ledger.paypal_call_count(deal.id).unwrap(), 0);
    ledger.verify_audit().unwrap();
}

#[test]
fn a_step_refused_again_after_a_release_and_a_new_hold_is_a_second_refusal() {
    let (mut ledger, deal, ..) = setup();
    let terms = deal.terms.hash().unwrap();
    let seller = DecidedBy::SellerMandate {
        mandate_hash: H256::ZERO,
    };
    let refuse = |ledger: &mut Ledger, rule, at| {
        ledger
            .record_shield_refusal(
                deal.id,
                "authorize",
                1,
                ShieldVerdict::Hold,
                Some(rule),
                &seller,
                at,
            )
            .unwrap()
    };
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 101)
        .unwrap();
    assert!(refuse(&mut ledger, ShieldRule::ModelCaution, 102));
    assert!(!refuse(&mut ledger, ShieldRule::ModelCaution, 103));
    // Another rule holding the same step is another refusal.
    assert!(refuse(&mut ledger, ShieldRule::PriceOverMarket, 104));
    // The owner releases the hold; a new second opinion raises it again; the step is refused
    // again for the same rule: a real second refusal, with its own row.
    ledger
        .release_shield_hold(deal.id, &[ShieldRule::ModelCaution], terms, 105)
        .unwrap();
    ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 106)
        .unwrap();
    assert!(refuse(&mut ledger, ShieldRule::ModelCaution, 107));
    assert!(!refuse(&mut ledger, ShieldRule::ModelCaution, 108));
    // A terms change is another refusal too.
    reprice(&ledger, deal.id, 30000);
    assert!(refuse(&mut ledger, ShieldRule::ModelCaution, 109));
    assert!(!refuse(&mut ledger, ShieldRule::ModelCaution, 110));
    let refused = rows(&ledger, deal.id, "shield.refused");
    let mut at: Vec<_> = refused.iter().map(|r| r.at).collect();
    at.sort_unstable();
    assert_eq!(at, [102, 104, 107, 109]);
    let first = refused.iter().find(|r| r.at == 102).unwrap();
    assert_eq!(first.detail["terms_hash"], serde_json::json!(terms));
    ledger.verify_audit().unwrap();
}

#[test]
fn migration_0013_reads_an_older_raised_verdict_as_the_second_opinions() {
    let (ledger, deal, ..) = setup();
    let conn = ledger.conn;
    conn.execute_batch(
        "DROP TRIGGER deals_block_stays; DROP TRIGGER deals_block_never_released; ALTER TABLE deals DROP COLUMN shield_rule; ALTER TABLE deals DROP COLUMN shield_terms; ALTER TABLE deals DROP COLUMN shield_release_json; PRAGMA user_version=12;",
    )
    .unwrap();
    conn.execute(
        "UPDATE deals SET shield_verdict='HOLD' WHERE id=?1",
        [deal.id.to_string()],
    )
    .unwrap();
    let ledger = Ledger::from_connection(conn).unwrap();
    let d = ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.shield, Some(ShieldVerdict::Hold));
    assert_eq!(d.shield_rule, Some(ShieldRule::ModelCaution));
    assert!(d.shield_held());
}
