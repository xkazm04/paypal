#![allow(clippy::unwrap_used, clippy::expect_used)]
use ed25519_dalek::SigningKey;
use table_app::*;
use table_core::*;
use table_ledger::*;
use table_proto::*;
pub fn signer() -> AgentSigner {
    let mut b = [0; 32];
    getrandom::fill(&mut b).unwrap();
    let s = AgentSigner::from_key(SigningKey::from_bytes(&b));
    b.fill(0);
    s
}
pub fn setup(side: Side, kind: DealKind) -> (Wallet, Deal, AgentSigner, AgentSigner) {
    let owner = signer();
    let own = signer();
    let peer = signer();
    let money = |v| Money::new(v, Currency::USD).unwrap();
    let payee = PayeeRef::new("merchant").unwrap();
    let payload = MandatePayload {
        id: "00000000000000000000000002".parse().unwrap(),
        version: 1,
        agent_key: own.public_key().to_bytes(),
        not_before: 0,
        expires: 1_000_000,
        clauses: vec![
            Clause::Roles {
                roles: vec![if side == Side::Buyer {
                    Role::Buy
                } else {
                    Role::Sell
                }],
            },
            Clause::Counterparties {
                rule: CpRule::Paired,
            },
            Clause::PerDeal {
                kind,
                max_amount: money(2500),
                categories: vec![Category::Parts],
            },
            Clause::Band {
                item_refs: vec![ItemRef::new("monitor").unwrap()],
                floor: Some(money(1000)),
                ceiling: Some(money(2500)),
                max_rounds: 6,
                deadline: 900_000,
            },
            Clause::Velocity {
                max_deals_day: 10,
                max_total_day: money(100_000),
            },
            Clause::HumanPresentOver {
                amount: money(1500),
            },
            Clause::Payees {
                payees: vec![payee.clone()],
            },
        ],
    };
    let m = OpenMandate {
        owner_sig: owner.sign_payload(&payload).unwrap(),
        payload,
    };
    let mut ledger = Ledger::in_memory().unwrap();
    ledger.insert_mandate(&m, &owner.public_key(), 100).unwrap();
    let cp = Counterparty {
        key_id: peer.key_id().unwrap(),
        owner_key: peer.public_key().to_bytes(),
        agent_key: peer.public_key().to_bytes(),
        display_name: ShortText::new("Peer".into()).unwrap(),
        paired_via: PairedVia::Code,
        words_confirmed_at: Some(100),
        declared_payee: payee,
        first_seen: 100,
    };
    ledger.insert_counterparty(&cp).unwrap();
    let deal = Deal {
        created_at: 100,
        updated_at: 100,
        id: "00000000000000000000000001".parse().unwrap(),
        kind,
        side,
        counterparty: cp.key_id,
        terms: Terms {
            item_ref: ItemRef::new("monitor").unwrap(),
            qty: 1,
            unit_price: money(1200),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state: DealState::Pairing,
        mandate_id: m.payload.id,
        mandate_version: 1,
        transcript_head: H256::ZERO,
        paypal: PaypalRefs::default(),
        mode: Mode::Sandbox,
        market: Some(MarketRef::from_comparables(vec![money(1200)], 100, H256::ZERO).unwrap()),
        shield: None,
        decided_by: None,
        shield_rule: None,
        shield_release: None,
    };
    ledger.create_deal(&deal, 100).unwrap();
    (
        Wallet::new(ledger, own, owner.public_key()),
        deal,
        owner,
        peer,
    )
}
