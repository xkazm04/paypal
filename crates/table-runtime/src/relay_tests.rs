#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "house_tests.rs"]
mod house_tests;
use crate::tests::policy_tests::{attach, install, runs, settled};
use crate::tests::{caller, clauses, credentials, runtime};
use crate::*;
use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use rendezvous::Mailbox;
use std::sync::Arc;
use table_client::*;
use table_core::*;
use tower::ServiceExt;

#[tokio::test]
async fn relay_pairing_retries_loss_and_conflicting_replies_fail_closed() {
    let (buyer, _, buyer_http, buyer_clock, _) = runtime(true);
    let (seller, _, seller_http, seller_clock, _) = runtime(true);
    let (third, _, third_http, _, _) = runtime(true);
    let store = Arc::new(rendezvous::MemoryStore::new(Arc::new(FixedClock(100))));
    let relay = Arc::new(InProcessRelay(rendezvous::router(store.clone())));
    let (a, _) = spawn(buyer.with_relay(relay.clone()));
    let (b, _) = spawn(seller.with_relay(relay.clone()));
    let (c, _) = spawn(third.with_relay(relay));
    let offer: PairingOffer = b
        .execute(
            caller("main", None),
            Action::PairCreate(PairingCreateArgs {
                side: Side::Seller,
                payee: PayeeRef::new("merchant").unwrap(),
            }),
        )
        .await
        .unwrap();
    let join = || PairingJoinArgs {
        code: offer.code.clone(),
        peer: None,
        side: Side::Buyer,
        payee: PayeeRef::new("buyer").unwrap(),
    };
    let poll = || PairingPollArgs {
        code: offer.code.clone(),
    };
    assert!(
        a.execute::<PairingWords>(caller("tumbler", None), Action::PairJoin(join()))
            .await
            .is_err()
    );
    assert!(
        a.execute::<PairingWords>(
            caller("main", None),
            Action::PairJoin(PairingJoinArgs {
                side: Side::Seller,
                ..join()
            })
        )
        .await
        .is_err()
    );
    // Malformed/unverifiable messages have no effect on identity discovery.
    let h = offer.bundle.identity.code_hash.hex();
    store.send(&h, "a.b.c".into()).await.unwrap();
    let first: PairingWords = a
        .execute(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    let retry: PairingWords = a
        .execute(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    assert_eq!(first.pairing_id, retry.pairing_id);
    assert_eq!(store.read(&h, 0).await.unwrap().len(), 3);
    store.remove(&h).await.unwrap();
    assert!(
        b.execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
            .await
            .unwrap()
            .is_none()
    );
    let retry: PairingWords = a
        .execute(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    assert_eq!(retry.pairing_id, first.pairing_id);
    assert_eq!(store.read(&h, 0).await.unwrap().len(), 2);
    let seller_words = b
        .execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seller_words.words, first.words);
    assert!(
        b.execute::<KeyId>(
            caller("main", None),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: seller_words.pairing_id,
                words: seller_words.words,
                display_name: "Buyer".into(),
            })
        )
        .await
        .is_err()
    );
    c.execute::<PairingWords>(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    assert!(
        b.execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
            .await
            .is_err()
    );
    buyer_clock
        .0
        .store(86500, std::sync::atomic::Ordering::SeqCst);
    seller_clock
        .0
        .store(86500, std::sync::atomic::Ordering::SeqCst);
    assert!(
        a.execute::<PairingWords>(caller("main", None), Action::PairJoin(join()))
            .await
            .is_err()
    );
    assert!(
        b.execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
            .await
            .is_err()
    );
    for http in [buyer_http, seller_http, third_http] {
        assert!(http.0.lock().unwrap().paths.is_empty());
    }
}

struct PendingRelay(tokio::sync::Notify);
#[async_trait]
impl table_relay::RelayApi for PendingRelay {
    async fn create(&self, _: H256) -> Result<(), table_relay::Error> {
        Ok(())
    }
    async fn send(&self, _: H256, _: &str) -> Result<(), table_relay::Error> {
        self.0.notify_one();
        std::future::pending().await
    }
    async fn poll(
        &self,
        _: H256,
        _: &str,
        _: u64,
        _: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        std::future::pending().await
    }
}
#[tokio::test]
async fn pending_pairing_io_is_bounded_and_cannot_stall_actor_defaults() {
    let (mut r, _, http, clock, _) = runtime(true);
    let (deal, _) = crate::tests::setup(&mut r, Side::Seller);
    let relay = Arc::new(PendingRelay(tokio::sync::Notify::new()));
    let (actor, _) = spawn(r.with_relay(relay.clone()));
    let mut jobs = Vec::new();
    for _ in 0..4 {
        let a = actor.clone();
        jobs.push(tokio::spawn(async move {
            a.execute::<PairingOffer>(
                caller("main", None),
                Action::PairCreate(PairingCreateArgs {
                    side: Side::Seller,
                    payee: PayeeRef::new("merchant").unwrap(),
                }),
            )
            .await
        }));
        tokio::time::timeout(std::time::Duration::from_secs(2), relay.0.notified())
            .await
            .unwrap();
    }
    assert!(
        actor
            .execute::<PairingOffer>(
                caller("main", None),
                Action::PairCreate(PairingCreateArgs {
                    side: Side::Seller,
                    payee: PayeeRef::new("merchant").unwrap(),
                })
            )
            .await
            .is_err()
    );
    clock.0.store(1000000, std::sync::atomic::Ordering::SeqCst);
    tokio::time::timeout(
        std::time::Duration::from_secs(3),
        state(&actor, deal.id, DealState::Withdrawn),
    )
    .await
    .unwrap();
    assert!(http.0.lock().unwrap().paths.is_empty());
    for job in jobs {
        job.abort();
    }
}

struct InProcessRelay(Router);
impl InProcessRelay {
    async fn request(
        &self,
        method: &str,
        path: String,
        body: String,
    ) -> Result<Vec<u8>, table_relay::Error> {
        let response = self
            .0
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .header("content-type", "application/json")
                    .uri(path)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        if !response.status().is_success() {
            return Err(table_relay::Error::Unavailable);
        }
        Ok(to_bytes(response.into_body(), 256 * 16384 + 32768)
            .await
            .unwrap()
            .to_vec())
    }
}
#[async_trait]
impl table_relay::RelayApi for InProcessRelay {
    async fn house_table(
        &self,
        request: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, table_relay::Error> {
        serde_json::from_slice(
            &self
                .request(
                    "POST",
                    "/v1/house/tables".into(),
                    serde_json::to_string(request).unwrap(),
                )
                .await?,
        )
        .map_err(|_| table_relay::Error::Invalid)
    }
    async fn create(&self, h: H256) -> Result<(), table_relay::Error> {
        self.request("PUT", format!("/v1/mailbox/{}", h.hex()), String::new())
            .await?;
        Ok(())
    }
    async fn send(&self, h: H256, jws: &str) -> Result<(), table_relay::Error> {
        self.request(
            "POST",
            format!("/v1/mailbox/{}/envelopes", h.hex()),
            jws.into(),
        )
        .await?;
        Ok(())
    }
    async fn poll(
        &self,
        h: H256,
        generation: &str,
        after: u64,
        wait: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        serde_json::from_slice(
            &self
                .request(
                    "GET",
                    format!(
                        "/v1/mailbox/{}/sync?generation={generation}&after={after}&wait={wait}",
                        h.hex()
                    ),
                    String::new(),
                )
                .await?,
        )
        .map_err(|_| table_relay::Error::Invalid)
    }
}
async fn state(actor: &ActorHandle, id: DealId, expected: DealState) -> Deal {
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let deal: Deal = actor
                .execute(caller("main", None), Action::Deal(id))
                .await
                .unwrap();
            if deal.state == expected {
                return deal;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

type HostedFixture = (
    house_seller::Seller,
    table_proto::HouseRelease,
    Arc<crate::tests::OfflineHttp>,
    Arc<crate::tests::TestClock>,
    Arc<rendezvous::MemoryStore>,
);
struct HouseBoot {
    config: house_seller::Configuration,
    api: Arc<dyn table_paypal::PayPalApi>,
}
fn hosted_fixture() -> HostedFixture {
    hosted_fixture_ledger(table_ledger::Ledger::in_memory().unwrap()).0
}
fn hosted_fixture_ledger(ledger: table_ledger::Ledger) -> (HostedFixture, HouseBoot) {
    use crate::vault::{VaultCredentials, signing_key};
    use ed25519_dalek::Signer;
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let mut policy = clauses(Side::Seller, DealKind::Haggle);
    for clause in &mut policy {
        if let Clause::Band { max_rounds, .. } = clause {
            *max_rounds = 6;
        }
        if let Clause::HumanPresentOver { amount } = clause {
            *amount = Money::new(2500, Currency::USD).unwrap();
        }
    }
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: policy,
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let owner = signing_key(vault.as_ref(), "owner").unwrap();
    let agent = signing_key(vault.as_ref(), AgentSlot::Negotiator.key_name()).unwrap();
    let commitment = mandate.payload.hash().unwrap();
    let release = table_proto::HouseRelease {
        owner_key: owner.verifying_key().to_bytes(),
        agent_key: agent.verifying_key().to_bytes(),
        payee: PayeeRef::new("merchant").unwrap(),
        mandate_commitment: commitment,
        owner_signature: owner.sign(&commitment.0).to_bytes().to_vec(),
    };
    let store = Arc::new(rendezvous::MemoryStore::new(clock.clone()));
    let api = Arc::new(table_paypal::Client::sandbox(
        http.clone(),
        Arc::new(VaultCredentials(vault)),
        clock.clone(),
        Arc::new(crate::tests::NoDelay),
    ));
    let boot = HouseBoot {
        config: house_seller::Configuration {
            owner: owner.clone(),
            agent: agent.clone(),
            mandate: mandate.clone(),
        },
        api: api.clone(),
    };
    let seller = house_seller::Seller::new(
        ledger,
        owner,
        agent,
        release.clone(),
        mandate,
        api,
        clock.clone(),
        store.clone(),
    )
    .unwrap();
    ((seller, release, http, clock, store), boot)
}

fn house_buyer(
    seller: &mut house_seller::Seller,
    release: table_proto::HouseRelease,
) -> (
    Runtime,
    table_proto::HouseRequest,
    table_proto::HouseResponse,
) {
    let (mut buyer, _, _, _, _) = runtime(true);
    buyer.house_release = Some(release);
    let offer = buyer
        .house_offer(PairingCreateArgs {
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    let request = table_proto::HouseRequest {
        buyer: offer.bundle,
    };
    let response = seller.table(request.clone()).unwrap();
    (buyer, request, response)
}

async fn agreed_house() -> (
    house_seller::Seller,
    Runtime,
    DealId,
    Arc<crate::tests::OfflineHttp>,
    Arc<crate::tests::TestClock>,
    Arc<rendezvous::MemoryStore>,
) {
    use table_app::{AgentRequest, AgentRole, AgentScope, AgentService};
    let (mut seller, release, http, clock, store) = hosted_fixture();
    let (mut buyer, _, response) = house_buyer(&mut seller, release);
    let words = buyer.house_pair(response.clone()).unwrap();
    let key = buyer
        .pairing_confirm(PairingConfirmArgs {
            pairing_id: words.pairing_id,
            words: words.words,
            display_name: "HOUSE".into(),
        })
        .unwrap();
    let mandate = buyer
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let id = response.table.deal_id;
    buyer
        .create_deal_id(
            DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty: key,
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                terms: response.table.terms,
                category: Category::Parts,
            },
            id,
        )
        .unwrap();
    let raw = seller.pipeline.wallet.ledger.relay_work().unwrap()[0].outgoing[0]
        .1
        .clone();
    buyer
        .pipeline
        .wallet
        .receive_relay(id, &raw, Category::Parts, 100)
        .unwrap();
    let raw = buyer
        .pipeline
        .wallet
        .invoke(
            &AgentScope {
                deal_id: id,
                role: AgentRole::Negotiator,
                category: Category::Parts,
            },
            AgentRequest::decode(
                "send_offer",
                serde_json::json!({"deal_id":id,"price":"12.00","delivery":{"type":"digital_now"}}),
            )
            .unwrap(),
            100,
        )
        .unwrap();
    seller
        .pipeline
        .wallet
        .receive_relay(id, raw["jws"].as_str().unwrap(), Category::Parts, 100)
        .unwrap();
    seller.tick().await.unwrap();
    let out = seller.pipeline.wallet.ledger.relay_work().unwrap()[0]
        .outgoing
        .clone();
    let raw = out.iter().last().unwrap().1.clone();
    buyer
        .pipeline
        .wallet
        .receive_relay(id, &raw, Category::Parts, 100)
        .unwrap();
    let raw = buyer
        .pipeline
        .wallet
        .accept(id, 1, Category::Parts, 100)
        .unwrap();
    seller
        .pipeline
        .wallet
        .receive_relay(id, &raw, Category::Parts, 100)
        .unwrap();
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Agreed
    );
    (seller, buyer, id, http, clock, store)
}

#[tokio::test]
async fn house_release_binds_owner_agent_payee_policy_and_table_and_never_trusts_a_self_signed_replacement()
 {
    let (mut seller, release, http, _, _) = hosted_fixture();
    let (mut buyer, request, response) = house_buyer(&mut seller, release.clone());
    response.verify(&release, &request.buyer, 100).unwrap();
    let mut bad = response.clone();
    bad.signature[0] ^= 1;
    assert!(bad.verify(&release, &request.buyer, 100).is_err());
    let mut bad = response.clone();
    bad.seller.identity.payee = PayeeRef::new("other").unwrap();
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.seller.identity.owner_key = request.buyer.identity.owner_key;
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.seller.identity.agent_key = request.buyer.identity.agent_key;
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.mandate.payload.version = 2;
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.table.terms.unit_price = Money::new(1, Currency::USD).unwrap();
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.table.deal_id = DealId(ulid::Ulid::new());
    assert!(buyer.house_pair(bad).is_err());
    let mut bad = response.clone();
    bad.seller.identity.in_reply_to = Some(H256::ZERO);
    assert!(buyer.house_pair(bad).is_err());
    assert!(response.verify(&release, &request.buyer, 86500).is_err());
    let retry = seller.table(request).unwrap();
    assert_eq!(retry.table.deal_id, response.table.deal_id);
    assert_eq!(
        canonical_bytes(&retry).unwrap(),
        canonical_bytes(&response).unwrap()
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    assert_eq!(seller.pipeline.wallet.ledger.list_deals().unwrap().len(), 1);
}

#[tokio::test]
async fn house_hold_block_revocation_wrong_category_and_uninstalled_authority_leave_zero_paypal_rows()
 {
    for shield in [ShieldVerdict::Hold, ShieldVerdict::Block] {
        let (mut seller, _, id, http, _, _) = agreed_house().await;
        seller.pipeline.apply_shield(id, shield, 100).await.unwrap();
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
        assert!(http.0.lock().unwrap().paths.is_empty());
        assert_eq!(
            seller.pipeline.wallet.ledger.paypal_call_count(id).unwrap(),
            0
        );
    }
    let (mut seller, _, id, http, _, _) = agreed_house().await;
    assert!(
        seller
            .pipeline
            .create(
                id,
                1,
                Category::Compute,
                table_app::Authority::HouseMandate,
                100
            )
            .await
            .is_err()
    );
    let deal = seller.pipeline.wallet.ledger.get_deal(id).unwrap();
    seller
        .pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, 100)
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
    assert!(http.0.lock().unwrap().paths.is_empty());
    let (mut wallet, _, wallet_http, _, _) = runtime(true);
    let (deal, _) = crate::tests::setup(&mut wallet, Side::Seller);
    assert!(
        wallet
            .pipeline
            .create(
                deal.id,
                1,
                Category::Parts,
                table_app::Authority::HouseMandate,
                100
            )
            .await
            .is_err()
    );
    assert!(wallet_http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn house_no_capture_without_verified_approval_deadline_expires_and_authorized_hold_voids() {
    let (mut seller, _, id, http, clock, _) = agreed_house().await;
    seller.tick().await.unwrap();
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::AwaitingApproval
    );
    assert!(
        seller
            .pipeline
            .authorize(
                id,
                1,
                Category::Parts,
                table_app::Authority::HouseMandate,
                100
            )
            .await
            .is_err()
    );
    assert!(
        seller
            .pipeline
            .capture(
                id,
                1,
                Category::Parts,
                table_app::Authority::HouseMandate,
                100
            )
            .await
            .is_err()
    );
    assert!(
        !http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.ends_with("/capture") || p.ends_with("/authorize"))
    );
    clock.0.store(21700, std::sync::atomic::Ordering::SeqCst);
    seller.tick().await.unwrap();
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Expired
    );
    assert!(
        !http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.ends_with("/capture"))
    );
    let (mut seller, _, id, http, _, _) = agreed_house().await;
    seller
        .pipeline
        .create(
            id,
            1,
            Category::Parts,
            table_app::Authority::HouseMandate,
            100,
        )
        .await
        .unwrap();
    seller.pipeline.poll_approval(id, 1, 100).await.unwrap();
    seller
        .pipeline
        .authorize(
            id,
            1,
            Category::Parts,
            table_app::Authority::HouseMandate,
            100,
        )
        .await
        .unwrap();
    seller
        .pipeline
        .apply_shield(id, ShieldVerdict::Block, 100)
        .await
        .unwrap();
    assert_eq!(
        seller.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Voided
    );
    assert!(
        !http
            .0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.ends_with("/capture"))
    );
    assert!(
        http.0
            .lock()
            .unwrap()
            .paths
            .iter()
            .any(|p| p.ends_with("/void"))
    );
    seller.pipeline.wallet.ledger.verify_audit().unwrap();
}

#[tokio::test]
async fn h6_fresh_wallet_pairs_house_and_closes_through_in_process_relay_with_mock_paypal() {
    let (seller, release, house_http, _, store) = hosted_fixture();
    let house = house_seller::spawn(seller);
    let router = house_seller::router(store, house.clone());
    let (mut buyer, _, buyer_http, _, _) = runtime(true);
    buyer.house_release = Some(release);
    buyer.house_state = HouseState::Idle;
    let mut buyer_clauses = clauses(Side::Buyer, DealKind::Haggle);
    buyer_clauses[1] = Clause::Counterparties {
        rule: CpRule::House,
    };
    // The policy opens at the bottom of the buyer's band: 5.00, under the house floor.
    if let Clause::Band { floor, .. } = &mut buyer_clauses[3] {
        *floor = Some(Money::new(500, Currency::USD).unwrap());
    }
    let mandate = buyer
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: buyer_clauses,
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let loopback = install(&mut buyer);
    let (actor, _) = spawn(buyer.with_relay(Arc::new(InProcessRelay(router))));
    attach(&actor, &loopback, 8765).await;
    let join = || PairingJoinArgs {
        code: "HOUSE".into(),
        peer: None,
        side: Side::Buyer,
        payee: PayeeRef::new("buyer").unwrap(),
    };
    let words: PairingWords = actor
        .execute(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    let retry: PairingWords = actor
        .execute(caller("main", None), Action::PairJoin(join()))
        .await
        .unwrap();
    assert_eq!(words.pairing_id, retry.pairing_id);
    assert_eq!(
        words.house_table.as_ref().unwrap().deal_id,
        retry.house_table.unwrap().deal_id
    );
    assert!(house_http.0.lock().unwrap().paths.is_empty());
    let token: String = actor
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    actor
        .unlock(caller("approval", Some(&token)), 0)
        .await
        .unwrap();
    actor
        .execute::<()>(
            caller("main", None),
            Action::SelectPairing(words.pairing_id),
        )
        .await
        .unwrap();
    let pending: PendingPairing = actor
        .execute::<Option<PendingPairing>>(caller("approval", None), Action::ApprovalPairing)
        .await
        .unwrap()
        .unwrap();
    assert!(pending.house);
    assert_eq!(pending.words, words.words);
    assert_eq!(pending.display_context, "House seller");
    let peer: KeyId = actor
        .execute(
            caller("approval", Some(&token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: words.words,
                display_name: "HOUSE".into(),
            }),
        )
        .await
        .unwrap();
    let table = words.house_table.unwrap();
    let id = table.deal_id;
    actor
        .execute::<Deal>(
            caller("approval", Some(&token)),
            Action::Join(DealJoinArgs {
                deal_id: id,
                create: DealCreateArgs {
                    kind: DealKind::Haggle,
                    side: Side::Buyer,
                    counterparty: peer,
                    mandate_id: mandate.payload.id,
                    mandate_version: 1,
                    terms: table.terms,
                    category: table.category,
                },
            }),
        )
        .await
        .unwrap();
    state(&actor, id, DealState::Listed).await;
    // The owner starts the policy negotiator; every offer after that is the scheduler's re-arming.
    // Its opening (the bottom of the buyer's band) is below the house floor, which the house
    // declines as evidence and answers with its own lawful counter.
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(id))
        .await
        .unwrap();
    assert_eq!(run.mode, Mode::ScriptedEngine);
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let d: Deal = actor
                .execute(caller("main", None), Action::Deal(id))
                .await
                .unwrap();
            if d.terms.unit_price.minor() == 2250 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    // Wait for both signed seller messages (COUNTER + ACCEPT), then countersign the same offer.
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            let seller_deal = house.snapshot(id).await.unwrap();
            let buyer_deal: Deal = actor
                .execute(caller("main", None), Action::Deal(id))
                .await
                .unwrap();
            if seller_deal.transcript_head == buyer_deal.transcript_head {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    actor
        .execute::<()>(caller("main", None), Action::Select(Some(id)))
        .await
        .unwrap();
    let summary: ApprovalSummary = actor
        .execute(caller("approval", None), Action::Summary(id))
        .await
        .unwrap();
    actor
        .execute::<Deal>(
            caller("approval", Some(&token)),
            Action::Decision(
                DecisionArgs {
                    deal_id: id,
                    attempt: summary.attempt,
                    terms_hash: summary.terms_hash,
                    counter_hash: summary.counter_hash,
                },
                Decision::OwnerAccept,
            ),
        )
        .await
        .unwrap();
    let closed = state(&actor, id, DealState::Receipted).await;
    let seller_closed = house.snapshot(id).await.unwrap();
    assert_eq!(closed.transcript_head, seller_closed.transcript_head);
    assert_eq!(closed.paypal.capture, seller_closed.paypal.capture);
    assert!(seller_closed.market.is_none());
    assert_eq!(closed.terms.unit_price.minor(), 2250);
    assert!(closed.market.is_none());
    let evidence: DealEvidence = actor
        .execute(caller("main", None), Action::Evidence(id))
        .await
        .unwrap();
    assert_eq!(evidence.receipt, ReceiptEvidence::SellerAttested);
    assert!(buyer_http.0.lock().unwrap().paths.is_empty());
    let paths = house_http.0.lock().unwrap().paths.clone();
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.ends_with("/v2/checkout/orders"))
            .count(),
        1
    );
    assert_eq!(
        paths.iter().filter(|p| p.ends_with("/authorize")).count(),
        1
    );
    assert_eq!(paths.iter().filter(|p| p.ends_with("/capture")).count(), 1);
}
#[tokio::test]
async fn two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access()
{
    let (mut buyer, _, buyer_http, _, _) = runtime(true);
    let (mut seller, seller_vault, seller_http, clock, _) = runtime(true);
    credentials(seller_vault.as_ref());
    let mut mandates = Vec::new();
    let mut loopbacks = Vec::new();
    for (r, side) in [(&mut buyer, Side::Buyer), (&mut seller, Side::Seller)] {
        mandates.push(
            r.sign_mandate(MandateSignArgs {
                id: None,
                agent: AgentSlot::Negotiator,
                clauses: {
                    let mut c = clauses(side, DealKind::Haggle);
                    if side == Side::Buyer {
                        // The buyer's policy opens at the bottom of its band: the listing price.
                        if let Clause::Band { floor, .. } = &mut c[3] {
                            *floor = Some(Money::new(1200, Currency::USD).unwrap());
                        }
                    }
                    c
                },
                not_before: 0,
                expires: 1000000,
            })
            .unwrap(),
        );
        loopbacks.push(install(r));
    }
    let terms = Terms {
        item_ref: ItemRef::new("monitor").unwrap(),
        qty: 1,
        unit_price: Money::new(1200, Currency::USD).unwrap(),
        currency: Currency::USD,
        delivery: Delivery::DigitalNow,
    };
    let store = Arc::new(rendezvous::MemoryStore::new(clock));
    let relay = Arc::new(InProcessRelay(rendezvous::router(store.clone())));
    let (a, mut a_events) = spawn(buyer.with_relay(relay.clone()));
    let (b, _) = spawn(seller.with_relay(relay));
    let offer: PairingOffer = b
        .execute(
            caller("main", None),
            Action::PairCreate(PairingCreateArgs {
                side: Side::Seller,
                payee: PayeeRef::new("merchant").unwrap(),
            }),
        )
        .await
        .unwrap();
    let poll = || PairingPollArgs {
        code: offer.code.clone(),
    };
    assert!(
        b.execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
            .await
            .unwrap()
            .is_none()
    );
    // The only information passed between desktops is the owner-entered code.
    let buyer_words: PairingWords = a
        .execute(
            caller("main", None),
            Action::PairJoin(PairingJoinArgs {
                code: offer.code.clone(),
                peer: None,
                side: Side::Buyer,
                payee: PayeeRef::new("buyer_merchant").unwrap(),
            }),
        )
        .await
        .unwrap();
    let seller_words = b
        .execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seller_words.words, buyer_words.words);
    let a_token: String = a
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    let b_token: String = b
        .execute(caller("approval", None), Action::Token)
        .await
        .unwrap();
    a.unlock(caller("approval", Some(&a_token)), 0)
        .await
        .unwrap();
    b.unlock(caller("approval", Some(&b_token)), 0)
        .await
        .unwrap();
    let seller_key: KeyId = a
        .execute(
            caller("approval", Some(&a_token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: buyer_words.pairing_id,
                words: buyer_words.words,
                display_name: "Seller".into(),
            }),
        )
        .await
        .unwrap();
    let buyer_key: KeyId = b
        .execute(
            caller("approval", Some(&b_token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: seller_words.pairing_id,
                words: seller_words.words,
                display_name: "Buyer".into(),
            }),
        )
        .await
        .unwrap();
    let seller_deal: Deal = b
        .execute(
            caller("approval", Some(&b_token)),
            Action::Create(DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Seller,
                counterparty: buyer_key,
                mandate_id: mandates[1].payload.id,
                mandate_version: 1,
                terms: terms.clone(),
                category: Category::Parts,
            }),
        )
        .await
        .unwrap();
    a.execute::<Deal>(
        caller("approval", Some(&a_token)),
        Action::Join(DealJoinArgs {
            create: DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty: seller_key,
                mandate_id: mandates[0].payload.id,
                mandate_version: 1,
                terms: terms.clone(),
                category: Category::Parts,
            },
            deal_id: seller_deal.id,
        }),
    )
    .await
    .unwrap();
    let id = seller_deal.id;
    b.execute::<()>(caller("main", None), Action::Select(Some(id)))
        .await
        .unwrap();
    let binding: crate::market::MarketBinding = b
        .execute(
            caller("approval", Some(&b_token)),
            Action::MarketPrepare(id),
        )
        .await
        .unwrap();
    b.execute::<MarketRef>(
        caller("approval", Some(&b_token)),
        Action::MarketStore(
            binding,
            MarketRef::from_comparables(vec![terms.unit_price], 100, H256::ZERO).unwrap(),
        ),
    )
    .await
    .unwrap();
    let mut seed = offer.bundle.identity.code_hash.0.to_vec();
    seed.extend_from_slice(id.to_string().as_bytes());
    let mailbox = H256::digest(&seed);
    state(&a, id, DealState::Listed).await;
    attach(&a, &loopbacks[0], 8765).await;
    attach(&b, &loopbacks[1], 8766).await;
    // The owner starts the buyer's policy negotiator. Nothing else is injected: the seller's
    // answer and its confirmation are policy runs the scheduler arms on each inbound message.
    let opening: RunSnapshot = a
        .execute(caller("main", None), Action::Start(id))
        .await
        .unwrap();
    assert_eq!(opening.mode, Mode::ScriptedEngine);
    let seller_final = state(&b, id, DealState::Receipted).await;
    let buyer_final = state(&a, id, DealState::Receipted).await;
    // Both sides' negotiation came from policy runs, all clean. The price is under the buyer's
    // clause 6 threshold, so its agent countersigns under that policy.
    for actor in [&a, &b] {
        let all = settled(actor).await;
        assert!(all.iter().all(|r| r.mode == Mode::ScriptedEngine));
        assert!(all.iter().all(|r| r.state == RunState::Clean));
    }
    assert!(runs(&a).await.len() >= 2, "open and confirm runs");
    assert!(
        !runs(&b).await.is_empty(),
        "the seller's answer is a policy run"
    );
    assert_eq!(buyer_final.transcript_head, seller_final.transcript_head);
    assert_eq!(buyer_final.paypal.capture, seller_final.paypal.capture);
    let evidence: DealEvidence = a
        .execute(caller("main", None), Action::Evidence(id))
        .await
        .unwrap();
    assert_eq!(evidence.receipt, ReceiptEvidence::SellerAttested);
    assert_eq!(evidence.reconciliation, Reconciliation::PendingReporting);
    let receipt = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if let WalletEvent::Receipt(r) = a_events.recv().await.unwrap() {
                break r;
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(receipt.evidence.receipt, ReceiptEvidence::SellerAttested);
    assert!(!receipt.on_silence.contains("receipt verified"));
    assert!(buyer_http.0.lock().unwrap().paths.is_empty());
    // A relay restart resets its volatile mailbox, while both wallets retain signed history: the
    // six signed messages are listing, offer, two accepts, settle and receipt.
    store.remove(&mailbox.hex()).await.unwrap();
    store.create(&mailbox.hex()).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(30), async {
        loop {
            if store
                .batch(&mailbox.hex(), "", 0)
                .await
                .unwrap()
                .messages
                .len()
                == 6
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        state(&a, id, DealState::Receipted).await.transcript_head,
        buyer_final.transcript_head
    );
    assert_eq!(
        state(&b, id, DealState::Receipted).await.transcript_head,
        seller_final.transcript_head
    );
    let paths = seller_http.0.lock().unwrap().paths.clone();
    assert_eq!(
        paths
            .iter()
            .filter(|p| p.ends_with("/v2/checkout/orders"))
            .count(),
        1
    );
    assert_eq!(paths.iter().filter(|p| p.ends_with("/capture")).count(), 1);
    assert!(
        a.execute::<DealEvidence>(caller("tumbler", None), Action::Evidence(id))
            .await
            .is_err()
    );
    // T1: either side exports a signed proof bundle an offline verifier accepts in full.
    let export = |actor: ActorHandle, label: &'static str| async move {
        actor
            .execute::<table_proto::ProofBundle>(caller(label, None), Action::ExportProof(id))
            .await
    };
    for actor in [a.clone(), b.clone()] {
        let report = table_verify::verify_bundle(&export(actor, "main").await.unwrap());
        assert!(report.verified(), "{:#?}", report.checks);
    }
    let buyer_proof = export(a.clone(), "main").await.unwrap();
    assert!(export(a.clone(), "tumbler").await.is_err());
    let seller_proof = export(b.clone(), "approval").await.unwrap();
    let ops: Vec<_> = seller_proof
        .operations
        .iter()
        .map(|o| o.operation.as_str())
        .collect();
    assert_eq!(ops, ["create", "authorize", "capture"]);
    // Opt-in sample for running the table-verify CLI by hand; nothing is written otherwise.
    if let Ok(path) = std::env::var("TABLE_PROOF_SAMPLE") {
        std::fs::write(path, serde_json::to_vec_pretty(&seller_proof).unwrap()).unwrap();
    }
    let detail = |bundle: &table_proto::ProofBundle, name: &str| {
        table_verify::verify_bundle(bundle)
            .checks
            .into_iter()
            .find(|c| c.name == name)
            .unwrap()
    };
    assert!(
        detail(&seller_proof, "PayPal order matches the signed terms")
            .detail
            .contains("custom_id = terms hash, invoice id, payee merchant id and amount compared")
    );
    // The recorded order binding carries every field the verifier compares.
    let unit = seller_proof
        .paypal_calls
        .iter()
        .filter_map(|c| c.binding.as_ref())
        .map(|b| &b["purchase_units"][0])
        .next()
        .unwrap();
    for field in ["custom_id", "invoice_id", "payee_merchant_id"] {
        assert!(unit[field].is_string(), "binding lacks {field}");
    }
    // The buyer made no PayPal call, so it has no order binding to show and passes; the seller's
    // orders with every binding stripped (a bundle from before bindings were stored) fail.
    assert!(buyer_proof.paypal_calls.is_empty());
    let none = detail(&buyer_proof, "PayPal order matches the signed terms");
    assert!(
        none.ok && none.detail.contains("no PayPal order"),
        "{none:?}"
    );
    let mut stripped = seller_proof.clone();
    for call in &mut stripped.paypal_calls {
        call.binding = None;
    }
    let unbound = detail(&stripped, "PayPal order matches the signed terms");
    assert!(!unbound.ok, "{unbound:?}");
    assert!(
        unbound.detail.contains("/v2/checkout/orders"),
        "{unbound:?}"
    );
    // Each tamper fails its own check, and every one breaks the signed evidence head.
    type Tamper = fn(&mut table_proto::ProofBundle);
    let tampers: [(&str, Tamper); 9] = [
        ("PayPal order matches the signed terms", |p| {
            let call = p
                .paypal_calls
                .iter_mut()
                .find(|c| c.binding.is_some())
                .unwrap();
            call.binding.as_mut().unwrap()["purchase_units"][0]["amount"]["value"] =
                serde_json::json!("11.99");
        }),
        ("PayPal order matches the signed terms", |p| {
            let call = p
                .paypal_calls
                .iter_mut()
                .find(|c| c.binding.is_some())
                .unwrap();
            call.binding.as_mut().unwrap()["purchase_units"][0]["custom_id"] =
                serde_json::json!("0000");
        }),
        ("PayPal order matches the signed terms", |p| {
            let call = p
                .paypal_calls
                .iter_mut()
                .find(|c| c.binding.is_some())
                .unwrap();
            call.binding.as_mut().unwrap()["purchase_units"][0]["payee_merchant_id"] =
                serde_json::json!("OTHERPAYEE");
        }),
        ("PayPal order matches the signed terms", |p| {
            let call = p
                .paypal_calls
                .iter_mut()
                .find(|c| c.binding.is_some())
                .unwrap();
            call.binding.as_mut().unwrap()["purchase_units"][0]
                .as_object_mut()
                .unwrap()
                .remove("payee_merchant_id");
        }),
        ("PayPal order matches the signed terms", |p| {
            let call = p
                .paypal_calls
                .iter_mut()
                .find(|c| c.binding.is_some())
                .unwrap();
            call.binding.as_mut().unwrap()["purchase_units"][0]
                .as_object_mut()
                .unwrap()
                .remove("custom_id");
        }),
        ("every money call has a lawful authority", |p| {
            let capture = p
                .operations
                .iter_mut()
                .find(|o| o.operation == "capture")
                .unwrap();
            capture.decided_by = DecidedBy::SafeDefault { deadline: 0 };
        }),
        ("transcript signatures and chain", |p| {
            let raw = &mut p.transcript[0].raw;
            let flipped = if raw.ends_with('A') { 'B' } else { 'A' };
            raw.pop();
            raw.push(flipped);
        }),
        ("audit rows hash-consistent", |p| {
            p.audit[0].action = "edited.offline".into();
        }),
        ("closed mandate binds terms, amount, payee", |p| {
            p.closed_mandates[0].mandate.payee = PayeeRef::new("someone_else").unwrap();
        }),
    ];
    for (check, tamper) in tampers {
        let mut forged = seller_proof.clone();
        tamper(&mut forged);
        assert!(!detail(&forged, check).ok, "{check} accepted a forgery");
        assert!(!detail(&forged, "evidence head signed").ok);
        assert!(!table_verify::verify_bundle(&forged).verified());
    }
    drop(store);
    drop(a);
    drop(b);
}
