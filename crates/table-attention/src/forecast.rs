//! Walk-away forecast: what the scheduler would do to each open deal if the owner does nothing.
//!
//! Pure and read-only. Silence is the absence of an owner decision, so no line here carries an
//! owner authority, and no line moves money out.
use serde::{Deserialize, Serialize};
use table_core::{
    Currency, DealEvent, DealId, DealKind, DealState, Delivery, Mode, Money, Side, Timestamp,
    transition,
};

/// Seconds the order-creation step gives a new order. Mirrors
/// `crates/table-app/src/pipeline.rs:534` (`create`: `set_deadline(now + 6 * 3600)`).
const ORDER_CREATED_DEADLINE_SECS: i64 = 6 * 3600;
/// Seconds an authorization is held before the automatic void. Mirrors
/// `crates/table-app/src/pipeline.rs:683` (`authorize`: `set_deadline(now + 72 * 3600)`).
const AUTHORIZED_DEADLINE_SECS: i64 = 72 * 3600;

/// One deal as the forecast sees it, built by the caller.
#[derive(Debug, Clone)]
pub struct ForecastSource {
    pub deal_id: DealId,
    pub display_number: u32,
    pub state: DealState,
    pub side: Side,
    pub kind: DealKind,
    pub delivery: Delivery,
    pub amount: Money,
    pub deadline: Option<Timestamp>,
    pub mode: Mode,
    /// The owner chose "let it lapse" (the scheduler reads `lapse.<deal id>`).
    pub lapse_chosen: bool,
    pub mandate_retired: bool,
    /// Whether the pipeline's own create gate (clause 6 and the shield) lets
    /// `Authority::Policy` create this seller order at `now`, judged on the market reference
    /// stored now. A price check the owner's market-watch rule has scheduled or has in flight
    /// (T15) is never counted: its answer is not certain to arrive, nor to clear the deal, before
    /// the step. Once it lands, the next forecast judges the stored reference.
    pub policy_create_allowed: bool,
    /// The pipeline's own authorize and capture gate under `Authority::SellerMandate` (mandate
    /// and shield) passes at every time in `[now, until)`; `None` when it refuses at `now`.
    /// The shield asks once the market reference is older than its freshness window, and
    /// both ASK and CLEAR pass the seller mandate. The owner's market-watch rule (T15) refreshes
    /// a seller deal's reference only up to Agreed, never in this window, so the window only
    /// shrinks. The caller may
    /// cap `until` at the deal's deadline or the horizon end, past which nothing is forecast.
    pub seller_mandate_until: Option<Timestamp>,
}

#[derive(Debug, Clone, Copy)]
pub struct ForecastContext {
    pub now: Timestamp,
    pub horizon_secs: i64,
    pub paused: bool,
    pub executor_configured: bool,
}

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForecastTrigger {
    Deadline,
    NextTick,
    BuyerApproves,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForecastAction {
    Lapse,
    Expire,
    AutoVoid,
    CreateOrder,
    Authorize,
    Capture,
}
/// Who acts. There is no owner variant: silence is the absence of an owner decision.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForecastAuthority {
    SafeDefault,
    MandateRule,
    SellerMandate,
}
/// `Out` exists so the property test can prove no forecast line ever moves money out.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForecastDirection {
    In,
    Out,
    None,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ForecastLine {
    pub deal_id: DealId,
    pub label: String,
    pub trigger: ForecastTrigger,
    pub at: Option<Timestamp>,
    pub action: ForecastAction,
    pub authority: ForecastAuthority,
    pub direction: ForecastDirection,
    pub amount_minor: i64,
    pub currency: Currency,
    pub end_state: DealState,
    /// For a `BuyerApproves` step: the buyer's approval must reach the scheduler before this
    /// time (the deal's deadline, or the end of the seller-mandate window), or the step does not
    /// happen. `None` on every other line.
    pub before: Option<Timestamp>,
}

