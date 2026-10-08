//! Acceptance H5: the seller wallet takes money in on an order the buyer approved at PayPal with
//! no owner click. HOLD and BLOCK still stop it, and the rest of the shield gate is unchanged.
use super::*;
use table_app::{Authority, MoneyStep};

fn count(http: &OfflineHttp, suffix: &str) -> usize {
    http.0
        .lock()
        .unwrap()
        .paths
        .iter()
        .filter(|p| p.ends_with(suffix))
        .count()
}
/// The `shield.refused` audit rows of a deal's `step`: one per verdict, however many ticks.
pub(super) fn shield_refusals(r: &Runtime, id: DealId, step: &str) -> usize {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.iter()
        .filter(|row| {
            row.deal_id == Some(id) && row.action == "shield.refused" && row.detail["step"] == step
        })
        .count()
}
fn state(r: &Runtime, id: DealId) -> DealState {
    r.pipeline.wallet.ledger.get_deal(id).unwrap().state
}
/// Each money operation's authority, as its `money.authorized` audit row records it (the same
/// value the ledger writes to `operations.decided_by`).
fn money_authorities(r: &Runtime, id: DealId) -> Vec<(String, DecidedBy)> {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    let mut found: Vec<_> = rows
        .into_iter()
        .filter(|row| row.deal_id == Some(id) && row.action == "money.authorized")
        .map(|row| {
            (
                row.at,
                row.detail["operation"].as_str().unwrap().to_owned(),
                serde_json::from_value(row.detail["decided_by"].clone()).unwrap(),
            )
        })
        .collect();
    found.sort_by_key(|(at, op, _)| {
        (
            *at,
            ["create", "authorize", "capture"]
                .iter()
                .position(|o| o == op),
        )
    });
    found.into_iter().map(|(_, op, d)| (op, d)).collect()
}
/// A seller haggle with no market reference, agreed at 100 with the payment executor
/// configured. The create gate still asks, so the scheduler's create on policy is refused; the
/// owner creates the order from the approval window (`Decision::Countersign`), as
/// `real_actor_countersign_verified_browser_link_poll_and_seller_capture` does.
pub(super) async fn owner_ordered(
    r: &mut Runtime,
    vault: &MemoryVault,
    http: &OfflineHttp,
) -> Deal {
    credentials(vault);
    let (deal, peer) = setup_unpriced(r, Side::Seller, Delivery::DigitalNow);
    agree(r, &deal, &peer);
    assert!(r.settings().unwrap().payment_executor_configured);
    r.tick().await.unwrap();
    assert_eq!(state(r, deal.id), DealState::Agreed);
    assert_eq!(count(http, "/checkout/orders"), 0);
    let token = unlock_runtime(r);
    r.selected = Some(deal.id);
    let args = decision(r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    assert_eq!(state(r, deal.id), DealState::AwaitingApproval);
    assert_eq!(
        r.pipeline.shield_verdict(deal.id, r.clock.now()).unwrap(),
        ShieldVerdict::Ask
    );
    deal
}

#[tokio::test]
async fn h5_the_seller_takes_money_in_on_the_buyers_approval_with_no_click() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = owner_ordered(&mut r, &vault, &http).await;
    // The buyer approves at PayPal at 1990 and the next tick runs at 2000. The approval window
    // has idle-locked by then: no owner ticket could be spent.
    clock.0.store(2000, Ordering::SeqCst);
    assert!(r.settings().unwrap().locked);
    assert_eq!(
        r.pipeline.shield_verdict(deal.id, 2000).unwrap(),
        ShieldVerdict::Ask
    );
    r.tick().await.unwrap();
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, DealState::Receipted);
    assert!(matches!(
        after.decided_by,
        Some(DecidedBy::SellerMandate { .. })
    ));
    let authorities = money_authorities(&r, deal.id);
    let operations: Vec<_> = authorities.iter().map(|(op, _)| op.as_str()).collect();
    assert_eq!(operations, ["create", "authorize", "capture"]);
    assert!(matches!(authorities[0].1, DecidedBy::Human { .. }));
    for (_, decided) in &authorities[1..] {
        assert!(
            matches!(decided, DecidedBy::SellerMandate { .. }),
            "{decided:?}"
        );
    }
    assert_eq!(count(&http, "/authorize"), 1);
    assert_eq!(count(&http, "/capture"), 1);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
    r.pipeline.wallet.ledger.verify_transcript(deal.id).unwrap();
}

