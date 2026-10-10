//! Differential test: the walk-away forecast against the real scheduler. The forecast is read at
//! `T0`; then the clock is set to each line's time and `Runtime::tick` runs. The deal must
//! reach the line's end state on the line's authority, and a deal with no line must not move.
use super::*;
use crate::forecast::FORECAST_HORIZON_SECS;
use std::collections::BTreeSet;
use table_attention::{ForecastAction, ForecastAuthority, ForecastLine, ForecastTrigger};

/// Setup writes at 100; the forecast is read later so a tick's audit rows stand apart.
const T0: i64 = 200;
/// `setup` stores the market reference at 100; the shield asks from 100 + 900.
const MARKET_STALE_AT: i64 = 1000;

fn set(clock: &TestClock, at: i64) {
    clock.0.store(at, Ordering::SeqCst);
}
fn state(r: &Runtime, id: DealId) -> DealState {
    r.pipeline.wallet.ledger.get_deal(id).unwrap().state
}
fn lines_for(r: &mut Runtime, id: DealId) -> Vec<ForecastLine> {
    let snapshot = r.attention().unwrap();
    snapshot
        .forecast
        .expect("the forecast is readable")
        .into_iter()
        .filter(|l| l.deal_id == id)
        .collect()
}
fn same_authority(authority: ForecastAuthority, decided: &DecidedBy) -> bool {
    matches!(
        (authority, decided),
        (
            ForecastAuthority::SafeDefault,
            DecidedBy::SafeDefault { .. }
        ) | (
            ForecastAuthority::MandateRule,
            DecidedBy::Policy { clause: 6 }
        ) | (
            ForecastAuthority::SellerMandate,
            DecidedBy::SellerMandate { .. }
        )
    )
}
/// Every authority the audit chain recorded for this deal at `at`.
fn audited(r: &Runtime, id: DealId, at: i64) -> Vec<DecidedBy> {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.into_iter()
        .filter(|row| row.deal_id == Some(id) && row.at == at)
        .filter_map(|row| serde_json::from_value(row.detail.get("decided_by")?.clone()).ok())
        .collect()
}
/// The time the scheduler acts on a line; `None` for a buyer approval, which silence never
/// supplies.
fn when(line: &ForecastLine, t0: i64) -> Option<i64> {
    match line.trigger {
        ForecastTrigger::NextTick => Some(t0),
        ForecastTrigger::Deadline => line.at,
        ForecastTrigger::BuyerApproves => None,
    }
}

