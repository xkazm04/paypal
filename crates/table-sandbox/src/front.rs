//! The front door at one fixed loopback address: `/mcp` for the outside agent, `/` for the live
//! page. `/mcp` holds no authority of its own. It forwards each JSON-RPC body unchanged to the
//! wallet's loopback MCP server under the live run's grant, as any engine does, and journals what
//! came back. The wallet's server still checks its Host, its shared secret, the session, the
//! role's catalog and the call budget; the wallet still checks the run and the signed rule.
//!
//! The one thing the front adds to an answer: `initialize` carries the negotiator's compiled-in
//! playbook as the server's `instructions`, the same text a native engine starts from.
use crate::engine::Live;
use crate::journal::{Entry, Journal, Outcome};
use crate::{BootError, Recorders, World};
use axum::{
    Json, Router,
    body::Bytes,
    extract::{DefaultBodyLimit, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::{
    Arc, RwLock,
    atomic::{AtomicBool, AtomicU64, Ordering},
};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use table_client::{AuditPage, AuditPageArgs, RunSnapshot, RunState, SafetyRecord};
use table_runtime::{Action, Caller};

const PAGE: &str = include_str!("page/index.html");
const SCRIPT: &str = include_str!("page/app.js");
const STYLE: &str = include_str!("page/app.css");
/// How long a read of the wallet's own safety record and audit tail is reused by the page.
const FACTS_TTL: Duration = Duration::from_millis(1500);

/// The wallet's own record, as last read: its whole-ledger safety check and its newest audit rows.
#[derive(Debug, Clone, Default)]
struct Facts {
    /// The table these were read from; never reused for another.
    table: u32,
    read: Option<Instant>,
    safety: Option<SafetyRecord>,
    audit: Vec<table_client::AuditRow>,
    /// The offline verifier's report on this table's own proof file.
    proof: Option<Value>,
}

pub struct App {
    world: RwLock<Arc<World>>,
    pub recorders: Recorders,
    port: u16,
    http: reqwest::Client,
    pub journal: Journal,
    /// One run start at a time.
    starting: tokio::sync::Mutex<()>,
    /// The run the front last carried calls under: one turn, as the desktop arms its negotiator
    /// once per peer message. When the table moves, the next call goes under a new run (and a new
    /// call budget); a turn whose budget is spent is not renewed until it does.
    turn: std::sync::Mutex<Option<Turn>>,
    /// Read-only calls not yet printed (folded into one terminal line).
    folded: std::sync::Mutex<Option<(String, u32)>>,
    /// One fresh table at a time.
    opening: tokio::sync::Mutex<()>,
    facts: tokio::sync::Mutex<Facts>,
    runs: AtomicU64,
    booted: Instant,
    /// Print each call to the terminal (the binary); tests keep quiet.
    pub echo: AtomicBool,
    /// Colour the terminal lines (a terminal that renders ANSI, and no `NO_COLOR`).
    pub color: AtomicBool,
    /// A scripted rehearsal (no AI) is driving `/mcp`; the page says so.
    pub rehearsal: AtomicBool,
}
impl std::fmt::Debug for App {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("App")
            .field("port", &self.port)
            .finish_non_exhaustive()
    }
}
/// One turn: its run, the deal's transcript head when the run began, and whether the wallet's
/// call budget for it is spent.
#[derive(Debug, Clone, Copy)]
struct Turn {
    run: table_core::RunId,
    head: table_core::H256,
    spent: bool,
}
/// Why a call was not carried.
#[derive(Debug)]
enum Carry {
    /// The table changed while the call waited: carry it again on the live one.
    Stale,
    /// Told to the agent as a JSON-RPC error.
    Fail(String),
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
/// Characters that change how the text around them reads without showing themselves: bidi
/// overrides and isolates, zero-width marks, the BOM.
fn invisible(c: char) -> bool {
    matches!(
        c,
        '\u{061C}'
            | '\u{200B}'..='\u{200F}'
            | '\u{202A}'..='\u{202E}'
            | '\u{2060}'..='\u{206F}'
            | '\u{FEFF}'
            | '\u{FFF9}'..='\u{FFFB}'
    )
}
/// Agent-supplied text bound for a terminal: no control or invisible characters (no escape
/// sequences, no reordering), short.
pub fn printable(text: &str, max: usize) -> String {
    let mut out: String = text
        .chars()
        .map(|c| {
            if c.is_control() || invisible(c) {
                '?'
            } else {
                c
            }
        })
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
    pub fn new(world: World, recorders: Recorders, port: u16) -> Result<Arc<Self>, reqwest::Error> {
        let http = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(45))
            .build()?;
        Ok(Arc::new(Self {
            world: RwLock::new(Arc::new(world)),
            recorders,
            port,
            http,
            journal: Journal::default(),
            starting: tokio::sync::Mutex::new(()),
            turn: std::sync::Mutex::new(None),
            folded: std::sync::Mutex::new(None),
            opening: tokio::sync::Mutex::new(()),
            facts: tokio::sync::Mutex::new(Facts::default()),
            runs: AtomicU64::new(0),
            booted: Instant::now(),
            echo: AtomicBool::new(false),
            color: AtomicBool::new(false),
            rehearsal: AtomicBool::new(false),
        }))
    }
    /// The live world (the table now open).
    pub fn world(&self) -> Option<Arc<World>> {
        self.world.read().ok().map(|w| w.clone())
    }
    pub fn router(self: Arc<Self>) -> Router {
        Router::new()
            .route("/mcp", post(mcp))
            .route("/", get(page))
            .route("/app.js", get(script))
            .route("/app.css", get(style))
            .route("/favicon.ico", get(|| async { StatusCode::NO_CONTENT }))
            .route("/api/state", get(state))
            .route("/api/journal", get(journal))
            .route("/api/fresh", post(fresh))
            .route("/api/proof", get(proof))
            // The wallet's own MCP server takes at most this much; nothing larger is kept.
            .layer(DefaultBodyLimit::max(64 * 1024))
            .with_state(self)
    }
    fn hosts(&self) -> [String; 3] {
        [
            format!("127.0.0.1:{}", self.port),
            format!("localhost:{}", self.port),
            format!("[::1]:{}", self.port),
        ]
    }
    /// The same door as the wallet's own: a loopback Host for this port.
    fn door(&self, headers: &HeaderMap) -> bool {
        let host = headers.get(header::HOST).and_then(|v| v.to_str().ok());
        host.is_some_and(|h| self.hosts().iter().any(|o| o == h))
    }
    /// The live page's own origin (a same-origin `fetch` POST carries it).
    fn own_origin(&self, headers: &HeaderMap) -> bool {
        headers
            .get(header::ORIGIN)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|o| self.hosts().iter().any(|h| o == format!("http://{h}")))
    }
    /// Waits until the wallet lists `live`'s run as running (its grant enabled).
    async fn running(&self, world: &World, live: Arc<Live>) -> Option<Arc<Live>> {
        for _ in 0..100 {
            let runs: Vec<RunSnapshot> = world
                .actor
                .execute(main_window(), Action::Runs)
                .await
                .ok()?;
            match runs.iter().find(|r| r.run == live.run).map(|r| r.state) {
                Some(RunState::Running) => return Some(live),
                Some(RunState::Starting) => {}
                _ => return None,
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        None
    }
    /// Records the turn `live` begins, with the deal's head now that its run is running.
    fn begin_turn(&self, world: &World, live: &Live) {
        if let (Ok(mut turn), Some(deal)) = (self.turn.lock(), world.deal()) {
            *turn = Some(Turn {
                run: live.run,
                head: deal.transcript_head,
                spent: false,
            });
        }
    }
    /// The live run's grant, starting a run (as the console's "Start agent" does) when none is
    /// live, the table has moved since it began, or it is near its end.
    async fn ensure_run(&self, world: &Arc<World>) -> Result<Arc<Live>, Carry> {
        let _one = self.starting.lock().await;
        // A fresh table may have replaced this one while the call waited for the lock.
        if !self.world().is_some_and(|live| Arc::ptr_eq(&live, world)) {
            return Err(Carry::Stale);
        }
        let head = world.deal().map(|d| d.transcript_head);
        if let Some(live) = world.slot.live() {
            let (moved, spent) = match self.turn.lock() {
                Ok(mut turn) => match turn.as_ref() {
                    Some(t) if t.run == live.run => (Some(t.head) != head, t.spent),
                    _ => {
                        *turn = head.map(|head| Turn {
                            run: live.run,
                            head,
                            spent: false,
                        });
                        (false, false)
                    }
                },
                Err(_) => (false, false),
            };
            // A spent turn keeps its run (the wallet answers the budget refusal) until it ends.
            if !moved && (live.fresh() || spent) {
                return self
                    .running(world, live)
                    .await
                    .ok_or_else(|| Carry::Fail("The agent's run did not start".into()));
            }
            world.slot.end(live.run);
            let _ = world.slot.gone(live.run, Duration::from_secs(2)).await;
        }
        let spent = self
            .turn
            .lock()
            .ok()
            .and_then(|turn| *turn)
            .is_some_and(|t| t.spent && Some(t.head) == head);
        if spent {
            return Err(Carry::Fail(format!(
                "This turn's {} calls are spent. The wallet stops a looping agent until the other side moves.",
                table_mcp::CALL_BUDGET
            )));
        }
        let mut last = String::from("The wallet started no run");
        for _ in 0..40 {
            if let Some(live) = world.slot.live().filter(|l| l.fresh())
                && let Some(live) = self.running(world, live).await
            {
                self.begin_turn(world, &live);
                return Ok(live);
            }
            match world
                .actor
                .execute::<RunSnapshot>(main_window(), Action::Start(world.deal_id))
                .await
            {
                Ok(snapshot) => {
                    self.runs.fetch_add(1, Ordering::SeqCst);
                    if let Some(live) = world
                        .slot
                        .next(None, Duration::from_secs(3))
                        .await
                        .filter(|l| l.run == snapshot.run)
                        && let Some(live) = self.running(world, live).await
                    {
                        self.begin_turn(world, &live);
                        return Ok(live);
                    }
                }
                // The previous run may still be finishing; ask again shortly.
                Err(error) => last = error.message,
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err(Carry::Fail(last))
    }
    /// Carries one JSON-RPC body to the live table's wallet, returning the table it went to.
    async fn forward(&self, body: &Bytes) -> Result<(u16, Bytes, u32), (String, u32)> {
        let mut seen = 0;
        for _ in 0..4 {
            let world = self
                .world()
                .ok_or_else(|| ("The sandbox is closing".to_owned(), seen))?;
            seen = world.number;
            // An agent that comes back to a closed table (expired, withdrawn) gets a fresh one.
            if world.deal().is_some_and(|d| d.state.terminal()) {
                let _ = self
                    .fresh(world.number, "the last table closed with no money moved")
                    .await;
                continue;
            }
            match self.carry(&world, body).await {
                Ok((status, bytes)) => return Ok((status, bytes, world.number)),
                Err(Carry::Stale) => {}
                Err(Carry::Fail(message)) => return Err((message, world.number)),
            }
        }
        Err(("The table kept changing; call again".into(), seen))
    }
    /// One table's leg: the wallet's MCP server under the live grant, renewing a lapsed session
    /// once.
    async fn carry(&self, world: &Arc<World>, body: &Bytes) -> Result<(u16, Bytes), Carry> {
        for attempt in 0..2 {
            let live = self.ensure_run(world).await?;
            let answer = self
                .http
                .post(&live.url)
                .header("content-type", "application/json")
                .header("x-wallet-secret", live.secret.as_str())
                .header("x-wallet-session", live.token.as_str())
                .body(body.to_vec())
                .send()
                .await
                .map_err(|_| Carry::Fail("The wallet's MCP server did not answer".into()))?;
            // The session lapsed between the check and the call: renew it once, and never hand
            // the agent a bare 401 (a client may read it as a sign-in challenge).
            if answer.status().as_u16() == 401 {
                if attempt == 0 {
                    world.slot.end(live.run);
                    let _ = world.slot.gone(live.run, Duration::from_secs(2)).await;
                    continue;
                }
                break;
            }
            let status = answer.status().as_u16();
            let bytes = answer
                .bytes()
                .await
                .map_err(|_| Carry::Fail("The wallet's answer was cut off".into()))?;
            return Ok((status, bytes));
        }
        Err(Carry::Fail(
            "The wallet's MCP session could not be renewed".into(),
        ))
    }
    fn record(
        &self,
        request: Option<&Value>,
        status: u16,
        answer: Option<&Value>,
        at: u64,
        table: u32,
    ) {
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
        entry.paypal = self.recorders.buyer.asked();
        entry.table = table;
        // The wallet cut this turn off: remember it, so the turn is not renewed on age alone.
        if entry
            .detail
            .as_deref()
            .is_some_and(|d| d.contains("tool-call budget"))
            && let Ok(mut turn) = self.turn.lock()
            && let Some(turn) = turn.as_mut()
        {
            turn.spent = true;
        }
        if entry.tool.as_deref() == Some("table_view")
            && entry.outcome == Outcome::Answered
            && let Some(table) = answer.and_then(|a| a.pointer("/result/structuredContent"))
        {
            self.journal.set_table(Some(table.clone()));
        }
        let entry = self.journal.push(entry);
        if !self.echo.load(Ordering::Relaxed) {
            return;
        }
        let read = entry.outcome == Outcome::Answered
            && matches!(
                entry.tool.as_deref(),
                Some("table_view" | "market_reference")
            );
        let Ok(mut folded) = self.folded.lock() else {
            return;
        };
        if read {
            let tool = entry.tool.clone().unwrap_or_default();
            match folded.as_mut() {
                Some((held, count)) if *held == tool => *count = count.saturating_add(1),
                _ => {
                    if let Some((held, count)) = folded.take() {
                        self.echo_line(&Self::fold_line(&held, count));
                    }
                    self.echo_line(&self.line(&entry));
                    *folded = Some((tool, 0));
                }
            }
            return;
        }
        if let Some((held, count)) = folded.take() {
            self.echo_line(&Self::fold_line(&held, count));
        }
        self.echo_line(&self.line(&entry));
    }
    /// The line for reads folded since the last one printed.
    fn fold_line(tool: &str, count: u32) -> String {
        if count == 0 {
            return String::new();
        }
        format!("         … {tool} ×{count} more (read only)")
    }
    fn echo_line(&self, line: &str) {
        if !line.is_empty() && self.echo.load(Ordering::Relaxed) {
            println!("{line}");
        }
    }
    /// Opens a fresh table: a new house and a new wallet, the same rules. The old world closes.
    /// `seen` is the table the caller saw; when another caller already replaced it, nothing more
    /// opens and the live table's number is returned.
    pub async fn fresh(&self, seen: u32, why: &str) -> Result<u32, BootError> {
        let _one = self.opening.lock().await;
        let _runs = self.starting.lock().await;
        let current = self.world().map_or(0, |w| w.number);
        if current != seen {
            return Ok(current);
        }
        let number = current.saturating_add(1);
        let next = Arc::new(World::open(number, &self.recorders).await?);
        let old = self
            .world
            .write()
            .map(|mut held| std::mem::replace(&mut *held, next))
            .map_err(|_| BootError::Step("fresh table"))?;
        old.close().await;
        if let Ok(mut turn) = self.turn.lock() {
            *turn = None;
        }
        self.journal.set_table(None);
        *self.facts.lock().await = Facts::default();
        let entry = self.journal.push(Entry::marker(
            number,
            unix_ms(),
            format!(
                "Table {number} opened ({why}): a fresh house seller asks {} again, under the same signed rule",
                dollars(crate::HOUSE_ASK)
            ),
            self.recorders.buyer.asked(),
        ));
        self.echo_line(&self.line(&entry));
        Ok(number)
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
                format!("{tool} {shown}")
            }
            (Some(tool), None) => tool.clone(),
            _ => entry.method.clone(),
        };
        let color = self.color.load(Ordering::Relaxed);
        let paint = |code: &str, text: &str| {
            if color {
                format!("\u{1b}[{code}m{text}\u{1b}[0m")
            } else {
                text.to_owned()
            }
        };
        let (mark, tone) = match entry.outcome {
            Outcome::Answered => ("  ok    ", "32"),
            Outcome::Refused => ("  NO    ", "1;31"),
            Outcome::Protocol => ("  ·     ", "2"),
            Outcome::Error => ("  !     ", "33"),
        };
        let mut rule = entry.rule.clone();
        if let Some(detail) = &entry.detail {
            rule.push_str(" (");
            rule.push_str(detail);
            rule.push(')');
        }
        let paypal = if entry.paypal == 0 {
            paint("32", "PayPal asked: 0")
        } else {
            paint(
                "1;33",
                &format!("PayPal asked: {} (recorded, never sent)", entry.paypal),
            )
        };
        let rule = printable(&rule, 110);
        let rule = if entry.outcome == Outcome::Refused {
            paint("31", &rule)
        } else {
            rule
        };
        format!(
            "  {:02}:{:02}  {:<26}{}{}   {}",
            secs / 60,
            secs % 60,
            printable(what.trim(), 26),
            paint(tone, mark),
            rule,
            paypal
        )
    }
    /// The wallet's own record, read through the actor like the console reads it.
    async fn facts(&self, world: &World) -> Facts {
        let mut facts = self.facts.lock().await;
        if facts.table == world.number && facts.read.is_some_and(|at| at.elapsed() < FACTS_TTL) {
            return facts.clone();
        }
        facts.table = world.number;
        facts.safety = world
            .actor
            .execute(main_window(), Action::SafetyRecord)
            .await
            .ok();
        facts.audit = world
            .actor
            .execute::<AuditPage>(
                main_window(),
                Action::AuditPage(AuditPageArgs {
                    before: None,
                    limit: 14,
                }),
            )
            .await
            .map(|page| page.rows)
            .unwrap_or_default();
        facts.proof = self.proof(world).await.map(|bundle| {
            let report = table_verify::verify_bundle(&bundle);
            let checks: Vec<Value> = report
                .checks
                .iter()
                .map(|c| json!({"name": c.name, "ok": c.ok, "checked": c.checked, "applies": c.applies}))
                .collect();
            json!({
                "verified": report.verified(),
                "passed": report.checks.iter().filter(|c| c.ok).count(),
                "applies": report.checks.iter().filter(|c| c.applies).count(),
                "checks": checks,
            })
        });
        facts.read = Some(Instant::now());
        facts.clone()
    }
    /// This table's proof file, exported by the wallet as the console's "Save proof" does.
    async fn proof(&self, world: &World) -> Option<table_proto::ProofBundle> {
        world
            .actor
            .execute(main_window(), Action::ExportProof(world.deal_id))
            .await
            .ok()
    }
    /// The proof file of the table now open, and the offline verifier's verdict on it.
    pub async fn proof_now(&self) -> Option<(table_proto::ProofBundle, table_verify::Report)> {
        let world = self.world()?;
        let bundle = self.proof(&world).await?;
        let report = table_verify::verify_bundle(&bundle);
        Some((bundle, report))
    }
    /// The whole-ledger safety verdict, read now (for the exit summary).
    pub async fn safety(&self) -> Option<SafetyRecord> {
        let world = self.world()?;
        *self.facts.lock().await = Facts::default();
        self.facts(&world).await.safety
    }
    fn counts(&self) -> (usize, usize, usize) {
        self.journal.tally()
    }
    /// The page's facts: the signed rule, the deal, the counters, the wallet's own record.
    pub async fn snapshot(&self) -> Value {
        let (calls, answered, refused) = self.counts();
        let world = self.world();
        let deal = world.as_ref().and_then(|w| w.deal());
        let facts = match &world {
            Some(world) => self.facts(world).await,
            None => Facts::default(),
        };
        let house_deal = match &world {
            Some(world) => world.house_deal().await,
            None => None,
        };
        json!({
            "port": self.port,
            "rehearsal": self.rehearsal.load(Ordering::Relaxed),
            "item": crate::ITEM,
            "table_number": world.as_ref().map_or(0, |w| w.number),
            "rule": {
                "floor": dollars(crate::RULE_FLOOR),
                "ceiling": dollars(crate::RULE_CEILING),
                "ceiling_cents": crate::RULE_CEILING,
                "in_person": dollars(crate::RULE_IN_PERSON),
                "in_person_cents": crate::RULE_IN_PERSON,
                "per_deal": dollars(crate::RULE_PER_DEAL),
                "rounds": crate::RULE_ROUNDS,
            },
            "house": {"ask": dollars(crate::HOUSE_ASK), "ask_cents": crate::HOUSE_ASK, "rounds": crate::HOUSE_ROUNDS},
            "deal": deal.as_ref().map(|d| json!({
                "id": d.id,
                "state": d.state,
                "terminal": d.state.terminal(),
                "price": dollars(d.terms.unit_price.minor()),
                "price_cents": d.terms.unit_price.minor(),
                "decided_by": d.decided_by,
            })),
            "house_deal": house_deal.as_ref().map(|d| json!({"state": d.state, "price_cents": d.terms.unit_price.minor()})),
            "paypal": {"buyer": self.recorders.buyer.asked(), "house": self.recorders.house.asked()},
            "calls": calls,
            "answered": answered,
            "refused": refused,
            "runs": self.runs.load(Ordering::SeqCst),
            "table": self.journal.table(),
            "safety": facts.safety,
            "audit": facts.audit,
            "proof": facts.proof,
        })
    }
}

/// The `initialize` answer with the role's playbook as the server's instructions.
fn with_instructions(answer: &mut Value) {
    if let Some(result) = answer.get_mut("result").and_then(Value::as_object_mut)
        && result.contains_key("serverInfo")
    {
        result.insert(
            "instructions".into(),
            table_core::Playbook::BuyerHaggler.text().into(),
        );
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
        Ok((status, bytes, table)) => {
            let mut answer: Option<Value> = serde_json::from_slice(&bytes).ok();
            app.record(request.as_ref(), status, answer.as_ref(), at, table);
            let method = request.as_ref().and_then(|r| r.get("method"));
            let bytes = match answer.as_mut() {
                Some(answer) if method == Some(&json!("initialize")) => {
                    with_instructions(answer);
                    Bytes::from(answer.to_string())
                }
                _ => bytes,
            };
            let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY);
            (status, [(header::CONTENT_TYPE, "application/json")], bytes).into_response()
        }
        Err((message, table)) => {
            let id = request
                .as_ref()
                .and_then(|r| r.get("id"))
                .cloned()
                .unwrap_or(Value::Null);
            let answer = json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":message}});
            app.record(request.as_ref(), 200, Some(&answer), at, table);
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
    Json(app.snapshot().await).into_response()
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
/// The page's "Open a fresh table": its own origin only, with a header a cross-site form cannot set.
async fn fresh(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.door(&headers)
        || (headers.contains_key(header::ORIGIN) && !app.own_origin(&headers))
        || headers.get("x-sandbox").and_then(|v| v.to_str().ok()) != Some("fresh")
    {
        return refused_door();
    }
    let seen = app.world().map_or(0, |w| w.number);
    match app.fresh(seen, "opened from the live page").await {
        Ok(number) => Json(json!({"table_number": number})).into_response(),
        Err(error) => (StatusCode::SERVICE_UNAVAILABLE, error.to_string()).into_response(),
    }
}
/// The table's proof file, as a download the offline verifier (`table-verify`) checks.
async fn proof(State(app): State<Arc<App>>, headers: HeaderMap) -> Response {
    if !app.door(&headers) {
        return refused_door();
    }
    let Some((bundle, _)) = app.proof_now().await else {
        return (StatusCode::SERVICE_UNAVAILABLE, "no proof yet").into_response();
    };
    let Ok(bytes) = serde_json::to_vec_pretty(&bundle) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "proof unreadable").into_response();
    };
    let name = format!(
        "attachment; filename=\"table-{}.tableproof\"",
        bundle.deal.id
    );
    (
        [
            (header::CONTENT_TYPE, "application/json".to_owned()),
            (header::CONTENT_DISPOSITION, name),
        ],
        bytes,
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_text_carries_no_escapes_or_reordering() {
        let agent = "pay\u{1b}[2J\u{202E}00.923\u{200B}";
        let shown = printable(agent, 80);
        assert!(!shown.contains('\u{1b}'));
        assert!(!shown.contains('\u{202E}'));
        assert!(!shown.contains('\u{200B}'));
        assert_eq!(dollars(24_999), "$249.99");
    }
}
