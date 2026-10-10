//! The quit confirm's lines, worded from the walk-away forecast.
//!
//! Quitting stops the wallet process: agents, PayPal polling and the scheduler stop until the
//! owner opens The Table again. That is not closing a window (the wallet keeps running in the
//! tray). The forecast says what the running wallet would do if nobody decides anything; every
//! money step in it is therefore something that will NOT happen while the wallet is off. What
//! PayPal does by itself (an unapproved payment request or a hold running out) still happens.
//! Pure; every string is ours, never counterparty text, and no line says money goes out.
use crate::{ForecastAction, ForecastLine, ForecastTrigger};
use serde::{Deserialize, Serialize};
use table_core::{Currency, DealId, DealState, Money, Side};

/// What one quit line says. The first four are what will not happen while the wallet is off,
/// the last three what still happens at PayPal by itself.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QuitEffect {
    /// The forecast creates the order: the payment request is not sent while off.
    RequestNotSent,
    /// The buyer already approved: the forecast authorizes (and captures) at the next tick.
    NotCollected,
    /// The forecast authorizes (and captures) once the buyer approves on PayPal.
    NotCollectedIfApproved,
    /// Nothing in the forecast moves money for this deal; it waits for the owner.
    Waits,
    /// An order awaiting approval: PayPal's approval window runs out by itself.
    RequestRunsOut,
    /// An authorization: PayPal ends the hold by itself when it runs out.
    HoldRunsOut,
    /// A purchase the owner already approved on PayPal: the seller can still collect it.
    SellerMayCollect,
}

#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct QuitLine {
    pub deal_id: DealId,
    pub label: String,
    pub effect: QuitEffect,
    pub amount_minor: i64,
    pub currency: Currency,
    /// One plain sentence, composed here.
    pub text: String,
}

