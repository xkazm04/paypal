//! Relay cadence checks when the clock steps backwards: a time later than `now` counts as elapsed.
use super::*;
use crate::tests::setup;
use table_core::{DealId, Timestamp};

fn receipt_at(ledger: &Ledger, id: DealId, at: Timestamp) {
    ledger
        .conn
        .execute(
            "UPDATE deals SET state='RECEIPTED' WHERE id=?1",
            [id.to_string()],
        )
        .unwrap();
    audit::append(
        &ledger.conn,
        &AuditEntry {
            at,
            actor: "policy".into(),
            action: "deal.transition".into(),
            deal_id: Some(id),
            detail: serde_json::json!({"from":table_core::DealState::Captured,"to":table_core::DealState::Receipted}),
        },
    )
    .unwrap();
}

#[test]
fn settled_route_polled_in_the_future_is_due_after_the_clock_steps_back() {
    let (mut ledger, deal, _, _, _) = setup();
    ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    let settled = 1_000_000;
    receipt_at(&ledger, deal.id, settled);
    let now = settled + 7200;
    let mut clock = SettledPollClock::default();
    let due = clock.due(ledger.relay_work_at(now).unwrap(), now);
    clock.polled(&due, now);
    // Control: a moment later the route is still waiting out its interval.
    assert!(
        clock
            .due(ledger.relay_work_at(now + 1).unwrap(), now + 1)
            .is_empty()
    );
    // The clock steps back an hour: the last poll is in the future, so the route is due.
    let back = now - 3600;
    assert_eq!(
        clock.due(ledger.relay_work_at(back).unwrap(), back).len(),
        1
    );
}

#[test]
fn settlement_later_than_now_is_clamped_and_ages_as_zero_not_past_the_window() {
    let (mut ledger, deal, _, _, _) = setup();
    ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    receipt_at(&ledger, deal.id, 1_000_000);
    let now = 1_000_000 - 500;
    let work = ledger.relay_work_at(now).unwrap();
    assert_eq!(work.len(), 1);
    assert_eq!(work[0].settled_at, Some(now));
}
