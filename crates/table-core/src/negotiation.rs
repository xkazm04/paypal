//! Deterministic concession policies. Pure integer arithmetic on minor units: no IO, no clock,
//! no floats. The seller variant is the HOUSE seller's policy; the buyer variant mirrors it.
use crate::{Money, MoneyError};
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
/// Buyer mirror: opens low and concedes linearly over `max_rounds` toward the target, the lower of
/// the signed band ceiling and the fresh market median. It never offers or accepts above the
/// ceiling; the mandate check enforces the same bound again before anything is signed.
#[derive(Debug, Clone)]
pub struct BuyerPolicy {
    pub open: Money,
    pub ceiling: Money,
    /// Only a fresh market reference belongs here; a stale one is passed as `None`.
    pub market_median: Option<Money>,
    pub max_rounds: u8,
}
impl BuyerPolicy {
    /// Opening anchor: the lowest of the band floor and the market p25 that exist, otherwise 60%
    /// of the ceiling.
    pub fn anchored(
        ceiling: Money,
        floor: Option<Money>,
        market_p25: Option<Money>,
        market_median: Option<Money>,
        max_rounds: u8,
    ) -> Result<Self, MoneyError> {
        let mut open = None::<Money>;
        for anchor in [floor, market_p25].into_iter().flatten() {
            anchor.same_currency(ceiling)?;
            open = Some(match open {
                Some(o) if o.minor() <= anchor.minor() => o,
                _ => anchor,
            });
        }
        let open = match open {
            Some(open) => open,
            None => Money::new(
                i64::try_from(i128::from(ceiling.minor()) * 6 / 10)
                    .map_err(|_| MoneyError::Overflow)?
                    .max(1),
                ceiling.currency(),
            )?,
        };
        Ok(Self {
            open,
            ceiling,
            market_median,
            max_rounds,
        })
    }
    /// The most this policy will ever pay.
    pub fn target(&self) -> Result<Money, MoneyError> {
        self.open.same_currency(self.ceiling)?;
        match self.market_median {
            Some(median) => {
                median.same_currency(self.ceiling)?;
                Ok(if median.minor() < self.ceiling.minor() {
                    median
                } else {
                    self.ceiling
                })
            }
            None => Ok(self.ceiling),
        }
    }
    /// First offer: the anchor, never above the target.
    pub fn opening(&self) -> Result<Money, MoneyError> {
        let target = self.target()?;
        Ok(if self.open.minor() < target.minor() {
            self.open
        } else {
            target
        })
    }
    /// `offer` is the seller's current price; `round` counts the seller's counters, from 1.
    pub fn decide(&self, offer: Money, round: u8) -> Result<Decision, MoneyError> {
        offer.same_currency(self.ceiling)?;
        let target = self.target()?;
        if round == 0 || round > self.max_rounds {
            return Ok(Decision::Withdraw);
        }
        let open = self.opening()?;
        let span = target.minor() - open.minor();
        let minor = open.minor()
            + i64::try_from(i128::from(span) * i128::from(round) / i128::from(self.max_rounds))
                .map_err(|_| MoneyError::Overflow)?;
        if offer.minor() <= minor {
            return Ok(Decision::Accept);
        }
        Ok(Decision::Counter(Money::new(
            minor,
            self.ceiling.currency(),
        )?))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::Currency;
    fn money(n: i64) -> Money {
        Money::new(n, Currency::USD).unwrap()
    }
    #[test]
    fn house_policy_preserves_exact_integer_prices_at_money_limit_and_withdraws_outside_rounds() {
        let policy = Policy {
            floor: money(1),
            ask: money(crate::MAX_MINOR),
            max_rounds: 255,
        };
        assert!(
            matches!(policy.decide(money(0),1).unwrap(),Decision::Counter(value) if value.minor()>=1 && value.minor()<crate::MAX_MINOR)
        );
        assert_eq!(policy.decide(money(1), 0).unwrap(), Decision::Withdraw);
        let policy = Policy {
            max_rounds: 6,
            ..policy
        };
        assert_eq!(policy.decide(money(1), 7).unwrap(), Decision::Withdraw);
        assert!(
            policy
                .decide(Money::new(1, Currency::EUR).unwrap(), 1)
                .is_err()
        );
    }
    #[test]
    fn seller_policy_concedes_from_ask_toward_floor_and_never_below() {
        let p = Policy {
            floor: money(1000),
            ask: money(1200),
            max_rounds: 4,
        };
        let counters: Vec<i64> = (1..=4)
            .filter_map(|r| match p.decide(money(100), r).unwrap() {
                Decision::Counter(m) => Some(m.minor()),
                _ => None,
            })
            .collect();
        assert_eq!(counters, [1150, 1100, 1050, 1000]);
    }
    #[test]
    fn buyer_opens_low_concedes_to_target_and_never_exceeds_ceiling() {
        let p = BuyerPolicy {
            open: money(900),
            ceiling: money(2500),
            market_median: None,
            max_rounds: 4,
        };
        assert_eq!(p.opening().unwrap(), money(900));
        let counters: Vec<i64> = (1..=4)
            .filter_map(|r| match p.decide(money(9999), r).unwrap() {
                Decision::Counter(m) => Some(m.minor()),
                _ => None,
            })
            .collect();
        assert_eq!(counters, [1300, 1700, 2100, 2500]);
        assert_eq!(p.decide(money(9999), 5).unwrap(), Decision::Withdraw);
        assert_eq!(p.decide(money(9999), 0).unwrap(), Decision::Withdraw);
        assert_eq!(p.decide(money(1300), 1).unwrap(), Decision::Accept);
    }
    #[test]
    fn buyer_target_is_the_lower_of_ceiling_and_fresh_median() {
        let mut p = BuyerPolicy {
            open: money(900),
            ceiling: money(2500),
            market_median: Some(money(1500)),
            max_rounds: 3,
        };
        assert_eq!(p.target().unwrap(), money(1500));
        for round in 1..=3 {
            if let Decision::Counter(m) = p.decide(money(9999), round).unwrap() {
                assert!(m.minor() <= 1500);
            }
        }
        // A median above the ceiling never raises the limit.
        p.market_median = Some(money(4000));
        assert_eq!(p.target().unwrap(), money(2500));
        // An anchor above the target is clamped: the policy never opens over what it would pay.
        p.open = money(3000);
        p.market_median = Some(money(1500));
        assert_eq!(p.opening().unwrap(), money(1500));
        assert!(p.decide(money(1501), 1).is_ok());
        assert!(p.decide(Money::new(1, Currency::EUR).unwrap(), 1).is_err());
    }
    #[test]
    fn buyer_anchor_prefers_lowest_signed_floor_or_market_p25_else_sixty_percent() {
        let a = BuyerPolicy::anchored(money(2500), Some(money(1100)), Some(money(900)), None, 3)
            .unwrap();
        assert_eq!(a.open, money(900));
        let b = BuyerPolicy::anchored(money(2500), None, None, None, 3).unwrap();
        assert_eq!(b.open, money(1500));
        let eur = Money::new(1, Currency::EUR).unwrap();
        assert!(BuyerPolicy::anchored(money(2500), Some(eur), None, None, 3).is_err());
    }
}