#[tokio::test]
async fn a_fresh_price_hold_stops_the_sellers_authorize_and_ageing_never_lifts_it() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = owner_ordered(&mut r, &vault, &http).await;
    // A fresh reference arrives: 12.00 against a median of 8.00 is over 1.4 x the median.
    let market = MarketRef::from_comparables(
        vec![Money::new(800, Currency::USD).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(deal.id, &market, 100)
        .unwrap();
    let mut rows = None;
    // 130 is within the reference's 900 s; the later ticks see it stale.
    for at in [130, 100 + 900, 100 + 901, 100 + 3600] {
        clock.0.store(at, Ordering::SeqCst);
        assert_eq!(
            r.pipeline.shield_verdict(deal.id, at).unwrap(),
            ShieldVerdict::Hold,
            "at {at}"
        );
        // The first tick sees the buyer's approval; the pipeline refuses the seller mandate's
        // authorize and records it once: no fault on this or any later tick (shield slice 2).
        r.tick().await.unwrap();
        assert_eq!(state(&r, deal.id), DealState::Approved);
        assert_eq!(shield_refusals(&r, deal.id, "authorize"), 1, "at {at}");
        let held = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
        assert_eq!(held.shield, Some(ShieldVerdict::Hold));
        assert_eq!(held.shield_rule, Some(ShieldRule::PriceOverMarket));
        assert!(held.shield_held());
        assert_eq!(count(&http, "/authorize"), 0);
        let now_rows = r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap();
        assert_eq!(*rows.get_or_insert(now_rows), now_rows, "at {at}");
        assert!(
            money_authorities(&r, deal.id)
                .iter()
                .all(|(op, _)| op == "create")
        );
    }
    // The attention ladder shows it to the owner as a HOLD with the rule that holds it.
    let item = r
        .attention()
        .unwrap()
        .items
        .into_iter()
        .find(|i| i.deal_id == deal.id)
        .unwrap();
    assert_eq!(item.kind, table_attention::AttnKind::Hold);
    assert_eq!(item.shield_rule, Some(ShieldRule::PriceOverMarket));
}

#[tokio::test]
async fn a_payee_mismatch_blocks_and_nothing_moves() {
    // At PayPal: the approved order names another payee. The order check catches it at the
    // poll; the deal enters Mismatch and nothing is authorized.
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = owner_ordered(&mut r, &vault, &http).await;
    http.0.lock().unwrap().units.as_mut().unwrap()[0]["payee"]["merchant_id"] =
        json!("someone-else");
    clock.0.store(130, Ordering::SeqCst);
    assert!(r.tick().await.is_err());
    assert_eq!(state(&r, deal.id), DealState::Mismatch);
    assert_eq!(count(&http, "/authorize"), 0);
    // The order check's payee half writes the shield's BLOCK (shield slice 2): from PayPal's
    // typed payee field, recorded before the mismatch, and never released.
    let blocked = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(blocked.shield, Some(ShieldVerdict::Block));
    assert_eq!(blocked.shield_rule, Some(ShieldRule::PayeeMismatch));
    assert!(blocked.shield_held());
    let calls = http.0.lock().unwrap().paths.len();
    r.tick().await.unwrap();
    assert_eq!(
        http.0.lock().unwrap().paths.len(),
        calls,
        "a mismatch asks PayPal nothing more"
    );

    // On the deal: a BLOCK verdict (the payee rule's) stops the seller mandate after the
    // buyer's approval, and stays a BLOCK.
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = owner_ordered(&mut r, &vault, &http).await;
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Block, 100)
        .unwrap();
    for at in [130, 100 + 3600] {
        clock.0.store(at, Ordering::SeqCst);
        assert_eq!(
            r.pipeline.shield_verdict(deal.id, at).unwrap(),
            ShieldVerdict::Block
        );
        // Refused and recorded once; the tick reports no fault (shield slice 2).
        r.tick().await.unwrap();
        assert_eq!(state(&r, deal.id), DealState::Approved);
        assert_eq!(shield_refusals(&r, deal.id, "authorize"), 1);
    }
    assert_eq!(count(&http, "/authorize"), 0);
    assert_eq!(count(&http, "/capture"), 0);
}

