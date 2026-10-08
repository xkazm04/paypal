//! One test per approval check (pass and fail), over the pure `compose`.
#![allow(clippy::unwrap_used)]
use crate::{CheckFacts, MandateFact, PayeeFact, SettleFact, compose, plain_money};
use table_core::{
    ApprovalCheck, ApprovalCheckId, ApprovalCheckStatus as S, Currency, Deal, DealKind, DealState,
    Delivery, H256, ItemRef, KeyId, Mode, Money, PayeeRef, PaypalRefs, ShieldVerdict, Side, Terms,
};

const ID: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

fn deal(side: Side, state: DealState) -> Deal {
    Deal {
        created_at: 1,
        updated_at: 1,
        id: ID.parse().unwrap(),
        kind: DealKind::Haggle,
        side,
        counterparty: KeyId::new("dan-key").unwrap(),
        mandate_id: "01ARZ3NDEKTSV4RRFFQ69G5FAX".parse().unwrap(),
        mandate_version: 3,
        terms: Terms {
            item_ref: ItemRef::new("monitor-27-4k").unwrap(),
            qty: 1,
            unit_price: Money::new(32_900, Currency::USD).unwrap(),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state,
        transcript_head: H256::ZERO,
        paypal: PaypalRefs::default(),
        mode: Mode::Sandbox,
        market: None,
        shield: None,
        decided_by: None,
        shield_rule: None,
        shield_release: None,
    }
}
fn settle(minor: i64) -> SettleFact {
    SettleFact {
        amount: Money::new(minor, Currency::USD).unwrap(),
        invoice_id: format!("{ID}-1"),
        approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=7XK".into(),
        attempt: 1,
        authorize: true,
    }
}
fn payee(paired: bool, approved: Option<&[&str]>) -> PayeeFact {
    PayeeFact::Bound {
        payee: PayeeRef::new("north-desk").unwrap(),
        own: false,
        paired,
        approved: approved.map(|l| l.iter().map(|p| PayeeRef::new(*p).unwrap()).collect()),
    }
}
/// A READY buyer deal awaiting approval: every line passes.
fn ready(deal: &Deal) -> CheckFacts<'_> {
    CheckFacts {
        deal,
        attempt: 1,
        settle: Ok(Some(settle(32_900))),
        offer_terms: None,
        payee: payee(true, None),
        shield: Some(ShieldVerdict::Clear),
        shield_rule: None,
        shield_released: false,
        mandate: MandateFact::Allow {
            per_deal: Some(Money::new(34_000, Currency::USD).unwrap()),
            ask_above: None,
        },
    }
}
fn one(f: &CheckFacts<'_>, id: ApprovalCheckId) -> ApprovalCheck {
    compose(f).into_iter().find(|c| c.id == id).unwrap()
}
/// Layer 1 never names machinery: no clause numbers, ids, protocol verbs or hosts.
fn plain(c: &ApprovalCheck) {
    for word in [
        "clause",
        ID,
        "SETTLE",
        "MISMATCH",
        "paypal.com",
        "COUNTER",
        "invoice_id",
    ] {
        assert!(!c.text.contains(word), "{word} in {:?}", c.text);
    }
}

#[test]
fn a_ready_deal_composes_six_lines_in_order_all_passing_in_plain_words() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let checks = compose(&ready(&d));
    let ids: Vec<_> = checks.iter().map(|c| c.id).collect();
    assert_eq!(
        ids,
        [
            ApprovalCheckId::Amount,
            ApprovalCheckId::Payee,
            ApprovalCheckId::Host,
            ApprovalCheckId::Invoice,
            ApprovalCheckId::Shield,
            ApprovalCheckId::Mandate
        ]
    );
    for c in &checks {
        assert_eq!(c.status, S::Pass, "{c:?}");
        assert!(!c.detail.is_empty());
        plain(c);
    }
}

#[test]
fn amount_compares_the_settled_amount_with_the_signed_terms() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let pass = one(&ready(&d), ApprovalCheckId::Amount);
    assert_eq!(pass.status, S::Pass);
    assert!(pass.text.contains("$329.00"), "{}", pass.text);
    assert!(pass.detail.contains("329.00 USD"), "{}", pass.detail);

    let mut f = ready(&d);
    f.settle = Ok(Some(settle(33_900)));
    let fail = one(&f, ApprovalCheckId::Amount);
    assert_eq!(fail.status, S::Fail);
    assert_eq!(
        fail.text,
        "The payment request asks $339.00, but you agreed $329.00."
    );
    plain(&fail);

    let mut f = ready(&d);
    let mut s = settle(32_900);
    s.authorize = false;
    f.settle = Ok(Some(s));
    assert_eq!(one(&f, ApprovalCheckId::Amount).status, S::Fail);

    let mismatch = deal(Side::Buyer, DealState::Mismatch);
    let mut f = ready(&mismatch);
    f.settle = Ok(None);
    let m = one(&f, ApprovalCheckId::Amount);
    assert_eq!(m.status, S::Fail);
    assert!(m.text.contains("$329.00"));
    plain(&m);

    let mut f = ready(&d);
    f.settle = Err(());
    assert_eq!(one(&f, ApprovalCheckId::Amount).status, S::Fail);
}

