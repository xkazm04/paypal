#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "agent_surface_tests.rs"]
mod agent_surface_tests;
#[path = "authority_tests.rs"]
mod authority_tests;
#[path = "checks_tests.rs"]
mod checks_tests;
#[path = "client_tests.rs"]
mod client_tests;
#[path = "forecast_tests.rs"]
mod forecast_tests;
#[path = "groups_tests.rs"]
mod groups_tests;
#[path = "h5_tests.rs"]
mod h5_tests;
#[path = "history_tests.rs"]
mod history_tests;
#[path = "ladder_tests.rs"]
mod ladder_tests;
#[path = "limits_tests.rs"]
mod limits_tests;
#[path = "market_watch_tests.rs"]
mod market_watch_tests;
#[path = "policy_tests.rs"]
pub(crate) mod policy_tests;
#[path = "proof_tests.rs"]
mod proof_tests;
#[path = "publish_tests.rs"]
mod publish_tests;
#[path = "quit_tests.rs"]
mod quit_tests;
#[path = "reached_paypal_tests.rs"]
mod reached_paypal_tests;
#[path = "refusal_audit_tests.rs"]
mod refusal_audit_tests;
#[path = "relay_tests.rs"]
mod relay_tests;
#[path = "rescue_tests.rs"]
mod rescue_tests;
#[path = "resume_tests.rs"]
mod resume_tests;
#[path = "safety_tests.rs"]
mod safety_tests;
#[path = "simulate_tests.rs"]
mod simulate_tests;
use super::*;

#[path = "actor_runtime_tests.rs"]
mod actor_runtime_tests;
#[path = "credentials_tests.rs"]
mod credentials_tests;
#[path = "deadline_and_attention_tests.rs"]
mod deadline_and_attention_tests;
#[path = "keys_and_unlock_tests.rs"]
mod keys_and_unlock_tests;
#[path = "mandate_runtime_tests.rs"]
mod mandate_runtime_tests;
#[path = "market_refresh_tests.rs"]
mod market_refresh_tests;
#[path = "pairing_runtime_tests.rs"]
mod pairing_runtime_tests;
#[path = "payment_tests.rs"]
mod payment_tests;

use async_trait::async_trait;
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicI64, AtomicUsize, Ordering},
};
use table_client::*;
use table_core::*;
use table_ledger::{Counterparty, Ledger, PairedVia};
use table_paypal::http::*;
use table_proto::{AgentSigner, Body, Envelope, ShortText};
use vault::{MemoryVault, Vault, VaultCredentials, signing_key};

