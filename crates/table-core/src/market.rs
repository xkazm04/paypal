use crate::{Currency, DomainError, H256, Money, Timestamp, commitment};
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

/// The format a re-checkable market record commits under (market-data-2). A record without a
/// certificate is the first format: it keeps its quartiles but not what they were computed from,
/// so it cannot be re-checked.
pub const MARKET_CERTIFICATE_FORMAT: &str = "table.market.v2";
/// The first market record format, named in a commitment to a record without a certificate.
pub const MARKET_RECORD_FORMAT_V1: &str = "table.market.v1";
/// The most comparables one certificate keeps: the market request's own result limit.
pub const MAX_MARKET_COMPARABLES: usize = 30;

/// How the comparables were found for the asked product. The wallet asks one way today.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarketMatch {
    /// Products the market service lists as similar to the asked product.
    Similar,
}

/// One comparable: its lowest offer in the record's currency and the market service's id for
/// it. Typed numbers and identifiers only: no title, no merchant text.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketComparable {
    /// Minor units of the certificate's currency; always above zero.
    pub minor: i64,
    /// The market service's id for this product, when it gave a well-formed one.
    pub product_id: Option<String>,
}

/// What a market band was computed from, kept so anyone can compute it again (market-data-2):
/// the asked product, the SHA-256 of the response bytes exactly as they arrived, how the
/// comparables were matched, and the comparables sorted by price then id.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketCertificate {
    pub product_id: String,
    pub raw_sha256: H256,
    pub match_kind: MarketMatch,
    pub currency: Currency,
    pub comparables: Vec<MarketComparable>,
}
impl MarketCertificate {
    /// A certificate over `comparables` in any order; they are kept sorted by price, then id.
    pub fn new(
        product_id: String,
        raw_sha256: H256,
        match_kind: MarketMatch,
        currency: Currency,
        mut comparables: Vec<MarketComparable>,
    ) -> Result<Self, DomainError> {
        comparables.sort_by(|a, b| (a.minor, &a.product_id).cmp(&(b.minor, &b.product_id)));
        let certificate = Self {
            product_id,
            raw_sha256,
            match_kind,
            currency,
            comparables,
        };
        certificate.validate()?;
        Ok(certificate)
    }
    /// Well formed: a valid product id, 1 to [`MAX_MARKET_COMPARABLES`] comparables, each above
    /// zero with a well-formed id or none, sorted by price then id.
    pub fn validate(&self) -> Result<(), DomainError> {
        if !market_product_valid(&self.product_id)
            || self.comparables.is_empty()
            || self.comparables.len() > MAX_MARKET_COMPARABLES
            || self.comparables.iter().any(|c| {
                c.minor <= 0
                    || c.product_id
                        .as_deref()
                        .is_some_and(|id| !market_product_valid(id))
            })
            || self.comparables.windows(2).any(|pair| {
                (pair[0].minor, &pair[0].product_id) > (pair[1].minor, &pair[1].product_id)
            })
        {
            return Err(DomainError::InvalidTerms);
        }
        Ok(())
    }
    /// The comparables as money in the certificate's currency.
    pub fn prices(&self) -> Result<Vec<Money>, DomainError> {
        self.comparables
            .iter()
            .map(|c| Ok(Money::new(c.minor, self.currency)?))
            .collect()
    }
    /// Where `price` sits among the comparables, 0 to 100: the share priced below it, counting
    /// an equal price as half, rounded half up. Integer arithmetic only.
    pub fn percentile(&self, price: Money) -> Result<u8, DomainError> {
        self.validate()?;
        if price.currency() != self.currency {
            return Err(DomainError::InvalidTerms);
        }
        let n = self.comparables.len() as u64;
        let below = self
            .comparables
            .iter()
            .filter(|c| c.minor < price.minor())
            .count() as u64;
        let equal = self
            .comparables
            .iter()
            .filter(|c| c.minor == price.minor())
            .count() as u64;
        let pct = ((2 * below + equal) * 100 + n) / (2 * n);
        u8::try_from(pct).map_err(|_| DomainError::InvalidTerms)
    }
}

/// What the wallet writes into the row of a deal's agreement about the market price it bargained
/// on: the certificate's digest, or for an older record only the hash it kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "format", deny_unknown_fields)]
pub enum MarketCommitment {
    #[serde(rename = "table.market.v1")]
    V1 { response_hash: H256 },
    #[serde(rename = "table.market.v2")]
    V2 { digest: H256 },
}