#[test]
fn amount_waits_for_the_order_and_compares_an_offer_being_accepted() {
    let agreed = deal(Side::Seller, DealState::Agreed);
    let mut f = ready(&agreed);
    f.settle = Ok(None);
    let wait = one(&f, ApprovalCheckId::Amount);
    assert_eq!(
        wait.status,
        S::Wait,
        "an input after an IO step is never a pass"
    );
    assert!(wait.text.contains("when the PayPal order is made"));

    let negotiating = deal(Side::Buyer, DealState::Negotiating);
    let mut f = ready(&negotiating);
    f.settle = Ok(None);
    f.offer_terms = Some(negotiating.terms.hash().unwrap());
    let pass = one(&f, ApprovalCheckId::Amount);
    assert_eq!(pass.status, S::Pass);
    assert!(pass.text.contains("$329.00"));
    f.offer_terms = Some(H256([7; 32]));
    assert_eq!(one(&f, ApprovalCheckId::Amount).status, S::Fail);
}

#[test]
fn payee_is_the_paired_keys_declared_payee_or_the_owners_own_and_on_the_approved_list() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let mut f = ready(&d);
    assert_eq!(one(&f, ApprovalCheckId::Payee).status, S::Pass);
    f.payee = payee(true, Some(&["north-desk", "cablehaus"]));
    assert_eq!(one(&f, ApprovalCheckId::Payee).status, S::Pass);
    // An unpaired key's declared payee passes only when the owner listed it.
    f.payee = payee(false, Some(&["north-desk"]));
    assert_eq!(one(&f, ApprovalCheckId::Payee).status, S::Pass);

    f.payee = payee(false, None);
    let unpaired = one(&f, ApprovalCheckId::Payee);
    assert_eq!(unpaired.status, S::Fail);
    plain(&unpaired);
    f.payee = payee(true, Some(&["cablehaus"]));
    let unlisted = one(&f, ApprovalCheckId::Payee);
    assert_eq!(unlisted.status, S::Fail);
    assert!(unlisted.detail.contains("clause 7"), "{}", unlisted.detail);
    plain(&unlisted);
    f.payee = PayeeFact::Unreadable;
    assert_eq!(one(&f, ApprovalCheckId::Payee).status, S::Fail);

    let seller = deal(Side::Seller, DealState::Approved);
    let mut f = ready(&seller);
    f.payee = PayeeFact::Bound {
        payee: PayeeRef::new("maya-shop").unwrap(),
        own: true,
        paired: true,
        approved: Some(vec![PayeeRef::new("maya-shop").unwrap()]),
    };
    let own = one(&f, ApprovalCheckId::Payee);
    assert_eq!(own.status, S::Pass);
    assert!(own.text.contains("your own payee"));
}

#[test]
fn host_is_checked_only_when_a_link_exists_and_names_a_refused_host_in_detail() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let pass = one(&ready(&d), ApprovalCheckId::Host);
    assert_eq!(pass.status, S::Pass);
    assert!(pass.detail.contains("www.sandbox.paypal.com"));

    let mut f = ready(&d);
    let mut s = settle(32_900);
    s.approve_url = "https://paypal.evil.example/checkoutnow?token=7XK".into();
    f.settle = Ok(Some(s));
    let fail = one(&f, ApprovalCheckId::Host);
    assert_eq!(fail.status, S::Fail);
    assert!(
        fail.detail.contains("paypal.evil.example"),
        "{}",
        fail.detail
    );
    assert!(!fail.text.contains("evil"), "the host stays on Layer 2");

    let agreed = deal(Side::Seller, DealState::Agreed);
    let mut f = ready(&agreed);
    f.settle = Ok(None);
    assert_eq!(one(&f, ApprovalCheckId::Host).status, S::Wait);
    let negotiating = deal(Side::Buyer, DealState::Negotiating);
    let mut f = ready(&negotiating);
    f.settle = Ok(None);
    assert_eq!(one(&f, ApprovalCheckId::Host).status, S::NotApplicable);
}

#[test]
fn invoice_must_be_the_id_bound_to_this_deal_and_attempt() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let pass = one(&ready(&d), ApprovalCheckId::Invoice);
    assert_eq!(pass.status, S::Pass);
    assert!(pass.text.contains("1 of 3"));
    plain(&pass);

    let mut f = ready(&d);
    let mut s = settle(32_900);
    s.invoice_id = "01ARZ3NDEKTSV4RRFFQ69G5FAW-1".into();
    f.settle = Ok(Some(s));
    assert_eq!(one(&f, ApprovalCheckId::Invoice).status, S::Fail);
    let mut f = ready(&d);
    f.attempt = 2;
    assert_eq!(one(&f, ApprovalCheckId::Invoice).status, S::Fail);

    let agreed = deal(Side::Seller, DealState::Agreed);
    let mut f = ready(&agreed);
    f.settle = Ok(None);
    assert_eq!(one(&f, ApprovalCheckId::Invoice).status, S::Wait);
}

