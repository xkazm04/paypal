//! Rescue rows, the operations rebuild of migration 0009 and the recovered-money predicate.
use super::*;
use ed25519_dalek::SigningKey;
use table_core::*;
use table_proto::*;

fn signer() -> AgentSigner {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    AgentSigner::from_key(SigningKey::from_bytes(&bytes))
}
fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
struct World {
    ledger: Ledger,
    agent: AgentSigner,
    mandate: MandateId,
}
fn world() -> World {
    let (owner, agent) = (signer(), signer());
    let mut ledger = Ledger::in_memory().unwrap();
    let payload = MandatePayload {
        id: "00000000000000000000000009".parse().unwrap(),
        version: 1,
        agent_key: agent.public_key().to_bytes(),
        not_before: 0,
        expires: 10_000_000,
        clauses: vec![
            Clause::Roles {
                roles: vec![Role::Rescue],
            },
            Clause::Counterparties {
                rule: CpRule::Subscribers,
            },
            Clause::PerDeal {
                kind: DealKind::Rescue,
                max_amount: usd(5000),
                categories: vec![Category::Service],
            },
            Clause::Velocity {
                max_deals_day: 10,
                max_total_day: usd(50000),
            },
            Clause::HumanPresentOver { amount: usd(0) },
            Clause::Payees {
                payees: vec![PayeeRef::new("shop").unwrap()],
            },
            Clause::Lever {
                levers: vec![RescueLever::DiscountThisCycle],
                max_discount_bp: 2000,
                max_discount: usd(500),
            },
        ],
    };
    let mandate = payload.id;
    let open = OpenMandate {
        owner_sig: owner.sign_payload(&payload).unwrap(),
        payload,
    };
    ledger.insert_mandate(&open, &owner.public_key(), 100).unwrap();
    World {
        ledger,
        agent,
        mandate,
    }
}
fn case(source: RescueSource, subscription: &str, failed_at: Timestamp) -> RescueCase {
    RescueCase {
        source,
        subscription_id: subscription.into(),
        recipient: Recipient::new("subscriber@example.com").unwrap(),
        offer: propose_discount(usd(1200), 2000, usd(500)).unwrap(),
        failed_payments: 1,
        failed_at,
        next_retry_at: Some(failed_at + 5 * 86400),
    }
}
fn deal_for(w: &World, id: u128, c: &RescueCase) -> Deal {
    Deal {
        created_at: 0,
        updated_at: 0,
        id: format!("{id:026}").parse().unwrap(),
        kind: DealKind::Rescue,
        side: Side::Seller,
        counterparty: subscriber_key(&c.subscription_id).unwrap(),
        terms: Terms {
            item_ref: ItemRef::new("care-plan").unwrap(),
            qty: 1,
            unit_price: c.offer.invoice,
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state: DealState::Pairing,
        mandate_id: w.mandate,
        mandate_version: 1,
        transcript_head: H256::ZERO,
        paypal: PaypalRefs::default(),
        mode: if c.source == RescueSource::Replay {
            Mode::Replay
        } else {
            Mode::Sandbox
        },
        market: None,
        shield: None,
        decided_by: None,
    }
}
fn open(w: &mut World, id: u128, c: &RescueCase, at: Timestamp) -> Result<Deal, LedgerError> {
    let deal = deal_for(w, id, c);
    w.ledger.open_rescue(
        &deal,
        c,
        &PayeeRef::new("shop").unwrap(),
        Category::Service,
        at + 5 * 86400,
        at,
    )?;
    Ok(w.ledger.get_deal(deal.id).unwrap())
}
/// Reserve and confirm both invoice steps, leaving the deal AWAITING_APPROVAL with `invoice`.
fn sent(w: &mut World, deal: &Deal, invoice: &str, send: bool, at: Timestamp) {
    let human = DecidedBy::Human { at };
    w.ledger
        .reserve_operation(deal.id, 1, "invoice-create", &format!("{}-1-invoice-create", deal.id), &human, at)
        .unwrap();
    w.ledger.apply_event(deal.id, DealEvent::BeginSettlement, at).unwrap();
    let mut refs = deal.paypal.clone();
    refs.order = Some(invoice.into());
    w.ledger
        .finish_operation(OperationOutcome {
            id: deal.id,
            attempt: 1,
            operation: "invoice-create",
            calls: &[],
            refs: &refs,
            event: Some(DealEvent::InvoiceDrafted),
            at,
        })
        .unwrap();
    w.ledger
        .reserve_operation(deal.id, 1, "invoice-send", &format!("{}-1-invoice-send", deal.id), &human, at)
        .unwrap();
    w.ledger
        .finish_operation(OperationOutcome {
            id: deal.id,
            attempt: 1,
            operation: "invoice-send",
            calls: &[],
            refs: &refs,
            event: send.then_some(DealEvent::SettleVerified),
            at,
        })
        .unwrap();
}
fn receipt(w: &World, id: DealId, invoice: &str, amount: Money, at: Timestamp) -> VerifiedEnvelope {
    let deal = w.ledger.get_deal(id).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let e = Envelope {
        v: 1,
        typ: MsgType::Receipt,
        deal_id: id,
        seq: w.ledger.next_sequence(id, Direction::Outbound).unwrap(),
        prev: deal.transcript_head,
        iss: w.agent.key_id().unwrap(),
        aud: deal.counterparty.clone(),
        iat: at,
        exp: at + 600,
        nonce,
        body: Body::Receipt {
            capture_id: ShortText::new(invoice.into()).unwrap(),
            amount,
            status: ReceiptStatus::Completed,
            transcript_head: deal.transcript_head,
        },
    };
    verify(
        &w.agent.sign(&e).unwrap(),
        &w.agent.public_key(),
        &VerifyContext {
            deal_id: id,
            audience: &deal.counterparty,
            next_sender_seq: e.seq,
            previous: deal.transcript_head,
            now: at,
            nonces: &w.ledger,
        },
    )
    .unwrap()
}

#[test]
fn a_failed_renewal_opens_one_agreed_rescue_per_subscriber_per_cycle() {
    let mut w = world();
    let c = case(RescueSource::Paypal, "I-SUB14", 86400);
    let deal = open(&mut w, 1, &c, 86400 + 60).unwrap();
    assert_eq!(deal.state, DealState::Agreed);
    assert_eq!(deal.mode, Mode::Sandbox);
    assert_eq!(w.ledger.deal_category(deal.id).unwrap(), Category::Service);
    assert_eq!(
        w.ledger.deadline(deal.id).unwrap(),
        Some((86400 + 60 + 5 * 86400, None))
    );
    let stored = w.ledger.rescue_case(deal.id).unwrap().unwrap();
    assert_eq!(stored.offer, c.offer);
    assert_eq!(stored.recipient.masked(), "s•••@example.com");
    assert_eq!(format!("{:?}", stored.recipient), "Recipient([REDACTED])");
    // The email never reaches the audit chain, and the subscriber is no paired wallet.
    let (rows, _) = w.ledger.audit_page(None, 500).unwrap();
    assert!(rows.iter().all(|r| !r.detail.to_string().contains("subscriber@")));
    assert!(rows.iter().any(|r| r.action == "rescue.opened"));
    assert!(w.ledger.counterparty_list().unwrap().is_empty());
    // A second fix for the same subscriber while one is live, or for the same cycle later on,
    // is refused; another subscriber is not.
    assert!(matches!(
        open(&mut w, 2, &case(RescueSource::Paypal, "I-SUB14", 2 * 86400), 3 * 86400),
        Err(LedgerError::Conflict)
    ));
    w.ledger.apply_event(deal.id, DealEvent::Withdraw, 86400 + 70).unwrap();
    assert!(matches!(
        open(&mut w, 3, &case(RescueSource::Paypal, "I-SUB14", 86400 + 500), 86400 + 600),
        Err(LedgerError::Conflict)
    ));
    assert!(open(&mut w, 4, &case(RescueSource::Paypal, "I-SUB14", 40 * 86400), 40 * 86400).is_ok());
    assert!(open(&mut w, 5, &case(RescueSource::Paypal, "I-SUB22", 86400), 86400 + 60).is_ok());
    // The mode follows the source; nothing else is accepted.
    let replay = case(RescueSource::Replay, "I-SUB30", 86400);
    let mut wrong = deal_for(&w, 6, &replay);
    wrong.mode = Mode::Sandbox;
    assert!(matches!(
        w.ledger.open_rescue(&wrong, &replay, &PayeeRef::new("shop").unwrap(), Category::Service, 9 * 86400, 86400),
        Err(LedgerError::Conflict)
    ));
    assert!(Recipient::new("not an email").is_err());
    assert!(Recipient::new("a@b").is_err());
    assert!(subscriber_key("bad id!").is_err());
    w.ledger.verify_audit().unwrap();
}

#[test]
fn only_a_paid_receipted_invoice_on_a_paypal_reported_failure_counts_as_recovered() {
    let mut w = world();
    let real = open(&mut w, 1, &case(RescueSource::Paypal, "I-REAL", 86400), 86400).unwrap();
    let replay = open(&mut w, 2, &case(RescueSource::Replay, "I-REPLAY", 86400), 86400).unwrap();
    let unsent = open(&mut w, 3, &case(RescueSource::Paypal, "I-UNSENT", 86400), 86400).unwrap();
    assert_eq!(replay.mode, Mode::Replay);
    sent(&mut w, &real, "INV-REAL", true, 86500);
    sent(&mut w, &replay, "INV-REPLAY", true, 86500);
    sent(&mut w, &unsent, "INV-UNSENT", false, 86500);
    assert_eq!(
        w.ledger.get_deal(real.id).unwrap().state,
        DealState::AwaitingApproval
    );
    // Sent is not recovered.
    assert!(w.ledger.rescue_recovered().unwrap().is_empty());
    assert!(!w.ledger.rescue_counted(real.id).unwrap());
    // A receipt for another invoice, or another amount, is refused; so is one before the send
    // was confirmed.
    let wrong = receipt(&w, real.id, "INV-OTHER", usd(960), 86600);
    assert!(w.ledger.record_rescue_paid(&wrong, 86600).is_err());
    let wrong = receipt(&w, real.id, "INV-REAL", usd(1200), 86600);
    assert!(w.ledger.record_rescue_paid(&wrong, 86600).is_err());
    let early = receipt(&w, unsent.id, "INV-UNSENT", usd(960), 86600);
    assert!(w.ledger.record_rescue_paid(&early, 86600).is_err());
    // Paid and receipted.
    let paid = receipt(&w, real.id, "INV-REAL", usd(960), 86600);
    w.ledger.record_rescue_paid(&paid, 86600).unwrap();
    let paid = receipt(&w, replay.id, "INV-REPLAY", usd(960), 86600);
    w.ledger.record_rescue_paid(&paid, 86600).unwrap();
    for id in [real.id, replay.id] {
        assert_eq!(w.ledger.get_deal(id).unwrap().state, DealState::Receipted);
        assert_eq!(
            w.ledger.deal_evidence(id).unwrap().receipt,
            ReceiptEvidence::PaypalVerified
        );
    }
    assert!(w.ledger.rescue_counted(real.id).unwrap());
    assert!(!w.ledger.rescue_counted(replay.id).unwrap());
    assert_eq!(w.ledger.rescue_recovered().unwrap(), vec![usd(960)]);
    // The book's metric is the same predicate.
    let q: BookQuery = serde_json::from_value(
        serde_json::json!({"view":"deals","metrics":["recovered_sum"]}),
    )
    .unwrap();
    let rows = w.ledger.book_query(&q).unwrap()["rows"].clone();
    let total: i64 = rows
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["recovered_sum"].as_i64().unwrap_or(0))
        .sum();
    assert_eq!(total, 960);
    w.ledger.verify_audit().unwrap();
}

