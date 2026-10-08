use crate::{Clause, MandatePayload, Mode, Money, MoneyError, Refusal, Terms, Timestamp};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RescueLever {
    DiscountThisCycle,
    Pause,
    RetryAfterFix,
    Downgrade,
}
#[derive(Debug, Clone)]
pub struct RescueContext {
    pub mode: Mode,
    pub outstanding: Money,
    pub next_retry: Option<Timestamp>,
}
#[derive(Debug, Error, PartialEq, Eq)]
pub enum RescueError {
    #[error("rescue lever not enabled")]
    NotEnabled,
    #[error("retry unavailable on replay or while PayPal retry is within 24 hours")]
    RetryUnavailable,
    #[error("capture exceeds outstanding balance")]
    ExceedsBalance,
    #[error("discount must be between 0 and 10000 basis points")]
    InvalidDiscount,
    #[error(transparent)]
    Money(#[from] MoneyError),
}
pub fn check_lever(
    lever: RescueLever,
    enabled: &[RescueLever],
    context: &RescueContext,
    amount: Money,
    now: Timestamp,
) -> Result<(), RescueError> {
    if !enabled.contains(&lever) {
        return Err(RescueError::NotEnabled);
    }
    if lever == RescueLever::RetryAfterFix {
        if context.mode == Mode::Replay
            || context
                .next_retry
                .is_some_and(|at| at.saturating_sub(now) <= 86400)
        {
            return Err(RescueError::RetryUnavailable);
        }
        amount.same_currency(context.outstanding)?;
        if amount.minor() == 0 || amount.minor() > context.outstanding.minor() {
            return Err(RescueError::ExceedsBalance);
        }
    }
    Ok(())
}
/// Discount rounds down in minor units, never increases the price.
pub fn discounted(amount: Money, basis_points: u16) -> Result<Money, RescueError> {
    if basis_points > 10000 {
        return Err(RescueError::InvalidDiscount);
    }
    let minor = i128::from(amount.minor()) * i128::from(10000 - basis_points) / 10000;
    let minor = i64::try_from(minor).map_err(|_| MoneyError::Overflow)?;
    Ok(Money::new(minor, amount.currency())?)
}

/// Where a failed renewal was learned from. `Replay` is a recorded failure the owner replayed
/// (PayPal offers no documented way to fail a sandbox renewal); its deal carries the REPLAY mode,
/// and nothing it is paid ever counts as recovered.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RescueSource {
    Replay,
    Paypal,
}

/// The one fix the wallet offers for one failed renewal: an invoice for the missed cycle at a
/// discount, inside the owner's signed fixes clause. Computed by the wallet, never by an agent.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RescueOffer {
    pub lever: RescueLever,
    /// The missed cycle at the plan's price.
    pub cycle: Money,
    /// Taken off this cycle only; the plan's price does not change.
    pub discount: Money,
    /// What the invoice asks: `cycle - discount`.
    pub invoice: Money,
    /// `discount` as basis points of `cycle`, rounded down. For display; the money fields bind.
    pub discount_bp: u16,
}

fn lever_refusal(reason: &str) -> Refusal {
    Refusal {
        clause: 8,
        reason: reason.into(),
    }
}

/// The signed fixes clause of a mandate: its levers, max basis points and max discount.
pub fn lever_clause(mandate: &MandatePayload) -> Option<(&[RescueLever], u16, Money)> {
    mandate.clauses.iter().find_map(|c| match c {
        Clause::Lever {
            levers,
            max_discount_bp,
            max_discount,
        } => Some((levers.as_slice(), *max_discount_bp, *max_discount)),
        _ => None,
    })
}

/// The largest discount the clause allows on `cycle`: `max_bp` of it rounded down, capped at
/// `max_discount`. The invoice is never zero and never above the cycle's price.
pub fn propose_discount(
    cycle: Money,
    max_bp: u16,
    max_discount: Money,
) -> Result<RescueOffer, RescueError> {
    cycle.same_currency(max_discount)?;
    if max_bp == 0 || max_bp >= 10000 || cycle.minor() < 2 {
        return Err(RescueError::InvalidDiscount);
    }
    // The share rounds down, so the discount never exceeds the signed share of the cycle.
    let by_share = i64::try_from(i128::from(cycle.minor()) * i128::from(max_bp) / 10000)
        .map_err(|_| MoneyError::Overflow)?;
    let minor = by_share.min(max_discount.minor());
    if minor == 0 {
        return Err(RescueError::InvalidDiscount);
    }
    let discount = Money::new(minor, cycle.currency())?;
    let invoice = Money::new(cycle.minor() - minor, cycle.currency())?;
    Ok(RescueOffer {
        lever: RescueLever::DiscountThisCycle,
        cycle,
        discount,
        invoice,
        discount_bp: basis_points(discount, cycle)?,
    })
}

