//! Pairing through the runtime: signed identity, both sides computing the same words, bounded offers
//! and the relay binding deadline.
use super::*;
use table_proto::{PairingCode, PairingCommit, PairingReveal, pairing_words};

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
    // A joiner never takes a bare bundle, altered or not: only a reveal that opens a commit.
    let mut altered = offer.bundle.clone();
    altered.identity.payee = PayeeRef::new("other").unwrap();
    for peer in [altered, offer.bundle.clone()] {
        assert!(
            a.pairing_join(PairingJoinArgs {
                code: offer.code.clone(),
                peer: Some(peer),
                side: Side::Buyer,
                payee: PayeeRef::new("buyer").unwrap()
            })
            .is_err()
        );
    }
    assert!(a.pending.is_empty());
    let (words, _) = pair_by_code(&mut a, &mut b, &offer, Side::Buyer, "buyer").unwrap();
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
    let poll = PairingPollArgs {
        code: offer.code.clone(),
    };
    // The seller shows only its commit; the buyer answers it with a signed reply and no words.
    let commit = seller.pairing_commit(&poll).unwrap();
    let reply = buyer
        .pairing_answer(
            PairingJoinArgs {
                code: offer.code.clone(),
                peer: None,
                side: Side::Buyer,
                payee: PayeeRef::new("buyer").unwrap(),
            },
            commit.clone(),
        )
        .unwrap();
    assert_eq!(reply.identity.in_reply_to, Some(commit.commit));
    assert!(buyer.pending.is_empty());
    // Even a correctly signed reply cannot attach to a different initiating offer, nor to the
    // bundle the commit hides.
    use ed25519_dalek::Signer;
    for answers in [H256::ZERO, offer.bundle.identity_hash().unwrap()] {
        let mut wrong_reply = reply.clone();
        wrong_reply.identity.in_reply_to = Some(answers);
        let bytes = canonical_bytes(&wrong_reply.identity).unwrap();
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
    }
    // No reveal before the seller holds a reply.
    assert!(seller.pairing_reveal_of(&poll).is_err());
    let seller_words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(reply),
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let reveal = seller.pairing_reveal_of(&poll).unwrap();
    let buyer_words = buyer.pairing_revealed(&poll, vec![reveal.clone()]).unwrap();
    assert_eq!(buyer_words.words, seller_words.words);
    assert_eq!(
        buyer_words.pairing_id,
        offer.bundle.identity_hash().unwrap()
    );
    // A retry of either step returns the same answer.
    assert_eq!(
        buyer
            .pairing_revealed(&poll, vec![reveal])
            .unwrap()
            .pairing_id,
        buyer_words.pairing_id
    );
}

/// A bundle under someone else's keys for `code`, as a relay holding the code can make.
fn forged_bundle(code_hash: H256, side: Side, expires: i64) -> SignedPairingIdentity {
    use ed25519_dalek::{Signer, SigningKey};
    let key = || {
        let mut seed = [0; 32];
        getrandom::fill(&mut seed).unwrap();
        SigningKey::from_bytes(&seed)
    };
    let (owner, agent) = (key(), key());
    let identity = PairingIdentity {
        code_hash,
        owner_key: owner.verifying_key().to_bytes(),
        agent_key: agent.verifying_key().to_bytes(),
        side,
        payee: PayeeRef::new("merchant").unwrap(),
        expires,
        in_reply_to: None,
    };
    let bytes = canonical_bytes(&identity).unwrap();
    SignedPairingIdentity {
        identity,
        owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
        agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
    }
}
fn join_args(code: &str) -> PairingJoinArgs {
    PairingJoinArgs {
        code: code.into(),
        peer: None,
        side: Side::Buyer,
        payee: PayeeRef::new("buyer").unwrap(),
    }
}

