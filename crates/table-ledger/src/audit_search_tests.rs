//! `audit_search`: the filter, the order and the count run in SQL over every row, and the chain
//! check is skipped only while nothing has been written.
use super::*;
use serde_json::json;

fn row(at: i64, actor: &str, action: &str, from: Option<&str>, to: Option<&str>) -> AuditEntry {
    AuditEntry {
        at,
        actor: actor.into(),
        action: action.into(),
        deal_id: None,
        detail: match (from, to) {
            (Some(from), Some(to)) => json!({"from": from, "to": to}),
            _ => json!({}),
        },
    }
}
fn query(
    filter: Option<&str>,
    newest_first: bool,
    before: Option<u64>,
    limit: u16,
) -> AuditQuery<'_> {
    AuditQuery {
        before,
        limit,
        filter,
        newest_first,
    }
}
fn seqs(search: &AuditSearch) -> Vec<u64> {
    search.rows.iter().map(|r| r.seq).collect()
}
fn book() -> Ledger {
    let mut ledger = Ledger::in_memory().unwrap();
    for n in 0..30_i64 {
        let entry = match n % 3 {
            0 => row(n, "owner", "owner.decision", None, None),
            1 => row(
                n,
                "agent:buyer-1",
                "deal.transition",
                Some("AGREED"),
                Some("AWAITING_APPROVAL"),
            ),
            _ => row(
                n,
                "peer:47be",
                "deal.transition",
                Some("AUTHORIZED"),
                Some("CAPTURED"),
            ),
        };
        ledger.append_audit(&entry).unwrap();
    }
    ledger
}

#[test]
fn no_filter_pages_both_ways_and_counts_every_row() {
    let ledger = book();
    let newest = ledger.audit_search(&query(None, true, None, 10)).unwrap();
    assert_eq!(seqs(&newest), (21..=30).rev().collect::<Vec<_>>());
    assert!(newest.more);
    assert_eq!(newest.total_matching, 30);
    let next = ledger
        .audit_search(&query(None, true, Some(21), 10))
        .unwrap();
    assert_eq!(seqs(&next), (11..=20).rev().collect::<Vec<_>>());
    let oldest = ledger.audit_search(&query(None, false, None, 10)).unwrap();
    assert_eq!(seqs(&oldest), (1..=10).collect::<Vec<_>>());
    let after = ledger
        .audit_search(&query(None, false, Some(20), 10))
        .unwrap();
    assert_eq!(seqs(&after), (21..=30).collect::<Vec<_>>());
    assert!(!after.more);
    assert_eq!(after.total_matching, 30, "the count ignores the cursor");
}

#[test]
fn a_filter_matches_action_actor_status_change_and_decision_over_all_rows() {
    let ledger = book();
    for (text, expected) in [
        ("owner", 10),
        ("OWNER", 10),
        ("  owner  ", 10),
        ("agent:buyer", 10),
        ("peer", 10),
        ("captured", 10),
        ("awaiting approval", 10),
        ("awaiting_approval", 10),
        ("deal.transition", 20),
        ("transition", 20),
        ("nothing like this", 0),
        ("", 30),
    ] {
        let found = ledger
            .audit_search(&query(Some(text), true, None, 200))
            .unwrap();
        assert_eq!(found.total_matching, expected, "{text:?}");
        assert_eq!(found.rows.len() as u64, expected, "{text:?}");
    }
    // The count is about every match, not the page: 10 match, 4 are shown, in the order asked.
    let some = ledger
        .audit_search(&query(Some("captured"), false, None, 4))
        .unwrap();
    assert_eq!(
        (some.rows.len(), some.total_matching, some.more),
        (4, 10, true)
    );
    assert_eq!(seqs(&some), vec![3, 6, 9, 12]);
    let rest = ledger
        .audit_search(&query(Some("captured"), false, Some(12), 200))
        .unwrap();
    assert_eq!(seqs(&rest), vec![15, 18, 21, 24, 27, 30]);
    assert!(!rest.more);
}

#[test]
fn a_filter_is_text_and_never_a_pattern() {
    let ledger = book();
    for text in ["%", "' OR 1=1 --", "\\"] {
        let found = ledger
            .audit_search(&query(Some(text), true, None, 200))
            .unwrap();
        assert_eq!(found.total_matching, 0, "{text:?}");
    }
}

#[test]
fn a_filter_reaches_the_deal_item_of_a_row() {
    let ledger = crate::live_deals_tests::seeded(5);
    let every = ledger.audit_search(&query(None, true, None, 200)).unwrap();
    let of_a_deal = every.rows.iter().filter(|r| r.deal_id.is_some()).count() as u64;
    assert!(of_a_deal >= 5);
    let found = ledger
        .audit_search(&query(Some("care-plan"), true, None, 200))
        .unwrap();
    assert_eq!(found.total_matching, of_a_deal);
    assert!(found.rows.iter().all(|r| r.deal_id.is_some()));
}

#[test]
fn the_chain_is_walked_after_any_write_and_skipped_while_nothing_is_written() {
    let mut ledger = book();
    assert_eq!(ledger.audit_checked.get(), None);
    ledger.audit_search(&query(None, true, None, 5)).unwrap();
    let stamp = ledger.audit_checked.get();
    assert!(stamp.is_some());
    // Paging and filtering again writes nothing: the stamp stays, no walk is needed.
    ledger
        .audit_search(&query(Some("owner"), false, None, 5))
        .unwrap();
    assert_eq!(ledger.audit_checked.get(), stamp);
    // A write moves it, and the next read re-verifies.
    ledger
        .append_audit(&row(99, "owner", "owner.decision", None, None))
        .unwrap();
    ledger.audit_search(&query(None, true, None, 5)).unwrap();
    assert_ne!(ledger.audit_checked.get(), stamp);
}

#[test]
fn a_row_altered_after_a_good_read_fails_the_next_read_and_is_never_cached() {
    let mut ledger = book();
    ledger.audit_search(&query(None, true, None, 5)).unwrap();
    ledger
        .conn
        .execute_batch("DROP TRIGGER audit_no_update;")
        .unwrap();
    ledger
        .conn
        .execute("UPDATE audit_log SET action='changed' WHERE seq=2", [])
        .unwrap();
    for _ in 0..2 {
        assert!(matches!(
            ledger.audit_search(&query(None, true, None, 5)),
            Err(LedgerError::Integrity(_))
        ));
        assert_eq!(ledger.audit_checked.get(), None);
    }
    let _ = &mut ledger;
}