/// Read the forecast at `t0`, then walk the scheduler through it.
async fn walk(r: &mut Runtime, clock: &TestClock, id: DealId, t0: i64) -> Vec<ForecastLine> {
    set(clock, t0);
    let lines = lines_for(r, id);
    let start = state(r, id);
    let timed: Vec<_> = lines
        .iter()
        .filter_map(|l| when(l, t0).map(|at| (at, l)))
        .collect();
    let horizon_end = t0 + FORECAST_HORIZON_SECS;
    let mut ticks: BTreeSet<i64> = timed.iter().map(|(at, _)| *at).collect();
    // Silence at the next tick: with no next-tick line the deal must not move there either.
    ticks.insert(t0);
    if timed.is_empty() {
        ticks.extend((t0..=horizon_end).step_by(6 * 3600));
        ticks.insert(horizon_end);
    }
    let mut expected = start;
    for at in ticks {
        // Just before a deadline line the deal still stands where the forecast left it. A
        // seller order awaiting approval is skipped: the offline PayPal approves at any poll.
        if at > t0
            && !(expected == DealState::AwaitingApproval
                && r.pipeline.wallet.ledger.get_deal(id).unwrap().side == Side::Seller)
        {
            set(clock, at - 1);
            r.tick().await.unwrap();
            assert_eq!(state(r, id), expected, "moved before {at}: {lines:?}");
        }
        set(clock, at);
        r.tick().await.unwrap();
        let here: Vec<_> = timed.iter().filter(|(t, _)| *t == at).collect();
        if let Some((_, last)) = here.last() {
            expected = last.end_state;
            let deal = r.pipeline.wallet.ledger.get_deal(id).unwrap();
            assert_eq!(deal.state, expected, "at {at}: {lines:?}");
            let decided = deal.decided_by.expect("a step records who decided");
            assert!(same_authority(last.authority, &decided), "{decided:?}");
            let audit = audited(r, id, at);
            for (_, line) in &here {
                assert!(
                    audit.iter().any(|d| same_authority(line.authority, d)),
                    "{:?} not audited at {at}: {audit:?}",
                    line.authority
                );
            }
        } else {
            assert_eq!(
                state(r, id),
                expected,
                "moved at {at} with no line: {lines:?}"
            );
        }
    }
    lines
}
fn actions(lines: &[ForecastLine]) -> Vec<ForecastAction> {
    lines.iter().map(|l| l.action).collect()
}
fn set_deadline(r: &mut Runtime, id: DealId, due: i64) {
    r.pipeline
        .wallet
        .ledger
        .set_deadline(id, due, None, 100)
        .unwrap();
}
/// A seller deal agreed at 100 with the payment executor configured.
fn seller_agreed(r: &mut Runtime, vault: &MemoryVault, delivery: Delivery, priced: bool) -> Deal {
    credentials(vault);
    let (deal, peer) = if priced {
        setup_delivery(r, Side::Seller, delivery)
    } else {
        setup_unpriced(r, Side::Seller, delivery)
    };
    agree(r, &deal, &peer);
    assert_eq!(state(r, deal.id), DealState::Agreed);
    deal
}

#[tokio::test]
async fn a_buyer_haggle_negotiating_lapses_at_its_deadline() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Buyer);
    for event in [DealEvent::ListingVerified, DealEvent::OfferVerified] {
        r.pipeline
            .wallet
            .ledger
            .apply_event(deal.id, event, 100)
            .unwrap();
    }
    assert_eq!(state(&r, deal.id), DealState::Negotiating);
    set_deadline(&mut r, deal.id, T0 + 3600);
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(actions(&lines), [ForecastAction::Lapse]);
    assert!(http.0.lock().unwrap().paths.is_empty());
    // A deal with no money operation still proves its mandate, messages and audit rows.
    let proof = assert_proof_verifies(&r, deal.id);
    assert!(proof.operations.is_empty() && proof.paypal_calls.is_empty());
}

#[tokio::test]
async fn a_lapse_chosen_deal_only_lapses_though_its_order_could_be_created() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    r.pipeline
        .wallet
        .ledger
        .set_preference(&format!("lapse.{}", deal.id), &true)
        .unwrap();
    set_deadline(&mut r, deal.id, T0 + 3600);
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(actions(&lines), [ForecastAction::Lapse]);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_deal_under_a_revoked_mandate_only_lapses() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, 100)
        .unwrap();
    set_deadline(&mut r, deal.id, T0 + 3600);
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(actions(&lines), [ForecastAction::Lapse]);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_seller_agreed_deal_with_a_fresh_market_creates_its_order_then_expires() {
    let (mut r, vault, _, clock, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(
        actions(&lines),
        [ForecastAction::CreateOrder, ForecastAction::Expire]
    );
    assert_eq!(lines[1].at, Some(T0 + 6 * 3600));
    assert_eq!(state(&r, deal.id), DealState::Expired);
    // The order was countersigned on the owner's clause 6 rule; the bundle proves it.
    let proof = assert_proof_verifies(&r, deal.id);
    assert!(matches!(
        proof.closed_mandates[..],
        [table_proto::ProofClosed {
            mandate: ClosedMandate {
                decided_by: DecidedBy::Policy { clause: 6 },
                ..
            },
            ..
        }]
    ));
}

#[tokio::test]
async fn a_seller_agreed_deal_without_a_market_reference_is_left_alone() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, false);
    // Slice 1 forecast a create here; the shield asks without a market and the scheduler
    // swallows the refusal. Only the deadline, far past the horizon, remains.
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert!(lines.is_empty(), "{lines:?}");
    assert_eq!(state(&r, deal.id), DealState::Agreed);
    assert!(
        !http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.contains("/checkout/orders"))
    );
}

