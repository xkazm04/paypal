//! The front door at one fixed loopback address: `/mcp` for the outside agent, `/` for the live
//! page. `/mcp` holds no authority of its own. It forwards each JSON-RPC body unchanged to the
//! wallet's loopback MCP server under the live run's grant, as any engine does, and journals what
//! came back. The wallet's server still checks its Host, its shared secret, the session, the
//! role's catalog and the call budget; the wallet still checks the run and the signed rule.
use crate::engine::{Live, Slot};
use crate::journal::{Entry, Journal, Outcome};
use crate::paypal::Recorder;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use table_client::{RunSnapshot, RunState};
use table_core::{Deal, DealId};
use table_runtime::{Action, ActorHandle, Caller, WalletEvent};

const PAGE: &str = include_str!("page/index.html");
const SCRIPT: &str = include_str!("page/app.js");
const STYLE: &str = include_str!("page/app.css");

pub struct Parts {
    pub actor: ActorHandle,
    pub events: tokio::sync::broadcast::Receiver<WalletEvent>,
    pub slot: Arc<Slot>,
    pub deal: Deal,
    pub port: u16,
    pub buyer_paypal: Arc<Recorder>,
    pub house_paypal: Arc<Recorder>,
}
impl std::fmt::Debug for Parts {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Parts")
    }
}

pub struct App {
    actor: ActorHandle,
    slot: Arc<Slot>,
    deal_id: DealId,
    /// The deal as the wallet last published it.
    deal: Mutex<Deal>,
    port: u16,
    http: reqwest::Client,
    pub journal: Journal,
    pub buyer_paypal: Arc<Recorder>,
    pub house_paypal: Arc<Recorder>,
    /// One run start at a time.
    starting: tokio::sync::Mutex<()>,
    runs: AtomicU64,
    booted: Instant,
    /// Print each call to the terminal (the binary); tests keep quiet.
    pub echo: AtomicBool,
}
impl std::fmt::Debug for App {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("App")
            .field("deal", &self.deal_id)
            .finish_non_exhaustive()
    }
}
fn main_window() -> Caller {
    Caller {
        label: "main".into(),
        token: None,
    }
}
fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}
/// Agent-supplied text bound for a terminal: no control characters (no escape sequences), short.
pub fn printable(text: &str, max: usize) -> String {
    let mut out: String = text
        .chars()
        .map(|c| if c.is_control() { '?' } else { c })
        .take(max)
        .collect();
    if text.chars().count() > max {
        out.push('…');
    }
    out
}
/// Whole cents as dollars, for the terminal and the page's fixed facts.
pub fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, (cents % 100).abs())
}

