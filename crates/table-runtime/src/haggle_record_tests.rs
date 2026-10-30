#![allow(clippy::unwrap_used, clippy::expect_used)]
//! The haggle recorder. The shipped practice agent plays the demo's monitor tables through the
//! wallet's real MCP door and mandate check, on the demo's rules and market:
//! - `house`: against the house seller's own concession rule (`Policy::decide_on_schedule`, the rule
//!   `services/house-seller` answers every offer with, its round counted as the house counts it),
//!   through the wallet's refusal of the agent's yes, the owner's own accept and the agreement;
//! - `dan`: against a paired seller whose counters are given (the golden run of 614ed59), up to the
//!   wallet's refusal of the agent's yes, where the deal waits for the owner.
//!
//! Every signed price, each refusal and each decision land in
//! `apps/desktop/client/src/mock/haggle.json`, which the browser preview's tables, the director's
//! captions, the corridor and the arena's recorder (`table-app/tests/gauntlet/arena.rs`, Dan's table)
//! draw from. The house table's deal, as the wallet exports it once it is agreed, is kept as the
//! proof checker's sample `d-0205.tableproof` (the preview's D-0205). The test fails when the engine
//! and those files drift apart; `TABLE_RECORD=haggle` (or `all`; the older `TABLE_HAGGLE_RECORD=1`
//! still works) writes them again from what the engine signs.
use super::policy_tests::{envelope, install, pump};
use super::*;
use table_core::negotiation::{Decision as House, Policy};

#[path = "../../table-app/tests/recorded/mod.rs"]
mod recorded;

/// The recording, from this crate's directory.
const RECORDING: &str = "../../apps/desktop/client/src/mock/haggle.json";
/// The house table's agreed deal, as the wallet exports it: the proof checker's recorded sample.
const HOUSE_PROOF: &str = "../../apps/desktop/client/src/lib/proof/sample/d-0205.tableproof";
const RERUN: &str = "TABLE_RECORD=haggle cargo test -p table-runtime --lib recorded_haggles";
/// The demo's rules (the film's and the director's): Maya pays at most $340 over six offers, and
/// above $250 she decides. The market for the monitor: p25 $300, median $330, p75 $360.
const CEILING: i64 = 34_000;
/// Her limit per deal, as she signed it in the preview (mandate M-14): no deal over $340.
const PER_DEAL: i64 = 34_000;
const ROUNDS: u8 = 6;
const ASK_ABOVE: i64 = 25_000;
const COMPARABLES: [i64; 5] = [30_000, 30_000, 33_000, 36_000, 36_000];
/// The house seller's signed band for the monitor: it lists at $340 and concedes to $316 over six
/// rounds. Its floor is public, a clause of the release-signed mandate every buyer verifies.
const HOUSE_ASK: i64 = 34_000;
const HOUSE_FLOOR: i64 = 31_600;
const HOUSE_ROUNDS: u8 = 6;
/// Dan lists at $340 (a buyer table cannot open above its ceiling) and comes down by these
/// counters, one per offer of Maya's agent: the golden run's (policy_tests.rs).
const DAN_ASK: i64 = 34_000;
const DAN_COUNTERS: [i64; 5] = [33_900, 33_600, 33_400, 33_300, 32_900];