#[tokio::test]
async fn a_seller_agreed_deal_whose_market_is_stale_by_the_next_tick_is_left_alone() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    set_deadline(&mut r, deal.id, MARKET_STALE_AT + 3600);
    let lines = walk(&mut r, &clock, deal.id, MARKET_STALE_AT).await;
    assert_eq!(actions(&lines), [ForecastAction::Lapse]);
    assert!(
        !http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.contains("/checkout/orders"))
    );
}

/// Creates the order at 100 on the mandate rule, then lets the offline PayPal approve it.
async fn ordered(r: &mut Runtime, vault: &MemoryVault, delivery: Delivery) -> Deal {
    let deal = seller_agreed(r, vault, delivery, true);
    r.tick().await.unwrap();
    assert_eq!(state(r, deal.id), DealState::AwaitingApproval);
    deal
}

#[tokio::test]
async fn a_seller_approved_digital_deal_authorizes_and_captures_on_the_seller_mandate() {
    let (mut r, vault, _, clock, _) = runtime(true);
    let deal = ordered(&mut r, &vault, Delivery::DigitalNow).await;
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, DealEvent::OrderApproved, 100)
        .unwrap();
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(
        actions(&lines),
        [ForecastAction::Authorize, ForecastAction::Capture]
    );
    assert_eq!(state(&r, deal.id), DealState::Receipted);
    // Revoking the mandate after the deal closed leaves its proof checkable.
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, T0 + 7 * 3600)
        .unwrap();
    assert_proof_verifies(&r, deal.id);
}

#[tokio::test]
async fn a_seller_authorized_shipped_deal_auto_voids_at_its_72_hour_deadline() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = ordered(&mut r, &vault, Delivery::ShipThenCapture { days: 1 }).await;
    // The poll sees the buyer's approval and the seller mandate authorizes; nothing captures.
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Authorized);
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(actions(&lines), [ForecastAction::AutoVoid]);
    assert_eq!(lines[0].at, Some(100 + 72 * 3600));
    assert_eq!(state(&r, deal.id), DealState::AutoVoided);
    let paths = &http.0.lock().unwrap().paths;
    assert!(!paths.iter().any(|p| p.ends_with("/capture")));
    assert_eq!(paths.iter().filter(|p| p.ends_with("/void")).count(), 1);
    let proof = assert_proof_verifies(&r, deal.id);
    assert!(proof.operations.iter().any(|o| o.operation == "void"
        && matches!(o.decided_by, DecidedBy::SafeDefault { .. })));
}

#[tokio::test]
async fn a_purchase_without_a_band_lapses_after_its_day() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (_, peer) = setup(&mut r, Side::Buyer);
    let mut list = clauses(Side::Buyer, DealKind::Purchase);
    list.retain(|c| !matches!(c, Clause::Band { .. }));
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: list,
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
    let lines = walk(&mut r, &clock, deal.id, T0).await;
    assert_eq!(actions(&lines), [ForecastAction::Lapse]);
    assert_eq!(lines[0].at, Some(100 + 24 * 3600));
    assert_eq!(state(&r, deal.id), DealState::Withdrawn);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

