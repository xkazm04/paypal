//! T14 wallet-wide limits: the privileged sign, the read every window has, the refusal before any
//! network call across several mandates, never loosening a mandate, and fail-closed limits.
use super::*;
use table_app::{
    AgentRequest, AgentRole, AgentScope, AgentService, Authority, PurchaseInput, PurchaseLine,
};

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn limits(out: i64, held: i64, deals: u16) -> EnvelopeSignArgs {
    EnvelopeSignArgs {
        currency: Currency::USD,
        max_out_day: usd(out),
        max_held: usd(held),
        max_deals_day: deals,
        expires: 1_000_000,
    }
}
fn paired_peer(r: &mut Runtime) -> AgentSigner {
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
    peer
}
/// A purchase of $12 under its own mandate: N mandates, each well inside its own daily limit.
fn purchase(r: &mut Runtime, peer: &AgentSigner, price: i64) -> Deal {
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses: clauses(Side::Buyer, DealKind::Purchase),
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    r.create_deal(DealCreateArgs {
        kind: DealKind::Purchase,
        side: Side::Buyer,
        counterparty: peer.key_id().unwrap(),
        mandate_id: mandate.payload.id,
        mandate_version: 1,
        category: Category::Parts,
        terms: Terms {
            item_ref: ItemRef::new("monitor").unwrap(),
            qty: 1,
            unit_price: usd(price),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
    })
    .unwrap()
}
/// The agent's propose_purchase, exactly as the MCP tool calls it.
fn propose(r: &mut Runtime, deal: &Deal) -> Result<serde_json::Value, table_app::Error> {
    propose_qty(r, deal, 1)
}
fn propose_qty(
    r: &mut Runtime,
    deal: &Deal,
    qty: u32,
) -> Result<serde_json::Value, table_app::Error> {
    r.select_signer(deal.id).unwrap();
    let amount = deal.terms.unit_price.checked_mul(qty).unwrap().decimal();
    r.pipeline.wallet.invoke(
        &AgentScope {
            deal_id: deal.id,
            role: AgentRole::Shopper,
            category: Category::Parts,
        },
        AgentRequest::Purchase(PurchaseInput {
            payee_ref: PayeeRef::new("merchant").unwrap(),
            items: vec![PurchaseLine {
                item_ref: deal.terms.item_ref.clone(),
                qty,
            }],
            amount,
            category: Category::Parts,
        }),
        r.clock.now(),
    )
}
fn refused_rows(r: &Runtime, deal: DealId) -> Vec<Value> {
    r.pipeline
        .wallet
        .ledger
        .history_rows(Some(deal), None, None, 100)
        .unwrap()
        .0
        .into_iter()
        .filter(|row| row.action == "intent.refused")
        .map(|row| row.detail)
        .collect()
}

#[tokio::test]
async fn signing_limits_needs_the_approval_label_token_and_unlock_and_every_window_reads_them() {
    let (mut r, ..) = runtime(false);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        let error = r
            .execute(who, Action::EnvelopeSign(limits(3000, 3000, 3)))
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    }
    // The right window, but idle-locked.
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::EnvelopeSign(limits(3000, 3000, 3)),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Locked), "{error:?}");
    let owner = r.owner().unwrap().verifying_key();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .active_wallet_envelope(&owner)
            .unwrap()
            .is_none()
    );
    let token = unlock_runtime(&mut r);
    let signed: SignedEnvelope = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::EnvelopeSign(limits(3000, 3000, 3)),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(signed.payload.version, 1);
    // An unusable limit set is REFUSED with its reason before anything is signed.
    let mut zero = limits(3000, 3000, 3);
    zero.max_deals_day = 0;
    let error = r
        .execute(caller("approval", Some(&token)), Action::EnvelopeSign(zero))
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Refused), "{error:?}");
    let mut past = limits(3000, 3000, 3);
    past.expires = 50;
    assert!(
        r.execute(caller("approval", Some(&token)), Action::EnvelopeSign(past))
            .await
            .is_err()
    );
    assert_eq!(r.pipeline.wallet.ledger.next_envelope_version().unwrap(), 2);
    for label in ["main", "tumbler", "approval"] {
        let view: ExposureView = serde_json::from_value(
            r.execute(caller(label, None), Action::EnvelopeGet)
                .await
                .unwrap(),
        )
        .unwrap();
        assert_eq!(view.status, EnvelopeStatus::Active);
        assert_eq!(view.limits.unwrap().max_out_day, usd(3000));
        // Limits and numbers only: the signature never leaves Rust on this read.
        let raw = r
            .execute(caller(label, None), Action::EnvelopeGet)
            .await
            .unwrap();
        assert!(raw.get("owner_sig").is_none());
    }
}

