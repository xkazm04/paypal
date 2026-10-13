//! Pairing through the runtime: signed identity, both sides computing the same words, bounded offers
//! and the relay binding deadline.
use super::*;

#[test]
fn a_deal_whose_relay_binding_fails_still_carries_its_silence_deadline() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Buyer);
    let key = peer.key_id().unwrap();
    // Filler deals sit under a second mandate so they never touch this mandate's velocity.
    let filler = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Haggle),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap()
        .payload
        .id;
    let ledger = &mut r.pipeline.wallet.ledger;
    ledger
        .pin_pairing_mailbox(&key, H256::digest(b"pairing code"))
        .unwrap();
    for n in 0..64_u32 {
        let mut d = deal.clone();
        d.id = format!("{:026}", 3000 + n).parse().unwrap();
        d.state = DealState::Pairing;
        d.mandate_id = filler;
        ledger.create_deal(&d, 100).unwrap();
        ledger
            .bind_relay(d.id, H256::digest(&n.to_be_bytes()), 100)
            .unwrap();
    }
    let before: Vec<_> = ledger.list_deals().unwrap().iter().map(|d| d.id).collect();
    assert!(
        r.create_deal(DealCreateArgs {
            kind: DealKind::Haggle,
            side: Side::Buyer,
            counterparty: key,
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            category: Category::Parts,
            terms: deal.terms.clone(),
        })
        .is_err()
    );
    let ledger = &r.pipeline.wallet.ledger;
    let orphan = ledger
        .list_deals()
        .unwrap()
        .into_iter()
        .find(|d| !before.contains(&d.id))
        .unwrap();
    assert!(ledger.deadline(orphan.id).unwrap().is_some());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
#[tokio::test]
async fn pairing_requires_signed_identity_all_words_and_owner_authority() {
    let (mut a, _, _, _, _) = runtime(true);
    let (mut b, _, _, _, _) = runtime(true);
    let offer = b
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("merchant").unwrap(),
        })
        .unwrap();
    let mut altered = offer.bundle.clone();
    altered.identity.payee = PayeeRef::new("other").unwrap();
    assert!(
        a.pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(altered),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap()
        })
        .is_err()
    );
    let words = a
        .pairing_join(PairingJoinArgs {
            code: offer.code,
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    let token = unlock_runtime(&mut a);
    let mut wrong = words.words.clone();
    wrong[0] = "other".into();
    assert!(
        a.execute(
            caller("approval", Some(&token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: wrong,
                display_name: "Peer".into()
            })
        )
        .await
        .is_err()
    );
    let value = a
        .execute(
            caller("approval", Some(&token)),
            Action::PairConfirm(PairingConfirmArgs {
                pairing_id: words.pairing_id,
                words: words.words,
                display_name: "Peer".into(),
            }),
        )
        .await
        .unwrap();
    let key: KeyId = serde_json::from_value(value).unwrap();
    assert!(
        a.pipeline
            .wallet
            .ledger
            .counterparty_policy(&key)
            .unwrap()
            .0
    );
}
#[tokio::test]
async fn both_pairing_sides_compute_identical_words_and_exchange_signed_replies() {
    let (mut buyer, buyer_vault, _, _, _) = runtime(true);
    let (mut seller, _, _, _, _) = runtime(true);
    let offer = seller
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let buyer_words = buyer
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    // Even a correctly signed reply cannot attach to a different initiating offer.
    let mut wrong_reply = buyer_words.reply.clone();
    wrong_reply.identity.in_reply_to = Some(H256::ZERO);
    let bytes = canonical_bytes(&wrong_reply.identity).unwrap();
    use ed25519_dalek::Signer;
    wrong_reply.owner_signature = signing_key(buyer_vault.as_ref(), "owner")
        .unwrap()
        .sign(&bytes)
        .to_bytes()
        .to_vec();
    wrong_reply.agent_signature =
        signing_key(buyer_vault.as_ref(), AgentSlot::Negotiator.key_name())
            .unwrap()
            .sign(&bytes)
            .to_bytes()
            .to_vec();
    assert!(wrong_reply.verify().is_ok());
    assert!(
        seller
            .pairing_join(PairingJoinArgs {
                code: offer.code.clone(),
                peer: Some(wrong_reply),
                side: Side::Seller,
                payee: PayeeRef::new("seller").unwrap(),
            })
            .is_err()
    );
    let seller_words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code,
            peer: Some(buyer_words.reply),
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    assert_eq!(buyer_words.words, seller_words.words);
}

#[test]
fn pairing_offers_are_bounded_expire_and_are_consumed_on_confirmation() {
    let (mut buyer, _, http, _, _) = runtime(true);
    let (mut seller, _, _, clock, _) = runtime(true);
    let args = || PairingCreateArgs {
        side: Side::Seller,
        payee: PayeeRef::new("merchant").unwrap(),
    };
    let offer = seller.pairing_create(args()).unwrap();
    let buyer_words = buyer
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(offer.bundle),
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    let words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(buyer_words.reply),
            side: Side::Seller,
            payee: PayeeRef::new("merchant").unwrap(),
        })
        .unwrap();
    seller
        .pairing_confirm(PairingConfirmArgs {
            pairing_id: words.pairing_id,
            words: words.words,
            display_name: "Buyer".into(),
        })
        .unwrap();
    assert!(
        seller
            .pairing_offer(PairingPollArgs { code: offer.code })
            .is_err()
    );
    for _ in 0..64 {
        seller.pairing_create(args()).unwrap();
    }
    assert!(seller.pairing_create(args()).is_err());
    let extra = buyer
        .pairing_create(PairingCreateArgs {
            side: Side::Buyer,
            payee: PayeeRef::new("buyer").unwrap(),
        })
        .unwrap();
    assert!(
        seller
            .pairing_join(PairingJoinArgs {
                code: extra.code,
                peer: Some(extra.bundle),
                side: Side::Seller,
                payee: PayeeRef::new("merchant").unwrap(),
            })
            .is_err()
    );
    clock.0.store(86500, Ordering::SeqCst);
    assert!(seller.pairing_create(args()).is_ok());
    assert!(http.0.lock().unwrap().paths.is_empty());
}
