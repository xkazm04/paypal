//! T12 mandate what-if: the card's three cases, missing facts, an invalid draft, no writes and
//! the label gate.
use super::*;

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn payees(names: &[&str]) -> Vec<PayeeRef> {
    names.iter().map(|n| PayeeRef::new(*n).unwrap()).collect()
}
/// The supplies mandate as signed now (fixtures M-12): purchases up to $200 in office and parts,
/// ask above $250, three approved payees.
fn signed_now() -> Vec<Clause> {
    vec![
        Clause::Roles {
            roles: vec![Role::Buy],
        },
        Clause::Counterparties {
            rule: CpRule::Paired,
        },
        Clause::PerDeal {
            kind: DealKind::Purchase,
            max_amount: usd(20_000),
            categories: vec![Category::Office, Category::Parts],
        },
        Clause::Velocity {
            max_deals_day: 12,
            max_total_day: usd(90_000),
        },
        Clause::HumanPresentOver {
            amount: usd(25_000),
        },
        Clause::Payees {
            payees: payees(&["packrite-supply", "partsco", "gpu-cloud"]),
        },
    ]
}
fn draft(id: Option<MandateId>, clauses: Vec<Clause>) -> MandateSimulateArgs {
    MandateSimulateArgs {
        draft: MandateSignArgs {
            id,
            agent: AgentSlot::Shopper,
            clauses,
            not_before: 0,
            expires: 1_000_000,
        },
        from: None,
        to: None,
    }
}
struct Week {
    r: Runtime,
    http: Arc<OfflineHttp>,
    mandate: MandateId,
    dock: DealId,
    packing: DealId,
    gpu: DealId,
}
/// Three purchases recorded under a looser first version (it allowed compute up to $20,000),
/// then the owner signed the tighter version that is in force now.
fn week() -> Week {
    let (mut r, _, http, _, _) = runtime(true);
    let mut loose = signed_now();
    loose[2] = Clause::PerDeal {
        kind: DealKind::Purchase,
        max_amount: usd(2_000_000),
        categories: vec![Category::Office, Category::Parts, Category::Compute],
    };
    loose[3] = Clause::Velocity {
        max_deals_day: 12,
        max_total_day: usd(5_000_000),
    };
    let v1 = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Shopper,
            clauses: loose,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let mut buy = |name: &str, category: Category, item: &str, qty: u32, price: i64| {
        let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), name).unwrap());
        r.pipeline
            .wallet
            .ledger
            .insert_counterparty(&Counterparty {
                key_id: peer.key_id().unwrap(),
                owner_key: peer.public_key().to_bytes(),
                agent_key: peer.public_key().to_bytes(),
                display_name: ShortText::new(name.into()).unwrap(),
                paired_via: PairedVia::Code,
                words_confirmed_at: Some(100),
                declared_payee: PayeeRef::new(name).unwrap(),
                first_seen: 0,
            })
            .unwrap();
        r.create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: v1.payload.id,
            mandate_version: 1,
            category,
            terms: Terms {
                item_ref: ItemRef::new(item).unwrap(),
                qty,
                unit_price: usd(price),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap()
        .id
    };
    let dock = buy("partsco", Category::Parts, "usb-c-dock", 1, 6_400);
    let packing = buy("packrite-supply", Category::Office, "packing", 1, 4_500);
    let gpu = buy("gpu-cloud", Category::Compute, "gpu-rental", 40, 29_900);
    r.sign_mandate(MandateSignArgs {
        id: Some(v1.payload.id),
        agent: AgentSlot::Shopper,
        clauses: signed_now(),
        not_before: 0,
        expires: 1_000_000,
    })
    .unwrap();
    Week {
        r,
        http,
        mandate: v1.payload.id,
        dock,
        packing,
        gpu,
    }
}
fn line(s: &MandateSimulation, id: DealId) -> &SimulatedLine {
    s.lines.iter().find(|l| l.deal_id == id).unwrap()
}
fn refused(v: &SimulatedVerdict) -> (u8, &str) {
    match v {
        SimulatedVerdict::Refuse { clause, reason } => (*clause, reason.as_str()),
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn unchanged_rules_replay_the_week_as_the_check_answers_it_today() {
    let w = week();
    let s =
        w.r.mandate_simulate(draft(Some(w.mandate), signed_now()))
            .unwrap();
    assert_eq!((s.lines.len(), s.not_simulated), (3, 0));
    assert_eq!((s.from, s.to), (100 - 7 * 86_400, 100));
    for l in &s.lines {
        assert_eq!(l.before, l.after, "{}", l.label);
    }
    assert_eq!(line(&s, w.dock).before, SimulatedVerdict::Allow);
    assert_eq!(line(&s, w.packing).before, SimulatedVerdict::Allow);
    // Recorded under the looser version; today's rules refuse its category.
    let (clause, reason) = refused(&line(&s, w.gpu).before);
    assert_eq!(clause, 3);
    assert!(reason.contains("category compute not allowed"), "{reason}");
    let dock = line(&s, w.dock);
    assert_eq!(
        (dock.title.as_str(), dock.amount),
        ("usb-c-dock", Some(usd(6_400)))
    );
    assert!(dock.label.starts_with("D-"));
}

#[test]
fn lowering_ask_me_to_fifty_turns_the_sixty_four_dollar_dock_into_a_question() {
    let w = week();
    let mut clauses = signed_now();
    clauses[4] = Clause::HumanPresentOver { amount: usd(5_000) };
    let s =
        w.r.mandate_simulate(draft(Some(w.mandate), clauses))
            .unwrap();
    let dock = line(&s, w.dock);
    assert_eq!(dock.before, SimulatedVerdict::Allow);
    assert_eq!(dock.after, SimulatedVerdict::Ask { clause: 6 });
    // $45 is under $50: still the agent's to do.
    let packing = line(&s, w.packing);
    assert_eq!(
        (&packing.before, &packing.after),
        (&SimulatedVerdict::Allow, &SimulatedVerdict::Allow)
    );
    assert_eq!(line(&s, w.gpu).before, line(&s, w.gpu).after);
}

#[test]
fn adding_compute_leaves_the_gpu_refused_by_the_per_deal_limit_that_actually_binds() {
    let w = week();
    let mut clauses = signed_now();
    clauses[2] = Clause::PerDeal {
        kind: DealKind::Purchase,
        max_amount: usd(20_000),
        categories: vec![Category::Office, Category::Parts, Category::Compute],
    };
    let s =
        w.r.mandate_simulate(draft(Some(w.mandate), clauses))
            .unwrap();
    let gpu = line(&s, w.gpu);
    let (clause, before) = refused(&gpu.before);
    assert_eq!(clause, 3);
    assert!(before.contains("category compute not allowed"), "{before}");
    let (clause, after) = refused(&gpu.after);
    assert_eq!(clause, 3);
    assert!(after.contains("above max_amount $200 per deal"), "{after}");
    assert_eq!(line(&s, w.dock).after, SimulatedVerdict::Allow);
}

#[test]
fn removing_a_payee_refuses_that_payees_deals_by_the_payee_rule() {
    let w = week();
    let mut clauses = signed_now();
    clauses[5] = Clause::Payees {
        payees: payees(&["packrite-supply", "gpu-cloud"]),
    };
    let s =
        w.r.mandate_simulate(draft(Some(w.mandate), clauses))
            .unwrap();
    let dock = line(&s, w.dock);
    assert_eq!(dock.before, SimulatedVerdict::Allow);
    assert_eq!(refused(&dock.after).0, 7);
    assert_eq!(line(&s, w.packing).after, SimulatedVerdict::Allow);
}

#[test]
fn a_deal_missing_a_fact_the_intent_needs_is_not_simulated_never_guessed() {
    let mut w = week();
    // A deal row with no recorded category (no deal_context row), written straight to the ledger.
    let mut deal = w.r.pipeline.wallet.ledger.get_deal(w.dock).unwrap();
    deal.id = DealId(ulid::Ulid::new());
    deal.state = DealState::Pairing;
    deal.transcript_head = H256::ZERO;
    deal.paypal = PaypalRefs::default();
    deal.decided_by = None;
    deal.mandate_version = 2;
    w.r.pipeline.wallet.ledger.create_deal(&deal, 100).unwrap();
    let s =
        w.r.mandate_simulate(draft(Some(w.mandate), signed_now()))
            .unwrap();
    assert_eq!((s.lines.len(), s.not_simulated), (4, 1));
    let blind = line(&s, deal.id);
    assert_eq!(
        (&blind.before, &blind.after),
        (
            &SimulatedVerdict::NotSimulated,
            &SimulatedVerdict::NotSimulated
        )
    );
}

#[test]
fn an_invalid_draft_is_refused_with_its_reason_and_nothing_is_replayed() {
    let w = week();
    let mut clauses = signed_now();
    clauses[3] = Clause::Velocity {
        max_deals_day: 0,
        max_total_day: usd(90_000),
    };
    let error =
        w.r.mandate_simulate(draft(Some(w.mandate), clauses))
            .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert!(
        error.message.contains("empty velocity allowance"),
        "{}",
        error.message
    );
    // A window that is backwards or longer than a month is malformed input.
    for (from, to) in [(200, 100), (0, 32 * 86_400)] {
        let mut args = draft(Some(w.mandate), signed_now());
        (args.from, args.to) = (Some(from), Some(to));
        assert!(matches!(
            w.r.mandate_simulate(args).unwrap_err().code,
            ErrorCode::Invalid
        ));
    }
}

#[test]
fn the_window_and_the_agent_scope_choose_the_deals() {
    let w = week();
    let mut args = draft(Some(w.mandate), signed_now());
    (args.from, args.to) = (Some(101), Some(200));
    assert!(w.r.mandate_simulate(args).unwrap().lines.is_empty());
    // A new mandate replays the deals of the agent it is for, under the rules in force for them.
    let mut new = draft(None, signed_now());
    let s = w.r.mandate_simulate(new.clone()).unwrap();
    assert_eq!(s.lines.len(), 3);
    assert_eq!(line(&s, w.dock).before, SimulatedVerdict::Allow);
    new.draft.agent = AgentSlot::Negotiator;
    assert!(w.r.mandate_simulate(new).unwrap().lines.is_empty());
}

#[test]
fn simulating_writes_nothing_signs_nothing_and_calls_no_paypal() {
    let w = week();
    let calls = |r: &Runtime| {
        r.pipeline
            .wallet
            .ledger
            .book_query(
                &serde_json::from_value(json!({"view":"paypal_calls","metrics":["count"]}))
                    .unwrap(),
            )
            .unwrap()
    };
    let ledger = &w.r.pipeline.wallet.ledger;
    let before = (
        ledger.audit_count().unwrap(),
        ledger.next_mandate_version(w.mandate).unwrap(),
        ledger
            .list_mandates(&w.r.owner().unwrap().verifying_key())
            .unwrap()
            .len(),
        serde_json::to_value(ledger.list_deals().unwrap()).unwrap(),
        calls(&w.r),
    );
    let mut ask = signed_now();
    ask[4] = Clause::HumanPresentOver { amount: usd(5_000) };
    let mut invalid = signed_now();
    invalid.remove(0);
    w.r.mandate_simulate(draft(Some(w.mandate), ask)).unwrap();
    w.r.mandate_simulate(draft(None, signed_now())).unwrap();
    w.r.mandate_simulate(draft(Some(w.mandate), invalid))
        .unwrap_err();
    let ledger = &w.r.pipeline.wallet.ledger;
    let after = (
        ledger.audit_count().unwrap(),
        ledger.next_mandate_version(w.mandate).unwrap(),
        ledger
            .list_mandates(&w.r.owner().unwrap().verifying_key())
            .unwrap()
            .len(),
        serde_json::to_value(ledger.list_deals().unwrap()).unwrap(),
        calls(&w.r),
    );
    assert_eq!(before, after);
    assert!(w.http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn only_the_approval_window_simulates_and_it_needs_no_token_or_unlock() {
    let w = week();
    let mandate = w.mandate;
    let (actor, _) = spawn(w.r);
    for label in ["main", "tumbler", "elsewhere"] {
        let error = actor
            .execute::<MandateSimulation>(
                caller(label, None),
                Action::Simulate(draft(Some(mandate), signed_now())),
            )
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{label}");
    }
    // Idle-locked, no capability token: it moves nothing, so the editor still gets its answer.
    let s: MandateSimulation = actor
        .execute(
            caller("approval", None),
            Action::Simulate(draft(Some(mandate), signed_now())),
        )
        .await
        .unwrap();
    assert_eq!((s.lines.len(), s.not_simulated), (3, 0));
}

#[test]
fn a_deal_under_the_rules_in_force_gets_the_verdict_the_live_pipeline_gives_it() {
    let mut w = week();
    // Two more purchases under the version in force: one the agent may do, one over ask-me.
    let counterparty =
        w.r.pipeline
            .wallet
            .ledger
            .get_deal(w.dock)
            .unwrap()
            .counterparty;
    let mut ids = Vec::new();
    for (item, price) in [("cable-kit", 3_800), ("monitor-stand", 19_000)] {
        let deal =
            w.r.create_deal(DealCreateArgs {
                kind: DealKind::Purchase,
                side: Side::Buyer,
                counterparty: counterparty.clone(),
                mandate_id: w.mandate,
                mandate_version: 2,
                category: Category::Parts,
                terms: Terms {
                    item_ref: ItemRef::new(item).unwrap(),
                    qty: 1,
                    unit_price: usd(price),
                    currency: Currency::USD,
                    delivery: Delivery::DigitalNow,
                },
            })
            .unwrap();
        ids.push(deal.id);
    }
    let mut tight = signed_now();
    tight[4] = Clause::HumanPresentOver {
        amount: usd(10_000),
    };
    let s = w.r.mandate_simulate(draft(Some(w.mandate), tight)).unwrap();
    for id in ids {
        w.r.select_signer(id).unwrap();
        let live =
            w.r.pipeline
                .wallet
                .check_mandate(id, Category::Parts, 100)
                .unwrap();
        let simulated = match live {
            MandateDecision::Allow => SimulatedVerdict::Allow,
            MandateDecision::Ask { clause } => SimulatedVerdict::Ask { clause },
        };
        assert_eq!(line(&s, id).before, simulated);
    }
    let stand = s.lines.iter().find(|l| l.title == "monitor-stand").unwrap();
    assert_eq!(stand.before, SimulatedVerdict::Allow);
    assert_eq!(stand.after, SimulatedVerdict::Ask { clause: 6 });
}

// ---- Wallet-limits what-if (envelope_simulate) and the limits in the rules what-if ----------

fn limits_args(out: i64, held: i64, deals: u16) -> EnvelopeSignArgs {
    EnvelopeSignArgs {
        currency: Currency::USD,
        max_out_day: usd(out),
        max_held: usd(held),
        max_deals_day: deals,
        expires: 1_000_000,
    }
}
fn limits_draft(out: i64, held: i64, deals: u16) -> EnvelopeSimulateArgs {
    EnvelopeSimulateArgs {
        draft: limits_args(out, held, deals),
        from: None,
        to: None,
    }
}
/// Purchases under one shopper mandate, proposed (and so agreed) in this order on the test
/// clock's one UTC day, exactly as the agent's propose_purchase does it.
fn agreed_purchases(r: &mut Runtime, prices: &[i64]) -> (MandateId, Vec<Deal>) {
    use table_app::{
        AgentRequest, AgentRole, AgentScope, AgentService, PurchaseInput, PurchaseLine,
    };
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Shopper,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let shop = AgentSigner::from_key(signing_key(&MemoryVault::default(), "shop").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: shop.key_id().unwrap(),
            owner_key: shop.public_key().to_bytes(),
            agent_key: shop.public_key().to_bytes(),
            display_name: ShortText::new("Shop".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let mut deals = Vec::new();
    for price in prices {
        let deal = r
            .create_deal(DealCreateArgs {
                kind: DealKind::Purchase,
                side: Side::Buyer,
                counterparty: shop.key_id().unwrap(),
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                category: Category::Parts,
                terms: Terms {
                    item_ref: ItemRef::new("monitor").unwrap(),
                    qty: 1,
                    unit_price: usd(*price),
                    currency: Currency::USD,
                    delivery: Delivery::DigitalNow,
                },
            })
            .unwrap();
        r.select_signer(deal.id).unwrap();
        r.pipeline
            .wallet
            .invoke(
                &AgentScope {
                    deal_id: deal.id,
                    role: AgentRole::Shopper,
                    category: Category::Parts,
                },
                AgentRequest::Purchase(PurchaseInput {
                    payee_ref: PayeeRef::new("merchant").unwrap(),
                    items: vec![PurchaseLine {
                        item_ref: deal.terms.item_ref.clone(),
                        qty: 1,
                    }],
                    amount: deal.terms.unit_price.decimal(),
                    category: Category::Parts,
                }),
                r.clock.now(),
            )
            .unwrap();
        let deal = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
        assert_eq!(deal.state, DealState::Agreed);
        deals.push(deal);
    }
    (mandate.payload.id, deals)
}
fn ids(s: &MandateSimulation) -> Vec<DealId> {
    s.lines.iter().map(|l| l.deal_id).collect()
}

#[test]
fn a_two_a_day_draft_would_have_stopped_the_third_purchase_of_the_day() {
    let (mut r, ..) = runtime(true);
    let (_, deals) = agreed_purchases(&mut r, &[1000, 1200, 1400]);
    let s = r
        .envelope_simulate(limits_draft(100_000, 100_000, 2))
        .unwrap();
    assert_eq!(ids(&s), deals.iter().map(|d| d.id).collect::<Vec<_>>());
    assert_eq!((s.from, s.to, s.not_simulated), (100 - 7 * 86_400, 100, 0));
    for l in &s.lines {
        assert_eq!(l.before, SimulatedVerdict::Allow, "{}", l.label);
        assert_eq!(l.side, Side::Buyer);
    }
    assert_eq!(s.lines[0].after, SimulatedVerdict::Allow);
    assert_eq!(s.lines[1].after, SimulatedVerdict::Allow);
    let (clause, reason) = refused(&s.lines[2].after);
    assert_eq!(clause, ENVELOPE_CLAUSE);
    assert!(reason.contains("deals agreed today"), "{reason}");
    assert_eq!(s.lines[2].amount, Some(usd(1400)));
}

#[test]
fn a_day_budget_draft_judges_each_purchase_at_its_own_place_in_the_day() {
    let (mut r, ..) = runtime(true);
    let (_, deals) = agreed_purchases(&mut r, &[1000, 1200, 1400]);
    let s = r
        .envelope_simulate(limits_draft(2000, 100_000, 50))
        .unwrap();
    assert_eq!(ids(&s), deals.iter().map(|d| d.id).collect::<Vec<_>>());
    assert_eq!(s.lines[0].after, SimulatedVerdict::Allow);
    for l in &s.lines[1..] {
        let (clause, reason) = refused(&l.after);
        assert_eq!(clause, ENVELOPE_CLAUSE);
        assert!(reason.contains("paid out today"), "{reason}");
    }
    // The second is judged after the first only: $10.00 + $12.00 above $20.00.
    let (_, reason) = refused(&s.lines[1].after);
    assert!(reason.contains("10.00 + 12.00"), "{reason}");
}

#[test]
fn money_in_is_never_replayed_by_the_wallet_limits() {
    let (mut r, ..) = runtime(true);
    let (seller, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &seller, &peer);
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(seller.id).unwrap().state,
        DealState::Agreed
    );
    let (_, deals) = agreed_purchases(&mut r, &[1000]);
    let s = r.envelope_simulate(limits_draft(1, 1, 1)).unwrap();
    assert_eq!(ids(&s), vec![deals[0].id]);
}

#[test]
fn an_unsignable_draft_is_refused_as_signing_refuses_it_and_nothing_is_replayed() {
    let (mut r, ..) = runtime(true);
    agreed_purchases(&mut r, &[1000]);
    let zero = limits_args(100_000, 100_000, 0);
    let mut euro = limits_args(100_000, 100_000, 5);
    euro.max_held = Money::new(100_000, Currency::EUR).unwrap();
    let mut past = limits_args(100_000, 100_000, 5);
    past.expires = 50;
    for args in [zero, euro, past] {
        let simulated = r
            .envelope_simulate(EnvelopeSimulateArgs {
                draft: args.clone(),
                from: None,
                to: None,
            })
            .unwrap_err();
        let signed = r.sign_envelope(args).unwrap_err();
        assert!(
            matches!(simulated.code, ErrorCode::Refused),
            "{simulated:?}"
        );
        assert_eq!(simulated.message, signed.message);
    }
    // A window that is backwards or longer than a month is malformed input, as for rules.
    for (from, to) in [(200, 100), (0, 32 * 86_400)] {
        let error = r
            .envelope_simulate(EnvelopeSimulateArgs {
                draft: limits_args(100_000, 100_000, 5),
                from: Some(from),
                to: Some(to),
            })
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Invalid), "{error:?}");
    }
    assert_eq!(r.pipeline.wallet.ledger.next_envelope_version().unwrap(), 1);
}

#[test]
fn the_rules_what_if_says_what_the_limits_in_force_say_as_the_live_check_does() {
    let (mut r, ..) = runtime(true);
    let (mandate, deals) = agreed_purchases(&mut r, &[1000, 1200]);
    // Signed after both agreed: one deal a day.
    r.sign_envelope(limits_args(100_000, 100_000, 1)).unwrap();
    let s = r
        .mandate_simulate(MandateSimulateArgs {
            draft: MandateSignArgs {
                id: Some(mandate),
                agent: AgentSlot::Shopper,
                clauses: clauses(Side::Buyer, DealKind::Purchase),
                not_before: 0,
                expires: 1_000_000,
            },
            from: None,
            to: None,
        })
        .unwrap();
    assert_eq!(line(&s, deals[0].id).before, SimulatedVerdict::Allow);
    let second = line(&s, deals[1].id);
    let (clause, reason) = refused(&second.before);
    assert_eq!(clause, ENVELOPE_CLAUSE);
    assert!(reason.contains("deals agreed today"), "{reason}");
    assert_eq!(second.after, second.before);
    // The live check on each deal answers exactly that.
    for deal in &deals {
        r.select_signer(deal.id).unwrap();
        let live = match r
            .pipeline
            .wallet
            .check_mandate(deal.id, Category::Parts, r.clock.now())
        {
            Ok(MandateDecision::Allow) => SimulatedVerdict::Allow,
            Ok(MandateDecision::Ask { clause }) => SimulatedVerdict::Ask { clause },
            Err(table_app::Error::Refused(refusal)) => SimulatedVerdict::Refuse {
                clause: refusal.clause,
                reason: refusal.reason,
            },
            Err(other) => panic!("{other:?}"),
        };
        assert_eq!(line(&s, deal.id).before, live);
    }
}

#[test]
fn the_limits_what_if_writes_nothing_signs_nothing_and_calls_no_paypal() {
    let (mut r, _, http, ..) = runtime(true);
    let (_, deals) = agreed_purchases(&mut r, &[1000, 1200]);
    r.sign_envelope(limits_args(100_000, 100_000, 10)).unwrap();
    let snapshot = |r: &Runtime| {
        let ledger = &r.pipeline.wallet.ledger;
        (
            ledger.next_envelope_version().unwrap(),
            ledger.audit_count().unwrap(),
            deals
                .iter()
                .map(|d| ledger.paypal_call_count(d.id).unwrap())
                .collect::<Vec<_>>(),
            serde_json::to_value(ledger.list_deals().unwrap()).unwrap(),
        )
    };
    let before = snapshot(&r);
    let s = r.envelope_simulate(limits_draft(1500, 100_000, 1)).unwrap();
    assert_eq!(s.lines.len(), 2);
    r.envelope_simulate(limits_draft(100_000, 100_000, 0))
        .unwrap_err();
    assert_eq!(snapshot(&r), before);
    assert_eq!(before.0, 2);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn only_the_approval_window_tries_limits_and_it_needs_no_token_or_unlock() {
    let (mut r, ..) = runtime(true);
    agreed_purchases(&mut r, &[1000, 1200]);
    let (actor, _) = spawn(r);
    for label in ["main", "tumbler", "elsewhere"] {
        let error = actor
            .execute::<MandateSimulation>(
                caller(label, None),
                Action::EnvelopeSimulate(limits_draft(100_000, 100_000, 1)),
            )
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{label}");
    }
    // Idle-locked, no capability token: it moves nothing, so the limits sheet gets its answer.
    let s: MandateSimulation = actor
        .execute(
            caller("approval", None),
            Action::EnvelopeSimulate(limits_draft(100_000, 100_000, 1)),
        )
        .await
        .unwrap();
    assert_eq!(s.lines.len(), 2);
    assert!(matches!(
        s.lines[1].after,
        SimulatedVerdict::Refuse { clause: 0, .. }
    ));
}