#[test]
fn without_limits_nothing_changes_and_the_view_says_so() {
    let (mut r, ..) = runtime(true);
    let peer = paired_peer(&mut r);
    let view = r.envelope_view().unwrap();
    assert_eq!(view.status, EnvelopeStatus::None);
    assert!(view.limits.is_none() && view.currencies.is_empty());
    for _ in 0..4 {
        let deal = purchase(&mut r, &peer, 1200);
        propose(&mut r, &deal).unwrap();
    }
    let view = r.envelope_view().unwrap();
    assert_eq!(view.currencies[0].committed, usd(4800));
    assert_eq!(view.currencies[0].deals_today, 4);
    let snapshot = r.attention().unwrap();
    assert_eq!(snapshot.wallet_spend_today_minor, 4800);
    assert_eq!(snapshot.wallet_spend_today_currency, Some(Currency::USD));
    assert_eq!(snapshot.exposure.unwrap().status, EnvelopeStatus::None);
}

/// The card's demo: agents under separate mandates, each inside its own daily limit; the third
/// purchase is refused by the wallet limit with an `intent.refused` naming it and zero PayPal rows.
#[test]
fn the_wallet_limit_refuses_the_third_purchase_across_mandates_before_any_paypal_call() {
    let (mut r, _, http, ..) = runtime(true);
    let peer = paired_peer(&mut r);
    r.sign_envelope(limits(3000, 100_000, 10)).unwrap();
    let first = purchase(&mut r, &peer, 1200);
    let second = purchase(&mut r, &peer, 1200);
    let third = purchase(&mut r, &peer, 1200);
    assert_ne!(first.mandate_id, third.mandate_id);
    propose(&mut r, &first).unwrap();
    propose(&mut r, &second).unwrap();
    let error = propose(&mut r, &third).unwrap_err();
    let table_app::Error::Refused(refusal) = &error else {
        panic!("{error:?}");
    };
    assert_eq!(refusal.clause, ENVELOPE_CLAUSE);
    assert_eq!(
        error.to_string(),
        "wallet limit max_out_day: paid out today 24.00 + 12.00 above 30.00 USD"
    );
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(ledger.get_deal(third.id).unwrap().state, DealState::Refused);
    let rows = refused_rows(&r, third.id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["layer"], "wallet_limit");
    assert!(rows[0]["reason"].as_str().unwrap().contains("max_out_day"));
    for deal in [&first, &second, &third] {
        assert_eq!(ledger.paypal_call_count(deal.id).unwrap(), 0);
    }
    assert!(http.0.lock().unwrap().paths.is_empty());
    ledger.verify_audit().unwrap();
    // The meters read the fold: two agreed purchases, the refused one released.
    let snapshot = r.attention().unwrap();
    assert_eq!(snapshot.wallet_spend_today_minor, 2400);
    let view = snapshot.exposure.unwrap();
    assert_eq!(view.status, EnvelopeStatus::Active);
    assert_eq!(view.currencies[0].deals_today, 2);
    // A deal that agreed earlier is never refused by a later one: the second purchase's
    // checklist still passes the rules line (its day counts only the first before it).
    r.select_signer(second.id).unwrap();
    let (checks, _) = r.approval_checks(second.id).unwrap();
    let line = checks
        .iter()
        .find(|c| c.id == ApprovalCheckId::Mandate)
        .unwrap();
    assert_eq!(line.status, ApprovalCheckStatus::Pass, "{line:?}");
}