#[derive(Debug)]
struct TestClock(AtomicI64);
impl Clock for TestClock {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Debug)]
struct Hello {
    calls: AtomicUsize,
    verified: bool,
}
#[async_trait]
impl reauth::OsReauth for Hello {
    fn supported(&self) -> bool {
        true
    }
    async fn authenticate(&self, _: isize) -> Result<(), CommandError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if self.verified {
            Ok(())
        } else {
            Err(permission())
        }
    }
}
#[derive(Debug)]
struct NoDelay;
#[async_trait]
impl Backoff for NoDelay {
    async fn wait(&self, _: u8) {}
}
#[derive(Debug, Default)]
struct ApiState {
    paths: Vec<String>,
    units: Option<Value>,
    fail_void: bool,
    /// The capture request is lost before PayPal sees it.
    fail_capture: bool,
    /// The authorize request is lost before PayPal sees it.
    fail_authorize: bool,
    /// PayPal answers the capture, but not with a COMPLETED payment the wallet can verify.
    unverified_capture: bool,
    /// What PayPal holds after each money step, so an order read reflects it (T10 read-back).
    authorization: Option<&'static str>,
    captured: bool,
    /// The buyer has not approved on PayPal yet: an order read says PAYER_ACTION_REQUIRED. A
    /// test sets it until the buyer's owner opened the PayPal link, the real order of events.
    awaiting_payer: bool,
    /// The rows PayPal's statement read answers with (`/v1/reporting/transactions`).
    reporting: Option<Value>,
}
#[derive(Debug, Default)]
struct OfflineHttp(Mutex<ApiState>);
fn random_text() -> String {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    H256(bytes).hex()
}
#[derive(Debug)]
struct WaitingEngine {
    cancellations: AtomicUsize,
}
#[async_trait]
impl table_engine::EngineAdapter for WaitingEngine {
    fn id(&self) -> table_engine::EngineId {
        table_engine::EngineId::ClaudeCode
    }
    async fn probe(&self) -> Result<table_engine::EngineInfo, table_engine::Error> {
        unreachable!("Tests inject inventory; never probe a CLI")
    }
    async fn run(
        &self,
        _: table_engine::AgentJob,
        _: table_engine::McpGrant,
        tx: tokio::sync::mpsc::Sender<table_engine::EngineEvent>,
    ) -> Result<table_engine::TerminalVerdict, table_engine::Error> {
        tx.send(table_engine::EngineEvent::Init { engine: self.id() })
            .await
            .map_err(|_| table_engine::Error::Closed)?;
        std::future::pending().await
    }
    async fn structured(
        &self,
        _: &str,
        _: &table_engine::Schema,
    ) -> Result<Value, table_engine::Error> {
        Err(table_engine::Error::Invalid)
    }
    fn cancel(&self, _: RunId) {
        self.cancellations.fetch_add(1, Ordering::SeqCst);
    }
}
#[async_trait]
impl Transport for OfflineHttp {
    async fn send(&self, request: Request) -> Result<Response, TransportError> {
        let mut s = self.0.lock().unwrap();
        s.paths.push(format!("{} {}", request.method, request.url));
        let url = request.url.as_str();
        if url.ends_with("/oauth2/token") {
            return Ok(Response {
                status: 200,
                body: json!({"access_token":random_text(),"expires_in":300}),
            });
        }
        if url.contains("/v1/reporting/transactions?") {
            return Ok(Response {
                status: 200,
                body: json!({"transaction_details":s.reporting.clone().unwrap_or(json!([])),"page":1,"total_pages":1}),
            });
        }
        if url.ends_with("/v2/checkout/orders") {
            let body = request.body.unwrap();
            s.units = Some(body["purchase_units"].clone());
            return Ok(Response {
                status: 201,
                body: json!({"id":"ORDER1","status":"CREATED","intent":"AUTHORIZE","purchase_units":s.units,"links":[{"rel":"approve","href":"https://www.sandbox.paypal.com/checkoutnow?token=ORDER1"}]}),
            });
        }
        if url.ends_with("/orders/ORDER1") {
            if let Some(status) = s.authorization {
                let mut units = s.units.clone().unwrap();
                let amount = units[0]["amount"].clone();
                let captures = if s.captured {
                    json!([{"id":"CAPTURE1","status":"COMPLETED","amount":amount}])
                } else {
                    json!([])
                };
                units[0]["payments"] = json!({"authorizations":[{"id":"AUTH1","status":status,"amount":amount}],"captures":captures});
                return Ok(Response {
                    status: 200,
                    body: json!({"id":"ORDER1","status":"COMPLETED","intent":"AUTHORIZE","purchase_units":units}),
                });
            }
            return Ok(Response {
                status: 200,
                body: json!({"id":"ORDER1","status":if s.awaiting_payer {"PAYER_ACTION_REQUIRED"} else {"APPROVED"},"intent":"AUTHORIZE","purchase_units":s.units}),
            });
        }
        if url.ends_with("/orders/ORDER1/authorize") {
            if s.fail_authorize {
                return Err(TransportError);
            }
            s.authorization = Some("CREATED");
            let mut units = s.units.clone().unwrap();
            units[0]["payments"] = json!({"authorizations":[{"id":"AUTH1","status":"CREATED","amount":units[0]["amount"]}]});
            return Ok(Response {
                status: 201,
                body: json!({"id":"ORDER1","status":"COMPLETED","intent":"AUTHORIZE","purchase_units":units}),
            });
        }
        if url.ends_with("/authorizations/AUTH1/capture") {
            if s.fail_capture {
                return Err(TransportError);
            }
            if s.unverified_capture {
                return Ok(Response {
                    status: 201,
                    body: json!({"id":"CAPTURE1","status":"PENDING","amount":s.units.as_ref().unwrap()[0]["amount"]}),
                });
            }
            s.authorization = Some("CAPTURED");
            s.captured = true;
            return Ok(Response {
                status: 201,
                body: json!({"id":"CAPTURE1","status":"COMPLETED","amount":s.units.as_ref().unwrap()[0]["amount"]}),
            });
        }
        if url.ends_with("/authorizations/AUTH1/void") {
            if s.fail_void {
                return Err(TransportError);
            }
            s.authorization = Some("VOIDED");
            return Ok(Response {
                status: 204,
                body: Value::Null,
            });
        }
        if url.ends_with("/authorizations/AUTH1")
            && let Some(status) = s.authorization
        {
            return Ok(Response {
                status: 200,
                body: json!({"id":"AUTH1","status":status,"amount":s.units.as_ref().unwrap()[0]["amount"]}),
            });
        }
        panic!("Unexpected offline HTTP operation");
    }
}
/// T1 parity: the wallet's own export of this deal verifies in full with the offline verifier.
fn assert_proof_verifies(r: &Runtime, id: DealId) -> table_proto::ProofBundle {
    let bundle = r.export_proof(id).unwrap();
    let report = table_verify::verify_bundle(&bundle);
    assert!(report.verified(), "{:#?}", report.checks);
    // The in-app "Check a proof file" reads the saved bytes with the same verifier.
    let file =
        table_client::check_proof_file(&serde_json::to_vec_pretty(&bundle).unwrap()).unwrap();
    assert!(file.verified && file.deal_id == id, "{file:?}");
    // Every line passed, or reads "not checked" because the deal has nothing of its kind.
    assert!(
        file.checks
            .iter()
            .all(|c| (c.ok && c.checked && c.applies) || (!c.ok && !c.checked && !c.applies)),
        "{file:?}"
    );
    // v2: the file names this build's permissions, and the in-app check says so.
    assert_eq!(bundle.format, table_proto::PROOF_FORMAT);
    assert_eq!(
        file.authority_manifest.as_deref(),
        table_client::authority::manifest_hex()
    );
    assert_eq!(file.same_version, Some(true));
    assert!(proof_line(&bundle, "permissions").ok);
    // The same evidence in the first format still verifies under the first format's rules, and
    // every second-format line reads "not checked" there.
    let v1 = as_v1(r, &bundle);
    let old = table_verify::verify_bundle(&v1);
    assert!(old.verified(), "{:#?}", old.checks);
    for id in V2_CHECKS {
        let line = old.checks.iter().find(|c| c.id == id).unwrap();
        assert!(!line.ok && !line.checked && !line.applies, "{line:?}");
    }
    let old_file = table_client::check_proof_file(&serde_json::to_vec(&v1).unwrap()).unwrap();
    assert!(old_file.verified && old_file.same_version.is_none());
    // The owner-key anchor is the whole key id, the one owner_facts shows the owner.
    let owner = table_proto::key_id(&r.pipeline.wallet.owner_public_key()).unwrap();
    assert_eq!(file.owner_key_id, owner.as_str());
    assert_eq!(report.owner_key_id, owner.as_str());
    assert_eq!(file.owner_key_id.len(), 64);
    let ids: Vec<_> = report.checks.iter().map(|c| c.id).collect();
    let file_ids: Vec<_> = file.checks.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, file_ids);
    bundle
}
/// The checks the second proof format adds.
pub(crate) const V2_CHECKS: [&str; 7] = [
    "market",
    "owner_saw",
    "one_request",
    "group",
    "shield",
    "house_record",
    "permissions",
];
/// One line of the offline verifier's report on `bundle`.
pub(crate) fn proof_line(bundle: &table_proto::ProofBundle, id: &str) -> table_verify::Check {
    table_verify::verify_bundle(bundle)
        .checks
        .into_iter()
        .find(|c| c.id == id)
        .unwrap()
}
/// `bundle` as a first-format file: no second-format field, re-signed by the deal's agent.
pub(crate) fn as_v1(r: &Runtime, bundle: &table_proto::ProofBundle) -> table_proto::ProofBundle {
    let mut v1 = bundle.clone();
    v1.format = table_proto::PROOF_FORMAT_V1.into();
    v1.authority_manifest = None;
    v1.group = None;
    v1.house = None;
    for op in &mut v1.operations {
        op.request_id = None;
    }
    for call in &mut v1.paypal_calls {
        call.request_id = None;
    }
    r.sign_proof(&mut v1).unwrap();
    v1
}
/// A forged copy of `bundle`, re-signed by the deal's own agent key so the signature holds:
/// only the check `id` can catch it, and it fails (never "not checked").
pub(crate) fn assert_forgery_fails(
    r: &Runtime,
    bundle: &table_proto::ProofBundle,
    id: &str,
    forge: impl FnOnce(&mut table_proto::ProofBundle),
) {
    let mut forged = bundle.clone();
    forge(&mut forged);
    r.sign_proof(&mut forged).unwrap();
    let report = table_verify::verify_bundle(&forged);
    let line = report.checks.iter().find(|c| c.id == id).unwrap();
    assert!(
        !line.ok && line.checked && line.applies,
        "{id} accepted a forgery: {line:?}"
    );
    assert!(proof_line(&forged, "evidence").ok, "re-signed");
    assert!(!report.verified());
    let file = table_client::check_proof_file(&serde_json::to_vec(&forged).unwrap()).unwrap();
    assert!(!file.verified);
    assert!(file.checks.iter().any(|c| c.id == id && !c.ok && c.checked));
}
fn caller(label: &str, token: Option<&str>) -> Caller {
    Caller {
        label: label.into(),
        token: token.map(str::to_owned),
    }
}
fn runtime(
    verified: bool,
) -> (
    Runtime,
    Arc<MemoryVault>,
    Arc<OfflineHttp>,
    Arc<TestClock>,
    Arc<Hello>,
) {
    let vault = Arc::new(MemoryVault::default());
    let http = Arc::new(OfflineHttp::default());
    let clock = Arc::new(TestClock(AtomicI64::new(100)));
    let hello = Arc::new(Hello {
        calls: AtomicUsize::new(0),
        verified,
    });
    let api = Arc::new(table_paypal::Client::sandbox(
        http.clone(),
        Arc::new(VaultCredentials(vault.clone())),
        clock.clone(),
        Arc::new(NoDelay),
    ));
    (
        Runtime::new(
            Ledger::in_memory().unwrap(),
            vault.clone(),
            hello.clone(),
            api,
            clock.clone(),
        )
        .unwrap(),
        vault,
        http,
        clock,
        hello,
    )
}
fn clauses(side: Side, kind: DealKind) -> Vec<Clause> {
    let money = |n| Money::new(n, Currency::USD).unwrap();
    vec![
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
            max_rounds: 12,
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
            payees: vec![PayeeRef::new("merchant").unwrap()],
        },
    ]
}
fn setup(r: &mut Runtime, side: Side) -> (Deal, AgentSigner) {
    setup_delivery(r, side, Delivery::DigitalNow)
}
fn setup_delivery(r: &mut Runtime, side: Side, delivery: Delivery) -> (Deal, AgentSigner) {
    let (deal, peer) = setup_unpriced(r, side, delivery);
    r.pipeline
        .wallet
        .ledger
        .store_market_reference(
            deal.id,
            &MarketRef::certified_prices(
                deal.terms.item_ref.as_str(),
                H256::digest(b"similar"),
                &[deal.terms.unit_price],
                100,
            )
            .unwrap(),
            100,
        )
        .unwrap();
    (deal, peer)
}
/// A deal with no market reference: the shield asks for every agent authority.
fn setup_unpriced(r: &mut Runtime, side: Side, delivery: Delivery) -> (Deal, AgentSigner) {
    setup_with(r, side, delivery, clauses(side, DealKind::Haggle))
}
/// A deal with no market reference under a new mandate of these clauses.
fn setup_with(
    r: &mut Runtime,
    side: Side,
    delivery: Delivery,
    clauses: Vec<Clause>,
) -> (Deal, AgentSigner) {
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
    r.pipeline
        .wallet
        .ledger
        .insert_counterparty(&Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Peer".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 0,
        })
        .unwrap();
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Haggle,
            side,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate.payload.id,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: Money::new(1200, Currency::USD).unwrap(),
                currency: Currency::USD,
                delivery,
            },
        })
        .unwrap();
    (deal, peer)
}
fn agree(r: &mut Runtime, deal: &Deal, peer: &AgentSigner) {
    r.pipeline.wallet.list(deal.id, 100).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let e = Envelope {
        v: 1,
        typ: table_proto::MsgType::Offer,
        deal_id: deal.id,
        seq: 1,
        prev: current.transcript_head,
        iss: peer.key_id().unwrap(),
        aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
        iat: 100,
        exp: 700,
        nonce,
        body: Body::Offer {
            price: deal.terms.unit_price,
            delivery: deal.terms.delivery.clone(),
        },
    };
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let e = Envelope {
        typ: table_proto::MsgType::Accept,
        seq: 2,
        prev: current.transcript_head,
        nonce,
        body: Body::Accept {
            owner_accept: None,
            offer_seq: 1,
            terms_hash: current.terms.hash().unwrap(),
        },
        ..e
    };
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &peer.sign(&e).unwrap(), Category::Parts, 100)
        .unwrap();
    r.pipeline
        .wallet
        .accept(deal.id, 1, Category::Parts, 100)
        .unwrap();
}
fn credentials(vault: &dyn Vault) {
    vault
        .write(
            "paypal.sandbox",
            &serde_json::to_vec(&(random_text(), random_text())).unwrap(),
        )
        .unwrap();
}
/// A buyer deal whose seller receipt was accepted at 100 as the seller's word only: RECEIPTED, seller-attested.
fn receipted_on_the_sellers_word(r: &mut Runtime) -> Deal {
    let (deal, peer) = setup(r, Side::Buyer);
    for event in [
        DealEvent::ListingVerified,
        DealEvent::OfferVerified,
        DealEvent::TwoAcceptsVerified,
    ] {
        r.pipeline
            .wallet
            .ledger
            .apply_event(deal.id, event, 100)
            .unwrap();
    }
    let aud = table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap();
    let envelope = |seq: u32, prev: H256, body: Body| {
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).unwrap();
        Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: deal.id,
            seq,
            prev,
            iss: peer.key_id().unwrap(),
            aud: aud.clone(),
            iat: 100,
            exp: 700,
            nonce,
            body,
        }
    };
    let settle = peer
        .sign(&envelope(
            1,
            H256::ZERO,
            Body::Settle {
                order_id: ShortText::new("ORDER1".into()).unwrap(),
                approve_url: ShortText::new(
                    "https://www.sandbox.paypal.com/checkoutnow?token=ORDER1".into(),
                )
                .unwrap(),
                amount: deal.terms.amount().unwrap(),
                invoice_id: ShortText::new(invoice_id(deal.id, 1).unwrap()).unwrap(),
                intent: table_proto::Intent::Authorize,
                attempt: 1,
            },
        ))
        .unwrap();
    r.pipeline
        .wallet
        .receive_relay(deal.id, &settle, Category::Parts, 100)
        .unwrap();
    // The owner opened the PayPal link; the seller's receipt is then accepted, at 100.
    r.pipeline.wallet.ledger.handoff(deal.id).unwrap();
    let head = r
        .pipeline
        .wallet
        .ledger
        .get_deal(deal.id)
        .unwrap()
        .transcript_head;
    let receipt = peer
        .sign(&envelope(
            2,
            head,
            Body::Receipt {
                capture_id: ShortText::new("CAPTURE1".into()).unwrap(),
                amount: deal.terms.amount().unwrap(),
                status: table_proto::ReceiptStatus::Completed,
                transcript_head: head,
            },
        ))
        .unwrap();
    r.pipeline
        .wallet
        .receive_relay(deal.id, &receipt, Category::Parts, 100)
        .unwrap();
    deal
}
#[derive(Debug)]
struct MarketFixture {
    calls: AtomicUsize,
}
#[async_trait]
impl table_market::MarketApi for MarketFixture {
    async fn comparables(
        &self,
        product: &str,
        currency: Currency,
    ) -> Result<MarketRef, table_market::Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(MarketRef::certified_prices(
            product,
            H256::digest(b"similar"),
            &[Money::new(1300, currency).unwrap()],
            100,
        )
        .unwrap())
    }
    async fn start_tracking(&self, _: &str) -> Result<(), table_market::Error> {
        unreachable!()
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, table_market::Error> {
        unreachable!()
    }
}
struct Verified;
impl table_app::NativeReauth for Verified {
    fn authenticate(&self) -> Result<(), table_app::Error> {
        Ok(())
    }
}
fn unlock_runtime(r: &mut Runtime) -> String {
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    r.pipeline
        .approval
        .unlock("approval", &token, &Verified, r.clock.now())
        .unwrap();
    token
}
/// The owner's decision on what the summary shows now, bound to its checklist hash.
fn decision(r: &mut Runtime, id: DealId) -> DecisionArgs {
    let deal = r.pipeline.wallet.ledger.get_deal(id).unwrap();
    DecisionArgs {
        counter_hash: None,
        deal_id: id,
        attempt: r.pipeline.wallet.ledger.settled_attempt(id).unwrap().max(1),
        terms_hash: deal.terms.hash().unwrap(),
        checks_hash: Some(r.approval_checks(id).unwrap().1),
    }
}

fn paypal_entry(id: &str, secret: &str) -> vault::CredentialEntry {
    vault::CredentialEntry::PaypalSandbox {
        client_id: zeroize::Zeroizing::new(id.into()),
        client_secret: zeroize::Zeroizing::new(secret.into()),
    }
}
struct FailingVault;
impl Vault for FailingVault {
    fn read(&self, _: &str) -> Result<Option<zeroize::Zeroizing<Vec<u8>>>, vault::VaultError> {
        Ok(None)
    }
    fn write(&self, _: &str, _: &[u8]) -> Result<(), vault::VaultError> {
        Err(vault::VaultError::Unavailable)
    }
}
async fn reconcile_main(
    r: &mut Runtime,
    id: DealId,
    end: Timestamp,
) -> Result<Value, CommandError> {
    r.execute(
        caller("main", None),
        Action::Reconcile(ReconcileArgs {
            deal_id: id,
            start: 0,
            end,
        }),
    )
    .await
}