/// How the other side answers each of the agent's offers.
enum Seller {
    /// The house seller's rule; its round is the number of offers it has heard.
    House(Policy),
    /// A paired seller's given counters, in order.
    Given(&'static [i64]),
}

/// One line of the recording, in the order it happened. `by` is `seller`, `agent` or `owner`;
/// `act` is the transcript's type in lower case, or `refused` for an agent intent the wallet
/// refused (nothing was sent).
fn line(by: &str, act: &str, price: i64) -> Value {
    json!({"by": by, "act": act, "price": price})
}

/// Plays one table to the wallet's refusal of the agent's yes and, when `owner_says_yes`, on through
/// the owner's accept and the seller's to the agreement. Returns the steps, the outcome and, for an
/// agreed table, the deal as the wallet exports it.
async fn play(
    seller: Seller,
    ask: i64,
    port: u16,
    owner_says_yes: bool,
) -> (Vec<Value>, Value, Option<table_proto::ProofBundle>) {
    let usd = |n| Money::new(n, Currency::USD).unwrap();
    let (mut r, _, http, _, _) = runtime(true);
    let mut limits = clauses(Side::Buyer, DealKind::Haggle);
    if let Clause::PerDeal { max_amount, .. } = &mut limits[2] {
        *max_amount = usd(PER_DEAL);
    }
    if let Clause::Band {
        floor,
        ceiling,
        max_rounds,
        ..
    } = &mut limits[3]
    {
        *floor = None;
        *ceiling = Some(usd(CEILING));
        *max_rounds = ROUNDS;
    }
    if let Clause::HumanPresentOver { amount } = &mut limits[5] {
        *amount = usd(ASK_ABOVE);
    }
    let (deal, peer) = setup_priced(&mut r, Side::Buyer, Delivery::DigitalNow, limits, usd(ask));
    let market = MarketRef::certified_prices(
        "monitor",
        H256::digest(b"similar"),
        &COMPARABLES.map(usd),
        100,
    )
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(deal.id, &market, 100)
        .unwrap();

    // The run's MCP door, bridged to a channel this test drains as the actor loop does.
    let loopback = install(&mut r);
    let (tx, mut rx) = tokio::sync::mpsc::channel(64);
    r.actor_sender = Some(tx.downgrade());
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(tx.downgrade())),
        port,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    *loopback.0.lock().unwrap() = Some(server.clone().router());
    r.mcp = Some((server, format!("http://127.0.0.1:{port}/mcp")));
    let steps = |r: &Runtime| r.pipeline.wallet.ledger.deal_transcript(deal.id).unwrap();
    let refusals = |r: &Runtime| -> Vec<table_ledger::AuditRecord> {
        let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, u16::MAX).unwrap();
        rows.into_iter()
            .filter(|a| a.action == "intent.refused" && a.deal_id == Some(deal.id))
            .filter(|a| a.detail["layer"] == "wallet")
            .collect()
    };
    let next_seq = |r: &Runtime| steps(r).iter().map(|s| s.seq).max().unwrap_or(0) + 1;

    // The seller lists the monitor; Maya presses Start agent.
    let raw = envelope(
        &r,
        &deal,
        &peer,
        1,
        Body::Listing {
            item_ref: deal.terms.item_ref.clone(),
            ask: deal.terms.unit_price,
            qty: Some(deal.terms.qty),
            delivery: deal.terms.delivery.clone(),
        },
        table_proto::MsgType::Listing,
    );
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    r.start_agent(deal.id).unwrap();
    pump(&mut r, &mut rx).await;

    // The seller answers each of the agent's offers, and each counter re-arms one run of the agent.
    // The haggle ends when the agent stops offering: a refusal, an agreement or a withdrawal.
    let mut refused_at = None;
    for _ in 0..u32::from(ROUNDS) * 2 {
        let now = steps(&r);
        let last = now.last().unwrap();
        if !(last.by == TranscriptBy::You && last.typ == TranscriptType::Offer) {
            break;
        }
        let offers = now
            .iter()
            .filter(|s| s.by == TranscriptBy::You && s.typ == TranscriptType::Offer)
            .count();
        let answer = match &seller {
            Seller::House(rule) => rule
                .decide_on_schedule(last.price.unwrap(), u8::try_from(offers).unwrap())
                .unwrap(),
            Seller::Given(counters) => match counters.get(offers - 1) {
                Some(price) => House::Counter(usd(*price)),
                None => House::Withdraw,
            },
        };
        let body = match answer {
            House::Counter(price) => Body::Counter {
                price,
                delivery: deal.terms.delivery.clone(),
            },
            House::Accept => {
                let (offer_seq, terms_hash) =
                    r.pipeline.wallet.ledger.pending_offer(deal.id).unwrap();
                Body::Accept {
                    offer_seq,
                    terms_hash,
                    owner_accept: None,
                }
            }
            House::Withdraw => break,
        };
        let typ = body.typ();
        let raw = envelope(&r, &deal, &peer, next_seq(&r), body, typ);
        r.pipeline
            .wallet
            .receive_haggle(deal.id, &raw, Category::Parts, 100)
            .unwrap();
        r.tick().await.unwrap();
        pump(&mut r, &mut rx).await;
        if let Some(refusal) = refusals(&r).first() {
            refused_at = Some((
                refusal.detail["tool"].clone(),
                refusal.detail["clause"].clone(),
            ));
            break;
        }
    }
    let mut lines = Vec::new();
    for s in steps(&r) {
        let by = if s.by == TranscriptBy::You {
            "agent"
        } else {
            "seller"
        };
        let act = serde_json::to_value(s.typ).unwrap();
        lines.push(line(
            by,
            act.as_str().unwrap().to_lowercase().as_str(),
            s.price.unwrap().minor(),
        ));
    }

    // The agent would take the seller's last counter, but it is above $250: the wallet refuses
    // the agent's ACCEPT under Maya's ask-me rule and puts the decision in front of her.
    let (tool, clause) = refused_at.expect("the wallet refuses the agent's yes");
    assert_eq!(tool, "accept_offer");
    assert_eq!(clause, 6);
    let wanted = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(wanted.state, DealState::Negotiating);
    let price = wanted.terms.unit_price.minor();
    assert!(price > ASK_ABOVE && price <= CEILING);
    lines.push(json!({"by": "agent", "act": "refused", "price": price, "clause": 6}));
    let attention: table_attention::AttentionSnapshot = serde_json::from_value(
        r.execute(caller("main", None), Action::Attention)
            .await
            .unwrap(),
    )
    .unwrap();
    let gate = attention
        .items
        .iter()
        .find(|i| i.deal_id == deal.id)
        .expect("a gate for Maya");
    assert_eq!(gate.clause.as_ref().map(|c| c.number), Some(6));
    assert!(http.0.lock().unwrap().paths.is_empty());
    // Every price the agent signed stays inside Maya's range.
    assert!(
        lines
            .iter()
            .filter(|l| l["by"] == "agent" && l["act"] == "offer")
            .all(|l| l["price"].as_i64().unwrap() <= CEILING)
    );
    if !owner_says_yes {
        let outcome = json!({"state": "NEGOTIATING", "price": price, "waiting_for": "owner", "paypal_calls": 0});
        return (lines, outcome, None);
    }

    // Maya decides in the approval window: she accepts the seller's counter with her own key.
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let summary = r.summary(deal.id).unwrap();
    assert!(summary.can_owner_accept, "{summary:?}");
    r.decide(
        "approval",
        Some(&token),
        DecisionArgs {
            deal_id: deal.id,
            attempt: summary.attempt,
            terms_hash: summary.terms_hash,
            counter_hash: summary.counter_hash,
            checks_hash: Some(summary.checks_hash),
        },
        Decision::OwnerAccept,
    )
    .await
    .unwrap();
    let mine = steps(&r);
    let accept = mine.last().unwrap();
    assert_eq!(
        (accept.by, accept.typ),
        (TranscriptBy::You, TranscriptType::Accept)
    );
    lines.push(line(
        "owner",
        "accept",
        accept.price.map_or(price, |p| p.minor()),
    ));
    // The seller countersigns an ACCEPT of its own counter: two accepts, the deal is agreed.
    let (offer_seq, terms_hash) = r.pipeline.wallet.ledger.pending_offer(deal.id).unwrap();
    let raw = envelope(
        &r,
        &deal,
        &peer,
        next_seq(&r),
        Body::Accept {
            offer_seq,
            terms_hash,
            owner_accept: None,
        },
        table_proto::MsgType::Accept,
    );
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    let agreed = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let theirs = steps(&r);
    let last = theirs.last().unwrap();
    lines.push(line(
        "seller",
        "accept",
        last.price.map_or(price, |p| p.minor()),
    ));
    assert_eq!(agreed.state, DealState::Agreed);
    assert_eq!(agreed.terms.unit_price.minor(), price);
    // Agreeing moves no money: nothing reached PayPal.
    assert!(http.0.lock().unwrap().paths.is_empty());
    let outcome =
        json!({"state": "AGREED", "price": price, "decided_by": "owner", "paypal_calls": 0});
    let bundle = r.export_proof(deal.id).unwrap();
    (lines, outcome, Some(bundle))
}