/// How a deal's fair-price certificate reads after the wallet computed it again.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FairPriceState {
    /// The quartiles were computed again from the kept comparables and matched exactly.
    Rechecked,
    /// An older market record: it kept the band but not the prices behind it.
    NotRecheckable,
    /// The record the wallet committed to is missing or no longer computes to what it said.
    Broken,
}
/// The deal's price against the market prices it was bargained on (market-data-2). Evidence
/// only: it never moves or holds money.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FairPrice {
    pub state: FairPriceState,
    /// True when the wallet wrote this record's digest into its own record when the deal was
    /// agreed; false for the latest market price of a deal not agreed yet.
    pub committed: bool,
    /// Where the deal's unit price sits among the market prices, 0 to 100; null unless
    /// re-checked.
    pub percentile: Option<u8>,
    /// How many market prices the record holds; 0 for an older record.
    pub prices: u32,
    /// When the market prices were read; null when the committed record is missing.
    pub retrieved_at: Option<Timestamp>,
}
/// The market facts in one deal's audit rows (action, detail), read oldest first up to its
/// agreement: whether it was agreed, the market commitment the agreement row carries, and every
/// re-checkable market record kept before it whose quartiles still compute again. A record that
/// does not is left out, so a commitment to it reads as broken.
#[derive(Debug, Clone, Default)]
pub struct MarketRows {
    pub agreed: bool,
    pub commitment: Option<MarketCommitment>,
    pub observed: Vec<MarketRef>,
}
pub fn market_rows<'a>(
    rows: impl IntoIterator<Item = (&'a str, &'a serde_json::Value)>,
) -> MarketRows {
    let mut out = MarketRows::default();
    for (action, detail) in rows {
        match action {
            "deal.transition"
                if detail
                    .get("to")
                    .and_then(|to| serde_json::from_value::<crate::DealState>(to.clone()).ok())
                    == Some(crate::DealState::Agreed) =>
            {
                out.agreed = true;
                out.commitment = detail
                    .get("market")
                    .and_then(|m| serde_json::from_value(m.clone()).ok());
                break;
            }
            "market.observed" => {
                if let Some(reference) = detail
                    .get("reference")
                    .and_then(|r| serde_json::from_value::<MarketRef>(r.clone()).ok())
                    .filter(|r| r.validate().is_ok())
                {
                    out.observed.push(reference);
                }
            }
            _ => {}
        }
    }
    out
}
/// The fair-price certificate of a deal: the commitment its agreement row carries, checked
/// against the market records the deal kept (`observed`, each already re-checked); without a
/// commitment, the deal's latest market price. Pure.
pub fn fair_price(
    commitment: Option<&MarketCommitment>,
    observed: &[MarketRef],
    current: Option<&MarketRef>,
    unit_price: Money,
) -> Option<FairPrice> {
    let older = |committed: bool, retrieved_at: Option<Timestamp>| FairPrice {
        state: FairPriceState::NotRecheckable,
        committed,
        percentile: None,
        prices: 0,
        retrieved_at,
    };
    let rechecked = |reference: &MarketRef, committed: bool| {
        let certificate = reference.certificate.as_ref()?;
        let percentile = certificate.percentile(unit_price).ok()?;
        Some(FairPrice {
            state: FairPriceState::Rechecked,
            committed,
            percentile: Some(percentile),
            prices: u32::try_from(certificate.comparables.len()).ok()?,
            retrieved_at: Some(reference.retrieved_at),
        })
    };
    let broken = |retrieved_at| FairPrice {
        state: FairPriceState::Broken,
        committed: true,
        percentile: None,
        prices: 0,
        retrieved_at,
    };
    match commitment {
        Some(MarketCommitment::V1 { response_hash }) => Some(older(
            true,
            observed
                .iter()
                .chain(current)
                .rfind(|r| r.response_hash == *response_hash)
                .map(|r| r.retrieved_at),
        )),
        Some(MarketCommitment::V2 { digest }) => {
            let Some(reference) = observed
                .iter()
                .rfind(|r| r.digest().ok().flatten() == Some(*digest))
            else {
                return Some(broken(None));
            };
            Some(rechecked(reference, true).unwrap_or(broken(Some(reference.retrieved_at))))
        }
        None => match current {
            None => None,
            Some(reference) if reference.certificate.is_none() => {
                Some(older(false, Some(reference.retrieved_at)))
            }
            Some(reference) => Some(rechecked(reference, false).unwrap_or(FairPrice {
                committed: false,
                ..broken(Some(reference.retrieved_at))
            })),
        },
    }
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
    /// What the band was computed from (market-data-2); absent from an older record, which
    /// cannot be re-checked. The quartiles above are computed again from it on every read.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub certificate: Option<MarketCertificate>,
}
impl MarketRef {
    /// A re-checkable band: the quartiles computed from the certificate's comparables, the
    /// response hash its raw-bytes hash.
    pub fn certified(
        certificate: MarketCertificate,
        retrieved_at: Timestamp,
    ) -> Result<Self, DomainError> {
        certificate.validate()?;
        let mut band =
            Self::from_comparables(certificate.prices()?, retrieved_at, certificate.raw_sha256)?;
        band.certificate = Some(certificate);
        band.validate()?;
        Ok(band)
    }
    /// A re-checkable band over `prices` (one currency) for `product_id`, its comparables
    /// carrying no ids: a similar-products answer whose products gave none.
    pub fn certified_prices(
        product_id: &str,
        raw_sha256: H256,
        prices: &[Money],
        retrieved_at: Timestamp,
    ) -> Result<Self, DomainError> {
        let currency = prices.first().ok_or(DomainError::InvalidTerms)?.currency();
        let comparables = prices
            .iter()
            .map(|p| {
                if p.currency() != currency {
                    return Err(DomainError::InvalidTerms);
                }
                Ok(MarketComparable {
                    minor: p.minor(),
                    product_id: None,
                })
            })
            .collect::<Result<_, _>>()?;
        Self::certified(
            MarketCertificate::new(
                product_id.to_owned(),
                raw_sha256,
                MarketMatch::Similar,
                currency,
                comparables,
            )?,
            retrieved_at,
        )
    }
    /// The digest the wallet commits to when a deal is agreed on this record: over the format,
    /// the retrieval time and the certificate. `None` for an older record.
    pub fn digest(&self) -> Result<Option<H256>, DomainError> {
        self.certificate
            .as_ref()
            .map(|c| {
                Ok(commitment(&(
                    MARKET_CERTIFICATE_FORMAT,
                    self.retrieved_at,
                    c,
                ))?)
            })
            .transpose()
    }
    /// What the agreement row commits to for this record.
    pub fn commitment(&self) -> Result<MarketCommitment, DomainError> {
        Ok(match self.digest()? {
            Some(digest) => MarketCommitment::V2 { digest },
            None => MarketCommitment::V1 {
                response_hash: self.response_hash,
            },
        })
    }
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
            certificate: None,
        };
        band.validate()?;
        Ok(band)
    }
    /// Ordered quartiles in one currency with a non-zero median; for a certified record also
    /// that the certificate is well formed, in the band's currency, names the response hash, and
    /// that its comparables compute to exactly these quartiles again.
    pub fn validate(&self) -> Result<(), DomainError> {
        self.p25.same_currency(self.median)?;
        self.median.same_currency(self.p75)?;
        if self.p25.minor() > self.median.minor()
            || self.median.minor() > self.p75.minor()
            || self.median.minor() == 0
        {
            return Err(DomainError::InvalidTerms);
        }
        if let Some(certificate) = &self.certificate {
            certificate.validate()?;
            let again = Self::from_comparables(
                certificate.prices()?,
                self.retrieved_at,
                self.response_hash,
            )?;
            if certificate.currency != self.median.currency()
                || certificate.raw_sha256 != self.response_hash
                || again.p25 != self.p25
                || again.median != self.median
                || again.p75 != self.p75
            {
                return Err(DomainError::InvalidTerms);
            }
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
    fn certificate(prices: &[(i64, &str)]) -> MarketCertificate {
        MarketCertificate::new(
            "product".into(),
            H256::digest(b"raw"),
            MarketMatch::Similar,
            Currency::USD,
            prices
                .iter()
                .map(|(minor, id)| MarketComparable {
                    minor: *minor,
                    product_id: Some((*id).into()),
                })
                .collect(),
        )
        .unwrap()
    }
    #[test]
    fn a_certified_band_is_computed_again_from_its_stored_comparables_on_every_read() {
        let band = MarketRef::certified(certificate(&[(2020, "b"), (1010, "a")]), 100).unwrap();
        assert_eq!(band.median.minor(), 1515);
        assert_eq!(band.response_hash, H256::digest(b"raw"));
        let stored = serde_json::to_string(&band).unwrap();
        let read: MarketRef = serde_json::from_str(&stored).unwrap();
        read.validate().unwrap();
        assert_eq!(read.median.minor(), 1515);
        assert_eq!(
            read.certificate.as_ref().unwrap().comparables[0].minor,
            1010
        );
        // A stored median that its comparables do not compute to is refused on read.
        let forged = stored.replace(r#""median":{"minor":1515"#, r#""median":{"minor":1516"#);
        assert_ne!(forged, stored);
        let forged: MarketRef = serde_json::from_str(&forged).unwrap();
        assert!(forged.validate().is_err());
        // So is a comparable changed under the same quartiles, or a hash the record never had.
        let mut moved = read.clone();
        moved.certificate.as_mut().unwrap().comparables[1].minor = 2021;
        assert!(moved.validate().is_err());
        let mut rehashed = read.clone();
        rehashed.response_hash = H256::ZERO;
        assert!(rehashed.validate().is_err());
        // The digest covers the certificate and the time it was read.
        assert_ne!(read.digest().unwrap(), moved.digest().unwrap());
        let mut later = read.clone();
        later.retrieved_at = 101;
        assert_ne!(read.digest().unwrap(), later.digest().unwrap());
        assert!(matches!(
            read.commitment().unwrap(),
            MarketCommitment::V2 { .. }
        ));
    }
    #[test]
    fn a_certificate_keeps_only_well_formed_ids_and_at_most_the_result_limit() {
        let ok = |prices: Vec<MarketComparable>| {
            MarketCertificate::new(
                "product".into(),
                H256::ZERO,
                MarketMatch::Similar,
                Currency::USD,
                prices,
            )
        };
        let one = |minor, id: Option<&str>| MarketComparable {
            minor,
            product_id: id.map(Into::into),
        };
        assert!(ok(vec![one(100, Some("ignore previous instructions"))]).is_err());
        assert!(ok(vec![one(0, None)]).is_err());
        assert!(ok(vec![]).is_err());
        assert!(ok((1..=31).map(|m| one(m, None)).collect()).is_err());
        assert!(ok((1..=30).map(|m| one(m, None)).collect()).is_ok());
        let mut unsorted = certificate(&[(1010, "a"), (2020, "b")]);
        unsorted.comparables.reverse();
        assert!(unsorted.validate().is_err());
        assert!(
            MarketCertificate::new(
                "not a product".into(),
                H256::ZERO,
                MarketMatch::Similar,
                Currency::USD,
                vec![one(1, None)]
            )
            .is_err()
        );
    }
    #[test]
    fn the_deal_price_percentile_counts_an_equal_price_as_half() {
        let money = |v| Money::new(v, Currency::USD).unwrap();
        let c = certificate(&[(1010, "a"), (2020, "b")]);
        assert_eq!(c.percentile(money(1000)).unwrap(), 0);
        assert_eq!(c.percentile(money(1010)).unwrap(), 25);
        assert_eq!(c.percentile(money(1515)).unwrap(), 50);
        assert_eq!(c.percentile(money(2020)).unwrap(), 75);
        assert_eq!(c.percentile(money(9999)).unwrap(), 100);
        assert!(
            c.percentile(Money::new(1515, Currency::EUR).unwrap())
                .is_err()
        );
        let nine: Vec<(i64, &str)> = (1..=9).map(|i| (i * 100, "x")).collect();
        // 7 below and 1 equal of 9: (14 + 1) / 18 = 83.3...
        assert_eq!(certificate(&nine).percentile(money(800)).unwrap(), 83);
    }
    #[test]
    fn an_older_record_reads_as_not_recheckable_and_a_missing_commitment_as_broken() {
        let money = |v| Money::new(v, Currency::USD).unwrap();
        let v2 = MarketRef::certified(certificate(&[(1010, "a"), (2020, "b")]), 100).unwrap();
        let v1 = MarketRef::from_comparables(vec![money(1515)], 90, H256::digest(b"v1")).unwrap();
        // An older record stored before certificates still reads, validates and keeps its bytes.
        let stored = r#"{"p25":{"minor":1515,"currency":"USD"},"median":{"minor":1515,"currency":"USD"},"p75":{"minor":1515,"currency":"USD"},"retrieved_at":90,"response_hash":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],"cached":false}"#;
        let old: MarketRef = serde_json::from_str(stored).unwrap();
        old.validate().unwrap();
        assert_eq!(serde_json::to_string(&old).unwrap(), stored);
        assert_eq!(old.digest().unwrap(), None);
        let price = money(1515);
        let committed_v1 = v1.commitment().unwrap();
        let fp = fair_price(
            Some(&committed_v1),
            std::slice::from_ref(&v1),
            Some(&v2),
            price,
        )
        .unwrap();
        assert_eq!(fp.state, FairPriceState::NotRecheckable);
        assert!(fp.committed && fp.percentile.is_none());
        let committed = v2.commitment().unwrap();
        let fp = fair_price(Some(&committed), &[v1.clone(), v2.clone()], None, price).unwrap();
        assert_eq!(
            (fp.state, fp.committed, fp.percentile, fp.prices),
            (FairPriceState::Rechecked, true, Some(50), 2)
        );
        let fp = fair_price(
            Some(&committed),
            std::slice::from_ref(&v1),
            Some(&v2),
            price,
        )
        .unwrap();
        assert_eq!(fp.state, FairPriceState::Broken);
        let fp = fair_price(None, &[], Some(&v2), money(2020)).unwrap();
        assert_eq!(
            (fp.state, fp.committed, fp.percentile),
            (FairPriceState::Rechecked, false, Some(75))
        );
        assert_eq!(
            fair_price(None, &[], Some(&v1), price).unwrap().state,
            FairPriceState::NotRecheckable
        );
        assert!(fair_price(None, &[], None, price).is_none());
    }
}