/// What the scheduler does to every open deal if nobody decides anything.
///
/// Mirrors `crates/table-runtime/src/scheduler.rs` `tick_deal` as it stands at b260727: a due
/// deadline wins and ends the deal's tick; otherwise "let it lapse" or a retired mandate stops
/// every step; otherwise only seller deals advance (create, authorize, capture). Buyer deals,
/// purchases included, wait for the owner. A create, authorize or capture line appears only
/// when the pipeline's gate for it (`policy_create_allowed`, `seller_mandate_until`) passes at
/// the step's time: next tick is `now`, a buyer approval is any time before the line's
/// `before`. A deal with no step left falls to its deadline line. Lines are sorted by `(at, deal_id)`; lines whose time
/// is unknown (`at: None`) sort first. Deadline lines beyond `now + horizon_secs` are dropped.
pub fn forecast(sources: &[ForecastSource], ctx: &ForecastContext) -> Vec<ForecastLine> {
    let mut lines = Vec::new();
    for source in sources {
        if source.mode == Mode::Replay || source.state.terminal() {
            continue;
        }
        deal_lines(source, ctx, &mut lines);
    }
    lines.sort_by_key(|line| (line.at, line.deal_id));
    lines
}

fn deal_lines(s: &ForecastSource, ctx: &ForecastContext, out: &mut Vec<ForecastLine>) {
    use ForecastAction as A;
    use ForecastAuthority as Auth;
    use ForecastDirection as D;
    use ForecastTrigger as T;

    let horizon_end = ctx.now.saturating_add(ctx.horizon_secs);
    // Authorize and capture call PayPal with the stored sandbox credentials, so without a
    // payment executor the tick fails on them (scheduler.rs `tick_deal`, pipeline `authorize`),
    // exactly as the create does. No such step is forecast then.
    let seller_until = s
        .seller_mandate_until
        .filter(|until| *until > ctx.now && ctx.executor_configured);
    // A buyer approval counts only before the deal's deadline and inside the seller-mandate
    // window, because the authorize it triggers runs the gate at the time it lands.
    let buyer_before = seller_until.map(|until| s.deadline.map_or(until, |d| d.min(until)));
    let line = |trigger, at, action, authority, direction, end_state| ForecastLine {
        deal_id: s.deal_id,
        label: format!("D-{:04}", s.display_number),
        trigger,
        at,
        action,
        authority,
        direction,
        amount_minor: s.amount.minor(),
        currency: s.amount.currency(),
        end_state,
        before: if trigger == T::BuyerApproves {
            buyer_before
        } else {
            None
        },
    };
    let capture = |trigger| {
        line(
            trigger,
            None,
            A::Capture,
            Auth::SellerMandate,
            D::In,
            // `capture` records the receipt in the same call.
            DealState::Receipted,
        )
    };
    let authorize = |trigger| {
        line(
            trigger,
            None,
            A::Authorize,
            Auth::SellerMandate,
            D::None,
            DealState::Authorized,
        )
    };

    let mut state = s.state;
    let mut deadline = s.deadline;
    let due = deadline.is_some_and(|d| d <= ctx.now);
    let digital = s.delivery == Delivery::DigitalNow;
    if !due && !s.lapse_chosen && !s.mandate_retired && s.side == Side::Seller {
        match state {
            DealState::Agreed => {
                if !ctx.paused && ctx.executor_configured && s.policy_create_allowed {
                    out.push(line(
                        T::NextTick,
                        None,
                        A::CreateOrder,
                        Auth::MandateRule,
                        D::None,
                        DealState::AwaitingApproval,
                    ));
                    state = DealState::AwaitingApproval;
                    deadline = Some(ctx.now.saturating_add(ORDER_CREATED_DEADLINE_SECS));
                }
            }
            DealState::Approved if seller_until.is_some() => {
                out.push(authorize(T::NextTick));
                state = DealState::Authorized;
                deadline = Some(ctx.now.saturating_add(AUTHORIZED_DEADLINE_SECS));
                if digital {
                    out.push(capture(T::NextTick));
                    state = DealState::Captured;
                }
            }
            DealState::Authorized if digital && seller_until.is_some() => {
                out.push(capture(T::NextTick));
                state = DealState::Captured;
            }
            DealState::AwaitingApproval if seller_until.is_some() => {
                out.push(authorize(T::BuyerApproves));
                if digital {
                    out.push(capture(T::BuyerApproves));
                } else {
                    // Earliest case: approval lands now, so the hold starts now.
                    let at = ctx.now.saturating_add(AUTHORIZED_DEADLINE_SECS);
                    if at <= horizon_end
                        && let Ok(end) = transition(DealState::Authorized, DealEvent::AutoVoid)
                    {
                        out.push(line(
                            T::BuyerApproves,
                            Some(at),
                            A::AutoVoid,
                            Auth::SafeDefault,
                            D::None,
                            end,
                        ));
                    }
                }
            }
            _ => {}
        }
    }

    let Some(at) = deadline else { return };
    if !state.pre_capture() || at > horizon_end {
        return;
    }
    let event = if state == DealState::Authorized {
        DealEvent::AutoVoid
    } else {
        DealEvent::Deadline
    };
    let Ok(end) = transition(state, event) else {
        return;
    };
    let action = match end {
        DealState::Withdrawn => A::Lapse,
        DealState::Expired => A::Expire,
        DealState::AutoVoided => A::AutoVoid,
        _ => return,
    };
    out.push(line(
        T::Deadline,
        Some(at),
        action,
        Auth::SafeDefault,
        D::None,
        end,
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: Timestamp = 1_000_000;
    const HORIZON: i64 = 72 * 3600;

    fn id(n: u8) -> DealId {
        format!("{n:0>26}").parse().unwrap()
    }
    fn ctx() -> ForecastContext {
        ForecastContext {
            now: NOW,
            horizon_secs: HORIZON,
            paused: false,
            executor_configured: true,
        }
    }
    fn source(side: Side, kind: DealKind, state: DealState) -> ForecastSource {
        ForecastSource {
            deal_id: id(1),
            display_number: 7,
            state,
            side,
            kind,
            delivery: Delivery::DigitalNow,
            amount: Money::new(2500, Currency::USD).unwrap(),
            deadline: None,
            mode: Mode::Sandbox,
            lapse_chosen: false,
            mandate_retired: false,
            policy_create_allowed: true,
            seller_mandate_until: Some(NOW + 3600),
        }
    }

    /// Exhaustive on purpose: a new `DealState` variant fails to compile here.
    fn ordinal(state: DealState) -> usize {
        use DealState::*;
        match state {
            Pairing => 0,
            Listed => 1,
            Negotiating => 2,
            Agreed => 3,
            Settling => 4,
            AwaitingApproval => 5,
            Approved => 6,
            Authorized => 7,
            Captured => 8,
            Receipted => 9,
            Reconciled => 10,
            Withdrawn => 11,
            Expired => 12,
            Refused => 13,
            Mismatch => 14,
            Failed => 15,
            Voided => 16,
            AutoVoided => 17,
            Refunded => 18,
            Disputed => 19,
            Unconfirmed => 20,
        }
    }
    const ALL_STATES: [DealState; 21] = [
        DealState::Pairing,
        DealState::Listed,
        DealState::Negotiating,
        DealState::Agreed,
        DealState::Settling,
        DealState::AwaitingApproval,
        DealState::Approved,
        DealState::Authorized,
        DealState::Captured,
        DealState::Receipted,
        DealState::Reconciled,
        DealState::Withdrawn,
        DealState::Expired,
        DealState::Refused,
        DealState::Mismatch,
        DealState::Failed,
        DealState::Voided,
        DealState::AutoVoided,
        DealState::Refunded,
        DealState::Disputed,
        DealState::Unconfirmed,
    ];

    #[test]
    fn state_table_covers_every_variant_once() {
        for (i, state) in ALL_STATES.iter().enumerate() {
            assert_eq!(ordinal(*state), i);
        }
    }

    #[test]
    fn forecast_never_moves_money_out_over_every_input() {
        let kinds = [
            DealKind::Purchase,
            DealKind::Haggle,
            DealKind::ShopOrder,
            DealKind::Rescue,
            DealKind::Invoice,
        ];
        let deliveries = [Delivery::DigitalNow, Delivery::ShipThenCapture { days: 1 }];
        let deadlines = [
            None,
            Some(NOW - 10),
            Some(NOW + 48 * 3600),
            Some(NOW + 100 * 3600),
        ];
        let modes = [Mode::Sandbox, Mode::Replay, Mode::ScriptedEngine];
        // Refused now, stale exactly at now, fresh for ten minutes, fresh past the horizon.
        let windows = [None, Some(NOW), Some(NOW + 600), Some(NOW + 100 * 3600)];
        let mut checked = 0_u32;
        for state in ALL_STATES {
            for side in [Side::Buyer, Side::Seller] {
                for kind in kinds {
                    for delivery in &deliveries {
                        for deadline in deadlines {
                            for mode in modes {
                                for window in windows {
                                    for bits in 0_u8..32 {
                                        let on = |n: u8| (bits >> n) & 1 == 1;
                                        let c = ForecastContext {
                                            paused: on(0),
                                            executor_configured: on(1),
                                            ..ctx()
                                        };
                                        let mut s = source(side, kind, state);
                                        s.delivery = delivery.clone();
                                        s.deadline = deadline;
                                        s.mode = mode;
                                        s.lapse_chosen = on(2);
                                        s.mandate_retired = on(3);
                                        s.policy_create_allowed = on(4);
                                        s.seller_mandate_until = window;
                                        check(&s, &c);
                                        checked += 1;
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        assert_eq!(checked, 21 * 2 * 5 * 2 * 4 * 3 * 4 * 32);
    }

    fn check(s: &ForecastSource, c: &ForecastContext) {
        let lines = forecast(std::slice::from_ref(s), c);
        // (5)
        if s.mode == Mode::Replay || s.state.terminal() {
            assert!(lines.is_empty(), "{s:?}");
        }
        let has = |a: ForecastAction| lines.iter().any(|l| l.action == a);
        for l in &lines {
            // (1)
            assert_ne!(l.direction, ForecastDirection::Out, "{s:?}");
            // (2)
            if l.authority == ForecastAuthority::SafeDefault {
                assert!(
                    matches!(
                        l.action,
                        ForecastAction::Lapse | ForecastAction::Expire | ForecastAction::AutoVoid
                    ),
                    "{s:?}"
                );
                assert_eq!(l.direction, ForecastDirection::None);
                assert!(
                    l.end_state.terminal()
                        && !matches!(
                            l.end_state,
                            DealState::Captured
                                | DealState::Receipted
                                | DealState::Reconciled
                                | DealState::Refunded
                                | DealState::Disputed
                        ),
                    "{s:?}"
                );
            }
            // (3)
            if l.direction == ForecastDirection::In {
                assert_eq!(s.side, Side::Seller);
                assert_eq!(l.authority, ForecastAuthority::SellerMandate);
                assert_eq!(l.action, ForecastAction::Capture);
            }
            // (6)
            if l.trigger == ForecastTrigger::Deadline {
                let from = if lines.iter().any(|x| {
                    x.action == ForecastAction::Authorize && x.trigger == ForecastTrigger::NextTick
                }) {
                    DealState::Authorized
                } else if has(ForecastAction::CreateOrder) {
                    DealState::AwaitingApproval
                } else {
                    s.state
                };
                let event = if from == DealState::Authorized {
                    DealEvent::AutoVoid
                } else {
                    DealEvent::Deadline
                };
                assert_eq!(transition(from, event).unwrap(), l.end_state, "{s:?}");
            }
        }
        // (7) No step the pipeline's gate would refuse at the step's time.
        let seller_open =
            c.executor_configured && s.seller_mandate_until.is_some_and(|until| until > c.now);
        if !s.policy_create_allowed {
            assert!(!has(ForecastAction::CreateOrder), "{s:?}");
        }
        if !seller_open {
            assert!(
                !has(ForecastAction::Authorize) && !has(ForecastAction::Capture),
                "{s:?}"
            );
        }
        // (8) A buyer-approval line says by when the approval must land; no other line does.
        for l in &lines {
            if l.trigger == ForecastTrigger::BuyerApproves {
                let before = l.before.unwrap();
                assert!(before > c.now, "{s:?}");
                assert!(before <= s.seller_mandate_until.unwrap(), "{s:?}");
                assert!(s.deadline.is_none_or(|d| before <= d), "{s:?}");
            } else {
                assert_eq!(l.before, None, "{s:?}");
            }
        }
        // (4)
        if s.side == Side::Buyer {
            assert!(
                !has(ForecastAction::Authorize)
                    && !has(ForecastAction::Capture)
                    && !has(ForecastAction::CreateOrder),
                "{s:?}"
            );
        }
    }

    #[test]
    fn without_a_payment_executor_no_authorize_or_capture_is_forecast() {
        for state in [
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Authorized,
        ] {
            let mut s = source(Side::Seller, DealKind::ShopOrder, state);
            s.deadline = Some(NOW + 3600);
            let on = forecast(std::slice::from_ref(&s), &ctx());
            assert!(
                on.iter().any(|l| l.direction == ForecastDirection::In
                    || l.action == ForecastAction::Authorize),
                "{state:?}"
            );
            let off = ForecastContext {
                executor_configured: false,
                ..ctx()
            };
            let lines = forecast(&[s], &off);
            assert!(
                lines.iter().all(|l| l.direction != ForecastDirection::In
                    && !matches!(
                        l.action,
                        ForecastAction::Authorize | ForecastAction::Capture
                    )),
                "{state:?}: {lines:?}"
            );
        }
    }

    #[test]
    fn buyer_haggle_negotiating_lapses_at_its_deadline() {
        let mut s = source(Side::Buyer, DealKind::Haggle, DealState::Negotiating);
        s.deadline = Some(NOW + 3600);
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].action, ForecastAction::Lapse);
        assert_eq!(lines[0].at, Some(NOW + 3600));
        assert_eq!(lines[0].end_state, DealState::Withdrawn);
        assert_eq!(lines[0].label, "D-0007");
    }

    #[test]
    fn buyer_purchase_authorized_auto_voids_at_its_deadline() {
        let mut s = source(Side::Buyer, DealKind::Purchase, DealState::Authorized);
        s.deadline = Some(NOW + 3600);
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].action, ForecastAction::AutoVoid);
        assert_eq!(lines[0].end_state, DealState::AutoVoided);
    }

    #[test]
    fn seller_digital_awaiting_approval_authorizes_and_captures_when_buyer_approves() {
        let mut s = source(
            Side::Seller,
            DealKind::ShopOrder,
            DealState::AwaitingApproval,
        );
        s.deadline = Some(NOW + 3600);
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 3);
        let capture = lines
            .iter()
            .find(|l| l.action == ForecastAction::Capture)
            .unwrap();
        assert_eq!(capture.trigger, ForecastTrigger::BuyerApproves);
        assert_eq!(capture.end_state, DealState::Receipted);
        // The deadline comes before the end of the seller-mandate window.
        assert_eq!(capture.before, Some(NOW + 3600));
        assert_eq!(capture.direction, ForecastDirection::In);
        assert_eq!(capture.authority, ForecastAuthority::SellerMandate);
        assert!(
            lines
                .iter()
                .any(|l| l.trigger == ForecastTrigger::BuyerApproves
                    && l.action == ForecastAction::Authorize)
        );
        let expire = lines.last().unwrap();
        assert_eq!(expire.action, ForecastAction::Expire);
        assert_eq!(expire.at, Some(NOW + 3600));
    }

    #[test]
    fn buyer_purchase_agreed_without_a_deadline_has_no_lines() {
        // A new purchase always has a deadline; only rows created before that change can lack one.
        let s = source(Side::Buyer, DealKind::Purchase, DealState::Agreed);
        assert!(forecast(&[s], &ctx()).is_empty());
    }

    #[test]
    fn buyer_purchase_agreed_with_a_deadline_lapses_there_and_moves_no_money() {
        let mut s = source(Side::Buyer, DealKind::Purchase, DealState::Agreed);
        s.deadline = Some(NOW + 3600);
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].action, ForecastAction::Lapse);
        assert_eq!(lines[0].at, Some(NOW + 3600));
        assert_eq!(lines[0].end_state, DealState::Withdrawn);
        assert_eq!(lines[0].direction, ForecastDirection::None);
    }

    #[test]
    fn seller_agreed_paused_or_not_allowed_only_lapses() {
        let mut s = source(Side::Seller, DealKind::ShopOrder, DealState::Agreed);
        s.deadline = Some(NOW + 3600);
        let paused = ForecastContext {
            paused: true,
            ..ctx()
        };
        let mut denied = s.clone();
        denied.policy_create_allowed = false;
        for lines in [forecast(&[s.clone()], &paused), forecast(&[denied], &ctx())] {
            assert_eq!(lines.len(), 1);
            assert_eq!(lines[0].action, ForecastAction::Lapse);
        }
        // Allowed: the order is created next tick, then expires on the new six-hour deadline.
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines[0].action, ForecastAction::CreateOrder);
        assert_eq!(lines[1].action, ForecastAction::Expire);
        assert_eq!(lines[1].at, Some(NOW + ORDER_CREATED_DEADLINE_SECS));
    }

    #[test]
    fn seller_agreed_without_a_market_reference_forecasts_only_its_lapse() {
        // With no market reference the shield asks, so the runtime's gates refuse both
        // `Authority::Policy` and `Authority::SellerMandate` at now.
        let mut s = source(Side::Seller, DealKind::ShopOrder, DealState::Agreed);
        s.deadline = Some(NOW + 3600);
        s.policy_create_allowed = false;
        s.seller_mandate_until = None;
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].action, ForecastAction::Lapse);
        assert_eq!(lines[0].at, Some(NOW + 3600));
        assert_eq!(lines[0].end_state, DealState::Withdrawn);
    }

    #[test]
    fn seller_agreed_with_a_fresh_market_forecasts_the_create() {
        let mut s = source(Side::Seller, DealKind::ShopOrder, DealState::Agreed);
        s.deadline = Some(NOW + 3600);
        s.seller_mandate_until = Some(NOW + 600);
        let lines = forecast(&[s], &ctx());
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].action, ForecastAction::CreateOrder);
        assert_eq!(lines[0].authority, ForecastAuthority::MandateRule);
        assert_eq!(lines[0].end_state, DealState::AwaitingApproval);
        assert_eq!(lines[0].before, None);
        assert_eq!(lines[1].action, ForecastAction::Expire);
    }

    #[test]
    fn a_market_stale_by_the_steps_time_forecasts_no_money_step() {
        // The window ends exactly now: a step at the next tick would meet a stale market.
        for state in [
            DealState::Approved,
            DealState::Authorized,
            DealState::AwaitingApproval,
        ] {
            let mut s = source(Side::Seller, DealKind::ShopOrder, state);
            s.deadline = Some(NOW + 3600);
            s.seller_mandate_until = Some(NOW);
            let lines = forecast(&[s], &ctx());
            assert_eq!(lines.len(), 1, "{state:?}");
            assert_eq!(lines[0].trigger, ForecastTrigger::Deadline, "{state:?}");
        }
        // A buyer approval must land before the window closes, here ten minutes from now.
        let mut s = source(
            Side::Seller,
            DealKind::ShopOrder,
            DealState::AwaitingApproval,
        );
        s.deadline = Some(NOW + 3600);
        s.seller_mandate_until = Some(NOW + 600);
        let lines = forecast(&[s], &ctx());
        let authorize = lines
            .iter()
            .find(|l| l.action == ForecastAction::Authorize)
            .unwrap();
        assert_eq!(authorize.before, Some(NOW + 600));
    }

    #[test]
    fn lines_sort_by_time_then_deal() {
        let mut a = source(Side::Buyer, DealKind::Haggle, DealState::Negotiating);
        a.deadline = Some(NOW + 200);
        let mut b = a.clone();
        b.deal_id = id(2);
        b.deadline = Some(NOW + 100);
        let mut c = a.clone();
        c.deal_id = id(3);
        c.deadline = Some(NOW + 100);
        let order: Vec<_> = forecast(&[a, c, b], &ctx())
            .iter()
            .map(|l| l.deal_id)
            .collect();
        assert_eq!(order, [id(2), id(3), id(1)]);
    }
}
