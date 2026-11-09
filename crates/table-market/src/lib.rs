//! Comparables ground the band. Tracking/history is a separate, explicit opt-in.
use async_trait::async_trait;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    sync::Arc,
};
use table_core::{
    Clock, Currency, H256, HIT_NAME_CHARS, HIT_TITLE_CHARS, MAX_MARKET_COMPARABLES,
    MarketCertificate, MarketComparable, MarketMatch, MarketRef, Money, ProductHit, ShopOffer,
    plain_text,
};
use table_paypal::http::{Request, Secret, Transport};
use thiserror::Error;
use tokio::sync::Mutex;
/// The market service's one origin.
const BASE: &str = "https://api.trychannel3.com";
/// What a status means for every market call: 200 answered, 404 has no reference, anything
/// else (another 2xx included) is unavailable.
fn answered(status: u16) -> Result<(), Error> {
    match status {
        200 => Ok(()),
        404 => Err(Error::NoReference),
        _ => Err(Error::Unavailable),
    }
}
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
    /// No market key is configured: an answer about the setup, not an outage.
    #[error("no market key is configured")]
    NoKey,
}

/// A product with its identity, the words to show and every in-stock new offer, shop by shop.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProductDetail {
    pub hit: ProductHit,
    pub offers: Vec<ShopOffer>,
}

/// The most products a search or a similar-products call asks for.
pub const MAX_SEARCH_HITS: usize = 30;
/// The longest search text sent.
const MAX_QUERY_CHARS: usize = 200;
/// The longest shop URL accepted for a lookup.
const MAX_URL_BYTES: usize = 2048;
#[async_trait]
pub trait ApiKey: Send + Sync {
    async fn load(&self) -> Result<Secret, Error>;
}
#[async_trait]
pub trait MarketApi: Send + Sync {
    async fn comparables(&self, product: &str, currency: Currency) -> Result<MarketRef, Error>;
    async fn start_tracking(&self, product: &str) -> Result<(), Error>;
    async fn history(&self, product: &str, days: u8) -> Result<Vec<Money>, Error>;
    /// Products matching words. Display only: nothing returned here enters a record.
    async fn search(
        &self,
        _query: &str,
        _currency: Currency,
        _limit: usize,
    ) -> Result<Vec<ProductHit>, Error> {
        Err(Error::Unavailable)
    }
    /// The product a shop page URL shows.
    async fn lookup(&self, _url: &str) -> Result<ProductHit, Error> {
        Err(Error::Unavailable)
    }
    /// One product by id, with its offers.
    async fn product(&self, _id: &str, _currency: Currency) -> Result<ProductDetail, Error> {
        Err(Error::Unavailable)
    }
    /// Products the service lists as similar to `id`, with their words and lowest price.
    async fn similar(
        &self,
        _id: &str,
        _currency: Currency,
        _limit: usize,
    ) -> Result<Vec<ProductHit>, Error> {
        Err(Error::Unavailable)
    }
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
    async fn exchange(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
    ) -> Result<(u16, Value), Error> {
        let key = self.key.load().await?;
        let r = self
            .transport
            .send(Request {
                method,
                url: format!("{BASE}{path}"),
                headers: vec![("x-api-key".into(), key)],
                body,
                form: None,
            })
            .await
            .map_err(|_| Error::Unavailable)?;
        Ok((r.status, r.body))
    }
    async fn request(
        &self,
        method: &'static str,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, Error> {
        let (status, body) = self.exchange(method, path, body).await?;
        answered(status).map(|()| body)
    }
    /// A POST whose answer is kept as the bytes that arrived (market-data-2): the caller hashes
    /// them before it parses anything.
    async fn post_raw(&self, path: &str, body: Value) -> Result<Vec<u8>, Error> {
        let key = self.key.load().await?;
        let r = self
            .transport
            .send_raw(Request {
                method: "POST",
                url: format!("{BASE}{path}"),
                headers: vec![("x-api-key".into(), key)],
                body: Some(body),
                form: None,
            })
            .await
            .map_err(|_| Error::Unavailable)?;
        answered(r.status).map(|()| r.bytes)
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
/// A shop name: a bare domain, or nothing. Anything else is merchant prose and is dropped.
fn shop_name(domain: &str) -> Option<String> {
    let d = domain.trim();
    (!d.is_empty()
        && d.len() <= HIT_NAME_CHARS
        && d.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b)))
    .then(|| d.to_ascii_lowercase())
}

/// A product as the screen shows it, with its in-stock new offers. A product without a
/// well-formed id is no hit at all: nothing could be done with it. Titles, brands and shops go
/// through [`plain_text`]; an offer that is out of stock, not known to be new, or in a currency
/// the wallet does not know is left out. `want` picks that currency's lowest offer when the
/// product has one.
fn product_from(p: &Value, want: Option<Currency>) -> Option<ProductDetail> {
    let id = p.get("id").and_then(Value::as_str)?;
    if !table_core::market_product_valid(id) {
        return None;
    }
    let words = |v: Option<&Value>, max: usize| {
        v.and_then(Value::as_str)
            .map(|t| plain_text(t, max))
            .filter(|t| !t.is_empty())
    };
    let mut offers = Vec::new();
    for o in p
        .get("offers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if o.get("availability").and_then(Value::as_str) != Some("InStock")
            || o.get("condition").and_then(Value::as_str) != Some("new")
        {
            continue;
        }
        let amount = o.get("price");
        let Some(currency) = amount
            .and_then(|a| a.get("currency"))
            .and_then(|c| serde_json::from_value::<Currency>(c.clone()).ok())
        else {
            continue;
        };
        let Some(shop) = o.get("domain").and_then(Value::as_str).and_then(shop_name) else {
            continue;
        };
        let Some(money) = amount
            .and_then(|a| a.get("price"))
            .and_then(|v| price(v, currency).ok())
            .filter(|m| m.minor() > 0)
        else {
            continue;
        };
        offers.push(ShopOffer { shop, price: money });
    }
    // One currency only: the wanted one when it has offers, else the first offer's.
    let shown = want
        .filter(|c| offers.iter().any(|o| o.price.currency() == *c))
        .or_else(|| offers.first().map(|o| o.price.currency()));
    let best = offers
        .iter()
        .filter(|o| Some(o.price.currency()) == shown)
        .min_by_key(|o| o.price.minor());
    let brand = p
        .get("brands")
        .and_then(Value::as_array)
        .and_then(|b| b.first())
        .and_then(|b| words(b.get("name"), HIT_NAME_CHARS));
    Some(ProductDetail {
        hit: ProductHit {
            id: id.to_owned(),
            title: words(p.get("title"), HIT_TITLE_CHARS),
            brand,
            price_minor: best.map(|o| o.price.minor()),
            currency: best.map(|o| o.price.currency()),
            shop: best.map(|o| o.shop.clone()),
        },
        offers,
    })
}

