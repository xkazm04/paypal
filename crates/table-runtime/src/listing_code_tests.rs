//! The owner-to-owner buyer join through a pasted listing code (DECISIONS section 48): the buyer's
//! sheet decodes the seller's code into a deal id and terms and calls deal_join with them. The
//! seller's signed LISTING is the check: a code that does not match the listing never reaches
//! Listed, AUTHORIZE or PayPal. Rust never reads the code; these tests stand in for it by passing
//! the seller's deal id and terms (or altered ones) to deal_join.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use super::*;
use crate::tests::policy_tests::{Loopback, attach, install};

struct Tables {
    a: ActorHandle,
    b: ActorHandle,
    a_token: String,
    b_token: String,
    seller_key: KeyId,
    buyer_key: KeyId,
    buyer_mandate: MandateId,
    seller_mandate: MandateId,
    buyer_http: Arc<crate::tests::OfflineHttp>,
    seller_http: Arc<crate::tests::OfflineHttp>,
    buyer_clock: Arc<crate::tests::TestClock>,
    seller_clock: Arc<crate::tests::TestClock>,
    loopbacks: Vec<Loopback>,
    store: Arc<rendezvous::MemoryStore>,
    code_hash: H256,
}

fn terms() -> Terms {
    Terms {
        item_ref: ItemRef::new("monitor").unwrap(),
        qty: 1,
        unit_price: Money::new(1200, Currency::USD).unwrap(),
        currency: Currency::USD,
        delivery: Delivery::DigitalNow,
    }
}

