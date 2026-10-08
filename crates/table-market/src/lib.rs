//! Comparables ground the band. Tracking/history is a separate, explicit opt-in.
use async_trait::async_trait;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::Arc,
};
use table_core::{Clock, Currency, H256, MarketRef, Money};
use table_paypal::http::{Request, Secret, Transport};
use thiserror::Error;
use tokio::sync::Mutex;
#[derive(Debug, Error)]
pub enum Error {
    #[error("market unavailable")]
    Unavailable,
    #[error("no market reference")]
    NoReference,
    #[error("invalid market data or request")]
    Invalid,
    #[error("price tracking requires explicit opt-in")]
    NotTracking,
}
#[async_trait]
pub trait ApiKey: Send + Sync {
    async fn load(&self) -> Result<Secret, Error>;
}
#[async_trait]
pub trait MarketApi: Send + Sync {
    async fn comparables(&self, product: &str, currency: Currency) -> Result<MarketRef, Error>;
    async fn start_tracking(&self, product: &str) -> Result<(), Error>;
    async fn history(&self, product: &str, days: u8) -> Result<Vec<Money>, Error>;
}
pub struct Client {
    transport: Arc<dyn Transport>,
    key: Arc<dyn ApiKey>,
    clock: Arc<dyn Clock>,
    cache: Mutex<BTreeMap<(String, String), MarketRef>>,
    tracking: Mutex<BTreeSet<String>>,
}
impl fmt::Debug for Client {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Channel3Client")
    }
}
impl Client {
    pub fn new(transport: Arc<dyn Transport>, key: Arc<dyn ApiKey>, clock: Arc<dyn Clock>) -> Self {
        Self {
            transport,
            key,
            clock,
            cache: Mutex::new(BTreeMap::new()),
            tracking: Mutex::new(BTreeSet::new()),
        }
    }
    async fn request(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, Error> {
        let key = self.key.load().await?;
        let r = self
            .transport
            .send(Request {
                method,
                url: format!("https://api.trychannel3.com{path}"),
                headers: vec![("x-api-key".into(), key)],
                body,
                form: None,
            })
            .await
            .map_err(|_| Error::Unavailable)?;
        match r.status {
            200 => Ok(r.body),
            404 => Err(Error::NoReference),
            _ => Err(Error::Unavailable),
        }
    }
    pub async fn cached(&self, product: &str, currency: Currency) -> Option<MarketRef> {
        self.cache
            .lock()
            .await
            .get(&(product.into(), currency.to_string()))
            .cloned()
            .map(|mut r| {
                r.cached = true;
                r
            })
    }
}
fn valid_product(product: &str) -> Result<(), Error> {
    if !table_core::market_product_valid(product) {
        return Err(Error::Invalid);
    }
    Ok(())
}
fn price(value: &Value, currency: Currency) -> Result<Money, Error> {
    let decimal = match value {
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        _ => return Err(Error::Invalid),
    };
    Money::parse(&decimal, currency).map_err(|_| Error::Invalid)
}
#[async_trait]
impl MarketApi for Client {
    async fn comparables(&self, product: &str, currency: Currency) -> Result<MarketRef, Error> {
        valid_product(product)?;
        // A cached band is served only while it has more than the refresh lead of freshness
        // left, so a scheduled refresh (T15) always fetches a new one.
        if let Some(r) = self.cached(product, currency).await
            && !table_core::market_refresh_due(Some(&r), self.clock.now())
        {
            return Ok(r);
        }
        // Verified 2026-10-02: api-reference/v1/similar-products.md (path /v1/similar).
        let raw = self
            .request(
                "POST",
                "/v1/similar",
                Some(json!({"product_id":product,"limit":30,"config":{"currency":currency}})),
            )
            .await?;
        let products = raw
            .get("products")
            .and_then(Value::as_array)
            .ok_or(Error::Invalid)?;
        let mut prices = Vec::new();
        for p in products {
            let offers = p
                .get("offers")
                .and_then(Value::as_array)
                .ok_or(Error::Invalid)?;
            let mut best = None;
            for offer in offers {
                let amount = offer.get("price").ok_or(Error::Invalid)?;
                if amount.get("currency").and_then(Value::as_str)
                    != Some(currency.to_string().as_str())
                {
                    continue;
                }
                let m = price(amount.get("price").ok_or(Error::Invalid)?, currency)?;
                if m.minor() > 0 && best.is_none_or(|b: Money| m.minor() < b.minor()) {
                    best = Some(m);
                }
            }
            if let Some(m) = best {
                prices.push(m);
            }
        }
        let hash = H256::digest(&serde_json::to_vec(&raw).map_err(|_| Error::Invalid)?);
        let band = MarketRef::from_comparables(prices, self.clock.now(), hash)
            .map_err(|_| Error::NoReference)?;
        self.cache
            .lock()
            .await
            .insert((product.into(), currency.to_string()), band.clone());
        Ok(band)
    }
    async fn start_tracking(&self, product: &str) -> Result<(), Error> {
        valid_product(product)?;
        let r = self
            .request(
                "POST",
                "/v0/price-tracking/start",
                Some(json!({"canonical_product_id":product})),
            )
            .await?;
        if r.get("canonical_product_id").and_then(Value::as_str) != Some(product)
            || r.get("subscription_status").and_then(Value::as_str) != Some("active")
        {
            return Err(Error::Invalid);
        }
        self.tracking.lock().await.insert(product.into());
        Ok(())
    }
    async fn history(&self, product: &str, days: u8) -> Result<Vec<Money>, Error> {
        valid_product(product)?;
        if !(1..=30).contains(&days) {
            return Err(Error::Invalid);
        }
        if !self.tracking.lock().await.contains(product) {
            return Err(Error::NotTracking);
        }
        let r = self
            .request(
                "GET",
                &format!("/v0/price-tracking/history/{product}?days={days}"),
                None,
            )
            .await?;
        if r.get("canonical_product_id").and_then(Value::as_str) != Some(product) {
            return Err(Error::Invalid);
        }
        let points = r
            .get("history")
            .and_then(Value::as_array)
            .ok_or(Error::Invalid)?
            .iter()
            .map(|p| {
                let currency =
                    serde_json::from_value(p.get("currency").cloned().ok_or(Error::Invalid)?)
                        .map_err(|_| Error::Invalid)?;
                price(p.get("price").ok_or(Error::Invalid)?, currency)
            })
            .collect::<Result<Vec<Money>, _>>()?;
        // A series is only comparable within one currency; a mixed one is refused, not merged.
        if points
            .windows(2)
            .any(|pair| pair[0].currency() != pair[1].currency())
        {
            return Err(Error::Invalid);
        }
        Ok(points)
    }
}
