use super::*;
use crate::canonical_bytes;

const T: Timestamp = 20_000 * DAY + 3_600; // 01:00 UTC on some day
fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn eur(minor: i64) -> Money {
    Money::new(minor, Currency::EUR).unwrap()
}
fn id(n: u128) -> DealId {
    DealId(ulid::Ulid::from(n))
}
fn deal(
    n: u128,
    state: DealState,
    amount: Money,
    agreed: Option<(i64, Timestamp)>,
) -> ExposureDeal {
    ExposureDeal {
        id: id(n),
        side: Side::Buyer,
        state,
        amount,
        created_at: T - 600,
        agreed,
    }
}
fn envelope(out: i64, held: i64, deals: u16) -> WalletEnvelope {
    WalletEnvelope {
        version: 1,
        currency: Currency::USD,
        max_out_day: usd(out),
        max_held: usd(held),
        max_deals_day: deals,
        expires: T + 30 * DAY,
    }
}
fn buy(amount: Money) -> EnvelopeIntent {
    EnvelopeIntent {
        side: Side::Buyer,
        amount,
    }
}
/// A tiny deterministic generator; tests never touch randomness from the OS.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self, n: u64) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (self.0 >> 33) % n
    }
}

#[test]
fn the_fold_splits_held_committed_and_today_per_currency_and_day() {
    let yesterday = T - DAY;
    let deals = vec![
        deal(1, DealState::Authorized, usd(6400), Some((1, T - 60))),
        deal(2, DealState::Agreed, usd(3000), Some((2, T - 30))),
        deal(3, DealState::Captured, usd(1000), Some((3, T - 20))),
        // Agreed yesterday and still held: held now, not in today's budget.
        deal(4, DealState::Authorized, usd(500), Some((0, yesterday))),
        // Another currency is never added to dollars.
        deal(5, DealState::AwaitingApproval, eur(2000), Some((4, T - 10))),
        // An open table counts nowhere.
        deal(6, DealState::Negotiating, usd(9999), None),
        // Released: never exposure, whatever its day.
        deal(7, DealState::Voided, usd(7777), Some((5, T - 5))),
        deal(8, DealState::Withdrawn, usd(7777), Some((6, T - 5))),
    ];
    let rows = fold_exposure(&deals, T).unwrap();
    assert_eq!(rows.len(), 2);
    let [eur_row, usd_row] = [rows[0], rows[1]];
    assert_eq!(eur_row.currency, Currency::EUR);
    assert_eq!(eur_row.committed, eur(2000));
    assert_eq!(eur_row.out_today, eur(2000));
    assert_eq!(eur_row.deals_today, 1);
    assert_eq!(usd_row.held, usd(6900));
    assert_eq!(usd_row.committed, usd(3000));
    assert_eq!(usd_row.paid_today, usd(1000));
    assert_eq!(usd_row.out_today, usd(10400));
    assert_eq!(usd_row.deals_today, 3);
    // Tomorrow the day's budget is empty; the holds are still held.
    let tomorrow = fold_exposure(&deals, T + DAY).unwrap();
    assert_eq!(tomorrow[1].out_today, usd(0));
    assert_eq!(tomorrow[1].deals_today, 0);
    assert_eq!(tomorrow[1].held, usd(6900));
    // Seller deals are money in: never exposure.
    let mut sold = deal(9, DealState::Authorized, usd(100), Some((7, T)));
    sold.side = Side::Seller;
    assert!(fold_exposure(&[sold], T).unwrap().is_empty());
}

#[test]
fn the_fold_is_order_independent_and_terminal_states_never_count() {
    let states = [
        DealState::Pairing,
        DealState::Negotiating,
        DealState::Agreed,
        DealState::Settling,
        DealState::AwaitingApproval,
        DealState::Approved,
        DealState::Authorized,
        DealState::Captured,
        DealState::Receipted,
        DealState::Withdrawn,
        DealState::Expired,
        DealState::Refused,
        DealState::Voided,
        DealState::AutoVoided,
        DealState::Refunded,
    ];
    let mut rng = Lcg(7);
    for _ in 0..200 {
        let mut deals: Vec<ExposureDeal> = (0..8)
            .map(|n| {
                let state = states[rng.next(states.len() as u64) as usize];
                let agreed =
                    (rng.next(3) > 0).then(|| (n as i64, T - rng.next(2 * DAY as u64) as i64));
                let amount = if rng.next(4) == 0 {
                    eur(100 + n as i64)
                } else {
                    usd(100 + n as i64)
                };
                deal(n as u128 + 1, state, amount, agreed)
            })
            .collect();
        let a = fold_exposure(&deals, T).unwrap();
        deals.reverse();
        assert_eq!(fold_exposure(&deals, T).unwrap(), a);
        for row in &a {
            let held: i64 = deals
                .iter()
                .filter(|d| d.state == DealState::Authorized && d.amount.currency() == row.currency)
                .map(|d| d.amount.minor())
                .sum();
            assert_eq!(row.held.minor(), held, "Authorized always counts as held");
            assert!(row.paid_today.minor() <= row.out_today.minor());
        }
        let released: Vec<_> = deals
            .iter()
            .filter(|d| released(d.state))
            .cloned()
            .collect();
        assert!(fold_exposure(&released, T).unwrap().is_empty());
    }
}