/// One pending deal as the quit confirm sees it, built by the caller.
#[derive(Debug, Clone)]
pub struct QuitSource {
    pub deal_id: DealId,
    pub display_number: u32,
    pub state: DealState,
    pub side: Side,
    pub amount: Money,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QuitLines {
    /// What will not happen while the wallet is off.
    pub while_off: Vec<QuitLine>,
    /// What still happens at PayPal by itself.
    pub at_paypal: Vec<QuitLine>,
}

/// The general sentence under the lines.
pub const ON_QUIT: &str = "Quitting stops the wallet: agents stop, PayPal is not checked and deadlines wait until you open The Table again. Nothing is paid from here while it is off. To keep it working, close the window instead; the wallet stays in the tray.";

const REQUEST_NOT_SENT: &str =
    "The payment request is not sent to the buyer until you open The Table again.";
const NOT_COLLECTED: &str =
    "The payment the buyer approved is not collected until you open The Table again.";
const NOT_HELD: &str =
    "The payment the buyer approved is not put on hold for you until you open The Table again.";
const NOT_COLLECTED_IF: &str =
    "If the buyer approves on PayPal, the payment is not collected until you open The Table again.";
const NOT_HELD_IF: &str = "If the buyer approves on PayPal, the payment is not put on hold for you until you open The Table again.";
const WAITS: &str = "Waits for you. Nothing is paid from here while The Table is off.";
const WAITS_DEADLINE: &str = "Waits for you. If its time runs out, it ends when you open The Table again, and no money moves.";
// PayPal's approve link has a 6-hour default window (.research/paypal-platform.md:22, [S-spec]).
const REQUEST_RUNS_OUT: &str = "If it is not approved on PayPal in time, the payment request runs out there by itself. No money moves.";
// An authorization is valid for 29 days (.research/paypal-platform.md:22 and :114, [S]).
const HOLD_RUNS_OUT: &str = "Stays on hold at PayPal. If it is not collected, PayPal releases the hold by itself (29 days at most); the wallet releases it sooner once you are back and its time is up.";
// The payee captures an order the payer approved (.research/paypal-platform.md:361).
const SELLER_MAY_COLLECT: &str = "You approved this payment on PayPal, so the seller can still collect it while The Table is off.";

/// The while-off line from this deal's forecast lines, if the forecast moves money for it.
fn money_step(lines: &[&ForecastLine]) -> Option<(QuitEffect, &'static str)> {
    let find = |action| lines.iter().find(|l| l.action == action);
    let step = find(ForecastAction::Capture).or_else(|| find(ForecastAction::Authorize));
    if let Some(step) = step {
        let collects = step.action == ForecastAction::Capture;
        return Some(match (step.trigger, collects) {
            (ForecastTrigger::BuyerApproves, true) => {
                (QuitEffect::NotCollectedIfApproved, NOT_COLLECTED_IF)
            }
            (ForecastTrigger::BuyerApproves, false) => {
                (QuitEffect::NotCollectedIfApproved, NOT_HELD_IF)
            }
            (_, true) => (QuitEffect::NotCollected, NOT_COLLECTED),
            (_, false) => (QuitEffect::NotCollected, NOT_HELD),
        });
    }
    find(ForecastAction::CreateOrder).map(|_| (QuitEffect::RequestNotSent, REQUEST_NOT_SENT))
}

/// What PayPal still does by itself for a deal in this state, whoever's side it is on.
fn at_paypal(source: &QuitSource) -> Vec<(QuitEffect, &'static str)> {
    let mut out = Vec::new();
    if source.side == Side::Buyer
        && matches!(source.state, DealState::Approved | DealState::Authorized)
    {
        out.push((QuitEffect::SellerMayCollect, SELLER_MAY_COLLECT));
    }
    match source.state {
        DealState::AwaitingApproval => out.push((QuitEffect::RequestRunsOut, REQUEST_RUNS_OUT)),
        DealState::Authorized => out.push((QuitEffect::HoldRunsOut, HOLD_RUNS_OUT)),
        _ => {}
    }
    out
}

/// The quit confirm's lines for every pending deal, in the order given. Every pending deal gets
/// at least one line, so the confirm shows each one. With no pending deal, both lists are empty.
pub fn quit_lines(pending: &[QuitSource], forecast: &[ForecastLine]) -> QuitLines {
    let mut lines = QuitLines::default();
    for source in pending {
        let line = |effect, text: &str| QuitLine {
            deal_id: source.deal_id,
            label: format!("D-{:04}", source.display_number),
            effect,
            amount_minor: source.amount.minor(),
            currency: source.amount.currency(),
            text: text.to_owned(),
        };
        let mine: Vec<&ForecastLine> = forecast
            .iter()
            .filter(|l| l.deal_id == source.deal_id)
            .collect();
        let step = money_step(&mine);
        let paypal = at_paypal(source);
        if let Some((effect, text)) = step {
            lines.while_off.push(line(effect, text));
        } else if paypal.is_empty() {
            let text = if mine.iter().any(|l| l.trigger == ForecastTrigger::Deadline) {
                WAITS_DEADLINE
            } else {
                WAITS
            };
            lines.while_off.push(line(QuitEffect::Waits, text));
        }
        for (effect, text) in paypal {
            lines.at_paypal.push(line(effect, text));
        }
    }
    lines
}

/// The native quit dialog's plain text: the count, the two lists (deal number and amount, then
/// the sentence) and the general sentence. Deal numbers, never ids.
pub fn quit_message(
    pending: usize,
    while_off: Option<&[QuitLine]>,
    at_paypal: Option<&[QuitLine]>,
    on_quit: &str,
) -> String {
    let mut out = match pending {
        0 => String::from("Nothing is waiting for you."),
        1 => String::from("1 deal is still open."),
        n => format!("{n} deals are still open."),
    };
    let list = |out: &mut String, head: &str, lines: &[QuitLine]| {
        if lines.is_empty() {
            return;
        }
        out.push_str("\n\n");
        out.push_str(head);
        for line in lines {
            let amount = Money::new(line.amount_minor, line.currency)
                .map_or_else(|_| String::new(), |m| format!(" ({m})"));
            out.push_str(&format!("\n- {}{amount}: {}", line.label, line.text));
        }
    };
    match (while_off, at_paypal) {
        (Some(off), Some(paypal)) => {
            list(&mut out, "While The Table is off:", off);
            list(&mut out, "At PayPal, by itself:", paypal);
        }
        _ => out.push_str(
            "\n\nWhat each deal does while The Table is off could not be checked just now.",
        ),
    }
    out.push_str("\n\n");
    out.push_str(on_quit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ForecastContext, ForecastSource, forecast};
    use table_core::{DealKind, Delivery, Mode};

    const NOW: i64 = 1_000_000;

    fn id(n: u8) -> DealId {
        format!("{n:0>26}").parse().unwrap()
    }
    fn ctx() -> ForecastContext {
        ForecastContext {
            now: NOW,
            horizon_secs: 72 * 3600,
            paused: false,
            executor_configured: true,
        }
    }
    /// A pending deal and its forecast input, the seller mandate open for an hour.
    fn deal(
        n: u8,
        state: DealState,
        side: Side,
        delivery: Delivery,
    ) -> (QuitSource, ForecastSource) {
        let amount = Money::new(9000, Currency::USD).unwrap();
        (
            QuitSource {
                deal_id: id(n),
                display_number: u32::from(n) + 180,
                state,
                side,
                amount,
            },
            ForecastSource {
                deal_id: id(n),
                display_number: u32::from(n) + 180,
                state,
                side,
                kind: if side == Side::Seller {
                    DealKind::ShopOrder
                } else {
                    DealKind::Purchase
                },
                delivery,
                amount,
                deadline: Some(NOW + 5 * 3600),
                mode: Mode::Sandbox,
                lapse_chosen: false,
                mandate_retired: false,
                policy_create_allowed: true,
                seller_mandate_until: Some(NOW + 3600),
                receipt_at: None,
            },
        )
    }
    fn lines_for(deals: &[(QuitSource, ForecastSource)]) -> QuitLines {
        let sources: Vec<_> = deals.iter().map(|d| d.1.clone()).collect();
        let pending: Vec<_> = deals.iter().map(|d| d.0.clone()).collect();
        quit_lines(&pending, &forecast(&sources, &ctx()))
    }
    fn effects(lines: &[QuitLine]) -> Vec<QuitEffect> {
        lines.iter().map(|l| l.effect).collect()
    }

    #[test]
    fn a_seller_order_awaiting_the_buyer_is_not_collected_while_off() {
        let lines = lines_for(&[deal(
            9,
            DealState::AwaitingApproval,
            Side::Seller,
            Delivery::DigitalNow,
        )]);
        assert_eq!(
            effects(&lines.while_off),
            [QuitEffect::NotCollectedIfApproved]
        );
        assert_eq!(lines.while_off[0].text, NOT_COLLECTED_IF);
        assert!(lines.while_off[0].text.starts_with("If the buyer approves"));
        assert!(lines.while_off[0].text.contains("not collected"));
        assert_eq!(lines.while_off[0].label, "D-0189");
        assert_eq!(lines.while_off[0].amount_minor, 9000);
        // PayPal's own approval window still runs out by itself.
        assert_eq!(effects(&lines.at_paypal), [QuitEffect::RequestRunsOut]);
    }

    #[test]
    fn a_physical_seller_order_awaiting_the_buyer_is_not_put_on_hold_while_off() {
        let lines = lines_for(&[deal(
            9,
            DealState::AwaitingApproval,
            Side::Seller,
            Delivery::ShipThenCapture { days: 3 },
        )]);
        assert_eq!(lines.while_off[0].text, NOT_HELD_IF);
    }

    #[test]
    fn an_approved_seller_order_is_not_collected_while_off() {
        let lines = lines_for(&[deal(
            9,
            DealState::Approved,
            Side::Seller,
            Delivery::DigitalNow,
        )]);
        assert_eq!(effects(&lines.while_off), [QuitEffect::NotCollected]);
        assert_eq!(lines.while_off[0].text, NOT_COLLECTED);
        assert!(lines.at_paypal.is_empty());
    }

    #[test]
    fn an_agreed_seller_deal_does_not_send_the_request_while_off() {
        let lines = lines_for(&[deal(
            9,
            DealState::Agreed,
            Side::Seller,
            Delivery::DigitalNow,
        )]);
        assert_eq!(effects(&lines.while_off), [QuitEffect::RequestNotSent]);
        assert!(lines.at_paypal.is_empty());
    }

    #[test]
    fn an_authorized_hold_releases_at_paypal_by_itself() {
        let lines = lines_for(&[deal(
            0,
            DealState::Authorized,
            Side::Buyer,
            Delivery::ShipThenCapture { days: 3 },
        )]);
        assert!(lines.while_off.is_empty());
        assert_eq!(
            effects(&lines.at_paypal),
            [QuitEffect::SellerMayCollect, QuitEffect::HoldRunsOut]
        );
        assert!(
            lines.at_paypal[1]
                .text
                .contains("PayPal releases the hold by itself")
        );
    }

    #[test]
    fn a_seller_hold_is_not_collected_and_still_releases_at_paypal() {
        let lines = lines_for(&[deal(
            9,
            DealState::Authorized,
            Side::Seller,
            Delivery::DigitalNow,
        )]);
        assert_eq!(effects(&lines.while_off), [QuitEffect::NotCollected]);
        assert_eq!(effects(&lines.at_paypal), [QuitEffect::HoldRunsOut]);
    }

    #[test]
    fn a_buyer_offer_waits_and_ends_on_return() {
        let lines = lines_for(&[deal(
            3,
            DealState::Agreed,
            Side::Buyer,
            Delivery::DigitalNow,
        )]);
        assert_eq!(effects(&lines.while_off), [QuitEffect::Waits]);
        assert_eq!(lines.while_off[0].text, WAITS_DEADLINE);
        assert!(lines.at_paypal.is_empty());
    }

    #[test]
    fn a_pending_deal_without_any_forecast_line_still_gets_a_line() {
        let (source, _) = deal(3, DealState::Mismatch, Side::Buyer, Delivery::DigitalNow);
        let lines = quit_lines(&[source], &[]);
        assert_eq!(effects(&lines.while_off), [QuitEffect::Waits]);
        assert_eq!(lines.while_off[0].text, WAITS);
    }

    #[test]
    fn no_open_deals_means_nothing_pending() {
        assert_eq!(lines_for(&[]), QuitLines::default());
        // Forecast lines for deals that are not pending are not shown.
        let (_, source) = deal(9, DealState::Approved, Side::Seller, Delivery::DigitalNow);
        assert_eq!(
            quit_lines(&[], &forecast(&[source], &ctx())),
            QuitLines::default()
        );
    }

    #[test]
    fn every_pending_deal_is_shown_and_no_line_says_money_goes_out() {
        use DealState::*;
        let states = [Agreed, AwaitingApproval, Approved, Authorized, Mismatch];
        for side in [Side::Buyer, Side::Seller] {
            for delivery in [Delivery::DigitalNow, Delivery::ShipThenCapture { days: 3 }] {
                let deals: Vec<_> = states
                    .iter()
                    .enumerate()
                    .map(|(i, s)| deal(i as u8, *s, side, delivery.clone()))
                    .collect();
                let lines = lines_for(&deals);
                for (source, _) in &deals {
                    assert!(
                        lines
                            .while_off
                            .iter()
                            .chain(&lines.at_paypal)
                            .any(|l| l.deal_id == source.deal_id),
                        "{:?} {side:?} has no line",
                        source.state
                    );
                }
                for line in lines.while_off.iter().chain(&lines.at_paypal) {
                    let text = line.text.to_lowercase();
                    assert!(!text.contains("is paid") || text.contains("nothing is paid"));
                    assert!(!text.contains("sends"), "{text}");
                }
            }
        }
    }

    #[test]
    fn the_dialog_names_deal_numbers_and_both_lists() {
        let lines = lines_for(&[deal(
            9,
            DealState::AwaitingApproval,
            Side::Seller,
            Delivery::DigitalNow,
        )]);
        let text = quit_message(1, Some(&lines.while_off), Some(&lines.at_paypal), ON_QUIT);
        assert!(text.starts_with("1 deal is still open."));
        assert!(
            text.contains("While The Table is off:\n- D-0189 (90.00 USD): If the buyer approves")
        );
        assert!(
            text.contains("At PayPal, by itself:\n- D-0189 (90.00 USD): If it is not approved")
        );
        assert!(text.ends_with(ON_QUIT));
        assert!(!text.contains(&id(9).to_string()));
        let unknown = quit_message(2, None, None, ON_QUIT);
        assert!(unknown.starts_with("2 deals are still open."));
        assert!(unknown.contains("could not be checked just now"));
        assert!(!unknown.contains("While The Table is off:"));
    }
}
