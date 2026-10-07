//! T10 read-back resolver against a PayPal double that keeps PayPal's own state and can "cut the
//! wire": drop an answer after PayPal did the step, lose a request before PayPal saw it, garble a
//! 2xx body, or refuse reads. Every test counts PayPal's writes (what PayPal did) separately from
//! the POSTs that reached it, and checks that one operation only ever went out under one id.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use table_app::*;
use table_core::*;
use table_ledger::*;
use table_paypal::*;
use table_proto::*;

/// What PayPal holds, and the chaos to apply. Each chaos entry is used once.
#[derive(Debug, Default)]
struct World {
    expected: Option<CreateOrder>,
    orders: u32,
    approved: bool,
    authorization: Option<&'static str>,
    captured: bool,
    /// PayPal's idempotency store: the answer it gave each request id.
    replies: HashMap<String, Value>,
    /// What PayPal did: (operation, request id).
    writes: Vec<(&'static str, String)>,
    /// Every POST that was sent: (operation, request id).
    posts: Vec<(&'static str, String)>,
    reads: u32,
    /// PayPal does the step, and its answer is lost.
    cut: Vec<&'static str>,
    /// The request is lost before PayPal sees it.
    lose: Vec<&'static str>,
    /// PayPal does the step, and its 2xx answer does not decode.
    garble: Vec<&'static str>,
    reads_fail: bool,
}
#[derive(Debug, Default)]
struct Double(Mutex<World>);
fn take(list: &mut Vec<&'static str>, op: &'static str) -> bool {
    list.iter()
        .position(|o| *o == op)
        .map(|i| list.remove(i))
        .is_some()
}
fn observation(
    method: &'static str,
    path: &str,
    id: &str,
    status: u16,
    body: Value,
) -> Observation {
    Observation {
        method,
        path: path.into(),
        request_id: id.into(),
        status,
        body,
        binding: None,
    }
}
impl World {
    fn amount(&self) -> Value {
        amount_wire(self.expected.as_ref().unwrap().amount)
    }
    fn order(&self) -> Value {
        let mut body = self.expected.as_ref().unwrap().body().unwrap();
        body["id"] = json!("ORDER1");
        body["status"] = json!(if self.authorization.is_some() {
            "COMPLETED"
        } else if self.approved {
            "APPROVED"
        } else {
            "CREATED"
        });
        body["links"] = json!([{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"}]);
        let mut payments = json!({"authorizations":[],"captures":[]});
        if let Some(status) = self.authorization {
            payments["authorizations"] =
                json!([{"id":"AUTH1","status":status,"amount":self.amount()}]);
        }
        if self.captured {
            payments["captures"] =
                json!([{"id":"CAPTURE1","status":"COMPLETED","amount":self.amount()}]);
        }
        body["purchase_units"][0]["payments"] = payments;
        body
    }
    fn writes(&self, op: &str) -> usize {
        self.writes.iter().filter(|(o, _)| *o == op).count()
    }
    fn posts(&self, op: &str) -> usize {
        self.posts.iter().filter(|(o, _)| *o == op).count()
    }
}
impl Double {
    fn world(&self) -> std::sync::MutexGuard<'_, World> {
        self.0.lock().unwrap()
    }
    fn post<T: serde::de::DeserializeOwned>(
        &self,
        op: &'static str,
        path: &str,
        id: &RequestId,
        perform: impl FnOnce(&mut World) -> Option<Value>,
    ) -> Result<ApiResponse<T>, table_paypal::Error> {
        let mut w = self.world();
        let rid = id.as_str().to_owned();
        w.posts.push((op, rid.clone()));
        let lost = || table_paypal::Error::Unknown {
            observations: vec![observation("POST", path, &rid, 0, Value::Null)],
        };
        if take(&mut w.lose, op) {
            return Err(lost());
        }
        let body = match w.replies.get(&rid) {
            Some(answer) => answer.clone(),
            None => {
                let Some(answer) = perform(&mut w) else {
                    return Err(table_paypal::Error::Api {
                        status: 422,
                        debug_id: None,
                        observations: vec![observation(
                            "POST",
                            path,
                            &rid,
                            422,
                            json!({"name":"UNPROCESSABLE_ENTITY"}),
                        )],
                    });
                };
                w.writes.push((op, rid.clone()));
                w.replies.insert(rid.clone(), answer.clone());
                answer
            }
        };
        if take(&mut w.cut, op) {
            return Err(lost());
        }
        if take(&mut w.garble, op) {
            return Err(table_paypal::Error::Unknown {
                observations: vec![observation("POST", path, &rid, 201, json!({"id":"ORDER1"}))],
            });
        }
        Ok(ApiResponse {
            value: serde_json::from_value(body.clone()).unwrap(),
            observations: vec![observation("POST", path, &rid, 201, body)],
        })
    }
}
#[async_trait]
impl PayPalApi for Double {
    async fn create_order(
        &self,
        o: &CreateOrder,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let o = o.clone();
        self.post("create", "/v2/checkout/orders", id, |w| {
            w.expected = Some(o);
            w.orders += 1;
            Some(w.order())
        })
    }
    async fn get_order(&self, _: &ResourceId) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let mut w = self.world();
        w.reads += 1;
        let path = "/v2/checkout/orders/ORDER1";
        if w.reads_fail {
            return Err(table_paypal::Error::Unknown {
                observations: vec![observation("GET", path, "", 0, Value::Null)],
            });
        }
        let body = w.order();
        Ok(ApiResponse {
            value: serde_json::from_value(body.clone()).unwrap(),
            observations: vec![observation("GET", path, "", 200, body)],
        })
    }
    async fn authorize(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        self.post(
            "authorize",
            "/v2/checkout/orders/ORDER1/authorize",
            id,
            |w| {
                if !w.approved || w.authorization.is_some() {
                    return None;
                }
                w.authorization = Some("CREATED");
                Some(w.order())
            },
        )
    }
    async fn capture(
        &self,
        _: &ResourceId,
        _: Money,
        id: &RequestId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        self.post(
            "capture",
            "/v2/payments/authorizations/AUTH1/capture",
            id,
            |w| {
                if w.authorization != Some("CREATED") {
                    return None;
                }
                w.authorization = Some("CAPTURED");
                w.captured = true;
                Some(json!({"id":"CAPTURE1","status":"COMPLETED","amount":w.amount()}))
            },
        )
    }
    async fn void(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<()>, table_paypal::Error> {
        // PayPal: "You cannot void an authorized payment that has been fully captured."
        self.post("void", "/v2/payments/authorizations/AUTH1/void", id, |w| {
            if w.authorization != Some("CREATED") {
                return None;
            }
            w.authorization = Some("VOIDED");
            Some(Value::Null)
        })
    }
    async fn get_authorization(
        &self,
        _: &ResourceId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        panic!("the resolver reads the order")
    }
}

/// A seller wallet with an agreed haggle, as in tests/pipeline.rs.
fn agreed() -> (Wallet, Deal, AgentSigner) {
    let (mut buyer, deal, buyer_owner, seller_key) = support::setup(Side::Buyer, DealKind::Haggle);
    let owner = support::signer();
    let mut payload = buyer
        .ledger
        .active_mandate(deal.mandate_id, 1, &buyer_owner.public_key())
        .unwrap()
        .payload;
    payload.agent_key = seller_key.public_key().to_bytes();
    payload.clauses[0] = Clause::Roles {
        roles: vec![Role::Sell],
    };
    let m = OpenMandate {
        owner_sig: owner.sign_payload(&payload).unwrap(),
        payload,
    };
    let mut ledger = Ledger::in_memory().unwrap();
    ledger.insert_mandate(&m, &owner.public_key(), 100).unwrap();
    let cp = Counterparty {
        key_id: table_proto::key_id(&buyer.agent_public_key()).unwrap(),
        owner_key: buyer_owner.public_key().to_bytes(),
        agent_key: buyer.agent_public_key().to_bytes(),
        display_name: ShortText::new("Buyer".into()).unwrap(),
        paired_via: PairedVia::Code,
        words_confirmed_at: Some(100),
        declared_payee: PayeeRef::new("buyer_merchant").unwrap(),
        first_seen: 100,
    };
    ledger.insert_counterparty(&cp).unwrap();
    let mut seller_deal = deal.clone();
    seller_deal.side = Side::Seller;
    seller_deal.counterparty = cp.key_id;
    ledger.create_deal(&seller_deal, 100).unwrap();
    ledger.set_deal_category(deal.id, Category::Parts).unwrap();
    let mut seller = Wallet::new(ledger, seller_key, owner.public_key());
    let listing = seller.list(deal.id, 100).unwrap();
    buyer
        .receive_haggle(deal.id, &listing, Category::Parts, 100)
        .unwrap();
    let offer = buyer
        .invoke(
            &AgentScope {
                deal_id: deal.id,
                role: AgentRole::Negotiator,
                category: Category::Parts,
            },
            AgentRequest::Offer(OfferInput {
                deal_id: deal.id,
                price: "12.00".into(),
                delivery: Delivery::DigitalNow,
            }),
            100,
        )
        .unwrap();
    seller
        .receive_haggle(
            deal.id,
            offer["jws"].as_str().unwrap(),
            Category::Parts,
            100,
        )
        .unwrap();
    let a = buyer.accept(deal.id, 1, Category::Parts, 100).unwrap();
    seller
        .receive_haggle(deal.id, &a, Category::Parts, 100)
        .unwrap();
    let b = seller.accept(deal.id, 1, Category::Parts, 100).unwrap();
    buyer
        .receive_haggle(deal.id, &b, Category::Parts, 100)
        .unwrap();
    assert_eq!(
        seller.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    (seller, deal, owner)
}

struct Case {
    p: Pipeline,
    world: Arc<Double>,
    id: DealId,
    owner: ed25519_dalek::VerifyingKey,
}
const P: Category = Category::Parts;
impl Case {
    fn new() -> Self {
        let (seller, deal, owner) = agreed();
        let world = Arc::new(Double::default());
        Self {
            p: Pipeline::new(seller, world.clone(), 100).unwrap(),
            world,
            id: deal.id,
            owner: owner.public_key(),
        }
    }
    fn deal(&self) -> Deal {
        self.p.wallet.ledger.get_deal(self.id).unwrap()
    }
    fn state(&self) -> DealState {
        self.deal().state
    }
    fn calls(&self) -> u64 {
        self.p.wallet.ledger.paypal_call_count(self.id).unwrap()
    }
    fn check(&self) -> Option<MoneyCheck> {
        self.p.wallet.ledger.money_check(self.id).unwrap()
    }
    fn audit(&self, action: &str) -> Vec<Value> {
        let (rows, _) = self.p.wallet.ledger.audit_page(None, u16::MAX).unwrap();
        rows.into_iter()
            .filter(|r| r.deal_id == Some(self.id) && r.action == action)
            .map(|r| r.detail)
            .collect()
    }
    /// Drive the deal to the point just before `op` runs, with no chaos.
    async fn before(&mut self, op: &str) {
        if op == "create" {
            return;
        }
        self.p
            .create(self.id, 1, P, Authority::Policy, 100)
            .await
            .unwrap();
        self.world.world().approved = true;
        assert!(self.p.poll_approval(self.id, 1, 100).await.unwrap());
        if op == "authorize" {
            return;
        }
        self.p
            .authorize(self.id, 1, P, Authority::SellerMandate, 100)
            .await
            .unwrap();
    }
    /// Run `op` as the scheduler would: create on the clause-6 policy, authorize and capture on
    /// the seller mandate, the void as the deadline's safe default. Returns the error it hit.
    async fn run(&mut self, op: &str) -> Result<(), table_app::Error> {
        match op {
            "create" => self
                .p
                .create(self.id, 1, P, Authority::Policy, 100)
                .await
                .map(drop),
            "authorize" => {
                self.p
                    .authorize(self.id, 1, P, Authority::SellerMandate, 100)
                    .await
            }
            "capture" => self
                .p
                .capture(self.id, 1, P, Authority::SellerMandate, 100)
                .await
                .map(drop),
            "void" => self.p.auto_void(self.id, 1, VOID_AT).await,
            _ => unreachable!(),
        }
    }
    /// One request id per operation, and it is the derived one.
    fn one_request_id_per_operation(&self) {
        let w = self.world.world();
        let mut ids: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
        for (op, rid) in &w.posts {
            ids.entry(op).or_default().insert(rid);
        }
        for (op, rids) in &ids {
            assert_eq!(rids.len(), 1, "{op} went out under {rids:?}");
            assert!(rids.contains(RequestId::for_operation(self.id, 1, op).unwrap().as_str()));
        }
        let mut ledger: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (method, path, rid) in self.p.wallet.ledger.paypal_call_requests(self.id).unwrap() {
            if method == "POST" {
                ledger.entry(path).or_default().insert(rid);
            }
        }
        for (path, rids) in ledger {
            assert_eq!(rids.len(), 1, "{path} recorded under {rids:?}");
        }
    }
}
/// The authorization's 72 h deadline: auto-void time.
const VOID_AT: Timestamp = 100 + 72 * 3600;
fn end_state(op: &str) -> DealState {
    match op {
        "create" => DealState::AwaitingApproval,
        "authorize" => DealState::Authorized,
        "capture" => DealState::Receipted,
        _ => DealState::AutoVoided,
    }
}
fn start_state(op: &str) -> DealState {
    match op {
        "create" => DealState::Settling,
        "authorize" => DealState::Approved,
        _ => DealState::Authorized,
    }
}
fn decided(op: &str, c: &Case) -> DecidedBy {
    match op {
        "create" => DecidedBy::Policy { clause: 6 },
        "void" => DecidedBy::SafeDefault { deadline: VOID_AT },
        _ => {
            let deal = c.deal();
            let m =
                c.p.wallet
                    .ledger
                    .active_mandate(deal.mandate_id, deal.mandate_version, &c.owner)
                    .unwrap();
            DecidedBy::SellerMandate {
                mandate_hash: m.payload.hash().unwrap(),
            }
        }
    }
}
const OPS: [&str; 4] = ["create", "authorize", "capture", "void"];
/// When the resolver runs: inside every deadline and request-id window, after the void's deadline.
fn later(op: &str) -> Timestamp {
    if op == "void" { VOID_AT + 30 } else { 130 }
}

#[tokio::test]
async fn lost_answer_after_paypal_did_it_confirms_with_one_paypal_write() {
    for op in OPS {
        let mut c = Case::new();
        c.before(op).await;
        c.world.world().cut.push(op);
        assert!(
            matches!(c.run(op).await, Err(table_app::Error::Unavailable)),
            "{op}"
        );
        assert_eq!(c.state(), start_state(op), "{op}: the deal stays reserved");
        let check = c.check().unwrap();
        assert_eq!(check.state, MoneyCheckState::Checking);
        assert_eq!(check.step, MoneyCheckStep::parse(op).unwrap());
        // No new step and no walking away while the outcome is unknown.
        assert!(c.p.has_open_operation(c.id).unwrap());
        assert!(matches!(
            c.p.wallet.withdraw(c.id, ReasonCode::Other, 120),
            Err(table_app::Error::Permission) | Err(table_app::Error::Domain(_))
        ));

        let r = c.p.resolve(c.id, None, later(op)).await.unwrap();
        // A create has no read-back; its same-id re-send returns the order PayPal already made.
        let expected = if op == "create" {
            Resolution::Resent { confirmed: true }
        } else {
            Resolution::Confirmed
        };
        assert_eq!(r, Some(expected), "{op}");
        assert_eq!(c.state(), end_state(op), "{op}");
        assert_eq!(c.deal().decided_by, Some(decided(op, &c)), "{op}");
        assert_eq!(c.world.world().writes(op), 1, "{op}: one PayPal write");
        let posts = if op == "create" { 2 } else { 1 };
        assert_eq!(c.world.world().posts(op), posts, "{op}");
        assert!(c.check().is_none());
        assert!(!c.p.has_open_operation(c.id).unwrap());
        assert_eq!(c.audit("money.resolved").len(), 1, "{op}");
        c.one_request_id_per_operation();
        c.p.wallet.ledger.verify_audit().unwrap();
    }
}

#[tokio::test]
async fn confirmed_steps_carry_their_facts_receipt_and_deadline() {
    // Capture: the receipt is signed and recorded as the lost answer would have done.
    let mut c = Case::new();
    c.before("capture").await;
    c.world.world().cut.push("capture");
    let _ = c.run("capture").await;
    let receipts =
        c.p.wallet
            .ledger
            .envelope_count(c.id, Direction::Outbound)
            .unwrap();
    c.p.resolve(c.id, None, 130).await.unwrap();
    assert_eq!(c.deal().paypal.capture.as_deref(), Some("CAPTURE1"));
    assert_eq!(
        c.p.wallet
            .ledger
            .envelope_count(c.id, Direction::Outbound)
            .unwrap(),
        receipts + 1
    );
    // Authorize: the 72 h window counts from the request, not from the late read.
    let mut c = Case::new();
    c.before("authorize").await;
    c.world.world().cut.push("authorize");
    let _ = c.run("authorize").await;
    c.p.resolve(c.id, None, 5000).await.unwrap();
    assert_eq!(c.deal().paypal.authorization.as_deref(), Some("AUTH1"));
    assert_eq!(
        c.p.wallet.ledger.deadline(c.id).unwrap(),
        Some((100 + 72 * 3600, Some(100)))
    );
    // Create: the payment request goes to the buyer once confirmed; the 6 h window counts from
    // the first send.
    let mut c = Case::new();
    c.world.world().cut.push("create");
    let _ = c.run("create").await;
    assert_eq!(
        c.p.wallet
            .ledger
            .envelope_count(c.id, Direction::Outbound)
            .unwrap(),
        2,
        "listing and accept only: no payment request without an order"
    );
    c.p.resolve(c.id, None, 130).await.unwrap();
    assert_eq!(
        c.p.wallet
            .ledger
            .envelope_count(c.id, Direction::Outbound)
            .unwrap(),
        3
    );
    assert_eq!(
        c.p.wallet.ledger.deadline(c.id).unwrap().unwrap().0,
        100 + 6 * 3600
    );
}

#[tokio::test]
async fn lost_before_paypal_saw_it_resends_with_the_identical_request_id() {
    for op in OPS {
        let mut c = Case::new();
        c.before(op).await;
        c.world.world().lose.push(op);
        assert!(c.run(op).await.is_err(), "{op}");
        assert_eq!(c.world.world().writes(op), 0);
        let r = c.p.resolve(c.id, None, later(op)).await.unwrap();
        assert_eq!(r, Some(Resolution::Resent { confirmed: true }), "{op}");
        assert_eq!(c.state(), end_state(op), "{op}");
        assert_eq!(c.deal().decided_by, Some(decided(op, &c)), "{op}");
        let w = c.world.world();
        assert_eq!(w.writes(op), 1, "{op}");
        assert_eq!(w.posts(op), 2, "{op}");
        assert_eq!(w.posts[w.posts.len() - 1].1, w.posts[w.posts.len() - 2].1);
        drop(w);
        assert_eq!(c.audit("money.resent").len(), 1, "{op}");
        assert_eq!(
            c.audit("money.authorized")
                .iter()
                .filter(|d| d["operation"] == op)
                .count(),
            1
        );
        c.one_request_id_per_operation();
    }
}

#[tokio::test]
async fn an_undecodable_2xx_is_read_back_and_confirmed() {
    for op in ["authorize", "capture"] {
        let mut c = Case::new();
        c.before(op).await;
        c.world.world().garble.push(op);
        assert!(c.run(op).await.is_err());
        assert_eq!(
            c.p.resolve(c.id, None, 130).await.unwrap(),
            Some(Resolution::Confirmed)
        );
        assert_eq!(c.state(), end_state(op));
        assert_eq!(c.world.world().posts(op), 1);
    }
}

#[tokio::test]
async fn unreadable_paypal_parks_and_the_deadline_never_collects() {
    // Authorize: unreadable, so the deal stays reserved past its deadline (a hold may exist and
    // could not be released), and nothing is sent. Once PayPal reads "not done", it expires.
    let mut c = Case::new();
    c.before("authorize").await;
    {
        let mut w = c.world.world();
        w.lose.push("authorize");
        w.reads_fail = true;
    }
    let _ = c.run("authorize").await;
    assert_eq!(
        c.p.resolve(c.id, None, 130).await.unwrap(),
        Some(Resolution::Parked(CheckReason::Unreadable))
    );
    assert_eq!(c.check().unwrap().state, MoneyCheckState::Parked);
    let due = c.p.wallet.ledger.deadline(c.id).unwrap().unwrap().0;
    for t in [due, due + 900, due + 1800] {
        c.p.tick(t).await.unwrap();
        assert_eq!(c.state(), DealState::Approved);
    }
    assert_eq!(c.world.world().posts("authorize"), 1);
    assert_eq!(
        c.audit("money.parked").len(),
        1,
        "one row per reason, not per retry"
    );
    c.world.world().reads_fail = false;
    c.p.tick(due + 3600).await.unwrap();
    assert_eq!(c.state(), DealState::Expired);
    assert_eq!(c.world.world().posts("authorize"), 1);
    assert_eq!(c.world.world().writes("authorize"), 0);
    assert_eq!(c.audit("money.resolved")[0]["outcome"], "not_done");

    // Capture: unreadable at the deadline means no void (it may have been collected) and no
    // capture. When PayPal shows nothing was collected, the hold is released, never collected.
    let mut c = Case::new();
    c.before("capture").await;
    {
        let mut w = c.world.world();
        w.lose.push("capture");
        w.reads_fail = true;
    }
    let _ = c.run("capture").await;
    for t in [VOID_AT, VOID_AT + 900] {
        c.p.tick(t).await.unwrap();
        assert_eq!(c.state(), DealState::Authorized);
    }
    assert_eq!(c.world.world().posts("void"), 0);
    c.world.world().reads_fail = false;
    c.p.tick(VOID_AT + 3600).await.unwrap();
    assert_eq!(c.state(), DealState::AutoVoided);
    {
        let w = c.world.world();
        assert_eq!((w.posts("capture"), w.writes("capture")), (1, 0));
        assert_eq!((w.posts("void"), w.writes("void")), (1, 1));
    }
    c.one_request_id_per_operation();

    // Capture that PayPal did, read only after the deadline: confirmed, never voided.
    let mut c = Case::new();
    c.before("capture").await;
    {
        let mut w = c.world.world();
        w.cut.push("capture");
        w.reads_fail = true;
    }
    let _ = c.run("capture").await;
    c.p.tick(VOID_AT).await.unwrap();
    c.world.world().reads_fail = false;
    c.p.tick(VOID_AT + 3600).await.unwrap();
    assert_eq!(c.state(), DealState::Receipted);
    assert_eq!(c.world.world().posts("void"), 0);

    // Void: parked while unreadable, nothing sent; then the same void goes again.
    let mut c = Case::new();
    c.before("void").await;
    {
        let mut w = c.world.world();
        w.lose.push("void");
        w.reads_fail = true;
    }
    let _ = c.run("void").await;
    c.p.tick(VOID_AT + 60).await.unwrap();
    assert_eq!(c.world.world().posts("void"), 1);
    c.world.world().reads_fail = false;
    c.p.tick(VOID_AT + 3600).await.unwrap();
    assert_eq!(c.state(), DealState::AutoVoided);
    c.one_request_id_per_operation();

    // Create: no read exists; every re-send is lost too. After the re-send budget nothing more
    // goes, and at the deadline the deal lapses: its payment link never left the wallet.
    let mut c = Case::new();
    c.p.wallet
        .ledger
        .set_deadline(c.id, 2000, None, 100)
        .unwrap();
    c.world.world().lose.extend(["create"; 8]);
    let _ = c.run("create").await;
    // Inside the market reference's freshness, so the policy gate keeps passing.
    for t in (130..900).step_by(100) {
        c.p.tick(t).await.unwrap();
    }
    assert_eq!(c.world.world().posts("create"), 1 + MAX_RESENDS as usize);
    assert_eq!(c.state(), DealState::Settling);
    c.p.tick(2000).await.unwrap();
    assert_eq!(c.state(), DealState::Expired);
    assert_eq!(c.world.world().posts("create"), 1 + MAX_RESENDS as usize);
    assert_eq!(c.audit("money.resolved")[0]["outcome"], "lapsed");
    assert!(c.check().is_none());
    c.one_request_id_per_operation();
}

#[tokio::test]
async fn an_expired_owner_ticket_parks_and_never_resends() {
    let mut c = Case::new();
    c.before("capture").await;
    let token = c.p.approval.token("approval").unwrap().to_owned();
    c.p.approval
        .unlock("approval", &token, &Reauth, 100)
        .unwrap();
    let hash = c.deal().terms.hash().unwrap();
    let ticket =
        c.p.approval
            .ticket("approval", &token, c.id, hash, 1, 100)
            .unwrap();
    c.world.world().lose.push("capture");
    assert!(
        c.p.capture(c.id, 1, P, Authority::Owner(ticket), 100)
            .await
            .is_err()
    );
    // The scheduler holds no ticket; the owner's 60-second ticket from the decision has expired.
    assert_eq!(
        c.p.resolve(c.id, None, 130).await.unwrap(),
        Some(Resolution::Parked(CheckReason::NeedsOwner))
    );
    let stale =
        c.p.approval
            .ticket("approval", &token, c.id, hash, 1, 100)
            .unwrap();
    let calls = c.calls();
    assert_eq!(
        c.p.resolve(c.id, Some(stale), 200).await.unwrap(),
        Some(Resolution::Parked(CheckReason::NeedsOwner))
    );
    assert_eq!(c.calls(), calls + 1, "only the read");
    assert_eq!(c.world.world().posts("capture"), 1);
    assert_eq!(c.state(), DealState::Authorized);
    // A fresh decision in the approval window sends the same request again.
    c.p.approval
        .unlock("approval", &token, &Reauth, 300)
        .unwrap();
    let fresh =
        c.p.approval
            .ticket("approval", &token, c.id, hash, 1, 300)
            .unwrap();
    assert_eq!(
        c.p.resolve(c.id, Some(fresh), 300).await.unwrap(),
        Some(Resolution::Resent { confirmed: true })
    );
    assert_eq!(c.state(), DealState::Receipted);
    assert!(matches!(
        c.deal().decided_by,
        Some(DecidedBy::Human { at: 100 })
    ));
    c.one_request_id_per_operation();

    // An owner's void that was lost waits for the owner too; the deadline sends no second void.
    let mut c = Case::new();
    c.before("void").await;
    let token = c.p.approval.token("approval").unwrap().to_owned();
    c.p.approval
        .unlock("approval", &token, &Reauth, 100)
        .unwrap();
    let hash = c.deal().terms.hash().unwrap();
    let ticket =
        c.p.approval
            .ticket("approval", &token, c.id, hash, 1, 100)
            .unwrap();
    c.world.world().lose.push("void");
    assert!(c.p.owner_void(c.id, 1, ticket, 100).await.is_err());
    c.p.tick(130).await.unwrap();
    c.p.tick(VOID_AT).await.unwrap();
    assert_eq!(c.world.world().posts("void"), 1);
    assert_eq!(c.state(), DealState::Authorized);
    assert_eq!(c.check().unwrap().state, MoneyCheckState::Parked);
}

#[tokio::test]
async fn a_refused_resend_records_only_the_read() {
    let mut c = Case::new();
    c.before("capture").await;
    c.world.world().lose.push("capture");
    let _ = c.run("capture").await;
    // The shield now holds the deal: the seller mandate no longer covers the capture.
    c.p.wallet
        .ledger
        .raise_shield(c.id, ShieldVerdict::Hold, 120)
        .unwrap();
    let calls = c.calls();
    assert_eq!(
        c.p.resolve(c.id, None, 130).await.unwrap(),
        Some(Resolution::Parked(CheckReason::Refused))
    );
    assert_eq!(c.calls(), calls + 1, "the read and nothing else");
    assert_eq!(c.world.world().posts("capture"), 1);
    // Backoff: the next check waits.
    assert_eq!(c.p.resolve(c.id, None, 131).await.unwrap(), None);
    assert_eq!(c.calls(), calls + 1);
}

#[tokio::test]
async fn no_path_sends_one_operation_under_two_request_ids() {
    // Every operation x every way the wire can fail, resolved by ticks over three days.
    type Chaos = fn(&mut World, &'static str);
    let chaos: [(&str, Chaos); 5] = [
        ("cut", |w, op| w.cut.push(op)),
        ("lose", |w, op| w.lose.push(op)),
        ("garble", |w, op| w.garble.push(op)),
        ("lose twice", |w, op| w.lose.extend([op, op])),
        ("cut, unreadable", |w, op| {
            w.cut.push(op);
            w.reads_fail = true;
        }),
    ];
    for op in OPS {
        for (name, apply) in chaos {
            let mut c = Case::new();
            c.before(op).await;
            apply(&mut c.world.world(), op);
            let _ = c.run(op).await;
            let mut t = if op == "void" { VOID_AT } else { 130 };
            for step in 0..40 {
                if step == 20 {
                    c.world.world().reads_fail = false;
                }
                let _ = c.p.tick(t).await;
                t += 600;
            }
            c.one_request_id_per_operation();
            let w = c.world.world();
            for kind in OPS {
                assert!(w.writes(kind) <= 1, "{op}/{name}: {kind} done twice");
            }
            assert!(w.orders <= 1, "{op}/{name}");
            assert!(
                !(w.writes("capture") == 1 && w.posts("void") > 0),
                "{op}/{name}: a void went out after a capture"
            );
            drop(w);
            assert!(
                !c.p.has_open_operation(c.id).unwrap() || c.state() == DealState::Authorized,
                "{op}/{name}: {:?}",
                c.state()
            );
            c.p.wallet.ledger.verify_audit().unwrap();
        }
    }
}

struct Reauth;
impl NativeReauth for Reauth {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
