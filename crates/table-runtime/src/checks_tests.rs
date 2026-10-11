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
    // The recorded HOLD stays; the owner's release sits beside it, for these terms and this rule,
    // and the deal reads ASK: the owner's decision is the check.
    let held = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(held.shield, Some(ShieldVerdict::Ask));
    assert_eq!(held.shield_recorded(), Some(ShieldVerdict::Hold));
    assert_eq!(held.shield_rule, Some(ShieldRule::ModelCaution));
    assert!(held.shield_released() && !held.shield_held());
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

/// How a test makes lines of the checklist fail on an agreed seller deal, using only what the
/// ledger and the clock offer (no stored SETTLE is forged, so the host line is not reachable here).
#[derive(Clone, Copy, Debug)]
enum Break {
    /// The scam check holds the deal.
    Shield,
    /// The clock passes the mandate's end.
    MandateExpired,
    /// The owner revoked the mandate: it is retired and no single payee can be read from it.
    MandateRevoked,
    /// A rescue fix with no failed renewal behind it: the amount and the invoice cannot be read.
    RescueWithoutCase,
}

impl Break {
    fn lines(self) -> &'static [ApprovalCheckId] {
        match self {
            Break::Shield => &[ApprovalCheckId::Shield],
            Break::MandateExpired => &[ApprovalCheckId::Mandate],
            Break::MandateRevoked => &[ApprovalCheckId::Payee, ApprovalCheckId::Mandate],
            Break::RescueWithoutCase => &[ApprovalCheckId::Amount, ApprovalCheckId::Invoice],
        }
    }
}

#[tokio::test]
async fn every_money_decision_is_refused_while_any_reachable_line_fails_with_no_call_and_no_write()
{
    for case in [
        Break::Shield,
        Break::MandateExpired,
        Break::MandateRevoked,
        Break::RescueWithoutCase,
    ] {
        let (mut r, vault, http, clock, _) = runtime(true);
        credentials(vault.as_ref());
        let (deal, peer) = setup(&mut r, Side::Seller);
        agree(&mut r, &deal, &peer);
        let mut id = deal.id;
        match case {
            Break::Shield => r
                .pipeline
                .wallet
                .ledger
                .raise_shield(deal.id, ShieldVerdict::Hold, 100)
                .unwrap(),
            Break::MandateExpired => clock.0.store(1_000_001, Ordering::SeqCst),
            Break::MandateRevoked => r
                .pipeline
                .wallet
                .ledger
                .revoke_mandate(deal.mandate_id, 150)
                .unwrap(),
            Break::RescueWithoutCase => {
                let mut fix = deal.clone();
                fix.id = format!("{:026}", 4000).parse().unwrap();
                fix.kind = DealKind::Rescue;
                r.pipeline.wallet.ledger.create_deal(&fix, 100).unwrap();
                id = fix.id;
            }
        }
        let token = unlock_runtime(&mut r);
        r.selected = Some(id);
        let summary = r.summary(id).unwrap();
        for line in case.lines() {
            assert_eq!(
                status(&summary, *line),
                ApprovalCheckStatus::Fail,
                "{case:?} should fail {line:?}"
            );
        }
        let args = decision(&mut r, id);
        assert_eq!(args.checks_hash, Some(summary.checks_hash));
        let audit_before = r.pipeline.wallet.ledger.audit_count().unwrap();
        for d in [
            Decision::OwnerAccept,
            Decision::Countersign,
            Decision::Capture,
            Decision::Rescue,
            Decision::ReleaseHold,
            Decision::OpenBrowser,
        ] {
            // Unpausing is the decision about the shield line, so it alone may pass that line.
            if matches!(case, Break::Shield) && matches!(d, Decision::ReleaseHold) {
                continue;
            }
            let error = r
                .execute(
                    caller("approval", Some(&token)),
                    Action::Decision(args.clone(), d),
                )
                .await
                .unwrap_err();
            assert_eq!(error.message, crate::CHECK_FAILED, "{case:?} {d:?}");
            assert!(matches!(error.code, ErrorCode::Invalid), "{case:?} {d:?}");
        }
        assert!(http.0.lock().unwrap().paths.is_empty(), "{case:?}");
        assert_eq!(
            r.pipeline.wallet.ledger.paypal_call_count(id).unwrap(),
            0,
            "{case:?}"
        );
        assert_eq!(
            r.pipeline.wallet.ledger.audit_count().unwrap(),
            audit_before,
            "{case:?}"
        );
        assert!(
            !r.pipeline.wallet.ledger.has_countersign(id, 1).unwrap(),
            "{case:?}"
        );
    }
}

#[tokio::test]
async fn a_ledger_change_after_the_summary_makes_its_real_hash_stale_for_every_money_decision() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    // The owner reads the summary and decides on the hash it carried.
    let seen = r.summary(deal.id).unwrap();
    let args = decision(&mut r, deal.id);
    assert_eq!(args.checks_hash, Some(seen.checks_hash));
    // The ledger moves on before the decision: the scam check now asks the owner. No line fails,
    // so the only thing that stops the decision is the hash the owner saw.
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Ask, 100)
        .unwrap();
    let now = r.summary(deal.id).unwrap();
    assert!(
        now.checks
            .iter()
            .all(|c| c.status != ApprovalCheckStatus::Fail)
    );
    assert_ne!(now.checks_hash, seen.checks_hash);
    let audit_before = r.pipeline.wallet.ledger.audit_count().unwrap();
    for d in [
        Decision::OwnerAccept,
        Decision::Countersign,
        Decision::Capture,
        Decision::Rescue,
        Decision::ReleaseHold,
        Decision::OpenBrowser,
    ] {
        let error = r
            .execute(
                caller("approval", Some(&token)),
                Action::Decision(args.clone(), d),
            )
            .await
            .unwrap_err();
        assert_eq!(error.message, crate::SUMMARY_CHANGED, "{d:?}");
        assert!(matches!(error.code, ErrorCode::Invalid), "{d:?}");
    }
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert_eq!(
        r.pipeline.wallet.ledger.audit_count().unwrap(),
        audit_before
    );
    // The hash the owner sees now is accepted.
    let fresh = decision(&mut r, deal.id);
    assert_eq!(fresh.checks_hash, Some(now.checks_hash));
}
