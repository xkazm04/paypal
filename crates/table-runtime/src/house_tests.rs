use super::*;
use table_relay::RelayApi;
#[path = "resolve_tests.rs"]
mod resolve_tests;

#[test]
fn house_repeat_confirmation_reuses_only_an_identical_release_pinned_peer() {
    let (mut seller, release, http, _, _) = hosted_fixture();
    let (mut buyer, _, response) = house_buyer(&mut seller, release);
    let words = buyer.house_pair(response.clone()).unwrap();
    let args = PairingConfirmArgs {
        pairing_id: words.pairing_id,
        words: words.words,
        display_name: "HOUSE".into(),
    };
    let key = buyer.pairing_confirm(args.clone()).unwrap();
    buyer
        .house_offer(PairingCreateArgs {
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    buyer.house_pair(response).unwrap();
    assert_eq!(buyer.pairing_confirm(args).unwrap(), key);
    assert!(
        buyer
            .pipeline
            .wallet
            .ledger
            .counterparty_policy(&key)
            .unwrap()
            .1
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn house_reopens_durable_pair_table_and_outbox_and_replays_after_mailbox_loss() {
    let mut entropy = [0; 16];
    getrandom::fill(&mut entropy).unwrap();
    let name = entropy
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.build/tmp");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("house-{name}.sqlite3"));
    let ((mut seller, release, http, clock, store), boot) =
        hosted_fixture_ledger(table_ledger::Ledger::open(&path).unwrap());
    let (_, request, response) = house_buyer(&mut seller, release.clone());
    seller.tick().await.unwrap();
    seller.tick().await.unwrap();
    let work = seller
        .pipeline
        .wallet
        .ledger
        .relay_work()
        .unwrap()
        .remove(0);
    assert!(work.outgoing.is_empty());
    let head = seller
        .pipeline
        .wallet
        .ledger
        .get_deal(response.table.deal_id)
        .unwrap()
        .transcript_head;
    drop(seller);
    rendezvous::Mailbox::remove(store.as_ref(), &work.mailbox.hex())
        .await
        .unwrap();
    let mut seller = house_seller::Seller::new(
        table_ledger::Ledger::open(&path).unwrap(),
        boot.config.owner,
        boot.config.agent,
        release,
        boot.config.mandate,
        boot.api,
        clock.clone(),
        store.clone(),
    )
    .unwrap();
    let recovered = seller.table(request).unwrap();
    assert_eq!(
        canonical_bytes(&recovered).unwrap(),
        canonical_bytes(&response).unwrap()
    );
    // A legitimate reset comes later than the reset window (scan C-9a), on a deal that outlives it.
    seller
        .pipeline
        .wallet
        .ledger
        .set_deadline(response.table.deal_id, 10_000, None, 100)
        .unwrap();
    clock.0.fetch_add(600, std::sync::atomic::Ordering::SeqCst);
    seller.tick().await.unwrap();
    seller.tick().await.unwrap();
    assert_eq!(
        rendezvous::Mailbox::read(store.as_ref(), &work.mailbox.hex(), 0)
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        seller
            .pipeline
            .wallet
            .ledger
            .get_deal(response.table.deal_id)
            .unwrap()
            .transcript_head,
        head
    );
    seller.pipeline.wallet.ledger.verify_audit().unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    drop(seller);
    std::fs::remove_file(path).unwrap();
}

#[tokio::test]
async fn house_market_hold_and_changed_commitment_cannot_use_release_authority() {
    let (mut seller, _, id, http, _, _) = agreed_house().await;
    let market = MarketRef::from_comparables(
        vec![Money::new(500, Currency::USD).unwrap()],
        100,
        H256::digest(b"offline market fixture"),
    )
    .unwrap();
    seller
        .pipeline
        .wallet
        .ledger
        .store_market_reference(id, &market, 100)
        .unwrap();
    assert!(
        seller
            .pipeline
            .create(
                id,
                1,
                Category::Parts,
                table_app::Authority::HouseMandate,
                100
            )
            .await
            .is_err()
    );
    assert_eq!(
        seller.pipeline.wallet.ledger.paypal_call_count(id).unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    let ((mut seller, release, http, _, _), boot) =
        hosted_fixture_ledger(table_ledger::Ledger::in_memory().unwrap());
    let mut mandate = boot.config.mandate.clone();
    mandate.payload.expires += 1;
    assert!(seller.pipeline.enable_house(release, &mandate).is_err());
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn house_closed_request_signature_side_expiry_and_capacity_reject_before_any_paypal_call() {
    let (mut seller, release, http, _, store) = hosted_fixture();
    let (_, request, _) = house_buyer(&mut seller, release.clone());
    let router = house_seller::router(store, house_seller::spawn(seller));
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/v1/house/tables")
                .header("content-type", "application/json")
                .body(Body::from("{\"buyer\":{},\"override\":true}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert!(!response.status().is_success());
    let mut request = request;
    request.buyer.owner_signature[0] ^= 1;
    assert!(InProcessRelay(router).house_table(&request).await.is_err());
    assert!(http.0.lock().unwrap().paths.is_empty());
    let (mut seller, release, http, _, _) = hosted_fixture();
    let (mut buyer, _, response) = house_buyer(&mut seller, release.clone());
    let seller_offer = buyer
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    assert!(
        seller
            .table(table_proto::HouseRequest {
                buyer: seller_offer.bundle
            })
            .is_err()
    );
    // Capacity counts durable reservations whose negotiation is still live.
    for _ in 0..63 {
        seller
            .pipeline
            .wallet
            .ledger
            .reserve_house_request(
                H256::digest(DealId(ulid::Ulid::new()).to_string().as_bytes()),
                response.table.deal_id,
            )
            .unwrap();
    }
    assert!(matches!(
        seller.table(table_proto::HouseRequest {
            buyer: fresh_house_request(&release)
        }),
        Err(house_seller::Error::Full)
    ));
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[test]
fn house_relay_refusal_leaves_a_deadline_and_no_request_slot() {
    let (mut seller, release, _, clock, _) = hosted_fixture();
    let (_, _, response) = house_buyer(&mut seller, release.clone());
    let first = response.table.deal_id;
    let ledger = &mut seller.pipeline.wallet.ledger;
    // Fill the 64-route relay cap with live pre-capture routes (the first deal holds one).
    for n in 1..64_u32 {
        let mut deal = ledger.get_deal(first).unwrap();
        deal.id = DealId(ulid::Ulid::new());
        deal.state = DealState::Pairing;
        deal.transcript_head = H256::ZERO;
        deal.paypal = Default::default();
        ledger.create_deal(&deal, 100).unwrap();
        ledger
            .bind_relay(deal.id, H256::digest(&n.to_le_bytes()), 100)
            .unwrap();
    }
    // The next UTC day, so the fillers do not use up today's deal limit.
    clock.0.store(86_450, std::sync::atomic::Ordering::SeqCst);
    let slots = ledger.house_open_request_count().unwrap();
    let known: Vec<DealId> = ledger.list_deals().unwrap().iter().map(|d| d.id).collect();
    let refused = fresh_house_request(&release);
    let digest = refused.identity_hash().unwrap();
    assert!(
        seller
            .table(table_proto::HouseRequest { buyer: refused })
            .is_err()
    );
    let ledger = &seller.pipeline.wallet.ledger;
    // Old order reserved before binding, so the count rose by one here.
    assert_eq!(ledger.house_open_request_count().unwrap(), slots);
    assert_eq!(ledger.house_request(digest).unwrap(), None);
    let orphans: Vec<_> = ledger
        .list_deals()
        .unwrap()
        .into_iter()
        .filter(|d| !known.contains(&d.id))
        .collect();
    assert_eq!(orphans.len(), 1);
    // Old order set the deadline last, so the orphan had none.
    assert!(ledger.deadline(orphans[0].id).unwrap().is_some());
}

#[test]
fn house_capacity_is_released_when_negotiations_end_and_refusals_write_nothing() {
    let (mut seller, release, http, _, _) = hosted_fixture();
    let (_, _, response) = house_buyer(&mut seller, release.clone());
    let id = response.table.deal_id;
    for _ in 0..63 {
        seller
            .pipeline
            .wallet
            .ledger
            .reserve_house_request(
                H256::digest(DealId(ulid::Ulid::new()).to_string().as_bytes()),
                id,
            )
            .unwrap();
    }
    let refused = fresh_house_request(&release);
    let refused_key = table_proto::key_id(
        &ed25519_dalek::VerifyingKey::from_bytes(&refused.identity.agent_key).unwrap(),
    )
    .unwrap();
    let digest = refused.identity_hash().unwrap();
    assert!(matches!(
        seller.table(table_proto::HouseRequest { buyer: refused }),
        Err(house_seller::Error::Full)
    ));
    let ledger = &seller.pipeline.wallet.ledger;
    assert_eq!(ledger.house_request(digest).unwrap(), None);
    assert_eq!(ledger.counterparty_binding(&refused_key).unwrap(), None);
    // The live negotiation ends: all 64 reservations pointing at it stop holding capacity.
    seller
        .pipeline
        .wallet
        .ledger
        .apply_event(id, table_core::DealEvent::Withdraw, 100)
        .unwrap();
    assert_eq!(
        seller
            .pipeline
            .wallet
            .ledger
            .house_open_request_count()
            .unwrap(),
        0
    );
    assert!(
        seller
            .table(table_proto::HouseRequest {
                buyer: fresh_house_request(&release)
            })
            .is_ok()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

/// A request from a new buyer wallet, so it carries an agent key the house has never bound.
fn fresh_house_request(release: &table_proto::HouseRelease) -> table_proto::SignedPairingIdentity {
    let (mut buyer, _, _, _, _) = runtime(true);
    buyer.house_release = Some(release.clone());
    buyer
        .house_offer(PairingCreateArgs {
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap()
        .bundle
}

struct PendingHouseRelay(tokio::sync::Notify);
#[async_trait]
impl table_relay::RelayApi for PendingHouseRelay {
    async fn house_table(
        &self,
        _: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, table_relay::Error> {
        self.0.notify_one();
        std::future::pending().await
    }
    async fn create(&self, _: H256) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn send(&self, _: H256, _: &str) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn poll(
        &self,
        _: H256,
        _: &str,
        _: u64,
        _: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
}
#[tokio::test]
async fn house_waking_is_visible_cancellable_bounded_and_cannot_stall_wallet_deadlines() {
    let (_, release, _, _, _) = hosted_fixture();
    let (mut buyer, _, http, clock, _) = runtime(true);
    let (deal, _) = crate::tests::setup(&mut buyer, Side::Buyer);
    buyer.house_release = Some(release);
    buyer.house_state = HouseState::Idle;
    let relay = Arc::new(PendingHouseRelay(tokio::sync::Notify::new()));
    let (actor, _) = spawn(buyer.with_relay(relay.clone()));
    let join = || PairingJoinArgs {
        code: "HOUSE".into(),
        peer: None,
        side: Side::Buyer,
        payee: PayeeRef::new("buyer").unwrap(),
    };
    assert!(
        actor
            .execute::<PairingWords>(caller("tumbler", None), Action::PairJoin(join()))
            .await
            .is_err()
    );
    let a = actor.clone();
    let args = join();
    let job = tokio::spawn(async move {
        a.execute::<PairingWords>(caller("main", None), Action::PairJoin(args))
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(2), relay.0.notified())
        .await
        .unwrap();
    let settings: SettingsSnapshot = actor
        .execute(caller("main", None), Action::Settings)
        .await
        .unwrap();
    assert_eq!(settings.house, HouseState::Waking);
    assert!(
        actor
            .execute::<PairingWords>(caller("main", None), Action::PairJoin(join()))
            .await
            .is_err()
    );
    clock.0.store(1000000, std::sync::atomic::Ordering::SeqCst);
    state(&actor, deal.id, DealState::Withdrawn).await;
    job.abort();
    let _ = job.await;
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            let settings: SettingsSnapshot = actor
                .execute(caller("main", None), Action::Settings)
                .await
                .unwrap();
            if settings.house == HouseState::Idle {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[test]
fn house_environment_is_typed_redacted_and_requires_matching_keys_and_owner_signed_mandate() {
    use crate::vault::signing_key;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    let (mut r, vault, _, _, _) = runtime(true);
    let m = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Seller, DealKind::Haggle),
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let owner = signing_key(vault.as_ref(), "owner").unwrap();
    let agent = signing_key(vault.as_ref(), AgentSlot::Negotiator.key_name()).unwrap();
    let reader = |name: &str| match name {
        "HOUSE_OWNER_KEY_BASE64" => Some(STANDARD.encode(owner.to_bytes())),
        "HOUSE_AGENT_KEY_BASE64" => Some(STANDARD.encode(agent.to_bytes())),
        "HOUSE_MANDATE_JSON" => Some(serde_json::to_string(&m).unwrap()),
        _ => None,
    };
    let config = house_seller::Configuration::read(reader).unwrap();
    assert_eq!(format!("{config:?}"), "HouseConfiguration { [REDACTED] }");
    config.public_release().unwrap().verify_mandate(&m).unwrap();
    for missing in [
        "HOUSE_OWNER_KEY_BASE64",
        "HOUSE_AGENT_KEY_BASE64",
        "HOUSE_MANDATE_JSON",
    ] {
        assert!(
            house_seller::Configuration::read(|name| if name == missing {
                None
            } else {
                reader(name)
            })
            .is_err()
        );
    }
    assert!(
        house_seller::Configuration::read(|name| if name == "HOUSE_AGENT_KEY_BASE64" {
            reader("HOUSE_OWNER_KEY_BASE64")
        } else {
            reader(name)
        })
        .is_err()
    );
    assert!(
        house_seller::Configuration::read(|name| if name == "HOUSE_MANDATE_JSON" {
            Some("malformed-private-policy".into())
        } else {
            reader(name)
        })
        .is_err()
    );
    assert!(
        house_seller::Configuration::read(|name| if name == "HOUSE_OWNER_KEY_BASE64" {
            Some(STANDARD.encode([0; 31]))
        } else {
            reader(name)
        })
        .is_err()
    );
}

struct WakeRelay {
    wakes: std::sync::atomic::AtomicUsize,
    up: bool,
}
#[async_trait]
impl table_relay::RelayApi for WakeRelay {
    async fn wake(&self) -> Result<(), table_relay::Error> {
        self.wakes.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.up {
            Ok(())
        } else {
            Err(table_relay::Error::Unavailable)
        }
    }
    async fn create(&self, _: H256) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn send(&self, _: H256, _: &str) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn poll(
        &self,
        _: H256,
        _: &str,
        _: u64,
        _: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
}
#[tokio::test]
async fn house_wake_is_main_only_moves_no_money_and_a_failed_wake_returns_to_idle() {
    // Without a release pin there is no house to wake.
    let (plain, _, _, _, _) = runtime(true);
    let up = Arc::new(WakeRelay {
        wakes: std::sync::atomic::AtomicUsize::new(0),
        up: true,
    });
    let (actor, _) = spawn(plain.with_relay(up.clone()));
    assert!(
        actor
            .execute::<HouseState>(caller("main", None), Action::HouseWake)
            .await
            .is_err()
    );
    assert_eq!(up.wakes.load(std::sync::atomic::Ordering::SeqCst), 0);

    let (_, release, _, _, _) = hosted_fixture();
    for (works, expected) in [(true, HouseState::Ready), (false, HouseState::Idle)] {
        let (mut buyer, _, http, _, _) = runtime(true);
        buyer.house_release = Some(release.clone());
        buyer.house_state = HouseState::Idle;
        let relay = Arc::new(WakeRelay {
            wakes: std::sync::atomic::AtomicUsize::new(0),
            up: works,
        });
        let (actor, _) = spawn(buyer.with_relay(relay.clone()));
        for label in ["tumbler", "approval"] {
            assert!(
                actor
                    .execute::<HouseState>(caller(label, None), Action::HouseWake)
                    .await
                    .is_err()
            );
        }
        let woke = actor
            .execute::<HouseState>(caller("main", None), Action::HouseWake)
            .await;
        assert_eq!(woke.is_ok(), works);
        assert_eq!(relay.wakes.load(std::sync::atomic::Ordering::SeqCst), 1);
        let settings = tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                let settings: SettingsSnapshot = actor
                    .execute(caller("main", None), Action::Settings)
                    .await
                    .unwrap();
                if settings.house == expected {
                    break settings;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert_eq!(settings.house, expected);
        assert!(http.0.lock().unwrap().paths.is_empty());
    }
}

/// The HOUSE router behind the same status mapping `table_relay::Client` applies to an answer.
struct RouterRelay(Router);
#[async_trait]
impl table_relay::RelayApi for RouterRelay {
    async fn house_table(
        &self,
        request: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, table_relay::Error> {
        let response = self
            .0
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/house/tables")
                    .header("content-type", "application/json")
                    .body(Body::from(serde_json::to_string(request).unwrap()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 16384).await.unwrap();
        if !status.is_success() {
            return Err(table_relay::answer_error(status.as_u16(), &bytes));
        }
        serde_json::from_slice(&bytes).map_err(|_| table_relay::Error::Invalid)
    }
    async fn create(&self, _: H256) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn send(&self, _: H256, _: &str) -> Result<(), table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
    async fn poll(
        &self,
        _: H256,
        _: &str,
        _: u64,
        _: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        Err(table_relay::Error::Unavailable)
    }
}
/// One HOUSE join from a fresh buyer wallet that must fail: its error and the house state after.
async fn failed_house_join(
    release: &table_proto::HouseRelease,
    relay: Arc<dyn table_relay::RelayApi>,
    buyer_now: Option<i64>,
) -> (CommandError, HouseState) {
    let (mut buyer, _, http, clock, _) = runtime(true);
    buyer.house_release = Some(release.clone());
    buyer.house_state = HouseState::Idle;
    if let Some(now) = buyer_now {
        clock.0.store(now, std::sync::atomic::Ordering::SeqCst);
    }
    let (actor, _) = spawn(buyer.with_relay(relay));
    let error = actor
        .execute::<PairingWords>(
            caller("main", None),
            Action::PairJoin(PairingJoinArgs {
                code: "HOUSE".into(),
                peer: None,
                side: Side::Buyer,
                payee: PayeeRef::new("buyer").unwrap(),
            }),
        )
        .await
        .unwrap_err();
    let settings: SettingsSnapshot = actor
        .execute(caller("main", None), Action::Settings)
        .await
        .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    (error, settings.house)
}
#[tokio::test]
async fn house_full_daily_limit_refusal_and_silence_reach_the_wallet_in_plain_words() {
    // 429: 64 live negotiations hold every HOUSE slot.
    let (mut seller, release, http, _, store) = hosted_fixture();
    let (_, _, response) = house_buyer(&mut seller, release.clone());
    for _ in 0..63 {
        seller
            .pipeline
            .wallet
            .ledger
            .reserve_house_request(
                H256::digest(DealId(ulid::Ulid::new()).to_string().as_bytes()),
                response.table.deal_id,
            )
            .unwrap();
    }
    let router = house_seller::router(store, house_seller::spawn(seller));
    let (error, house) = failed_house_join(&release, Arc::new(RouterRelay(router)), None).await;
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert_eq!(
        error.message,
        "The house is full right now. No money moved."
    );
    assert_eq!(house, HouseState::Ready);
    assert!(http.0.lock().unwrap().paths.is_empty());

    // 400 with the daily-limit code: the signed rules allow 10 agreed deals a day.
    // (The HOUSE's own timer settles those ten deals, so its PayPal mock is not checked here.)
    let (mut seller, release, _, _, store) = hosted_fixture();
    for _ in 0..10 {
        let (_, _, response) = house_buyer(&mut seller, release.clone());
        let ledger = &mut seller.pipeline.wallet.ledger;
        for event in [DealEvent::OfferVerified, DealEvent::TwoAcceptsVerified] {
            ledger
                .apply_event(response.table.deal_id, event, 100)
                .unwrap();
        }
    }
    let router = house_seller::router(store, house_seller::spawn(seller));
    let (error, house) = failed_house_join(&release, Arc::new(RouterRelay(router)), None).await;
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert_eq!(
        error.message,
        "The house has hit its limit for today. No money moved."
    );
    assert_eq!(house, HouseState::Ready);

    // Another 400: the buyer's request runs out more than a day after the house's now.
    let (seller, release, http, _, store) = hosted_fixture();
    let router = house_seller::router(store, house_seller::spawn(seller));
    let (error, house) =
        failed_house_join(&release, Arc::new(RouterRelay(router)), Some(200_000)).await;
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    assert_eq!(
        error.message,
        "The house turned this table down. No money moved."
    );
    assert_eq!(house, HouseState::Ready);
    assert!(http.0.lock().unwrap().paths.is_empty());

    // No answer at all: only this case is the waking house, and it goes back to idle.
    let down = Arc::new(WakeRelay {
        wakes: std::sync::atomic::AtomicUsize::new(0),
        up: false,
    });
    let (error, house) = failed_house_join(&release, down, None).await;
    assert!(matches!(error.code, ErrorCode::Unavailable), "{error:?}");
    assert_eq!(
        error.message,
        "The house is waking or could not be reached. No money moved."
    );
    assert_eq!(house, HouseState::Idle);
}

/// Captures HOUSE log lines in a test.
#[derive(Default)]
struct Lines(std::sync::Mutex<Vec<String>>);
impl house_seller::Log for Lines {
    fn line(&self, line: &str) {
        self.0.lock().unwrap().push(line.into());
    }
}
impl Lines {
    fn all(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

/// A HOUSE on a file ledger holding `n` deals agreed and waiting to settle. `open` starts a
/// seller over that ledger with any PayPal, as a restarted process would.
struct FileHouse {
    path: std::path::PathBuf,
    boot: HouseBoot,
    release: table_proto::HouseRelease,
    http: Arc<crate::tests::OfflineHttp>,
    clock: Arc<crate::tests::TestClock>,
    store: Arc<rendezvous::MemoryStore>,
    deals: Vec<DealId>,
}
impl FileHouse {
    fn new(n: usize) -> Self {
        let mut entropy = [0; 16];
        getrandom::fill(&mut entropy).unwrap();
        let name = H256::digest(&entropy).hex();
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.build/tmp");
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join(format!("house-{}.sqlite3", &name[..32]));
        let ((mut seller, release, http, clock, store), boot) =
            hosted_fixture_ledger(table_ledger::Ledger::open(&path).unwrap());
        let mut deals = Vec::new();
        for _ in 0..n {
            let (_, _, response) = house_buyer(&mut seller, release.clone());
            let id = response.table.deal_id;
            for event in [DealEvent::OfferVerified, DealEvent::TwoAcceptsVerified] {
                seller
                    .pipeline
                    .wallet
                    .ledger
                    .apply_event(id, event, 100)
                    .unwrap();
            }
            deals.push(id);
        }
        drop(seller);
        Self {
            path,
            boot,
            release,
            http,
            clock,
            store,
            deals,
        }
    }
    fn open(&self, api: Arc<dyn table_paypal::PayPalApi>) -> house_seller::Seller {
        house_seller::Seller::new(
            table_ledger::Ledger::open(&self.path).unwrap(),
            self.boot.config.owner.clone(),
            self.boot.config.agent.clone(),
            self.release.clone(),
            self.boot.config.mandate.clone(),
            api,
            self.clock.clone(),
            self.store.clone(),
        )
        .unwrap()
    }
    fn api(&self) -> ScriptedPayPal {
        ScriptedPayPal::new(self.boot.api.clone(), self.clock.clone())
    }
}
impl Drop for FileHouse {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Text shaped like a PayPal access token, planted in a failing PayPal answer.
const SECRET_SHAPED: &str = "A21AAFsecretShapedAccessToken0123456789";

/// The offline PayPal mock behind a script: each call can take time on the HOUSE clock, wait
/// for the test, never answer, or fail with an answer full of secret-shaped text.
struct ScriptedPayPal {
    inner: Arc<dyn table_paypal::PayPalApi>,
    clock: Arc<crate::tests::TestClock>,
    /// Seconds each call takes on the HOUSE clock.
    takes: i64,
    /// Each call waits for one permit when set.
    gated: bool,
    /// The operation that never answers, the one whose call PayPal completes before the
    /// process stops waiting for it, and the one that fails.
    hangs: &'static str,
    hangs_after: &'static str,
    fails: &'static str,
    /// The status a read-back of the authorization answers, when set (the offline HTTP mock
    /// has no such route): CREATED is a hold no capture reached.
    authorization: &'static str,
    entered: tokio::sync::Notify,
    hung: tokio::sync::Notify,
    resume: tokio::sync::Semaphore,
}
impl ScriptedPayPal {
    fn new(inner: Arc<dyn table_paypal::PayPalApi>, clock: Arc<crate::tests::TestClock>) -> Self {
        Self {
            inner,
            clock,
            takes: 0,
            gated: false,
            hangs: "",
            hangs_after: "",
            fails: "",
            authorization: "",
            entered: tokio::sync::Notify::new(),
            hung: tokio::sync::Notify::new(),
            resume: tokio::sync::Semaphore::new(0),
        }
    }
    async fn call(&self, operation: &'static str) -> Result<(), table_paypal::Error> {
        self.clock
            .0
            .fetch_add(self.takes, std::sync::atomic::Ordering::SeqCst);
        self.entered.notify_one();
        if operation == self.hangs {
            self.hung.notify_one();
            std::future::pending::<()>().await;
        }
        if self.gated {
            self.resume.acquire().await.unwrap().forget();
        }
        if operation == self.fails {
            return Err(table_paypal::Error::Api {
                status: 500,
                debug_id: Some(SECRET_SHAPED.into()),
                observations: vec![table_paypal::Observation {
                    method: "POST",
                    path: "/v2/checkout/orders".into(),
                    request_id: String::new(),
                    status: 500,
                    body: serde_json::json!({"access_token": SECRET_SHAPED, "name": "INTERNAL_SERVER_ERROR"}),
                    binding: None,
                }],
            });
        }
        Ok(())
    }
}
#[async_trait]
impl table_paypal::PayPalApi for ScriptedPayPal {
    async fn create_order(
        &self,
        order: &table_paypal::CreateOrder,
        request_id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.call("create").await?;
        self.inner.create_order(order, request_id).await
    }
    async fn get_order(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.call("poll").await?;
        self.inner.get_order(id).await
    }
    async fn authorize(
        &self,
        id: &table_paypal::ResourceId,
        request_id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.call("authorize").await?;
        self.inner.authorize(id, request_id).await
    }
    async fn capture(
        &self,
        id: &table_paypal::ResourceId,
        amount: Money,
        request_id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        self.call("capture").await?;
        let answer = self.inner.capture(id, amount, request_id).await;
        if self.hangs_after == "capture" {
            // PayPal did it; the answer never comes back.
            self.hung.notify_one();
            std::future::pending::<()>().await;
        }
        answer
    }
    async fn void(
        &self,
        id: &table_paypal::ResourceId,
        request_id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<()>, table_paypal::Error> {
        self.call("void").await?;
        self.inner.void(id, request_id).await
    }
    async fn get_authorization(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        self.call("get_authorization").await?;
        if self.authorization.is_empty() {
            return self.inner.get_authorization(id).await;
        }
        let order = table_paypal::ResourceId::new("ORDER1")?;
        let amount = self.inner.get_order(&order).await?.value.purchase_units[0]
            .amount
            .clone();
        let value = table_paypal::Payment {
            id: id.as_str().into(),
            status: self.authorization.into(),
            amount,
        };
        Ok(table_paypal::ApiResponse {
            observations: vec![table_paypal::Observation {
                method: "GET",
                path: format!("/v2/payments/authorizations/{}", id.as_str()),
                request_id: String::new(),
                status: 200,
                body: serde_json::to_value(&value).unwrap(),
                binding: None,
            }],
            value,
        })
    }
}

#[tokio::test]
async fn house_failed_step_writes_one_redacted_log_line() {
    let house = FileHouse::new(1);
    let id = house.deals[0];
    let mut api = house.api();
    api.fails = "create";
    let lines = Arc::new(Lines::default());
    let mut seller = house.open(Arc::new(api)).with_log(lines.clone());
    // The create fails; its one re-send with the same request id fails too; then it is parked
    // for the owner and the step stops failing.
    let settle = || {
        house
            .clock
            .0
            .fetch_add(table_app::SETTLE_SECS, std::sync::atomic::Ordering::SeqCst)
    };
    assert!(seller.tick().await.is_err());
    settle();
    assert!(seller.tick().await.is_err());
    settle();
    seller.tick().await.unwrap();
    seller.tick().await.unwrap();
    assert_eq!(
        lines.all(),
        vec![
            format!("house step=advance deal={id} error=app.unavailable"),
            format!("house pending deal={id} operation=create attempt=1 outcome=unknown"),
            format!("house pending deal={id} operation=create attempt=1 outcome=needs_owner"),
        ]
    );
    // The PayPal answer and every HOUSE secret stay out of the log.
    let text = lines.all().join("\n");
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    for secret in [
        SECRET_SHAPED.to_owned(),
        "Bearer".to_owned(),
        STANDARD.encode(house.boot.config.owner.to_bytes()),
        STANDARD.encode(house.boot.config.agent.to_bytes()),
        serde_json::to_string(&house.boot.config.mandate).unwrap(),
    ] {
        assert!(!text.contains(&secret));
    }
    // The failing call reached PayPal through the script only; the offline mock saw none.
    assert!(house.http.0.lock().unwrap().paths.is_empty());
}

async fn healthz(router: &Router) -> axum::http::StatusCode {
    router
        .clone()
        .oneshot(Request::get("/healthz").body(Body::empty()).unwrap())
        .await
        .unwrap()
        .status()
}
fn audit_rows(seller: &house_seller::Seller, id: DealId, action: &str) -> Vec<serde_json::Value> {
    let (rows, more) = seller
        .pipeline
        .wallet
        .ledger
        .audit_page(None, u16::MAX)
        .unwrap();
    assert!(!more);
    rows.into_iter()
        .filter(|r| r.deal_id == Some(id) && r.action == action)
        .map(|r| r.detail)
        .collect()
}

/// Real-time bound for the actor to reach a step. The house clock is simulated, so this only
/// guards against a hang; 10 s timed out when the machine was busy compiling in parallel.
const LIVENESS_SECS: u64 = 60;
#[tokio::test]
async fn house_health_stays_up_through_a_slow_tick_of_several_deals() {
    use axum::http::StatusCode;
    let house = FileHouse::new(3);
    let mut api = house.api();
    // Each PayPal call takes almost the whole threshold, so one tick of three deals takes far
    // longer than it; a heartbeat written only when the tick starts would read 503 by the second.
    api.takes = house_seller::HEARTBEAT_STALE - 1;
    api.gated = true;
    let api = Arc::new(api);
    let started = house.clock.0.load(std::sync::atomic::Ordering::SeqCst);
    let running = house_seller::start(house.open(api.clone()));
    let handle = running.handle.clone();
    let router = house_seller::router(house.store.clone(), handle.clone());
    for _ in &house.deals {
        tokio::time::timeout(
            std::time::Duration::from_secs(LIVENESS_SECS),
            api.entered.notified(),
        )
        .await
        .unwrap();
        // The actor is inside a PayPal call right now.
        assert_eq!(healthz(&router).await, StatusCode::OK);
        api.resume.add_permits(1);
    }
    let elapsed = house.clock.0.load(std::sync::atomic::Ordering::SeqCst) - started;
    assert!(elapsed > 2 * house_seller::HEARTBEAT_STALE, "{elapsed}");
    // Read the deals from the ledger file, not through the actor: once the creates are done the
    // actor may already sit in a gated approval poll, and a busy actor answers Unavailable (C-8).
    let reader = table_ledger::Ledger::open(&house.path).unwrap();
    for id in &house.deals {
        let deal = tokio::time::timeout(std::time::Duration::from_secs(LIVENESS_SECS), async {
            loop {
                if let Ok(deal) = reader.get_deal(*id)
                    && deal.state == DealState::AwaitingApproval
                {
                    break deal;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(deal.state, DealState::AwaitingApproval);
    }
    drop(reader);
    // A call that hangs past the threshold is still a stalled actor (C-8): /healthz reads 503.
    tokio::time::timeout(
        std::time::Duration::from_secs(LIVENESS_SECS),
        api.entered.notified(),
    )
    .await
    .unwrap();
    assert_eq!(healthz(&router).await, StatusCode::OK);
    house.clock.0.fetch_add(
        house_seller::HEARTBEAT_STALE,
        std::sync::atomic::Ordering::SeqCst,
    );
    assert_eq!(healthz(&router).await, StatusCode::SERVICE_UNAVAILABLE);
    api.resume.add_permits(1000);
    running.drain().await;
}

#[tokio::test]
async fn house_restart_mid_capture_reserves_no_second_request_id_and_reports_it() {
    let house = FileHouse::new(1);
    let id = house.deals[0];
    let mut api = house.api();
    api.hangs = "capture";
    let api = Arc::new(api);
    let mut seller = house.open(api.clone());
    // create, approval poll, authorize, then capture reserves its request id and never returns.
    let ticking = async {
        for _ in 0..10 {
            let _ = seller.tick().await;
        }
    };
    tokio::select! {
        () = ticking => panic!("capture never started"),
        () = api.hung.notified() => {}
    }
    // The process dies in the middle of the capture call.
    drop(seller);
    let captures = |paths: &[String]| paths.iter().filter(|p| p.ends_with("/capture")).count();
    let before = captures(&house.http.0.lock().unwrap().paths);
    assert_eq!(before, 0, "the hung capture never reached the mock");

    // The restarted HOUSE reads the hold back: CREATED, so the capture never reached PayPal.
    let lines = Arc::new(Lines::default());
    let mut api = house.api();
    api.authorization = "CREATED";
    let mut seller = house.open(Arc::new(api)).with_log(lines.clone());
    assert_eq!(
        seller.pending_operations().unwrap(),
        vec![house_seller::PendingOperation {
            deal: id,
            operation: "capture",
            attempt: 1,
            needs_owner: false,
        }]
    );
    assert_eq!(seller.report_pending().unwrap(), 1);
    for _ in 0..3 {
        seller.tick().await.unwrap();
    }
    // One line for the pending capture; it resolved on the first tick and is not logged again.
    assert_eq!(
        lines.all(),
        vec![format!(
            "house pending deal={id} operation=capture attempt=1 outcome=unknown"
        )]
    );
    assert!(seller.pending_operations().unwrap().is_empty());
    // No second request id: one reservation, re-sent once under that same id, one capture.
    let reserved = audit_rows(&seller, id, "money.authorized");
    let capture: Vec<_> = reserved
        .iter()
        .filter(|d| d["operation"] == "capture")
        .collect();
    let request = table_paypal::RequestId::for_operation(id, 1, "capture").unwrap();
    assert_eq!(capture.len(), 1);
    assert_eq!(capture[0]["request_id"], request.as_str());
    assert_eq!(captures(&house.http.0.lock().unwrap().paths), 1);
    let resolved: Vec<_> = audit_rows(&seller, id, "money.resolved")
        .into_iter()
        .map(|d| (d["request_id"].clone(), d["outcome"].clone()))
        .collect();
    // Newest first: re-sent once, then confirmed.
    assert_eq!(
        resolved,
        vec![
            (request.as_str().into(), "confirmed".into()),
            (request.as_str().into(), "resent".into()),
        ]
    );
    let deal = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(deal.state, DealState::Receipted);
    assert!(matches!(
        deal.decided_by,
        Some(DecidedBy::HouseMandate { .. })
    ));
    seller.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// A HOUSE that cannot reach PayPal's truth keeps saying so: the unresolved operation is logged
/// again every ten minutes, never more often, and nothing is sent meanwhile.
#[tokio::test]
async fn house_keeps_reporting_an_unresolved_operation_every_ten_minutes() {
    let house = FileHouse::new(1);
    let id = house.deals[0];
    let mut api = house.api();
    api.hangs = "capture";
    let api = Arc::new(api);
    let mut seller = house.open(api.clone());
    let ticking = async {
        for _ in 0..10 {
            let _ = seller.tick().await;
        }
    };
    tokio::select! {
        () = ticking => panic!("capture never started"),
        () = api.hung.notified() => {}
    }
    drop(seller);

    let lines = Arc::new(Lines::default());
    let mut api = house.api();
    api.fails = "get_authorization";
    let mut seller = house.open(Arc::new(api)).with_log(lines.clone());
    let pending = format!("house pending deal={id} operation=capture attempt=1 outcome=unknown");
    let tick = std::sync::atomic::Ordering::SeqCst;
    for _ in 0..5 {
        assert!(seller.tick().await.is_err());
        house.clock.0.fetch_add(60, tick);
    }
    assert_eq!(
        lines.all(),
        vec![
            format!("house step=advance deal={id} error=app.unavailable"),
            pending.clone(),
        ]
    );
    house
        .clock
        .0
        .fetch_add(house_seller::PENDING_REPORT_SECS, tick);
    assert!(seller.tick().await.is_err());
    assert_eq!(lines.all().iter().filter(|l| **l == pending).count(), 2);
    // Only read-backs were tried: no capture was sent again and nothing was given up.
    assert_eq!(
        house
            .http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .filter(|p| p.ends_with("/capture"))
            .count(),
        0
    );
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Authorized
    );
    let resolved = audit_rows(&seller, id, "money.resolved");
    assert_eq!(resolved.len(), 1);
    assert_eq!(resolved[0]["outcome"], "deferred");
}

#[tokio::test]
async fn house_drain_finishes_the_tick_in_flight_then_stops() {
    let house = FileHouse::new(1);
    let id = house.deals[0];
    let mut api = house.api();
    api.gated = true;
    let api = Arc::new(api);
    let running = house_seller::start(house.open(api.clone()));
    let handle = running.handle.clone();
    tokio::time::timeout(std::time::Duration::from_secs(10), api.entered.notified())
        .await
        .unwrap();
    // A stop arrives while the create call is in flight: the drain waits for it.
    let drain = tokio::spawn(running.drain());
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    assert!(!drain.is_finished());
    api.resume.add_permits(1);
    tokio::time::timeout(std::time::Duration::from_secs(10), drain)
        .await
        .unwrap()
        .unwrap();
    // The actor is gone and takes no new request.
    assert!(matches!(
        handle.snapshot(id).await,
        Err(house_seller::Error::Unavailable)
    ));
    // The step in flight finished: the order is created and nothing is left pending.
    let seller = house.open(Arc::new(house.api()));
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::AwaitingApproval
    );
    assert!(seller.pending_operations().unwrap().is_empty());
}

#[tokio::test]
async fn house_unapproved_deal_lapses_after_thirty_minutes_and_frees_its_slot() {
    let (mut seller, mut buyer, id, http, clock, _) = agreed_house().await;
    let release = seller
        .pipeline
        .wallet
        .ledger
        .preference::<table_proto::HouseRelease>("house.release")
        .unwrap()
        .unwrap();
    let created = clock.now();
    // The step the tick takes for an agreed deal, called directly so the order's settle message
    // stays in the outbox for the buyer below.
    seller
        .pipeline
        .create(
            id,
            1,
            Category::Parts,
            table_app::Authority::HouseMandate,
            created,
        )
        .await
        .unwrap();
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::AwaitingApproval
    );
    // The HOUSE lets an unapproved order lapse after 30 minutes, not PayPal's 6 hours.
    assert_eq!(
        seller
            .pipeline
            .wallet
            .ledger
            .deadline(id)
            .unwrap()
            .unwrap()
            .0,
        created + table_core::HOUSE_APPROVAL_SECS
    );
    const { assert!(table_core::HOUSE_APPROVAL_SECS < table_core::ORDER_APPROVAL_SECS) };
    // The buyer wallet paired with the HOUSE through its release pin counts down the same window.
    let settle = seller.pipeline.wallet.ledger.relay_work().unwrap()[0]
        .outgoing
        .iter()
        .last()
        .unwrap()
        .1
        .clone();
    buyer
        .pipeline
        .wallet
        .receive_relay(id, &settle, Category::Parts, created)
        .unwrap();
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::AwaitingApproval
    );
    assert_eq!(
        buyer
            .pipeline
            .wallet
            .ledger
            .deadline(id)
            .unwrap()
            .unwrap()
            .0,
        created + table_core::HOUSE_APPROVAL_SECS
    );
    // The agreed, unapproved deal and 63 more reservations on it fill every slot.
    for _ in 0..63 {
        seller
            .pipeline
            .wallet
            .ledger
            .reserve_house_request(
                H256::digest(DealId(ulid::Ulid::new()).to_string().as_bytes()),
                id,
            )
            .unwrap();
    }
    let count =
        |s: &house_seller::Seller| s.pipeline.wallet.ledger.house_open_request_count().unwrap();
    assert_eq!(count(&seller), 64);
    clock.0.store(
        created + table_core::HOUSE_APPROVAL_SECS - 1,
        std::sync::atomic::Ordering::SeqCst,
    );
    assert!(matches!(
        seller.table(table_proto::HouseRequest {
            buyer: fresh_house_request(&release)
        }),
        Err(house_seller::Error::Full)
    ));
    // At the deadline the safe default lets the deal lapse: no money moves, the slots free up.
    clock.0.store(
        created + table_core::HOUSE_APPROVAL_SECS,
        std::sync::atomic::Ordering::SeqCst,
    );
    seller.tick().await.unwrap();
    let deal = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(deal.state, DealState::Expired);
    assert_eq!(count(&seller), 0);
    assert!(
        seller
            .table(table_proto::HouseRequest {
                buyer: fresh_house_request(&release)
            })
            .is_ok()
    );
    // The buyer's wallet keeps listening for a late RECEIPT a grace past the same window, then
    // lets its side lapse too; waiting moved nothing.
    let grace_end =
        created + table_core::HOUSE_APPROVAL_SECS + table_core::HOUSE_RECEIPT_GRACE_SECS;
    for at in [created + table_core::HOUSE_APPROVAL_SECS, grace_end - 1] {
        assert!(!buyer.pipeline.deadline_default(id, at).await.unwrap());
        assert_eq!(
            buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
            DealState::AwaitingApproval
        );
    }
    assert!(
        buyer
            .pipeline
            .deadline_default(id, grace_end)
            .await
            .unwrap()
    );
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Expired
    );
    let paths = http.0.lock().unwrap().paths.clone();
    assert!(
        !paths
            .iter()
            .any(|p| p.ends_with("/authorize") || p.ends_with("/capture")),
        "{paths:?}"
    );
    seller.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// The settle step of a HOUSE table at `created`, with its SETTLE delivered to the buyer.
async fn house_settled(
    seller: &mut house_seller::Seller,
    buyer: &mut Runtime,
    id: DealId,
    created: i64,
) {
    seller
        .pipeline
        .create(
            id,
            1,
            Category::Parts,
            table_app::Authority::HouseMandate,
            created,
        )
        .await
        .unwrap();
    let settle = seller.pipeline.wallet.ledger.relay_work().unwrap()[0]
        .outgoing
        .iter()
        .last()
        .unwrap()
        .1
        .clone();
    buyer
        .pipeline
        .wallet
        .receive_relay(id, &settle, Category::Parts, created)
        .unwrap();
}

#[tokio::test]
async fn house_approval_in_its_last_minute_ends_receipted_on_both_sides() {
    use std::sync::atomic::Ordering::SeqCst;
    let (mut seller, mut buyer, id, _, clock, store) = agreed_house().await;
    let created = clock.0.load(SeqCst);
    house_settled(&mut seller, &mut buyer, id, created).await;
    open_paypal_now(&mut buyer, id).await;
    // The buyer approves on PayPal in minute 29; the HOUSE's poll then sees it, and it
    // authorizes and captures before its own window ends.
    clock
        .0
        .store(created + table_core::HOUSE_APPROVAL_SECS - 60, SeqCst);
    for _ in 0..3 {
        seller.tick().await.unwrap();
    }
    let sold = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(sold.state, DealState::Receipted);
    // The RECEIPT crosses the relay after the buyer's approval countdown ended: its wallet is
    // still listening, so it never reads "lapsed" for a deal the HOUSE captured.
    let late = created + table_core::HOUSE_APPROVAL_SECS + 90;
    assert!(!buyer.pipeline.deadline_default(id, late).await.unwrap());
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::AwaitingApproval
    );
    let work = &seller.pipeline.wallet.ledger.relay_work().unwrap()[0];
    let batch = store
        .poll(work.mailbox, &work.generation, 0, 0)
        .await
        .unwrap();
    let receipt = batch.messages.last().unwrap();
    buyer
        .pipeline
        .wallet
        .receive_relay(id, receipt, Category::Parts, late)
        .unwrap();
    let bought = buyer.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(bought.state, DealState::Receipted);
    assert_eq!(bought.paypal.capture, sold.paypal.capture);
    assert_eq!(bought.transcript_head, sold.transcript_head);
    // Nothing lapses afterwards on either side.
    let after = created + table_core::HOUSE_APPROVAL_SECS + table_core::HOUSE_RECEIPT_GRACE_SECS;
    assert!(!buyer.pipeline.deadline_default(id, after).await.unwrap());
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Receipted
    );
}

#[tokio::test]
async fn house_voids_a_hold_whose_receipt_could_no_longer_reach_the_buyer() {
    use std::sync::atomic::Ordering::SeqCst;
    let (mut seller, mut buyer, id, http, clock, _) = agreed_house().await;
    let created = clock.0.load(SeqCst);
    house_settled(&mut seller, &mut buyer, id, created).await;
    // Approved and authorized in minute 29...
    clock
        .0
        .store(created + table_core::HOUSE_APPROVAL_SECS - 60, SeqCst);
    for _ in 0..2 {
        seller.tick().await.unwrap();
    }
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Authorized
    );
    // ...then the HOUSE stalls until the buyer's wallet is about to let the deal lapse: a
    // capture now could not be reported in time, so the hold is voided instead.
    clock.0.store(
        created + table_core::HOUSE_APPROVAL_SECS + table_core::HOUSE_RECEIPT_GRACE_SECS - 60,
        SeqCst,
    );
    seller.tick().await.unwrap();
    let deal = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(deal.state, DealState::AutoVoided);
    let paths = http.0.lock().unwrap().paths.clone();
    assert!(!paths.iter().any(|p| p.ends_with("/capture")), "{paths:?}");
    assert!(paths.iter().any(|p| p.ends_with("/void")), "{paths:?}");
    // The buyer's side lapses at the end of its grace: both records say no money moved.
    let grace_end =
        created + table_core::HOUSE_APPROVAL_SECS + table_core::HOUSE_RECEIPT_GRACE_SECS;
    assert!(
        buyer
            .pipeline
            .deadline_default(id, grace_end)
            .await
            .unwrap()
    );
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Expired
    );
    seller.pipeline.wallet.ledger.verify_audit().unwrap();
}

#[tokio::test]
async fn house_counters_a_floor_bid_and_its_record_still_shows_nothing_below_the_floor() {
    // The guest's agent read the floor (10.00) from the signed mandate and bids it in round one.
    let (mut seller, _, id, http, _, _) = house_offered("10.00").await;
    let deal = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    assert_eq!(
        deal.state,
        DealState::Negotiating,
        "a floor bid closed in one round"
    );
    // The house answered with its round-one price, above the floor.
    assert_eq!(deal.terms.unit_price.minor(), 2250);
    // The glass-box record and its verifier agree: nothing below the floor, nothing agreed.
    let published = seller.publish().unwrap();
    let report = table_verify::verify_house(&published.view, &[], None);
    assert!(report.verified(), "{:?}", report.checks);
    assert!(report.checks.iter().any(|c| c.id == "house_floor" && c.ok));
    assert!(published.view.deals[0].closed.is_empty());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