/// The offline PayPal reports the order approved at every poll, so the buyer's approval lands
/// at whatever tick the clock is set to: just inside the forecast's `before`, and at it. The
/// market reference goes stale at `MARKET_STALE_AT`, long before then: a stale reference that
/// holds nothing only asks, and an ASK does not stop the seller receiving money (H5), so the
/// window runs to the order's expiry.
#[tokio::test]
async fn a_buyer_approval_counts_until_the_order_expires_though_the_market_went_stale() {
    let expires = 100 + 6 * 3600;
    for (approved_at, end) in [
        (MARKET_STALE_AT, DealState::Receipted),
        (expires - 1, DealState::Receipted),
        (expires, DealState::Expired),
    ] {
        let (mut r, vault, http, clock, _) = runtime(true);
        let deal = ordered(&mut r, &vault, Delivery::DigitalNow).await;
        set(&clock, T0);
        let lines = lines_for(&mut r, deal.id);
        assert_eq!(
            actions(&lines),
            [
                ForecastAction::Authorize,
                ForecastAction::Capture,
                ForecastAction::Expire
            ]
        );
        for line in &lines[..2] {
            assert_eq!(line.trigger, ForecastTrigger::BuyerApproves);
            assert_eq!(line.before, Some(expires));
        }
        set(&clock, approved_at);
        r.tick().await.unwrap();
        let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
        assert_eq!(after.state, end, "approved at {approved_at}");
        let authorized = http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.ends_with("/authorize"));
        if end == DealState::Receipted {
            assert!(authorized);
            assert!(matches!(
                after.decided_by,
                Some(DecidedBy::SellerMandate { .. })
            ));
        } else {
            // The deadline wins: the order expires and silence moves no money.
            assert!(!authorized);
        }
    }
}

/// (a) No market reference: the shield asks, which no longer stops the seller receiving money
/// on the buyer's approval (H5). The forecast says money comes in, and a real tick agrees.
#[tokio::test]
async fn an_unpriced_seller_order_forecasts_money_in_and_a_real_tick_agrees() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = super::h5_tests::owner_ordered(&mut r, &vault, &http).await;
    let expires = 100 + 6 * 3600;
    set(&clock, T0);
    let lines = lines_for(&mut r, deal.id);
    assert_eq!(
        actions(&lines),
        [
            ForecastAction::Authorize,
            ForecastAction::Capture,
            ForecastAction::Expire
        ]
    );
    for line in &lines[..2] {
        assert_eq!(line.trigger, ForecastTrigger::BuyerApproves);
        assert_eq!(line.authority, ForecastAuthority::SellerMandate);
        assert_eq!(line.before, Some(expires));
    }
    // The buyer's approval reaches the scheduler just before the forecast's `before`.
    set(&clock, expires - 1);
    r.tick().await.unwrap();
    let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(after.state, lines[1].end_state);
    assert_eq!(after.state, DealState::Receipted);
    assert!(same_authority(
        lines[1].authority,
        after.decided_by.as_ref().unwrap()
    ));
}

/// (b) A price HOLD whose reference ages past 900 s stays a HOLD: the forecast says no money
/// comes in, read while the reference is fresh and after it went stale, and a real tick agrees.
#[tokio::test]
async fn a_price_held_seller_order_forecasts_no_money_in_after_its_market_ages() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = super::h5_tests::owner_ordered(&mut r, &vault, &http).await;
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
    let moves_money = |lines: &[ForecastLine]| {
        lines.iter().any(|l| {
            matches!(
                l.action,
                ForecastAction::Authorize | ForecastAction::Capture
            )
        })
    };
    for at in [T0, MARKET_STALE_AT, MARKET_STALE_AT + 3600] {
        set(&clock, at);
        let lines = lines_for(&mut r, deal.id);
        assert!(!moves_money(&lines), "at {at}: {lines:?}");
        assert_eq!(actions(&lines), [ForecastAction::Expire], "at {at}");
    }
    // The buyer approves after the reference went stale: the tick refuses the authorize, records
    // the refusal once and reports no fault (shield slice 2).
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Approved);
    assert_eq!(
        super::h5_tests::shield_refusals(&r, deal.id, "authorize"),
        1
    );
    let paths = http.0.lock().unwrap().paths.clone();
    assert!(!paths.iter().any(|p| p.ends_with("/authorize")));
    assert!(!paths.iter().any(|p| p.ends_with("/capture")));
}

#[tokio::test]
async fn a_failed_forecast_read_hides_the_forecast_but_keeps_attention() {
    let (mut r, vault, _, _, _) = runtime(true);
    let deal = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    assert!(r.attention().unwrap().forecast.is_some());
    r.fail_forecast = true;
    let snapshot = r.attention().unwrap();
    assert!(snapshot.forecast.is_none());
    assert!(snapshot.items.iter().all(|i| i.deal_id == deal.id));
}