#[test]
fn migration_0009_keeps_every_operation_and_its_check_and_admits_the_invoice_steps() {
    let mut w = world();
    let deal = open(&mut w, 1, &case(RescueSource::Paypal, "I-MIG", 86400), 86400).unwrap();
    let human = DecidedBy::Human { at: 86400 };
    let request = format!("{}-1-invoice-create", deal.id);
    w.ledger
        .reserve_operation(deal.id, 1, "invoice-create", &request, &human, 86400)
        .unwrap();
    w.ledger
        .finish_operation(OperationOutcome {
            id: deal.id,
            attempt: 1,
            operation: "invoice-create",
            calls: &[],
            refs: &deal.paypal,
            event: None,
            at: 86400,
        })
        .unwrap();
    w.ledger
        .park_operation(deal.id, 1, "invoice-create", CheckReason::Unreadable, 86500, 86400)
        .unwrap();
    // An operation name outside the closed list is still refused.
    assert!(
        w.ledger
            .reserve_operation(deal.id, 1, "refund", "x-refund", &human, 86400)
            .is_err()
    );
    // Run 0010 again over the rows, as an upgrade from version 9 does.
    let conn = w.ledger.conn;
    conn.execute_batch("DROP TABLE rescue_cases; PRAGMA user_version=9;")
        .unwrap();
    let ledger = Ledger::from_connection(conn).unwrap();
    let open_ops = ledger.open_operations(Some(deal.id)).unwrap();
    assert_eq!(open_ops.len(), 1);
    assert_eq!(open_ops[0].request_id, request);
    assert_eq!(open_ops[0].parked, Some(CheckReason::Unreadable));
    assert_eq!(open_ops[0].tries, 1);
    assert_eq!(open_ops[0].decided_by, human);
    assert_eq!(
        ledger.money_check(deal.id).unwrap().map(|c| c.step),
        Some(MoneyCheckStep::InvoiceCreate)
    );
    ledger.verify_audit().unwrap();
}