#[tokio::test]
async fn the_sellers_create_on_policy_still_asks() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_unpriced(&mut r, Side::Seller, Delivery::DigitalNow);
    agree(&mut r, &deal, &peer);
    assert_eq!(
        r.pipeline.shield_verdict(deal.id, 100).unwrap(),
        ShieldVerdict::Ask
    );
    assert!(
        !r.pipeline
            .step_allowed(
                deal.id,
                MoneyStep::Create,
                Category::Parts,
                Authority::Policy,
                100,
                false
            )
            .unwrap()
    );
    assert!(matches!(
        r.pipeline
            .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await,
        Err(table_app::Error::Permission)
    ));
    assert_eq!(state(&r, deal.id), DealState::Agreed);
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_purchase_step_on_policy_is_still_refused() {
    let (mut r, vault, http, _, _) = runtime(true);
    credentials(vault.as_ref());
    let (_, peer) = setup(&mut r, Side::Buyer);
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
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
    // A fresh, matching market: the shield clears, so only the purchase rule refuses.
    let market = MarketRef::from_comparables(vec![deal.terms.unit_price], 100, H256::ZERO).unwrap();
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(deal.id, &market, 100)
        .unwrap();
    assert_eq!(
        r.pipeline.shield_verdict(deal.id, 100).unwrap(),
        ShieldVerdict::Clear
    );
    for (step, authority) in [
        (MoneyStep::Create, Authority::Policy),
        (MoneyStep::Authorize, Authority::Policy),
        (MoneyStep::Capture, Authority::Policy),
        // Money going out never runs on the seller mandate, whatever the shield says.
        (MoneyStep::Authorize, Authority::SellerMandate),
        (MoneyStep::Capture, Authority::SellerMandate),
    ] {
        assert!(
            !r.pipeline
                .step_allowed(deal.id, step, Category::Parts, authority, 100, true)
                .unwrap(),
            "{step:?}"
        );
    }
    assert!(matches!(
        r.pipeline
            .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await,
        Err(table_app::Error::Permission)
    ));
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Agreed);
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_released_price_hold_lets_the_approved_order_in_as_the_owners_decision() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = owner_ordered(&mut r, &vault, &http).await;
    // 12.00 against a fresh median of 8.00: the shield holds the seller's authorize.
    let market = MarketRef::from_comparables(
        vec![Money::new(800, Currency::USD).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(deal.id, &market, 100)
        .unwrap();
    clock.0.store(130, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Approved);
    assert_eq!(shield_refusals(&r, deal.id, "authorize"), 1);
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .shield_held()
    );
    // The owner unpauses it in the approval window: an explicit owner authority, recorded.
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::ReleaseHold),
    )
    .await
    .unwrap();
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    let released = rows
        .iter()
        .find(|row| row.deal_id == Some(deal.id) && row.action == "shield.released")
        .unwrap();
    assert_eq!(released.actor, "owner");
    assert_eq!(released.detail["rules"], json!(["price_over_market"]));
    assert!(matches!(
        serde_json::from_value::<DecidedBy>(released.detail["decided_by"].clone()).unwrap(),
        DecidedBy::Human { .. }
    ));
    assert_eq!(
        count(&http, "/authorize"),
        0,
        "a release moves no money by itself"
    );
    // The next tick takes the buyer's approved order in: the release covers these terms.
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Receipted);
    assert_eq!(count(&http, "/authorize"), 1);
    assert_eq!(count(&http, "/capture"), 1);
    // Recorded once, never again: the refusal row did not repeat.
    assert_eq!(shield_refusals(&r, deal.id, "authorize"), 1);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
    // Proof v2: the money steps after the hold each went ahead under the owner's release for
    // these terms; with the release left out of the file, the shield line fails by name.
    let proof = crate::tests::assert_proof_verifies(&r, deal.id);
    let shield = crate::tests::proof_line(&proof, "shield");
    assert!(shield.ok && shield.applies, "{shield:?}");
    assert!(
        shield.detail.contains("2 money step(s) after a hold"),
        "{shield:?}"
    );
    let released = proof
        .audit
        .iter()
        .find(|row| row.action == "shield.released")
        .unwrap()
        .seq;
    crate::tests::assert_forgery_fails(&r, &proof, "shield", |p| {
        p.audit.retain(|row| row.seq != released);
    });
}
