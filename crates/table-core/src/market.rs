use crate::{DomainError, H256, Money, Timestamp};
use serde::{Deserialize, Serialize};

/// A market reference clears a deal only while it is younger than this (the shield's freshness
/// bound; older references can still hold a deal, never clear it).
pub const MARKET_FRESH_SECS: i64 = 900;
/// A watched item's reference is refreshed this long before it stops being fresh, so the fetch
/// lands before the bound. The market client serves its cache only while an entry has at least
/// this much freshness left, so a refresh is never answered with the reference it replaces.
pub const MARKET_REFRESH_LEAD_SECS: i64 = 60;

/// Whether `market` is recent enough at `now` to clear a deal: retrieved no later than `now` and
/// less than [`MARKET_FRESH_SECS`] ago.
pub fn market_fresh(market: Option<&MarketRef>, now: Timestamp) -> bool {
    market.is_some_and(|m| {
        now >= m.retrieved_at && now.saturating_sub(m.retrieved_at) < MARKET_FRESH_SECS
    })
}
/// Whether a reference is due a refresh at `now`: absent, from the future, or within
/// [`MARKET_REFRESH_LEAD_SECS`] of its freshness bound.
pub fn market_refresh_due(market: Option<&MarketRef>, now: Timestamp) -> bool {
    !market.is_some_and(|m| {
        now >= m.retrieved_at
            && now.saturating_sub(m.retrieved_at) < MARKET_FRESH_SECS - MARKET_REFRESH_LEAD_SECS
    })
}
/// A product id the market service is asked about: 1 to 128 ASCII letters, digits, `-` or `_`.
pub fn market_product_valid(product: &str) -> bool {
    !product.is_empty()
        && product.len() <= 128
        && product
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}

#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketRef {
    pub p25: Money,
    pub median: Money,
    pub p75: Money,
    pub retrieved_at: Timestamp,
    pub response_hash: H256,
    pub cached: bool,
}
impl MarketRef {
    pub fn from_comparables(
        mut prices: Vec<Money>,
        retrieved_at: Timestamp,
        response_hash: H256,
    ) -> Result<Self, DomainError> {
        let first = *prices.first().ok_or(DomainError::InvalidTerms)?;
        for price in &prices {
            first.same_currency(*price)?;
        }
        prices.sort_by_key(|p| p.minor());
        // Linear quartiles; fractions round down to an integer minor unit.
        let quantile = |quarter: usize| -> Result<Money, DomainError> {
            let index = (prices.len() - 1)
                .checked_mul(quarter)
                .ok_or(DomainError::InvalidTerms)?;
            let lo = prices[index / 4];
            let hi = prices.get(index / 4 + 1).copied().unwrap_or(lo);
            let minor = i128::from(lo.minor())
                + (i128::from(hi.minor()) - i128::from(lo.minor())) * (index % 4) as i128 / 4;
            let minor = i64::try_from(minor).map_err(|_| DomainError::InvalidTerms)?;
            Ok(Money::new(minor, lo.currency())?)
        };
        let band = Self {
            p25: quantile(1)?,
            median: quantile(2)?,
            p75: quantile(3)?,
            retrieved_at,
            response_hash,
            cached: false,
        };
        band.validate()?;
        Ok(band)
    }
    pub fn validate(&self) -> Result<(), DomainError> {
        self.p25.same_currency(self.median)?;
        self.median.same_currency(self.p75)?;
        if self.p25.minor() > self.median.minor()
            || self.median.minor() > self.p75.minor()
            || self.median.minor() == 0
        {
            return Err(DomainError::InvalidTerms);
        }
        Ok(())
    }
    pub fn over_forty_percent(&self, price: Money) -> Result<bool, DomainError> {
        self.validate()?;
        self.median.same_currency(price)?;
        Ok(i128::from(price.minor()) * 10 > i128::from(self.median.minor()) * 14)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::Currency;
    #[test]
    fn quartiles_interpolate_in_minor_units_and_zero_median_is_invalid() {
        let money = |v| Money::new(v, Currency::USD).unwrap();
        let band =
            MarketRef::from_comparables(vec![money(100), money(201)], 0, H256::ZERO).unwrap();
        assert_eq!(
            (band.p25.minor(), band.median.minor(), band.p75.minor()),
            (125, 150, 175)
        );
        assert!(MarketRef::from_comparables(vec![money(0)], 0, H256::ZERO).is_err());
    }
    #[test]
    fn market_band_is_order_independent_and_40_percent_is_strict() {
        let money = |v| Money::new(v, Currency::USD).unwrap();
        let a =
            MarketRef::from_comparables(vec![money(300), money(100), money(200)], 0, H256::ZERO)
                .unwrap();
        assert_eq!(a.median, money(200));
        assert!(!a.over_forty_percent(money(280)).unwrap());
        assert!(a.over_forty_percent(money(281)).unwrap());
        assert!(MarketRef::from_comparables(vec![], 0, H256::ZERO).is_err());
        assert!(
            MarketRef::from_comparables(
                vec![money(100), Money::new(1, Currency::EUR).unwrap()],
                0,
                H256::ZERO
            )
            .is_err()
        );
    }
}