/// An owner decision on an agreed purchase is judged by the same limits: signing tighter limits
/// after it agreed stops the order before any reservation or network call.
#[tokio::test]
async fn tighter_limits_stop_an_owner_decision_before_any_paypal_call() {
    let (mut r, vault, http, ..) = runtime(true);
    credentials(vault.as_ref());
    let peer = paired_peer(&mut r);
    let deal = purchase(&mut r, &peer, 1200);
    propose(&mut r, &deal).unwrap();
    r.sign_envelope(limits(1000, 100_000, 10)).unwrap();
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    r.select_signer(deal.id).unwrap();
    let (checks, hash) = r.approval_checks(deal.id).unwrap();
    let line = checks
        .iter()
        .find(|c| c.id == ApprovalCheckId::Mandate)
        .unwrap();
    assert_eq!(line.status, ApprovalCheckStatus::Fail);
    assert_eq!(line.text, "Outside your rules: your wallet limits.");
    let mut args = decision(&mut r, deal.id);
    args.checks_hash = Some(hash);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Countersign)
        )
        .await
        .is_err()
    );
    // The pipeline itself refuses too, on a valid owner ticket, before any write.
    let ticket = r
        .pipeline
        .approval
        .ticket(
            "approval",
            &token,
            deal.id,
            deal.terms.hash().unwrap(),
            1,
            r.clock.now(),
        )
        .unwrap();
    let now = r.clock.now();
    let error = r
        .pipeline
        .create(deal.id, 1, Category::Parts, Authority::Owner(ticket), now)
        .await
        .unwrap_err();
    assert!(
        matches!(&error, table_app::Error::Refused(f) if f.clause == ENVELOPE_CLAUSE),
        "{error:?}"
    );
    let ledger = &r.pipeline.wallet.ledger;
    assert_eq!(ledger.paypal_call_count(deal.id).unwrap(), 0);
    assert!(!ledger.has_countersign(deal.id, 1).unwrap());
    assert_eq!(ledger.get_deal(deal.id).unwrap().state, DealState::Agreed);
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[test]
fn wide_wallet_limits_never_loosen_a_mandate() {
    let (mut r, ..) = runtime(true);
    let peer = paired_peer(&mut r);
    r.sign_envelope(limits(9_000_000, 9_000_000, 1000)).unwrap();
    // Three at $12 is $36, over the mandate's $25 per-deal limit: still refused, by the mandate
    // clause, whatever the wallet allows.
    let deal = purchase(&mut r, &peer, 1200);
    let error = propose_qty(&mut r, &deal, 3).unwrap_err();
    let table_app::Error::Refused(refusal) = error else {
        panic!("{error:?}");
    };
    assert_ne!(refusal.clause, ENVELOPE_CLAUSE);
    // One refusal row, the mandate's clause 3, never the wallet limit's.
    let rows = refused_rows(&r, deal.id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["layer"], "wallet");
    assert_eq!(
        rows[0]["code"],
        serde_json::json!({"code":"mandate_clause","clause":3})
    );
    // Inside both: allowed.
    let ok = purchase(&mut r, &peer, 1200);
    propose(&mut r, &ok).unwrap();
}

