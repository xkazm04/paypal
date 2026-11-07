//! The approval window reads the wallet's own record, not its memory: the summary carries the
//! owner's newest decision on the attempt (`decided`, checked against the list now and the owner
//! key) and the browser hand-off flag, and holds every money step while one is open with PayPal.
//! After a failed decision the record tells the three failure points apart: refused before the
//! ticket (no new row), refused after the row (a new row, nothing sent), and lost after the
//! reservation (a new row and an open money step). The Rewind gets one step per decision.
use super::*;

fn summary(r: &mut Runtime, id: DealId) -> ApprovalSummary {
    r.summary(id).unwrap()
}
async fn decide(
    r: &mut Runtime,
    token: &str,
    args: DecisionArgs,
    decision: Decision,
) -> Result<serde_json::Value, CommandError> {
    r.execute(
        caller("approval", Some(token)),
        Action::Decision(args, decision),
    )
    .await
}
/// A seller deal the owner ordered and that the wallet holds at PayPal (two owner decisions:
/// none, then the order on the owner's countersign).
async fn authorized(r: &mut Runtime) -> (Deal, String) {
    let (deal, peer) = setup_delivery(r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(r, &deal, &peer);
    let token = unlock_runtime(r);
    r.selected = Some(deal.id);
    let args = decision(r, deal.id);
    decide(r, &token, args, Decision::Countersign)
        .await
        .unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    (deal, token)
}

/// Verify (1): an authorize whose answer was lost is open with PayPal. The summary says so
/// (money_check on the authorize) and offers no money step (can_release false); it still names
/// the owner's decision that started it, signed by the owner key, on the list shown.
#[tokio::test]
async fn an_open_authorize_holds_every_money_step_and_the_summary_names_the_decision() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    assert!(
        summary(&mut r, deal.id).decided.is_none(),
        "no decision yet"
    );
    http.0.lock().unwrap().awaiting_payer = true;
    let args = decision(&mut r, deal.id);
    decide(&mut r, &token, args, Decision::Countersign)
        .await
        .unwrap();
    let created = summary(&mut r, deal.id).decided.unwrap();
    assert_eq!(created.operation, DecisionStep::Create);
    assert_eq!(created.decision, "deal_countersign");
    assert!(created.signed, "the owner key signed the decision");
    assert_eq!(created.checks.as_ref().map(Vec::len), Some(6));
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, DealEvent::OrderApproved, r.clock.now())
        .unwrap();
    let ready = summary(&mut r, deal.id);
    assert!(
        ready.can_release,
        "nothing open: {:?}",
        ready.unavailable_reason
    );
    assert!(ready.evidence.money_check.is_none());
    // The list moved on since the order was made (the payee and host lines can be checked now).
    assert!(!ready.decided.as_ref().unwrap().same_now);

    http.0.lock().unwrap().fail_authorize = true;
    let args = decision(&mut r, deal.id);
    let error = decide(&mut r, &token, args, Decision::Countersign)
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::REACHED_PAYPAL);
    let open = summary(&mut r, deal.id);
    assert_eq!(open.deal.state, DealState::Approved);
    assert!(!open.can_release, "a money step is open with PayPal");
    assert_eq!(
        open.evidence.money_check.map(|c| c.step),
        Some(MoneyCheckStep::Authorize)
    );
    let held = open.decided.unwrap();
    assert_eq!(held.operation, DecisionStep::Authorize);
    assert!(held.at >= created.at);
    assert!(held.signed);
    assert!(held.same_now, "the list the owner saw is the list now");
    assert_eq!(held.checks_hash, open.checks_hash);
}

/// P19, one test per failure point, read from the summary the window refetches.
#[tokio::test]
async fn the_record_tells_a_refusal_before_the_row_from_one_after_it_and_a_lost_step() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    let before = summary(&mut r, deal.id).decided.unwrap();
    assert_eq!(before.operation, DecisionStep::Create);

    // Before the ticket: a list that changed since it was shown is refused before any write.
    let mut stale = decision(&mut r, deal.id);
    stale.checks_hash = Some(H256::ZERO);
    let error = decide(&mut r, &token, stale, Decision::Capture)
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::SUMMARY_CHANGED);
    assert_eq!(summary(&mut r, deal.id).decided.unwrap(), before);

    // After the row: the capture's decision is recorded, then the pipeline refuses it (past the
    // deadline) before any PayPal call. A newer row, nothing open, the state unchanged.
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    let paths = http.0.lock().unwrap().paths.len();
    clock.0.store(due + 1, Ordering::SeqCst);
    // The clock jump idle-locked the wallet: the owner unlocks again.
    let token = unlock_runtime(&mut r);
    let args = decision(&mut r, deal.id);
    let error = decide(&mut r, &token, args, Decision::Capture)
        .await
        .unwrap_err();
    assert_ne!(error.message, crate::REACHED_PAYPAL);
    let after_row = summary(&mut r, deal.id);
    let recorded = after_row.decided.unwrap();
    assert_eq!(recorded.operation, DecisionStep::Capture);
    assert!(recorded.at > before.at);
    assert!(after_row.evidence.money_check.is_none());
    assert_eq!(after_row.deal.state, DealState::Authorized);
    assert_eq!(
        http.0.lock().unwrap().paths.len(),
        paths,
        "nothing was sent"
    );
}

