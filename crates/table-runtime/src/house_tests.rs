use super::*;
use table_relay::RelayApi;

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
        clock,
        store.clone(),
    )
    .unwrap();
    let recovered = seller.table(request).unwrap();
    assert_eq!(
        canonical_bytes(&recovered).unwrap(),
        canonical_bytes(&response).unwrap()
    );
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
        self.inner.get_authorization(id).await
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
    assert!(seller.tick().await.is_err());
    seller.tick().await.unwrap();
    assert_eq!(
        lines.all(),
        vec![format!(
            "house step=advance deal={id} error=app.unavailable"
        )]
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
    for id in &house.deals {
        let deal = tokio::time::timeout(std::time::Duration::from_secs(LIVENESS_SECS), async {
            loop {
                let deal = handle.snapshot(*id).await.unwrap();
                if deal.state == DealState::AwaitingApproval {
                    break deal;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(deal.state, DealState::AwaitingApproval);
    }
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
async fn house_restart_mid_capture_resolves_on_startup_under_the_same_request_id() {
    // Two crashes inside the capture call: before PayPal saw it, and after PayPal did it.
    for paypal_did_it in [false, true] {
        let house = FileHouse::new(1);
        let id = house.deals[0];
        let mut api = house.api();
        if paypal_did_it {
            api.hangs_after = "capture";
        } else {
            api.hangs = "capture";
        }
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
        let captures = |house: &FileHouse| {
            house
                .http
                .0
                .lock()
                .unwrap()
                .paths
                .iter()
                .filter(|p| p.ends_with("/capture"))
                .count()
        };
        assert_eq!(captures(&house), usize::from(paypal_did_it));

        let lines = Arc::new(Lines::default());
        let mut seller = house.open(Arc::new(house.api())).with_log(lines.clone());
        assert_eq!(
            seller.pending_operations().unwrap(),
            vec![house_seller::PendingOperation {
                deal: id,
                operation: "capture",
                attempt: 1
            }]
        );
        // Startup reads PayPal's order: it was collected (confirm), or not (the same request
        // goes again under the house's release-pinned mandate, re-checked).
        assert_eq!(seller.resolve_pending().await.unwrap(), 1);
        let outcome = if paypal_did_it { "confirmed" } else { "resent" };
        assert_eq!(
            lines.all(),
            vec![format!(
                "house pending deal={id} operation=capture attempt=1 outcome={outcome}"
            )]
        );
        assert_eq!(captures(&house), 1, "one capture reached PayPal in all");
        assert_eq!(
            seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
            DealState::Receipted
        );
        assert!(seller.pending_operations().unwrap().is_empty());
        // One reservation, one request id, whatever was sent.
        let reserved = audit_rows(&seller, id, "money.authorized");
        let capture: Vec<_> = reserved
            .iter()
            .filter(|d| d["operation"] == "capture")
            .collect();
        assert_eq!(capture.len(), 1);
        let request = table_paypal::RequestId::for_operation(id, 1, "capture").unwrap();
        assert_eq!(capture[0]["request_id"], request.as_str());
        for (method, path, rid) in seller
            .pipeline
            .wallet
            .ledger
            .paypal_call_requests(id)
            .unwrap()
        {
            if method == "POST" && path.ends_with("/capture") {
                assert_eq!(rid, request.as_str());
            }
        }
        assert_eq!(
            audit_rows(&seller, id, "money.resent").len(),
            usize::from(!paypal_did_it)
        );
        assert_eq!(audit_rows(&seller, id, "money.resolved").len(), 1);
        // Later ticks send nothing more.
        for _ in 0..3 {
            let _ = seller.tick().await;
        }
        assert_eq!(captures(&house), 1);
        seller.pipeline.wallet.ledger.verify_audit().unwrap();
    }
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
