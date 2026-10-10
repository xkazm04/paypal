//! The card's "if you do nothing" line, worded from the walk-away forecast in the same snapshot.
//!
//! A seller wallet may authorize and capture an order the buyer already approved on PayPal,
//! under the mandate the owner signed, with no click (AGENTS.md money authorities, DECISIONS 15).
//! A card that said "no money moves" there would contradict the forecast beside it. Pure; no line
//! here ever says money goes out.
use crate::{AttentionItem, AttentionSnapshot, AttentionSource, ForecastAction, ForecastLine};
use crate::{ForecastDirection, ForecastTrigger};
use table_core::{DealState, Side};

const LAPSE: &str = "the offer lapses at the deadline, no money moves";
const EXPIRE: &str = "the order expires at the deadline, no money moves";
const RELEASE: &str = "the hold is released at the deadline, nothing is paid";
const CREATE: &str = "the wallet sends the buyer the payment request; if they do not approve it, it expires and no money moves";
const COLLECT_NOW: &str = "the payment the buyer approved is collected";
const COLLECT_IF: &str =
    "if the buyer approves on PayPal in time, the payment is collected; if not, the order expires";
const HOLD_NOW: &str = "the payment the buyer approved is put on hold for you, and the hold is released if you do not take it";
const HOLD_IF: &str = "if the buyer approves on PayPal in time, the payment is put on hold for you, and the hold is released if you do not take it";
/// Promises nothing: used when the forecast could not be read for a seller deal that may move.
const UNKNOWN: &str = "what happens at the deadline could not be checked just now";

/// The line for one deal's forecast lines; `None` when the forecast has nothing for the deal.
fn from_lines(lines: &[&ForecastLine]) -> Option<&'static str> {
    let find = |action| lines.iter().find(|l| l.action == action);
    if let Some(capture) = find(ForecastAction::Capture) {
        debug_assert_eq!(capture.direction, ForecastDirection::In);
        return Some(if capture.trigger == ForecastTrigger::BuyerApproves {
            COLLECT_IF
        } else {
            COLLECT_NOW
        });
    }
    if let Some(authorize) = find(ForecastAction::Authorize) {
        return Some(if authorize.trigger == ForecastTrigger::BuyerApproves {
            HOLD_IF
        } else {
            HOLD_NOW
        });
    }
    if find(ForecastAction::CreateOrder).is_some() {
        return Some(CREATE);
    }
    Some(match lines.last()?.action {
        ForecastAction::Lapse => LAPSE,
        ForecastAction::Expire => EXPIRE,
        ForecastAction::AutoVoid => RELEASE,
        // A buyer's seller-attested deal: no attention card words it (it asks nothing of the owner).
        ForecastAction::CreateOrder
        | ForecastAction::Authorize
        | ForecastAction::Capture
        | ForecastAction::Unconfirm => {
            return None;
        }
    })
}

fn may_move(source: &AttentionSource) -> bool {
    source.side == Side::Seller
        && matches!(
            source.state,
            DealState::AwaitingApproval | DealState::Approved | DealState::Authorized
        )
}

fn reword(item: &mut AttentionItem, source: &AttentionSource, forecast: Option<&[ForecastLine]>) {
    // A money step being checked with PayPal keeps its own line: nothing is sent until then.
    // A rescue keeps its own line too: no rule ever sends its invoice, and an open invoice is
    // the subscriber's to pay, not the wallet's to collect.
    if source.money_check.is_some() || source.module == table_core::Module::Rescue {
        return;
    }
    match forecast {
        Some(all) => {
            let mine: Vec<&ForecastLine> =
                all.iter().filter(|l| l.deal_id == item.deal_id).collect();
            if let Some(line) = from_lines(&mine) {
                item.on_silence = line.to_owned();
            }
        }
        None if may_move(source) => item.on_silence = UNKNOWN.to_owned(),
        None => {}
    }
}

