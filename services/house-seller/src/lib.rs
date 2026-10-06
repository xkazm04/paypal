//! Deterministic hosted seller; payment authority stays in the durable Rust pipeline.
mod environment;
mod hosted;
pub use environment::*;
pub use hosted::*;
use table_core::{Money, MoneyError};
#[derive(Debug, Clone)]
pub struct Policy {
    pub floor: Money,
    pub ask: Money,
    pub max_rounds: u8,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Accept,
    Counter(Money),
    Withdraw,
}
impl Policy {
    pub fn decide(&self, offer: Money, round: u8) -> Result<Decision, MoneyError> {
        self.floor.same_currency(self.ask)?;
        offer.same_currency(self.floor)?;
        if round == 0 || round > self.max_rounds || self.floor.minor() > self.ask.minor() {
            return Ok(Decision::Withdraw);
        }
        if offer.minor() >= self.floor.minor() {
            return Ok(Decision::Accept);
        }
        let remaining = i64::from(self.max_rounds - round);
        let span = self.ask.minor() - self.floor.minor();
        let minor = self.floor.minor()
            + i64::try_from(
                i128::from(span) * i128::from(remaining) / i128::from(self.max_rounds.max(1)),
            )
            .map_err(|_| MoneyError::Overflow)?;
        Ok(Decision::Counter(Money::new(minor, self.floor.currency())?))
    }
}
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    #[test]
    fn house_never_counters_below_signed_floor() {
        let money = |n| Money::new(n, table_core::Currency::USD).unwrap_or_else(|_| unreachable!());
        let p = Policy {
            floor: money(1000),
            ask: money(2000),
            max_rounds: 6,
        };
        for round in 1..=6 {
            if let Decision::Counter(m) = p
                .decide(money(500), round)
                .unwrap_or_else(|_| unreachable!())
            {
                assert!(m.minor() >= 1000);
            }
        }
        assert_eq!(
            p.decide(money(1000), 1).unwrap_or_else(|_| unreachable!()),
            Decision::Accept
        );
    }
    #[test]
    fn house_policy_preserves_exact_integer_prices_at_money_limit_and_withdraws_outside_rounds() {
        let money = |n| Money::new(n, table_core::Currency::USD).unwrap();
        let policy = Policy {
            floor: money(1),
            ask: money(table_core::MAX_MINOR),
            max_rounds: 255,
        };
        assert!(
            matches!(policy.decide(money(0),1).unwrap(),Decision::Counter(value) if value.minor()>=1 && value.minor()<table_core::MAX_MINOR)
        );
        assert_eq!(policy.decide(money(1), 0).unwrap(), Decision::Withdraw);
        let policy = Policy {
            max_rounds: 6,
            ..policy
        };
        assert_eq!(policy.decide(money(1), 7).unwrap(), Decision::Withdraw);
        assert!(
            policy
                .decide(Money::new(1, table_core::Currency::EUR).unwrap(), 1)
                .is_err()
        );
    }
}
