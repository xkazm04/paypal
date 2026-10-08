use serde_json::{Map, Value};
/// Unknown text/metadata is discarded. Known secrets are removed even from safe ID fields.
pub fn redact_paypal(value: &Value, sensitive_values: &[&str]) -> Value {
    fn walk(value: &Value, field: &str, secrets: &[&str]) -> Option<Value> {
        match value {
            Value::Object(object) => Some(Value::Object(
                object
                    .iter()
                    .filter_map(|(key, value)| {
                        let allowed = matches!(
                            key.as_str(),
                            "id" | "status"
                                | "intent"
                                | "debug_id"
                                | "name"
                                | "issue"
                                | "invoice_id"
                                | "currency_code"
                                | "value"
                                | "amount"
                                | "purchase_units"
                                | "payments"
                                | "authorizations"
                                | "captures"
                                | "details"
                                | "transaction_details"
                                | "transaction_info"
                                | "transaction_id"
                                | "transaction_status"
                                | "transaction_amount"
                                | "page"
                                | "total_pages"
                        );
                        if allowed {
                            walk(value, key, secrets).map(|value| (key.clone(), value))
                        } else {
                            None
                        }
                    })
                    .collect::<Map<_, _>>(),
            )),
            Value::Array(values) => Some(Value::Array(
                values
                    .iter()
                    .filter_map(|v| walk(v, field, secrets))
                    .collect(),
            )),
            Value::String(text) => {
                if secrets.iter().any(|s| !s.is_empty() && text.contains(s)) {
                    return Some(Value::String("[REDACTED]".into()));
                }
                let identifier =
                    matches!(field, "id" | "debug_id" | "invoice_id" | "transaction_id")
                        && !text.is_empty()
                        && text.len() <= 128
                        && text
                            .bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b));
                let code = matches!(
                    field,
                    "status" | "intent" | "name" | "issue" | "currency_code" | "transaction_status"
                ) && text.len() <= 64
                    && !text.is_empty()
                    && text.bytes().all(|b| b.is_ascii_uppercase() || b == b'_');
                let decimal = field == "value"
                    && text.len() <= 32
                    && !text.is_empty()
                    && text
                        .strip_prefix('-')
                        .unwrap_or(text)
                        .bytes()
                        .all(|b| b.is_ascii_digit() || b == b'.');
                Some(Value::String(if identifier || code || decimal {
                    text.clone()
                } else {
                    "[REDACTED]".into()
                }))
            }
            Value::Number(n)
                if matches!(field, "page" | "total_pages")
                    && n.as_u64().is_some_and(|n| n <= 20) =>
            {
                Some(Value::Number(n.clone()))
            }
            _ => None,
        }
    }
    walk(value, "", sensitive_values).unwrap_or(Value::Null)
}
/// The facts Order::verify binds a PayPal order to, and nothing else: per purchase unit the
/// custom_id (our terms hash), invoice_id, payee merchant id and amount. Every value must be an
/// identifier, an uppercase code or a decimal; names, emails, addresses and links never qualify.
/// None when the response carries no purchase units (owner decision, 2026-10-06).
pub fn binding_projection(value: &Value, sensitive_values: &[&str]) -> Option<Value> {
    let clean = |text: &str, max: usize| {
        !text.is_empty()
            && text.len() <= max
            && !sensitive_values
                .iter()
                .any(|s| !s.is_empty() && text.contains(s))
    };
    let identifier = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .filter(|t| {
                clean(t, 128)
                    && t.bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            })
            .map(|t| Value::String(t.into()))
    };
    let units = value.get("purchase_units")?.as_array()?;
    let units: Vec<Value> = units
        .iter()
        .map(|unit| {
            let mut kept = Map::new();
            if let Some(v) = identifier(unit.get("custom_id")) {
                kept.insert("custom_id".into(), v);
            }
            if let Some(v) = identifier(unit.get("invoice_id")) {
                kept.insert("invoice_id".into(), v);
            }
            if let Some(v) = identifier(unit.pointer("/payee/merchant_id")) {
                kept.insert("payee_merchant_id".into(), v);
            }
            let currency = unit
                .pointer("/amount/currency_code")
                .and_then(Value::as_str)
                .filter(|t| clean(t, 3) && t.bytes().all(|b| b.is_ascii_uppercase()));
            let amount = unit
                .pointer("/amount/value")
                .and_then(Value::as_str)
                .filter(|t| clean(t, 32) && t.bytes().all(|b| b.is_ascii_digit() || b == b'.'));
            if let (Some(currency), Some(amount)) = (currency, amount) {
                kept.insert(
                    "amount".into(),
                    serde_json::json!({"currency_code":currency,"value":amount}),
                );
            }
            Value::Object(kept)
        })
        .collect();
    Some(serde_json::json!({ "purchase_units": units }))
}
#[derive(Clone)]
pub struct PaypalCall {
    pub deal_id: table_core::DealId,
    pub method: HttpMethod,
    pub path: PaypalPath,
    pub request_id: String,
    pub status: u16,
    pub debug_id: Option<String>,
    pub response: Value,
    /// Binding facts projected from the raw body before redaction (None when there were none).
    pub binding: Option<Value>,
    pub at: table_core::Timestamp,
}
impl std::fmt::Debug for PaypalCall {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PaypalCall")
            .field("deal_id", &self.deal_id)
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}
#[derive(Debug, Clone, Copy)]
pub enum HttpMethod {
    Get,
    Post,
}
impl HttpMethod {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Get => "GET",
            Self::Post => "POST",
        }
    }
}
#[derive(Debug, Clone)]
pub struct PaypalPath(String);
impl PaypalPath {
    pub fn new(path: String) -> Result<Self, crate::LedgerError> {
        let families = [
            "/v2/checkout/orders",
            "/v2/payments/authorizations",
            "/v2/payments/captures",
            "/v2/invoicing/invoices",
            "/v1/billing/subscriptions",
            "/v1/reporting/transactions",
            "/v1/customer/disputes",
            "/v2/invoicing/search-invoices",
        ];
        if !families
            .iter()
            .any(|p| path == *p || path.starts_with(&format!("{p}/")))
            || !path
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/-_".contains(&b))
            || path.contains("update-pricing-schemes")
        {
            return Err(crate::LedgerError::Integrity("unapproved PayPal path"));
        }
        Ok(Self(path))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