#[test]
fn a_deal_is_judged_against_the_deals_that_agreed_before_it_on_its_own_day() {
    let deals = vec![
        deal(1, DealState::Agreed, usd(6400), Some((10, T - 60))),
        deal(2, DealState::Agreed, usd(6400), Some((11, T - 60))),
        deal(3, DealState::Agreed, usd(6400), Some((12, T - 60))),
    ];
    // The first to agree sees nobody before it; the third sees two.
    assert_eq!(
        exposure_for_deal(&deals, id(1), Currency::USD, T)
            .unwrap()
            .deals_today,
        0
    );
    let third = exposure_for_deal(&deals, id(3), Currency::USD, T).unwrap();
    assert_eq!(third.deals_today, 2);
    assert_eq!(third.out_today, usd(12800));
    // Held and committed are "now", every other deal, whatever their order.
    assert_eq!(
        exposure_for_deal(&deals, id(1), Currency::USD, T)
            .unwrap()
            .committed,
        usd(12800)
    );
    // A deal not agreed yet is placed after everyone agreed so far.
    let fresh = exposure_for_deal(&deals, id(99), Currency::USD, T).unwrap();
    assert_eq!(fresh.deals_today, 3);
    // A deal past agreement whose agreement row is unreadable counts against every other deal
    // of its creation day.
    let unreadable = vec![
        deal(1, DealState::Captured, usd(500), None),
        deal(2, DealState::Agreed, usd(700), Some((1, T))),
    ];
    assert_eq!(
        exposure_for_deal(&unreadable, id(2), Currency::USD, T)
            .unwrap()
            .deals_today,
        1
    );
    // Judged on its own agreement day, not today.
    let old = vec![
        deal(1, DealState::Captured, usd(500), Some((1, T - DAY))),
        deal(2, DealState::Captured, usd(700), Some((2, T - DAY))),
    ];
    let seen = exposure_for_deal(&old, id(2), Currency::USD, T).unwrap();
    assert_eq!((seen.deals_today, seen.out_today), (1, usd(500)));
}

#[test]
fn each_limit_refuses_with_its_name_and_money_in_is_never_limited() {
    let e = envelope(15000, 15000, 3);
    let deals = vec![
        deal(1, DealState::Authorized, usd(6400), Some((1, T - 60))),
        deal(2, DealState::Authorized, usd(6400), Some((2, T - 50))),
    ];
    let x = exposure_for_deal(&deals, id(3), Currency::USD, T).unwrap();
    assert_eq!(e.check(&x, buy(usd(2200)), T), EnvelopeDecision::Allow);
    let refused = e.check(&x, buy(usd(6400)), T);
    assert_eq!(
        refused,
        EnvelopeDecision::refuse(
            EnvelopeLimit::OutDay,
            "paid out today 128.00 + 64.00 above 150.00 USD"
        )
    );
    assert_eq!(
        refused.into_result().unwrap_err().to_string(),
        "wallet limit max_out_day: paid out today 128.00 + 64.00 above 150.00 USD"
    );
    // The day's budget is wide, the holds are not.
    let wide = envelope(100_000, 15000, 9);
    assert!(matches!(
        wide.check(&x, buy(usd(6400)), T),
        EnvelopeDecision::Refuse {
            limit: EnvelopeLimit::Held,
            ..
        }
    ));
    let few = envelope(100_000, 100_000, 2);
    assert!(matches!(
        few.check(&x, buy(usd(100)), T),
        EnvelopeDecision::Refuse {
            limit: EnvelopeLimit::DealsDay,
            ..
        }
    ));
    let mut sell = buy(usd(1_000_000));
    sell.side = Side::Seller;
    assert_eq!(few.check(&x, sell, T), EnvelopeDecision::Allow);
    // Exactly at the limit is allowed; one minor unit over is not.
    assert_eq!(e.check(&x, buy(usd(2200)), T), EnvelopeDecision::Allow);
    assert!(matches!(
        e.check(&x, buy(usd(2201)), T),
        EnvelopeDecision::Refuse { .. }
    ));
}

