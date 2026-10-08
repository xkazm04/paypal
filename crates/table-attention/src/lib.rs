//! Pure attention projections, deadline ladder and logical-pixel window arithmetic.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod forecast;
pub mod placement;
pub mod quit;
pub mod silence;
pub use forecast::*;
pub use placement::*;
pub use quit::{QuitEffect, QuitLine, QuitLines, QuitSource, quit_lines, quit_message};
pub use silence::word_silence;

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use table_core::{
    Currency, DealEvent, DealId, DealState, MandateId, Mode, Module, Money, MoneyCheck, Timestamp,
};

/// The card's line while a money step's PayPal outcome is being checked (T10). Nothing is sent,
/// and nothing is collected, until PayPal's own record settles it.
pub const MONEY_CHECK_SILENCE: &str = "nothing more is sent until PayPal confirms";
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
            shield_hold: deal
                .shield
                .is_some_and(|v| v >= table_core::ShieldVerdict::Hold),
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
                | DealState::Failed => AttnKind::Receipt,
                _ => AttnKind::Motion,
            }
        };
        let action = match (kind, self.state) {
            (AttnKind::Gate, DealState::Agreed) if rescue => "Approve rescue lever",
            (AttnKind::Motion, DealState::Settling) if rescue => "Sending invoice",
            (AttnKind::Motion, DealState::AwaitingApproval) if rescue => "Invoice sent",
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
            if self.deadline.is_some_and(|d| d.saturating_sub(now) > 2700) {
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
        }
    }
    /// A deal whose money step is being checked with PayPal: a HOLD with no decision on it and
    /// no way to walk away, because the deal stays reserved until PayPal's record settles it.
    fn checking_item(&self, check: MoneyCheck, now: Timestamp) -> AttentionItem {
        AttentionItem {
            deal_id: self.deal_id,
            label: format!("D-{:04}", self.display_number),
            kind: AttnKind::Hold,
            module: self.module,
            headline: format!("Checking with PayPal {}", self.amount),
            amount_minor: self.amount.minor(),
            currency: self.amount.currency(),
            counterparty: self.pairing_display_name.clone(),
            clause: None,
            deadline: self.deadline,
            on_silence: MONEY_CHECK_SILENCE.to_owned(),
            urgency: urgency(self.deadline, now),
            mode: self.mode,
            actions: vec![TumblerAction::OpenInTable],
            money_check: Some(check),
        }
    }
}
pub fn urgency(deadline: Option<Timestamp>, now: Timestamp) -> Urgency {
    match deadline.map(|d| d.saturating_sub(now)) {
        Some(left) if left <= 900 => Urgency::Now,
        Some(left) if left <= 7200 => Urgency::Soon,
        _ => Urgency::Calm,
    }
}
/// View-only dimming. Imminent gates stay legible even after the owner stops interacting.
pub fn quiet_opacity_percent(
    items: &[AttentionItem],
    last_interaction: Timestamp,
    now: Timestamp,
) -> u8 {
    let imminent = items.iter().any(|item| {
        item.kind == AttnKind::Gate
            && item
                .deadline
                .is_some_and(|deadline| deadline > now && deadline.saturating_sub(now) <= 7200)
    });
    if now.saturating_sub(last_interaction) >= 45 && !imminent {
        55
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
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LadderEffects {
    pub show_without_activation: bool,
    pub breathe: bool,
    pub notify: bool,
    pub tray_dot: bool,
}
impl AttentionLadder {
    /// Drop notification marks for cards no longer on the stack, so a long-running shell does
    /// not grow one entry per deal forever. The durable claim in the ledger still prevents a
    /// repeat notification if a card returns.
    pub fn forget_absent(&mut self, items: &[AttentionItem]) {
        let live: HashSet<_> = items.iter().map(|i| (i.deal_id, i.deadline)).collect();
        self.notified.retain(|key| live.contains(key));
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
        let live = item.deadline.is_none_or(|at| at > now);
        let urgency = urgency(item.deadline, now);
        let urgent = gate && live && urgency == Urgency::Now;
        let notify = urgent && !dnd && self.notified.insert((item.deal_id, item.deadline));
        LadderEffects {
            show_without_activation: gate || item.kind == AttnKind::Hold,
            breathe: gate && live && urgency != Urgency::Calm && !dnd && !reduced_motion,
            notify,
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
