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