#[test]
fn expired_or_forged_limits_refuse_money_out_and_never_money_in() {
    let (mut r, _, _, clock, _) = runtime(true);
    let peer = paired_peer(&mut r);
    let mut short = limits(100_000, 100_000, 10);
    short.expires = 5000;
    r.sign_envelope(short).unwrap();
    let deal = purchase(&mut r, &peer, 1200);
    clock.0.store(5000, Ordering::SeqCst);
    assert_eq!(r.envelope_view().unwrap().status, EnvelopeStatus::Expired);
    let error = propose(&mut r, &deal).unwrap_err();
    assert!(
        error.to_string().starts_with("wallet limit expires:"),
        "{error}"
    );
    // Money in: a seller deal is never limited, whatever the limits say.
    let (seller, _) = setup(&mut r, Side::Seller);
    r.pipeline
        .wallet
        .envelope_check(&seller, r.clock.now())
        .unwrap();
    // Limits signed by any key but the owner's read as unverified: money out is refused in
    // plain words, never treated as "no limit".
    let mallory = AgentSigner::from_key(signing_key(&MemoryVault::default(), "mallory").unwrap());
    let forged = WalletEnvelope {
        version: 2,
        currency: Currency::USD,
        max_out_day: usd(9_000_000),
        max_held: usd(9_000_000),
        max_deals_day: 1000,
        expires: 1_000_000,
    };
    r.pipeline
        .wallet
        .ledger
        .insert_wallet_envelope(
            &SignedEnvelope {
                owner_sig: mallory.sign_wallet_envelope(&forged).unwrap(),
                payload: forged,
            },
            &mallory.public_key(),
            5000,
        )
        .unwrap();
    let view = r.envelope_view().unwrap();
    assert_eq!(view.status, EnvelopeStatus::Unverified);
    assert!(view.limits.is_none());
    let other = purchase(&mut r, &peer, 1200);
    let error = propose(&mut r, &other).unwrap_err();
    assert_eq!(
        error.to_string(),
        "wallet limit signature: the wallet limits could not be verified; sign them again"
    );
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .paypal_call_count(other.id)
            .unwrap(),
        0
    );
    r.pipeline
        .wallet
        .envelope_check(&seller, r.clock.now())
        .unwrap();
    // The owner signs again (the next version) and money out works within the new limits.
    r.sign_envelope(limits(100_000, 100_000, 10)).unwrap();
    assert_eq!(r.envelope_view().unwrap().status, EnvelopeStatus::Active);
    let last = purchase(&mut r, &peer, 1200);
    propose(&mut r, &last).unwrap();
}

/// Rules for $329 purchases: up to $400 each, $500 a day (clause 5), no ask-me limit reached.
fn daily_500(r: &mut Runtime) -> MandateId {
    let clauses = clauses(Side::Buyer, DealKind::Purchase)
        .into_iter()
        .map(|c| match c {
            Clause::PerDeal {
                kind, categories, ..
            } => Clause::PerDeal {
                kind,
                max_amount: usd(40_000),
                categories,
            },
            Clause::Band {
                item_refs,
                floor,
                max_rounds,
                deadline,
                ..
            } => Clause::Band {
                item_refs,
                floor,
                ceiling: Some(usd(40_000)),
                max_rounds,
                deadline,
            },
            Clause::Velocity { max_deals_day, .. } => Clause::Velocity {
                max_deals_day,
                max_total_day: usd(50_000),
            },
            Clause::HumanPresentOver { .. } => Clause::HumanPresentOver {
                amount: usd(40_000),
            },
            other => other,
        })
        .collect();
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Negotiator,
        clauses,
        not_before: 0,
        expires: 1_000_000,
    })
    .unwrap()
    .payload
    .id
}
/// A purchase at `price` under the mandate `mandate`, proposed by its agent: AGREED.
fn agreed_under(r: &mut Runtime, peer: &AgentSigner, mandate: MandateId, price: i64) -> Deal {
    let deal = r
        .create_deal(DealCreateArgs {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            counterparty: peer.key_id().unwrap(),
            mandate_id: mandate,
            mandate_version: 1,
            category: Category::Parts,
            terms: Terms {
                item_ref: ItemRef::new("monitor").unwrap(),
                qty: 1,
                unit_price: usd(price),
                currency: Currency::USD,
                delivery: Delivery::DigitalNow,
            },
        })
        .unwrap();
    propose(r, &deal).unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Agreed
    );
    deal
}
fn rules_line(r: &mut Runtime, id: DealId) -> ApprovalCheck {
    let (checks, _) = r.approval_checks(id).unwrap();
    checks
        .into_iter()
        .find(|c| c.id == ApprovalCheckId::Mandate)
        .unwrap()
}