impl App {
    pub fn new(parts: Parts) -> Result<Arc<Self>, reqwest::Error> {
        let Parts {
            actor,
            mut events,
            slot,
            deal,
            port,
            buyer_paypal,
            house_paypal,
        } = parts;
        let http = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(45))
            .build()?;
        let app = Arc::new(Self {
            actor,
            slot,
            deal_id: deal.id,
            deal: Mutex::new(deal),
            port,
            http,
            journal: Journal::default(),
            buyer_paypal,
            house_paypal,
            starting: tokio::sync::Mutex::new(()),
            runs: AtomicU64::new(0),
            booted: Instant::now(),
            echo: AtomicBool::new(false),
        });
        let weak = Arc::downgrade(&app);
        tokio::spawn(async move {
            loop {
                match events.recv().await {
                    Ok(WalletEvent::Deal(changed)) => {
                        let Some(app) = weak.upgrade() else { break };
                        if changed.deal.id == app.deal_id
                            && let Ok(mut held) = app.deal.lock()
                        {
                            *held = changed.deal;
                        }
                    }
                    Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
                if weak.strong_count() == 0 {
                    break;
                }
            }
        });
        Ok(app)
    }
    pub fn deal(&self) -> Option<Deal> {
        self.deal.lock().ok().map(|d| d.clone())
    }
    pub fn router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/mcp", post(mcp))
            .route("/", get(page))
            .route("/app.js", get(script))
            .route("/app.css", get(style))
            .route("/api/state", get(state))
            .route("/api/journal", get(journal))
            .with_state(self)
    }
    /// The same door as the wallet's own: a loopback Host for this port, and no browser Origin.
    fn door(&self, headers: &HeaderMap) -> bool {
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
        let ours = [
            format!("127.0.0.1:{}", self.port),
            format!("localhost:{}", self.port),
        ];
        host.is_some_and(|h| ours.iter().any(|o| o == h))
    }
    /// Waits until the wallet lists `live`'s run as running (its grant enabled).
    async fn running(&self, live: Arc<Live>) -> Option<Arc<Live>> {
        for _ in 0..100 {
            let runs: Vec<RunSnapshot> =
                self.actor.execute(main_window(), Action::Runs).await.ok()?;
            match runs.iter().find(|r| r.run == live.run).map(|r| r.state) {
                Some(RunState::Running) => return Some(live),
                Some(RunState::Starting) => {}
                _ => return None,
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        None
    }
    /// The live run's grant, starting a run (as the console's "Start agent" does) when none is
    /// live or the live one is near its end.
    async fn ensure_run(&self) -> Result<Arc<Live>, String> {
        let _one = self.starting.lock().await;
        if let Some(live) = self.slot.live() {
            if live.fresh() {
                return self
                    .running(live)
                    .await
                    .ok_or_else(|| "The agent's run did not start".to_owned());
            }
            self.slot.end(live.run);
            let _ = self.slot.next(Some(live.run), Duration::from_secs(2)).await;
        }
        let mut last = String::from("The wallet started no run");
        for _ in 0..40 {
            if let Some(live) = self.slot.live().filter(|l| l.fresh())
                && let Some(live) = self.running(live).await
            {
                return Ok(live);
            }
            match self
                .actor
                .execute::<RunSnapshot>(main_window(), Action::Start(self.deal_id))
                .await
            {
                Ok(snapshot) => {
                    self.runs.fetch_add(1, Ordering::SeqCst);
                    if let Some(live) = self
                        .slot
                        .next(None, Duration::from_secs(3))
                        .await
                        .filter(|l| l.run == snapshot.run)
                        && let Some(live) = self.running(live).await
                    {
                        return Ok(live);
                    }
                }
                // The previous run may still be finishing; ask again shortly.
                Err(error) => last = error.message,
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err(last)
    }
    /// Carries one JSON-RPC body to the wallet's MCP server under the live grant.
    async fn forward(&self, body: &Bytes) -> Result<(u16, Bytes), String> {
        for attempt in 0..2 {
            let live = self.ensure_run().await?;
            let answer = self
                .http
                .post(&live.url)
                .header("content-type", "application/json")
                .header("x-wallet-secret", live.secret.as_str())
                .header("x-wallet-session", live.token.as_str())
                .body(body.to_vec())
                .send()
                .await
                .map_err(|_| "The wallet's MCP server did not answer".to_owned())?;
            let status = answer.status().as_u16();
            // The session lapsed between the check and the call: renew once.
            if status == 401 && attempt == 0 {
                self.slot.end(live.run);
                let _ = self.slot.next(Some(live.run), Duration::from_secs(2)).await;
                continue;
            }
            let bytes = answer
                .bytes()
                .await
                .map_err(|_| "The wallet's answer was cut off".to_owned())?;
            return Ok((status, bytes));
        }
        Err("The wallet's MCP session could not be renewed".into())
    }
    fn record(&self, request: Option<&Value>, status: u16, answer: Option<&Value>, at: u64) {
        let method = request
            .and_then(|r| r.get("method"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if method.starts_with("notifications/") {
            return;
        }
        let mut entry = crate::journal::read(request, status, answer);
        entry.at = at;
        entry.ms = unix_ms().saturating_sub(at);
        entry.paypal = self.buyer_paypal.asked();
        if entry.tool.as_deref() == Some("table_view")
            && entry.outcome == Outcome::Answered
            && let Some(table) = answer.and_then(|a| a.pointer("/result/structuredContent"))
        {
            self.journal.set_table(table.clone());
        }
        let entry = self.journal.push(entry);
        if self.echo.load(Ordering::Relaxed) {
            println!("{}", self.line(&entry));
        }
    }
    /// One terminal line for a journal entry.
    pub fn line(&self, entry: &Entry) -> String {
        let secs = self.booted.elapsed().as_secs();
        let what = match (&entry.tool, &entry.args) {
            (Some(tool), Some(args)) => {
                let shown = match tool.as_str() {
                    "send_offer" => args
                        .get("price")
                        .map(|p| format!("price {}", p.as_str().unwrap_or("?"))),
                    "accept_offer" => args.get("offer_seq").map(|s| format!("offer #{s}")),
                    "withdraw_offer" => args
                        .get("reason")
                        .map(|r| format!("reason {}", r.as_str().unwrap_or("?"))),
                    _ => None,
                }
                .unwrap_or_default();
                format!("{} {}", tool, shown)
            }
            (Some(tool), None) => tool.clone(),
            _ => entry.method.clone(),
        };
        let mark = match entry.outcome {
            Outcome::Answered => "  ok    ",
            Outcome::Refused => "  NO    ",
            Outcome::Protocol => "  ·     ",
            Outcome::Error => "  !     ",
        };
        let mut rule = entry.rule.clone();
        if let Some(detail) = &entry.detail {
            rule.push_str(" (");
            rule.push_str(detail);
            rule.push(')');
        }
        format!(
            "  {:02}:{:02}  {:<26}{}{}   PayPal asked: {}",
            secs / 60,
            secs % 60,
            printable(what.trim(), 26),
            mark,
            printable(&rule, 110),
            entry.paypal
        )
    }
    fn counts(&self) -> (usize, usize, usize) {
        let all = self.journal.all();
        let calls = all.iter().filter(|e| e.tool.is_some()).count();
        let refused = all.iter().filter(|e| e.outcome == Outcome::Refused).count();
        let answered = all
            .iter()
            .filter(|e| e.outcome == Outcome::Answered)
            .count();
        (calls, answered, refused)
    }
    /// The page's facts: the signed rule, the deal, the counters and the last table read.
    pub fn snapshot(&self) -> Value {
        let (calls, answered, refused) = self.counts();
        let deal = self.deal();
        json!({
            "port": self.port,
            "item": crate::ITEM,
            "rule": {
                "floor": dollars(crate::RULE_FLOOR),
                "ceiling": dollars(crate::RULE_CEILING),
                "in_person": dollars(crate::RULE_IN_PERSON),
                "rounds": crate::RULE_ROUNDS,
            },
            "house": {"ask": dollars(crate::HOUSE_ASK), "rounds": crate::HOUSE_ROUNDS},
            "deal": deal.as_ref().map(|d| json!({
                "id": d.id,
                "state": d.state,
                "price": dollars(d.terms.unit_price.minor()),
                "price_cents": d.terms.unit_price.minor(),
                "decided_by": d.decided_by,
            })),
            "paypal": {"buyer": self.buyer_paypal.asked(), "house": self.house_paypal.asked()},
            "calls": calls,
            "answered": answered,
            "refused": refused,
            "runs": self.runs.load(Ordering::SeqCst),
            "table": self.journal.table(),
        })
    }
}

fn refused_door() -> Response {
    (StatusCode::FORBIDDEN, "loopback only").into_response()
}
async fn mcp(State(app): State<Arc<App>>, headers: HeaderMap, body: Bytes) -> Response {
    if !app.door(&headers) || headers.contains_key(header::ORIGIN) {
        return refused_door();
    }
    let at = unix_ms();
    let request: Option<Value> = serde_json::from_slice(&body).ok();
    match app.forward(&body).await {
        Ok((status, bytes)) => {
            let answer: Option<Value> = serde_json::from_slice(&bytes).ok();
            app.record(request.as_ref(), status, answer.as_ref(), at);
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            (status, [(header::CONTENT_TYPE, "application/json")], bytes).into_response()
        }
        Err(message) => {
            let id = request
                .as_ref()
                .and_then(|r| r.get("id"))
                .cloned()
                .unwrap_or(Value::Null);
            let answer = json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":message}});
            app.record(request.as_ref(), 200, Some(&answer), at);
            (StatusCode::OK, Json(answer)).into_response()
        }
    }
}
async fn page(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.door(&headers) {
        return refused_door();
    }
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (
                header::CONTENT_SECURITY_POLICY,
                "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
            ),
        ],
        PAGE,
    )
        .into_response()
}
async fn script() -> Response {
    (
        [(header::CONTENT_TYPE, "text/javascript; charset=utf-8")],
        SCRIPT,
    )
        .into_response()
}
async fn style() -> Response {
    ([(header::CONTENT_TYPE, "text/css; charset=utf-8")], STYLE).into_response()
}
async fn state(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.door(&headers) {
        return refused_door();
    }
    Json(app.snapshot()).into_response()
}
#[derive(Debug, Deserialize)]
struct After {
    #[serde(default)]
    after: u64,
}
async fn journal(
    State(app): State<Arc<App>>,
    headers: HeaderMap,
    Query(after): Query<After>,
) -> Response {
    if !app.door(&headers) {
        return refused_door();
    }
    Json(app.journal.after(after.after)).into_response()
}
