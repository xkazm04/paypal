//! Narrow secondary sandbox APIs. No Plans pricing method exists here.
//! Bodies verified against PayPal's official invoicing_v2 / billing_subscriptions_v1 specs.
use crate::*;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use table_core::{DealId, InvoiceText, Money, Timestamp};

/// The invoice number a rescue invoice carries for `(deal, attempt)`: "R", the deal ULID's last
/// 16 characters (its random part) and the attempt. Deterministic, so a lost create can be looked
/// up by it and never needs a second invoice; short, because PayPal caps the field.
// UNVERIFIED: the research names Invoicing v2 but not `detail.invoice_number`, its length cap
// (25 characters assumed) or its per-merchant uniqueness; spike 8 records whether the search
// finds the invoice by it.
pub fn rescue_invoice_number(deal: DealId, attempt: u8) -> Result<String, Error> {
    if !(1..=3).contains(&attempt) {
        return Err(Error::Invalid);
    }
    let id = deal.to_string();
    Ok(format!("R{}-{attempt}", &id[id.len() - 16..]))
}

#[derive(Clone)]
pub struct InvoiceRequest {
    pub deal: DealId,
    pub recipient_email: String,
    pub amount: Money,
    /// From [`rescue_invoice_number`].
    pub invoice_number: String,
    /// The wallet's fixed wording (table-core `invoice_text`); never counterparty or agent text.
    pub text: InvoiceText,
}
impl std::fmt::Debug for InvoiceRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InvoiceRequest { [REDACTED] }")
    }
}
impl InvoiceRequest {
    pub fn body(&self) -> Result<Value, Error> {
        paypal_currency(self.amount)?;
        if self.amount.minor() == 0
            || self.recipient_email.len() > 254
            || !self.recipient_email.contains('@')
            || self.recipient_email.contains(['\r', '\n', ' '])
            || self.invoice_number.is_empty()
            || self.invoice_number.len() > 25
            || !self
                .invoice_number
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || self.text.item.is_empty()
            || self.text.item.len() > 200
            || self.text.note.len() > 4000
        {
            return Err(Error::Invalid);
        }
        // UNVERIFIED: `detail.invoice_number` and `detail.note` (field names from the public
        // invoicing_v2 spec as recalled; the research lists the endpoints only).
        Ok(
            json!({"detail":{"currency_code":self.amount.currency(),"reference":self.deal.to_string(),"invoice_number":self.invoice_number,"note":self.text.note},"primary_recipients":[{"billing_info":{"email_address":self.recipient_email}}],"items":[{"name":self.text.item,"quantity":"1","unit_amount":amount_wire(self.amount)}]}),
        )
    }
}
/// The invoice's own reference fields, as PayPal returns them.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct InvoiceDetail {
    pub reference: Option<String>,
    pub invoice_number: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Invoice {
    pub id: String,
    pub status: String,
    pub amount: Option<WireAmount>,
    pub due_amount: Option<WireAmount>,
    #[serde(default)]
    pub detail: Option<InvoiceDetail>,
}
/// A page of `search-invoices` results.
// UNVERIFIED: the response's `items` array (research lists the endpoint, not its body).
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct InvoiceList {
    #[serde(default)]
    pub items: Vec<Invoice>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SubscriptionBilling {
    pub outstanding_balance: WireAmount,
    pub failed_payments_count: u32,
    pub last_failed_payment: Option<FailedPaymentDetails>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FailedPaymentDetails {
    pub next_payment_retry_time: Option<String>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Subscription {
    pub id: String,
    pub status: String,
    pub plan_id: String,
    pub billing_info: Option<SubscriptionBilling>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TransactionInfo {
    pub transaction_id: String,
    pub transaction_status: String,
    pub transaction_amount: WireAmount,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TransactionDetail {
    pub transaction_info: TransactionInfo,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TransactionPage {
    #[serde(default)]
    pub transaction_details: Vec<TransactionDetail>,
    pub total_pages: u32,
    pub page: u32,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Dispute {
    pub dispute_id: String,
    pub status: String,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct DisputeList {
    #[serde(default)]
    pub items: Vec<Dispute>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct RevisedSubscription {
    pub id: String,
    #[serde(default)]
    pub links: Vec<Link>,
}
#[async_trait]
pub trait SecondaryApi: Send + Sync {
    async fn create_invoice(
        &self,
        request: &InvoiceRequest,
        id: &RequestId,
    ) -> Result<ApiResponse<Invoice>, Error>;
    async fn send_invoice(
        &self,
        id: &ResourceId,
        request: &RequestId,
    ) -> Result<ApiResponse<()>, Error>;
    async fn get_invoice(&self, id: &ResourceId) -> Result<ApiResponse<Invoice>, Error>;
    async fn get_subscription(&self, id: &ResourceId) -> Result<ApiResponse<Subscription>, Error>;
    async fn suspend_subscription(
        &self,
        id: &ResourceId,
        request: &RequestId,
    ) -> Result<ApiResponse<()>, Error>;
    async fn activate_subscription(
        &self,
        id: &ResourceId,
        request: &RequestId,
    ) -> Result<ApiResponse<()>, Error>;
    async fn revise_subscription(
        &self,
        id: &ResourceId,
        plan: &ResourceId,
        request: &RequestId,
    ) -> Result<ApiResponse<RevisedSubscription>, Error>;
    async fn capture_outstanding(
        &self,
        id: &ResourceId,
        amount: Money,
        request: &RequestId,
    ) -> Result<ApiResponse<()>, Error>;
    async fn transactions(
        &self,
        window: ReportingWindow,
    ) -> Result<ApiResponse<TransactionPage>, Error>;
    async fn list_disputes(&self) -> Result<ApiResponse<DisputeList>, Error>;
    async fn get_dispute(&self, id: &ResourceId) -> Result<ApiResponse<Dispute>, Error>;
    /// Find invoices by invoice number: the read-back for a rescue invoice whose create answer
    /// was lost. A read: it creates nothing. Implementations without it find nothing.
    async fn search_invoices(&self, _invoice_number: &str) -> Result<ApiResponse<InvoiceList>, Error> {
        Err(Error::Invalid)
    }
}
fn iso(at: Timestamp) -> Result<String, Error> {
    time::OffsetDateTime::from_unix_timestamp(at)
        .map_err(|_| Error::Invalid)?
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| Error::Invalid)
}
impl Client {
    async fn secondary_decoded<T: serde::de::DeserializeOwned>(
        &self,
        path: String,
        body: Value,
        id: &RequestId,
    ) -> Result<ApiResponse<T>, Error> {
        let r = self
            .execute_policy("POST", path, Some(body), Some(id), false)
            .await?;
        let value = serde_json::from_value(r.value).map_err(|_| Error::Unknown {
            observations: r.observations.clone(),
        })?;
        Ok(ApiResponse {
            value,
            observations: r.observations,
        })
    }
    async fn secondary_unit(
        &self,
        path: String,
        body: Value,
        id: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        let response = self
            .execute_policy("POST", path, Some(body), Some(id), false)
            .await?;
        Ok(ApiResponse {
            value: (),
            observations: response.observations,
        })
    }
    /// Bounded pagination. A partial traversal never masquerades as complete reporting.
    pub async fn all_transactions(
        &self,
        mut window: ReportingWindow,
        max_pages: u16,
    ) -> Result<ApiResponse<Vec<TransactionDetail>>, Error> {
        window.validate()?;
        if max_pages == 0 || max_pages > 20 || window.page != 1 {
            return Err(Error::Invalid);
        }
        let mut items = Vec::new();
        let mut observations = Vec::new();
        for expected in 1..=u32::from(max_pages) {
            window.page = expected;
            let response = self.transactions(window).await?;
            observations.extend(response.observations);
            if response.value.page != expected
                || response.value.transaction_details.len() > usize::from(window.page_size)
                || response.value.total_pages > u32::from(max_pages)
            {
                return Err(Error::Unknown { observations });
            }
            items.extend(response.value.transaction_details);
            if expected >= response.value.total_pages {
                return Ok(ApiResponse {
                    value: items,
                    observations,
                });
            }
        }
        Err(Error::Unknown { observations })
    }
}
#[async_trait]
impl SecondaryApi for Client {
    async fn create_invoice(
        &self,
        r: &InvoiceRequest,
        id: &RequestId,
    ) -> Result<ApiResponse<Invoice>, Error> {
        self.secondary_decoded("/v2/invoicing/invoices".into(), r.body()?, id)
            .await
    }
    async fn send_invoice(&self, id: &ResourceId, r: &RequestId) -> Result<ApiResponse<()>, Error> {
        self.secondary_unit(
            format!("/v2/invoicing/invoices/{}/send", id.as_str()),
            json!({"send_to_recipient":true,"send_to_invoicer":false}),
            r,
        )
        .await
    }
    async fn get_invoice(&self, id: &ResourceId) -> Result<ApiResponse<Invoice>, Error> {
        self.decoded(
            "GET",
            format!("/v2/invoicing/invoices/{}", id.as_str()),
            None,
            None,
        )
        .await
    }
    async fn get_subscription(&self, id: &ResourceId) -> Result<ApiResponse<Subscription>, Error> {
        self.decoded(
            "GET",
            format!(
                "/v1/billing/subscriptions/{}?fields=last_failed_payment",
                id.as_str()
            ),
            None,
            None,
        )
        .await
    }
    async fn suspend_subscription(
        &self,
        id: &ResourceId,
        r: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        self.secondary_unit(
            format!("/v1/billing/subscriptions/{}/suspend", id.as_str()),
            json!({"reason":"Owner approved pause"}),
            r,
        )
        .await
    }
    async fn activate_subscription(
        &self,
        id: &ResourceId,
        r: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        self.secondary_unit(
            format!("/v1/billing/subscriptions/{}/activate", id.as_str()),
            json!({"reason":"Owner approved resumption"}),
            r,
        )
        .await
    }
    async fn revise_subscription(
        &self,
        id: &ResourceId,
        plan: &ResourceId,
        r: &RequestId,
    ) -> Result<ApiResponse<RevisedSubscription>, Error> {
        self.secondary_decoded(
            format!("/v1/billing/subscriptions/{}/revise", id.as_str()),
            json!({"plan_id":plan.as_str()}),
            r,
        )
        .await
    }
    async fn capture_outstanding(
        &self,
        id: &ResourceId,
        amount: Money,
        r: &RequestId,
    ) -> Result<ApiResponse<()>, Error> {
        paypal_currency(amount)?;
        if amount.minor() == 0 {
            return Err(Error::Invalid);
        }
        self.secondary_unit(format!("/v1/billing/subscriptions/{}/capture",id.as_str()),json!({"capture_type":"OUTSTANDING_BALANCE","note":"Owner approved missed-cycle collection","amount":amount_wire(amount)}),r).await
    }
    async fn transactions(
        &self,
        w: ReportingWindow,
    ) -> Result<ApiResponse<TransactionPage>, Error> {
        w.validate()?;
        let current = time::OffsetDateTime::from_unix_timestamp(self.clock_now())
            .map_err(|_| Error::Invalid)?;
        let earliest = current
            .replace_year(current.year() - 3)
            .or_else(|_| {
                current
                    .replace_day(28)
                    .and_then(|t| t.replace_year(t.year() - 3))
            })
            .map_err(|_| Error::Invalid)?
            .unix_timestamp();
        if w.from < earliest || w.to > self.clock_now() {
            return Err(Error::Invalid);
        }
        let mut url = url::Url::parse("https://api-m.sandbox.paypal.com/v1/reporting/transactions")
            .map_err(|_| Error::Invalid)?;
        url.query_pairs_mut()
            .append_pair("start_date", &iso(w.from)?)
            .append_pair("end_date", &iso(w.to)?)
            .append_pair("page", &w.page.to_string())
            .append_pair("page_size", &w.page_size.to_string())
            .append_pair("fields", "transaction_info");
        let path = format!("{}?{}", url.path(), url.query().ok_or(Error::Invalid)?);
        self.decoded("GET", path, None, None).await
    }
    async fn list_disputes(&self) -> Result<ApiResponse<DisputeList>, Error> {
        self.decoded("GET", "/v1/customer/disputes".into(), None, None)
            .await
    }
    async fn get_dispute(&self, id: &ResourceId) -> Result<ApiResponse<Dispute>, Error> {
        self.decoded(
            "GET",
            format!("/v1/customer/disputes/{}", id.as_str()),
            None,
            None,
        )
        .await
    }
    // UNVERIFIED: the search body field `invoice_number`. The research lists
    // POST /v2/invoicing/search-invoices [S-spec] but not its filters; a filter PayPal ignores can
    // only return invoices the caller then fails to match, so the read-back stays parked.
    async fn search_invoices(&self, invoice_number: &str) -> Result<ApiResponse<InvoiceList>, Error> {
        if invoice_number.is_empty()
            || invoice_number.len() > 25
            || !invoice_number
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err(Error::Invalid);
        }
        self.decoded(
            "POST",
            "/v2/invoicing/search-invoices".into(),
            Some(json!({"invoice_number":invoice_number})),
            None,
        )
        .await
    }
}