/// After the reservation: the capture's answer is lost. A newer row and an open capture.
#[tokio::test]
async fn a_lost_capture_reads_as_a_newer_decision_with_its_step_open() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, token) = authorized(&mut r).await;
    let before = summary(&mut r, deal.id).decided.unwrap();
    http.0.lock().unwrap().fail_capture = true;
    let args = decision(&mut r, deal.id);
    let error = decide(&mut r, &token, args, Decision::Capture)
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::REACHED_PAYPAL);
    let lost = summary(&mut r, deal.id);
    let recorded = lost.decided.unwrap();
    assert_eq!(recorded.operation, DecisionStep::Capture);
    assert!(recorded.at >= before.at && recorded != before);
    assert_eq!(
        lost.evidence.money_check.map(|c| c.step),
        Some(MoneyCheckStep::Capture)
    );
    assert!(!lost.can_release);
}

/// A row from another attempt is not this attempt's decision; a row without lines or signature
/// (an older ledger) still reads, as unsigned and with no lines.
#[tokio::test]
async fn only_this_attempts_rows_count_and_an_older_row_reads_unsigned() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, _) = authorized(&mut r).await;
    let now = summary(&mut r, deal.id);
    let at = r.clock.now() + 5;
    for (attempt, keep) in [(2u8, false), (1, true)] {
        let mut detail = serde_json::json!({
            "decision": "deal_capture",
            "operation": "capture",
            "decided_by": DecidedBy::Human { at },
            "checks_hash": now.checks_hash,
            "terms_hash": now.terms_hash,
            "attempt": attempt,
        });
        if keep {
            detail["owner_key"] = serde_json::json!(vec![7u8; 32]);
            detail["signature"] = serde_json::json!(vec![1u8; 64]);
        }
        r.pipeline
            .wallet
            .ledger
            .append_audit(&table_ledger::AuditEntry {
                at,
                actor: "owner".into(),
                action: "owner.decision".into(),
                deal_id: Some(deal.id),
                detail,
            })
            .unwrap();
    }
    let read = summary(&mut r, deal.id).decided.unwrap();
    assert_eq!(read.operation, DecisionStep::Capture);
    assert_eq!(read.at, at);
    assert!(read.same_now);
    assert!(!read.signed, "not the pinned owner key");
    assert!(read.checks.is_none());
}

/// The owner's own purchase, decided step by step: make the order, open PayPal, hold, pay. The
/// summary keeps the hand-off flag, and the Rewind has one owner_decided step per decision
/// (none before), each naming its step; the lines the order was made on that were checked
/// later all passed in later decisions before the payment.
#[tokio::test]
async fn a_purchase_decided_by_the_owner_has_one_history_step_per_decision() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .propose_purchase(&deal, 100)
        .unwrap();
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    http.0.lock().unwrap().awaiting_payer = true;
    let history = |r: &mut Runtime| {
        let r = &*r;
        r.deal_history(DealHistoryArgs {
            deal_id: Some(deal.id),
            ..Default::default()
        })
        .unwrap()
        .steps
    };
    let decided = |steps: &[HistoryStep]| -> Vec<HistoryDecision> {
        steps
            .iter()
            .filter(|s| s.kind == HistoryKind::OwnerDecided)
            .map(|s| {
                assert_eq!(s.authority, HistoryAuthority::Owner);
                assert_eq!(s.paypal, HistoryPaypal::None);
                s.decision.clone().unwrap()
            })
            .collect()
    };
    assert!(decided(&history(&mut r)).is_empty());

    let args = decision(&mut r, deal.id);
    decide(&mut r, &token, args, Decision::Countersign)
        .await
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::AwaitingApproval
    );
    assert!(!summary(&mut r, deal.id).handed_off);
    let args = decision(&mut r, deal.id);
    decide(&mut r, &token, args, Decision::OpenBrowser)
        .await
        .unwrap();
    let handed = summary(&mut r, deal.id);
    assert!(handed.handed_off, "the hand-off survives a reopen");
    let hand_off = handed.decided.unwrap();
    assert_eq!(hand_off.operation, DecisionStep::HandOff);
    assert_eq!(hand_off.decision, "open_paypal_in_browser");
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, DealEvent::OrderApproved, r.clock.now())
        .unwrap();
    for step in [Decision::Countersign, Decision::Capture] {
        let args = decision(&mut r, deal.id);
        decide(&mut r, &token, args, step).await.unwrap();
    }
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );

    let steps = history(&mut r);
    let rows = r
        .pipeline
        .wallet
        .ledger
        .owner_decisions(deal.id, 100)
        .unwrap()
        .len();
    let made = decided(&steps);
    assert_eq!(made.len(), rows, "one step per decision");
    assert_eq!(
        made.iter().map(|d| d.operation).collect::<Vec<_>>(),
        [
            DecisionStep::Create,
            DecisionStep::HandOff,
            DecisionStep::Authorize,
            DecisionStep::Capture
        ]
    );
    assert!(made.iter().all(|d| d.checks == Some(6)));
    let order = &made[0];
    assert!(order.later > 0, "{order:?}");
    assert_eq!(order.later_passed, order.later);
    assert!(order.before_payment, "{order:?}");
    // The money steps are still their own steps, decided by the owner.
    assert!(
        steps
            .iter()
            .any(|s| s.kind == HistoryKind::Captured && s.authority == HistoryAuthority::Owner)
    );
}
