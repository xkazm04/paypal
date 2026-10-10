//! Pure attention projections, deadline ladder and logical-pixel window arithmetic.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod forecast;
pub mod placement;
pub mod quit;
pub mod schedule;
pub mod silence;
pub use forecast::*;
pub use placement::*;
pub use quit::{QuitEffect, QuitLine, QuitLines, QuitSource, quit_lines, quit_message};
pub use schedule::{LADDER, LadderSchedule};
pub use silence::word_silence;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use table_core::{
    Currency, DealEvent, DealId, DealState, MandateId, Mode, Module, Money, MoneyCheck, Timestamp,
};

/// The card's line while a money step's PayPal outcome is being checked (T10). A parked step is
/// read back at the deal's deadline and what PayPal shows decides: a capture PayPal committed is
/// recorded as paid, and a hold PayPal shows keeps its own deadline (a seller's sale delivered at
/// once is collected under the seller's rules first). No release is promised here.
pub const MONEY_CHECK_SILENCE: &str = "at the deadline the wallet asks PayPal what happened, and what PayPal shows decides: a payment PayPal already took stays paid";
/// The card's line once the deal ended with a money step PayPal never showed in a form a check
/// accepts (`Ledger::end_unread_authorize`, or an order that lapsed unread): nothing more is
/// sent, and the owner looks at the payment in PayPal. The client keeps a byte-identical copy.
pub const MONEY_CHECK_ENDED_SILENCE: &str =
    "the deal has ended and the wallet sends nothing more: look at this payment in PayPal";
/// A seller's held payment at its deadline, when no forecast words it: the hold releases itself
/// and nothing is taken (the forecast line replaces it whenever the wallet would collect).
/// The client keeps a byte-identical copy.
pub const SELLER_AUTHORIZED_SILENCE: &str =
    "the hold releases itself at the deadline; nothing is taken";
