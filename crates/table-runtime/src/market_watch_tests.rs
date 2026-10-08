//! Market watch (T15): the scheduler keeps a watched item's market price fresh under the owner's
//! signed rule, within its daily allowance, outside the actor, and never calls PayPal for it.
use super::*;
use crate::market_watch::{MARKET_WATCH_RETRY_SECS, WatchJob};
use std::sync::atomic::AtomicBool;
use table_attention::ForecastAction;

/// A market service double: answers with one comparable at `median`, retrieved now. With the
/// gate closed, an answer waits until the test opens it.
#[derive(Debug)]
struct WatchMarket {
    calls: AtomicUsize,
    median: AtomicI64,
    fail: AtomicBool,
    clock: Arc<TestClock>,
    gate: tokio::sync::Semaphore,
}
impl WatchMarket {
    fn new(clock: Arc<TestClock>, median: i64, open: bool) -> Arc<Self> {
        Arc::new(Self {
            calls: AtomicUsize::new(0),
            median: AtomicI64::new(median),
            fail: AtomicBool::new(false),
            clock,
            gate: tokio::sync::Semaphore::new(if open { 1000 } else { 0 }),
        })
    }
}
#[async_trait]
impl table_market::MarketApi for WatchMarket {
    async fn comparables(
        &self,
        product: &str,
        currency: Currency,
    ) -> Result<MarketRef, table_market::Error> {
        assert_eq!(
            product, "p-monitor",
            "only the rule's product is ever asked for"
        );
        self.calls.fetch_add(1, Ordering::SeqCst);
        let _open = self
            .gate
            .acquire()
            .await
            .map_err(|_| table_market::Error::Unavailable)?;
        if self.fail.load(Ordering::SeqCst) {
            return Err(table_market::Error::Unavailable);
        }
        Ok(MarketRef::from_comparables(
            vec![Money::new(self.median.load(Ordering::SeqCst), currency).unwrap()],
            self.clock.now(),
            H256::digest(b"comparables"),
        )
        .unwrap())
    }
    async fn start_tracking(&self, _: &str) -> Result<(), table_market::Error> {
        unreachable!("a price check never starts tracking")
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, table_market::Error> {
        unreachable!("a price check never reads history")
    }
}

fn watch_clause(max: u16) -> Clause {
    Clause::MarketWatch {
        items: vec![WatchedItem {
            item_ref: ItemRef::new("monitor").unwrap(),
            product_id: "p-monitor".into(),
        }],
        max_refreshes_day: max,
    }
}
fn watched(side: Side, max: u16) -> Vec<Clause> {
    let mut c = clauses(side, DealKind::Haggle);
    c.push(watch_clause(max));
    c
}
fn market_key(vault: &dyn Vault) {
    vault.write("channel3", b"market-key").unwrap();
}
fn set(clock: &TestClock, at: i64) {
    clock.0.store(at, Ordering::SeqCst);
}
fn state(r: &Runtime, id: DealId) -> DealState {
    r.pipeline.wallet.ledger.get_deal(id).unwrap().state
}
fn orders(http: &OfflineHttp) -> usize {
    http.0
        .lock()
        .unwrap()
        .paths
        .iter()
        .filter(|p| p.contains("/checkout/orders"))
        .count()
}
fn checks(r: &Runtime) -> usize {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.iter().filter(|r| r.action == "market.checked").count()
}
fn forecast_actions(r: &mut Runtime, id: DealId) -> Vec<ForecastAction> {
    r.attention()
        .unwrap()
        .forecast
        .expect("the forecast is readable")
        .into_iter()
        .filter(|l| l.deal_id == id)
        .map(|l| l.action)
        .collect()
}
/// Runs a planned check's fetch here, as the spawned task would, and hands back its answer.
async fn land(r: &mut Runtime, market: &WatchMarket, job: WatchJob) {
    use table_market::MarketApi;
    let result = market
        .comparables(&job.product_id, job.binding.currency)
        .await;
    r.market_watched(job, result).unwrap();
}
/// A watched seller deal agreed at 100, PayPal configured, no market reference.
fn watched_seller(r: &mut Runtime, vault: &MemoryVault, max: u16) -> Deal {
    credentials(vault);
    market_key(vault);
    let (deal, peer) = setup_with(
        r,
        Side::Seller,
        Delivery::DigitalNow,
        watched(Side::Seller, max),
    );
    agree(r, &deal, &peer);
    assert_eq!(state(r, deal.id), DealState::Agreed);
    deal
}
/// Another deal on the same mandate and counterparty.
fn another(r: &mut Runtime, deal: &Deal, item: &str) -> Deal {
    r.create_deal(DealCreateArgs {
        kind: deal.kind,
        side: deal.side,
        counterparty: deal.counterparty.clone(),
        mandate_id: deal.mandate_id,
        mandate_version: deal.mandate_version,
        category: Category::Parts,
        terms: Terms {
            item_ref: ItemRef::new(item).unwrap(),
            ..deal.terms.clone()
        },
    })
    .unwrap()
}

#[tokio::test]
async fn a_watched_seller_deal_no_longer_stalls_its_policy_countersign_runs_on_a_fresh_price() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = watched_seller(&mut r, &vault, 12);
    let market = WatchMarket::new(clock.clone(), 1200, true);
    r.attach_market(market.clone());
    set(&clock, 200);
    // Before: no market reference, so the shield asks and the policy create stalls.
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Agreed);
    assert_eq!(orders(&http), 0);
    let mut jobs = r.plan_market_watch(200).unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(checks(&r), 1, "the check is recorded before the fetch");
    // One check at a time per deal.
    assert!(r.plan_market_watch(200).unwrap().is_empty());
    // While the check is in flight the forecast promises nothing it cannot be sure of.
    assert!(!forecast_actions(&mut r, deal.id).contains(&ForecastAction::CreateOrder));
    land(&mut r, &market, jobs.pop().unwrap()).await;
    let stored = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(stored.market.as_ref().unwrap().median.minor(), 1200);
    assert_eq!(stored.market.as_ref().unwrap().retrieved_at, 200);
    // The refresh itself touched no PayPal: no request and no recorded call.
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    // A landed, fresh price is counted by the forecast, and the next tick runs the rule.
    assert_eq!(
        forecast_actions(&mut r, deal.id).first(),
        Some(&ForecastAction::CreateOrder)
    );
    r.tick().await.unwrap();
    let created = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(created.state, DealState::AwaitingApproval);
    assert_eq!(created.decided_by, Some(DecidedBy::Policy { clause: 6 }));
    assert_eq!(orders(&http), 1);
    // Past Agreed the seller deal is no longer watched: no further check is planned.
    set(&clock, 200 + MARKET_FRESH_SECS);
    assert!(
        r.plan_market_watch(200 + MARKET_FRESH_SECS)
            .unwrap()
            .is_empty()
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_watched_price_far_over_the_market_holds_and_nothing_is_created() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = watched_seller(&mut r, &vault, 12);
    // $12.00 against a typical $8.00: 50% over the market.
    let market = WatchMarket::new(clock.clone(), 800, true);
    r.attach_market(market.clone());
    set(&clock, 200);
    let job = r.plan_market_watch(200).unwrap().pop().unwrap();
    land(&mut r, &market, job).await;
    assert_eq!(
        r.pipeline.shield_verdict(deal.id, 200).unwrap(),
        ShieldVerdict::Hold
    );
    r.tick().await.unwrap();
    assert_eq!(state(&r, deal.id), DealState::Agreed);
    assert_eq!(orders(&http), 0);
    assert_eq!(
        r.pipeline.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        0
    );
    assert!(!forecast_actions(&mut r, deal.id).contains(&ForecastAction::CreateOrder));
}

