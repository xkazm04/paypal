use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;

/// Explicit supported ISO codes. Adding a currency requires its minor-unit exponent.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Currency {
    USD,
    EUR,
    GBP,
    CAD,
    AUD,
    CHF,
    NZD,
    CZK,
    SEK,
    NOK,
    DKK,
    PLN,
    JPY,
    HUF,
    KWD,
    BHD,
}
impl Currency {
    pub const fn exponent(self) -> u32 {
        match self {
            Self::JPY => 0,
            Self::KWD | Self::BHD => 3,
            _ => 2,
        }
    }
    pub const fn scale(self) -> i64 {
        10_i64.pow(self.exponent())
    }
}
impl fmt::Display for Currency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{self:?}")
    }
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum MoneyError {
    #[error("invalid unsigned decimal amount")]
    InvalidDecimal,
    #[error("amount exceeds the exact JSON integer range")]
    Overflow,
    #[error("currency mismatch")]
    CurrencyMismatch,
}

// RFC 8785 numbers are IEEE 754. Minor units must remain exactly portable in JCS.
/// The largest integer every JSON reader (including JavaScript) holds exactly. Amounts and
/// timestamps that cross the wire are both bounded by it, each under its own name.
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
pub const MAX_MINOR: i64 = MAX_SAFE_INTEGER;
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "MoneyWire", into = "MoneyWire")]
pub struct Money {
    minor: i64,
    currency: Currency,
}

#[derive(ts_rs::TS, Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MoneyWire {
    minor: i64,
    currency: Currency,
}
impl TryFrom<MoneyWire> for Money {
    type Error = MoneyError;
    fn try_from(v: MoneyWire) -> Result<Self, Self::Error> {
        Self::new(v.minor, v.currency)
    }
}
impl From<Money> for MoneyWire {
    fn from(v: Money) -> Self {
        Self {
            minor: v.minor,
            currency: v.currency,
        }
    }
}
impl Money {
    pub fn new(minor: i64, currency: Currency) -> Result<Self, MoneyError> {
        if minor < 0 {
            return Err(MoneyError::InvalidDecimal);
        }
        if minor > MAX_MINOR {
            return Err(MoneyError::Overflow);
        }
        Ok(Self { minor, currency })
    }
    pub const fn minor(self) -> i64 {
        self.minor
    }
    pub const fn currency(self) -> Currency {
        self.currency
    }
    pub fn parse(decimal: &str, currency: Currency) -> Result<Self, MoneyError> {
        let mut parts = decimal.split('.');
        let whole = parts.next().ok_or(MoneyError::InvalidDecimal)?;
        let fraction = parts.next();
        if parts.next().is_some() || whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(MoneyError::InvalidDecimal);
        }
        let exponent = currency.exponent() as usize;
        let digits = fraction.unwrap_or("");
        if fraction.is_some()
            && (digits.is_empty()
                || exponent == 0
                || digits.len() > exponent
                || !digits.bytes().all(|b| b.is_ascii_digit()))
        {
            return Err(MoneyError::InvalidDecimal);
        }
        let whole = whole.parse::<i64>().map_err(|_| MoneyError::Overflow)?;
        let frac = if digits.is_empty() {
            0
        } else {
            digits.parse::<i64>().map_err(|_| MoneyError::Overflow)?
        };
        let frac = frac
            .checked_mul(10_i64.pow((exponent - digits.len()) as u32))
            .ok_or(MoneyError::Overflow)?;
        let minor = whole
            .checked_mul(currency.scale())
            .and_then(|v| v.checked_add(frac))
            .ok_or(MoneyError::Overflow)?;
        Self::new(minor, currency)
    }
    pub fn decimal(self) -> String {
        let scale = self.currency.scale();
        if scale == 1 {
            return self.minor.to_string();
        }
        format!(
            "{}.{:0width$}",
            self.minor / scale,
            self.minor % scale,
            width = self.currency.exponent() as usize
        )
    }
    pub fn checked_mul(self, qty: u32) -> Result<Self, MoneyError> {
        Self::new(
            self.minor
                .checked_mul(i64::from(qty))
                .ok_or(MoneyError::Overflow)?,
            self.currency,
        )
    }
    pub fn checked_add(self, rhs: Self) -> Result<Self, MoneyError> {
        self.same_currency(rhs)?;
        Self::new(
            self.minor
                .checked_add(rhs.minor)
                .ok_or(MoneyError::Overflow)?,
            self.currency,
        )
    }
    pub fn same_currency(self, rhs: Self) -> Result<(), MoneyError> {
        if self.currency == rhs.currency {
            Ok(())
        } else {
            Err(MoneyError::CurrencyMismatch)
        }
    }
}
impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {}", self.decimal(), self.currency)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn decimal_roundtrips_property_style() {
        for currency in [Currency::USD, Currency::JPY, Currency::KWD] {
            for minor in (0..100_000).step_by(37).chain([MAX_MINOR]) {
                let amount = Money::new(minor, currency).unwrap();
                assert_eq!(Money::parse(&amount.decimal(), currency).unwrap(), amount);
                assert_eq!(
                    serde_json::from_str::<Money>(&serde_json::to_string(&amount).unwrap())
                        .unwrap(),
                    amount
                );
            }
        }
    }
    #[test]
    fn decimals_never_round_or_accept_exponents_signs_whitespace() {
        for text in [
            "", "-1", "+1", " 1", "1 ", "1e2", "NaN", ".5", "1.", "1.001", "1.2.3", "\u{ff11}",
        ] {
            assert!(Money::parse(text, Currency::USD).is_err(), "{text}");
        }
        assert_eq!(Money::parse("1.2", Currency::USD).unwrap().minor(), 120);
        assert!(Money::parse("1.00", Currency::JPY).is_err());
    }
    #[test]
    fn overflow_currency_and_deserialization_are_checked() {
        assert!(Money::parse("999999999999999999999", Currency::USD).is_err());
        assert!(
            Money::new(MAX_MINOR, Currency::USD)
                .unwrap()
                .checked_mul(2)
                .is_err()
        );
        assert!(
            Money::new(1, Currency::USD)
                .unwrap()
                .checked_add(Money::new(1, Currency::EUR).unwrap())
                .is_err()
        );
        for json in [
            r#"{"minor":-1,"currency":"USD"}"#,
            r#"{"minor":1,"currency":"USD","extra":true}"#,
            r#"{"minor":1,"currency":"ZZZ"}"#,
        ] {
            assert!(serde_json::from_str::<Money>(json).is_err());
        }
    }
}
