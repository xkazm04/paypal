//! Sample market prices, labelled as such. The sandbox has no market service; this stands where the
//! market client would, behind the same `MarketApi`. The wallet's own market watch (T15) asks it,
//! under the owner's signed rule 9, and stores the answer as a re-checkable band exactly as it
//! stores a real one. Only the item the rule names is priced; anything else has no reference.
use async_trait::async_trait;
use std::sync::Arc;
use table_core::{Clock, Currency, H256, MarketRef, Money};
use table_market::{Error, MarketApi};

/// The product the owner's rule binds the monitor to.
pub const PRODUCT: &str = "sample-monitor-27";
/// Comparable listings for a 27-inch monitor, in cents. Sample data, not a market reading.
pub const COMPARABLES: [i64; 7] = [23_900, 24_500, 24_900, 25_900, 26_900, 27_900, 28_900];
/// The bytes the band's response hash commits to: the sample itself, named as one.
const SAMPLE: &[u8] = b"table-sandbox sample comparables for sample-monitor-27 (not a market reading): 239.00 245.00 249.00 259.00 269.00 279.00 289.00 USD";

pub struct SampleMarket(pub Arc<dyn Clock>);
impl std::fmt::Debug for SampleMarket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SampleMarket")
    }
}
#[async_trait]
impl MarketApi for SampleMarket {
    async fn comparables(&self, product: &str, currency: Currency) -> Result<MarketRef, Error> {
        if product != PRODUCT || currency != Currency::USD {
            return Err(Error::NoReference);
        }
        let prices = COMPARABLES
            .iter()
            .map(|cents| Money::new(*cents, Currency::USD))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| Error::Invalid)?;
        MarketRef::certified_prices(PRODUCT, H256::digest(SAMPLE), &prices, self.0.now())
            .map_err(|_| Error::Invalid)
    }
    async fn start_tracking(&self, _: &str) -> Result<(), Error> {
        Err(Error::NotTracking)
    }
    async fn history(&self, _: &str, _: u8) -> Result<Vec<Money>, Error> {
        Err(Error::NotTracking)
    }
}