fn basis_points(part: Money, whole: Money) -> Result<u16, RescueError> {
    let bp = i128::from(part.minor()) * 10000 / i128::from(whole.minor().max(1));
    u16::try_from(bp).map_err(|_| RescueError::InvalidDiscount)
}

/// The offer is inside the mandate's fixes clause and is exactly what the deal's terms invoice.
/// Every rescue money step runs this with the mandate check (table-app `mandate_check`).
pub fn check_offer(
    mandate: &MandatePayload,
    offer: &RescueOffer,
    terms: &Terms,
) -> Result<(), Refusal> {
    let (levers, max_bp, max_discount) =
        lever_clause(mandate).ok_or_else(|| lever_refusal("fixes clause missing"))?;
    if !levers.contains(&offer.lever) || offer.lever != RescueLever::DiscountThisCycle {
        return Err(lever_refusal("this fix is not allowed"));
    }
    let currency = offer.cycle.currency();
    if [offer.discount, offer.invoice, max_discount]
        .iter()
        .any(|m| m.currency() != currency)
        || terms.currency != currency
    {
        return Err(lever_refusal("currency differs from the fixes clause"));
    }
    if offer.discount.minor() == 0
        || offer.invoice.minor() == 0
        || offer.cycle.minor().checked_sub(offer.discount.minor()) != Some(offer.invoice.minor())
    {
        return Err(lever_refusal(
            "the invoice is not the cycle less the discount",
        ));
    }
    if offer.discount.minor() > max_discount.minor() {
        return Err(lever_refusal("discount above the most allowed per cycle"));
    }
    if i128::from(offer.discount.minor()) * 10000
        > i128::from(offer.cycle.minor()) * i128::from(max_bp)
    {
        return Err(lever_refusal("discount above the share allowed per cycle"));
    }
    if basis_points(offer.discount, offer.cycle).ok() != Some(offer.discount_bp) {
        return Err(lever_refusal("discount share does not match the amounts"));
    }
    if terms.qty != 1 || terms.unit_price != offer.invoice {
        return Err(lever_refusal("the deal does not invoice the offer"));
    }
    Ok(())
}

/// The invoice's wording, fixed in the wallet: the owner sees it before approving and PayPal
/// shows it to the subscriber. Only the offer's numbers fill it; no counterparty or agent text.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvoiceText {
    /// The one line item's name.
    pub item: String,
    /// The note to the subscriber.
    pub note: String,
}

/// A basis-point share in words: "20%", "12.5%", "33.33%".
pub fn percent(bp: u16) -> String {
    let whole = bp / 100;
    let frac = bp % 100;
    if frac == 0 {
        format!("{whole}%")
    } else if frac.is_multiple_of(10) {
        format!("{whole}.{}%", frac / 10)
    } else {
        format!("{whole}.{frac:02}%")
    }
}

/// The fixed template for a discount this cycle.
pub fn invoice_text(offer: &RescueOffer) -> InvoiceText {
    InvoiceText {
        item: "Your renewal for this cycle, at a one-time discount".into(),
        note: format!(
            "Your last renewal payment did not go through. This invoice covers this cycle at {} off: {} instead of {}. The discount is for this cycle only; your plan and its price stay the same.",
            percent(offer.discount_bp),
            offer.invoice,
            offer.cycle
        ),
    }
}

/// Watching the owner's own subscriptions for a failed renewal (rescue detection). The wallet
/// reads each watched subscription from PayPal at a modest cadence; a read never writes at PayPal
/// and never moves money. These are wallet guards, not PayPal limits.
pub const RESCUE_WATCH_READ_SECS: i64 = 6 * 3600;
/// The first wait after a read that could not be used; it doubles per try, up to the cadence.
pub const RESCUE_WATCH_RETRY_SECS: i64 = 300;
/// The most subscriptions one wallet watches.
pub const RESCUE_WATCH_MAX: usize = 20;
/// The most subscription reads the watch makes in one UTC day, across every watched subscription
/// (20 watches at four reads a day is 80; the rest is room for retries).
pub const RESCUE_WATCH_READS_DAY: u32 = 100;
/// The most reads one scheduler tick starts, so a long list never holds the tick.
pub const RESCUE_WATCH_PER_TICK: usize = 2;