#[test]
fn expired_foreign_currency_and_malformed_limits_fail_closed() {
    let e = envelope(15000, 15000, 3);
    let x = CurrencyExposure::zero(Currency::USD).unwrap();
    assert!(matches!(
        e.check(&x, buy(usd(1)), e.expires),
        EnvelopeDecision::Refuse {
            limit: EnvelopeLimit::Expired,
            ..
        }
    ));
    let xe = CurrencyExposure::zero(Currency::EUR).unwrap();
    assert!(matches!(
        e.check(&xe, buy(eur(1)), T),
        EnvelopeDecision::Refuse {
            limit: EnvelopeLimit::Currency,
            ..
        }
    ));
    let mut bad = e.clone();
    bad.max_deals_day = 0;
    assert!(bad.validate().is_err());
    assert!(matches!(
        bad.check(&x, buy(usd(1)), T),
        EnvelopeDecision::Refuse {
            limit: EnvelopeLimit::Unverified,
            ..
        }
    ));
    let mut mixed = e.clone();
    mixed.max_held = eur(100);
    assert_eq!(
        mixed.validate().unwrap_err().reason,
        "currency differs across wallet limits"
    );
    let mut v0 = e;
    v0.version = 0;
    assert!(v0.validate().is_err() && v0.hash().is_err());
}

#[test]
fn the_signed_bytes_are_domain_separated_and_commit_every_field() {
    let e = envelope(15000, 15000, 3);
    let bytes = e.signing_bytes().unwrap();
    assert!(bytes.starts_with(WALLET_ENVELOPE_DOMAIN));
    assert_ne!(bytes, canonical_bytes(&e).unwrap());
    let base = e.hash().unwrap();
    let changes: [fn(&mut WalletEnvelope); 5] = [
        |e| e.version = 2,
        |e| e.max_out_day = usd(15001),
        |e| e.max_held = usd(15001),
        |e| e.max_deals_day = 4,
        |e| e.expires += 1,
    ];
    for change in changes {
        let mut c = e.clone();
        change(&mut c);
        assert_ne!(c.hash().unwrap(), base);
    }
}

/// Acceptance for the card: N mandates x M deals can never take the wallet past its limits. Each
/// mandate's own velocity is wide; only the envelope bounds the wallet. Random proposals arrive,
/// each is judged as the pipeline judges it (after the mandate, before anything is written), and
/// admitted deals then move through random later states.
#[test]
fn no_sequence_of_deals_across_mandates_exceeds_the_envelope() {
    let e = envelope(25000, 15000, 5);
    let mut rng = Lcg(42);
    for _ in 0..300 {
        let mut deals: Vec<ExposureDeal> = Vec::new();
        let mut seq = 0_i64;
        for n in 0..20_u128 {
            let amount = usd(500 + rng.next(9000) as i64);
            let x = exposure_for_deal(&deals, id(n + 1), Currency::USD, T).unwrap();
            if e.check(&x, buy(amount), T) == EnvelopeDecision::Allow {
                seq += 1;
                deals.push(deal(n + 1, DealState::Agreed, amount, Some((seq, T))));
            }
            // Admitted deals move on: held, captured, voided or withdrawn.
            for d in &mut deals {
                d.state = match (d.state, rng.next(6)) {
                    (DealState::Agreed, 0) => DealState::Authorized,
                    (DealState::Agreed, 1) => DealState::Withdrawn,
                    (DealState::Authorized, 2) => DealState::Captured,
                    (DealState::Authorized, 3) => DealState::Voided,
                    (s, _) => s,
                };
            }
            let now = fold_exposure(&deals, T).unwrap();
            if let Some(row) = now.first() {
                assert!(row.out_today.minor() <= e.max_out_day.minor());
                assert!(row.at_stake().unwrap().minor() <= e.max_held.minor());
                assert!(row.deals_today <= e.max_deals_day);
            }
        }
    }
}
