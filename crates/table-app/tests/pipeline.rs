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
    unknown: AtomicBool,
    bad_link: AtomicBool,
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
        if self.unknown.load(Ordering::SeqCst) {
            self.calls
                .lock()
                .unwrap()
                .push("/v2/checkout/orders".into());
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
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
#[tokio::test]
async fn unknown_money_outcome_is_reserved_and_never_recreated() {
    let (_, seller, deal) = agreed();
    let mock = Arc::new(MockApi::default());
    mock.unknown.store(true, Ordering::SeqCst);
    let mut p = Pipeline::new(seller, mock.clone(), 100).unwrap();
    assert!(
        p.create(deal.id, 1, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert!(
        p.create(deal.id, 2, Category::Parts, Authority::Policy, 100)
            .await
            .is_err()
    );
    assert_eq!(mock.calls.lock().unwrap().len(), 1);
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