#[tokio::test]
async fn the_recorded_haggles_are_what_the_engine_signs() {
    let usd = |n| Money::new(n, Currency::USD).unwrap();
    let house = Policy {
        floor: usd(HOUSE_FLOOR),
        ask: usd(HOUSE_ASK),
        max_rounds: HOUSE_ROUNDS,
    };
    let (house_steps, house_outcome, house_deal) =
        play(Seller::House(house), HOUSE_ASK, 8766, true).await;
    let (dan_steps, dan_outcome, _) =
        play(Seller::Given(&DAN_COUNTERS), DAN_ASK, 8767, false).await;
    let market = MarketRef::certified_prices(
        "monitor",
        H256::digest(b"similar"),
        &COMPARABLES.map(usd),
        100,
    )
    .unwrap();
    let recording = json!({
        "schema": 2,
        "recorded_by": "crates/table-runtime/src/haggle_record_tests.rs",
        "how": format!("The shipped practice agent through the wallet's MCP door and mandate check. Re-record with {RERUN}."),
        "currency": "USD",
        "item": "monitor",
        "rules": {"ceiling": CEILING, "floor": null, "max_offers": ROUNDS, "ask_above": ASK_ABOVE, "per_deal": PER_DEAL},
        "market": {
            "p25": market.p25.minor(),
            "median": market.median.minor(),
            "p75": market.p75.minor(),
            "comparables": COMPARABLES,
        },
        "tables": {
            "house": {
                "seller": {"rule": "house", "ask": HOUSE_ASK, "floor": HOUSE_FLOOR, "rounds": HOUSE_ROUNDS},
                "steps": house_steps,
                "outcome": house_outcome,
            },
            "dan": {
                "seller": {"rule": "given", "ask": DAN_ASK, "counters": DAN_COUNTERS},
                "steps": dan_steps,
                "outcome": dan_outcome,
            },
        },
    });
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let record = recorded::recording("haggle", Some("TABLE_HAGGLE_RECORD"));
    // The house table's agreed deal: the proof checker's recorded sample (the preview's D-0205).
    recorded::keep_bundle(
        &root.join(HOUSE_PROOF),
        &house_deal.expect("the house table is agreed"),
        record,
        RERUN,
    )
    .unwrap_or_else(|e| panic!("{e}"));
    let path = root.join(RECORDING);
    if record {
        let mut text = serde_json::to_string_pretty(&recording).unwrap();
        text.push('\n');
        std::fs::write(&path, text).unwrap();
        return;
    }
    let file: Value = serde_json::from_slice(
        &std::fs::read(&path)
            .unwrap_or_else(|e| panic!("{}: {e}; record it with {RERUN}", path.display())),
    )
    .unwrap();
    if let Some(diff) = recorded::first_difference("haggle", &file, &recording) {
        panic!(
            "{} drifted from what the engine signs ({diff}); re-record it with {RERUN}",
            path.display()
        );
    }
}