/// Word every card's `on_silence` from the snapshot's own forecast. Call after the forecast is
/// attached. A deal with no forecast line keeps the card's default line, which promises no
/// money in; with no forecast at all, a seller card that may move money promises nothing.
pub fn word_silence(snapshot: &mut AttentionSnapshot, sources: &[AttentionSource]) {
    let forecast = snapshot.forecast.take();
    for item in &mut snapshot.items {
        if let Some(source) = sources.iter().find(|s| s.deal_id == item.deal_id) {
            reword(item, source, forecast.as_deref());
        }
    }
    snapshot.forecast = forecast;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ForecastContext, ForecastSource, forecast, snapshot};
    use table_core::{Currency, DealKind, Delivery, Mode, Module, Money};

    const NOW: i64 = 1_000_000;
    type Pair = (AttentionSource, ForecastSource);

    fn pair(state: DealState, side: Side, delivery: Delivery, deadline: Option<i64>) -> Pair {
        let deal_id: table_core::DealId = format!("{:026}", 1).parse().unwrap();
        let amount = Money::new(2500, Currency::USD).unwrap();
        (
            AttentionSource {
                deal_id,
                display_number: 7,
                state,
                side,
                module: Module::Counter,
                amount,
                pairing_display_name: None,
                clause: None,
                deadline,
                mode: Mode::Sandbox,
                shield_hold: false,
                shield_rule: None,
                needs_owner_accept: false,
                money_check: None,
            },
            ForecastSource {
                deal_id,
                display_number: 7,
                state,
                side,
                kind: DealKind::ShopOrder,
                delivery,
                amount,
                deadline,
                mode: Mode::Sandbox,
                lapse_chosen: false,
                mandate_retired: false,
                policy_create_allowed: true,
                seller_mandate_until: Some(NOW + 3600),
                receipt_at: None,
            },
        )
    }
    fn ctx(executor_configured: bool) -> ForecastContext {
        ForecastContext {
            now: NOW,
            horizon_secs: 72 * 3600,
            paused: false,
            executor_configured,
        }
    }
    /// The card text for a deal, with the real forecast attached beside it.
    fn card(src: &Pair, ctx: &ForecastContext) -> (String, Vec<ForecastLine>) {
        let mut snap = snapshot(std::slice::from_ref(&src.0), NOW, 0, 0.0, false);
        snap.forecast = Some(forecast(std::slice::from_ref(&src.1), ctx));
        word_silence(&mut snap, std::slice::from_ref(&src.0));
        (
            snap.items[0].on_silence.clone(),
            snap.forecast.unwrap_or_default(),
        )
    }
    fn actions(lines: &[ForecastLine]) -> Vec<ForecastAction> {
        lines.iter().map(|l| l.action).collect()
    }

    #[test]
    fn a_money_check_keeps_its_own_line_whatever_the_forecast_says() {
        // Even a forecast that would collect (were it built for this deal) cannot reword the card
        // of a payment step being checked with PayPal: nothing is sent until PayPal confirms.
        let mut src = pair(
            DealState::Authorized,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        src.0.money_check = Some(table_core::MoneyCheck {
            step: table_core::MoneyCheckStep::Capture,
            state: table_core::MoneyCheckState::Parked,
            since: NOW - 60,
            next_check: Some(NOW + 60),
        });
        let (text, lines) = card(&src, &ctx(true));
        assert!(actions(&lines).contains(&ForecastAction::Capture));
        assert_eq!(text, crate::MONEY_CHECK_SILENCE);
    }
    #[test]
    fn card_matches_a_lapse_ending() {
        let src = pair(
            DealState::Agreed,
            Side::Buyer,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (text, lines) = card(&src, &ctx(true));
        assert_eq!(actions(&lines), [ForecastAction::Lapse]);
        assert_eq!(text, LAPSE);
    }
    #[test]
    fn card_matches_an_expire_ending() {
        let src = pair(
            DealState::AwaitingApproval,
            Side::Buyer,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (text, lines) = card(&src, &ctx(true));
        assert_eq!(actions(&lines), [ForecastAction::Expire]);
        assert_eq!(text, EXPIRE);
    }
    #[test]
    fn card_matches_an_auto_void_ending() {
        let src = pair(
            DealState::Authorized,
            Side::Buyer,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (text, lines) = card(&src, &ctx(true));
        assert_eq!(actions(&lines), [ForecastAction::AutoVoid]);
        assert_eq!(text, RELEASE);
    }
    #[test]
    fn card_matches_a_create_order_ending() {
        let src = pair(
            DealState::Agreed,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (text, lines) = card(&src, &ctx(true));
        assert_eq!(lines[0].action, ForecastAction::CreateOrder);
        assert_eq!(text, CREATE);
    }
    #[test]
    fn card_matches_an_authorize_ending() {
        let ship = Delivery::ShipThenCapture { days: 1 };
        let approved = pair(
            DealState::Approved,
            Side::Seller,
            ship.clone(),
            Some(NOW + 600),
        );
        let (text, lines) = card(&approved, &ctx(true));
        assert!(actions(&lines).contains(&ForecastAction::Authorize));
        assert_eq!(text, HOLD_NOW);
        let waiting = pair(
            DealState::AwaitingApproval,
            Side::Seller,
            ship,
            Some(NOW + 3000),
        );
        let (text, lines) = card(&waiting, &ctx(true));
        assert_eq!(lines[0].action, ForecastAction::Authorize);
        assert_eq!(text, HOLD_IF);
    }
    #[test]
    fn card_matches_a_capture_ending() {
        let approved = pair(
            DealState::Approved,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (text, lines) = card(&approved, &ctx(true));
        assert!(actions(&lines).contains(&ForecastAction::Capture));
        assert_eq!(text, COLLECT_NOW);
        let waiting = pair(
            DealState::AwaitingApproval,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 3000),
        );
        let (text, lines) = card(&waiting, &ctx(true));
        assert!(actions(&lines).contains(&ForecastAction::Capture));
        assert_eq!(text, COLLECT_IF);
        let held = pair(
            DealState::Authorized,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        assert_eq!(card(&held, &ctx(true)).0, COLLECT_NOW);
    }
    /// Differential: the same Approved seller deal, executor configured and not.
    #[test]
    fn without_a_payment_executor_the_card_does_not_claim_money_in() {
        let src = pair(
            DealState::Approved,
            Side::Seller,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let (on_text, on_lines) = card(&src, &ctx(true));
        assert!(
            on_lines
                .iter()
                .any(|l| l.direction == ForecastDirection::In)
        );
        assert_eq!(on_text, COLLECT_NOW);
        let (off_text, off_lines) = card(&src, &ctx(false));
        assert!(
            off_lines
                .iter()
                .all(|l| l.direction != ForecastDirection::In)
        );
        assert!(!off_text.contains("collected"), "{off_text}");
        assert_eq!(off_text, EXPIRE);
    }
    #[test]
    fn unreadable_forecast_promises_nothing_for_a_seller_that_may_move() {
        for state in [
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Authorized,
        ] {
            let src = pair(state, Side::Seller, Delivery::DigitalNow, Some(NOW + 600));
            let mut snap = snapshot(std::slice::from_ref(&src.0), NOW, 0, 0.0, false);
            assert!(snap.forecast.is_none());
            word_silence(&mut snap, std::slice::from_ref(&src.0));
            let text = &snap.items[0].on_silence;
            assert_eq!(text, UNKNOWN);
            assert!(!text.contains("no money moves") && !text.contains("collected"));
        }
        // A buyer card is not touched: its forecast never shows money in.
        let buyer = pair(
            DealState::Authorized,
            Side::Buyer,
            Delivery::DigitalNow,
            Some(NOW + 600),
        );
        let mut snap = snapshot(std::slice::from_ref(&buyer.0), NOW, 0, 0.0, false);
        let before = snap.items[0].on_silence.clone();
        word_silence(&mut snap, std::slice::from_ref(&buyer.0));
        assert_eq!(snap.items[0].on_silence, before);
    }

    /// No card says "no money moves" where its deal's forecast has money in, and none claims
    /// money in where it has none.
    #[test]
    fn card_and_forecast_agree_over_every_input() {
        let states = [
            DealState::Agreed,
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Authorized,
        ];
        let deliveries = [Delivery::DigitalNow, Delivery::ShipThenCapture { days: 1 }];
        let deadlines = [
            None,
            Some(NOW - 10),
            Some(NOW + 600),
            Some(NOW + 100 * 3600),
        ];
        let windows = [None, Some(NOW), Some(NOW + 600), Some(NOW + 100 * 3600)];
        let mut money_in_cards = 0;
        for state in states {
            for side in [Side::Buyer, Side::Seller] {
                for delivery in &deliveries {
                    for deadline in deadlines {
                        for window in windows {
                            for bits in 0_u8..16 {
                                let on = |n: u8| (bits >> n) & 1 == 1;
                                let mut src = pair(state, side, delivery.clone(), deadline);
                                src.1.seller_mandate_until = window;
                                src.1.lapse_chosen = on(0);
                                src.1.mandate_retired = on(1);
                                src.1.policy_create_allowed = on(2);
                                let configured = ForecastContext {
                                    paused: on(3),
                                    ..ctx(true)
                                };
                                let unconfigured = ForecastContext {
                                    executor_configured: false,
                                    ..configured
                                };
                                for c in [configured, unconfigured] {
                                    let (text, lines) = card(&src, &c);
                                    let money_in =
                                        lines.iter().any(|l| l.direction == ForecastDirection::In);
                                    assert_eq!(
                                        money_in,
                                        text.contains("collected"),
                                        "{text} / {lines:?}"
                                    );
                                    if money_in {
                                        money_in_cards += 1;
                                        assert!(!text.contains("no money moves"), "{text}");
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        assert!(money_in_cards > 0);
    }
}