/// When a watched subscription is read again after `tries` reads in a row that could not be used.
pub fn rescue_watch_retry_secs(tries: u32) -> i64 {
    let shift = tries.saturating_sub(1).min(16);
    RESCUE_WATCH_RETRY_SECS
        .saturating_mul(1_i64 << shift)
        .min(RESCUE_WATCH_READ_SECS)
}

/// What one subscription read says, in the only fields detection uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SubscriptionFacts {
    /// The subscription is ACTIVE or SUSPENDED (one cancelled or expired is never fixed).
    pub live: bool,
    /// PayPal's count of consecutive failed payments ("resets to 0 after a successful payment").
    pub failed_payments: u32,
    /// What PayPal shows owed, when the read carries it.
    pub owed: Option<Money>,
}

/// What detection does with one read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchVerdict {
    /// No failed payment: the renewals are paid, and a later failure is a new one.
    Paid,
    /// Exactly one failed payment, never fixed in this run of failures: open one rescue for it.
    Open { cycle: Money },
    /// A failure this watch already opened a fix for: nothing more, whatever the next read says,
    /// until PayPal shows a successful payment again.
    Handled,
    /// A failure detection does not fix: more than one cycle owed, no amount owed, or the
    /// subscription is not live.
    NoFix,
}

/// One fix per failure: a rescue opens only for exactly one failed payment with an amount owed on
/// a live subscription, and only once per run of failures (`handled`).
pub fn watch_verdict(facts: &SubscriptionFacts, handled: bool) -> WatchVerdict {
    if facts.failed_payments == 0 {
        return WatchVerdict::Paid;
    }
    if handled {
        return WatchVerdict::Handled;
    }
    match facts.owed {
        Some(cycle) if facts.live && facts.failed_payments == 1 && cycle.minor() > 0 => {
            WatchVerdict::Open { cycle }
        }
        _ => WatchVerdict::NoFix,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Currency;
    #[test]
    fn r1_retry_refuses_replay_near_retry_and_excess_balance() {
        let money = |v| Money::new(v, Currency::USD).unwrap();
        let mut c = RescueContext {
            mode: Mode::Replay,
            outstanding: money(1200),
            next_retry: None,
        };
        let enabled = [RescueLever::RetryAfterFix];
        assert_eq!(
            check_lever(enabled[0], &enabled, &c, money(1200), 0),
            Err(RescueError::RetryUnavailable)
        );
        c.mode = Mode::Sandbox;
        c.next_retry = Some(86400);
        assert_eq!(
            check_lever(enabled[0], &enabled, &c, money(1200), 0),
            Err(RescueError::RetryUnavailable)
        );
        c.next_retry = Some(86401);
        assert!(check_lever(enabled[0], &enabled, &c, money(1200), 0).is_ok());
        assert_eq!(
            check_lever(enabled[0], &enabled, &c, money(1201), 0),
            Err(RescueError::ExceedsBalance)
        );
        assert_eq!(discounted(money(1200), 2000).unwrap(), money(960));
    }
    fn rescue_mandate(max_bp: u16, max_discount: i64) -> MandatePayload {
        use crate::{Category, CpRule, DealKind, MandateId, PayeeRef, Role};
        let usd = |v| Money::new(v, Currency::USD).unwrap();
        MandatePayload {
            id: MandateId(ulid::Ulid::from(9_u128)),
            version: 1,
            agent_key: [1; 32],
            not_before: 0,
            expires: 1000,
            clauses: vec![
                Clause::Roles {
                    roles: vec![Role::Rescue],
                },
                Clause::Counterparties {
                    rule: CpRule::Subscribers,
                },
                Clause::PerDeal {
                    kind: DealKind::Rescue,
                    max_amount: usd(5000),
                    categories: vec![Category::Service],
                },
                Clause::Velocity {
                    max_deals_day: 5,
                    max_total_day: usd(20000),
                },
                Clause::HumanPresentOver { amount: usd(0) },
                Clause::Payees {
                    payees: vec![PayeeRef::new("shop").unwrap()],
                },
                Clause::Lever {
                    levers: vec![RescueLever::DiscountThisCycle],
                    max_discount_bp: max_bp,
                    max_discount: usd(max_discount),
                },
            ],
        }
    }
    fn terms_for(offer: &RescueOffer) -> Terms {
        Terms {
            item_ref: crate::ItemRef::new("care-plan").unwrap(),
            qty: 1,
            unit_price: offer.invoice,
            currency: offer.invoice.currency(),
            delivery: crate::Delivery::DigitalNow,
        }
    }
    #[test]
    fn the_offer_is_the_largest_discount_inside_both_bounds_and_checks_back() {
        let usd = |v| Money::new(v, Currency::USD).unwrap();
        // 20% of $12.00 is $2.40, under the $5.00 cap: the design's $9.60 invoice.
        let offer = propose_discount(usd(1200), 2000, usd(500)).unwrap();
        assert_eq!(
            (offer.discount, offer.invoice, offer.discount_bp),
            (usd(240), usd(960), 2000)
        );
        let m = rescue_mandate(2000, 500);
        assert!(m.validate().is_ok());
        assert!(check_offer(&m, &offer, &terms_for(&offer)).is_ok());
        // The money cap wins when it is lower than the share.
        let capped = propose_discount(usd(1200), 2000, usd(100)).unwrap();
        assert_eq!((capped.discount, capped.invoice), (usd(100), usd(1100)));
        assert_eq!(capped.discount_bp, 833);
        assert!(check_offer(&rescue_mandate(2000, 100), &capped, &terms_for(&capped)).is_ok());
        // A larger discount than signed, a forged share, or terms that invoice something else
        // are refused on clause 8.
        let tight = rescue_mandate(1000, 500);
        assert_eq!(
            check_offer(&tight, &offer, &terms_for(&offer))
                .unwrap_err()
                .clause,
            8
        );
        assert!(check_offer(&rescue_mandate(2000, 200), &offer, &terms_for(&offer)).is_err());
        let mut forged = offer;
        forged.discount_bp = 1000;
        assert!(check_offer(&m, &forged, &terms_for(&forged)).is_err());
        let mut sum = offer;
        sum.invoice = usd(900);
        assert!(check_offer(&m, &sum, &terms_for(&sum)).is_err());
        let mut other = terms_for(&offer);
        other.unit_price = usd(1200);
        assert!(check_offer(&m, &offer, &other).is_err());
        other = terms_for(&offer);
        other.qty = 2;
        assert!(check_offer(&m, &offer, &other).is_err());
        // Never a zero invoice, never a zero discount.
        assert!(propose_discount(usd(1), 2000, usd(500)).is_err());
        assert!(propose_discount(usd(1200), 0, usd(500)).is_err());
        assert!(propose_discount(usd(1200), 10000, usd(500)).is_err());
        assert!(propose_discount(usd(1200), 2000, Money::new(5, Currency::EUR).unwrap()).is_err());
    }
    #[test]
    fn proposed_offers_always_check_back_property_style() {
        let usd = |v| Money::new(v, Currency::USD).unwrap();
        for cycle in [2, 3, 7, 99, 1200, 4999, 100_000] {
            for bp in [1_u16, 50, 333, 2000, 5000, 9999] {
                for cap in [1, 7, 240, 100_000] {
                    let Ok(offer) = propose_discount(usd(cycle), bp, usd(cap)) else {
                        continue;
                    };
                    assert!(offer.invoice.minor() >= 1 && offer.invoice.minor() < cycle);
                    assert!(
                        check_offer(&rescue_mandate(bp, cap), &offer, &terms_for(&offer)).is_ok()
                    );
                }
            }
        }
    }
    #[test]
    fn the_invoice_text_is_fixed_and_filled_only_with_the_offer_numbers() {
        let usd = |v| Money::new(v, Currency::USD).unwrap();
        let text = invoice_text(&propose_discount(usd(1200), 2000, usd(500)).unwrap());
        assert_eq!(
            text.item,
            "Your renewal for this cycle, at a one-time discount"
        );
        assert_eq!(
            text.note,
            "Your last renewal payment did not go through. This invoice covers this cycle at 20% off: 9.60 USD instead of 12.00 USD. The discount is for this cycle only; your plan and its price stay the same."
        );
        assert_eq!(percent(1250), "12.5%");
        assert_eq!(percent(833), "8.33%");
        assert_eq!(percent(5), "0.05%");
    }
    #[test]
    fn a_rescue_mandate_needs_its_role_subscribers_rule_and_fixes_clause_together() {
        use crate::{CpRule, Role};
        let ok = rescue_mandate(2000, 500);
        assert!(ok.validate().is_ok());
        let mut no_lever = ok.clone();
        no_lever.clauses.retain(|c| c.number() != 8);
        assert_eq!(no_lever.validate().unwrap_err().clause, 8);
        let mut paired = ok.clone();
        paired.clauses[1] = Clause::Counterparties {
            rule: CpRule::Paired,
        };
        assert_eq!(paired.validate().unwrap_err().clause, 2);
        let mut mixed = ok.clone();
        mixed.clauses[0] = Clause::Roles {
            roles: vec![Role::Rescue, Role::Sell],
        };
        assert_eq!(mixed.validate().unwrap_err().clause, 2);
        for (levers, bp, cap) in [
            (vec![], 2000, 500),
            (vec![RescueLever::Pause], 2000, 500),
            (
                vec![
                    RescueLever::DiscountThisCycle,
                    RescueLever::DiscountThisCycle,
                ],
                2000,
                500,
            ),
            (vec![RescueLever::DiscountThisCycle], 0, 500),
            (vec![RescueLever::DiscountThisCycle], 10000, 500),
            (vec![RescueLever::DiscountThisCycle], 2000, 0),
        ] {
            let mut bad = ok.clone();
            bad.clauses[6] = Clause::Lever {
                levers,
                max_discount_bp: bp,
                max_discount: Money::new(cap, Currency::USD).unwrap(),
            };
            assert_eq!(bad.validate().unwrap_err().clause, 8);
        }
        let mut eur = ok;
        eur.clauses[6] = Clause::Lever {
            levers: vec![RescueLever::DiscountThisCycle],
            max_discount_bp: 2000,
            max_discount: Money::new(500, Currency::EUR).unwrap(),
        };
        assert_eq!(
            eur.validate().unwrap_err().reason,
            "currency differs across clauses"
        );
    }
    #[test]
    fn discount_property_style_never_increases_amount() {
        let amount = Money::new(999, Currency::USD).unwrap();
        for bp in 0..=10000 {
            assert!(discounted(amount, bp).unwrap().minor() <= 999);
        }
        assert!(discounted(amount, 10001).is_err());
    }
    #[test]
    fn a_watch_opens_one_fix_per_run_of_failures_and_only_for_one_cycle_owed() {
        let usd = |v| Money::new(v, Currency::USD).unwrap();
        let facts = |live, failed_payments, owed: Option<i64>| SubscriptionFacts {
            live,
            failed_payments,
            owed: owed.map(usd),
        };
        assert_eq!(
            watch_verdict(&facts(true, 1, Some(1200)), false),
            WatchVerdict::Open { cycle: usd(1200) }
        );
        // The same failure read again after its fix opened: nothing more.
        assert_eq!(
            watch_verdict(&facts(true, 1, Some(1200)), true),
            WatchVerdict::Handled
        );
        assert_eq!(
            watch_verdict(&facts(true, 2, Some(2400)), true),
            WatchVerdict::Handled
        );
        // A paid renewal ends the run, whatever was handled.
        for handled in [false, true] {
            assert_eq!(
                watch_verdict(&facts(true, 0, Some(0)), handled),
                WatchVerdict::Paid
            );
        }
        // Several cycles owed, nothing owed, no amount read, or a subscription that is not live.
        for f in [
            facts(true, 2, Some(2400)),
            facts(true, 1, Some(0)),
            facts(true, 1, None),
            facts(false, 1, Some(1200)),
        ] {
            assert_eq!(watch_verdict(&f, false), WatchVerdict::NoFix, "{f:?}");
        }
    }
    #[test]
    fn a_watch_that_cannot_read_backs_off_up_to_its_cadence() {
        assert_eq!(rescue_watch_retry_secs(1), RESCUE_WATCH_RETRY_SECS);
        assert_eq!(rescue_watch_retry_secs(2), 2 * RESCUE_WATCH_RETRY_SECS);
        assert_eq!(rescue_watch_retry_secs(4), 8 * RESCUE_WATCH_RETRY_SECS);
        let mut last = 0;
        for tries in 0..100 {
            let wait = rescue_watch_retry_secs(tries);
            assert!(wait >= last && wait <= RESCUE_WATCH_READ_SECS);
            last = wait;
        }
        assert_eq!(last, RESCUE_WATCH_READ_SECS);
        // The day's budget covers every watch at its cadence.
        let per_day = usize::try_from(86400 / RESCUE_WATCH_READ_SECS).unwrap();
        assert!(RESCUE_WATCH_MAX * per_day <= RESCUE_WATCH_READS_DAY as usize);
    }
}
