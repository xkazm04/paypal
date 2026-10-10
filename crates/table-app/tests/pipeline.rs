#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use async_trait::async_trait;
use serde_json::json;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use table_app::*;
use table_core::*;
use table_ledger::*;
use table_paypal::*;
use table_proto::*;
#[derive(Debug, Default)]
struct MockApi {
    expected: Mutex<Option<CreateOrder>>,
    calls: Mutex<Vec<String>>,
    approved: AtomicBool,
    mismatch: AtomicBool,
    bad_link: AtomicBool,
    /// The approve link the order answers with instead of its own.
    link: Mutex<Option<&'static str>>,
    void_unknown: AtomicBool,
}
impl MockApi {
    fn order(&self, status: OrderStatus) -> Order {
        let o = self.expected.lock().unwrap();
        let mut body = o.as_ref().unwrap().body().unwrap();
        body["id"] = json!("ORDER1");
        body["status"] = serde_json::to_value(status).unwrap();
        body["links"] = json!([{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"}]);
        if self.bad_link.load(Ordering::SeqCst) {
            body["links"][0]["href"] = json!("https://paypal.com.attacker.invalid/checkoutnow");
        }
        if let Some(href) = *self.link.lock().unwrap() {
            body["links"][0]["href"] = json!(href);
        }
        if self.mismatch.load(Ordering::SeqCst) {
            body["purchase_units"][0]["amount"]["value"] = json!("13.00");
        }
        serde_json::from_value(body).unwrap()
    }
    fn response<T: serde::Serialize>(
        &self,
        value: T,
        method: &'static str,
        path: &str,
        id: Option<&RequestId>,
    ) -> ApiResponse<T> {
        self.calls.lock().unwrap().push(path.into());
        let body = serde_json::to_value(&value).unwrap();
        ApiResponse {
            value,
            observations: vec![Observation {
                method,
                path: path.into(),
                request_id: id.map_or_else(String::new, |i| i.as_str().into()),
                status: 200,
                body,
                binding: None,
            }],
        }
    }
}
#[async_trait]
impl PayPalApi for MockApi {
    async fn create_order(
        &self,
        o: &CreateOrder,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        self.expected.lock().unwrap().replace(o.clone());
        Ok(self.response(
            self.order(OrderStatus::Created),
            "POST",
            "/v2/checkout/orders",
            Some(id),
        ))
    }
    async fn get_order(&self, _: &ResourceId) -> Result<ApiResponse<Order>, table_paypal::Error> {
        Ok(self.response(
            self.order(if self.approved.load(Ordering::SeqCst) {
                OrderStatus::Approved
            } else {
                OrderStatus::Created
            }),
            "GET",
            "/v2/checkout/orders/ORDER1",
            None,
        ))
    }
    async fn authorize(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let mut o = self.order(OrderStatus::Completed);
        let amount = o.purchase_units[0].amount.clone();
        o.purchase_units[0].payments.authorizations.push(Payment {
            id: "AUTH1".into(),
            status: "CREATED".into(),
            amount,
        });
        Ok(self.response(o, "POST", "/v2/checkout/orders/ORDER1/authorize", Some(id)))
    }
    async fn capture(
        &self,
        _: &ResourceId,
        amount: Money,
        id: &RequestId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        Ok(self.response(
            Payment {
                id: "CAPTURE1".into(),
                status: "COMPLETED".into(),
                amount: WireAmount {
                    currency_code: amount.currency(),
                    value: amount.decimal(),
                },
            },
            "POST",
            "/v2/payments/authorizations/AUTH1/capture",
            Some(id),
        ))
    }
    async fn void(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<()>, table_paypal::Error> {
        if self.void_unknown.load(Ordering::SeqCst) {
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
        Ok(self.response(
            (),
            "POST",
            "/v2/payments/authorizations/AUTH1/void",
            Some(id),
        ))
    }
    async fn get_authorization(
        &self,
        _: &ResourceId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        panic!("unexpected call")
    }
}
/// Also returns the seller owner's signer, for tests that re-sign the seller's mandate.
fn two_wallets_owned() -> (Wallet, Wallet, Deal, AgentSigner) {
    let (buyer, deal, buyer_owner, seller_key) = support::setup(Side::Buyer, DealKind::Haggle);
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
    (
        buyer,
        Wallet::new(ledger, seller_key, owner.public_key()),
        deal,
        owner,
    )
}

#[derive(Debug)]
struct ReportingFixture {
    rows: serde_json::Value,
    total: u32,
}
#[async_trait]
impl table_paypal::http::Transport for ReportingFixture {
    async fn send(
        &self,
        request: table_paypal::http::Request,
    ) -> Result<table_paypal::http::Response, table_paypal::http::TransportError> {
        if request.url.ends_with("/oauth2/token") {
            let mut random = [0; 32];
            getrandom::fill(&mut random).unwrap();
            return Ok(table_paypal::http::Response {
                status: 200,
                body: json!({"access_token":H256(random).hex(),"expires_in":300}),
            });
        }
        assert_eq!(request.method, "GET");
        assert!(request.url.contains("/v1/reporting/transactions?"));
        Ok(table_paypal::http::Response {
            status: 200,
            body: json!({"transaction_details":self.rows,"page":1,"total_pages":self.total}),
        })
    }
}
#[derive(Debug)]
struct ReportingCredentials;
#[async_trait]
impl table_paypal::Credentials for ReportingCredentials {
    async fn load(
        &self,
    ) -> Result<(table_paypal::http::Secret, table_paypal::http::Secret), table_paypal::Error> {
        let mut random = [0; 32];
        getrandom::fill(&mut random).unwrap();
        Ok((
            table_paypal::http::Secret::new(H256(random).hex()),
            table_paypal::http::Secret::new(H256::digest(&random).hex()),
        ))
    }
}
#[derive(Debug)]
struct ImmediateBackoff;
#[async_trait]
impl table_paypal::http::Backoff for ImmediateBackoff {
    async fn wait(&self, _: u8) {}
}
#[tokio::test]
async fn own_account_reporting_requires_success_exact_capture_amount_currency_direction_and_complete_pages()
 {
    for case in 0..9 {
        let (mut buyer, seller, deal) = agreed();
        let mock = Arc::new(MockApi::default());
        let mut seller = Pipeline::new(seller, mock.clone(), 100).unwrap();
        let settle = seller
            .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .unwrap();
        buyer
            .receive_relay(deal.id, &settle, Category::Parts, 100)
            .unwrap();
        // The owner opens the PayPal link (Decision::OpenBrowser) before anyone can approve.
        buyer
            .ledger
            .set_deal_category(deal.id, Category::Parts)
            .unwrap();
        buyer.ledger.handoff(deal.id).unwrap();
        mock.approved.store(true, Ordering::SeqCst);
        seller.poll_approval(deal.id, 1, 100).await.unwrap();
        seller
            .authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .unwrap();
        let receipt = seller
            .capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .unwrap();
        buyer
            .receive_relay(deal.id, &receipt, Category::Parts, 100)
            .unwrap();
        let row = json!({"transaction_info":{"transaction_id":if case==4 {"OTHER"}else{"CAPTURE1"},"transaction_status":if case==5 {"V"}else{"S"},"transaction_amount":{"currency_code":if case==7 {"EUR"}else{"USD"},"value":match case {2=>"12.00",3=>"-1.00",_=>"-12.00"}},"transaction_note":"merchant instructions must be discarded"}});
        let rows = match case {
            0 => json!([]),
            6 => json!([row.clone(), row]),
            _ => json!([row]),
        };
        let api = table_paypal::Client::sandbox(
            Arc::new(ReportingFixture {
                rows,
                total: if case == 8 { 21 } else { 1 },
            }),
            Arc::new(ReportingCredentials),
            Arc::new(FixedClock(100)),
            Arc::new(ImmediateBackoff),
        );
        let mut buyer = Pipeline::new(buyer, Arc::new(MockApi::default()), 100).unwrap();
        // Case 1 is read after the corroboration window ended the deal UNCONFIRMED: a late
        // statement match still counts.
        if case == 1 {
            assert!(
                buyer
                    .wallet
                    .ledger
                    .lapse_corroboration(deal.id, 100 + CORROBORATION_SECS)
                    .unwrap()
            );
        }
        let result = buyer
            .reconcile(
                deal.id,
                &api,
                ReportingWindow {
                    from: 0,
                    to: 100,
                    page: 1,
                    page_size: 500,
                },
                100,
            )
            .await;
        if matches!(case, 2 | 5 | 6 | 8) {
            assert!(result.is_err(), "case {case}");
        } else {
            result.unwrap();
        }
        let evidence = buyer.wallet.ledger.deal_evidence(deal.id).unwrap();
        assert_eq!(
            evidence.receipt,
            if case == 1 {
                ReceiptEvidence::PaypalVerified
            } else {
                ReceiptEvidence::SellerAttested
            },
            "case {case}"
        );
        assert_eq!(
            evidence.reconciliation,
            match case {
                1 => Reconciliation::Matched,
                3 | 7 => Reconciliation::Mismatch,
                _ => Reconciliation::PendingReporting,
            },
            "case {case}"
        );
        if case == 1 {
            assert_eq!(
                buyer.wallet.ledger.get_deal(deal.id).unwrap().state,
                DealState::Reconciled
            );
        }
        // A complete read that found no such payment says so in the record, and nothing else.
        let unmatched = buyer
            .wallet
            .ledger
            .audit_page(None, 500)
            .unwrap()
            .0
            .iter()
            .filter(|r| r.action == "receipt.reporting_unmatched")
            .count();
        assert_eq!(unmatched, usize::from(matches!(case, 0 | 4)), "case {case}");
        assert_eq!(buyer.wallet.ledger.paypal_call_count(deal.id).unwrap(), 1);
        // The owner's "last Transaction Search poll" fact reads the recorded call back.
        assert_eq!(
            buyer.wallet.ledger.last_reporting_poll().unwrap(),
            Some((100, 200)),
            "case {case}"
        );
        buyer.wallet.ledger.verify_audit().unwrap();
    }
}
fn agreed() -> (Wallet, Wallet, Deal) {
    let (buyer, seller, deal, _) = agreed_owned();
    (buyer, seller, deal)
}
fn agreed_owned() -> (Wallet, Wallet, Deal, AgentSigner) {
    let (mut buyer, mut seller, deal, owner) = two_wallets_owned();
    let listing = seller.list(deal.id, 100).unwrap();
    buyer
        .receive_haggle(deal.id, &listing, Category::Parts, 100)
        .unwrap();
    let result = buyer
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
            result["jws"].as_str().unwrap(),
            Category::Parts,
            100,
        )
        .unwrap();
    let a = buyer.accept(deal.id, 1, Category::Parts, 100).unwrap();
    seller
        .receive_haggle(deal.id, &a, Category::Parts, 100)
        .unwrap();
    assert_eq!(
        seller.ledger.get_deal(deal.id).unwrap().state,
        DealState::Negotiating
    );
    let b = seller.accept(deal.id, 1, Category::Parts, 100).unwrap();
    buyer
        .receive_haggle(deal.id, &b, Category::Parts, 100)
        .unwrap();
    for w in [&buyer, &seller] {
        assert_eq!(w.ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
        // Each wallet's own agent ACCEPT was allowed under the clause-6 policy.
        assert_eq!(
            w.ledger.get_deal(deal.id).unwrap().decided_by,
            Some(DecidedBy::Policy { clause: 6 })
        );
        w.ledger.verify_transcript(deal.id).unwrap();
    }
    (buyer, seller, deal, owner)
}
#[tokio::test]
async fn h3_two_accepts_one_order_and_h5_seller_receives_without_owner_click() {
    let (_buyer, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    assert!(
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert!(!p.poll_approval(deal.id, 1, 100).await.unwrap());
    assert!(
        p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    mock.approved.store(true, Ordering::SeqCst);
    assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    let receipt = p
        .capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    assert!(!receipt.is_empty());
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    // The latest money decision's authority is what the Deal projects.
    assert!(matches!(
        p.wallet.ledger.get_deal(deal.id).unwrap().decided_by,
        Some(DecidedBy::SellerMandate { .. })
    ));
    p.wallet.ledger.verify_transcript(deal.id).unwrap();
    p.wallet.ledger.verify_audit().unwrap();
    let calls = mock.calls.lock().unwrap();
    assert_eq!(
        calls
            .iter()
            .filter(|p| p.as_str() == "/v2/checkout/orders")
            .count(),
        1
    );
    assert_eq!(calls.iter().filter(|p| p.ends_with("/capture")).count(), 1);
    assert!(!calls.iter().any(|p| p.contains("update-pricing-schemes")));
}
#[tokio::test]
async fn h4_changed_paypal_truth_enters_mismatch_and_cannot_capture() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    mock.mismatch.store(true, Ordering::SeqCst);
    assert!(p.poll_approval(deal.id, 1, 100).await.is_err());
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Mismatch
    );
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
}
#[tokio::test]
async fn f3_w6_deadline_voids_once_and_lapse_never_calls_paypal() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    assert!(p.auto_void(deal.id, 1, 100 + 72 * 3600 - 1).await.is_err());
    let before = p.wallet.ledger.paypal_call_count(deal.id).unwrap();
    assert_eq!(p.tick(100 + 72 * 3600).await.unwrap(), vec![deal.id]);
    assert!(p.tick(100 + 72 * 3600).await.unwrap().is_empty());
    assert_eq!(
        p.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        before + 1
    );
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::AutoVoided
    );
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().decided_by,
        Some(DecidedBy::SafeDefault {
            deadline: 100 + 72 * 3600
        })
    );
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    let mut p = Pipeline::new(wallet, mock, 100).unwrap();
    p.wallet
        .ledger
        .set_deadline(deal.id, 101, None, 100)
        .unwrap();
    let before = p.wallet.ledger.audit_count().unwrap();
    p.tick(101).await.unwrap();
    p.tick(101).await.unwrap();
    assert_eq!(p.wallet.ledger.audit_count().unwrap(), before + 1);
    assert_eq!(p.wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().decided_by,
        Some(DecidedBy::SafeDefault { deadline: 101 })
    );
}
#[tokio::test]
async fn one_failing_void_does_not_starve_later_deadlines_in_pipeline_tick() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    let mut later = p.wallet.ledger.get_deal(deal.id).unwrap();
    later.id = "7ZZZZZZZZZZZZZZZZZZZZZZZZZ".parse().unwrap();
    later.state = DealState::Pairing;
    later.paypal = PaypalRefs::default();
    later.transcript_head = H256::ZERO;
    p.wallet.ledger.create_deal(&later, 100).unwrap();
    p.wallet
        .ledger
        .set_deadline(later.id, 101, None, 100)
        .unwrap();
    mock.void_unknown.store(true, Ordering::SeqCst);
    assert!(p.tick(100 + 72 * 3600).await.is_err());
    assert_eq!(
        p.wallet.ledger.get_deal(later.id).unwrap().state,
        DealState::Withdrawn
    );
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
}
#[derive(Debug)]
struct FakeReauth;
impl NativeReauth for FakeReauth {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
#[tokio::test]
async fn s2_held_authorization_voids_immediately_and_never_captures() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    p.apply_shield(deal.id, ShieldVerdict::Hold, 101)
        .await
        .unwrap();
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Voided
    );
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::Policy, 101)
            .await
            .is_err()
    );
    assert_eq!(
        mock.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|p| p.ends_with("/void"))
            .count(),
        1
    );
}
#[test]
fn purchase_proposal_persists_terms_and_has_zero_payment_calls() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    wallet
        .invoke(
            &AgentScope {
                deal_id: deal.id,
                role: AgentRole::Shopper,
                category: Category::Parts,
            },
            AgentRequest::Purchase(PurchaseInput {
                payee_ref: PayeeRef::new("merchant").unwrap(),
                items: vec![PurchaseLine {
                    item_ref: deal.terms.item_ref.clone(),
                    qty: 2,
                }],
                amount: "24.00".into(),
                category: Category::Parts,
            }),
            100,
        )
        .unwrap();
    assert_eq!(wallet.ledger.get_deal(deal.id).unwrap().terms.qty, 2);
    assert_eq!(wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
}
#[test]
fn f4_w3_w11_approval_label_token_idle_lock_and_os_reauth() {
    let mut auth = ApprovalSession::new(100).unwrap();
    let token = auth.token("approval").unwrap().to_owned();
    assert!(auth.token("main").is_err());
    assert!(auth.check("approval", &token, 100).is_err());
    assert!(
        auth.unlock("approval", &token, &ReauthUnavailable, 100)
            .is_err()
    );
    auth.unlock("approval", &token, &FakeReauth, 100).unwrap();
    assert!(auth.check("main", &token, 100).is_err());
    assert!(auth.check("tumbler", &token, 100).is_err());
    assert!(auth.check("approval", "bad", 100).is_err());
    auth.check("approval", &token, 999).unwrap();
    assert!(matches!(
        auth.check("approval", &token, 1899),
        Err(table_app::Error::Locked)
    ));
    auth.unlock("approval", &token, &FakeReauth, 1900).unwrap();
    auth.check("approval", &token, 1900).unwrap();
}
#[tokio::test]
async fn invalid_approval_link_records_evidence_and_cannot_be_opened_or_recreated() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    mock.bad_link.store(true, Ordering::SeqCst);
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    assert!(
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Mismatch
    );
    assert_eq!(p.wallet.ledger.paypal_call_count(deal.id).unwrap(), 1);
    assert!(
        p.create(deal.id, 2, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(mock.calls.lock().unwrap().len(), 1);
    p.wallet.ledger.verify_audit().unwrap();
}
/// Deal-to-settlement craft-2 (r3): the seller signs a SETTLE only for a link its buyer's
/// `validate_settle` would open. A link on PayPal's host that carries another order's token, or
/// an extra query pair, signs nothing and records no outbound envelope; the deal is a mismatch,
/// as for a link off PayPal's host. A link bound to the order still signs, and the buyer's check
/// accepts the very SETTLE that was signed.
#[tokio::test]
async fn the_seller_signs_no_settle_for_a_paypal_link_that_does_not_open_its_own_order() {
    for (href, signs) in [
        (
            "https://www.sandbox.paypal.com/checkoutnow?token=ORDER2",
            false,
        ),
        (
            "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1&next=x",
            false,
        ),
        (
            "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1",
            true,
        ),
    ] {
        let (_, seller, deal) = agreed();
        let mock = Arc::new(MockApi::default());
        *mock.link.lock().unwrap() = Some(href);
        let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
        let out = |p: &Pipeline| {
            p.wallet
                .ledger
                .envelope_count(deal.id, Direction::Outbound)
                .unwrap()
        };
        let before = out(&p);
        let created = p
            .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await;
        let state = p.wallet.ledger.get_deal(deal.id).unwrap().state;
        if signs {
            created.unwrap();
            assert_eq!(out(&p), before + 1, "{href}");
            assert_eq!(state, DealState::AwaitingApproval, "{href}");
            let Some((Direction::Outbound, body)) = p.wallet.ledger.last_message(deal.id).unwrap()
            else {
                panic!("{href}: no SETTLE sent");
            };
            assert!(matches!(body, Body::Settle { .. }), "{href}");
            validate_settle(&body, deal.id, &deal.terms, deal.mode).unwrap();
        } else {
            assert!(matches!(created, Err(table_app::Error::Invalid)), "{href}");
            assert_eq!(out(&p), before, "{href}: no SETTLE signed");
            assert_eq!(state, DealState::Mismatch, "{href}");
            // The buyer would have refused the same link, by the same rule.
            assert_eq!(
                order_approval_url(href, "ORDER1", deal.mode).map(|_| ()),
                Err(SettlementError::Order),
                "{href}"
            );
        }
        assert_eq!(p.wallet.ledger.paypal_call_count(deal.id).unwrap(), 1);
        p.wallet.ledger.verify_audit().unwrap();
    }
}
#[tokio::test]
async fn shield_ask_stops_policy_and_a_revoked_mandate_stops_the_seller_before_network() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    p.wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Ask, 101)
        .unwrap();
    let before = mock.calls.lock().unwrap().len();
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::Policy, 101)
            .await
            .is_err()
    );
    // ASK no longer stops the seller mandate's capture (H5); the matrix below pins that.
    assert_eq!(mock.calls.lock().unwrap().len(), before);
    p.wallet
        .ledger
        .revoke_mandate(deal.mandate_id, 101)
        .unwrap();
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 101)
            .await
            .is_err()
    );
    assert_eq!(mock.calls.lock().unwrap().len(), before);
}
#[tokio::test]
async fn wrong_attempt_cannot_poll_authorize_capture_or_void_an_existing_order() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    assert!(p.poll_approval(deal.id, 2, 100).await.is_err());
    assert_eq!(mock.calls.lock().unwrap().len(), 1);
    mock.approved.store(true, Ordering::SeqCst);
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    assert!(
        p.authorize(deal.id, 2, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert_eq!(mock.calls.lock().unwrap().len(), 2);
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    assert!(
        p.capture(deal.id, 2, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert!(p.auto_void(deal.id, 2, 100 + 72 * 3600).await.is_err());
    assert_eq!(mock.calls.lock().unwrap().len(), 3);
}
#[tokio::test]
async fn replay_mode_never_grants_payment_authority_or_runs_deadlines() {
    let (_, mut seller, original) = agreed();
    let mut deal = seller.ledger.get_deal(original.id).unwrap();
    deal.id = DealId("01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap());
    deal.mode = Mode::Replay;
    deal.state = DealState::Pairing;
    deal.transcript_head = H256::ZERO;
    seller.ledger.create_deal(&deal, 100).unwrap();
    for event in [
        DealEvent::ListingVerified,
        DealEvent::OfferVerified,
        DealEvent::TwoAcceptsVerified,
        DealEvent::BeginSettlement,
        DealEvent::SettleVerified,
        DealEvent::OrderApproved,
    ] {
        seller.ledger.apply_event(deal.id, event, 100).unwrap();
    }
    seller.ledger.set_deadline(deal.id, 101, None, 100).unwrap();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    let before = p.wallet.ledger.audit_count().unwrap();
    assert!(
        p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert!(p.tick(101).await.unwrap().is_empty());
    assert_eq!(p.wallet.ledger.audit_count().unwrap(), before);
    assert!(mock.calls.lock().unwrap().is_empty());
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Approved
    );
}

struct TestReauth;
impl NativeReauth for TestReauth {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
#[tokio::test]
async fn policy_authority_is_refused_above_clause_6_before_any_paypal_call() {
    let (_, mut seller, deal, owner) = agreed_owned();
    // The owner re-signs the seller's mandate with a human-present threshold below the amount.
    let mut payload = seller
        .ledger
        .active_mandate(deal.mandate_id, 1, &owner.public_key())
        .unwrap()
        .payload;
    payload.version = 2;
    for c in &mut payload.clauses {
        if let Clause::HumanPresentOver { amount } = c {
            *amount = Money::new(1000, Currency::USD).unwrap();
        }
    }
    let m = OpenMandate {
        owner_sig: owner.sign_payload(&payload).unwrap(),
        payload,
    };
    seller
        .ledger
        .insert_mandate(&m, &owner.public_key(), 100)
        .unwrap();
    seller.ledger.rebind_mandate(deal.id, 2, 100).unwrap();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval
        .unlock("approval", &token, &TestReauth, 100)
        .unwrap();
    let hash = p
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .terms
        .hash()
        .unwrap();
    let calls = |mock: &MockApi| mock.calls.lock().unwrap().len();
    let ticket = |p: &mut Pipeline| {
        p.approval
            .ticket("approval", &token, deal.id, hash, 1, 100)
            .unwrap()
    };
    assert!(matches!(
        p.wallet
            .check_mandate(deal.id, Category::Parts, 100)
            .unwrap(),
        MandateDecision::Ask { clause: 6 }
    ));

    // create: Policy refused, nothing sent, nothing countersigned.
    assert!(
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(calls(&mock), 0);
    assert!(!p.wallet.ledger.has_countersign(deal.id, 1).unwrap());
    assert_eq!(p.wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
    let t = ticket(&mut p);
    p.create(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    assert_eq!(calls(&mock), 1);
    assert!(p.wallet.ledger.has_countersign(deal.id, 1).unwrap());
    mock.approved.store(true, Ordering::SeqCst);
    assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());

    // authorize: Policy refused; the call count and countersign state do not move.
    let (before, signed) = (
        calls(&mock),
        p.wallet.ledger.has_countersign(deal.id, 1).unwrap(),
    );
    let paypal_before = p.wallet.ledger.paypal_call_count(deal.id).unwrap();
    assert!(
        p.authorize(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(calls(&mock), before);
    assert_eq!(
        p.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        paypal_before
    );
    assert_eq!(p.wallet.ledger.has_countersign(deal.id, 1).unwrap(), signed);
    let t = ticket(&mut p);
    p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    assert_eq!(calls(&mock), before + 1);

    // capture: Policy refused although the countersign row from the owner's create exists.
    let before = calls(&mock);
    let paypal_before = p.wallet.ledger.paypal_call_count(deal.id).unwrap();
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(calls(&mock), before);
    assert_eq!(
        p.wallet.ledger.paypal_call_count(deal.id).unwrap(),
        paypal_before
    );
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    let t = ticket(&mut p);
    p.capture(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    assert_eq!(calls(&mock), before + 1);
    let d = p.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.state, DealState::Receipted);
    assert!(matches!(d.decided_by, Some(DecidedBy::Human { .. })));
    p.wallet.ledger.verify_audit().unwrap();
}
fn propose_one(wallet: &mut Wallet, deal: &Deal) -> Result<serde_json::Value, table_app::Error> {
    wallet.invoke(
        &AgentScope {
            deal_id: deal.id,
            role: AgentRole::Shopper,
            category: Category::Parts,
        },
        AgentRequest::Purchase(PurchaseInput {
            payee_ref: PayeeRef::new("merchant").unwrap(),
            items: vec![PurchaseLine {
                item_ref: deal.terms.item_ref.clone(),
                qty: 1,
            }],
            amount: "12.00".into(),
            category: Category::Parts,
        }),
        100,
    )
}
#[test]
fn a_cleared_purchase_waits_at_agreed_with_zero_paypal_rows() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    let result = propose_one(&mut wallet, &deal).unwrap();
    assert_eq!(result["status"], "pending");
    assert_eq!(
        wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    assert_eq!(wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
}
#[test]
fn one_purchase_proposal_writes_exactly_one_audit_row_and_the_chain_verifies() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    propose_one(&mut wallet, &deal).unwrap();
    let (rows, _) = wallet.ledger.audit_page(None, 500).unwrap();
    let proposed = rows
        .iter()
        .filter(|r| r.action == "purchase.proposed" && r.deal_id == Some(deal.id))
        .count();
    assert_eq!(proposed, 1);
    wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn a_purchase_never_runs_on_policy_and_the_owner_path_captures_it() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    propose_one(&mut wallet, &deal).unwrap();
    assert!(matches!(
        wallet.check_mandate(deal.id, Category::Parts, 100).unwrap(),
        MandateDecision::Allow
    ));
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(wallet, mock.clone(), 100).unwrap();
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval
        .unlock("approval", &token, &TestReauth, 100)
        .unwrap();
    let hash = p
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .terms
        .hash()
        .unwrap();
    let calls = |mock: &MockApi| mock.calls.lock().unwrap().len();
    let ticket = |p: &mut Pipeline| {
        p.approval
            .ticket("approval", &token, deal.id, hash, 1, 100)
            .unwrap()
    };
    // Policy is refused for create, authorize and capture alike, before anything is recorded.
    for step in 0..3 {
        let result = match step {
            0 => p
                .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
                .await
                .map(|_| ()),
            1 => p
                .authorize(deal.id, 1, Category::Parts, Authority::Policy, 100)
                .await
                .map(|_| ()),
            _ => p
                .capture(deal.id, 1, Category::Parts, Authority::Policy, 100)
                .await
                .map(|_| ()),
        };
        assert!(
            matches!(result, Err(table_app::Error::Permission)),
            "step {step}"
        );
    }
    assert_eq!(calls(&mock), 0);
    assert_eq!(p.wallet.ledger.paypal_call_count(deal.id).unwrap(), 0);
    assert!(!p.wallet.ledger.has_countersign(deal.id, 1).unwrap());
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );

    let t = ticket(&mut p);
    p.create(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    mock.approved.store(true, Ordering::SeqCst);
    assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());
    let t = ticket(&mut p);
    p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    assert!(p.wallet.ledger.has_countersign(deal.id, 1).unwrap());
    let before = calls(&mock);
    let t = ticket(&mut p);
    p.capture(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    assert_eq!(calls(&mock), before + 1);
    let d = p.wallet.ledger.get_deal(deal.id).unwrap();
    assert!(matches!(
        d.state,
        DealState::Captured | DealState::Receipted
    ));
    assert!(matches!(d.decided_by, Some(DecidedBy::Human { .. })));
    p.wallet.ledger.verify_audit().unwrap();
}

/// The authority a shield-matrix cell names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Who {
    Policy,
    Human,
    House,
    Seller,
}
/// The shield gate the pipeline must apply, written out as the operator's H5 decision states it.
fn gate_table(verdict: ShieldVerdict, who: Who, step: MoneyStep) -> bool {
    // The seller mandate is granted only on an order the buyer approved: never at create.
    if who == Who::Seller && step == MoneyStep::Create {
        return false;
    }
    match verdict {
        ShieldVerdict::Clear => true,
        ShieldVerdict::Ask => match who {
            Who::Human | Who::House => true,
            Who::Seller => matches!(step, MoneyStep::Authorize | MoneyStep::Capture),
            Who::Policy => false,
        },
        ShieldVerdict::Hold | ShieldVerdict::Block => false,
    }
}
/// A seller deal at `step`'s entry state, reached at 100 on the owner's decisions with a clear
/// shield and then raised to `verdict`; the house release is installed so all four authorities
/// can be named.
async fn at_step(
    step: MoneyStep,
    verdict: ShieldVerdict,
) -> (Pipeline, Arc<MockApi>, DealId, String, H256) {
    let (_, seller, deal, owner) = agreed_owned();
    let mock = Arc::new(MockApi::default());
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    let mandate = p
        .wallet
        .ledger
        .active_mandate(deal.mandate_id, 1, &owner.public_key())
        .unwrap();
    let commitment = mandate.payload.hash().unwrap();
    let release = HouseRelease {
        owner_key: owner.public_key().to_bytes(),
        agent_key: p.wallet.agent_public_key().to_bytes(),
        payee: PayeeRef::new("merchant").unwrap(),
        mandate_commitment: commitment,
        owner_signature: owner.sign_commitment(commitment),
    };
    p.enable_house(release, &mandate).unwrap();
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval
        .unlock("approval", &token, &TestReauth, 100)
        .unwrap();
    let hash = p
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .terms
        .hash()
        .unwrap();
    if step != MoneyStep::Create {
        let t = p
            .approval
            .ticket("approval", &token, deal.id, hash, 1, 100)
            .unwrap();
        p.create(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
            .await
            .unwrap();
        mock.approved.store(true, Ordering::SeqCst);
        assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());
    }
    if step == MoneyStep::Capture {
        let t = p
            .approval
            .ticket("approval", &token, deal.id, hash, 1, 100)
            .unwrap();
        p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
            .await
            .unwrap();
    }
    if verdict != ShieldVerdict::Clear {
        p.wallet.ledger.raise_shield(deal.id, verdict, 100).unwrap();
    }
    (p, mock, deal.id, token, hash)
}
#[tokio::test]
async fn the_shield_gate_matrix_pins_h5_and_step_allowed_agrees_with_every_real_step() {
    let verdicts = [
        ShieldVerdict::Clear,
        ShieldVerdict::Ask,
        ShieldVerdict::Hold,
        ShieldVerdict::Block,
    ];
    let steps = [MoneyStep::Create, MoneyStep::Authorize, MoneyStep::Capture];
    for verdict in verdicts {
        for who in [Who::Policy, Who::Human, Who::House, Who::Seller] {
            for step in steps {
                let cell = format!("{verdict:?} x {who:?} x {step:?}");
                let (mut p, mock, id, token, hash) = at_step(step, verdict).await;
                let authority = |p: &mut Pipeline| match who {
                    Who::Policy => Authority::Policy,
                    Who::House => Authority::HouseMandate,
                    Who::Seller => Authority::SellerMandate,
                    Who::Human => Authority::Owner(
                        p.approval
                            .ticket("approval", &token, id, hash, 1, 100)
                            .unwrap(),
                    ),
                };
                // step_allowed cannot judge an owner ticket; everywhere else it must agree.
                let judged = (who != Who::Human).then(|| {
                    let a = authority(&mut p);
                    p.step_allowed(id, step, Category::Parts, a, 100, false)
                        .unwrap()
                });
                let (calls, rows, signed) = (
                    mock.calls.lock().unwrap().len(),
                    p.wallet.ledger.paypal_call_count(id).unwrap(),
                    p.wallet.ledger.has_countersign(id, 1).unwrap(),
                );
                let a = authority(&mut p);
                let ran = match step {
                    MoneyStep::Create => p.create(id, 1, Category::Parts, a, 100).await.map(|_| ()),
                    MoneyStep::Authorize => p.authorize(id, 1, Category::Parts, a, 100).await,
                    MoneyStep::Capture => {
                        p.capture(id, 1, Category::Parts, a, 100).await.map(|_| ())
                    }
                };
                assert_eq!(
                    ran.is_ok(),
                    gate_table(verdict, who, step),
                    "{cell}: {ran:?}"
                );
                if let Some(judged) = judged {
                    assert_eq!(judged, ran.is_ok(), "step_allowed disagrees at {cell}");
                }
                if ran.is_err() {
                    // A refusal moves nothing and calls nothing (its only writes are the
                    // shield's own record of it, shield slice 2).
                    assert!(matches!(ran, Err(table_app::Error::Permission)), "{cell}");
                    assert_eq!(mock.calls.lock().unwrap().len(), calls, "{cell}");
                    assert_eq!(
                        p.wallet.ledger.paypal_call_count(id).unwrap(),
                        rows,
                        "{cell}"
                    );
                    assert_eq!(p.wallet.ledger.has_countersign(id, 1).unwrap(), signed);
                } else if who == Who::Seller {
                    assert!(matches!(
                        p.wallet.ledger.get_deal(id).unwrap().decided_by,
                        Some(DecidedBy::SellerMandate { .. })
                    ));
                }
                p.wallet.ledger.verify_audit().unwrap();
            }
        }
    }
}
/// The `shield.refused` rows of a deal.
fn shield_refusals(p: &Pipeline, id: DealId) -> Vec<AuditRecord> {
    let (rows, _) = p.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.into_iter()
        .filter(|r| r.deal_id == Some(id) && r.action == "shield.refused")
        .collect()
}
#[tokio::test]
async fn a_shield_refusal_is_recorded_once_per_step_and_verdict_and_moves_nothing() {
    let (mut p, mock, id, _, _) = at_step(MoneyStep::Authorize, ShieldVerdict::Hold).await;
    let calls = mock.calls.lock().unwrap().len();
    let audit = p.wallet.ledger.audit_count().unwrap();
    for at in [100, 101, 102] {
        p.shield_refused = None;
        let refused = p
            .authorize(id, 1, Category::Parts, Authority::SellerMandate, at)
            .await;
        assert!(matches!(refused, Err(table_app::Error::Permission)));
        assert_eq!(p.shield_refused, Some(id), "the refusal is the shield's");
    }
    // One row for the three refusals (the raised HOLD was already on the deal); no operation,
    // no PayPal call and no `paypal_calls` row.
    assert_eq!(p.wallet.ledger.audit_count().unwrap(), audit + 1);
    let rows = shield_refusals(&p, id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].detail["step"], "authorize");
    assert_eq!(rows[0].detail["verdict"], "HOLD");
    assert_eq!(rows[0].detail["rule"], "model_caution");
    assert_eq!(mock.calls.lock().unwrap().len(), calls);
    assert!(!p.has_open_operation(id).unwrap());
    // A BLOCK is another verdict: one more row, and still nothing moves.
    p.wallet
        .ledger
        .raise_shield(id, ShieldVerdict::Block, 103)
        .unwrap();
    for at in [103, 104] {
        assert!(
            p.authorize(id, 1, Category::Parts, Authority::SellerMandate, at)
                .await
                .is_err()
        );
    }
    assert_eq!(shield_refusals(&p, id).len(), 2);
    assert_eq!(mock.calls.lock().unwrap().len(), calls);
    p.wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn a_step_refused_before_the_shield_is_not_recorded_as_the_shields() {
    let (mut p, mock, id, _, _) = at_step(MoneyStep::Create, ShieldVerdict::Hold).await;
    p.wallet
        .ledger
        .revoke_mandate(p.wallet.ledger.get_deal(id).unwrap().mandate_id, 100)
        .unwrap();
    p.shield_refused = None;
    assert!(
        p.create(id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(p.shield_refused, None);
    assert!(shield_refusals(&p, id).is_empty());
    assert!(mock.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn a_price_hold_is_recorded_with_its_rule_and_the_release_is_the_owners_for_those_terms() {
    let (mut p, mock, id, token, hash) = at_step(MoneyStep::Authorize, ShieldVerdict::Clear).await;
    // A fresh market reference at half the price: over 1.4 x the median.
    let price = p.wallet.ledger.get_deal(id).unwrap().terms.unit_price;
    let market = MarketRef::from_comparables(
        vec![Money::new(price.minor() / 2, price.currency()).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    p.wallet
        .ledger
        .store_market_reference(id, &market, 100)
        .unwrap();
    let calls = mock.calls.lock().unwrap().len();
    assert!(
        p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    // The production writer: the verdict and its rule on the deal, the pause in the audit log.
    let held = p.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(held.shield, Some(ShieldVerdict::Hold));
    assert_eq!(held.shield_rule, Some(ShieldRule::PriceOverMarket));
    assert!(held.shield_held());
    assert_eq!(
        shield_refusals(&p, id)[0].detail["rule"],
        "price_over_market"
    );
    // The owner releases it in the approval window: recorded as the owner's decision.
    let ticket = p
        .approval
        .ticket("approval", &token, id, hash, 1, 100)
        .unwrap();
    p.owner_release_hold(id, 1, ticket, 100).unwrap();
    let released = p.wallet.ledger.get_deal(id).unwrap();
    // The hold stays recorded; released for these terms it reads ASK, with the release beside it.
    assert_eq!(released.shield, Some(ShieldVerdict::Ask));
    assert_eq!(released.shield_recorded(), Some(ShieldVerdict::Hold));
    assert!(released.shield_released() && !released.shield_held());
    assert_eq!(released.decided_by, Some(DecidedBy::Human { at: 100 }));
    let release = released.shield_release.clone().unwrap();
    assert_eq!(release.terms_hash, hash);
    assert_eq!(release.rules, [ShieldRule::PriceOverMarket]);
    let gate = p.shield_gate(&released, 100).unwrap();
    assert!(gate.released);
    assert_eq!(gate.gating(), ShieldVerdict::Ask);
    // Released, it reads as ASK: a clause-6 policy step still waits for the owner ...
    p.shield_refused = None;
    assert!(
        p.authorize(id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(p.shield_refused, Some(id));
    assert_eq!(mock.calls.lock().unwrap().len(), calls);
    // ... while the buyer's approved order comes in under the seller mandate.
    p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 101)
        .await
        .unwrap();
    assert_eq!(
        p.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Authorized
    );
    p.wallet.ledger.verify_audit().unwrap();
}
#[tokio::test]
async fn a_released_second_opinion_hold_is_no_silent_ask_and_a_block_has_no_release() {
    let (mut p, mock, id, token, hash) = at_step(MoneyStep::Authorize, ShieldVerdict::Hold).await;
    let ticket = |p: &mut Pipeline| {
        p.approval
            .ticket("approval", &token, id, hash, 1, 100)
            .unwrap()
    };
    let calls = mock.calls.lock().unwrap().len();
    // Without the owner's release the seller mandate cannot take the money in.
    assert!(
        p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    let t = ticket(&mut p);
    p.owner_release_hold(id, 1, t, 100).unwrap();
    // A new second opinion raising the hold again is new information: the release is dropped
    // and the seller mandate is refused again, until the owner releases this one too.
    p.wallet
        .ledger
        .raise_shield(id, ShieldVerdict::Hold, 100)
        .unwrap();
    assert!(p.wallet.ledger.get_deal(id).unwrap().shield_held());
    assert!(
        p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert_eq!(mock.calls.lock().unwrap().len(), calls);
    let t = ticket(&mut p);
    p.owner_release_hold(id, 1, t, 100).unwrap();
    p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();

    // A released second opinion, then the rules hold the price: the deal shows a hold naming
    // the price rule (the release does not hide it), until the owner releases that one too.
    let (mut p, mock, id, token, hash) = at_step(MoneyStep::Authorize, ShieldVerdict::Hold).await;
    let t = p
        .approval
        .ticket("approval", &token, id, hash, 1, 100)
        .unwrap();
    p.owner_release_hold(id, 1, t, 100).unwrap();
    assert!(!p.wallet.ledger.get_deal(id).unwrap().shield_held());
    let price = p.wallet.ledger.get_deal(id).unwrap().terms.unit_price;
    let market = MarketRef::from_comparables(
        vec![Money::new(price.minor() / 2, price.currency()).unwrap()],
        100,
        H256::ZERO,
    )
    .unwrap();
    p.wallet
        .ledger
        .store_market_reference(id, &market, 100)
        .unwrap();
    let calls = mock.calls.lock().unwrap().len();
    for at in [101, 102] {
        assert!(
            p.authorize(id, 1, Category::Parts, Authority::SellerMandate, at)
                .await
                .is_err()
        );
    }
    let held = p.wallet.ledger.get_deal(id).unwrap();
    assert!(held.shield_held());
    assert_eq!(held.shield, Some(ShieldVerdict::Hold));
    assert_eq!(held.shield_rule, Some(ShieldRule::PriceOverMarket));
    let refused = shield_refusals(&p, id);
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].detail["rule"], "price_over_market");
    assert_eq!(mock.calls.lock().unwrap().len(), calls);
    let t = p
        .approval
        .ticket("approval", &token, id, hash, 1, 103)
        .unwrap();
    p.owner_release_hold(id, 1, t, 103).unwrap();
    let released = p.wallet.ledger.get_deal(id).unwrap();
    assert!(!released.shield_held());
    p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 103)
        .await
        .unwrap();

    // A BLOCK has no release.
    let (mut p, mock, id, token, hash) = at_step(MoneyStep::Authorize, ShieldVerdict::Block).await;
    let t = p
        .approval
        .ticket("approval", &token, id, hash, 1, 100)
        .unwrap();
    assert!(matches!(
        p.owner_release_hold(id, 1, t, 100),
        Err(table_app::Error::Permission)
    ));
    assert_eq!(p.wallet.ledger.get_deal(id).unwrap().shield_release, None);
    assert!(
        p.authorize(id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert!(
        mock.calls
            .lock()
            .unwrap()
            .iter()
            .all(|c| !c.ends_with("/authorize"))
    );
}

/// Where the wire loses the one answer a [`LossyApi`] drops: before PayPal commits the call,
/// or after it committed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Loss {
    Before,
    After,
}
/// PayPal's side of one deal: the order, the buyer's approval, the authorization, and every
/// mutating answer by PayPal-Request-Id.
#[derive(Debug, Default)]
struct PaypalTruth {
    expected: Option<CreateOrder>,
    created: bool,
    approved: bool,
    /// CREATED, CAPTURED or VOIDED once authorized.
    authorization: Option<&'static str>,
    /// The first answer to each request id: a repeat returns it and commits nothing.
    first: std::collections::HashMap<String, Result<serde_json::Value, u16>>,
    /// Mutating calls PayPal committed, per request id.
    commits: std::collections::BTreeMap<String, usize>,
    /// Every call that reached PayPal: `POST <path>` or `GET <path>`.
    calls: Vec<String>,
}
impl PaypalTruth {
    fn amount(&self) -> serde_json::Value {
        self.expected.as_ref().unwrap().body().unwrap()["purchase_units"][0]["amount"].clone()
    }
    fn order(&self) -> serde_json::Value {
        let mut body = self.expected.as_ref().unwrap().body().unwrap();
        body["id"] = json!("ORDER1");
        body["status"] = json!(match (self.authorization, self.approved) {
            (Some(_), _) => "COMPLETED",
            (None, true) => "APPROVED",
            (None, false) => "CREATED",
        });
        body["links"] = json!([{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"}]);
        if let Some(status) = self.authorization {
            let amount = self.amount();
            body["purchase_units"][0]["payments"] =
                json!({"authorizations":[{"id":"AUTH1","status":status,"amount":amount}]});
            if status == "CAPTURED" {
                body["purchase_units"][0]["payments"]["captures"] =
                    json!([{"id":"CAPTURE1","status":"COMPLETED","amount":amount}]);
            }
        }
        body
    }
}
/// The offline PayPal of the T10 chaos matrix. It models PayPal-Request-Id idempotency (a
/// repeated request id returns the first result, .research/paypal-platform.md:77) and drops
/// exactly one answer: the first call of the named operation, before or after PayPal commits.
#[derive(Debug, Default)]
struct LossyApi {
    truth: Mutex<PaypalTruth>,
    loss: Mutex<Option<(&'static str, Loss)>>,
}
impl LossyApi {
    fn losing(operation: &'static str, loss: Loss) -> Arc<Self> {
        let api = Arc::new(Self::default());
        *api.loss.lock().unwrap() = Some((operation, loss));
        api
    }
    fn lost() -> table_paypal::Error {
        table_paypal::Error::Unknown {
            observations: vec![],
        }
    }
    fn refused(status: u16) -> table_paypal::Error {
        table_paypal::Error::Api {
            status,
            debug_id: None,
            observations: vec![],
        }
    }
    fn observed<T: serde::de::DeserializeOwned>(
        value: serde_json::Value,
        method: &'static str,
        path: &str,
        request: Option<&RequestId>,
    ) -> ApiResponse<T> {
        ApiResponse {
            value: serde_json::from_value(value.clone()).unwrap(),
            observations: vec![Observation {
                method,
                path: path.into(),
                request_id: request.map_or_else(String::new, |r| r.as_str().into()),
                status: 200,
                body: value,
                binding: None,
            }],
        }
    }
    /// One mutating call: it reaches PayPal, commits once per request id, and its answer may
    /// be lost on the way back.
    fn mutate(
        &self,
        operation: &'static str,
        path: &str,
        request: &RequestId,
        commit: impl FnOnce(&mut PaypalTruth) -> Result<serde_json::Value, u16>,
    ) -> Result<serde_json::Value, table_paypal::Error> {
        let loss = {
            let mut loss = self.loss.lock().unwrap();
            match *loss {
                Some((o, l)) if o == operation => {
                    *loss = None;
                    Some(l)
                }
                _ => None,
            }
        };
        if loss == Some(Loss::Before) {
            return Err(Self::lost());
        }
        let mut truth = self.truth.lock().unwrap();
        truth.calls.push(format!("POST {path}"));
        let answer = match truth.first.get(request.as_str()) {
            Some(first) => first.clone(),
            None => {
                let answer = commit(&mut truth);
                if answer.is_ok() {
                    *truth.commits.entry(request.as_str().into()).or_default() += 1;
                }
                truth.first.insert(request.as_str().into(), answer.clone());
                answer
            }
        };
        if loss == Some(Loss::After) {
            return Err(Self::lost());
        }
        answer.map_err(Self::refused)
    }
    fn approve(&self) {
        self.truth.lock().unwrap().approved = true;
    }
    fn calls(&self, suffix: &str) -> usize {
        let truth = self.truth.lock().unwrap();
        truth.calls.iter().filter(|c| c.ends_with(suffix)).count()
    }
    fn commits(&self) -> std::collections::BTreeMap<String, usize> {
        self.truth.lock().unwrap().commits.clone()
    }
}
#[async_trait]
impl PayPalApi for LossyApi {
    async fn create_order(
        &self,
        o: &CreateOrder,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let path = "/v2/checkout/orders";
        let value = self.mutate("create", path, id, |t| {
            t.expected = Some(o.clone());
            t.created = true;
            Ok(t.order())
        })?;
        Ok(Self::observed(value, "POST", path, Some(id)))
    }
    async fn get_order(&self, _: &ResourceId) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let path = "/v2/checkout/orders/ORDER1";
        let mut truth = self.truth.lock().unwrap();
        truth.calls.push(format!("GET {path}"));
        if !truth.created {
            return Err(Self::refused(404));
        }
        Ok(Self::observed(truth.order(), "GET", path, None))
    }
    async fn authorize(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, table_paypal::Error> {
        let path = "/v2/checkout/orders/ORDER1/authorize";
        let value = self.mutate("authorize", path, id, |t| {
            if !t.approved || t.authorization.is_some() {
                return Err(422);
            }
            t.authorization = Some("CREATED");
            Ok(t.order())
        })?;
        Ok(Self::observed(value, "POST", path, Some(id)))
    }
    async fn capture(
        &self,
        _: &ResourceId,
        _: Money,
        id: &RequestId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        let path = "/v2/payments/authorizations/AUTH1/capture";
        let value = self.mutate("capture", path, id, |t| {
            if t.authorization != Some("CREATED") {
                return Err(422);
            }
            t.authorization = Some("CAPTURED");
            Ok(json!({"id":"CAPTURE1","status":"COMPLETED","amount":t.amount()}))
        })?;
        Ok(Self::observed(value, "POST", path, Some(id)))
    }
    async fn void(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<()>, table_paypal::Error> {
        let path = "/v2/payments/authorizations/AUTH1/void";
        // "You cannot void an authorized payment that has been fully captured."
        self.mutate("void", path, id, |t| {
            if t.authorization != Some("CREATED") {
                return Err(422);
            }
            t.authorization = Some("VOIDED");
            Ok(serde_json::Value::Null)
        })?;
        Ok(Self::observed(
            serde_json::Value::Null,
            "POST",
            path,
            Some(id),
        ))
    }
    async fn get_authorization(
        &self,
        _: &ResourceId,
    ) -> Result<ApiResponse<Payment>, table_paypal::Error> {
        let path = "/v2/payments/authorizations/AUTH1";
        let mut truth = self.truth.lock().unwrap();
        truth.calls.push(format!("GET {path}"));
        let Some(status) = truth.authorization else {
            return Err(Self::refused(404));
        };
        let value = json!({"id":"AUTH1","status":status,"amount":truth.amount()});
        Ok(Self::observed(value, "GET", path, None))
    }
}
/// The deal's `money.resolved` audit details, oldest first.
fn resolved_rows(p: &Pipeline, id: DealId) -> Vec<serde_json::Value> {
    let (rows, _) = p.wallet.ledger.audit_page(None, u16::MAX).unwrap();
    let mut rows: Vec<_> = rows
        .into_iter()
        .filter(|r| r.deal_id == Some(id) && r.action == "money.resolved")
        .map(|r| r.detail)
        .collect();
    rows.reverse();
    rows
}
/// The request ids a deal ever reserved, as its `money.authorized` audit rows name them.
fn reserved_request_ids(p: &Pipeline, id: DealId) -> Vec<String> {
    let (rows, _) = p.wallet.ledger.audit_page(None, u16::MAX).unwrap();
    let mut ids: Vec<_> = rows
        .into_iter()
        .filter(|r| r.deal_id == Some(id) && r.action == "money.authorized")
        .map(|r| r.detail["request_id"].as_str().unwrap().to_owned())
        .collect();
    ids.sort();
    ids
}
/// A seller deal settled up to AUTHORIZED on the lossy PayPal.
async fn authorized_on(api: &Arc<LossyApi>) -> (Pipeline, Deal) {
    let (_, seller, deal) = agreed();
    let mut p = Pipeline::new(seller, api.clone(), 100).unwrap();
    p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
        .await
        .unwrap();
    api.approve();
    p.poll_approval(deal.id, 1, 100).await.unwrap();
    p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
        .await
        .unwrap();
    (p, deal)
}

/// T10 chaos matrix: create, authorize, capture and void, each with its answer lost before or
/// after PayPal commits. Every deal ends in the state PayPal's truth gives it, no
/// PayPal-Request-Id is committed twice, and no second request id is ever reserved.
#[tokio::test]
async fn lost_answers_resolve_to_paypal_truth_with_one_commit_per_request_id() {
    // Each lost answer is read back after SETTLE_SECS (10 s on).
    let after = 140 + 72 * 3600 + 20;
    let mut report = Vec::new();
    for operation in ["create", "authorize", "capture", "void"] {
        for loss in [Loss::Before, Loss::After] {
            let case = format!("{operation} lost {loss:?}");
            let (_, seller, deal) = agreed();
            let api = LossyApi::losing(operation, loss);
            let mut p = Pipeline::new(seller, api.clone(), 100).unwrap();
            let state = |p: &Pipeline| p.wallet.ledger.get_deal(deal.id).unwrap().state;
            let advance = Resolve::Advance(Category::Parts);

            let created = p
                .create(deal.id, 1, Category::Parts, Authority::Policy, 100)
                .await;
            if operation == "create" {
                assert!(created.is_err(), "{case}");
                assert_eq!(state(&p), DealState::Settling, "{case}");
                assert!(
                    p.resolve_deal(deal.id, advance, 110).await.unwrap(),
                    "{case}"
                );
            }
            assert_eq!(state(&p), DealState::AwaitingApproval, "{case}");
            api.approve();
            assert!(p.poll_approval(deal.id, 1, 110).await.unwrap(), "{case}");
            let authorized = p
                .authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, 110)
                .await;
            if operation == "authorize" {
                assert!(authorized.is_err(), "{case}");
                assert_eq!(state(&p), DealState::Approved, "{case}");
                assert!(
                    p.resolve_deal(deal.id, advance, 120).await.unwrap(),
                    "{case}"
                );
            }
            assert_eq!(state(&p), DealState::Authorized, "{case}");
            let steps = if operation == "void" {
                // The deadline's safe default: its answer is lost, and the next tick settles it.
                let due = p.wallet.ledger.deadline(deal.id).unwrap().unwrap().0;
                assert!(p.tick(due).await.is_err(), "{case}");
                assert_eq!(state(&p), DealState::Authorized, "{case}");
                assert_eq!(p.tick(due + 10).await.unwrap(), vec![deal.id], "{case}");
                assert_eq!(state(&p), DealState::AutoVoided, "{case}");
                assert_eq!(
                    p.wallet.ledger.get_deal(deal.id).unwrap().decided_by,
                    Some(DecidedBy::SafeDefault { deadline: due }),
                    "{case}"
                );
                assert_eq!(api.calls("/capture"), 0, "{case}");
                ["create", "authorize", "void"]
            } else {
                let captured = p
                    .capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 120)
                    .await;
                if operation == "capture" {
                    assert!(captured.is_err(), "{case}");
                    assert_eq!(state(&p), DealState::Authorized, "{case}");
                    assert!(
                        p.resolve_deal(deal.id, advance, 130).await.unwrap(),
                        "{case}"
                    );
                }
                assert_eq!(state(&p), DealState::Receipted, "{case}");
                assert_eq!(api.calls("/void"), 0, "{case}");
                let d = p.wallet.ledger.get_deal(deal.id).unwrap();
                assert_eq!(d.paypal.capture.as_deref(), Some("CAPTURE1"), "{case}");
                assert!(
                    matches!(d.decided_by, Some(DecidedBy::SellerMandate { .. })),
                    "{case}"
                );
                assert_eq!(
                    p.wallet.ledger.deal_evidence(deal.id).unwrap().receipt,
                    ReceiptEvidence::PaypalVerified,
                    "{case}"
                );
                ["create", "authorize", "capture"]
            };
            // Exactly one committed mutating call per request id, and only the canonical ids.
            let canonical: std::collections::BTreeMap<String, usize> = steps
                .iter()
                .map(|s| {
                    let id = RequestId::for_operation(deal.id, 1, s).unwrap();
                    (id.as_str().to_owned(), 1)
                })
                .collect();
            assert_eq!(api.commits(), canonical, "{case}");
            assert_eq!(
                reserved_request_ids(&p, deal.id),
                canonical.keys().cloned().collect::<Vec<_>>(),
                "{case}: no second request id"
            );
            assert_eq!(
                p.wallet.ledger.operation_count(deal.id).unwrap(),
                3,
                "{case}"
            );
            // The lost operation was settled by the resolver, and nothing is left open.
            let resolved = resolved_rows(&p, deal.id);
            let outcomes: Vec<_> = resolved
                .iter()
                .map(|r| r["outcome"].as_str().unwrap().to_owned())
                .collect();
            let expected: &[&str] = match loss {
                Loss::After if operation != "create" => &["confirmed"],
                _ => &["resent", "confirmed"],
            };
            assert_eq!(outcomes, expected, "{case}");
            assert!(
                resolved.iter().all(|r| r["operation"] == operation),
                "{case}"
            );
            assert!(p.open_operations(None, after).unwrap().is_empty(), "{case}");
            p.wallet.ledger.verify_audit().unwrap();
            report.push(format!(
                "{case}: end={:?} commits={:?}",
                state(&p),
                api.commits().values().collect::<Vec<_>>()
            ));
        }
    }
    println!("{}", report.join("\n"));
}

/// A capture whose answer was lost after PayPal captured, then its deadline: the deadline reads
/// the authorization back, confirms the capture and sends no void.
#[tokio::test]
async fn lost_capture_then_deadline_confirms_the_capture_and_never_voids() {
    let api = LossyApi::losing("capture", Loss::After);
    let (mut p, deal) = authorized_on(&api).await;
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    let due = 100 + 72 * 3600;
    assert_eq!(p.tick(due).await.unwrap(), vec![deal.id]);
    let d = p.wallet.ledger.get_deal(deal.id).unwrap();
    assert!(matches!(
        d.state,
        DealState::Captured | DealState::Receipted
    ));
    assert_eq!(api.calls("/void"), 0);
    assert_eq!(api.calls("/capture"), 1);
    // The capture is settled on the authority it was sent under, not on a safe default.
    assert!(matches!(
        d.decided_by,
        Some(DecidedBy::SellerMandate { .. })
    ));
    assert!(p.tick(due + 1).await.unwrap().is_empty());
    assert_eq!(api.calls("/void"), 0);
    p.wallet.ledger.verify_audit().unwrap();
}

/// The same capture lost before PayPal saw it, then the deadline: the capture is given up (it
/// is never sent after the deadline) and the safe default voids the hold.
#[tokio::test]
async fn uncommitted_capture_at_the_deadline_is_given_up_and_voided() {
    let api = LossyApi::losing("capture", Loss::Before);
    let (mut p, deal) = authorized_on(&api).await;
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    assert_eq!(p.tick(100 + 72 * 3600).await.unwrap(), vec![deal.id]);
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::AutoVoided
    );
    assert_eq!(api.calls("/capture"), 0);
    assert_eq!(api.calls("/void"), 1);
    let outcomes: Vec<_> = resolved_rows(&p, deal.id)
        .into_iter()
        .map(|r| (r["operation"].clone(), r["outcome"].clone()))
        .collect();
    assert_eq!(outcomes, vec![(json!("capture"), json!("absent"))]);
    p.wallet.ledger.verify_audit().unwrap();
}

/// A deadline whose read-back fails sends no void: the hold stays, the failure is recorded once,
/// and the next tick tries again.
#[tokio::test]
async fn failed_read_back_at_the_deadline_skips_the_void_and_retries_next_tick() {
    let api = LossyApi::losing("capture", Loss::After);
    let (mut p, deal) = authorized_on(&api).await;
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::SellerMandate, 100)
            .await
            .is_err()
    );
    // PayPal's reads fail: neither the order nor the authorization can be found.
    let held = {
        let mut truth = api.truth.lock().unwrap();
        truth.created = false;
        truth.authorization.take()
    };
    let due = 100 + 72 * 3600;
    for at in [due, due + 1] {
        assert!(matches!(
            p.tick(at).await,
            Err(table_app::Error::Unavailable)
        ));
        assert_eq!(
            p.wallet.ledger.get_deal(deal.id).unwrap().state,
            DealState::Authorized
        );
    }
    assert_eq!(api.calls("/void"), 0);
    let outcomes: Vec<_> = resolved_rows(&p, deal.id)
        .into_iter()
        .map(|r| r["outcome"].clone())
        .collect();
    assert_eq!(outcomes, vec![json!("deferred")]);
    // PayPal answers again: the capture it committed is confirmed, still with no void.
    {
        let mut truth = api.truth.lock().unwrap();
        truth.created = true;
        truth.authorization = held;
    }
    p.tick(due + 2).await.unwrap();
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    assert_eq!(api.calls("/void"), 0);
    p.wallet.ledger.verify_audit().unwrap();
}

/// An owner-decided capture whose answer was lost: an owner ticket authorizes one step for 60
/// seconds, so nothing is sent again; one audit row asks the owner, and it is not retried.
#[tokio::test]
async fn human_authority_unknown_capture_is_parked_for_the_owner_and_never_resent() {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    propose_one(&mut wallet, &deal).unwrap();
    let api = LossyApi::losing("capture", Loss::Before);
    let mut p = Pipeline::new(wallet, api.clone(), 100).unwrap();
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval
        .unlock("approval", &token, &TestReauth, 100)
        .unwrap();
    let hash = p
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .terms
        .hash()
        .unwrap();
    let ticket = |p: &mut Pipeline| {
        p.approval
            .ticket("approval", &token, deal.id, hash, 1, 100)
            .unwrap()
    };
    let t = ticket(&mut p);
    p.create(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    api.approve();
    assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());
    let t = ticket(&mut p);
    p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    let t = ticket(&mut p);
    assert!(
        p.capture(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
            .await
            .is_err()
    );
    for at in [101, 102, 200] {
        assert!(
            !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), at)
                .await
                .unwrap()
        );
    }
    // Nothing re-sent: the lost capture never reached PayPal, and no second one did.
    assert_eq!(api.calls("/capture"), 0);
    assert_eq!(api.calls("GET /v2/payments/authorizations/AUTH1"), 1);
    let resolved = resolved_rows(&p, deal.id);
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0]["outcome"], "needs_owner");
    assert_eq!(resolved[0]["operation"], "capture");
    assert_eq!(resolved[0]["observed"], "CREATED");
    assert_eq!(resolved[0]["decided_by"]["type"], "human");
    let open = p.open_operations(Some(deal.id), 200).unwrap();
    assert_eq!(open.len(), 1);
    assert!(open[0].needs_owner);
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    assert_eq!(reserved_request_ids(&p, deal.id).len(), 3);
    p.wallet.ledger.verify_audit().unwrap();
}

/// T10 rule: an unknown create is never recreated under a new attempt or request id; it is
/// resolved by re-sending the original request, which PayPal answers with the first order.
#[tokio::test]
async fn unknown_money_outcome_is_reserved_and_never_recreated() {
    let (_, seller, deal) = agreed();
    let api = LossyApi::losing("create", Loss::After);
    let mut p = Pipeline::new(seller, api.clone(), 100).unwrap();
    assert!(
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    // Never recreated: a new attempt is refused before any network call or reservation.
    assert!(
        p.create(deal.id, 2, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(api.calls("POST /v2/checkout/orders"), 1);
    let create = RequestId::for_operation(deal.id, 1, "create").unwrap();
    assert_eq!(
        reserved_request_ids(&p, deal.id),
        vec![create.as_str().to_owned()]
    );
    // The resolver re-sends the original request id; PayPal answers with the first order.
    assert!(
        !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 101)
            .await
            .unwrap()
    );
    assert_eq!(
        api.calls("POST /v2/checkout/orders"),
        1,
        "read back only once settled"
    );
    assert!(
        p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
            .await
            .unwrap()
    );
    assert_eq!(api.calls("POST /v2/checkout/orders"), 2);
    assert_eq!(
        api.commits(),
        [(create.as_str().to_owned(), 1)].into_iter().collect()
    );
    assert_eq!(
        reserved_request_ids(&p, deal.id),
        vec![create.as_str().to_owned()]
    );
    let d = p.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(d.state, DealState::AwaitingApproval);
    assert_eq!(d.paypal.order.as_deref(), Some("ORDER1"));
    // The approval window is counted from the first attempt.
    assert_eq!(
        p.wallet.ledger.deadline(deal.id).unwrap().unwrap().0,
        100 + 6 * 3600
    );
    p.wallet.ledger.verify_audit().unwrap();
}

/// A buyer purchase the owner settles from the approval window, up to APPROVED on the lossy
/// PayPal, and the approval token that issues the owner's tickets (all at 100).
async fn owner_approved_on(api: &Arc<LossyApi>) -> (Pipeline, Deal, String) {
    let (mut wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Purchase);
    propose_one(&mut wallet, &deal).unwrap();
    let mut p = Pipeline::new(wallet, api.clone(), 100).unwrap();
    let token = p.approval.token("approval").unwrap().to_owned();
    p.approval
        .unlock("approval", &token, &TestReauth, 100)
        .unwrap();
    let t = owner_ticket(&mut p, &deal, &token);
    p.create(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    api.approve();
    assert!(p.poll_approval(deal.id, 1, 100).await.unwrap());
    (p, deal, token)
}
/// A fresh owner decision on the deal's terms, at 100.
fn owner_ticket(p: &mut Pipeline, deal: &Deal, token: &str) -> OwnerTicket {
    let hash = p
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .terms
        .hash()
        .unwrap();
    p.approval
        .ticket("approval", token, deal.id, hash, 1, 100)
        .unwrap()
}
/// What PayPal's double holds for the deal's authorization now.
fn paypal_hold(api: &LossyApi) -> Option<&'static str> {
    api.truth.lock().unwrap().authorization
}
/// The council's oracle for one deal at its end: every request id reserved is its operation's
/// own (never a second one for any operation), PayPal committed each at most once, nothing is
/// left open, and the audit chain holds.
fn assert_one_request_id_per_operation(p: &Pipeline, api: &LossyApi, id: DealId, case: &str) {
    let own: Vec<_> = ["create", "authorize", "capture", "void"]
        .iter()
        .map(|o| {
            RequestId::for_operation(id, 1, o)
                .unwrap()
                .as_str()
                .to_owned()
        })
        .collect();
    let reserved = reserved_request_ids(p, id);
    assert!(reserved.iter().all(|r| own.contains(r)), "{case}");
    let mut once = reserved.clone();
    once.dedup();
    assert_eq!(once, reserved, "{case}: no operation reserved twice");
    let commits = api.commits();
    assert!(
        commits.iter().all(|(r, n)| *n == 1 && reserved.contains(r)),
        "{case}: {commits:?}"
    );
    assert!(
        p.open_operations(Some(id), i64::MAX).unwrap().is_empty(),
        "{case}"
    );
    p.wallet.ledger.verify_audit().unwrap();
}
/// The outcomes the resolver recorded for one operation of the deal, oldest first.
fn outcomes_of(p: &Pipeline, id: DealId, operation: &str) -> Vec<String> {
    resolved_rows(p, id)
        .into_iter()
        .filter(|r| r["operation"] == operation)
        .map(|r| r["outcome"].as_str().unwrap().to_owned())
        .collect()
}

/// Deal-to-settlement robustness-1, capture: an owner's capture whose answer was lost is parked
/// (no ticket is reused), and at the deadline it is read back instead of skipped. PayPal still
/// holding the money: the capture is recorded absent and the hold voided once, under the void's
/// own request id, on the safe default. PayPal showing the capture committed: it is recorded as
/// PayPal's truth and no void is sent. The deadline never sends a capture.
#[tokio::test]
async fn parked_capture_at_the_deadline_settles_to_what_paypal_shows() {
    for paypal in ["CREATED", "CAPTURED"] {
        let case = format!("parked capture, PayPal shows {paypal}");
        let api = LossyApi::losing("capture", Loss::Before);
        let (mut p, deal, token) = owner_approved_on(&api).await;
        let t = owner_ticket(&mut p, &deal, &token);
        p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
            .await
            .unwrap();
        let t = owner_ticket(&mut p, &deal, &token);
        assert!(
            p.capture(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
                .await
                .is_err(),
            "{case}"
        );
        assert!(
            !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
                .await
                .unwrap(),
            "{case}"
        );
        assert_eq!(
            outcomes_of(&p, deal.id, "capture"),
            ["needs_owner"],
            "{case}"
        );
        // PayPal committed after the read that parked it (the read raced the commit).
        api.truth.lock().unwrap().authorization = Some(paypal);
        let due = 100 + 72 * 3600;
        assert_eq!(p.tick(due).await.unwrap(), vec![deal.id], "{case}");
        let d = p.wallet.ledger.get_deal(deal.id).unwrap();
        if paypal == "CREATED" {
            assert_eq!(d.state, DealState::AutoVoided, "{case}");
            assert_eq!(
                d.decided_by,
                Some(DecidedBy::SafeDefault { deadline: due }),
                "{case}"
            );
            assert_eq!(api.calls("/void"), 1, "{case}");
            assert_eq!(paypal_hold(&api), Some("VOIDED"), "{case}");
            assert_eq!(
                outcomes_of(&p, deal.id, "capture"),
                ["needs_owner", "absent"],
                "{case}"
            );
        } else {
            assert_eq!(d.state, DealState::Receipted, "{case}");
            assert_eq!(d.paypal.capture.as_deref(), Some("CAPTURE1"), "{case}");
            assert_eq!(api.calls("/void"), 0, "{case}");
            assert_eq!(paypal_hold(&api), Some("CAPTURED"), "{case}");
            assert_eq!(
                outcomes_of(&p, deal.id, "capture"),
                ["needs_owner", "confirmed"],
                "{case}"
            );
        }
        assert_eq!(api.calls("/capture"), 0, "{case}: no capture sent");
        assert!(p.tick(due + 1).await.unwrap().is_empty(), "{case}");
        assert_one_request_id_per_operation(&p, &api, deal.id, &case);
    }
}

/// Deal-to-settlement robustness-1 and -2, authorize: an owner's authorize whose answer was lost
/// is parked, and at the order's deadline it is read back instead of skipped. PayPal showing no
/// authorization: the step is recorded absent and the deal lapses. PayPal showing the hold: it is
/// recorded (the honor period counted from the first attempt), and its own deadline voids it
/// once on the safe default. The deal is never EXPIRED over a hold.
#[tokio::test]
async fn parked_authorize_at_the_deadline_lapses_or_is_voided_by_what_paypal_shows() {
    for held in [false, true] {
        let case = format!("parked authorize, PayPal holds: {held}");
        let api = LossyApi::losing("authorize", Loss::Before);
        let (mut p, deal, token) = owner_approved_on(&api).await;
        let t = owner_ticket(&mut p, &deal, &token);
        assert!(
            p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
                .await
                .is_err(),
            "{case}"
        );
        assert!(
            !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
                .await
                .unwrap(),
            "{case}"
        );
        assert_eq!(
            outcomes_of(&p, deal.id, "authorize"),
            ["needs_owner"],
            "{case}"
        );
        if held {
            // PayPal committed after the read that parked it.
            api.truth.lock().unwrap().authorization = Some("CREATED");
        }
        let due = 100 + ORDER_APPROVAL_SECS;
        assert_eq!(p.wallet.ledger.deadline(deal.id).unwrap().unwrap().0, due);
        assert_eq!(p.tick(due).await.unwrap(), vec![deal.id], "{case}");
        let d = p.wallet.ledger.get_deal(deal.id).unwrap();
        if held {
            assert_eq!(d.state, DealState::Authorized, "{case}");
            assert_eq!(
                outcomes_of(&p, deal.id, "authorize"),
                ["needs_owner", "confirmed"],
                "{case}"
            );
            let honor = 100 + 72 * 3600;
            assert_eq!(p.wallet.ledger.deadline(deal.id).unwrap().unwrap().0, honor);
            assert_eq!(p.tick(honor).await.unwrap(), vec![deal.id], "{case}");
            let d = p.wallet.ledger.get_deal(deal.id).unwrap();
            assert_eq!(d.state, DealState::AutoVoided, "{case}");
            assert_eq!(
                d.decided_by,
                Some(DecidedBy::SafeDefault { deadline: honor }),
                "{case}"
            );
            assert_eq!(api.calls("/void"), 1, "{case}");
            assert_eq!(paypal_hold(&api), Some("VOIDED"), "{case}");
        } else {
            assert_eq!(d.state, DealState::Expired, "{case}");
            assert_eq!(
                outcomes_of(&p, deal.id, "authorize"),
                ["needs_owner", "absent"],
                "{case}"
            );
            assert_eq!(api.calls("/void"), 0, "{case}");
            assert_eq!(paypal_hold(&api), None, "{case}");
        }
        assert_eq!(api.calls("/authorize"), 0, "{case}: nothing sent again");
        assert_eq!(api.calls("/capture"), 0, "{case}");
        assert_one_request_id_per_operation(&p, &api, deal.id, &case);
    }
}

/// Deal-to-settlement robustness-1, void: an owner's void whose answer was lost before PayPal saw
/// it is parked (its ticket is not reused). At the deadline the hold PayPal still shows is voided
/// by sending that same void once more, under its own request id: the safe default is its
/// authority, and no second void is reserved.
#[tokio::test]
async fn parked_void_at_the_deadline_goes_once_more_under_its_own_request_id() {
    let api = LossyApi::losing("void", Loss::Before);
    let (mut p, deal, token) = owner_approved_on(&api).await;
    let t = owner_ticket(&mut p, &deal, &token);
    p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
        .await
        .unwrap();
    let t = owner_ticket(&mut p, &deal, &token);
    assert!(p.owner_void(deal.id, 1, t, 100).await.is_err());
    assert!(
        !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
            .await
            .unwrap()
    );
    assert_eq!(outcomes_of(&p, deal.id, "void"), ["needs_owner"]);
    // Before the deadline a parked void waits for the owner.
    assert!(p.tick(200).await.unwrap().is_empty());
    assert_eq!(api.calls("/void"), 0);
    let due = 100 + 72 * 3600;
    assert_eq!(p.tick(due).await.unwrap(), vec![deal.id]);
    let d = p.wallet.ledger.get_deal(deal.id).unwrap();
    // The owner's void, completed: PayPal shows it voided, and the wallet says so.
    assert_eq!(d.state, DealState::Voided);
    assert_eq!(paypal_hold(&api), Some("VOIDED"));
    assert_eq!(api.calls("/void"), 1);
    assert_eq!(api.calls("/capture"), 0);
    assert_eq!(
        outcomes_of(&p, deal.id, "void"),
        ["needs_owner", "resent", "confirmed"]
    );
    let void = RequestId::for_operation(deal.id, 1, "void").unwrap();
    assert_eq!(api.commits().get(void.as_str()), Some(&1));
    assert!(p.tick(due + 1).await.unwrap().is_empty());
    assert_one_request_id_per_operation(&p, &api, deal.id, "parked void");
}

/// Deal-to-settlement robustness-2: at the order's deadline an authorize whose answer was lost
/// less than SETTLE_SECS ago, or a parked one PayPal cannot be read for, keeps the deal from
/// expiring. Once PayPal answers, the deal lapses (no authorization) or its hold is recorded and
/// voided at its own deadline; it is never EXPIRED while PayPal may hold money for it.
#[tokio::test]
async fn deadline_waits_for_an_unsettled_authorize_before_expiring() {
    for loss in [Loss::Before, Loss::After] {
        let case = format!("young authorize lost {loss:?}");
        let (_, seller, deal) = agreed();
        let api = LossyApi::losing("authorize", loss);
        let mut p = Pipeline::new(seller, api.clone(), 100).unwrap();
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .unwrap();
        api.approve();
        assert!(p.poll_approval(deal.id, 1, 100).await.unwrap(), "{case}");
        let due = 100 + ORDER_APPROVAL_SECS;
        let sent = due - 2;
        assert!(
            p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, sent)
                .await
                .is_err(),
            "{case}"
        );
        // Too young to read back: no read, no send, and no expiry.
        let gets = api.calls("GET /v2/checkout/orders/ORDER1");
        assert!(
            matches!(p.tick(due).await, Err(table_app::Error::Unavailable)),
            "{case}"
        );
        assert_eq!(
            p.wallet.ledger.get_deal(deal.id).unwrap().state,
            DealState::Approved,
            "{case}"
        );
        assert_eq!(api.calls("GET /v2/checkout/orders/ORDER1"), gets, "{case}");
        let settled = sent + SETTLE_SECS;
        assert_eq!(p.tick(settled).await.unwrap(), vec![deal.id], "{case}");
        let d = p.wallet.ledger.get_deal(deal.id).unwrap();
        if loss == Loss::Before {
            assert_eq!(d.state, DealState::Expired, "{case}");
            assert_eq!(outcomes_of(&p, deal.id, "authorize"), ["absent"], "{case}");
            assert_eq!(paypal_hold(&api), None, "{case}");
            assert_eq!(api.calls("/void"), 0, "{case}");
        } else {
            assert_eq!(d.state, DealState::Authorized, "{case}");
            let honor = sent + 72 * 3600;
            assert_eq!(
                p.wallet.ledger.deadline(deal.id).unwrap().unwrap().0,
                honor,
                "{case}"
            );
            assert_eq!(p.tick(honor).await.unwrap(), vec![deal.id], "{case}");
            assert_eq!(
                p.wallet.ledger.get_deal(deal.id).unwrap().state,
                DealState::AutoVoided,
                "{case}"
            );
            assert_eq!(paypal_hold(&api), Some("VOIDED"), "{case}");
            assert_eq!(api.calls("/void"), 1, "{case}");
        }
        let reached = usize::from(loss == Loss::After);
        assert_eq!(api.calls("/authorize"), reached, "{case}: never sent again");
        assert_eq!(api.calls("/capture"), 0, "{case}");
        assert_one_request_id_per_operation(&p, &api, deal.id, &case);
    }

    // A parked authorize PayPal cannot be read for at the deadline: the hold stays in question,
    // so the deal waits; the next readable tick settles it.
    let api = LossyApi::losing("authorize", Loss::Before);
    let (mut p, deal, token) = owner_approved_on(&api).await;
    let t = owner_ticket(&mut p, &deal, &token);
    assert!(
        p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
            .await
            .is_err()
    );
    assert!(
        !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
            .await
            .unwrap()
    );
    api.truth.lock().unwrap().created = false;
    let due = 100 + ORDER_APPROVAL_SECS;
    for at in [due, due + 1] {
        assert!(matches!(
            p.tick(at).await,
            Err(table_app::Error::Unavailable)
        ));
        assert_eq!(
            p.wallet.ledger.get_deal(deal.id).unwrap().state,
            DealState::Approved
        );
    }
    api.truth.lock().unwrap().created = true;
    assert_eq!(p.tick(due + 2).await.unwrap(), vec![deal.id]);
    assert_eq!(
        p.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Expired
    );
    assert_eq!(
        outcomes_of(&p, deal.id, "authorize"),
        ["needs_owner", "deferred", "absent"]
    );
    assert_eq!(api.calls("/void"), 0);
    assert_one_request_id_per_operation(&p, &api, deal.id, "parked authorize, unreadable");
}

/// Deal-to-settlement robustness-4 (r3): a parked authorize whose deadline read shows a record
/// no check accepts (here an authorization in a status the wallet does not know) has an end. Each
/// tick before UNREAD_AUTHORIZE_SECS after the first attempt still waits (`Unavailable`) and
/// writes nothing; at the bound the deal takes its deadline's safe default (EXPIRED) and the
/// step stays parked so the owner keeps seeing it. No authorize, capture or void is sent or
/// recorded, before or after, and the ledger still refuses to expire the deal any sooner.
#[tokio::test]
async fn a_parked_authorize_paypal_never_shows_readably_ends_at_its_bound_and_sends_nothing() {
    for parked_before in [true, false] {
        let case = format!("parked before the deadline: {parked_before}");
        let api = LossyApi::losing("authorize", Loss::Before);
        let (mut p, deal, sent) = if parked_before {
            // The owner's authorize: a lost answer is parked (no ticket is reused).
            let (mut p, deal, token) = owner_approved_on(&api).await;
            let t = owner_ticket(&mut p, &deal, &token);
            assert!(
                p.authorize(deal.id, 1, Category::Parts, Authority::Owner(t), 100)
                    .await
                    .is_err(),
                "{case}"
            );
            assert!(
                !p.resolve_deal(deal.id, Resolve::Advance(Category::Parts), 110)
                    .await
                    .unwrap(),
                "{case}"
            );
            assert_eq!(outcomes_of(&p, deal.id, "authorize"), ["needs_owner"]);
            (p, deal, 100)
        } else {
            // The seller's own authorize, sent just before the deadline and first read at the
            // bound.
            let (_, seller, deal) = agreed();
            let mut p = Pipeline::new(seller, api.clone(), 100).unwrap();
            p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
                .await
                .unwrap();
            api.approve();
            assert!(p.poll_approval(deal.id, 1, 100).await.unwrap(), "{case}");
            let sent = 100 + ORDER_APPROVAL_SECS - 2;
            assert!(
                p.authorize(deal.id, 1, Category::Parts, Authority::SellerMandate, sent)
                    .await
                    .is_err(),
                "{case}"
            );
            assert!(outcomes_of(&p, deal.id, "authorize").is_empty(), "{case}");
            (p, deal, sent)
        };
        // PayPal now shows the order with an authorization no check accepts.
        api.truth.lock().unwrap().authorization = Some("PENDING");
        let due = 100 + ORDER_APPROVAL_SECS;
        let bound = sent + UNREAD_AUTHORIZE_SECS;
        let posts = |api: &LossyApi| {
            let truth = api.truth.lock().unwrap();
            truth.calls.iter().filter(|c| c.starts_with("POST")).count()
        };
        let money_rows = |p: &Pipeline| {
            p.wallet
                .ledger
                .paypal_call_requests(deal.id)
                .unwrap()
                .into_iter()
                .filter(|(_, path, _)| {
                    path.ends_with("/authorize")
                        || path.ends_with("/capture")
                        || path.ends_with("/void")
                })
                .count()
        };
        let sent_before = posts(&api);
        let authorize = RequestId::for_operation(deal.id, 1, "authorize").unwrap();
        if parked_before {
            // Ticks past the deadline and before the bound: read, still waiting, nothing written.
            let calls = p.wallet.ledger.paypal_call_requests(deal.id).unwrap().len();
            let head = p.wallet.ledger.audit_page(None, u16::MAX).unwrap().0.len();
            for at in [due, due + 1, bound - 1] {
                assert!(
                    matches!(p.tick(at).await, Err(table_app::Error::Unavailable)),
                    "{case} at {at}"
                );
                assert_eq!(
                    p.wallet.ledger.get_deal(deal.id).unwrap().state,
                    DealState::Approved,
                    "{case} at {at}"
                );
            }
            assert!(
                api.calls("GET /v2/checkout/orders/ORDER1") >= 3,
                "{case}: read each tick"
            );
            assert_eq!(
                p.wallet.ledger.paypal_call_requests(deal.id).unwrap().len(),
                calls,
                "{case}: a read that finds the same again writes nothing"
            );
            assert_eq!(
                p.wallet.ledger.audit_page(None, u16::MAX).unwrap().0.len(),
                head,
                "{case}"
            );
            // The ledger refuses to end it, or to expire it, any sooner.
            assert!(matches!(
                p.wallet
                    .ledger
                    .end_unread_authorize(deal.id, authorize.as_str(), &[], bound - 1),
                Err(LedgerError::Conflict)
            ));
        }
        assert!(matches!(
            p.wallet.ledger.apply_deadline_default(deal.id, bound),
            Err(LedgerError::Conflict)
        ));
        // The bound: the deal ends on its deadline's safe default.
        let reads = p.wallet.ledger.paypal_call_requests(deal.id).unwrap().len();
        assert_eq!(p.tick(bound).await.unwrap(), vec![deal.id], "{case}");
        let d = p.wallet.ledger.get_deal(deal.id).unwrap();
        assert_eq!(d.state, DealState::Expired, "{case}");
        assert_eq!(
            d.decided_by,
            Some(DecidedBy::SafeDefault { deadline: due }),
            "{case}"
        );
        // The read that found it is kept; the step stays parked for the owner.
        assert_eq!(
            p.wallet.ledger.paypal_call_requests(deal.id).unwrap().len(),
            reads + 1,
            "{case}"
        );
        assert_eq!(outcomes_of(&p, deal.id, "authorize"), ["needs_owner"]);
        let check = p.wallet.ledger.money_check(deal.id).unwrap().unwrap();
        assert_eq!(check.step, MoneyCheckStep::Authorize, "{case}");
        assert_eq!(check.state, MoneyCheckState::Parked, "{case}");
        // It stops answering on every tick, and nothing was ever sent or recorded.
        assert!(p.tick(bound + 1).await.unwrap().is_empty(), "{case}");
        assert!(p.tick(bound + 3600).await.unwrap().is_empty(), "{case}");
        assert_eq!(posts(&api), sent_before, "{case}: no PayPal write");
        assert_eq!(api.calls("/authorize"), 0, "{case}");
        assert_eq!(api.calls("/capture"), 0, "{case}");
        assert_eq!(api.calls("/void"), 0, "{case}");
        assert_eq!(money_rows(&p), 0, "{case}: no money call recorded");
        assert!(api.commits().keys().all(|r| r != authorize.as_str()));
        p.wallet.ledger.verify_audit().unwrap();
    }
}