#[test]
fn shield_passes_clear_and_ask_and_fails_hold_block_and_an_unreadable_verdict() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let mut f = ready(&d);
    for (verdict, status) in [
        (Some(ShieldVerdict::Clear), S::Pass),
        (Some(ShieldVerdict::Ask), S::Pass),
        (Some(ShieldVerdict::Hold), S::Fail),
        (Some(ShieldVerdict::Block), S::Fail),
        (None, S::Fail),
    ] {
        f.shield = verdict;
        let c = one(&f, ApprovalCheckId::Shield);
        assert_eq!(c.status, status, "{verdict:?}");
        plain(&c);
    }
}

#[test]
fn the_shield_line_names_the_rule_from_rust_and_says_when_the_owner_released_it() {
    use table_core::ShieldRule;
    let d = deal(Side::Seller, DealState::Approved);
    let mut f = ready(&d);
    f.shield = Some(ShieldVerdict::Hold);
    f.shield_rule = Some(ShieldRule::PriceOverMarket);
    let held = one(&f, ApprovalCheckId::Shield);
    assert_eq!(held.status, S::Fail);
    assert_eq!(
        held.text,
        "Scam check: paused for you. The price is far above the usual price. Unpause it first."
    );
    assert!(held.detail.contains("price_over_market"));
    plain(&held);
    // A new payee over the threshold only asks (the settled design), in plain words.
    f.shield = Some(ShieldVerdict::Ask);
    f.shield_rule = Some(ShieldRule::NewCounterpartyOverThreshold);
    let ask = one(&f, ApprovalCheckId::Shield);
    assert_eq!(ask.status, S::Pass);
    assert!(
        ask.text
            .contains("A new payee is asking for a large amount.")
    );
    plain(&ask);
    // Released by the owner for these terms: it passes as the owner's decision, said as such.
    f.shield_rule = Some(ShieldRule::ModelCaution);
    f.shield_released = true;
    let released = one(&f, ApprovalCheckId::Shield);
    assert_eq!(released.status, S::Pass);
    assert!(
        released
            .text
            .starts_with("Scam check: you let this go on after a pause.")
    );
    assert!(released.text.contains("A second look asked for caution."));
    plain(&released);
    // A CLEAR names no rule.
    f.shield = Some(ShieldVerdict::Clear);
    f.shield_rule = None;
    f.shield_released = false;
    assert_eq!(
        one(&f, ApprovalCheckId::Shield).text,
        "Scam check: looks safe."
    );
    for rule in [
        ShieldRule::PayeeMismatch,
        ShieldRule::FriendsAndFamily,
        ShieldRule::NoMarketReference,
        ShieldRule::PriceOverMarket,
        ShieldRule::NewCounterpartyOverThreshold,
        ShieldRule::ModelCaution,
    ] {
        let words = crate::checks::shield_rule_words(rule);
        assert!(!words.contains('_') && !words.ends_with('.'), "{words}");
    }
}

#[test]
fn mandate_names_the_clause_that_applies_including_clause_6() {
    let d = deal(Side::Buyer, DealState::AwaitingApproval);
    let mut f = ready(&d);
    let allow = one(&f, ApprovalCheckId::Mandate);
    assert_eq!(allow.status, S::Pass);
    assert_eq!(allow.text, "Inside your rules: up to $340.00 per deal.");
    assert!(allow.detail.contains("clause 3"));

    f.mandate = MandateFact::Ask {
        clause: 6,
        threshold: Some(Money::new(25_000, Currency::USD).unwrap()),
    };
    let ask = one(&f, ApprovalCheckId::Mandate);
    assert_eq!(ask.status, S::Pass, "the owner decision satisfies clause 6");
    assert!(ask.text.contains("$250.00"));
    assert!(ask.detail.contains("clause 6"));
    plain(&ask);

    f.mandate = MandateFact::Refused {
        clause: 3,
        reason: "amount 329.00 above max_amount $300 per deal".into(),
    };
    let refused = one(&f, ApprovalCheckId::Mandate);
    assert_eq!(refused.status, S::Fail);
    assert_eq!(refused.text, "Outside your rules: the limit per deal.");
    assert!(refused.detail.contains("clause 3 refuses"));
    plain(&refused);

    for fact in [MandateFact::Retired, MandateFact::Unavailable] {
        f.mandate = fact;
        assert_eq!(one(&f, ApprovalCheckId::Mandate).status, S::Fail);
    }
}

#[test]
fn money_reads_like_the_window_formats_it() {
    let m = |minor, c| plain_money(Money::new(minor, c).unwrap());
    assert_eq!(m(32_900, Currency::USD), "$329.00");
    assert_eq!(m(132_900, Currency::USD), "$1,329.00");
    assert_eq!(m(5, Currency::EUR), "€0.05");
    assert_eq!(m(120_000, Currency::JPY), "120,000 JPY");
}
