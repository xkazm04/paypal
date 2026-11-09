//! `list_live_deals`: every non-terminal deal in id order, RECEIPTED included.
use super::*;
use ed25519_dalek::SigningKey;
use table_core::*;
use table_proto::*;

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn deal(id: u128, mandate: MandateId, counterparty: KeyId) -> Deal {
    Deal {
        created_at: 0,
        updated_at: 0,
        id: format!("{id:026}").parse().unwrap(),
        kind: DealKind::Rescue,
        side: Side::Seller,
        counterparty,
        terms: Terms {
            item_ref: ItemRef::new("care-plan").unwrap(),
            qty: 1,
            unit_price: usd(1200),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state: DealState::Pairing,
        mandate_id: mandate,
        mandate_version: 1,
        transcript_head: H256::ZERO,
        paypal: PaypalRefs::default(),
        mode: Mode::Sandbox,
        market: None,
        shield: None,
        decided_by: None,
        shield_rule: None,
        shield_release: None,
    }
}

#[test]
fn lists_exactly_the_non_terminal_deals_in_id_order() {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    let owner = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    getrandom::fill(&mut bytes).unwrap();
    let agent = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
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
    ledger
        .insert_mandate(&open, &owner.public_key(), 100)
        .unwrap();
    getrandom::fill(&mut bytes).unwrap();
    let peer = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    let cp = Counterparty {
        key_id: peer.key_id().unwrap(),
        owner_key: peer.public_key().to_bytes(),
        agent_key: peer.public_key().to_bytes(),
        display_name: ShortText::new("Seller".into()).unwrap(),
        paired_via: PairedVia::Code,
        words_confirmed_at: Some(100),
        declared_payee: PayeeRef::new("shop").unwrap(),
        first_seen: 100,
    };
    ledger.insert_counterparty(&cp).unwrap();
    // One deal per state, ids ascending against the reverse of the declaration order so the
    // id order is not the insertion or state order.
    for (n, state) in DealState::ALL.iter().rev().enumerate() {
        let d = deal(n as u128 + 1, mandate, cp.key_id.clone());
        ledger.create_deal(&d, 1).unwrap();
        ledger
            .conn
            .execute(
                "UPDATE deals SET state=?1 WHERE id=?2",
                rusqlite::params![repositories::enum_text(state).unwrap(), d.id.to_string()],
            )
            .unwrap();
    }
    let live = ledger.list_live_deals().unwrap();
    let all = ledger.list_deals().unwrap();
    let expected: Vec<_> = all.iter().filter(|d| !d.state.terminal()).collect();
    assert_eq!(all.len(), DealState::ALL.len());
    assert!(!expected.is_empty() && expected.len() < all.len());
    assert_eq!(
        live.iter().map(|d| d.id).collect::<Vec<_>>(),
        expected.iter().map(|d| d.id).collect::<Vec<_>>()
    );
    assert!(live.iter().all(|d| !d.state.terminal()));
    assert!(live.iter().any(|d| d.state == DealState::Receipted));
    assert!(live.windows(2).all(|w| w[0].id < w[1].id));
}

/// A ledger with one rescue mandate, one counterparty and `n` deals cycling through every state.
pub(crate) fn seeded(n: usize) -> Ledger {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    let owner = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    getrandom::fill(&mut bytes).unwrap();
    let agent = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
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
    ledger
        .insert_mandate(&open, &owner.public_key(), 100)
        .unwrap();
    getrandom::fill(&mut bytes).unwrap();
    let peer = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    let cp = Counterparty {
        key_id: peer.key_id().unwrap(),
        owner_key: peer.public_key().to_bytes(),
        agent_key: peer.public_key().to_bytes(),
        display_name: ShortText::new("Seller".into()).unwrap(),
        paired_via: PairedVia::Code,
        words_confirmed_at: Some(100),
        declared_payee: PayeeRef::new("shop").unwrap(),
        first_seen: 100,
    };
    ledger.insert_counterparty(&cp).unwrap();
    for n in 0..n {
        let d = deal(n as u128 + 1, mandate, cp.key_id.clone());
        ledger.create_deal(&d, 1).unwrap();
        let state = DealState::ALL[n % DealState::ALL.len()];
        ledger
            .conn
            .execute(
                "UPDATE deals SET state=?1, pp_order_id=?2 WHERE id=?3",
                rusqlite::params![
                    repositories::enum_text(&state).unwrap(),
                    (n % 3 == 0).then(|| format!("ORDER{n}")),
                    d.id.to_string()
                ],
            )
            .unwrap();
    }
    ledger
}

/// The whole-wallet list is the same projection as reading each deal by id, field for field,
/// for every state and with optional columns both set and empty.
#[test]
fn list_deals_is_the_by_id_projection_of_every_deal_in_id_order() {
    let ledger = seeded(3 * DealState::ALL.len());
    let all = ledger.list_deals().unwrap();
    assert_eq!(all.len(), 3 * DealState::ALL.len());
    assert!(all.windows(2).all(|w| w[0].id < w[1].id));
    for listed in &all {
        let by_id = ledger.get_deal(listed.id).unwrap();
        assert_eq!(
            serde_json::to_value(listed).unwrap(),
            serde_json::to_value(&by_id).unwrap()
        );
    }
    let live = ledger.list_live_deals().unwrap();
    assert_eq!(
        live.iter().map(|d| d.id).collect::<Vec<_>>(),
        all.iter()
            .filter(|d| !d.state.terminal())
            .map(|d| d.id)
            .collect::<Vec<_>>()
    );
}

/// The list still re-checks every row's stored terms hash: one tampered row fails the list.
#[test]
fn list_deals_refuses_a_row_whose_terms_hash_was_tampered() {
    let ledger = seeded(5);
    ledger
        .conn
        .execute(
            "UPDATE deals SET qty=qty+1 WHERE id=?1",
            [format!("{:026}", 3)],
        )
        .unwrap();
    assert!(matches!(
        ledger.list_deals(),
        Err(LedgerError::Integrity("stored terms hash"))
    ));
    assert!(matches!(
        ledger.list_live_deals(),
        Err(LedgerError::Integrity("stored terms hash")) | Ok(_)
    ));
}

/// The ids of ended deals, the attention read and the shared currency are the same facts the
/// whole-book read gives.
#[test]
fn the_narrow_reads_agree_with_the_whole_book_read() {
    let ledger = seeded(4 * DealState::ALL.len());
    let all = ledger.list_deals().unwrap();
    assert_eq!(
        ledger.terminal_deal_ids().unwrap(),
        all.iter()
            .filter(|d| d.state.terminal())
            .map(|d| d.id)
            .collect::<Vec<_>>()
    );
    assert_eq!(ledger.uniform_deal_currency().unwrap(), Some(Currency::USD));
    assert_eq!(
        Ledger::in_memory()
            .unwrap()
            .uniform_deal_currency()
            .unwrap(),
        None
    );
    // A quiet ended deal (no hold, no open step) is not read; a held one and one with an open
    // money step are, whatever state they ended in.
    let quiet: Vec<_> = all
        .iter()
        .filter(|d| {
            d.state.terminal() && !matches!(d.state, DealState::Refused | DealState::Mismatch)
        })
        .map(|d| d.id)
        .collect();
    let attended = ledger.list_attention_deals().unwrap();
    assert!(attended.windows(2).all(|w| w[0].id < w[1].id));
    assert!(attended.iter().all(|d| !quiet.contains(&d.id)));
    assert_eq!(
        attended.len(),
        all.len() - quiet.len(),
        "every live, refused and mismatched deal"
    );
    let (held, checked) = (quiet[0], quiet[1]);
    ledger
        .conn
        .execute(
            "UPDATE deals SET shield_verdict='HOLD' WHERE id=?1",
            [held.to_string()],
        )
        .unwrap();
    ledger
        .conn
        .execute(
            "INSERT INTO operations(deal_id,attempt,operation,request_id,decided_by,status,started_at) VALUES (?1,1,'capture','r1',?2,'unknown',5)",
            rusqlite::params![
                checked.to_string(),
                serde_json::to_string(&DecidedBy::Human { at: 5 }).unwrap()
            ],
        )
        .unwrap();
    let attended = ledger.list_attention_deals().unwrap();
    assert!(attended.iter().any(|d| d.id == held));
    assert!(attended.iter().any(|d| d.id == checked));
    assert_eq!(attended.len(), all.len() - quiet.len() + 2);
    assert!(attended.windows(2).all(|w| w[0].id < w[1].id));
    ledger
        .conn
        .execute(
            "UPDATE deals SET currency='EUR' WHERE id=?1",
            [held.to_string()],
        )
        .unwrap();
    assert_eq!(ledger.uniform_deal_currency().unwrap(), None);
}

/// Timing probe, not a gate: `cargo test -p table-ledger --release -- --ignored --nocapture
/// list_deals_timing_probe`. The desktop actor reads the whole list on every 1 s tick; the Record
/// pages the audit chain. Prints the per-call time of each read at 500 and 5,000 deals, with four
/// audit rows per deal.
#[test]
#[ignore = "timing probe"]
fn list_deals_timing_probe() {
    fn ms(started: std::time::Instant, calls: u32) -> f64 {
        started.elapsed().as_secs_f64() * 1000.0 / f64::from(calls)
    }
    for deals in [500_usize, 5_000] {
        let mut ledger = seeded(deals);
        let ids: Vec<_> = ledger.list_deals().unwrap().iter().map(|d| d.id).collect();
        for n in 0..deals * 4 {
            ledger
                .append_audit(&AuditEntry {
                    at: 1_000 + n as i64,
                    actor: if n % 3 == 0 { "owner" } else { "agent:buyer-1" }.into(),
                    action: "deal.transition".into(),
                    deal_id: Some(ids[n % ids.len()]),
                    detail: serde_json::json!({"from": "AGREED", "to": "CAPTURED"}),
                })
                .unwrap();
        }
        let started = std::time::Instant::now();
        for _ in 0..20 {
            assert_eq!(ledger.list_deals().unwrap().len(), deals);
        }
        println!(
            "PROBE {deals} deals: list_deals {:.3} ms per call",
            ms(started, 20)
        );
        let started = std::time::Instant::now();
        let mut live = 0;
        for _ in 0..20 {
            live = ledger.list_live_deals().unwrap().len();
        }
        println!(
            "PROBE {deals} deals: list_live_deals ({live} live) {:.3} ms per call",
            ms(started, 20)
        );
        let started = std::time::Instant::now();
        for _ in 0..20 {
            assert_eq!(ledger.audit_page(None, 200).unwrap().0.len(), 200);
        }
        println!(
            "PROBE {deals} deals: audit_page newest 200 of {} rows {:.3} ms per call",
            deals * 4,
            ms(started, 20)
        );
        let started = std::time::Instant::now();
        for _ in 0..20 {
            ledger.verify_audit().unwrap();
        }
        println!(
            "PROBE {deals} deals: verify_audit alone {:.3} ms per call",
            ms(started, 20)
        );
        let query = |filter: Option<&'static str>, newest_first| AuditQuery {
            before: None,
            limit: 200,
            filter,
            newest_first,
        };
        // Cold: a write since the last read forces the whole-chain walk once.
        let started = std::time::Instant::now();
        for n in 0..5 {
            ledger
                .append_audit(&AuditEntry {
                    at: 9_000_000 + n,
                    actor: "owner".into(),
                    action: "deal.transition".into(),
                    deal_id: Some(ids[0]),
                    detail: serde_json::json!({"from": "AGREED", "to": "CAPTURED"}),
                })
                .unwrap();
            ledger.audit_search(&query(None, true)).unwrap();
        }
        println!(
            "PROBE {deals} deals: audit_search after a write (walks the chain) {:.3} ms per call",
            ms(started, 5)
        );
        for (label, filter, newest) in [
            ("no filter, newest", None, true),
            ("no filter, oldest", None, false),
            ("filter 'owner', newest", Some("owner"), true),
            ("filter 'captured', oldest", Some("captured"), false),
            ("filter 'zzz' (no match)", Some("zzz"), true),
        ] {
            let mut total = 0;
            let started = std::time::Instant::now();
            for _ in 0..20 {
                total = ledger
                    .audit_search(&query(filter, newest))
                    .unwrap()
                    .total_matching;
            }
            println!(
                "PROBE {deals} deals: audit_search warm, {label} ({total} matching of {}) {:.3} ms per call",
                deals * 4 + 5,
                ms(started, 20)
            );
        }
    }
}
