use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use table_core::{DealId, H256, Money, Timestamp, invoice_id};
use thiserror::Error;
use url::Url;
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceId(String);
impl ResourceId {
    pub fn new(id: impl Into<String>) -> Result<Self, Error> {
        let id = id.into();
        if id.is_empty()
            || id.len() > 127
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err(Error::Invalid);
        }
        Ok(Self(id))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone)]
pub struct RequestId(String);
impl RequestId {
    pub fn for_operation(deal: DealId, attempt: u8, operation: &str) -> Result<Self, Error> {
        if ![
            "create",
            "authorize",
            "capture",
            "void",
            "invoice-create",
            "invoice-send",
            "subscription-suspend",
            "subscription-activate",
            "subscription-revise",
            "subscription-capture",
        ]
        .contains(&operation)
        {
            return Err(Error::Invalid);
        }
        Ok(Self(format!(
            "{}-{operation}",
            invoice_id(deal, attempt).map_err(|_| Error::Invalid)?
        )))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
#[derive(Debug, Clone)]
pub struct CreateOrder {
    pub deal: DealId,
    pub attempt: u8,
    pub amount: Money,
    pub terms_hash: H256,
    pub merchant_id: ResourceId,
}
/// Fixed return targets for the owner-run conformance spike. They confer no authority.
#[derive(Debug, Clone, Copy)]
pub enum ReturnDestination {
    Loopback { port: u16 },
    WalletScheme,
}
impl ReturnDestination {
    pub fn urls(self) -> Result<(String, String), Error> {
        match self {
            Self::Loopback { port } if port != 0 => Ok((
                format!("http://127.0.0.1:{port}/return"),
                format!("http://127.0.0.1:{port}/cancel"),
            )),
            Self::WalletScheme => Ok((
                "the-table://paypal/return".into(),
                "the-table://paypal/cancel".into(),
            )),
            _ => Err(Error::Invalid),
        }
    }
}
impl CreateOrder {
    pub fn body(&self) -> Result<Value, Error> {
        paypal_currency(self.amount)?;
        if self.amount.minor() == 0 {
            return Err(Error::Invalid);
        }
        Ok(
            json!({"intent":"AUTHORIZE", "purchase_units":[{"amount": amount_wire(self.amount), "invoice_id": invoice_id(self.deal, self.attempt).map_err(|_| Error::Invalid)?, "custom_id": self.terms_hash.hex(), "payee":{"merchant_id":self.merchant_id.as_str()}}]}),
        )
    }
}
pub fn amount_wire(amount: Money) -> Value {
    json!({"currency_code":amount.currency(),"value":amount.decimal()})
}
pub fn paypal_currency(amount: Money) -> Result<(), Error> {
    if matches!(
        amount.currency(),
        table_core::Currency::KWD | table_core::Currency::BHD
    ) || (amount.currency() == table_core::Currency::HUF && amount.minor() % 100 != 0)
    {
        return Err(Error::Invalid);
    }
    Ok(())
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OrderStatus {
    Created,
    Saved,
    Approved,
    Voided,
    Completed,
    PayerActionRequired,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Link {
    pub rel: String,
    pub href: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WireAmount {
    pub currency_code: table_core::Currency,
    pub value: String,
}
impl WireAmount {
    pub fn money(&self) -> Result<Money, Error> {
        Money::parse(&self.value, self.currency_code).map_err(|_| Error::Invalid)
    }
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Payee {
    pub merchant_id: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Payment {
    pub id: String,
    pub status: String,
    pub amount: WireAmount,
}
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Payments {
    #[serde(default)]
    pub authorizations: Vec<Payment>,
    #[serde(default)]
    pub captures: Vec<Payment>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PurchaseUnit {
    pub amount: WireAmount,
    pub invoice_id: Option<String>,
    pub custom_id: Option<String>,
    pub payee: Payee,
    #[serde(default)]
    pub payments: Payments,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Order {
    pub id: String,
    pub status: OrderStatus,
    pub intent: String,
    pub purchase_units: Vec<PurchaseUnit>,
    #[serde(default)]
    pub links: Vec<Link>,
}
impl Order {
    pub fn verify(&self, expected: &CreateOrder) -> Result<(), Error> {
        let [unit] = self.purchase_units.as_slice() else {
            return Err(Error::Mismatch);
        };
        if self.intent != "AUTHORIZE"
            || unit.amount.money()? != expected.amount
            || unit.invoice_id.as_deref()
                != Some(
                    invoice_id(expected.deal, expected.attempt)
                        .map_err(|_| Error::Invalid)?
                        .as_str(),
                )
            || unit.custom_id.as_deref() != Some(expected.terms_hash.hex().as_str())
            || unit.payee.merchant_id != expected.merchant_id.as_str()
        {
            return Err(Error::Mismatch);
        }
        ResourceId::new(&self.id)?;
        Ok(())
    }
    pub fn approval_url(&self) -> Result<Url, Error> {
        let mut links = self
            .links
            .iter()
            .filter(|l| l.rel == "approve" || l.rel == "payer-action");
        let link = links.next().ok_or(Error::Invalid)?;
        if links.next().is_some() {
            return Err(Error::Invalid);
        }
        approve_url(&link.href)
    }
}
pub fn approve_url(value: &str) -> Result<Url, Error> {
    let url = Url::parse(value).map_err(|_| Error::Invalid)?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !matches!(
            url.host_str(),
            Some("www.sandbox.paypal.com" | "www.paypal.com" | "sandbox.paypal.com" | "paypal.com")
        )
    {
        return Err(Error::Invalid);
    }
    Ok(url)
}
#[derive(Clone)]
pub struct Observation {
    pub method: &'static str,
    pub path: String,
    pub request_id: String,
    pub status: u16,
    pub body: Value,
}
impl std::fmt::Debug for Observation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Observation")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}
#[derive(Debug)]
pub struct ApiResponse<T> {
    pub value: T,
    pub observations: Vec<Observation>,
}
#[derive(Debug, Error)]
pub enum Error {
    #[error("invalid PayPal request or response")]
    Invalid,
    #[error("PayPal evidence does not match the deal")]
    Mismatch,
    #[error("PayPal request failed: status {status}; debug_id {debug_id:?}")]
    Api {
        status: u16,
        debug_id: Option<String>,
        observations: Vec<Observation>,
    },
    #[error("PayPal transport outcome unknown; reconcile before a new attempt")]
    Unknown { observations: Vec<Observation> },
    #[error("credentials unavailable")]
    Credentials,
}
impl Error {
    pub fn observations(&self) -> &[Observation] {
        match self {
            Self::Api { observations, .. } | Self::Unknown { observations } => observations,
            _ => &[],
        }
    }
}
#[derive(Debug, Clone, Copy)]
pub struct ReportingWindow {
    pub from: Timestamp,
    pub to: Timestamp,
    pub page: u32,
    pub page_size: u16,
}
impl ReportingWindow {
    pub fn validate(self) -> Result<(), Error> {
        if self.from < 0
            || self.to <= self.from
            || self.to - self.from > 31 * 86400
            || self.page == 0
            || !(1..=500).contains(&self.page_size)
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}