#[tokio::test]
async fn only_open_watched_deals_under_rules_in_force_are_checked() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let market = WatchMarket::new(clock.clone(), 1200, true);
    r.attach_market(market.clone());
    // Not watched: a mandate with no market-watch rule.
    credentials(&*vault);
    let (plain, _) = setup_unpriced(&mut r, Side::Seller, Delivery::DigitalNow);
    // Watched, but no market key stored yet: nothing is planned.
    let (buyer, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    set(&clock, 200);
    assert!(r.plan_market_watch(200).unwrap().is_empty());
    market_key(&*vault);
    let jobs = r.plan_market_watch(200).unwrap();
    assert_eq!(
        jobs.iter().map(|j| j.binding.deal_id).collect::<Vec<_>>(),
        [buyer.id]
    );
    for job in jobs {
        land(&mut r, &market, job).await;
    }
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(plain.id)
            .unwrap()
            .market
            .is_none()
    );
    // Fresh now: nothing is due until the refresh lead before the freshness bound.
    let due = 200 + MARKET_FRESH_SECS - MARKET_REFRESH_LEAD_SECS;
    assert!(r.plan_market_watch(due - 1).unwrap().is_empty());
    set(&clock, due);
    assert_eq!(r.plan_market_watch(due).unwrap().len(), 1);
    r.market_watch_busy.clear();
    // Paused agents: nothing automatic runs, price checks included.
    r.paused = true;
    let later = due + MARKET_FRESH_SECS;
    set(&clock, later);
    assert!(r.plan_market_watch(later).unwrap().is_empty());
    r.paused = false;
    // "Let it lapse" stops the checks too.
    r.pipeline
        .wallet
        .ledger
        .set_preference(&format!("lapse.{}", buyer.id), &true)
        .unwrap();
    assert!(r.plan_market_watch(later).unwrap().is_empty());
    r.pipeline
        .wallet
        .ledger
        .set_preference(&format!("lapse.{}", buyer.id), &false)
        .unwrap();
    // A closed deal is never checked.
    r.pipeline
        .wallet
        .ledger
        .apply_event(buyer.id, DealEvent::Withdraw, later)
        .unwrap();
    assert!(state(&r, buyer.id).terminal());
    assert!(r.plan_market_watch(later).unwrap().is_empty());
    // A revoked mandate's rule watches nothing.
    let (revoked, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(revoked.mandate_id, later)
        .unwrap();
    assert!(r.plan_market_watch(later).unwrap().is_empty());
    // A deal on another item of a watched mandate is not checked.
    let (watched_buyer, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    let mut band = clauses(Side::Buyer, DealKind::Haggle);
    if let Clause::Band { item_refs, .. } = &mut band[3] {
        item_refs.push(ItemRef::new("dock").unwrap());
    }
    band.push(watch_clause(12));
    let (other_item, _) = setup_with(&mut r, Side::Buyer, Delivery::DigitalNow, band);
    let _ = another(&mut r, &other_item, "dock");
    let planned: Vec<_> = r
        .plan_market_watch(later)
        .unwrap()
        .into_iter()
        .map(|j| (j.binding.deal_id, j.item_ref.as_str().to_owned()))
        .collect();
    assert_eq!(
        planned.len(),
        2,
        "the watched buyer and the monitor deal only: {planned:?}"
    );
    assert!(planned.contains(&(watched_buyer.id, "monitor".into())));
    assert!(planned.contains(&(other_item.id, "monitor".into())));
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn the_daily_allowance_is_never_exceeded_and_owner_facts_say_when_it_is_used_up() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(&*vault);
    market_key(&*vault);
    let (first, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 2),
    );
    let second = another(&mut r, &first, "monitor");
    let third = another(&mut r, &first, "monitor");
    let market = WatchMarket::new(clock.clone(), 1200, true);
    r.attach_market(market.clone());
    let day = 86_400 * 3;
    set(&clock, day + 10);
    let facts = r.owner_facts().unwrap().market_watch;
    assert_eq!(facts.len(), 1);
    assert_eq!(
        (facts[0].used_today, facts[0].max_per_day, facts[0].used_up),
        (0, 2, false)
    );
    assert_eq!(facts[0].items[0].product_id, "p-monitor");
    // Three deals are due; the rule allows two checks a day.
    let jobs = r.plan_market_watch(day + 10).unwrap();
    assert_eq!(jobs.len(), 2);
    // A failed fetch still counts: the check was made.
    market.fail.store(true, Ordering::SeqCst);
    for job in jobs {
        land(&mut r, &market, job).await;
    }
    market.fail.store(false, Ordering::SeqCst);
    for at in [day + 10, day + 10 + MARKET_WATCH_RETRY_SECS, day + 86_399] {
        set(&clock, at);
        assert!(r.plan_market_watch(at).unwrap().is_empty(), "at {at}");
    }
    assert_eq!(checks(&r), 2);
    let facts = r.owner_facts().unwrap().market_watch;
    assert_eq!((facts[0].used_today, facts[0].used_up), (2, true));
    // The next UTC day starts a new allowance.
    set(&clock, day + 86_400);
    let jobs = r.plan_market_watch(day + 86_400).unwrap();
    assert_eq!(jobs.len(), 2);
    let ids: Vec<_> = [first.id, second.id, third.id].into();
    assert!(jobs.iter().all(|j| ids.contains(&j.binding.deal_id)));
    let facts = r.owner_facts().unwrap().market_watch;
    assert_eq!((facts[0].used_today, facts[0].used_up), (2, true));
    assert_eq!(checks(&r), 4);
    assert_eq!(market.calls.load(Ordering::SeqCst), 2);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn an_answer_that_no_longer_fits_the_deal_or_its_rules_is_dropped() {
    let (mut r, vault, _, clock, _) = runtime(true);
    credentials(&*vault);
    market_key(&*vault);
    let market = WatchMarket::new(clock.clone(), 1200, true);
    r.attach_market(market.clone());
    set(&clock, 200);
    // The rule is withdrawn while the check is in flight.
    let (revoked, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    let job = r.plan_market_watch(200).unwrap().pop().unwrap();
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(revoked.mandate_id, 200)
        .unwrap();
    land(&mut r, &market, job).await;
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(revoked.id)
            .unwrap()
            .market
            .is_none()
    );
    // The deal closes while the check is in flight.
    let (closed, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    let job = r.plan_market_watch(200).unwrap().pop().unwrap();
    assert_eq!(job.binding.deal_id, closed.id);
    r.pipeline
        .wallet
        .ledger
        .apply_event(closed.id, DealEvent::Withdraw, 200)
        .unwrap();
    land(&mut r, &market, job).await;
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(closed.id)
            .unwrap()
            .market
            .is_none()
    );
    // The rule is re-signed with another product for the item while the check is in flight.
    let (rebound, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 12),
    );
    let mut job = r.plan_market_watch(200).unwrap().pop().unwrap();
    assert_eq!(job.binding.deal_id, rebound.id);
    job.product_id = "p-other".into();
    r.market_watched(
        job,
        Ok(MarketRef::from_comparables(
            vec![Money::new(1200, Currency::USD).unwrap()],
            200,
            H256::ZERO,
        )
        .unwrap()),
    )
    .unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(rebound.id)
            .unwrap()
            .market
            .is_none()
    );
    assert_eq!(market.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn the_actor_checks_prices_outside_its_loop_and_the_forecast_waits_for_the_answer() {
    let (mut r, vault, http, clock, _) = runtime(true);
    let deal = watched_seller(&mut r, &vault, 12);
    let market = WatchMarket::new(clock.clone(), 1200, false);
    r.attach_market(market.clone());
    set(&clock, 200);
    let (actor, _events) = spawn(r);
    let id = deal.id;
    let wait = |what: &'static str| {
        let actor = actor.clone();
        let market = market.clone();
        async move {
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let deal: Deal = actor
                        .execute(caller("main", None), Action::Deal(id))
                        .await
                        .unwrap();
                    let done = match what {
                        "asked" => market.calls.load(Ordering::SeqCst) == 1,
                        "stored" => deal.market.is_some(),
                        _ => deal.state == DealState::AwaitingApproval,
                    };
                    if done {
                        return deal;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await
            .expect(what)
        }
    };
    // The fetch waits on the market service; the actor keeps answering meanwhile.
    let pending = wait("asked").await;
    assert!(pending.market.is_none());
    assert_eq!(pending.state, DealState::Agreed);
    let snapshot: table_attention::AttentionSnapshot = actor
        .execute(caller("main", None), Action::Attention)
        .await
        .unwrap();
    assert!(
        !snapshot
            .forecast
            .unwrap()
            .iter()
            .any(|l| l.deal_id == deal.id && l.action == ForecastAction::CreateOrder),
        "a check in flight is not counted as a fresh price"
    );
    assert_eq!(orders(&http), 0);
    market.gate.add_permits(1);
    let stored = wait("stored").await;
    assert_eq!(stored.market.unwrap().median.minor(), 1200);
    let created = wait("created").await;
    assert_eq!(created.decided_by, Some(DecidedBy::Policy { clause: 6 }));
    assert_eq!(market.calls.load(Ordering::SeqCst), 1);
    let facts: OwnerFacts = actor
        .execute(caller("main", None), Action::OwnerFacts)
        .await
        .unwrap();
    assert_eq!(facts.market_watch[0].used_today, 1);
}

#[tokio::test]
async fn price_check_facts_are_owner_facts_and_the_rule_is_signed_only_when_valid() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(&*vault);
    let mut invalid = clauses(Side::Buyer, DealKind::Haggle);
    invalid.push(Clause::MarketWatch {
        items: vec![WatchedItem {
            item_ref: ItemRef::new("monitor").unwrap(),
            product_id: "not a product".into(),
        }],
        max_refreshes_day: 12,
    });
    let refused = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: invalid,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap_err();
    assert!(matches!(refused.code, ErrorCode::Refused), "{refused:?}");
    assert!(r.owner_facts().unwrap().market_watch.is_empty());
    let (deal, _) = setup_with(
        &mut r,
        Side::Buyer,
        Delivery::DigitalNow,
        watched(Side::Buyer, 7),
    );
    let facts = r.owner_facts().unwrap().market_watch;
    assert_eq!(facts.len(), 1);
    assert_eq!(facts[0].mandate_id, deal.mandate_id);
    assert_eq!(facts[0].agent, AgentSlot::Negotiator);
    assert_eq!((facts[0].used_today, facts[0].max_per_day), (0, 7));
    // A draft adding the rule changes no what-if answer: it grants nothing.
    let mut draft = clauses(Side::Buyer, DealKind::Haggle);
    draft.push(watch_clause(3));
    let sim = r
        .execute(
            caller("approval", None),
            Action::Simulate(MandateSimulateArgs {
                draft: MandateSignArgs {
                    id: Some(deal.mandate_id),
                    agent: AgentSlot::Negotiator,
                    clauses: draft,
                    not_before: 0,
                    expires: 1_000_000,
                },
                from: None,
                to: None,
            }),
        )
        .await
        .unwrap();
    let sim: MandateSimulation = serde_json::from_value(sim).unwrap();
    assert!(!sim.lines.is_empty());
    assert!(
        sim.lines.iter().all(|l| l.before == l.after),
        "{:?}",
        sim.lines
    );
    // Only the main and approval windows read owner facts.
    let (actor, _events) = spawn(r);
    assert!(
        actor
            .execute::<OwnerFacts>(caller("tumbler", None), Action::OwnerFacts)
            .await
            .is_err()
    );
    for label in ["main", "approval"] {
        let facts: OwnerFacts = actor
            .execute(caller(label, None), Action::OwnerFacts)
            .await
            .unwrap();
        assert_eq!(facts.market_watch[0].items[0].item_ref.as_str(), "monitor");
    }
}
