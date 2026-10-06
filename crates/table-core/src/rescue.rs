use crate::{Mode, Money, MoneyError, Timestamp};
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
    #[test]
    fn discount_property_style_never_increases_amount() {
        let amount = Money::new(999, Currency::USD).unwrap();
        for bp in 0..=10000 {
            assert!(discounted(amount, bp).unwrap().minor() <= 999);
        }
        assert!(discounted(amount, 10001).is_err());
    }
}