/// decisions 28 (b): a buyer's deal only the seller says is paid forecasts that it ends UNCONFIRMED
/// at the receipt time plus 72 hours, and the scheduler does exactly that, with no PayPal call.
#[tokio::test]
async fn a_seller_attested_buyer_deal_forecasts_and_meets_its_unconfirmed_end() {
    let (mut r, _, http, clock, _) = runtime(true);
    let deal = receipted_on_the_sellers_word(&mut r);
    set(&clock, T0);
    let lines = lines_for(&mut r, deal.id);
    assert_eq!(lines.len(), 1, "{lines:?}");
    assert_eq!(lines[0].action, ForecastAction::Unconfirm);
    assert_eq!(lines[0].at, Some(100 + CORROBORATION_SECS));
    assert_eq!(lines[0].authority, ForecastAuthority::SafeDefault);
    assert_eq!(lines[0].end_state, DealState::Unconfirmed);
    // Before the time it stands; at the time the real scheduler ends it there.
    set(&clock, 100 + CORROBORATION_SECS - 1);
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Receipted);
    set(&clock, 100 + CORROBORATION_SECS);
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Unconfirmed);
    assert!(lines_for(&mut r, deal.id).is_empty());
    assert!(http.0.lock().unwrap().paths.is_empty());
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// The sandbox client behind a wire that loses the first capture answer before PayPal commits it.
struct LosesACapture {
    inner: table_paypal::Client,
    lose: std::sync::atomic::AtomicBool,
}
#[async_trait]
impl table_paypal::PayPalApi for LosesACapture {
    async fn create_order(
        &self,
        order: &table_paypal::CreateOrder,
        id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.create_order(order, id).await
    }
    async fn get_order(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.get_order(id).await
    }
    async fn authorize(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.authorize(id, request).await
    }
    async fn capture(
        &self,
        id: &table_paypal::ResourceId,
        amount: Money,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        if self.lose.swap(false, Ordering::SeqCst) {
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
        self.inner.capture(id, amount, request).await
    }
    async fn void(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<()>, table_paypal::Error> {
        self.inner.void(id, request).await
    }
    async fn get_authorization(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        self.inner.get_authorization(id).await
    }
}

/// A deal whose money step is open (a capture whose answer was lost) is left out of the
/// forecast: no step runs and no default is promised until PayPal's record settles it. Another
/// deal still has its lines.
#[tokio::test]
async fn a_deal_with_an_open_operation_is_left_out_of_the_forecast() {
    let (_, vault, http, clock, hello) = runtime(true);
    let api = Arc::new(LosesACapture {
        inner: table_paypal::Client::sandbox(
            http.clone(),
            Arc::new(VaultCredentials(vault.clone())),
            clock.clone(),
            Arc::new(NoDelay),
        ),
        lose: std::sync::atomic::AtomicBool::new(true),
    });
    let mut r = Runtime::new(
        Ledger::in_memory().unwrap(),
        vault.clone(),
        hello,
        api,
        clock.clone(),
    )
    .unwrap();
    let lost = ordered(&mut r, &vault, Delivery::DigitalNow).await;
    r.pipeline
        .wallet
        .ledger
        .apply_event(lost.id, DealEvent::OrderApproved, 100)
        .unwrap();
    set(&clock, T0);
    assert!(r.tick().await.is_err());
    assert_eq!(state(&r, lost.id), DealState::Authorized);
    assert!(r.pipeline.has_open_operation(lost.id).unwrap());
    // Another deal, agreed with a fresh market, keeps its place in the forecast.
    let other = seller_agreed(&mut r, &vault, Delivery::DigitalNow, true);
    let lines = r.forecast(T0 + 1).unwrap();
    assert!(lines.iter().all(|l| l.deal_id != lost.id), "{lines:?}");
    assert!(lines.iter().any(|l| l.deal_id == other.id), "{lines:?}");
}