/// Two desktops paired by words through one relay, each with signed haggle rules; no deal yet.
/// The buyer's rules name both "monitor" and "keyboard" so an altered item still joins and it is
/// the seller's listing, not the buyer's own rules, that must refuse it.
async fn paired_owners() -> Tables {
    let (mut buyer, _, buyer_http, buyer_clock, _) = runtime(true);
    let (mut seller, seller_vault, seller_http, seller_clock, _) = runtime(true);
    seller_http.0.lock().unwrap().awaiting_payer = true;
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
                    if side == Side::Buyer
                        && let Clause::Band {
                            floor, item_refs, ..
                        } = &mut c[3]
                    {
                        *floor = Some(Money::new(1200, Currency::USD).unwrap());
                        item_refs.push(ItemRef::new("keyboard").unwrap());
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
    let store = Arc::new(rendezvous::MemoryStore::new(seller_clock.clone()));
    let relay = Arc::new(InProcessRelay(rendezvous::router(store.clone())));
    let (a, _) = spawn(buyer.with_relay(relay.clone()));
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
    let join = || {
        Action::PairJoin(PairingJoinArgs {
            code: offer.code.clone(),
            peer: None,
            side: Side::Buyer,
            payee: PayeeRef::new("buyer_merchant").unwrap(),
        })
    };
    assert!(
        a.execute::<PairingWords>(caller("main", None), join())
            .await
            .is_err()
    );
    let seller_words = b
        .execute::<Option<PairingWords>>(caller("main", None), Action::PairPoll(poll()))
        .await
        .unwrap()
        .unwrap();
    let buyer_words: PairingWords = a.execute(caller("main", None), join()).await.unwrap();
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
    Tables {
        a,
        b,
        a_token,
        b_token,
        seller_key,
        buyer_key,
        buyer_mandate: mandates[0].payload.id,
        seller_mandate: mandates[1].payload.id,
        buyer_http,
        seller_http,
        buyer_clock,
        seller_clock,
        loopbacks,
        store,
        code_hash: offer.bundle.identity.code_hash,
    }
}

impl Tables {
    /// The seller opens the table: its sheet shows the code (this deal id and these terms).
    async fn seller_opens(&self) -> Deal {
        self.b
            .execute(
                caller("approval", Some(&self.b_token)),
                Action::Create(DealCreateArgs {
                    kind: DealKind::Haggle,
                    side: Side::Seller,
                    counterparty: self.buyer_key.clone(),
                    mandate_id: self.seller_mandate,
                    mandate_version: 1,
                    terms: terms(),
                    category: Category::Parts,
                }),
            )
            .await
            .unwrap()
    }
    /// The buyer's deal_join with what the pasted code decoded to.
    async fn buyer_joins(&self, deal_id: DealId, terms: Terms) -> Result<Deal, CommandError> {
        self.a
            .execute::<Deal>(
                caller("approval", Some(&self.a_token)),
                Action::Join(DealJoinArgs {
                    create: DealCreateArgs {
                        kind: DealKind::Haggle,
                        side: Side::Buyer,
                        counterparty: self.seller_key.clone(),
                        mandate_id: self.buyer_mandate,
                        mandate_version: 1,
                        terms,
                        category: Category::Parts,
                    },
                    deal_id,
                }),
            )
            .await
    }
    async fn buyer_state(&self, id: DealId) -> DealState {
        self.a
            .execute::<Deal>(caller("main", None), Action::Deal(id))
            .await
            .unwrap()
            .state
    }
    /// How many signed messages the seller has put in the mailbox of this deal id.
    async fn sent(&self, id: DealId) -> usize {
        let mut seed = self.code_hash.0.to_vec();
        seed.extend_from_slice(id.to_string().as_bytes());
        let mailbox = H256::digest(&seed);
        self.store
            .batch(&mailbox.hex(), "", 0)
            .await
            .map(|b| b.messages.len())
            .unwrap_or(0)
    }
    /// Lets the relay and both pollers run with no state change expected.
    async fn settle(&self) {
        tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
    }
}

#[tokio::test]
async fn a_matching_listing_code_lists_the_buyer_deal_and_the_haggle_closes() {
    let t = paired_owners().await;
    let seller_deal = t.seller_opens().await;
    let id = seller_deal.id;
    t.buyer_joins(id, seller_deal.terms.clone()).await.unwrap();
    // The seller's signed LISTING reaches the buyer deal, which re-checked it against the code.
    state(&t.a, id, DealState::Listed).await;
    t.b.execute::<()>(caller("main", None), Action::Select(Some(id)))
        .await
        .unwrap();
    let binding: crate::market::MarketBinding =
        t.b.execute(
            caller("approval", Some(&t.b_token)),
            Action::MarketPrepare(id),
        )
        .await
        .unwrap();
    t.b.execute::<MarketRef>(
        caller("approval", Some(&t.b_token)),
        Action::MarketStore(
            binding.clone(),
            MarketRef::certified_prices(
                &binding.product_id,
                H256::ZERO,
                &[terms().unit_price],
                100,
            )
            .unwrap(),
        ),
    )
    .await
    .unwrap();
    attach(&t.a, &t.loopbacks[0], 8775).await;
    attach(&t.b, &t.loopbacks[1], 8776).await;
    let _: RunSnapshot =
        t.a.execute(caller("main", None), Action::Start(id))
            .await
            .unwrap();
    open_paypal(&t.a, &t.a_token, id, &t.seller_http).await;
    for c in [&t.seller_clock, &t.buyer_clock] {
        c.0.fetch_add(10, std::sync::atomic::Ordering::SeqCst);
    }
    let seller_final = state(&t.b, id, DealState::Receipted).await;
    let buyer_final = state(&t.a, id, DealState::Receipted).await;
    assert_eq!(buyer_final.transcript_head, seller_final.transcript_head);
    assert!(t.buyer_http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_listing_code_with_the_wrong_deal_id_never_hears_the_listing_and_lapses_on_silence() {
    let t = paired_owners().await;
    let seller_deal = t.seller_opens().await;
    let wrong = DealId(ulid::Ulid::new());
    assert_ne!(wrong, seller_deal.id);
    t.buyer_joins(wrong, seller_deal.terms.clone())
        .await
        .unwrap();
    t.settle().await;
    // The listing sits in the seller's mailbox; the buyer deal listens on another one.
    assert_eq!(t.sent(seller_deal.id).await, 1, "the seller's listing");
    assert_eq!(t.buyer_state(wrong).await, DealState::Pairing);
    // Silence moves nothing: the deadline withdraws the table, and PayPal was never called.
    t.buyer_clock
        .0
        .store(950_000, std::sync::atomic::Ordering::SeqCst);
    state(&t.a, wrong, DealState::Withdrawn).await;
    assert!(t.buyer_http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn a_listing_code_with_altered_terms_is_refused_and_never_reaches_authorize() {
    let t = paired_owners().await;
    let altered: [fn(&mut Terms); 4] = [
        |t| t.unit_price = Money::new(1300, Currency::USD).unwrap(),
        |t| t.item_ref = ItemRef::new("keyboard").unwrap(),
        |t| t.delivery = Delivery::PickupLocal,
        // The seller's signed listing carries the quantity too (scan J-3).
        |t| t.qty += 1,
    ];
    let mut ids = Vec::new();
    for change in altered {
        let seller_deal = t.seller_opens().await;
        let mut wrong = seller_deal.terms.clone();
        change(&mut wrong);
        assert_ne!(wrong, seller_deal.terms);
        // Same deal id, so the listing does arrive; it is the terms that do not match.
        t.buyer_joins(seller_deal.id, wrong).await.unwrap();
        ids.push(seller_deal.id);
    }
    t.settle().await;
    for id in ids {
        assert_eq!(
            t.sent(id).await,
            1,
            "the seller's listing reached the relay"
        );
        assert_eq!(t.buyer_state(id).await, DealState::Pairing);
    }
    assert!(t.buyer_http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn deal_join_refuses_an_unpaired_revoked_or_expired_counterparty_and_a_known_deal_id() {
    use table_ledger::{Counterparty, PairedVia};
    let (mut buyer, _, _, clock, _) = runtime(true);
    let mandate = buyer
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let token = crate::tests::unlock_runtime(&mut buyer);
    let pin = |buyer: &mut Runtime, n: u8, confirmed: Option<i64>| {
        let agent = ed25519_dalek::SigningKey::from_bytes(&[n; 32]).verifying_key();
        let owner = ed25519_dalek::SigningKey::from_bytes(&[n + 100; 32]).verifying_key();
        let key = table_proto::key_id(&agent).unwrap();
        buyer
            .pipeline
            .wallet
            .ledger
            .insert_paired_counterparty(
                &Counterparty {
                    key_id: key.clone(),
                    owner_key: owner.to_bytes(),
                    agent_key: agent.to_bytes(),
                    display_name: table_proto::ShortText::new("PEER".into()).unwrap(),
                    paired_via: PairedVia::Code,
                    words_confirmed_at: confirmed,
                    declared_payee: PayeeRef::new("merchant").unwrap(),
                    first_seen: 0,
                },
                H256::digest(&[n]),
            )
            .unwrap();
        key
    };
    let join = |key: &KeyId, id: DealId| {
        Action::Join(DealJoinArgs {
            create: DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty: key.clone(),
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                terms: terms(),
                category: Category::Parts,
            },
            deal_id: id,
        })
    };
    let fresh = || DealId(ulid::Ulid::new());
    // Never seen, and seen but never confirmed by words: not paired.
    let stranger =
        table_proto::key_id(&ed25519_dalek::SigningKey::from_bytes(&[50; 32]).verifying_key())
            .unwrap();
    // A key never seen here is a plain "not found" to the owner, not a ledger-trust fault (J-5).
    assert!(matches!(
        buyer
            .execute(caller("approval", Some(&token)), join(&stranger, fresh()))
            .await
            .unwrap_err()
            .code,
        ErrorCode::NotFound
    ));
    let unconfirmed = pin(&mut buyer, 1, None);
    assert!(
        buyer
            .execute(
                caller("approval", Some(&token)),
                join(&unconfirmed, fresh())
            )
            .await
            .is_err()
    );
    // Revoked, and expired.
    let revoked = pin(&mut buyer, 2, Some(100));
    buyer
        .pipeline
        .wallet
        .ledger
        .revoke_counterparty(&revoked, clock.now())
        .unwrap();
    assert!(
        buyer
            .execute(caller("approval", Some(&token)), join(&revoked, fresh()))
            .await
            .is_err()
    );
    let expired = pin(&mut buyer, 3, Some(100));
    buyer
        .pipeline
        .wallet
        .ledger
        .set_counterparty_expiry(&expired, Some(clock.now()), clock.now())
        .unwrap();
    assert!(
        buyer
            .execute(caller("approval", Some(&token)), join(&expired, fresh()))
            .await
            .is_err()
    );
    // A live pin joins once; the same deal id is then known here and joins no more.
    let live = pin(&mut buyer, 4, Some(100));
    let id = fresh();
    buyer
        .execute(caller("approval", Some(&token)), join(&live, id))
        .await
        .unwrap();
    assert!(
        buyer
            .execute(caller("approval", Some(&token)), join(&live, id))
            .await
            .is_err()
    );
    // Nothing was created by a refusal, and nothing reached PayPal.
    assert_eq!(
        buyer.pipeline.wallet.ledger.get_deal(id).unwrap().state,
        DealState::Pairing
    );
}
/// Scan J-1 (docs/security/scan-2026-10-17-join.md): join_deal itself refuses a house pin that was
/// revoked or has expired (before, only the rules' counterparty clause did), and a house table
/// joins once: the second join is refused as invalid before any write, not by the deals table's
/// unique key surfacing as a ledger-trust error.
#[tokio::test]
async fn deal_join_refuses_a_lapsed_house_pin_and_a_house_deal_id_already_joined() {
    for lapse in [Some(true), Some(false), None] {
        let (mut seller, release, http, _, _) = hosted_fixture();
        let (mut buyer, _, response) = house_buyer(&mut seller, release);
        let words = buyer.house_pair(response.clone()).unwrap();
        let key = buyer
            .pairing_confirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: words.words,
                display_name: "HOUSE".into(),
            })
            .unwrap();
        let rules = clauses(Side::Buyer, DealKind::Haggle);
        let mandate = buyer
            .sign_mandate(MandateSignArgs {
                id: None,
                agent: AgentSlot::Negotiator,
                clauses: rules,
                not_before: 0,
                expires: 1000000,
            })
            .unwrap();
        let now = buyer.clock.now();
        match lapse {
            Some(true) => buyer
                .pipeline
                .wallet
                .ledger
                .revoke_counterparty(&key, now)
                .unwrap(),
            Some(false) => buyer
                .pipeline
                .wallet
                .ledger
                .set_counterparty_expiry(&key, Some(now), now)
                .unwrap(),
            None => {}
        }
        let token = crate::tests::unlock_runtime(&mut buyer);
        let id = response.table.deal_id;
        let join = || {
            Action::Join(DealJoinArgs {
                create: DealCreateArgs {
                    kind: DealKind::Haggle,
                    side: Side::Buyer,
                    counterparty: key.clone(),
                    mandate_id: mandate.payload.id,
                    mandate_version: 1,
                    terms: response.table.terms.clone(),
                    category: Category::Parts,
                },
                deal_id: id,
            })
        };
        let first = buyer
            .execute(caller("approval", Some(&token)), join())
            .await;
        if lapse.is_some() {
            assert!(matches!(first.unwrap_err().code, ErrorCode::Invalid));
            assert!(matches!(
                buyer.pipeline.wallet.ledger.get_deal(id),
                Err(table_ledger::LedgerError::NotFound)
            ));
        } else {
            first.unwrap();
            let again = buyer
                .execute(caller("approval", Some(&token)), join())
                .await
                .unwrap_err();
            assert!(matches!(again.code, ErrorCode::Invalid));
        }
        assert!(http.0.lock().unwrap().paths.is_empty());
    }
}
/// Scan J-2: every join Rust refuses past the gate leaves one `command.refused` row (command,
/// window, tier; never the deal id, the terms or the token), and an accepted join leaves
/// `deal.created` and no refusal row.
#[tokio::test]
async fn every_refused_join_is_in_the_audit_log_and_an_accepted_one_is_created() {
    use table_ledger::{Counterparty, PairedVia};
    let (mut buyer, _, http, _, _) = runtime(true);
    let mandate = buyer
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1000000,
        })
        .unwrap();
    let token = crate::tests::unlock_runtime(&mut buyer);
    let pin = |buyer: &mut Runtime, n: u8, confirmed: Option<i64>| {
        let agent = ed25519_dalek::SigningKey::from_bytes(&[n; 32]).verifying_key();
        let key = table_proto::key_id(&agent).unwrap();
        buyer
            .pipeline
            .wallet
            .ledger
            .insert_paired_counterparty(
                &Counterparty {
                    key_id: key.clone(),
                    owner_key: ed25519_dalek::SigningKey::from_bytes(&[n + 100; 32])
                        .verifying_key()
                        .to_bytes(),
                    agent_key: agent.to_bytes(),
                    display_name: table_proto::ShortText::new("PEER".into()).unwrap(),
                    paired_via: PairedVia::Code,
                    words_confirmed_at: confirmed,
                    declared_payee: PayeeRef::new("merchant").unwrap(),
                    first_seen: 0,
                },
                H256::digest(&[n]),
            )
            .unwrap();
        key
    };
    let join = |key: &KeyId, id: DealId, side: Side| {
        Action::Join(DealJoinArgs {
            create: DealCreateArgs {
                kind: DealKind::Haggle,
                side,
                counterparty: key.clone(),
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                terms: terms(),
                category: Category::Parts,
            },
            deal_id: id,
        })
    };
    let rows = |buyer: &Runtime, action: &str| {
        let (rows, _) = buyer.pipeline.wallet.ledger.audit_page(None, 500).unwrap();
        rows.into_iter()
            .filter(|row| row.action == action)
            .collect::<Vec<_>>()
    };
    let stranger =
        table_proto::key_id(&ed25519_dalek::SigningKey::from_bytes(&[50; 32]).verifying_key())
            .unwrap();
    let unconfirmed = pin(&mut buyer, 1, None);
    let live = pin(&mut buyer, 2, Some(100));
    let id = DealId(ulid::Ulid::new());
    let refused = [
        join(&stranger, DealId(ulid::Ulid::new()), Side::Buyer),
        join(&unconfirmed, DealId(ulid::Ulid::new()), Side::Buyer),
        join(&live, DealId(ulid::Ulid::new()), Side::Seller),
    ];
    for (n, action) in refused.into_iter().enumerate() {
        assert!(
            buyer
                .execute(caller("approval", Some(&token)), action)
                .await
                .is_err()
        );
        assert_eq!(rows(&buyer, "command.refused").len(), n + 1);
    }
    buyer
        .execute(
            caller("approval", Some(&token)),
            join(&live, id, Side::Buyer),
        )
        .await
        .unwrap();
    assert_eq!(rows(&buyer, "command.refused").len(), 3);
    assert!(
        rows(&buyer, "deal.created")
            .iter()
            .any(|row| row.deal_id == Some(id))
    );
    // The same deal id again: refused, and recorded.
    assert!(
        buyer
            .execute(
                caller("approval", Some(&token)),
                join(&live, id, Side::Buyer)
            )
            .await
            .is_err()
    );
    let refusals = rows(&buyer, "command.refused");
    assert_eq!(refusals.len(), 4);
    for row in &refusals {
        assert_eq!(row.deal_id, None);
        assert_eq!(row.detail["command"], "deal_join");
        assert_eq!(row.detail["window"], "approval");
        let text = row.detail.to_string();
        assert!(!text.contains(&id.to_string()) && !text.contains("monitor"));
        assert!(!text.contains(&token));
    }
    assert!(http.0.lock().unwrap().paths.is_empty());
}