#[test]
fn the_joiner_has_no_words_before_a_reveal_that_opens_the_commit() {
    let (mut buyer, ..) = runtime(true);
    let (mut seller, ..) = runtime(true);
    let offer = seller
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let poll = PairingPollArgs {
        code: offer.code.clone(),
    };
    let commit = seller.pairing_commit(&poll).unwrap();
    buyer
        .pairing_answer(join_args(&offer.code), commit.clone())
        .unwrap();
    // No reveal yet: no words, nothing held for the approval window, and asking again changes
    // nothing. The reply is the same on every retry.
    for _ in 0..2 {
        let error = buyer.pairing_revealed(&poll, vec![]).unwrap_err();
        assert!(matches!(error.code, ErrorCode::Unavailable));
        assert!(buyer.pending.is_empty());
        assert_eq!(buyer.awaiting_reveal.len(), 1);
    }
    let again = buyer
        .pairing_answer(join_args(&offer.code), commit.clone())
        .unwrap();
    assert_eq!(again.identity.in_reply_to, Some(commit.commit));
    // The initiator's full bundle, handed over bare, is not a reveal.
    assert!(
        buyer
            .pairing_join(PairingJoinArgs {
                peer: Some(offer.bundle.clone()),
                ..join_args(&offer.code)
            })
            .is_err()
    );
    assert!(buyer.pending.is_empty());
    // A different commit for the same code, after the buyer answered, is refused.
    let mut other = commit.clone();
    other.commit = H256::digest(b"other");
    assert!(buyer.pairing_answer(join_args(&offer.code), other).is_err());
    // Words appear only once the seller holds the reply and reveals.
    let reply = buyer
        .pairing_answer(join_args(&offer.code), commit)
        .unwrap();
    assert!(seller.pairing_reveal_of(&poll).is_err());
    let seller_words = seller
        .pairing_join(PairingJoinArgs {
            code: offer.code.clone(),
            peer: Some(reply),
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let reveal = seller.pairing_reveal_of(&poll).unwrap();
    let words = buyer.pairing_revealed(&poll, vec![reveal]).unwrap();
    assert_eq!(words.words, seller_words.words);
    assert!(buyer.awaiting_reveal.is_empty());
}

#[test]
fn a_reveal_that_does_not_open_the_commit_ends_the_pairing_and_pins_nothing() {
    for case in 0..3 {
        let (mut buyer, ..) = runtime(true);
        let (mut seller, ..) = runtime(true);
        let offer = seller
            .pairing_create(PairingCreateArgs {
                side: Side::Seller,
                payee: PayeeRef::new("seller").unwrap(),
            })
            .unwrap();
        let poll = PairingPollArgs {
            code: offer.code.clone(),
        };
        let commit = seller.pairing_commit(&poll).unwrap();
        let reply = buyer
            .pairing_answer(join_args(&offer.code), commit.clone())
            .unwrap();
        seller
            .pairing_join(PairingJoinArgs {
                code: offer.code.clone(),
                peer: Some(reply),
                side: Side::Seller,
                payee: PayeeRef::new("seller").unwrap(),
            })
            .unwrap();
        let honest = seller.pairing_reveal_of(&poll).unwrap();
        let mut bad = honest.clone();
        let reveals = match case {
            // The right bundle with another nonce.
            0 => {
                bad.nonce[0] ^= 1;
                vec![bad]
            }
            // Another validly signed bundle for the same code, side and expiry, same nonce.
            1 => {
                bad.bundle = forged_bundle(commit.code_hash, Side::Seller, commit.expires);
                vec![bad]
            }
            // The honest reveal beside one that does not open: the pairing still ends.
            _ => {
                bad.nonce = [0; 32];
                vec![honest.clone(), bad]
            }
        };
        let error = buyer.pairing_revealed(&poll, reveals).unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "case {case}");
        assert!(buyer.pending.is_empty());
        assert!(buyer.awaiting_reveal.is_empty());
        // The pairing is over: even the honest reveal now finds nothing to open.
        assert!(buyer.pairing_revealed(&poll, vec![honest]).is_err());
        assert!(buyer.pending.is_empty());
        assert!(
            buyer
                .pipeline
                .wallet
                .ledger
                .counterparty_list()
                .unwrap()
                .is_empty(),
            "case {case}"
        );
    }
}

#[test]
fn a_relay_holding_the_code_must_fix_its_key_before_it_sees_the_joiners() {
    let (mut buyer, buyer_vault, ..) = runtime(true);
    let (mut seller, ..) = runtime(true);
    let offer = seller
        .pairing_create(PairingCreateArgs {
            side: Side::Seller,
            payee: PayeeRef::new("seller").unwrap(),
        })
        .unwrap();
    let code = PairingCode::parse(&offer.code).unwrap();
    // The relay has the code. It hides the seller's commit and shows the buyer its own, for a key
    // M it must choose now, before the buyer's key is on the wire.
    let honest = seller
        .pairing_commit(&PairingPollArgs {
            code: offer.code.clone(),
        })
        .unwrap();
    let m = forged_bundle(honest.code_hash, Side::Seller, honest.expires);
    let (relay_commit, relay_reveal) = PairingCommit::seal(&m, [5; 32]).unwrap();
    let reply = buyer
        .pairing_answer(join_args(&offer.code), relay_commit)
        .unwrap();
    // Now the buyer's key is known. Whatever key the relay picks from here, for instance one
    // ground so the words would match the seller's, its reveal does not open the commit and the
    // buyer ends the pairing.
    let buyer_key = signing_key(buyer_vault.as_ref(), AgentSlot::Negotiator.key_name())
        .unwrap()
        .verifying_key()
        .to_bytes();
    assert_eq!(reply.identity.agent_key, buyer_key);
    let ground = PairingReveal {
        bundle: forged_bundle(honest.code_hash, Side::Seller, honest.expires),
        nonce: [5; 32],
    };
    let poll = PairingPollArgs { code: offer.code };
    assert!(buyer.pairing_revealed(&poll, vec![ground]).is_err());
    assert!(buyer.pending.is_empty());
    // Had it revealed M, the buyer's words would come from M: a key fixed before the buyer's was
    // seen, so matching the seller's words is a single 2^-24 guess, not a search.
    let (mut fresh, fresh_vault, ..) = runtime(true);
    let (relay_commit, _) = PairingCommit::seal(&m, [5; 32]).unwrap();
    fresh
        .pairing_answer(join_args(&poll.code), relay_commit)
        .unwrap();
    let words = fresh.pairing_revealed(&poll, vec![relay_reveal]).unwrap();
    let fresh_key = signing_key(fresh_vault.as_ref(), AgentSlot::Negotiator.key_name())
        .unwrap()
        .verifying_key()
        .to_bytes();
    assert_eq!(
        words.words,
        pairing_words(fresh_key, m.identity.agent_key, &code).map(String::from)
    );
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
    let (_, words) = pair_by_code(&mut buyer, &mut seller, &offer, Side::Buyer, "buyer").unwrap();
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
    // At the cap, answering someone else's commit is refused too, and holds nothing.
    let extra_commit = buyer
        .pairing_commit(&PairingPollArgs {
            code: extra.code.clone(),
        })
        .unwrap();
    assert!(
        seller
            .pairing_answer(
                PairingJoinArgs {
                    code: extra.code,
                    peer: None,
                    side: Side::Seller,
                    payee: PayeeRef::new("merchant").unwrap(),
                },
                extra_commit,
            )
            .is_err()
    );
    assert!(seller.awaiting_reveal.is_empty());
    clock.0.store(86500, Ordering::SeqCst);
    assert!(seller.pairing_create(args()).is_ok());
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn counterparty_revoke_is_owner_only_revokes_the_pin_and_audits_once() {
    let (mut r, ..) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Buyer);
    let key = deal.counterparty.clone();
    let revoke = |key: &KeyId| {
        Action::CounterpartyRevoke(CounterpartyRevokeArgs {
            key_id: key.clone(),
        })
    };
    // The wrong window and a missing token cannot revoke.
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    assert!(
        r.execute(caller("main", Some(&token)), revoke(&key))
            .await
            .is_err()
    );
    assert!(
        r.execute(caller("approval", None), revoke(&key))
            .await
            .is_err()
    );
    let now = r.clock.now();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .pin_state(&key, now)
            .unwrap()
            .live()
    );
    // Unlocked, in the approval window, with the token: the pin is revoked, and stays so.
    unlock_runtime(&mut r);
    r.execute(caller("approval", Some(&token)), revoke(&key))
        .await
        .unwrap();
    r.execute(caller("approval", Some(&token)), revoke(&key))
        .await
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.pin_state(&key, now).unwrap(),
        table_ledger::PinState::Revoked
    );
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 500).unwrap();
    assert_eq!(
        rows.iter()
            .filter(|row| row.action == "counterparty.revoked")
            .count(),
        1
    );
}

/// A peer bundle handed in under the HOUSE code is refused for what it is: house pairing runs
/// through the relay join and the release pin (house_offer, house_pair), which shipped in P4,
/// never through a bare bundle. The refusal no longer says the house is deferred.
#[test]
fn a_bundle_under_the_house_code_is_refused_without_claiming_the_house_is_deferred() {
    let (mut buyer, ..) = runtime(true);
    let peer = forged_bundle(
        PairingCode::parse("HOUSE").unwrap().mailbox_hash(),
        Side::Seller,
        buyer.clock.now() + 3600,
    );
    let error = buyer
        .pairing_join(PairingJoinArgs {
            peer: Some(peer),
            ..join_args("HOUSE")
        })
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Invalid), "{error:?}");
    assert!(!error.message.contains("deferred"), "{error:?}");
    assert!(buyer.pending.is_empty());
}