fn hits_from(raw: &Value, currency: Currency, limit: usize) -> Result<Vec<ProductHit>, Error> {
    Ok(raw
        .get("products")
        .and_then(Value::as_array)
        .ok_or(Error::Invalid)?
        .iter()
        .filter_map(|p| product_from(p, Some(currency)))
        .map(|d| d.hit)
        .take(limit.clamp(1, MAX_SEARCH_HITS))
        .collect())
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
    // Verified live 2026-11-09: POST /v1/search {query, limit, config.currency} answers
    // {products, next_page_token}; GET /v1/products/{id}?currency= answers one product;
    // POST /v1/lookup {url} answers {product} (500 "Product extraction failed" for a page it
    // cannot read); POST /v1/similar as `comparables` below. Offers carry domain, price,
    // availability and condition (null for some refurbished or unknown listings).
    async fn search(
        &self,
        query: &str,
        currency: Currency,
        limit: usize,
    ) -> Result<Vec<ProductHit>, Error> {
        let query = plain_text(query, MAX_QUERY_CHARS);
        if query.is_empty() {
            return Err(Error::Invalid);
        }
        let raw = self
            .request(
                "POST",
                "/v1/search",
                Some(json!({"query":query,"limit":limit.clamp(1, MAX_SEARCH_HITS),"config":{"currency":currency}})),
            )
            .await?;
        hits_from(&raw, currency, limit)
    }
    async fn lookup(&self, url: &str) -> Result<ProductHit, Error> {
        let url = url.trim();
        if url.len() > MAX_URL_BYTES
            || !url.starts_with("https://")
            || url.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(Error::Invalid);
        }
        let (status, body) = self
            .exchange("POST", "/v1/lookup", Some(json!({"url":url})))
            .await?;
        match status {
            200 => body
                .get("product")
                .and_then(|p| product_from(p, None))
                .map(|d| d.hit)
                .ok_or(Error::NoReference),
            // Not a product page, or a page the service could not read.
            404 | 422 | 500 => Err(Error::NoReference),
            _ => Err(Error::Unavailable),
        }
    }
    async fn product(&self, id: &str, currency: Currency) -> Result<ProductDetail, Error> {
        valid_product(id)?;
        let raw = self
            .request(
                "GET",
                &format!("/v1/products/{id}?currency={currency}"),
                None,
            )
            .await?;
        let detail = product_from(&raw, Some(currency)).ok_or(Error::Invalid)?;
        // The answer must be the product asked for.
        if detail.hit.id != id {
            return Err(Error::Invalid);
        }
        Ok(detail)
    }
    async fn similar(
        &self,
        id: &str,
        currency: Currency,
        limit: usize,
    ) -> Result<Vec<ProductHit>, Error> {
        valid_product(id)?;
        let raw = self
            .request(
                "POST",
                "/v1/similar",
                Some(json!({"product_id":id,"limit":limit.clamp(1, MAX_SEARCH_HITS),"config":{"currency":currency}})),
            )
            .await?;
        hits_from(&raw, currency, limit)
    }
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
        let bytes = self
            .post_raw(
                "/v1/similar",
                json!({"product_id":product,"limit":MAX_MARKET_COMPARABLES,"config":{"currency":currency}}),
            )
            .await?;
        // The hash is of the bytes exactly as they arrived, taken before parsing: parsing and
        // re-serialising would re-order keys and re-write numbers.
        let raw_sha256 = H256::digest(&bytes);
        let raw: Value = serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?;
        let products = raw
            .get("products")
            .and_then(Value::as_array)
            .ok_or(Error::Invalid)?;
        let mut comparables = Vec::new();
        // At most the request's own result limit is kept, in the service's order.
        for p in products.iter().take(MAX_MARKET_COMPARABLES) {
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
                // UNVERIFIED: the per-product id field is read as `id`; the research and the
                // recorded fixtures do not show it. An absent or malformed id is kept as none,
                // never as text (a title or merchant prose is never stored).
                let product_id = p
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|id| table_core::market_product_valid(id))
                    .map(str::to_owned);
                comparables.push(MarketComparable {
                    minor: m.minor(),
                    product_id,
                });
            }
        }
        if comparables.is_empty() {
            return Err(Error::NoReference);
        }
        let certificate = MarketCertificate::new(
            product.to_owned(),
            raw_sha256,
            MarketMatch::Similar,
            currency,
            comparables,
        )
        .map_err(|_| Error::Invalid)?;
        let band =
            MarketRef::certified(certificate, self.clock.now()).map_err(|_| Error::NoReference)?;
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
