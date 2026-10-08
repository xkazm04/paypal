//! Subscription rescue, DISCOUNT_THIS_CYCLE end to end, against an Invoicing double that keeps
//! PayPal's own invoices and can "cut the wire" (PayPal did the step, its answer is lost) or lose
//! a request before PayPal saw it. Offline: no socket is opened.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use async_trait::async_trait;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use support::signer;
use table_app::*;
use table_core::*;
use table_ledger::*;
use table_paypal::Error;
use table_paypal::*;
use table_proto::*;

/// One invoice as PayPal holds it.
#[derive(Debug, Clone)]
struct Held {
    status: &'static str,
    amount: Value,
    reference: String,
    number: String,
}
#[derive(Debug, Default)]
struct Paypal {
    invoices: BTreeMap<String, Held>,
    /// The invoice each create request id produced (PayPal's idempotency store).
    by_request: BTreeMap<String, String>,
    /// What PayPal did: (step, request id).
    writes: Vec<(&'static str, String)>,
    /// Every POST that reached the wire: (step, request id).
    posts: Vec<(&'static str, String)>,
    reads: u32,
    searches: u32,
    cut: Vec<&'static str>,
    lose: Vec<&'static str>,
    reads_fail: bool,
    search_blind: bool,
    subscription: Option<Value>,
}
#[derive(Debug, Default)]
struct Invoicing(Mutex<Paypal>);
fn take(list: &mut Vec<&'static str>, step: &'static str) -> bool {
    list.iter()
        .position(|s| *s == step)
        .map(|i| list.remove(i))
        .is_some()
}
fn obs(method: &'static str, path: &str, id: &str, status: u16, body: Value) -> Observation {
    Observation {
        method,
        path: path.into(),
        request_id: id.into(),
        status,
        body,
        binding: None,
    }
}
fn lost(method: &'static str, path: &str, id: &str) -> Error {
    Error::Unknown {
        observations: vec![obs(method, path, id, 0, Value::Null)],
    }
}
fn wire(id: &str, h: &Held) -> Value {
    json!({"id":id,"status":h.status,"amount":h.amount,"detail":{"reference":h.reference,"invoice_number":h.number}})
}
#[async_trait]
impl SecondaryApi for Invoicing {
    async fn create_invoice(
        &self,
        request: &InvoiceRequest,
        id: &RequestId,
    ) -> Result<ApiResponse<Invoice>, Error> {
        let path = "/v2/invoicing/invoices";
        let mut w = self.0.lock().unwrap();
        w.posts.push(("create", id.as_str().into()));
        if take(&mut w.lose, "create") {
            return Err(lost("POST", path, id.as_str()));
        }
        let body = request.body()?;
        let invoice = match w.by_request.get(id.as_str()) {
            Some(existing) => existing.clone(),
            None => {
                let invoice = format!("INV-{}", w.invoices.len() + 1);
                w.writes.push(("create", id.as_str().into()));
                w.invoices.insert(
                    invoice.clone(),
                    Held {
                        status: "DRAFT",
                        amount: body["items"][0]["unit_amount"].clone(),
                        reference: body["detail"]["reference"].as_str().unwrap().into(),
                        number: body["detail"]["invoice_number"].as_str().unwrap().into(),
                    },
                );
                w.by_request.insert(id.as_str().into(), invoice.clone());
                invoice
            }
        };
        if take(&mut w.cut, "create") {
            return Err(lost("POST", path, id.as_str()));
        }
        let value = wire(&invoice, &w.invoices[&invoice]);
        Ok(ApiResponse {
            value: serde_json::from_value(value.clone()).unwrap(),
            observations: vec![obs("POST", path, id.as_str(), 201, value)],
        })
    }
    async fn send_invoice(&self, id: &ResourceId, r: &RequestId) -> Result<ApiResponse<()>, Error> {
        let path = format!("/v2/invoicing/invoices/{}/send", id.as_str());
        let mut w = self.0.lock().unwrap();
        w.posts.push(("send", r.as_str().into()));
        if take(&mut w.lose, "send") {
            return Err(lost("POST", &path, r.as_str()));
        }
        let held = w.invoices.get_mut(id.as_str()).ok_or(Error::Invalid)?;
        if held.status == "DRAFT" {
            held.status = "SENT";
            w.writes.push(("send", r.as_str().into()));
        }
        if take(&mut w.cut, "send") {
            return Err(lost("POST", &path, r.as_str()));
        }
        Ok(ApiResponse {
            value: (),
            observations: vec![obs("POST", &path, r.as_str(), 202, Value::Null)],
        })
    }
    async fn get_invoice(&self, id: &ResourceId) -> Result<ApiResponse<Invoice>, Error> {
        let path = format!("/v2/invoicing/invoices/{}", id.as_str());
        let mut w = self.0.lock().unwrap();
        w.reads += 1;
        if w.reads_fail {
            return Err(lost("GET", &path, ""));
        }
        let value = wire(
            id.as_str(),
            w.invoices.get(id.as_str()).ok_or(Error::Invalid)?,
        );
        Ok(ApiResponse {
            value: serde_json::from_value(value.clone()).unwrap(),
            observations: vec![obs("GET", &path, "", 200, value)],
        })
    }
    async fn search_invoices(&self, number: &str) -> Result<ApiResponse<InvoiceList>, Error> {
        let path = "/v2/invoicing/search-invoices";
        let mut w = self.0.lock().unwrap();
        w.searches += 1;
        if w.reads_fail {
            return Err(lost("POST", path, ""));
        }
        let items: Vec<Value> = if w.search_blind {
            Vec::new()
        } else {
            w.invoices
                .iter()
                .filter(|(_, h)| h.number == number)
                .map(|(id, h)| wire(id, h))
                .collect()
        };
        let value = json!({ "items": items });
        Ok(ApiResponse {
            value: serde_json::from_value(value.clone()).unwrap(),
            observations: vec![obs("POST", path, "", 200, value)],
        })
    }
    async fn get_subscription(&self, id: &ResourceId) -> Result<ApiResponse<Subscription>, Error> {
        let path = format!("/v1/billing/subscriptions/{}", id.as_str());
        let mut w = self.0.lock().unwrap();
        w.reads += 1;
        let value = w.subscription.clone().ok_or(Error::Invalid)?;
        Ok(ApiResponse {
            value: serde_json::from_value(value.clone()).unwrap(),
            observations: vec![obs("GET", &path, "", 200, value)],
        })
    }
    async fn suspend_subscription(
        &self,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        panic!("rescue never suspends")
    }
    async fn activate_subscription(
        &self,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        panic!("rescue never activates")
    }
    async fn revise_subscription(
        &self,
        _: &ResourceId,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<RevisedSubscription>, Error> {
        panic!("rescue never revises")
    }
    async fn capture_outstanding(
        &self,
        _: &ResourceId,
        _: Money,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        panic!("rescue never captures")
    }
    async fn transactions(
        &self,
        _: ReportingWindow,
    ) -> Result<ApiResponse<TransactionPage>, Error> {
        Err(Error::Invalid)
    }
    async fn list_disputes(&self) -> Result<ApiResponse<DisputeList>, Error> {
        Err(Error::Invalid)
    }
    async fn get_dispute(&self, _: &ResourceId) -> Result<ApiResponse<Dispute>, Error> {
        Err(Error::Invalid)
    }
}
impl Invoicing {
    fn set(&self, f: impl FnOnce(&mut Paypal)) {
        f(&mut self.0.lock().unwrap());
    }
    fn get<T>(&self, f: impl FnOnce(&Paypal) -> T) -> T {
        f(&self.0.lock().unwrap())
    }
    fn pay(&self, status: &'static str) {
        self.set(|w| {
            for h in w.invoices.values_mut() {
                h.status = status;
            }
        });
    }
}
/// Orders are never touched by a rescue.
#[derive(Debug)]
struct NoOrders;
#[async_trait]
impl PayPalApi for NoOrders {
    async fn create_order(
        &self,
        _: &CreateOrder,
        _: &RequestId,
    ) -> Result<ApiResponse<Order>, Error> {
        panic!("no order")
    }
    async fn get_order(&self, _: &ResourceId) -> Result<ApiResponse<Order>, Error> {
        panic!("no order")
    }
    async fn authorize(&self, _: &ResourceId, _: &RequestId) -> Result<ApiResponse<Order>, Error> {
        panic!("no order")
    }
    async fn capture(
        &self,
        _: &ResourceId,
        _: Money,
        _: &RequestId,
    ) -> Result<ApiResponse<Payment>, Error> {
        panic!("no order")
    }
    async fn void(&self, _: &ResourceId, _: &RequestId) -> Result<ApiResponse<()>, Error> {
        panic!("no order")
    }
    async fn get_authorization(&self, _: &ResourceId) -> Result<ApiResponse<Payment>, Error> {
        panic!("no order")
    }
}
struct Reauth;
impl NativeReauth for Reauth {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
const T0: Timestamp = 1_000_000;
const MANDATE: &str = "00000000000000000000000009";
fn rescue_payload(agent: &AgentSigner, version: u32, max_bp: u16) -> MandatePayload {
    MandatePayload {
        id: MANDATE.parse().unwrap(),
        version,
        agent_key: agent.public_key().to_bytes(),
        not_before: 0,
        expires: 100_000_000,
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
                max_total_day: usd(50_000),
            },
            Clause::HumanPresentOver { amount: usd(0) },
            Clause::Payees {
                payees: vec![PayeeRef::new("shop-merchant").unwrap()],
            },
            Clause::Lever {
                levers: vec![RescueLever::DiscountThisCycle],
                max_discount_bp: max_bp,
                max_discount: usd(500),
            },
        ],
    }
}
struct Rig {
    p: Pipeline,
    pp: Arc<Invoicing>,
    owner: AgentSigner,
    agent_key: [u8; 32],
    token: String,
}
fn rig() -> Rig {
    let (owner, agent) = (signer(), signer());
    let payload = rescue_payload(&agent, 1, 2000);
    let agent_key = payload.agent_key;
    let mut ledger = Ledger::in_memory().unwrap();
    ledger
        .insert_mandate(
            &OpenMandate {
                owner_sig: owner.sign_payload(&payload).unwrap(),
                payload,
            },
            &owner.public_key(),
            100,
        )
        .unwrap();
    let wallet = Wallet::new(ledger, agent, owner.public_key());
    let mut p = Pipeline::new(wallet, Arc::new(NoOrders), T0).unwrap();
    let pp = Arc::new(Invoicing::default());
    p.set_secondary(Some(pp.clone()));
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval.unlock("approval", &token, &Reauth, T0).unwrap();
    Rig {
        p,
        pp,
        owner,
        agent_key,
        token,
    }
}
fn failure(source: RescueSource, sub: &str) -> RenewalFailure {
    RenewalFailure {
        source,
        subscription_id: sub.into(),
        recipient: Recipient::new("subscriber14@example.com").unwrap(),
        plan: ItemRef::new("care-plan").unwrap(),
        cycle: usd(1200),
        failed_payments: 1,
        failed_at: T0,
        next_retry_at: Some(T0 + 4 * 86400),
    }
}
fn did(n: u128) -> DealId {
    format!("{n:026}").parse().unwrap()
}
impl Rig {
    fn open(&mut self, n: u128, source: RescueSource) -> Deal {
        self.p
            .rescue_open(
                did(n),
                &failure(source, &format!("I-SUB{n}")),
                (MANDATE.parse().unwrap(), 1),
                T0,
            )
            .unwrap()
    }
    fn ticket(&mut self, id: DealId, at: Timestamp) -> OwnerTicket {
        let hash = self
            .p
            .wallet
            .ledger
            .get_deal(id)
            .unwrap()
            .terms
            .hash()
            .unwrap();
        self.p
            .approval
            .ticket("approval", &self.token, id, hash, 1, at)
            .unwrap()
    }
    async fn approve(&mut self, id: DealId, at: Timestamp) -> Result<(), table_app::Error> {
        let t = self.ticket(id, at);
        self.p.rescue_approve(id, t, at).await
    }
    fn state(&self, id: DealId) -> DealState {
        self.p.wallet.ledger.get_deal(id).unwrap().state
    }
    fn calls(&self, id: DealId) -> u64 {
        self.p.wallet.ledger.paypal_call_count(id).unwrap()
    }
    fn posts(&self) -> Vec<(&'static str, String)> {
        self.pp.get(|w| w.posts.clone())
    }
    fn writes(&self) -> Vec<(&'static str, String)> {
        self.pp.get(|w| w.writes.clone())
    }
}

#[tokio::test]
async fn the_owner_approves_one_discounted_invoice_and_only_a_paid_receipted_one_counts() {
    let mut r = rig();
    let deal = r.open(1, RescueSource::Paypal);
    // The fix is 20% off the $12.00 cycle: a $9.60 invoice, waiting at AGREED for the owner.
    assert_eq!(
        (deal.state, deal.terms.unit_price),
        (DealState::Agreed, usd(960))
    );
    assert_eq!(r.calls(deal.id), 0);
    let checks = r.p.approval_checks(deal.id, T0).unwrap();
    assert!(
        checks.iter().all(|c| c.status != ApprovalCheckStatus::Fail),
        "{checks:?}"
    );
    assert!(checks[0].text.contains("$9.60") && checks[0].text.contains("20%"));
    r.approve(deal.id, T0 + 10).await.unwrap();
    assert_eq!(r.state(deal.id), DealState::AwaitingApproval);
    let id = deal.id;
    assert_eq!(
        r.writes(),
        vec![
            ("create", format!("{id}-1-invoice-create")),
            ("send", format!("{id}-1-invoice-send")),
        ]
    );
    // The owner's decision is the recorded authority of both steps, and the countersign.
    let human = DecidedBy::Human { at: T0 + 10 };
    assert_eq!(
        r.p.wallet.ledger.rescue_decision(id).unwrap(),
        Some(human.clone())
    );
    assert_eq!(
        r.p.wallet.ledger.get_deal(id).unwrap().decided_by,
        Some(human.clone())
    );
    assert!(r.p.wallet.ledger.has_countersign(id, 1).unwrap());
    // Sent is not recovered; a hand-marked status is not either.
    assert!(!r.p.rescue_poll(id, T0 + 100).await.unwrap());
    r.pp.pay("MARKED_AS_PAID");
    assert!(!r.p.rescue_poll(id, T0 + 200).await.unwrap());
    assert!(r.p.wallet.ledger.rescue_recovered().unwrap().is_empty());
    // PAID, read back from PayPal: receipted and counted, once.
    r.pp.pay("PAID");
    assert!(r.p.rescue_tick(id, T0 + 300).await.unwrap());
    assert_eq!(r.state(id), DealState::Receipted);
    assert!(r.p.wallet.ledger.rescue_counted(id).unwrap());
    assert_eq!(
        r.p.wallet.ledger.rescue_recovered().unwrap(),
        vec![usd(960)]
    );
    assert!(!r.p.rescue_tick(id, T0 + 400).await.unwrap());
    assert_eq!(r.writes().len(), 2);
    // The subscriber's email never reaches a PayPal call record or the audit chain, and no path
    // ever names a plan.
    let requests = r.p.wallet.ledger.paypal_call_requests(id).unwrap();
    assert!(
        requests
            .iter()
            .all(|(_, path, _)| !path.contains("/plans") && !path.contains("pricing"))
    );
    let (rows, _) = r.p.wallet.ledger.audit_page(None, 1000).unwrap();
    assert!(
        rows.iter()
            .all(|row| !row.detail.to_string().contains("subscriber14@"))
    );
    let _ = (&r.owner, r.agent_key);
    r.p.wallet.ledger.verify_audit().unwrap();
}

#[tokio::test]
async fn every_refusal_comes_before_any_paypal_call() {
    let mut r = rig();
    let deal = r.open(1, RescueSource::Paypal);
    let id = deal.id;
    // No agent or rule authority ever sends a rescue invoice.
    for authority in [
        Authority::Policy,
        Authority::SellerMandate,
        Authority::HouseMandate,
    ] {
        assert!(
            !r.p.step_allowed(
                id,
                MoneyStep::Create,
                Category::Service,
                authority,
                T0,
                false
            )
            .unwrap()
        );
    }
    // A ticket for other terms, an expired ticket, or a locked window.
    let wrong =
        r.p.approval
            .ticket("approval", &r.token, id, H256::ZERO, 1, T0)
            .unwrap();
    assert!(r.p.rescue_approve(id, wrong, T0).await.is_err());
    let stale = r.ticket(id, T0);
    assert!(r.p.rescue_approve(id, stale, T0 + 120).await.is_err());
    // No Invoicing client: nothing can be sent.
    r.p.set_secondary(None);
    assert!(matches!(
        r.approve(id, T0 + 130).await,
        Err(table_app::Error::Unavailable)
    ));
    r.p.set_secondary(Some(r.pp.clone()));
    // A mandate signed tighter than the fix (10% instead of 20%) refuses it on clause 8.
    let tighter = rescue_payload(&signer(), 2, 1000);
    let mut tighter = tighter;
    tighter.agent_key = r.agent_key;
    r.p.wallet
        .ledger
        .insert_mandate(
            &OpenMandate {
                owner_sig: r.owner.sign_payload(&tighter).unwrap(),
                payload: tighter,
            },
            &r.owner.public_key(),
            T0,
        )
        .unwrap();
    r.p.wallet.ledger.rebind_mandate(id, 2, T0).unwrap();
    match r.approve(id, T0 + 140).await {
        Err(table_app::Error::Refused(refusal)) => assert_eq!(refusal.clause, 8),
        other => panic!("expected a clause 8 refusal, got {other:?}"),
    }
    let checks = r.p.approval_checks(id, T0 + 140).unwrap();
    assert_eq!(checks[5].status, ApprovalCheckStatus::Fail);
    assert_eq!(r.calls(id), 0);
    assert!(r.posts().is_empty());
    assert_eq!(r.state(id), DealState::Agreed);
    // Past PayPal's next retry the fix has lapsed, even for an unlocked owner.
    let mut late = rig();
    let id = late.open(1, RescueSource::Paypal).id;
    late.p
        .approval
        .unlock("approval", &late.token, &Reauth, T0 + 5 * 86400)
        .unwrap();
    assert!(late.approve(id, T0 + 5 * 86400).await.is_err());
    assert!(late.posts().is_empty());
    assert_eq!(late.calls(id), 0);
    // A renewal the rules cannot fix is never written: a mandate with no fixes clause.
    let (wallet, _, _, _) = support::setup(Side::Seller, DealKind::Haggle);
    let mut other = Pipeline::new(wallet, Arc::new(NoOrders), T0).unwrap();
    let before = other.wallet.ledger.list_deals().unwrap().len();
    assert!(
        other
            .rescue_open(
                did(7),
                &failure(RescueSource::Paypal, "I-X"),
                ("00000000000000000000000002".parse().unwrap(), 1),
                T0
            )
            .is_err()
    );
    assert_eq!(other.wallet.ledger.list_deals().unwrap().len(), before);
}

#[tokio::test]
async fn a_lost_create_is_found_by_its_number_and_never_made_twice() {
    let mut r = rig();
    let id = r.open(1, RescueSource::Paypal).id;
    r.pp.set(|w| w.cut.push("create"));
    assert!(matches!(
        r.approve(id, T0).await,
        Err(table_app::Error::Unavailable)
    ));
    assert_eq!(r.state(id), DealState::Settling);
    assert_eq!(
        r.p.wallet.ledger.money_check(id).unwrap().map(|c| c.step),
        Some(MoneyCheckStep::InvoiceCreate)
    );
    // The scheduler reads back: PayPal's search finds this deal's draft, which the deal records.
    assert!(r.p.rescue_tick(id, T0 + 20).await.unwrap());
    assert!(!r.p.has_open_operation(id).unwrap());
    let deal = r.p.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(
        (deal.state, deal.paypal.order.as_deref()),
        (DealState::Settling, Some("INV-1"))
    );
    // Sending it is the owner's fresh decision; the invoice is not made again.
    r.approve(id, T0 + 30).await.unwrap();
    assert_eq!(r.state(id), DealState::AwaitingApproval);
    let creates: Vec<_> = r
        .writes()
        .into_iter()
        .filter(|(s, _)| *s == "create")
        .collect();
    assert_eq!(creates.len(), 1);
    assert_eq!(r.posts().iter().filter(|(s, _)| *s == "create").count(), 1);
}

#[tokio::test]
async fn a_create_paypal_cannot_find_stays_parked_and_lapses_without_a_second_invoice() {
    let mut r = rig();
    let id = r.open(1, RescueSource::Paypal).id;
    r.pp.set(|w| {
        w.lose.push("create");
        w.search_blind = true;
    });
    assert!(r.approve(id, T0).await.is_err());
    assert!(!r.p.rescue_tick(id, T0 + 20).await.unwrap());
    assert!(r.p.has_open_operation(id).unwrap());
    // The owner trying again does not make a new invoice either.
    r.approve(id, T0 + 60).await.unwrap();
    assert!(r.p.has_open_operation(id).unwrap());
    assert_eq!(r.posts().len(), 1);
    // At PayPal's next retry the fix lapses: no draft was ever shown to anyone.
    assert!(r.p.rescue_tick(id, T0 + 4 * 86400).await.unwrap());
    assert_eq!(r.state(id), DealState::Expired);
    assert_eq!(r.posts().len(), 1);
    assert!(r.writes().is_empty());
}

#[tokio::test]
async fn a_lost_send_is_read_back_and_resent_only_under_its_own_id_on_a_fresh_decision() {
    // PayPal sent it and the answer was lost: read back as sent.
    let mut r = rig();
    let id = r.open(1, RescueSource::Paypal).id;
    r.pp.set(|w| w.cut.push("send"));
    assert!(r.approve(id, T0).await.is_err());
    assert_eq!(
        r.p.wallet.ledger.money_check(id).unwrap().map(|c| c.step),
        Some(MoneyCheckStep::InvoiceSend)
    );
    assert!(r.p.rescue_tick(id, T0 + 20).await.unwrap());
    assert_eq!(r.state(id), DealState::AwaitingApproval);
    assert_eq!(r.writes().len(), 2);

    // The request never reached PayPal: the invoice is still a draft. Without the owner it waits;
    // with the owner's fresh decision it goes again under the same request id.
    let mut r = rig();
    let id = r.open(1, RescueSource::Paypal).id;
    r.pp.set(|w| w.lose.push("send"));
    assert!(r.approve(id, T0).await.is_err());
    assert!(!r.p.rescue_tick(id, T0 + 20).await.unwrap());
    assert!(r.p.has_open_operation(id).unwrap());
    assert_eq!(r.state(id), DealState::Settling);
    r.approve(id, T0 + 60).await.unwrap();
    assert_eq!(r.state(id), DealState::AwaitingApproval);
    let sends: Vec<_> = r
        .posts()
        .into_iter()
        .filter(|(s, _)| *s == "send")
        .collect();
    assert_eq!(sends.len(), 2);
    assert!(
        sends
            .iter()
            .all(|(_, rid)| *rid == format!("{id}-1-invoice-send"))
    );
    assert_eq!(r.writes().iter().filter(|(s, _)| *s == "send").count(), 1);
}

#[tokio::test]
async fn a_replayed_failure_is_invoiced_on_the_owners_decision_but_never_counts() {
    let mut r = rig();
    let deal = r.open(1, RescueSource::Replay);
    assert_eq!(deal.mode, Mode::Replay);
    let checks = r.p.approval_checks(deal.id, T0).unwrap();
    assert!(checks[3].text.contains("not counted"));
    r.approve(deal.id, T0).await.unwrap();
    r.pp.pay("PAID");
    assert!(r.p.tick(T0 + 120).await.unwrap().contains(&deal.id));
    assert_eq!(r.state(deal.id), DealState::Receipted);
    assert!(!r.p.wallet.ledger.rescue_counted(deal.id).unwrap());
    assert!(r.p.wallet.ledger.rescue_recovered().unwrap().is_empty());
}

#[tokio::test]
async fn silence_lets_a_fix_lapse_and_an_unpaid_invoice_expire_and_nothing_is_collected() {
    let mut r = rig();
    let quiet = r.open(1, RescueSource::Paypal).id;
    let unpaid = r.open(2, RescueSource::Paypal).id;
    let cancelled = r.open(3, RescueSource::Paypal).id;
    r.approve(unpaid, T0).await.unwrap();
    r.approve(cancelled, T0).await.unwrap();
    r.pp.set(|w| {
        if let Some(h) = w.invoices.get_mut("INV-2") {
            h.status = "CANCELLED";
        }
    });
    assert!(r.p.rescue_tick(cancelled, T0 + 100).await.unwrap());
    assert_eq!(r.state(cancelled), DealState::Failed);
    // The unapproved fix lapses at PayPal's retry with no call at all.
    assert!(r.p.tick(T0 + 4 * 86400).await.unwrap().contains(&quiet));
    assert_eq!(r.state(quiet), DealState::Withdrawn);
    assert_eq!(r.calls(quiet), 0);
    // A sent invoice is read once more at its deadline, then expires unpaid.
    let posts = r.posts().len();
    assert!(r.p.tick(T0 + 31 * 86400).await.unwrap().contains(&unpaid));
    assert_eq!(r.state(unpaid), DealState::Expired);
    assert_eq!(r.posts().len(), posts);
    assert!(r.p.wallet.ledger.rescue_recovered().unwrap().is_empty());
}

#[tokio::test]
async fn a_failure_paypal_reports_opens_a_counted_rescue_and_a_healthy_subscription_opens_none() {
    let mut r = rig();
    let sub = ResourceId::new("I-SUB9").unwrap();
    let mandate = (MANDATE.parse().unwrap(), 1);
    let read = |status: &str, failed: u32| json!({"id":"I-SUB9","status":status,"plan_id":"P-1","billing_info":{"outstanding_balance":{"currency_code":"USD","value":"12.00"},"failed_payments_count":failed}});
    let email = || Recipient::new("subscriber9@example.com").unwrap();
    let plan = || ItemRef::new("care-plan").unwrap();
    // No failed payment, a cancelled subscription, or several cycles owed: nothing opens.
    for (status, failed) in [("ACTIVE", 0), ("CANCELLED", 1), ("ACTIVE", 2)] {
        r.pp.set(|w| w.subscription = Some(read(status, failed)));
        assert!(
            r.p.rescue_detect(did(9), &sub, email(), plan(), mandate, T0)
                .await
                .unwrap()
                .is_none()
        );
    }
    assert!(r.p.wallet.ledger.list_deals().unwrap().is_empty());
    r.pp.set(|w| w.subscription = Some(read("SUSPENDED", 1)));
    let deal =
        r.p.rescue_detect(did(9), &sub, email(), plan(), mandate, T0)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(
        (deal.mode, deal.terms.unit_price),
        (Mode::Sandbox, usd(960))
    );
    assert_eq!(r.calls(deal.id), 1);
    r.approve(deal.id, T0).await.unwrap();
    r.pp.pay("PAID");
    r.p.tick(T0 + 60).await.unwrap();
    assert!(r.p.wallet.ledger.rescue_counted(deal.id).unwrap());
}

/// The owner's watch list, read by the scheduler: one counted rescue per failure per run of
/// failures, every read a GET under the day's budget, nothing written at PayPal by detection.
#[tokio::test]
async fn a_watched_subscription_opens_exactly_one_fix_per_failure_and_never_writes_at_paypal() {
    let mut r = rig();
    let mandate = (MANDATE.parse().unwrap(), 1);
    let read = |failed: u32, owed: &str| json!({"id":"I-W1","status":"ACTIVE","plan_id":"P-1","billing_info":{"outstanding_balance":{"currency_code":"USD","value":owed},"failed_payments_count":failed}});
    let email = Recipient::new("watched@example.com").unwrap();
    r.p.wallet
        .ledger
        .watch_subscription("I-W1", &email, &ItemRef::new("care-plan").unwrap(), 20, T0)
        .unwrap();
    let watch = |r: &Rig| r.p.wallet.ledger.rescue_watches().unwrap().remove(0);
    let reads = |r: &Rig| r.pp.get(|w| w.reads);
    // Renewals paid: read, nothing opens.
    r.pp.set(|w| w.subscription = Some(read(0, "0.00")));
    let w0 = watch(&r);
    assert!(matches!(
        r.p.rescue_watch_read(&w0, did(1), mandate, 100, T0)
            .await
            .unwrap(),
        WatchRead::Seen(WatchVerdict::Paid)
    ));
    // A read PayPal does not answer backs off and opens nothing.
    r.pp.set(|w| w.subscription = None);
    assert!(matches!(
        r.p.rescue_watch_read(&watch(&r), did(1), mandate, 100, T0 + 10)
            .await
            .unwrap(),
        WatchRead::Unreadable
    ));
    assert_eq!(watch(&r).tries, 1);
    // One failed payment: the one fix opens, PayPal-reported, from a GET alone.
    r.pp.set(|w| w.subscription = Some(read(1, "12.00")));
    let day1 = T0 + 86400;
    let WatchRead::Opened(deal) =
        r.p.rescue_watch_read(&watch(&r), did(1), mandate, 100, day1)
            .await
            .unwrap()
    else {
        panic!("a failure opens its fix");
    };
    assert_eq!(
        (deal.state, deal.mode, deal.terms.unit_price),
        (DealState::Agreed, Mode::Sandbox, usd(960))
    );
    assert_eq!(
        r.p.wallet
            .ledger
            .rescue_case(deal.id)
            .unwrap()
            .unwrap()
            .source,
        RescueSource::Paypal
    );
    assert_eq!(r.calls(deal.id), 1);
    assert!(r.posts().is_empty() && r.writes().is_empty());
    // Read again the next day, after the fix lapsed unanswered, and once two payments failed: the
    // same run of failures never opens a second fix.
    for (n, at, failed, owed) in [
        (2, day1 + 86400, 1, "12.00"),
        (3, day1 + 6 * 86400, 1, "12.00"),
        (4, day1 + 7 * 86400, 2, "24.00"),
    ] {
        r.p.tick(at).await.unwrap();
        r.pp.set(|w| w.subscription = Some(read(failed, owed)));
        assert!(matches!(
            r.p.rescue_watch_read(&watch(&r), did(n), mandate, 100, at)
                .await
                .unwrap(),
            WatchRead::Seen(WatchVerdict::Handled)
        ));
    }
    assert_eq!(r.state(deal.id), DealState::Withdrawn);
    assert_eq!(r.p.wallet.ledger.list_deals().unwrap().len(), 1);
    // A paid renewal ends the run; next cycle's failure is a new one and gets its own fix.
    let paid = day1 + 30 * 86400;
    r.pp.set(|w| w.subscription = Some(read(0, "0.00")));
    r.p.rescue_watch_read(&watch(&r), did(5), mandate, 100, paid)
        .await
        .unwrap();
    r.pp.set(|w| w.subscription = Some(read(1, "12.00")));
    let next = paid + 30 * 86400;
    let WatchRead::Opened(second) =
        r.p.rescue_watch_read(&watch(&r), did(6), mandate, 100, next)
            .await
            .unwrap()
    else {
        panic!("a new failure opens its own fix");
    };
    assert_ne!(second.id, deal.id);
    assert_eq!(r.p.wallet.ledger.list_deals().unwrap().len(), 2);
    // The day's budget: past it, nothing is read and nothing is written.
    let before = reads(&r);
    let used = r.p.wallet.ledger.rescue_watch_reads_today(next).unwrap();
    assert!(matches!(
        r.p.rescue_watch_read(&watch(&r), did(7), mandate, used, next + 1)
            .await
            .unwrap(),
        WatchRead::OverBudget
    ));
    assert_eq!(reads(&r), before);
    // Detection never wrote at PayPal; the subscriber's email is in no call record or audit row.
    assert!(r.posts().is_empty() && r.writes().is_empty());
    let (rows, _) = r.p.wallet.ledger.audit_page(None, 500).unwrap();
    assert!(
        rows.iter()
            .all(|row| !row.detail.to_string().contains("watched@"))
    );
    assert_eq!((r.calls(deal.id), r.calls(second.id)), (1, 1));
    // Opening a fix moved no money: the second one waits for the owner, and only the owner's
    // decision makes its invoice.
    assert_eq!(r.state(second.id), DealState::Agreed);
    r.p.wallet.ledger.verify_audit().unwrap();
}

/// Rules that do not allow rescue (or no longer do) stop detection before any read.
#[tokio::test]
async fn without_active_rescue_rules_a_watch_reads_nothing() {
    let mut r = rig();
    r.p.wallet
        .ledger
        .watch_subscription(
            "I-W2",
            &Recipient::new("w2@example.com").unwrap(),
            &ItemRef::new("care-plan").unwrap(),
            20,
            T0,
        )
        .unwrap();
    r.pp.set(|w| {
        w.subscription = Some(json!({"id":"I-W2","status":"ACTIVE","plan_id":"P-1","billing_info":{"outstanding_balance":{"currency_code":"USD","value":"12.00"},"failed_payments_count":1}}))
    });
    let watch = r.p.wallet.ledger.rescue_watches().unwrap().remove(0);
    // Past the rules' expiry.
    assert!(
        r.p.rescue_watch_read(
            &watch,
            did(1),
            (MANDATE.parse().unwrap(), 1),
            100,
            100_000_000
        )
        .await
        .is_err()
    );
    assert_eq!(r.pp.get(|w| w.reads), 0);
    assert_eq!(
        r.p.wallet
            .ledger
            .rescue_watch_reads_today(100_000_000)
            .unwrap(),
        0
    );
    assert!(r.p.wallet.ledger.list_deals().unwrap().is_empty());
}

impl Rig {
    /// A fix whose owner-approved send was lost before PayPal saw it: the invoice is a DRAFT at
    /// PayPal and the send step is open. The fix's deadline (PayPal's next retry) is `retry_in`.
    async fn lost_send(&mut self, n: u128, retry_in: Timestamp) -> DealId {
        let mut f = failure(RescueSource::Paypal, &format!("I-SUB{n}"));
        f.next_retry_at = Some(T0 + retry_in);
        let id = self
            .p
            .rescue_open(did(n), &f, (MANDATE.parse().unwrap(), 1), T0)
            .unwrap()
            .id;
        self.pp.set(|w| w.lose.push("send"));
        assert!(self.approve(id, T0).await.is_err());
        assert!(self.p.has_open_operation(id).unwrap());
        assert_eq!(self.state(id), DealState::Settling);
        id
    }
    fn sends(&self) -> usize {
        self.posts().iter().filter(|(s, _)| *s == "send").count()
    }
}

/// A lost send whose invoice PayPal still shows as a DRAFT used to stay open for ever, and the
/// open rescue refused every later one for its subscription. At the fix's deadline it now closes
/// not done and the fix expires: nothing was sent, nobody was asked to pay.
#[tokio::test]
async fn a_lost_send_still_draft_at_the_deadline_closes_and_frees_the_subscription() {
    let mut r = rig();
    let id = r.lost_send(1, 4 * 86400).await;
    assert!(r.p.rescue_tick(id, T0 + 4 * 86400).await.unwrap());
    assert_eq!(r.state(id), DealState::Expired);
    assert!(!r.p.has_open_operation(id).unwrap());
    assert_eq!(r.sends(), 1);
    assert!(r.writes().iter().all(|(s, _)| *s != "send"));
    // The subscription's next failure opens a new rescue.
    let later = T0 + 5 * 86400;
    let mut f = failure(RescueSource::Paypal, "I-SUB1");
    (f.failed_at, f.next_retry_at) = (later, Some(later + 4 * 86400));
    r.p.rescue_open(did(2), &f, (MANDATE.parse().unwrap(), 1), later)
        .unwrap();

    // Past the request id's window, before the deadline: closed not done, never sent again
    // (not even on a fresh decision), and the fix expires at its deadline.
    let mut r = rig();
    let id = r.lost_send(1, 4 * 86400).await;
    let past_window = T0 + REQUEST_ID_WINDOW_SECS + 60;
    assert_eq!(
        r.p.resolve(id, None, past_window).await.unwrap(),
        Some(Resolution::NotDone)
    );
    assert!(!r.p.has_open_operation(id).unwrap());
    assert_eq!(r.state(id), DealState::Settling);
    r.p.approval
        .unlock("approval", &r.token, &Reauth, past_window)
        .unwrap();
    // Refused as the owner's permission (it used to fail on the ledger's unique request id),
    // before anything is written.
    assert!(r.p.rescue_send_ended(id).unwrap());
    let audit = r.p.wallet.ledger.audit_count().unwrap();
    assert!(matches!(
        r.approve(id, past_window).await,
        Err(table_app::Error::Permission)
    ));
    assert_eq!(r.p.wallet.ledger.audit_count().unwrap(), audit);
    assert_eq!(r.sends(), 1);
    assert!(r.p.tick(T0 + 4 * 86400).await.unwrap().contains(&id));
    assert_eq!(r.state(id), DealState::Expired);
    assert_eq!(r.sends(), 1);
    assert!(r.writes().iter().all(|(s, _)| *s != "send"));
}

/// The re-send of a lost invoice send checks the fix's deadline first, as every other re-send
/// does: past the subscription's retry time an open send PayPal shows as a DRAFT is never sent,
/// even on the owner's fresh decision inside the request id's window.
#[tokio::test]
async fn past_the_retry_time_an_open_draft_send_is_never_sent_again() {
    let mut r = rig();
    let id = r.lost_send(1, 3600).await;
    let past_retry = T0 + 2 * 3600;
    r.p.approval
        .unlock("approval", &r.token, &Reauth, past_retry)
        .unwrap();
    r.approve(id, past_retry).await.unwrap();
    assert_eq!(r.sends(), 1);
    assert!(r.writes().iter().all(|(s, _)| *s != "send"));
    assert!(!r.p.has_open_operation(id).unwrap());
    assert_eq!(r.state(id), DealState::Expired);
    assert_eq!(
        r.pp.get(|w| w.invoices.values().map(|h| h.status).collect::<Vec<_>>()),
        ["DRAFT"]
    );
}
