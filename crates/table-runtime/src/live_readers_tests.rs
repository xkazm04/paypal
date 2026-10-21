#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The forecast, the market watch and the agent waits read only live deals: a terminal deal adds
//! nothing to any of them, and the open deal reads as it did when every deal was listed.
use super::*;
use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use std::sync::{Arc, atomic::AtomicI64};
use table_core::*;
use table_ledger::{Counterparty, Ledger, PairedVia};
use table_paypal::http::*;
use table_proto::*;
use vault::{MemoryVault, VaultCredentials};

#[derive(Debug)]
struct FixedClock(AtomicI64);
impl Clock for FixedClock {
    fn now(&self) -> i64 {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
}
#[derive(Debug)]
struct Present;
#[async_trait]
impl reauth::OsReauth for Present {
    fn supported(&self) -> bool {
        true
    }
    async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
        Ok(())
    }
}
#[derive(Debug)]
struct Offline;
#[async_trait]
impl Transport for Offline {
    async fn send(&self, _: Request) -> Result<Response, TransportError> {
        Err(TransportError)
    }
}
#[derive(Debug)]
struct NoDelay;
#[async_trait]
impl Backoff for NoDelay {
    async fn wait(&self, _: u8) {}
}
#[derive(Debug)]
struct NoMarket;
#[async_trait]
impl table_market::MarketApi for NoMarket {
    async fn comparables(&self, _: &str, _: Currency) -> Result<MarketRef, table_market::Error> {
        Err(table_market::Error::Unavailable)
    }
    async fn start_tracking(&self, _: &str) -> Result<(), table_market::Error> {
        Ok(())
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, table_market::Error> {
        Ok(Vec::new())
    }
}

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn deal(n: u128, state: DealState, mandate: MandateId, counterparty: KeyId) -> Deal {
    Deal {
        created_at: 0,
        updated_at: 0,
        id: format!("{n:026}").parse().unwrap(),
        kind: DealKind::Haggle,
        side: Side::Seller,
        counterparty,
        terms: Terms {
            item_ref: ItemRef::new("monitor").unwrap(),
            qty: 1,
            unit_price: usd(1200),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state,
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
fn a_terminal_deal_adds_nothing_to_the_forecast_the_watch_or_the_waits() {
    let vault = Arc::new(MemoryVault::default());
    let clock = Arc::new(FixedClock(AtomicI64::new(200)));
    let api = Arc::new(table_paypal::Client::sandbox(
        Arc::new(Offline),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    let mut r = Runtime::new(
        Ledger::in_memory().unwrap(),
        vault,
        Arc::new(Present),
        api,
        clock,
    )
    .unwrap();
    r.attach_market(Arc::new(NoMarket));
    let owner = AgentSigner::from_key(r.owner().unwrap());
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    let agent = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    let payload = MandatePayload {
        id: "00000000000000000000000009".parse().unwrap(),
        version: 1,
        agent_key: agent.public_key().to_bytes(),
        not_before: 0,
        expires: 10_000_000,
        clauses: vec![
            Clause::Roles {
                roles: vec![Role::Sell],
            },
            Clause::Counterparties {
                rule: CpRule::Paired,
            },
            Clause::PerDeal {
                kind: DealKind::Haggle,
                max_amount: usd(2500),
                categories: vec![Category::Parts],
            },
            Clause::Band {
                item_refs: vec![ItemRef::new("monitor").unwrap()],
                floor: Some(usd(1000)),
                ceiling: Some(usd(2500)),
                max_rounds: 12,
                deadline: 900_000,
            },
            Clause::Velocity {
                max_deals_day: 10,
                max_total_day: usd(100_000),
            },
            Clause::HumanPresentOver { amount: usd(1500) },
            Clause::Payees {
                payees: vec![PayeeRef::new("merchant").unwrap()],
            },
        ],
    };
    let mandate = payload.id;
    let open = OpenMandate {
        owner_sig: owner.sign_payload(&payload).unwrap(),
        payload,
    };
    let ledger = &mut r.pipeline.wallet.ledger;
    ledger
        .insert_mandate(&open, &owner.public_key(), 100)
        .unwrap();
    getrandom::fill(&mut bytes).unwrap();
    let peer = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    let cp = Counterparty {
        key_id: peer.key_id().unwrap(),
        owner_key: peer.public_key().to_bytes(),
        agent_key: peer.public_key().to_bytes(),
        display_name: ShortText::new("Buyer".into()).unwrap(),
        paired_via: PairedVia::Code,
        words_confirmed_at: Some(100),
        declared_payee: PayeeRef::new("merchant").unwrap(),
        first_seen: 100,
    };
    ledger.insert_counterparty(&cp).unwrap();
    let ended = deal(1, DealState::Pairing, mandate, cp.key_id.clone());
    let live = deal(2, DealState::Pairing, mandate, cp.key_id.clone());
    ledger.create_deal(&ended, 1).unwrap();
    ledger.create_deal(&live, 1).unwrap();
    ledger
        .apply_event(ended.id, DealEvent::Withdraw, 2)
        .unwrap();
    for event in [DealEvent::ListingVerified, DealEvent::OfferVerified] {
        ledger.apply_event(live.id, event, 2).unwrap();
    }
    assert!(
        ledger
            .list_deals()
            .unwrap()
            .iter()
            .any(|d| d.id == ended.id && d.state.terminal()),
        "the ended deal is stored as terminal"
    );

    let lines = r.forecast(201).unwrap();
    assert!(lines.iter().all(|l| l.deal_id != ended.id), "{lines:?}");
    // A job needs a stored market key and a rule that watches the item: neither exists here, and
    // neither deal is planned.
    assert!(r.plan_market_watch(201).unwrap().is_empty());
    let waiting = r.waiting_on_agent(201).unwrap();
    assert!(waiting.iter().all(|w| w.deal_id != ended.id), "{waiting:?}");
    assert_eq!(
        waiting.iter().map(|w| w.deal_id).collect::<Vec<_>>(),
        vec![live.id],
        "the open haggle waits on the agent"
    );
}
