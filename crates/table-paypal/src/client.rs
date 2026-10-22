use crate::{http::*, *};
use async_trait::async_trait;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::{fmt, sync::Arc};
use table_core::{Clock, Money};
use tokio::sync::Mutex;
/// Attempts one PayPal call makes at most; between them the backoff waits.
pub const ATTEMPTS: u8 = 3;
/// The one PayPal REST origin every request goes to: the token, the API calls and reporting.
/// A live mode changes this line and nothing else.
pub(crate) const ORIGIN: &str = "https://api-m.sandbox.paypal.com";
#[async_trait]
pub trait Credentials: Send + Sync {
    async fn load(&self) -> Result<(Secret, Secret), Error>;
}
#[async_trait]
pub trait PayPalApi: Send + Sync {
    /// Called only by trusted credential provisioning, never an agent tool.
    async fn credentials_changed(&self) {}
    async fn create_order(
        &self,
        order: &CreateOrder,
        request_id: &RequestId,
    ) -> Result<ApiResponse<Order>, Error>;
    async fn get_order(&self, id: &ResourceId) -> Result<ApiResponse<Order>, Error>;
    async fn authorize(
        &self,
        id: &ResourceId,
        request_id: &RequestId,
    ) -> Result<ApiResponse<Order>, Error>;
    async fn capture(
        &self,
        id: &ResourceId,
        amount: Money,
        request_id: &RequestId,
    ) -> Result<ApiResponse<Payment>, Error>;
    async fn void(&self, id: &ResourceId, request_id: &RequestId)
    -> Result<ApiResponse<()>, Error>;
    async fn get_authorization(&self, id: &ResourceId) -> Result<ApiResponse<Payment>, Error>;
}
struct Token {
    value: Secret,
    expires: i64,
}
pub struct Client {
    transport: Arc<dyn Transport>,
    credentials: Arc<dyn Credentials>,
    clock: Arc<dyn Clock>,
    backoff: Arc<dyn Backoff>,
    token: Mutex<Option<Token>>,
    redactions: Mutex<Vec<Secret>>,
}
impl fmt::Debug for Client {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PayPalClient { sandbox }")
    }
}
impl Client {
    /// UNVERIFIED: PayPal acceptance of loopback/custom-scheme destinations; spike 5.
    /// Wire field location is sourced from checkout_orders_v2 experience_context.
    pub async fn create_order_returning(
        &self,
        order: &CreateOrder,
        destination: ReturnDestination,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, Error> {
        let (return_url, cancel_url) = destination.urls()?;
        let mut body = order.body()?;
        body["payment_source"] = json!({"paypal":{"experience_context":{"return_url":return_url,"cancel_url":cancel_url}}});
        self.decoded("POST", "/v2/checkout/orders".into(), Some(body), Some(id))
            .await
    }
    pub(crate) fn clock_now(&self) -> i64 {
        self.clock.now()
    }
    pub fn sandbox(
        transport: Arc<dyn Transport>,
        credentials: Arc<dyn Credentials>,
        clock: Arc<dyn Clock>,
        backoff: Arc<dyn Backoff>,
    ) -> Self {
        Self {
            transport,
            credentials,
            clock,
            backoff,
            token: Mutex::new(None),
            redactions: Mutex::new(Vec::new()),
        }
    }
    async fn token(&self) -> Result<Secret, Error> {
        let mut cache = self.token.lock().await;
        if let Some(t) = cache.as_ref()
            && self.clock.now() < t.expires
        {
            return Ok(Secret::new(t.value.expose().to_owned()));
        }
        let (id, secret) = self.credentials.load().await?;
        let pair = zeroize::Zeroizing::new(format!("{}:{}", id.expose(), secret.expose()));
        let basic = zeroize::Zeroizing::new(STANDARD.encode(pair.as_bytes()));
        let response = self
            .transport
            .send(Request {
                method: "POST",
                url: format!("{ORIGIN}/v1/oauth2/token"),
                headers: vec![(
                    "Authorization".into(),
                    Secret::new(format!("Basic {}", basic.as_str())),
                )],
                body: None,
                form: Some("grant_type=client_credentials"),
            })
            .await
            .map_err(|_| Error::Credentials)?;
        if response.status != 200 {
            return Err(Error::Credentials);
        }
        let value = Secret::new(
            response
                .body
                .get("access_token")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
                .ok_or(Error::Credentials)?
                .to_owned(),
        );
        let seconds = response
            .body
            .get("expires_in")
            .and_then(Value::as_i64)
            .filter(|v| *v > 30 && *v <= 86400)
            .ok_or(Error::Credentials)?;
        *cache = Some(Token {
            value: Secret::new(value.expose().to_owned()),
            expires: self.clock.now().saturating_add(seconds - 30),
        });
        *self.redactions.lock().await = vec![
            id,
            secret,
            Secret::new(basic.as_str().to_owned()),
            Secret::new(value.expose().to_owned()),
        ];
        Ok(value)
    }
    pub(crate) async fn execute(
        &self,
        method: &'static str,
        path: String,
        body: Option<Value>,
        id: Option<&RequestId>,
    ) -> Result<ApiResponse<Value>, Error> {
        self.execute_policy(method, path, body, id, true).await
    }
    pub(crate) async fn execute_policy(
        &self,
        method: &'static str,
        path: String,
        body: Option<Value>,
        id: Option<&RequestId>,
        retry: bool,
    ) -> Result<ApiResponse<Value>, Error> {
        let mut observations = Vec::new();
        let mut refreshed = false;
        let request_id = id.map_or_else(String::new, |id| id.as_str().to_owned());
        let observed = |status, body, binding| Observation {
            method,
            path: path.clone(),
            request_id: request_id.clone(),
            status,
            body,
            binding,
        };
        for attempt in 0..ATTEMPTS {
            // A token that cannot be had after a request already reached the wire (a lost
            // answer, a 5xx, a 401) must not drop that request's evidence: the earlier
            // attempt's outcome is unknown, so the error says so and carries what was observed.
            let token = match self.token().await {
                Ok(token) => token,
                Err(_) if !observations.is_empty() => {
                    return Err(Error::Unknown { observations });
                }
                Err(error) => return Err(error),
            };
            let mut headers = vec![
                (
                    "Authorization".into(),
                    Secret::new(format!("Bearer {}", token.expose())),
                ),
                ("Prefer".into(), Secret::new("return=representation".into())),
            ];
            if let Some(id) = id {
                headers.push(("PayPal-Request-Id".into(), Secret::new(id.as_str().into())));
            }
            let response = self
                .transport
                .send(Request {
                    method,
                    url: format!("{ORIGIN}{path}"),
                    headers,
                    body: body.clone(),
                    form: None,
                })
                .await;
            let response = match response {
                Ok(r) => r,
                Err(_) => {
                    // Status 0: the request may have reached PayPal; its answer did not arrive.
                    observations.push(observed(0, Value::Null, None));
                    if retry && attempt + 1 < ATTEMPTS {
                        self.backoff.wait(attempt).await;
                        continue;
                    }
                    return Err(Error::Unknown { observations });
                }
            };
            let secrets = self.redactions.lock().await;
            let exposed = secrets.iter().map(Secret::expose).collect::<Vec<_>>();
            let binding = table_ledger::binding_projection(&response.body, &exposed);
            let sanitized = table_ledger::redact_paypal(&response.body, &exposed);
            drop(secrets);
            let debug_id = sanitized
                .get("debug_id")
                .and_then(Value::as_str)
                .filter(|s| {
                    s.len() <= 128
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
                })
                .map(str::to_owned);
            observations.push(observed(response.status, sanitized, binding));
            if (200..300).contains(&response.status) {
                return Ok(ApiResponse {
                    value: response.body,
                    observations,
                });
            }
            if response.status == 401 && !refreshed && attempt + 1 < ATTEMPTS {
                *self.token.lock().await = None;
                refreshed = true;
                continue;
            }
            if retry && (response.status == 429 || response.status >= 500) && attempt + 1 < ATTEMPTS
            {
                self.backoff.wait(attempt).await;
                continue;
            }
            return Err(Error::Api {
                status: response.status,
                debug_id,
                observations,
            });
        }
        Err(Error::Unknown { observations })
    }
    pub(crate) async fn decoded<T: DeserializeOwned>(
        &self,
        method: &'static str,
        path: String,
        body: Option<Value>,
        id: Option<&RequestId>,
    ) -> Result<ApiResponse<T>, Error> {
        let r = self.execute(method, path, body, id).await?;
        let value = serde_json::from_value(r.value).map_err(|_| Error::Unknown {
            observations: r.observations.clone(),
        })?;
        Ok(ApiResponse {
            value,
            observations: r.observations,
        })
    }
}
#[async_trait]
impl PayPalApi for Client {
    async fn credentials_changed(&self) {
        *self.token.lock().await = None;
    }
    async fn create_order(
        &self,
        order: &CreateOrder,
        id: &RequestId,
    ) -> Result<ApiResponse<Order>, Error> {
        self.decoded(
            "POST",
            "/v2/checkout/orders".into(),
            Some(order.body()?),
            Some(id),
        )
        .await
    }
    async fn get_order(&self, id: &ResourceId) -> Result<ApiResponse<Order>, Error> {
        self.decoded(
            "GET",
            format!("/v2/checkout/orders/{}", id.as_str()),
            None,
            None,
        )
        .await
    }
    async fn authorize(&self, id: &ResourceId, r: &RequestId) -> Result<ApiResponse<Order>, Error> {
        self.decoded(
            "POST",
            format!("/v2/checkout/orders/{}/authorize", id.as_str()),
            Some(json!({})),
            Some(r),
        )
        .await
    }
    async fn capture(
        &self,
        id: &ResourceId,
        amount: Money,
        r: &RequestId,
    ) -> Result<ApiResponse<Payment>, Error> {
        paypal_currency(amount)?;
        // UNVERIFIED: that Payments v2 capture and void keep `PayPal-Request-Id` like Orders v2
        // (the research sources the 6 h store for Orders only). Both are retried after a lost
        // answer under the same id (`execute`); `final_capture: true` is what bounds a capture
        // replayed without that store to one. Sandbox spike 3/4 (STATUS, Payments v2 resolver).
        self.decoded(
            "POST",
            format!("/v2/payments/authorizations/{}/capture", id.as_str()),
            Some(json!({"amount":amount_wire(amount),"final_capture":true})),
            Some(r),
        )
        .await
    }
    async fn void(&self, id: &ResourceId, r: &RequestId) -> Result<ApiResponse<()>, Error> {
        // UNVERIFIED: the `PayPal-Request-Id` store for this retried void (see `capture`).
        let response = self
            .execute(
                "POST",
                format!("/v2/payments/authorizations/{}/void", id.as_str()),
                Some(json!({})),
                Some(r),
            )
            .await?;
        Ok(ApiResponse {
            value: (),
            observations: response.observations,
        })
    }
    async fn get_authorization(&self, id: &ResourceId) -> Result<ApiResponse<Payment>, Error> {
        self.decoded(
            "GET",
            format!("/v2/payments/authorizations/{}", id.as_str()),
            None,
            None,
        )
        .await
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    struct Creds;
    #[async_trait]
    impl Credentials for Creds {
        async fn load(&self) -> Result<(Secret, Secret), Error> {
            Ok((Secret::new("id".into()), Secret::new("secret".into())))
        }
    }
    struct Oauth;
    #[async_trait]
    impl Transport for Oauth {
        async fn send(&self, _: Request) -> Result<Response, TransportError> {
            Ok(Response {
                status: 200,
                body: json!({"access_token":"tok","expires_in":3600}),
            })
        }
    }
    struct Fixed;
    impl Clock for Fixed {
        fn now(&self) -> i64 {
            0
        }
    }
    struct NoWait;
    #[async_trait]
    impl Backoff for NoWait {
        async fn wait(&self, _: u8) {}
    }

    #[tokio::test]
    async fn token_is_a_redacted_secret() {
        let client = Client::sandbox(
            Arc::new(Oauth),
            Arc::new(Creds),
            Arc::new(Fixed),
            Arc::new(NoWait),
        );
        let token = client.token().await.unwrap();
        assert_eq!(token.expose(), "tok");
        assert_eq!(format!("{token:?}"), "[REDACTED]");
    }
}
