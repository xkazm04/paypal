//! Market watch (T15): which open deal's market reference the wallet refreshes on its own, under
//! the owner's signed market-watch rule. Pure: the caller supplies the deal, the rule in force
//! and how many price checks the rule already used today.
use crate::{DealState, MarketRef, Side, Timestamp, WatchedItem, market_refresh_due};

/// The UTC day `[start, end)` holding `now`; a price-check allowance counts over it, as the
/// daily-limit rule counts its day.
pub fn market_watch_day(now: Timestamp) -> (Timestamp, Timestamp) {
    let start = now.div_euclid(86_400).saturating_mul(86_400);
    (start, start.saturating_add(86_400))
}

/// What the scheduler does about one deal's market reference.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarketWatchStep<'a> {
    /// The item is not watched, or the deal is past the point its price is judged.
    NotWatched,
    /// The stored reference is fresh beyond the refresh lead.
    Fresh,
    /// Today's allowance is used up: nothing is fetched until the next UTC day.
    Exhausted,
    /// Fetch this product's market reference now.
    Refresh { product_id: &'a str },
}

/// Whether a deal in `state` on `side` still has a price step ahead that a fresh reference
/// serves. A seller deal stops at Agreed: past it, the order exists and the buyer's approval is
/// collected on the seller's mandate whatever the market's age, so a refresh could only add
/// caution to money the walk-away forecast already counts in. A buyer deal is watched until its
/// money is collected (every buyer money step is the owner's, and a fresh price can only hold
/// it).
pub const fn market_watch_open(state: DealState, side: Side) -> bool {
    match side {
        Side::Seller => matches!(
            state,
            DealState::Pairing | DealState::Listed | DealState::Negotiating | DealState::Agreed
        ),
        Side::Buyer => state.pre_capture(),
    }
}

/// The step for one deal: refresh only an open deal whose item the rule watches, whose reference
/// is due (absent, or within the lead of its freshness bound), while today's allowance remains.
pub fn market_watch_step<'a>(
    state: DealState,
    side: Side,
    watch: Option<(&'a WatchedItem, u16)>,
    market: Option<&MarketRef>,
    used_today: u32,
    now: Timestamp,
) -> MarketWatchStep<'a> {
    let Some((item, allowance)) = watch else {
        return MarketWatchStep::NotWatched;
    };
    if !market_watch_open(state, side) {
        return MarketWatchStep::NotWatched;
    }
    if !market_refresh_due(market, now) {
        return MarketWatchStep::Fresh;
    }
    if used_today >= u32::from(allowance) {
        return MarketWatchStep::Exhausted;
    }
    MarketWatchStep::Refresh {
        product_id: &item.product_id,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Currency, H256, ItemRef, MARKET_FRESH_SECS, MARKET_REFRESH_LEAD_SECS, Money, market_fresh,
    };

    fn item() -> WatchedItem {
        WatchedItem {
            item_ref: ItemRef::new("dock").unwrap(),
            product_id: "p-dock".into(),
        }
    }
    fn band(at: Timestamp) -> MarketRef {
        MarketRef::from_comparables(
            vec![Money::new(1000, Currency::USD).unwrap()],
            at,
            H256::ZERO,
        )
        .unwrap()
    }
    const ALL: [DealState; 21] = [
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
    fn only_a_watched_open_deal_with_a_due_reference_and_allowance_left_is_refreshed() {
        let watched = item();
        let now = 1_000_000;
        for state in ALL {
            for side in [Side::Buyer, Side::Seller] {
                for used in [0_u32, 11, 12, 13] {
                    for market in [None, Some(band(now - MARKET_FRESH_SECS)), Some(band(now))] {
                        let step = market_watch_step(
                            state,
                            side,
                            Some((&watched, 12)),
                            market.as_ref(),
                            used,
                            now,
                        );
                        let unwatched =
                            market_watch_step(state, side, None, market.as_ref(), used, now);
                        assert_eq!(unwatched, MarketWatchStep::NotWatched);
                        let expected = if !market_watch_open(state, side) {
                            MarketWatchStep::NotWatched
                        } else if market.as_ref().is_some_and(|m| m.retrieved_at == now) {
                            MarketWatchStep::Fresh
                        } else if used >= 12 {
                            MarketWatchStep::Exhausted
                        } else {
                            MarketWatchStep::Refresh {
                                product_id: "p-dock",
                            }
                        };
                        assert_eq!(step, expected, "{state:?} {side:?} {used}");
                        // A terminal deal, or one whose money moved, is never refreshed.
                        if state.terminal() || !state.pre_capture() {
                            assert_eq!(step, MarketWatchStep::NotWatched);
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn a_seller_deal_is_watched_only_until_its_order_exists() {
        for state in ALL {
            assert_eq!(
                market_watch_open(state, Side::Seller),
                matches!(
                    state,
                    DealState::Pairing
                        | DealState::Listed
                        | DealState::Negotiating
                        | DealState::Agreed
                ),
                "{state:?}"
            );
            assert_eq!(market_watch_open(state, Side::Buyer), state.pre_capture());
        }
    }

    #[test]
    fn the_refresh_lands_before_the_freshness_bound_and_a_future_reference_is_refreshed() {
        let now = 50_000;
        let due_at = MARKET_FRESH_SECS - MARKET_REFRESH_LEAD_SECS;
        let young = band(now - due_at + 1);
        let due = band(now - due_at);
        assert!(!market_refresh_due(Some(&young), now));
        assert!(market_refresh_due(Some(&due), now));
        // Due a refresh, but still fresh: the refresh has the lead to land.
        assert!(market_fresh(Some(&due), now));
        assert!(!market_fresh(Some(&band(now - MARKET_FRESH_SECS)), now));
        assert!(market_refresh_due(Some(&band(now + 5)), now));
        assert!(!market_fresh(Some(&band(now + 5)), now));
        assert!(market_refresh_due(None, now));
    }

    #[test]
    fn the_allowance_counts_over_the_utc_day() {
        assert_eq!(market_watch_day(86_400 * 3 + 5), (86_400 * 3, 86_400 * 4));
        assert_eq!(market_watch_day(86_400 * 3), (86_400 * 3, 86_400 * 4));
        assert_eq!(market_watch_day(-1), (-86_400, 0));
    }
}
