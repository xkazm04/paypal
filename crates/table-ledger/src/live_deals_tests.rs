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
