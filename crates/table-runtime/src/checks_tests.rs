//! Approval checks bound to the decision (moonshot T5, approval-window-1): the summary carries
//! the Rust-composed checklist and its hash; a money decision with a missing or stale hash, or
//! taken while a check fails, is refused before any PayPal call or write; the decision's audit
//! row carries the hash next to `decided_by`.
use super::*;

fn decision_rows(r: &Runtime, id: DealId) -> Vec<table_ledger::AuditRecord> {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.into_iter()
        .filter(|row| row.deal_id == Some(id) && row.action == "owner.decision")
        .collect()
}
fn status(s: &ApprovalSummary, id: ApprovalCheckId) -> ApprovalCheckStatus {
    s.checks.iter().find(|c| c.id == id).unwrap().status
}

#[tokio::test]
async fn a_decision_with_a_missing_or_stale_checks_hash_is_refused_before_any_paypal_call_or_write()
{
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);

    let summary = r.summary(deal.id).unwrap();
    assert_eq!(summary.checks.len(), 6);
    assert_eq!(summary.checks_hash, checks_hash(&summary.checks).unwrap());
    // Before the order exists its amount, link and order number wait for that step.
    assert_eq!(
        status(&summary, ApprovalCheckId::Amount),
        ApprovalCheckStatus::Wait
    );
    assert_eq!(
        status(&summary, ApprovalCheckId::Host),
        ApprovalCheckStatus::Wait
    );
    assert_eq!(
        status(&summary, ApprovalCheckId::Invoice),
        ApprovalCheckStatus::Wait
    );
    assert_eq!(
        status(&summary, ApprovalCheckId::Payee),
        ApprovalCheckStatus::Pass
    );
    assert_eq!(
        status(&summary, ApprovalCheckId::Mandate),
        ApprovalCheckStatus::Pass
    );

    let fresh = decision(&mut r, deal.id);
    assert_eq!(fresh.checks_hash, Some(summary.checks_hash));
    let audit_before = r.pipeline.wallet.ledger.audit_count().unwrap();
    let mut missing = fresh.clone();
    missing.checks_hash = None;
    let mut stale = fresh.clone();
    stale.checks_hash = Some(H256([9; 32]));
    for args in [missing, stale] {
        for d in [
            Decision::Countersign,
            Decision::Capture,
            Decision::OwnerAccept,
            Decision::ReleaseHold,
            Decision::OpenBrowser,
            Decision::Rescue,
        ] {
            let error = r
                .execute(
                    caller("approval", Some(&token)),
                    Action::Decision(args.clone(), d),
                )
                .await
                .unwrap_err();
            assert_eq!(error.message, crate::SUMMARY_CHANGED, "{d:?}");
            assert!(matches!(error.code, ErrorCode::Invalid));
        }
    }
    // Void is the safe direction: it never asks for the hash (here it is refused for its state).
    let mut void = fresh.clone();
    void.checks_hash = None;
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(void, Decision::Void),
        )
        .await
        .unwrap_err();
    assert_ne!(error.message, crate::SUMMARY_CHANGED);

    // Nothing reached PayPal and nothing was written.
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert_eq!(
        r.pipeline.wallet.ledger.audit_count().unwrap(),
        audit_before
    );
    assert!(
        !r.pipeline
            .wallet
            .ledger
            .has_countersign(deal.id, 1)
            .unwrap()
    );
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );

    // The hash the owner saw goes through, and its audit row carries it next to decided_by.
    let now = r.clock.now();
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(fresh, Decision::Countersign),
    )
    .await
    .unwrap();
    let rows = decision_rows(&r, deal.id);
    let [row] = rows.as_slice() else {
        panic!("one decision row, got {rows:?}");
    };
    assert_eq!(row.actor, "owner");
    assert_eq!(row.detail["decision"], "deal_countersign");
    assert_eq!(
        serde_json::from_value::<H256>(row.detail["checks_hash"].clone()).unwrap(),
        summary.checks_hash
    );
    assert_eq!(
        serde_json::from_value::<DecidedBy>(row.detail["decided_by"].clone()).unwrap(),
        DecidedBy::Human { at: now }
    );
    // The money row that follows carries the same authority.
    let (all, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    let money = all
        .iter()
        .find(|x| x.deal_id == Some(deal.id) && x.action == "money.authorized")
        .unwrap();
    assert!(money.seq > row.seq);
    assert_eq!(
        serde_json::from_value::<DecidedBy>(money.detail["decided_by"].clone()).unwrap(),
        DecidedBy::Human { at: now }
    );
    r.pipeline.wallet.ledger.verify_audit().unwrap();

    // Once the order exists, the same lines compare what PayPal holds with the signed terms.
    let after = r.summary(deal.id).unwrap();
    assert_eq!(after.deal.state, DealState::AwaitingApproval);
    for id in [
        ApprovalCheckId::Amount,
        ApprovalCheckId::Host,
        ApprovalCheckId::Invoice,
    ] {
        assert_eq!(status(&after, id), ApprovalCheckStatus::Pass, "{id:?}");
    }
    assert_ne!(after.checks_hash, summary.checks_hash);
}

#[tokio::test]
async fn a_decision_while_a_check_fails_is_refused_and_a_release_may_fail_only_the_shield_line() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Hold, 100)
        .unwrap();
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let summary = r.summary(deal.id).unwrap();
    assert_eq!(
        status(&summary, ApprovalCheckId::Shield),
        ApprovalCheckStatus::Fail
    );
    let args = decision(&mut r, deal.id);
    let audit_before = r.pipeline.wallet.ledger.audit_count().unwrap();
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args.clone(), Decision::Countersign),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::CHECK_FAILED);
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert_eq!(
        r.pipeline.wallet.ledger.audit_count().unwrap(),
        audit_before
    );

    // Unpausing is the decision about that line, so it goes through and records the hash.
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::ReleaseHold),
    )
    .await
    .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().shield,
        Some(ShieldVerdict::Ask)
    );
    let rows = decision_rows(&r, deal.id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].detail["decision"], "shield_release");
    assert_eq!(
        serde_json::from_value::<H256>(rows[0].detail["checks_hash"].clone()).unwrap(),
        summary.checks_hash
    );
    // The shield line now passes (ASK: the owner's decision is the check) and the hash moved on.
    let released = r.summary(deal.id).unwrap();
    assert_eq!(
        status(&released, ApprovalCheckId::Shield),
        ApprovalCheckStatus::Pass
    );
    assert_ne!(released.checks_hash, summary.checks_hash);
    assert!(http.0.lock().unwrap().paths.is_empty());
}