/// A rescue fix waiting for the owner: nothing is sent, and PayPal retries the payment itself.
pub const RESCUE_SILENCE: &str = "nothing is sent · PayPal retries the payment by itself";
/// A rescue invoice with the subscriber: it stays open; nothing is collected by the wallet.
pub const RESCUE_SENT_SILENCE: &str =
    "the invoice stays open until it expires · nothing is charged unless the subscriber pays";

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttnKind {
    Gate,
    Hold,
    Stop,
    Motion,
    Receipt,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Urgency {
    Calm,
    Soon,
    Now,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TumblerAction {
    Review,
    Withdraw,
    LetLapse,
    Snooze30,
    OpenInTable,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClauseRef {
    pub mandate_id: MandateId,
    pub number: u8,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttentionItem {
    pub deal_id: DealId,
    pub label: String,
    pub kind: AttnKind,
    pub module: Module,
    pub headline: String,
    pub amount_minor: i64,
    pub currency: Currency,
    pub counterparty: Option<String>,
    pub clause: Option<ClauseRef>,
    pub deadline: Option<Timestamp>,
    pub on_silence: String,
    pub urgency: Urgency,
    pub mode: Mode,
    pub actions: Vec<TumblerAction>,
    /// Set while a money step's PayPal outcome is unknown: the card is a HOLD that only opens
    /// the deal. Older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub money_check: Option<MoneyCheck>,
    /// On a card the scam shield holds: the rule that holds it (a closed name the window words
    /// plainly; never counterparty text). Older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub shield_rule: Option<table_core::ShieldRule>,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AttentionSnapshot {
    pub items: Vec<AttentionItem>,
    pub stopped_today: u32,
    pub in_motion: u32,
    pub wallet_spend_today_minor: i64,
    // None while accounting is unavailable or there is no single wallet currency.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub wallet_spend_today_currency: Option<Currency>,
    // Estimate only. No policy code may consume this field.
    pub engine_estimate_today_usd: f64,
    pub locked: bool,
    // What the scheduler does to every open deal if the owner does nothing. None while it could
    // not be read; older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub forecast: Option<Vec<ForecastLine>>, // The wallet-wide limits and money out right now (T14): limits and numbers only. None while
    // they could not be read; older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub exposure: Option<table_core::ExposureView>,
}

/// Origin: pairing record confirmed by the owner. No merchant title, memo or NOTE field.
#[derive(Debug, Clone)]
pub struct AttentionSource {
    pub deal_id: DealId,
    pub display_number: u32,
    pub state: DealState,
    pub side: table_core::Side,
    pub module: Module,
    pub amount: Money,
    pub pairing_display_name: Option<String>,
    pub clause: Option<ClauseRef>,
    pub deadline: Option<Timestamp>,
    pub mode: Mode,
    pub shield_hold: bool,
    /// The rule that holds the deal, when the shield holds it (shield slice 2).
    pub shield_rule: Option<table_core::ShieldRule>,
    pub needs_owner_accept: bool,
    /// A money step whose PayPal outcome is not confirmed (T10).
    pub money_check: Option<MoneyCheck>,
}
impl AttentionSource {
    pub fn from_deal(
        deal: &table_core::Deal,
        display_number: u32,
        pairing_display_name: Option<String>,
        clause: Option<ClauseRef>,
        deadline: Option<Timestamp>,
    ) -> Result<Self, table_core::DomainError> {
        let module = match deal.kind {
            table_core::DealKind::Purchase => Module::Spend,
            table_core::DealKind::Haggle => Module::Tables,
            table_core::DealKind::ShopOrder => Module::Counter,
            table_core::DealKind::Rescue => Module::Rescue,
            table_core::DealKind::Invoice => Module::Book,
        };
        Ok(Self {
            deal_id: deal.id,
            display_number,
            state: deal.state,
            side: deal.side,
            module,
            amount: deal.terms.amount()?,
            pairing_display_name,
            clause,
            deadline,
            mode: deal.mode,
            shield_hold: deal.shield_held(),
            shield_rule: deal.shield_rule.filter(|_| deal.shield_held()),
            needs_owner_accept: false,
            money_check: None,
        })
    }
    pub fn item(&self, now: Timestamp) -> AttentionItem {
        if let Some(check) = self.money_check {
            return self.checking_item(check, now);
        }
        let rescue = self.module == Module::Rescue;
        let kind = if self.shield_hold || self.state == DealState::Mismatch {
            AttnKind::Hold
        } else if rescue
            && matches!(
                self.state,
                DealState::Settling | DealState::AwaitingApproval
            )
        {
            // The invoice is with the subscriber: nothing for the owner to decide.
            AttnKind::Motion
        } else if self.needs_owner_accept && self.state == DealState::Negotiating {
            AttnKind::Gate
        } else {
            match self.state {
                DealState::Agreed
                | DealState::AwaitingApproval
                | DealState::Approved
                | DealState::Authorized => AttnKind::Gate,
                DealState::Refused => AttnKind::Stop,
                DealState::Captured
                | DealState::Receipted
                | DealState::Reconciled
                | DealState::Withdrawn
                | DealState::Expired
                | DealState::Voided
                | DealState::AutoVoided
                | DealState::Refunded
                | DealState::Disputed
                | DealState::Failed
                // PayPal never showed the seller's payment: an end the owner reads, never a gate.
                | DealState::Unconfirmed => AttnKind::Receipt,
                _ => AttnKind::Motion,
            }
        };
        let action = match (kind, self.state) {
            (AttnKind::Gate, DealState::Agreed) if rescue => "Approve rescue lever",
            (AttnKind::Motion, DealState::Settling) if rescue => "Sending invoice",
            (AttnKind::Motion, DealState::AwaitingApproval) if rescue => "Invoice sent",
            (AttnKind::Gate, DealState::Authorized) if self.side == table_core::Side::Seller => {
                "Collect or release"
            }
            (AttnKind::Gate, DealState::Authorized) => "Capture or void",
            (AttnKind::Gate, DealState::AwaitingApproval) => "Review payment",
            (AttnKind::Gate, _) => "Countersign",
            (AttnKind::Hold, _) => "Payment held",
            (AttnKind::Stop, _) => "Request stopped",
            (AttnKind::Motion, _) => "Negotiating",
            (AttnKind::Receipt, _) => "Deal updated",
        };
        let on_silence = if rescue && self.state == DealState::Agreed {
            RESCUE_SILENCE
        } else if rescue
            && matches!(
                self.state,
                DealState::Settling | DealState::AwaitingApproval
            )
        {
            RESCUE_SENT_SILENCE
        } else if self.state == DealState::Authorized && self.side == table_core::Side::Seller {
            SELLER_AUTHORIZED_SILENCE
        } else if self.state == DealState::Authorized {
            "authorization auto-voids at the deadline; no capture"
        } else {
            "the offer or order lapses at the deadline; no money moves"
        }
        .to_owned();
        // Offer only what the state machine will accept, so no card carries a dead button.
        let allows = |event| table_core::transition(self.state, event).is_ok();
        let mut actions = vec![TumblerAction::OpenInTable];
        if kind == AttnKind::Gate {
            actions.insert(0, TumblerAction::Review);
            if self.state != DealState::Authorized && allows(DealEvent::Withdraw) {
                actions.push(TumblerAction::Withdraw);
            }
            if self.state != DealState::Authorized && allows(DealEvent::Deadline) {
                actions.push(TumblerAction::LetLapse);
            }
            if LADDER.snooze_allowed(self.deadline, now) {
                actions.push(TumblerAction::Snooze30);
            }
        } else if kind == AttnKind::Hold
            && self.state != DealState::Authorized
            && allows(DealEvent::Withdraw)
        {
            actions.push(TumblerAction::Withdraw);
        }
        AttentionItem {
            deal_id: self.deal_id,
            label: format!("D-{:04}", self.display_number),
            kind,
            module: self.module,
            headline: format!("{action} {}", self.amount),
            amount_minor: self.amount.minor(),
            currency: self.amount.currency(),
            counterparty: self.pairing_display_name.clone(),
            clause: self.clause.clone(),
            deadline: self.deadline,
            on_silence,
            urgency: urgency(self.deadline, now),
            mode: self.mode,
            actions,
            money_check: None,
            shield_rule: self.shield_rule.filter(|_| self.shield_hold),
        }
    }
    /// A deal whose money step is being checked with PayPal: a HOLD with no decision on it and
    /// no way to walk away, because the deal stays reserved until PayPal's record settles it.
    /// A deal that ended with the step still unsettled keeps the HOLD, with no clock: the wallet
    /// stopped asking and sends nothing more, and the owner looks at the payment in PayPal.
    fn checking_item(&self, check: MoneyCheck, now: Timestamp) -> AttentionItem {
        let ended = self.state.terminal();
        let deadline = self.deadline.filter(|_| !ended);
        AttentionItem {
            deal_id: self.deal_id,
            label: format!("D-{:04}", self.display_number),
            kind: AttnKind::Hold,
            module: self.module,
            headline: if ended {
                format!("Look at {} in PayPal", self.amount)
            } else {
                format!("Checking with PayPal {}", self.amount)
            },
            amount_minor: self.amount.minor(),
            currency: self.amount.currency(),
            counterparty: self.pairing_display_name.clone(),
            clause: None,
            deadline,
            on_silence: if ended {
                MONEY_CHECK_ENDED_SILENCE
            } else {
                MONEY_CHECK_SILENCE
            }
            .to_owned(),
            urgency: urgency(deadline, now),
            mode: self.mode,
            actions: vec![TumblerAction::OpenInTable],
            money_check: Some(check),
            shield_rule: None,
        }
    }
}
pub fn urgency(deadline: Option<Timestamp>, now: Timestamp) -> Urgency {
    match deadline.map(|d| d.saturating_sub(now)) {
        Some(left) if left <= LADDER.notify_secs => Urgency::Now,
        Some(left) if left <= LADDER.breathe_secs => Urgency::Soon,
        _ => Urgency::Calm,
    }
}
/// View-only dimming. Imminent gates stay legible even after the owner stops interacting.
pub fn quiet_opacity_percent(
    items: &[AttentionItem],
    last_interaction: Timestamp,
    now: Timestamp,
) -> u8 {
    let imminent = items
        .iter()
        .any(|item| item.kind == AttnKind::Gate && LADDER.breathes(item.deadline, now));
    if now.saturating_sub(last_interaction) >= LADDER.quiet_after_secs && !imminent {
        LADDER.quiet_opacity_percent
    } else {
        100
    }
}
pub fn snapshot(
    sources: &[AttentionSource],
    now: Timestamp,
    wallet_spend_today_minor: i64,
    engine_estimate_today_usd: f64,
    locked: bool,
) -> AttentionSnapshot {
    let mut items = Vec::new();
    let mut stopped_today = 0_u32;
    let mut in_motion = 0_u32;
    for source in sources {
        let item = source.item(now);
        match item.kind {
            AttnKind::Gate | AttnKind::Hold => items.push(item),
            AttnKind::Stop => stopped_today = stopped_today.saturating_add(1),
            AttnKind::Motion => in_motion = in_motion.saturating_add(1),
            AttnKind::Receipt => {}
        }
    }
    items.sort_by_key(|i| (i.deadline.unwrap_or(i64::MAX), i.deal_id));
    AttentionSnapshot {
        items,
        stopped_today,
        in_motion,
        wallet_spend_today_minor,
        wallet_spend_today_currency: None,
        engine_estimate_today_usd,
        locked,
        forecast: None,
        exposure: None,
    }
}

#[derive(Debug, Default)]
pub struct AttentionLadder {
    notified: HashSet<(DealId, Option<Timestamp>)>,
    suppressed: HashSet<(DealId, Option<Timestamp>)>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LadderEffects {
    pub show_without_activation: bool,
    pub breathe: bool,
    pub notify: bool,
    /// The notification was due but Do Not Disturb (or the system's quiet) held it back: once
    /// per card and deadline, so the wallet can record that the owner was not told.
    pub suppressed: bool,
    pub tray_dot: bool,
}
impl AttentionLadder {
    /// Drop notification marks for cards no longer on the stack, so a long-running shell does
    /// not grow one entry per deal forever. The durable claim in the ledger still prevents a
    /// repeat notification if a card returns.
    pub fn forget_absent(&mut self, items: &[AttentionItem]) {
        let live: HashSet<_> = items.iter().map(|i| (i.deal_id, i.deadline)).collect();
        self.notified.retain(|key| live.contains(key));
        self.suppressed.retain(|key| live.contains(key));
    }
    /// Take back a rung whose toast could not be shown, so a later tick inside the same rung
    /// can try again.
    pub fn release(&mut self, deal_id: DealId, deadline: Timestamp) {
        self.notified.remove(&(deal_id, Some(deadline)));
    }
    pub fn evaluate(
        &mut self,
        item: &AttentionItem,
        now: Timestamp,
        dnd: bool,
        reduced_motion: bool,
    ) -> LadderEffects {
        let gate = item.kind == AttnKind::Gate;
        let urgent = gate && LADDER.notify_due(item.deadline, now);
        let key = (item.deal_id, item.deadline);
        let notify = urgent && !dnd && self.notified.insert(key);
        let suppressed = urgent && dnd && self.suppressed.insert(key);
        LadderEffects {
            show_without_activation: gate || item.kind == AttnKind::Hold,
            breathe: gate && LADDER.breathes(item.deadline, now) && !dnd && !reduced_motion,
            notify,
            suppressed,
            tray_dot: matches!(item.kind, AttnKind::Gate | AttnKind::Hold),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(number: u32, deadline: i64) -> AttentionSource {
        AttentionSource {
            needs_owner_accept: false,
            deal_id: format!("{:026}", number).parse().unwrap(),
            display_number: number,
            state: DealState::Agreed,
            side: table_core::Side::Buyer,
            module: Module::Tables,
            amount: Money::new(32900, Currency::USD).unwrap(),
            pairing_display_name: Some("Dan".into()),
            clause: None,
            deadline: Some(deadline),
            mode: Mode::Sandbox,
            shield_hold: false,
            shield_rule: None,
            money_check: None,
        }
    }
    #[test]
    fn ladder_boundaries_and_w5_one_notification_dnd() {
        for (seconds, expected) in [
            (7201, Urgency::Calm),
            (7200, Urgency::Soon),
            (901, Urgency::Soon),
            (900, Urgency::Now),
        ] {
            assert_eq!(urgency(Some(seconds), 0), expected);
        }
        let item = source(1, 840).item(0);
        let mut ladder = AttentionLadder::default();
        assert!(!ladder.evaluate(&item, 0, true, false).notify);
        assert!(ladder.evaluate(&item, 0, false, false).notify);
        assert!(!ladder.evaluate(&item, 1, false, false).notify);
        assert!(!ladder.evaluate(&item, 841, false, false).notify);
        ladder.forget_absent(std::slice::from_ref(&item));
        assert_eq!(ladder.notified.len(), 1);
        ladder.forget_absent(&[]);
        assert!(ladder.notified.is_empty());
    }
    #[test]
    fn w4_tumbler_schema_has_no_untrusted_text_and_w11_lock_preserves_items() {
        let s = source(1, 840);
        let view = snapshot(&[s], 0, 0, 0.0, true);
        let json = serde_json::to_string(&view).unwrap();
        assert!(!json.contains("note"));
        assert!(!json.contains("ignore previous instructions"));
        assert!(view.locked);
        assert_eq!(view.items.len(), 1);
        assert!(!view.items[0].on_silence.is_empty());
    }
    #[test]
    fn a_money_check_is_a_hold_that_only_opens_the_deal_and_never_promises_money() {
        for state in [
            DealState::Settling,
            DealState::Approved,
            DealState::Authorized,
        ] {
            for parked in [
                table_core::MoneyCheckState::Checking,
                table_core::MoneyCheckState::Parked,
            ] {
                let mut s = source(1, 8000);
                s.state = state;
                s.money_check = Some(MoneyCheck {
                    step: table_core::MoneyCheckStep::Capture,
                    state: parked,
                    since: 0,
                    next_check: None,
                });
                let item = s.item(0);
                assert_eq!(item.kind, AttnKind::Hold);
                assert_eq!(item.actions, vec![TumblerAction::OpenInTable]);
                assert!(item.headline.starts_with("Checking with PayPal"));
                assert_eq!(item.on_silence, MONEY_CHECK_SILENCE);
                assert_eq!(item.money_check, s.money_check);
                let mut ladder = AttentionLadder::default();
                let fx = ladder.evaluate(&item, 0, false, false);
                assert!(fx.show_without_activation && fx.tray_dot && !fx.notify);
            }
        }
    }
    #[test]
    fn an_authorized_gate_reads_by_side_collect_for_a_seller_capture_for_a_buyer() {
        let mut s = source(1, 8000);
        s.state = DealState::Authorized;
        let buyer = s.item(0);
        assert_eq!(buyer.kind, AttnKind::Gate);
        assert_eq!(buyer.headline, "Capture or void 329.00 USD");
        assert_eq!(
            buyer.on_silence,
            "authorization auto-voids at the deadline; no capture"
        );
        s.side = table_core::Side::Seller;
        let seller = s.item(0);
        assert_eq!(seller.kind, AttnKind::Gate);
        assert_eq!(seller.headline, "Collect or release 329.00 USD");
        assert_eq!(seller.on_silence, SELLER_AUTHORIZED_SILENCE);
        assert!(!seller.on_silence.contains("capture") && !seller.on_silence.contains("void"));
    }
    #[test]
    fn a_deal_that_ended_with_its_money_step_unsettled_says_to_look_in_paypal_with_no_clock() {
        let mut s = source(1, 8000);
        s.state = DealState::Expired;
        s.money_check = Some(MoneyCheck {
            step: table_core::MoneyCheckStep::Authorize,
            state: table_core::MoneyCheckState::Parked,
            since: 0,
            next_check: None,
        });
        let item = s.item(9000);
        assert_eq!(item.kind, AttnKind::Hold);
        assert_eq!(item.actions, vec![TumblerAction::OpenInTable]);
        assert!(item.headline.starts_with("Look at "));
        assert!(item.headline.ends_with(" in PayPal"));
        assert_eq!(item.on_silence, MONEY_CHECK_ENDED_SILENCE);
        assert_eq!(item.deadline, None);
        assert_eq!(item.urgency, Urgency::Calm);
        assert_eq!(item.money_check, s.money_check);
        for words in [item.on_silence.as_str(), item.headline.as_str()] {
            assert!(!words.contains("asks PayPal") && !words.contains("Checking"));
        }
    }
    #[test]
    fn a_shield_hold_card_names_its_rule_and_a_released_hold_is_no_hold() {
        use table_core::{ShieldRelease, ShieldRule, ShieldVerdict};
        let mut s = source(1, 8000);
        s.shield_hold = true;
        s.shield_rule = Some(ShieldRule::PriceOverMarket);
        let item = s.item(0);
        assert_eq!(item.kind, AttnKind::Hold);
        assert_eq!(item.shield_rule, Some(ShieldRule::PriceOverMarket));
        // The rule is a closed name: the card carries no counterparty text.
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("\"shield_rule\":\"price_over_market\""));
        // Not held: no rule on the card.
        s.shield_hold = false;
        let item = s.item(0);
        assert_eq!(item.kind, AttnKind::Gate);
        assert_eq!(item.shield_rule, None);
        // From a deal: a HOLD the owner released for these terms is not a hold card.
        let mut deal: table_core::Deal = serde_json::from_value(serde_json::json!({
            "id": "00000000000000000000000001", "kind": "haggle", "side": "seller",
            "counterparty": "peer",
            "terms": {"item_ref": "monitor", "qty": 1,
                "unit_price": {"minor": 32900, "currency": "USD"}, "currency": "USD",
                "delivery": {"type": "digital_now"}},
            "state": "APPROVED", "mandate_id": "00000000000000000000000002", "mandate_version": 1,
            "transcript_head": vec![0; 32], "paypal": {}, "mode": "sandbox", "market": null,
            "shield": "HOLD", "shield_rule": "model_caution"
        }))
        .unwrap();
        let held = AttentionSource::from_deal(&deal, 1, None, None, Some(8000)).unwrap();
        assert!(held.shield_hold);
        assert_eq!(held.item(0).shield_rule, Some(ShieldRule::ModelCaution));
        deal.shield_release = Some(ShieldRelease {
            terms_hash: deal.terms.hash().unwrap(),
            rules: vec![ShieldRule::ModelCaution],
            at: 0,
        });
        let released = AttentionSource::from_deal(&deal, 1, None, None, Some(8000)).unwrap();
        assert!(!released.shield_hold);
        assert_eq!(released.item(0).kind, AttnKind::Gate);
        assert_eq!(released.item(0).shield_rule, None);
        deal.shield = Some(ShieldVerdict::Block);
        assert!(
            AttentionSource::from_deal(&deal, 1, None, None, Some(8000))
                .unwrap()
                .shield_hold
        );
    }
    #[test]
    fn hold_has_no_review_and_authorized_has_no_withdraw() {
        let mut s = source(1, 840);
        s.shield_hold = true;
        assert!(!s.item(0).actions.contains(&TumblerAction::Review));
        s.shield_hold = false;
        s.state = DealState::Authorized;
        assert!(!s.item(0).actions.contains(&TumblerAction::Withdraw));
    }
    #[test]
    fn every_offered_action_is_one_the_state_machine_accepts() {
        for state in [
            DealState::Agreed,
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Mismatch,
            DealState::Captured,
            DealState::Receipted,
            DealState::Unconfirmed,
        ] {
            for shield_hold in [false, true] {
                let mut s = source(1, 8000);
                s.state = state;
                s.shield_hold = shield_hold;
                let actions = s.item(0).actions;
                for (action, event) in [
                    (TumblerAction::Withdraw, DealEvent::Withdraw),
                    (TumblerAction::LetLapse, DealEvent::Deadline),
                ] {
                    if actions.contains(&action) {
                        assert!(
                            table_core::transition(state, event).is_ok(),
                            "{state:?} offers {action:?}"
                        );
                    }
                }
            }
        }
        // An end the owner reads, never a gate.
        let mut unconfirmed = source(1, 8000);
        unconfirmed.state = DealState::Unconfirmed;
        assert_eq!(unconfirmed.item(0).kind, AttnKind::Receipt);
        let mut mismatch = source(1, 8000);
        mismatch.state = DealState::Mismatch;
        assert_eq!(mismatch.item(0).kind, AttnKind::Hold);
        assert!(!mismatch.item(0).actions.contains(&TumblerAction::Withdraw));
    }
    #[test]
    fn snapshot_orders_by_deadline_then_id_and_snooze_requires_45_minutes() {
        let view = snapshot(&[source(2, 5000), source(1, 2700)], 0, 0, 0.0, false);
        assert_eq!(view.items[0].label, "D-0001");
        assert!(!view.items[0].actions.contains(&TumblerAction::Snooze30));
        assert!(view.items[1].actions.contains(&TumblerAction::Snooze30));
    }
    #[test]
    fn w10_motion_preference_and_dnd_suppress_breathing() {
        let item = source(1, 2000).item(0);
        let mut ladder = AttentionLadder::default();
        assert!(!ladder.evaluate(&item, 0, false, true).breathe);
        assert!(!ladder.evaluate(&item, 0, true, false).breathe);
        assert!(ladder.evaluate(&item, 0, false, false).breathe);
    }
    #[test]
    fn dnd_records_one_suppression_per_card_and_deadline_and_never_notifies() {
        let item = source(1, 840).item(0);
        let mut ladder = AttentionLadder::default();
        let fx = ladder.evaluate(&item, 0, true, false);
        assert!(fx.suppressed && !fx.notify);
        assert!(!ladder.evaluate(&item, 1, true, false).suppressed);
        // Not yet due: nothing to suppress.
        let calm = source(2, 2000).item(0);
        assert!(!ladder.evaluate(&calm, 0, true, false).suppressed);
        // Do Not Disturb turned off before the deadline: the notification is still shown once.
        assert!(ladder.evaluate(&item, 2, false, false).notify);
        ladder.forget_absent(&[]);
        assert!(ladder.suppressed.is_empty() && ladder.notified.is_empty());
    }
    #[test]
    fn urgency_ladder_and_quiet_rule_agree_with_the_one_schedule_at_every_boundary() {
        let l = LADDER;
        for left in [
            l.breathe_secs + 1,
            l.breathe_secs,
            l.snooze_min_left_secs + 1,
            l.snooze_min_left_secs,
            l.notify_secs + 1,
            l.notify_secs,
            1,
        ] {
            let item = source(1, left).item(0);
            let mut ladder = AttentionLadder::default();
            let fx = ladder.evaluate(&item, 0, false, false);
            assert_eq!(fx.breathe, l.breathes(Some(left), 0), "{left}");
            assert_eq!(fx.notify, l.notify_due(Some(left), 0), "{left}");
            assert_eq!(
                urgency(Some(left), 0) != Urgency::Calm,
                l.breathes(Some(left), 0)
            );
            assert_eq!(
                item.actions.contains(&TumblerAction::Snooze30),
                l.snooze_allowed(Some(left), 0)
            );
            assert_eq!(
                quiet_opacity_percent(std::slice::from_ref(&item), 0, l.quiet_after_secs),
                if l.breathes(Some(left), l.quiet_after_secs) {
                    100
                } else {
                    l.quiet_opacity_percent
                }
            );
        }
    }
    #[test]
    fn quiet_after_45_seconds_except_imminent_gates() {
        let calm = source(1, 8000).item(0);
        let soon = source(2, 2000).item(0);
        assert_eq!(
            quiet_opacity_percent(std::slice::from_ref(&calm), 0, 44),
            100
        );
        assert_eq!(quiet_opacity_percent(&[calm], 0, 45), 55);
        assert_eq!(quiet_opacity_percent(&[soon], 0, 45), 100);
        assert_eq!(quiet_opacity_percent(&[], 100, 45), 100);
    }
}
