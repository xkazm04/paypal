//! Loopback MCP: role-bound sessions, Host/shared-secret checks and closed intent handlers.
use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::post,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use table_app::{AgentRequest, AgentRole, AgentScope, AgentService};
use table_core::{Clock, H256, RunId};
#[async_trait]
pub trait AsyncAgentService: Send + Sync {
    async fn invoke(
        &self,
        scope: &AgentScope,
        request: AgentRequest,
        now: i64,
        run: Option<RunId>,
    ) -> Result<Value, table_app::Error>;
    async fn record_refusal(
        &self,
        scope: &AgentScope,
        tool: &str,
        reason: &str,
        now: i64,
    ) -> Result<(), table_app::Error>;
}
struct SyncService(Mutex<Box<dyn AgentService>>);
#[async_trait]
impl AsyncAgentService for SyncService {
    async fn invoke(
        &self,
        scope: &AgentScope,
        request: AgentRequest,
        now: i64,
        _: Option<RunId>,
    ) -> Result<Value, table_app::Error> {
        self.0
            .lock()
            .map_err(|_| table_app::Error::Unavailable)?
            .invoke(scope, request, now)
    }
    async fn record_refusal(
        &self,
        scope: &AgentScope,
        tool: &str,
        reason: &str,
        now: i64,
    ) -> Result<(), table_app::Error> {
        self.0
            .lock()
            .map_err(|_| table_app::Error::Unavailable)?
            .record_refusal(scope, tool, reason, now)
    }
}
#[derive(Debug, Clone)]
struct Session {
    scope: AgentScope,
    run: Option<RunId>,
    enabled: bool,
    expires: i64,
}
pub struct Server {
    service: Arc<dyn AsyncAgentService>,
    sessions: Mutex<BTreeMap<String, Session>>,
    secret: String,
    host: String,
    clock: Arc<dyn Clock>,
}
impl std::fmt::Debug for Server {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpServer { [REDACTED] }")
    }
}
fn random() -> Result<String, table_app::Error> {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).map_err(|_| table_app::Error::Unavailable)?;
    Ok(H256(bytes).hex())
}
impl Server {
    pub fn new(
        service: Box<dyn AgentService>,
        port: u16,
        clock: Arc<dyn Clock>,
    ) -> Result<Arc<Self>, table_app::Error> {
        Self::with_async(Arc::new(SyncService(Mutex::new(service))), port, clock)
    }
    pub fn with_async(
        service: Arc<dyn AsyncAgentService>,
        port: u16,
        clock: Arc<dyn Clock>,
    ) -> Result<Arc<Self>, table_app::Error> {
        if port == 0 {
            return Err(table_app::Error::Invalid);
        }
        Ok(Arc::new(Self {
            service,
            sessions: Mutex::new(BTreeMap::new()),
            secret: random()?,
            host: format!("127.0.0.1:{port}"),
            clock,
        }))
    }
    pub fn grant(&self, scope: AgentScope) -> Result<Grant, table_app::Error> {
        self.issue(scope, true, None)
    }
    /// Inventory can be discovered, but no intent executes before the host enables this grant.
    pub fn grant_pending(&self, scope: AgentScope) -> Result<Grant, table_app::Error> {
        self.issue(scope, false, None)
    }
    /// The run identity comes from Rust, never tool arguments or HTTP input.
    pub fn grant_for_run(&self, scope: AgentScope, run: RunId) -> Result<Grant, table_app::Error> {
        self.issue(scope, false, Some(run))
    }
    fn issue(
        &self,
        scope: AgentScope,
        enabled: bool,
        run: Option<RunId>,
    ) -> Result<Grant, table_app::Error> {
        let token = random()?;
        let now = self.clock.now();
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| table_app::Error::Unavailable)?;
        sessions.retain(|_, s| s.expires > now);
        if sessions.len() >= 64 {
            return Err(table_app::Error::Unavailable);
        }
        sessions.insert(
            token.clone(),
            Session {
                scope,
                run,
                enabled,
                expires: now.checked_add(120).ok_or(table_app::Error::Invalid)?,
            },
        );
        Ok(Grant {
            token,
            secret: self.secret.clone(),
        })
    }
    pub fn enable(&self, grant: &Grant) -> Result<(), table_app::Error> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| table_app::Error::Unavailable)?;
        let session = sessions
            .get_mut(&grant.token)
            .ok_or(table_app::Error::Permission)?;
        if session.expires <= self.clock.now() || grant.secret != self.secret {
            return Err(table_app::Error::Permission);
        }
        session.enabled = true;
        Ok(())
    }
    pub fn revoke(&self, grant: &Grant) {
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(&grant.token);
        }
    }
    pub fn router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/mcp", post(handle))
            .layer(DefaultBodyLimit::max(65536))
            .with_state(self)
    }
    /// The listener is fixed to loopback. Port is determined before constructing the Host allowlist.
    pub async fn bind() -> std::io::Result<tokio::net::TcpListener> {
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).await
    }
}
pub struct Grant {
    pub token: String,
    pub secret: String,
}
impl std::fmt::Debug for Grant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpGrant { [REDACTED] }")
    }
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Rpc {
    jsonrpc: String,
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Value,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    name: String,
    arguments: Value,
}
/// The tools a role is served. The engine's stream allowlist is checked against this list.
pub const fn catalog(role: AgentRole) -> &'static [&'static str] {
    match role {
        AgentRole::Negotiator => &[
            "table_view",
            "market_reference",
            "send_offer",
            "accept_offer",
            "withdraw_offer",
        ],
        AgentRole::Shopper => &["market_reference", "propose_purchase"],
        AgentRole::Assistant => &["book_query"],
    }
}
/// The closed Delivery enum as the agent sees it, so a bad shape is not found by trial.
fn delivery_schema() -> Value {
    let variant = |tag: &str, extra: Value| {
        let mut properties = json!({"type":{"const":tag}});
        let mut required = vec![json!("type")];
        if let (Some(properties), Some(extra)) = (properties.as_object_mut(), extra.as_object()) {
            for (key, schema) in extra {
                properties.insert(key.clone(), schema.clone());
                required.push(json!(key));
            }
        }
        json!({"type":"object","additionalProperties":false,"required":required,"properties":properties})
    };
    json!({"oneOf":[
        variant("digital_now", json!({})),
        variant("ship_then_capture", json!({"days":{"type":"integer","minimum":1,"maximum":3}})),
        variant("pickup_local", json!({})),
        variant("service_on_date", json!({"unix_day":{"type":"integer"}})),
    ]})
}
fn tools(role: AgentRole) -> Vec<Value> {
    catalog(role).iter().map(|name| {
        let schema=match *name {
            "market_reference"=>json!({"type":"object","additionalProperties":false,"required":["item_ref"],"properties":{"item_ref":{"type":"string","maxLength":128}}}),
            "book_query"=>json!({"type":"object","additionalProperties":false,"required":["view","metrics"],"properties":{"view":{"enum":["deals","paypal_calls","receipts","subscriptions","reconciliation"]},"metrics":{"type":"array","minItems":1,"maxItems":4,"items":{"enum":["count","sum_amount","avg_vs_market_pct","recovered_sum"]}},"filters":{"type":"array","maxItems":6,"items":{"type":"object","additionalProperties":false,"required":["field","op","value"],"properties":{"field":{"enum":["kind","state","counterparty","amount","created_at","vs_market_pct","decided_by"]},"op":{"enum":["eq","ne","gt","lt","between","in"]},"value":{}}}},"group_by":{"type":"array","maxItems":2,"items":{"enum":["kind","counterparty","state","day","decided_by"]}},"range":{"type":"object","additionalProperties":false,"required":["from","to"],"properties":{"from":{"type":"string"},"to":{"type":"string"}}},"limit":{"type":"integer","minimum":1,"maximum":500}}}),
            "accept_offer"=>json!({"type":"object","additionalProperties":false,"required":["deal_id","offer_seq"],"properties":{"deal_id":{"type":"string"},"offer_seq":{"type":"integer","minimum":1}}}),
            "table_view"=>json!({"type":"object","additionalProperties":false,"properties":{"deal_id":{"type":"string"}}}),
            "send_offer"=>json!({"type":"object","additionalProperties":false,"required":["deal_id","price","delivery"],"properties":{"deal_id":{"type":"string"},"price":{"type":"string","pattern":"^[0-9]+\\.[0-9]{2}$"},"delivery":delivery_schema()}}),
            "withdraw_offer"=>json!({"type":"object","additionalProperties":false,"required":["deal_id","reason"],"properties":{"deal_id":{"type":"string"},"reason":{"enum":["PRICE","TIMING","OTHER"]}}}),
            _=>json!({"type":"object","additionalProperties":false,"required":["payee_ref","items","amount","category"],"properties":{"payee_ref":{"type":"string"},"items":{"type":"array","minItems":1,"maxItems":1,"items":{"type":"object","additionalProperties":false,"required":["ref","qty"],"properties":{"ref":{"type":"string"},"qty":{"type":"integer","minimum":1}}}},"amount":{"type":"string"},"category":{"enum":["office","parts","compute","service","other"]}}}),
        };json!({"name":name,"description":"Submit a bounded wallet intent","inputSchema":schema})
    }).collect()
}
async fn handle(
    State(s): State<Arc<Server>>,
    headers: HeaderMap,
    Json(rpc): Json<Rpc>,
) -> Result<(StatusCode, Json<Value>), StatusCode> {
    if headers.get("host").and_then(|v| v.to_str().ok()) != Some(&s.host)
        || headers.contains_key("origin")
    {
        return Err(StatusCode::FORBIDDEN);
    }
    if headers.get("x-wallet-secret").and_then(|v| v.to_str().ok()) != Some(&s.secret) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let token = headers
        .get("x-wallet-session")
        .and_then(|v| v.to_str().ok())
        .or_else(|| {
            headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
        })
        .ok_or(StatusCode::UNAUTHORIZED)?;
    let session = s
        .sessions
        .lock()
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .get(token)
        .cloned()
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if session.expires <= s.clock.now() {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let scope = session.scope;
    if rpc.jsonrpc != "2.0"
        || rpc
            .id
            .as_ref()
            .is_some_and(|v| !v.is_string() && !v.is_i64())
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    if rpc.method == "notifications/initialized" && rpc.id.is_none() {
        return Ok((StatusCode::ACCEPTED, Json(Value::Null)));
    }
    let id = rpc.id.ok_or(StatusCode::BAD_REQUEST)?;
    let result = match rpc.method.as_str() {
        "initialize" => {
            json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"table-wallet","version":"0.1.0"}})
        }
        "tools/list" => json!({"tools":tools(scope.role)}),
        "tools/call" => {
            let result = async {
                let now = s.clock.now();
                let named = rpc
                    .params
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_owned();
                // Every refusal here is audited before the agent hears about it.
                let refused = if !session.enabled {
                    Some(("session not enabled", table_app::Error::Permission))
                } else {
                    None
                };
                let call = match refused {
                    Some(refusal) => Err(refusal),
                    None => serde_json::from_value::<Call>(rpc.params.clone())
                        .map_err(|_| ("malformed tool call", table_app::Error::Invalid)),
                };
                let request = call.and_then(|call| {
                    if !catalog(scope.role).contains(&call.name.as_str()) {
                        return Err(("tool not in role catalog", table_app::Error::Permission));
                    }
                    AgentRequest::decode(&call.name, call.arguments)
                        .map_err(|error| ("malformed tool arguments", error))
                });
                match request {
                    Ok(request) => s.service.invoke(&scope, request, now, session.run).await,
                    Err((reason, error)) => {
                        s.service
                            .record_refusal(&scope, &named, reason, now)
                            .await?;
                        Err(error)
                    }
                }
            }
            .await;
            match result {
                Ok(value) => {
                    json!({"isError":false,"content":[{"type":"text","text":value.to_string()}]})
                }
                Err(error) => {
                    json!({"isError":true,"content":[{"type":"text","text":error.to_string()}]})
                }
            }
        }
        _ => {
            return Ok((
                StatusCode::OK,
                Json(
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Method not found"}}),
                ),
            ));
        }
    };
    Ok((
        StatusCode::OK,
        Json(json!({"jsonrpc":"2.0","id":id,"result":result})),
    ))
}