/// C2: the rules line says what today's budget leaves after this purchase, from the gates' own
/// counting; another purchase agreeing changes the number, so the hash the owner saw goes stale.
#[tokio::test]
async fn the_rules_line_says_what_is_left_today_and_a_later_purchase_makes_the_old_hash_stale() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let peer = paired_peer(&mut r);
    let mandate = daily_500(&mut r);
    let first = agreed_under(&mut r, &peer, mandate, 32_900);
    let token = unlock_runtime(&mut r);
    r.selected = Some(first.id);

    // $500 a day, no earlier deal, $329: $171 left.
    let line = rules_line(&mut r, first.id);
    assert_eq!(line.status, ApprovalCheckStatus::Pass);
    assert_eq!(
        line.text,
        "Inside your rules: up to $400.00 per deal. After this, $171.00 of today’s $500.00 is left."
    );
    assert!(
        line.detail.contains(
            "clause 5 max_total_day 500.00 USD − (used today 0.00 USD + this 329.00 USD) = 171.00 USD left"
        ),
        "{}",
        line.detail
    );
    assert!(line.detail.contains("00:00 UTC"), "{}", line.detail);
    let seen = decision(&mut r, first.id);

    // A second $100 purchase agrees under the same rules: the first now reads $71.
    agreed_under(&mut r, &peer, mandate, 10_000);
    let line = rules_line(&mut r, first.id);
    assert_eq!(
        line.text,
        "Inside your rules: up to $400.00 per deal. After this, $71.00 of today’s $500.00 is left."
    );
    // The decision sent with the hash of the list that said $171 is refused, before anything.
    let audit_before = r.pipeline.wallet.ledger.audit_count().unwrap();
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(seen, Decision::Countersign),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::SUMMARY_CHANGED);
    assert!(matches!(error.code, ErrorCode::Invalid));
    assert_eq!(
        r.pipeline.wallet.ledger.audit_count().unwrap(),
        audit_before
    );
    assert_eq!(
        r.pipeline
            .wallet
            .ledger
            .paypal_call_count(first.id)
            .unwrap(),
        0
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    // The summary the owner reads now carries the hash that goes through the check.
    let fresh = decision(&mut r, first.id);
    assert_eq!(
        fresh.checks_hash,
        Some(r.summary(first.id).unwrap().checks_hash)
    );

    // Past UTC midnight the purchase's money counts in the day it agreed: no sentence.
    clock.0.store(86_400 + 100, Ordering::SeqCst);
    let line = rules_line(&mut r, first.id);
    assert_eq!(line.text, "Inside your rules: up to $400.00 per deal.");
}

/// C2: a $400 wallet limit leaves less than the $500 rule, so the line names the wallet limit.
#[test]
fn the_rules_line_names_the_wallet_limit_when_it_is_the_tighter_one() {
    let (mut r, ..) = runtime(true);
    let peer = paired_peer(&mut r);
    r.sign_envelope(limits(40_000, 100_000, 10)).unwrap();
    let mandate = daily_500(&mut r);
    let deal = agreed_under(&mut r, &peer, mandate, 32_900);
    let line = rules_line(&mut r, deal.id);
    assert_eq!(line.status, ApprovalCheckStatus::Pass);
    assert_eq!(
        line.text,
        "Inside your rules: up to $400.00 per deal. After this, $71.00 of your wallet’s $400.00 daily limit is left today."
    );
    for part in [
        "clause 5 max_total_day 500.00 USD − (used today 0.00 USD + this 329.00 USD) = 171.00 USD left",
        "wallet limit max_out_day 400.00 USD − (used today 0.00 USD + this 329.00 USD) = 71.00 USD left",
        "tighter: the wallet limit",
    ] {
        assert!(line.detail.contains(part), "{part} in {}", line.detail);
    }
}
