use crate::glass::Published;
use crate::{Decision, Policy};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use ed25519_dalek::{Signer, SigningKey};
use std::collections::HashMap;
use std::hash::Hash;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use table_app::{
    AgentRequest, AgentRole, AgentScope, AgentService, Authority, OfferInput, Pipeline, Resolve,
    Wallet,
};
use table_core::*;
use table_ledger::{Counterparty, Direction, Ledger, LedgerError, PairedVia};
use table_proto::{
    AgentSigner, Body, HouseRefusals, HouseRelease, HouseRequest, HouseResponse, HouseTable,
    PairingIdentity, ReasonCode, ShortText, SignedHousePrefix, SignedPairingIdentity,
};
use tokio::sync::{Notify, mpsc, oneshot};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid house configuration or request")]
    Invalid,
    #[error("house capacity reached")]
    Full,
    #[error("house temporarily unavailable")]
    Unavailable,
    #[error(transparent)]
    App(#[from] table_app::Error),
    #[error(transparent)]
    Ledger(#[from] LedgerError),
}
impl From<DomainError> for Error {
    fn from(e: DomainError) -> Self {
        Self::App(e.into())
    }
}
impl From<table_proto::ProtocolError> for Error {
    fn from(e: table_proto::ProtocolError) -> Self {
        Self::App(e.into())
    }
}
impl Error {
    /// A fixed name for the failure, safe for an operator log: never a message, a PayPal body,
    /// a refusal reason or any other text that came from outside.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "invalid",
            Self::Full => "full",
            Self::Unavailable => "unavailable",
            Self::Ledger(e) | Self::App(table_app::Error::Ledger(e)) => match e {
                LedgerError::Sql(_) => "ledger.sql",
                LedgerError::Json(_) => "ledger.json",
                LedgerError::Domain(_) => "ledger.domain",
                LedgerError::Protocol(_) => "ledger.protocol",
                LedgerError::Integrity(_) => "ledger.integrity",
                LedgerError::NotFound => "ledger.not_found",
                LedgerError::Conflict => "ledger.conflict",
                LedgerError::GroupClosed => "ledger.group_closed",
            },
            Self::App(e) => match e {
                table_app::Error::Refused(_) => "app.refused",
                table_app::Error::Agent(_) => "app.agent_refused",
                table_app::Error::Protocol(_) => "app.protocol",
                table_app::Error::Domain(_) => "app.domain",
                table_app::Error::Invalid => "app.invalid",
                table_app::Error::Unavailable => "app.unavailable",
                table_app::Error::Permission => "app.permission",
                table_app::Error::Locked => "app.locked",
                table_app::Error::Ledger(_) => "app.ledger",
            },
        }
    }
}

/// Where the HOUSE writes operator lines. Callers build every line from fixed codes and ids.
pub trait Log: Send + Sync {
    fn line(&self, line: &str);
}
/// The deployed sink: one line per event on stderr, which the host collects.
#[derive(Debug)]
pub struct Stderr;
impl Log for Stderr {
    fn line(&self, line: &str) {
        eprintln!("{line}");
    }
}

/// How long a table request waits for the actor before the caller sees 503.
const REPLY_TIMEOUT: Duration = Duration::from_secs(20);
/// Requests the actor queues for buyers' tables (and trusted snapshots); beyond it, 429.
const TABLE_QUEUE: usize = 4;
/// Public prefix reads the actor queues on their own channel, so a flood of them is turned away
/// on that channel and never takes a buyer's table slot; beyond it, 429.
const PREFIX_QUEUE: usize = 4;
/// table-paypal's bound on one HTTP request (`ReqwestTransport`'s timeout).
const PAYPAL_REQUEST_SECS: i64 = table_paypal::http::REQUEST_TIMEOUT_SECS as i64;
/// One PayPal call makes at most `table_paypal::ATTEMPTS` attempts, each at most an OAuth token
/// request plus the call itself.
const PAYPAL_ATTEMPTS: i64 = table_paypal::ATTEMPTS as i64;
/// The `ExponentialBackoff` waits between those attempts: 1 s and 2 s today.
const PAYPAL_BACKOFF_SECS: i64 = {
    let mut total = 0;
    let mut attempt = 0;
    while attempt + 1 < table_paypal::ATTEMPTS {
        total += table_paypal::http::backoff_secs(attempt) as i64;
        attempt += 1;
    }
    total
};
/// The longest single awaited deal step (one PayPal call), from table-paypal's own constants:
/// 3 x (30 + 30) + 3 = 183 s today.
const LONGEST_STEP_SECS: i64 = PAYPAL_ATTEMPTS * 2 * PAYPAL_REQUEST_SECS + PAYPAL_BACKOFF_SECS;
/// The actor's timer tick, and room for the ledger writes around one step.
const TICK_SECS: i64 = 1;
const LEDGER_SLACK_SECS: i64 = 6;
/// A heartbeat older than this (seconds) makes `/healthz` answer 503: the 183 s step plus the
/// 1 s tick and 6 s of ledger writes around it. The heartbeat is written around each awaited
/// step, so only an await longer than any PayPal call can take reads as stalled. A fixed number,
/// so the host's health-check settings can be set against it (DECISIONS 12).
pub const HEARTBEAT_STALE: i64 = 190;
// A slow PayPal call is never read as a stall: if table-paypal's timeout, attempt count or
// backoff grows, this stops compiling until HEARTBEAT_STALE (and the host's settings) follow.
const _: () = assert!(HEARTBEAT_STALE >= LONGEST_STEP_SECS + TICK_SECS + LEDGER_SLACK_SECS);
// And a stalled actor is still noticed within a few minutes.
const _: () = assert!(HEARTBEAT_STALE <= 2 * LONGEST_STEP_SECS);
/// One deal step at its slowest: the PayPal call, the tick that starts it and its ledger writes.
const STEP_SECS: i64 = LONGEST_STEP_SECS + TICK_SECS + LEDGER_SLACK_SECS;
/// Room for a signed RECEIPT to cross the relay and be read by the buyer's wallet, which polls
/// its mailbox every second and backs off to 32 s while the relay is unreachable.
const RECEIPT_DELIVERY_SECS: i64 = 120;
// An approval the HOUSE sees in the last second of its window (the poll that sees it, then the
// authorization, then the capture) still has its RECEIPT reach the buyer's wallet before that
// wallet lets the deal lapse (HOUSE_RECEIPT_GRACE_SECS past the same window): the HOUSE stops
// polling and authorizing at its own deadline, so a margin of zero before it is enough. A
// capture that would start later than this is voided instead (`Seller::bound_capture`).
const _: () = assert!(HOUSE_RECEIPT_GRACE_SECS >= 3 * STEP_SECS + RECEIPT_DELIVERY_SECS);
/// An operation still unresolved is logged again at most this often (seconds), so a HOUSE that
/// keeps failing to reach PayPal's truth is never silent after one line.
pub const PENDING_REPORT_SECS: i64 = 600;
/// First wait between approval polls of one deal; doubles up to [`POLL_MAX`].
const POLL_FIRST: i64 = 5;
const POLL_MAX: i64 = 60;

/// Per-key poll backoff, memory only. The first poll is due at once, then 5 s, doubling to 60 s.
/// A change of the key's state restarts the sequence.
#[derive(Debug)]
pub(crate) struct PollSchedule<K, S> {
    entries: HashMap<K, (S, i64, i64)>,
}
impl<K: Hash + Eq + Copy, S: PartialEq + Copy> PollSchedule<K, S> {
    pub(crate) fn new() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
    /// True when `key` should be polled now; if so, the next poll time is already booked.
    pub(crate) fn due(&mut self, key: K, state: S, now: i64) -> bool {
        let wait = match self.entries.get(&key) {
            Some((seen, next, wait)) if *seen == state => {
                if now < *next {
                    return false;
                }
                (*wait * 2).min(POLL_MAX)
            }
            _ => POLL_FIRST,
        };
        self.entries
            .insert(key, (state, now.saturating_add(wait), wait));
        true
    }
    pub(crate) fn forget(&mut self, key: &K) {
        self.entries.remove(key);
    }
    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

pub struct Seller {
    pub pipeline: Pipeline,
    owner: SigningKey,
    pub(crate) agent: SigningKey,
    pub(crate) release: HouseRelease,
    pub(crate) mandate: OpenMandate,
    pub(crate) policy: Policy,
    terms: Terms,
    category: Category,
    pub(crate) clock: Arc<dyn Clock>,
    relay: Arc<dyn table_relay::RelayApi>,
    polls: PollSchedule<DealId, DealState>,
    log: Arc<dyn Log>,
    /// The last failure logged per (deal, step), so a step failing the same way every second
    /// writes one line, not one per tick. Cleared when the step next succeeds.
    failing: HashMap<(Option<DealId>, &'static str), &'static str>,
    /// When each unresolved operation was last logged, and whether it was parked then.
    reported: HashMap<(DealId, &'static str, u8), (bool, i64)>,
    /// Clock seconds of the actor's last sign of life, read by `/healthz`.
    heartbeat: Arc<AtomicI64>,
    /// Table requests turned away since start (T9), by fixed reason code.
    pub(crate) refusals: HouseRefusals,
    /// The public projection and signed head the read routes serve (T9).
    pub(crate) published: Arc<RwLock<Option<Arc<Published>>>>,
    pub(crate) published_at: Option<i64>,
}

/// A money operation whose PayPal outcome is unknown and not yet resolved: its call failed
/// without an answer, or the process stopped in the middle of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOperation {
    pub deal: DealId,
    pub operation: &'static str,
    pub attempt: u8,
    /// The resolver could not settle it and the owner must decide; it is not retried.
    pub needs_owner: bool,
}
impl std::fmt::Debug for Seller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HostedSeller { [REDACTED] }")
    }
}
impl Seller {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        ledger: Ledger,
        owner: SigningKey,
        agent: SigningKey,
        release: HouseRelease,
        mandate: OpenMandate,
        api: Arc<dyn table_paypal::PayPalApi>,
        clock: Arc<dyn Clock>,
        relay: Arc<dyn table_relay::RelayApi>,
    ) -> Result<Self, Error> {
        release
            .verify_mandate(&mandate)
            .map_err(|_| Error::Invalid)?;
        if owner.verifying_key().to_bytes() != release.owner_key
            || agent.verifying_key().to_bytes() != release.agent_key
            || clock.now() < mandate.payload.not_before
            || clock.now() >= mandate.payload.expires
        {
            return Err(Error::Invalid);
        }
        // A single release-owned demo item. All money and limits come from its signed clauses.
        let (item, floor, ask, max_rounds) = mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                Clause::Band {
                    item_refs,
                    floor: Some(floor),
                    ceiling: Some(ask),
                    max_rounds,
                    ..
                } if item_refs.len() == 1 => {
                    Some((item_refs[0].clone(), *floor, *ask, *max_rounds))
                }
                _ => None,
            })
            .ok_or(Error::Invalid)?;
        let category = mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                Clause::PerDeal {
                    kind: DealKind::Haggle,
                    categories,
                    ..
                } if categories.len() == 1 => Some(categories[0]),
                _ => None,
            })
            .ok_or(Error::Invalid)?;
        if floor.currency() != ask.currency() || floor.minor() > ask.minor() {
            return Err(Error::Invalid);
        }
        let terms = Terms {
            item_ref: item,
            qty: 1,
            unit_price: ask,
            currency: ask.currency(),
            delivery: Delivery::DigitalNow,
        };
        let mut pipeline = Pipeline::new(
            Wallet::new(
                ledger,
                AgentSigner::from_key(agent.clone()),
                owner.verifying_key(),
            ),
            api,
            clock.now(),
        )?;
        if pipeline
            .wallet
            .ledger
            .next_mandate_version(mandate.payload.id)?
            == 1
        {
            pipeline
                .wallet
                .ledger
                .insert_mandate(&mandate, &owner.verifying_key(), clock.now())?;
        }
        let active = pipeline.wallet.ledger.active_mandate(
            mandate.payload.id,
            mandate.payload.version,
            &owner.verifying_key(),
        )?;
        release
            .verify_mandate(&active)
            .map_err(|_| Error::Invalid)?;
        pipeline.enable_house(release.clone(), &active)?;
        Ok(Self {
            pipeline,
            owner,
            agent,
            release,
            mandate,
            policy: Policy {
                floor,
                ask,
                max_rounds,
            },
            terms,
            category,
            heartbeat: Arc::new(AtomicI64::new(clock.now())),
            refusals: HouseRefusals {
                since: clock.now(),
                ..HouseRefusals::default()
            },
            published: Arc::new(RwLock::new(None)),
            published_at: None,
            clock,
            relay,
            polls: PollSchedule::new(),
            log: Arc::new(Stderr),
            failing: HashMap::new(),
            reported: HashMap::new(),
        })
    }
    fn beat(&self) {
        self.heartbeat.store(self.clock.now(), Ordering::Relaxed);
    }
    /// Money operations whose PayPal outcome is unknown and not yet resolved, oldest first, read
    /// from the ledger: every `unknown` operation, and every `pending` one no live call owns
    /// (all of them after a restart). Deals already closed are left out: nothing more is sent
    /// for them.
    pub fn pending_operations(&self) -> Result<Vec<PendingOperation>, Error> {
        let now = self.clock.now();
        let mut pending = Vec::new();
        for op in self.pipeline.open_operations(None, now)? {
            if self
                .pipeline
                .wallet
                .ledger
                .get_deal(op.deal_id)?
                .state
                .terminal()
            {
                continue;
            }
            pending.push(PendingOperation {
                deal: op.deal_id,
                operation: op.operation,
                attempt: op.attempt,
                needs_owner: op.needs_owner,
            });
        }
        Ok(pending)
    }
    /// Writes one line per unresolved operation: deal, operation, attempt and outcome
    /// (`unknown`, or `needs_owner` once parked). Each tick calls it; an operation is logged
    /// again when it is parked and otherwise at most once per [`PENDING_REPORT_SECS`].
    pub fn report_pending(&mut self) -> Result<usize, Error> {
        let now = self.clock.now();
        let pending = self.pending_operations()?;
        self.reported.retain(|(deal, operation, attempt), _| {
            pending
                .iter()
                .any(|p| p.deal == *deal && p.operation == *operation && p.attempt == *attempt)
        });
        for p in &pending {
            let key = (p.deal, p.operation, p.attempt);
            if self.reported.get(&key).is_some_and(|(parked, at)| {
                *parked == p.needs_owner && now.saturating_sub(*at) < PENDING_REPORT_SECS
            }) {
                continue;
            }
            self.reported.insert(key, (p.needs_owner, now));
            self.log.line(&format!(
                "house pending deal={} operation={} attempt={} outcome={}",
                p.deal,
                p.operation,
                p.attempt,
                if p.needs_owner {
                    "needs_owner"
                } else {
                    "unknown"
                }
            ));
        }
        Ok(pending.len())
    }
    /// Replaces the stderr sink (tests capture the lines).
    #[must_use]
    pub fn with_log(mut self, log: Arc<dyn Log>) -> Self {
        self.log = log;
        self
    }
    /// Logs a failed step as `house step=<step> deal=<id> error=<code>` and passes the result on.
    fn noted<T>(
        &mut self,
        step: &'static str,
        deal: Option<DealId>,
        result: Result<T, Error>,
    ) -> Result<T, Error> {
        match &result {
            Ok(_) => {
                self.failing.remove(&(deal, step));
            }
            Err(e) => {
                let code = e.code();
                if self.failing.insert((deal, step), code) != Some(code) {
                    let deal = deal.map_or_else(|| "-".to_owned(), |d| d.to_string());
                    self.log
                        .line(&format!("house step={step} deal={deal} error={code}"));
                }
            }
        }
        result
    }
    /// Seats a buyer at a new table. A request turned away is counted by its fixed reason code
    /// for the public ledger (T9) and writes nothing.
    pub fn table(&mut self, request: HouseRequest) -> Result<HouseResponse, Error> {
        let result = self.seat(request);
        if let Err(error) = &result {
            self.note_refusal(error);
        }
        result
    }
    fn seat(&mut self, request: HouseRequest) -> Result<HouseResponse, Error> {
        let now = self.clock.now();
        self.pipeline.wallet.ledger.active_mandate(
            self.mandate.payload.id,
            self.mandate.payload.version,
            &self.owner.verifying_key(),
        )?;
        request.buyer.verify().map_err(|_| Error::Invalid)?;
        let buyer = &request.buyer.identity;
        if buyer.side != Side::Buyer
            || buyer.in_reply_to.is_some()
            || buyer.expires <= now
            || buyer.expires > now.saturating_add(86400)
            || buyer.agent_key == self.release.agent_key
        {
            return Err(Error::Invalid);
        }
        let digest = request.buyer.identity_hash().map_err(|_| Error::Invalid)?;
        let key = table_proto::key_id(
            &ed25519_dalek::VerifyingKey::from_bytes(&buyer.agent_key)
                .map_err(|_| Error::Invalid)?,
        )?;
        let ledger = &mut self.pipeline.wallet.ledger;
        let reserved = ledger.house_request(digest)?;
        let id = reserved.unwrap_or_else(|| DealId(ulid::Ulid::new()));
        let bound = ledger.counterparty_binding(&key)?;
        if let Some((hash, owner, payee)) = &bound
            && (*hash != buyer.code_hash || *owner != buyer.owner_key || *payee != buyer.payee)
        {
            return Err(Error::Invalid);
        }
        let deal = Deal {
            created_at: now,
            updated_at: now,
            id,
            kind: DealKind::Haggle,
            side: Side::Seller,
            counterparty: key,
            mandate_id: self.mandate.payload.id,
            mandate_version: self.mandate.payload.version,
            terms: self.terms.clone(),
            state: DealState::Pairing,
            transcript_head: H256::ZERO,
            paypal: PaypalRefs::default(),
            mode: Mode::Sandbox,
            market: None,
            shield: None,
            decided_by: None,
            shield_rule: None,
            shield_release: None,
        };
        // No PayPal call (including a poll) can precede a successful mandate check.
        self.mandate
            .payload
            .check(
                &Intent {
                    kind: deal.kind,
                    side: deal.side,
                    role: Role::Sell,
                    category: self.category,
                    terms: &deal.terms,
                    counterparty: &deal.counterparty,
                    paired: true,
                    house: false,
                    payee: &self.release.payee,
                    rounds_used: 0,
                },
                self.pipeline.wallet.ledger.usage_for(&deal, now)?,
                now,
            )
            .map_err(table_app::Error::from)?;
        // Nothing is written for a request until it has passed every check above.
        let ledger = &mut self.pipeline.wallet.ledger;
        if reserved.is_none() && ledger.house_open_request_count()? >= 64 {
            return Err(Error::Full);
        }
        if bound.is_none() {
            ledger.insert_paired_counterparty(
                &Counterparty {
                    key_id: deal.counterparty.clone(),
                    owner_key: buyer.owner_key,
                    agent_key: buyer.agent_key,
                    display_name: ShortText::new("House guest".into())?,
                    paired_via: PairedVia::Code,
                    words_confirmed_at: Some(now),
                    declared_payee: buyer.payee.clone(),
                    first_seen: now,
                },
                buyer.code_hash,
            )?;
        }
        match self.pipeline.wallet.ledger.get_deal(id) {
            Err(LedgerError::NotFound) => self.pipeline.wallet.ledger.create_deal(&deal, now)?,
            Ok(existing) if existing.counterparty == deal.counterparty => {}
            _ => return Err(Error::Invalid),
        }
        // The silence deadline comes first: a deal left behind by a later failure still lapses.
        if self.pipeline.wallet.ledger.deadline(id)?.is_none() {
            let due = self
                .mandate
                .payload
                .clauses
                .iter()
                .find_map(|c| match c {
                    Clause::Band { deadline, .. } => Some(*deadline),
                    _ => None,
                })
                .ok_or(Error::Invalid)?
                .min(now.saturating_add(300));
            self.pipeline
                .wallet
                .ledger
                .set_deadline(id, due, None, now)?;
        }
        let ledger = &mut self.pipeline.wallet.ledger;
        match ledger.deal_category(id) {
            Err(LedgerError::NotFound) => ledger.set_deal_category(id, self.category)?,
            Ok(category) if category == self.category => {}
            _ => return Err(Error::Invalid),
        }
        ledger.bind_paired_relay(id, now)?;
        if ledger.get_deal(id)?.state == DealState::Pairing {
            self.pipeline.wallet.list(id, now)?;
        }
        // Reserved last, so a request that fails above holds no HOUSE request slot.
        if reserved.is_none() {
            self.pipeline
                .wallet
                .ledger
                .reserve_house_request(digest, id)?;
        }
        let identity = PairingIdentity {
            code_hash: buyer.code_hash,
            owner_key: self.release.owner_key,
            agent_key: self.release.agent_key,
            side: Side::Seller,
            payee: self.release.payee.clone(),
            expires: buyer.expires,
            in_reply_to: Some(digest),
        };
        let bytes = canonical_bytes(&identity).map_err(|_| Error::Invalid)?;
        let mut response = HouseResponse {
            seller: SignedPairingIdentity {
                identity,
                owner_signature: self.owner.sign(&bytes).to_bytes().to_vec(),
                agent_signature: self.agent.sign(&bytes).to_bytes().to_vec(),
            },
            mandate: self.mandate.clone(),
            table: HouseTable {
                negotiation_deadline: self
                    .pipeline
                    .wallet
                    .ledger
                    .deadline(id)?
                    .ok_or(Error::Invalid)?
                    .0,
                deal_id: id,
                terms: self.terms.clone(),
                category: self.category,
            },
            signature: vec![],
        };
        response.signature = self
            .agent
            .sign(&response.signing_bytes().map_err(|_| Error::Invalid)?)
            .to_bytes()
            .to_vec();
        Ok(response)
    }
    /// One pass over every deal. Each failed step writes one log line (see `noted`); the first
    /// failure is also returned.
    pub async fn tick(&mut self) -> Result<(), Error> {
        let now = self.clock.now();
        let mut failure = None;
        // Defaults run first and independently of transport failures.
        // The heartbeat is written around every awaited step, so a busy actor stays healthy and
        // only one await longer than any PayPal call can take reads as stalled.
        self.beat();
        let deals = self.listed("advance")?;
        for deal in deals {
            let result = self.advance(&deal, now).await;
            self.beat();
            if let Err(e) = self.noted("advance", Some(deal.id), result) {
                failure.get_or_insert(e);
            }
        }
        let work = self
            .pipeline
            .wallet
            .ledger
            .relay_work()
            .map_err(Error::from);
        for work in self.noted("deliver", None, work)? {
            let id = work.deal_id;
            let result = self.deliver(work, now).await;
            self.beat();
            if let Err(e) = self.noted("deliver", Some(id), result) {
                failure.get_or_insert(e);
            }
        }
        let inbox = self
            .pipeline
            .wallet
            .ledger
            .pending_inbox()
            .map_err(Error::from);
        for message in self.noted("inbox", None, inbox)? {
            let id = message.deal_id;
            let duplicate = self
                .pipeline
                .wallet
                .ledger
                .has_envelope_hash(id, H256::digest(message.raw.as_bytes()))
                .map_err(Error::from);
            let accepted = if self.noted("inbox", Some(id), duplicate)? {
                true
            } else {
                let result = self.receive(id, &message.raw, now);
                // A rejected message is logged and dropped; a broken ledger stops the tick.
                match self.noted("inbox", Some(id), result) {
                    Ok(()) => true,
                    Err(Error::Ledger(LedgerError::Sql(_) | LedgerError::Integrity(_))) => {
                        return Err(Error::Unavailable);
                    }
                    Err(_) => false,
                }
            };
            let finished = self
                .pipeline
                .wallet
                .ledger
                .finish_inbox(&message, accepted, now)
                .map_err(Error::from);
            self.noted("inbox", Some(id), finished)?;
        }
        let deals = self.listed("negotiate")?;
        for deal in deals {
            let result = self.negotiate(&deal, now);
            if let Err(e) = self.noted("negotiate", Some(deal.id), result) {
                failure.get_or_insert(e);
            }
        }
        let report = self.report_pending().map(|_| ());
        if let Err(e) = self.noted("pending", None, report) {
            failure.get_or_insert(e);
        }
        failure.map_or(Ok(()), Err)
    }
    fn listed(&mut self, step: &'static str) -> Result<Vec<Deal>, Error> {
        let deals = self
            .pipeline
            .wallet
            .ledger
            .list_deals()
            .map_err(Error::from);
        self.noted(step, None, deals)
    }
    async fn deliver(
        &mut self,
        work: table_ledger::RelayWork,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.relay
            .create(work.mailbox)
            .await
            .map_err(|_| Error::Unavailable)?;
        let batch = self
            .relay
            .poll(work.mailbox, &work.generation, work.cursor, 0)
            .await
            .map_err(|_| Error::Unavailable)?;
        batch.validate().map_err(|_| Error::Invalid)?;
        let generation = batch.generation.clone();
        self.pipeline.wallet.ledger.stage_relay_batch(
            work.deal_id,
            &generation,
            batch.after,
            &batch.messages,
            now,
        )?;
        // Generation changes replay durable history on the next tick, just like the wallet.
        if work.generation == generation {
            for (hash, raw) in work.outgoing {
                self.relay
                    .send(work.mailbox, &raw)
                    .await
                    .map_err(|_| Error::Unavailable)?;
                self.pipeline
                    .wallet
                    .ledger
                    .acknowledge_relay(work.deal_id, &generation, hash)?;
            }
        }
        Ok(())
    }
    fn receive(&mut self, id: DealId, raw: &str, now: i64) -> Result<(), Error> {
        let verified = self.pipeline.wallet.ledger.preview_inbound(id, raw, now)?;
        if let Body::Offer { price, delivery } = &verified.envelope().body {
            let round = self
                .pipeline
                .wallet
                .ledger
                .peer_offer_count(id)?
                .saturating_add(1);
            if *delivery != self.terms.delivery
                || matches!(
                    self.policy
                        .decide_on_schedule(*price, u8::try_from(round).unwrap_or(u8::MAX))
                        .map_err(|_| Error::Invalid)?,
                    Decision::Counter(_) | Decision::Withdraw
                )
            {
                self.pipeline.wallet.check_mandate(id, self.category, now)?;
                self.pipeline
                    .wallet
                    .ledger
                    .record_declined_offer(&verified, now)?;
                return Ok(());
            }
        }
        self.pipeline
            .wallet
            .receive_relay(id, raw, self.category, now)?;
        Ok(())
    }
    fn negotiate(&mut self, deal: &Deal, now: i64) -> Result<(), Error> {
        if !matches!(deal.state, DealState::Listed | DealState::Negotiating)
            || self
                .pipeline
                .wallet
                .ledger
                .deadline(deal.id)?
                .is_some_and(|d| d.0 <= now)
            || deal.shield.is_some_and(|s| s >= ShieldVerdict::Hold)
        {
            return Ok(());
        }
        if let Some((Direction::Inbound, Body::Offer { price, delivery })) =
            self.pipeline.wallet.ledger.last_message(deal.id)?
        {
            let round = self.pipeline.wallet.ledger.peer_offer_count(deal.id)?;
            let decision = self
                .policy
                .decide_on_schedule(price, u8::try_from(round).unwrap_or(u8::MAX))
                .map_err(|_| Error::Invalid)?;
            let decision = if delivery != self.terms.delivery && decision == Decision::Accept {
                Decision::Counter(price)
            } else {
                decision
            };
            match decision {
                Decision::Withdraw => {
                    self.pipeline
                        .wallet
                        .withdraw(deal.id, ReasonCode::Rounds, now)?;
                    return Ok(());
                }
                Decision::Counter(price) => {
                    self.pipeline.wallet.invoke(
                        &AgentScope {
                            deal_id: deal.id,
                            role: AgentRole::Negotiator,
                            category: self.category,
                        },
                        AgentRequest::Offer(OfferInput {
                            deal_id: deal.id,
                            price: price.decimal(),
                            delivery: self.terms.delivery.clone(),
                        }),
                        now,
                    )?;
                }
                Decision::Accept => {}
            }
        }
        if let Some(status) = self.pipeline.wallet.ledger.negotiation_status(deal.id)?
            && !status.own_accept
        {
            self.pipeline
                .wallet
                .accept(deal.id, status.offer_seq, self.category, now)?;
        }
        Ok(())
    }
    /// An authorized deal's capture deadline is the last moment a capture still has its RECEIPT
    /// reach the buyer's wallet before that wallet lets the deal lapse (it counts
    /// [`HOUSE_APPROVAL_SECS`] and then [`HOUSE_RECEIPT_GRACE_SECS`] from this HOUSE's own
    /// SETTLE), not the authorization's 72 hours. Past it the deadline's safe default voids the
    /// hold, and no capture (nor a re-send of one) starts, so a HOUSE that stalled never captures
    /// money the buyer's record says did not move. Recorded once, in the audit chain.
    fn bound_capture(&mut self, id: DealId, now: i64) -> Result<(), Error> {
        let ledger = &mut self.pipeline.wallet.ledger;
        let (Some(signed), Some((due, authorization))) =
            (ledger.settle_signed_at(id)?, ledger.deadline(id)?)
        else {
            return Ok(());
        };
        let capture_by = signed
            .saturating_add(HOUSE_APPROVAL_SECS)
            .saturating_add(HOUSE_RECEIPT_GRACE_SECS)
            .saturating_sub(STEP_SECS + RECEIPT_DELIVERY_SECS);
        if capture_by < due {
            ledger.set_deadline(id, capture_by, authorization, now)?;
        }
        Ok(())
    }
    async fn advance(&mut self, deal: &Deal, now: i64) -> Result<(), Error> {
        if deal.state != DealState::AwaitingApproval {
            self.polls.forget(&deal.id);
        }
        if deal.state.terminal() {
            return Ok(());
        }
        if deal.state == DealState::Authorized {
            self.bound_capture(deal.id, now)?;
        }
        if self
            .pipeline
            .wallet
            .ledger
            .deadline(deal.id)?
            .is_some_and(|d| d.0 <= now)
        {
            self.polls.forget(&deal.id);
            // The default reads an unknown authorize or capture back before it voids or
            // expires, and never voids beside a capture PayPal may have made.
            self.pipeline.deadline_default(deal.id, now).await?;
            return Ok(());
        }
        // A money operation whose PayPal outcome is unknown reaches PayPal's truth before the
        // deal's next step; while one stays unresolved no step runs.
        let current;
        let deal = if self
            .pipeline
            .open_operations(Some(deal.id), now)?
            .is_empty()
        {
            deal
        } else {
            if !self
                .pipeline
                .resolve_deal(deal.id, Resolve::Advance(self.category), now)
                .await?
            {
                return Ok(());
            }
            current = self.pipeline.wallet.ledger.get_deal(deal.id)?;
            &current
        };
        match deal.state {
            DealState::Agreed => {
                self.pipeline
                    .create(deal.id, 1, self.category, Authority::HouseMandate, now)
                    .await?;
            }
            DealState::AwaitingApproval => {
                // Each poll is a permanent ledger row pair, so an unapproved order backs off.
                if self.polls.due(deal.id, deal.state, now) {
                    self.pipeline
                        .wallet
                        .check_mandate(deal.id, self.category, now)?;
                    self.pipeline.poll_approval(deal.id, 1, now).await?;
                }
            }
            DealState::Approved => {
                self.pipeline
                    .authorize(deal.id, 1, self.category, Authority::HouseMandate, now)
                    .await?;
            }
            DealState::Authorized => {
                if deal.shield.is_some_and(|s| s >= ShieldVerdict::Hold) {
                    self.pipeline.auto_void(deal.id, 1, now).await?;
                } else {
                    self.pipeline
                        .capture(deal.id, 1, self.category, Authority::HouseMandate, now)
                        .await?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

type Reply = oneshot::Sender<Result<HouseResponse, Error>>;
#[derive(Debug)]
enum Message {
    Table(HouseRequest, Reply),
    Snapshot(DealId, oneshot::Sender<Result<Deal, Error>>),
}
/// A public prefix read: rows, and where the signed answer goes.
type PrefixAsk = (u64, oneshot::Sender<Result<SignedHousePrefix, Error>>);
#[derive(Clone)]
pub struct HouseHandle {
    tx: mpsc::Sender<Message>,
    /// Prefix reads, on their own bounded queue (see [`PREFIX_QUEUE`]).
    prefixes: mpsc::Sender<PrefixAsk>,
    heartbeat: Arc<AtomicI64>,
    clock: Arc<dyn Clock>,
    timeout: Duration,
    /// The actor's latest published projection and head; the read routes serve only this.
    published: Arc<RwLock<Option<Arc<Published>>>>,
}
impl std::fmt::Debug for HouseHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HouseHandle")
    }
}
impl HouseHandle {
    async fn ask<M, T>(
        &self,
        queue: &mpsc::Sender<M>,
        message: M,
        rx: oneshot::Receiver<Result<T, Error>>,
    ) -> Result<T, Error> {
        queue.try_send(message).map_err(|e| match e {
            mpsc::error::TrySendError::Full(_) => Error::Full,
            mpsc::error::TrySendError::Closed(_) => Error::Unavailable,
        })?;
        tokio::time::timeout(self.timeout, rx)
            .await
            .map_err(|_| Error::Unavailable)?
            .map_err(|_| Error::Unavailable)?
    }
    pub async fn table(&self, request: HouseRequest) -> Result<HouseResponse, Error> {
        let (tx, rx) = oneshot::channel();
        self.ask(&self.tx, Message::Table(request, tx), rx).await
    }
    /// Trusted Rust inspection of one full deal row (PayPal ids included); never served over
    /// HTTP. The public view is [`HouseHandle::published`].
    pub async fn snapshot(&self, id: DealId) -> Result<Deal, Error> {
        let (tx, rx) = oneshot::channel();
        self.ask(&self.tx, Message::Snapshot(id, tx), rx).await
    }
    /// The house's signed chain hash at `rows`, from the published chain (signed by the actor,
    /// which holds the key). Asked on the prefix queue, never the tables queue.
    pub async fn prefix(&self, rows: u64) -> Result<SignedHousePrefix, Error> {
        let (tx, rx) = oneshot::channel();
        self.ask(&self.prefixes, (rows, tx), rx).await
    }
    /// The latest published projection and signed head (T9); `None` before the first refresh.
    pub fn published(&self) -> Option<Arc<Published>> {
        self.published.read().ok().and_then(|p| p.clone())
    }
    /// False when the actor has shown no sign of life for more than [`HEARTBEAT_STALE`] seconds
    /// (stalled or dead).
    pub fn healthy(&self) -> bool {
        self.clock
            .now()
            .saturating_sub(self.heartbeat.load(Ordering::Relaxed))
            <= HEARTBEAT_STALE
    }
}
/// A running HOUSE actor and the means to stop it cleanly.
#[derive(Debug)]
pub struct House {
    pub handle: HouseHandle,
    stop: Arc<Notify>,
    task: tokio::task::JoinHandle<()>,
}
impl House {
    /// Stops taking requests, lets the tick in flight finish, and waits for the actor to exit.
    /// Requests still queued are dropped unanswered, so their callers see 503.
    pub async fn drain(self) {
        self.stop.notify_one();
        let _ = self.task.await;
    }
}
/// Starts the actor with no way to stop it (tests and tools).
pub fn spawn(seller: Seller) -> HouseHandle {
    start(seller).handle
}
/// Starts the actor. Each tick resolves and reports any operation a previous run left pending.
pub fn start(mut seller: Seller) -> House {
    let (tx, mut rx) = mpsc::channel::<Message>(TABLE_QUEUE);
    let (prefixes, mut prefix_rx) = mpsc::channel::<PrefixAsk>(PREFIX_QUEUE);
    let handle = HouseHandle {
        tx,
        prefixes,
        heartbeat: seller.heartbeat.clone(),
        clock: seller.clock.clone(),
        timeout: REPLY_TIMEOUT,
        published: seller.published.clone(),
    };
    let stop = Arc::new(Notify::new());
    let stopped = stop.clone();
    let task = tokio::spawn(async move {
        let published = seller.publish().map(|_| ());
        let _ = seller.noted("publish", None, published);
        let mut timer = tokio::time::interval(Duration::from_secs(TICK_SECS.unsigned_abs()));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            // A stop is seen between ticks, never inside one: a money step is never cut off.
            tokio::select! {
                biased;
                _=stopped.notified()=>break,
                request=rx.recv()=>match request {
                    Some(Message::Table(request,reply))=>{if !reply.is_closed(){let _=reply.send(seller.table(request));}},
                    Some(Message::Snapshot(id,reply))=>{let _=reply.send(seller.pipeline.wallet.ledger.get_deal(id).map_err(Error::from));},
                    None=>break,
                },
                // After the tables queue: a buyer's table is never kept waiting by prefix reads.
                ask=prefix_rx.recv()=>match ask {
                    Some((rows,reply))=>{let _=reply.send(seller.prefix(rows));},
                    None=>break,
                },
                _=timer.tick()=>{
                    // The tick beats the heartbeat and logs each failed step itself.
                    let _=seller.tick().await;
                    // The public projection and head, at most once a minute (T9).
                    let refreshed=seller.refresh();
                    let _=seller.noted("publish",None,refreshed);
                },
            }
        }
    });
    House { handle, stop, task }
}
/// The relay routes without `/healthz`; HOUSE serves its own, tied to the actor heartbeat.
pub fn router(relay: Arc<rendezvous::MemoryStore>, house: HouseHandle) -> Router {
    rendezvous::relay_router(relay).merge(
        Router::new()
            .route("/healthz", get(healthz))
            .route("/v1/house/tables", post(table))
            .route("/v1/house/head", get(crate::routes::head))
            .route("/v1/house/prefix", get(crate::routes::prefix))
            .route("/v1/house/ledger", get(crate::routes::ledger))
            .route("/house", get(crate::routes::scoreboard))
            .route("/house/scoreboard.css", get(crate::routes::scoreboard_css))
            .route("/house/scoreboard.js", get(crate::routes::scoreboard_js))
            .layer(DefaultBodyLimit::max(16384))
            .with_state(house),
    )
}
async fn healthz(State(house): State<HouseHandle>) -> StatusCode {
    if house.healthy() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    }
}
/// Mandate clause 5 (velocity): the signed per-day deal count and total.
pub(crate) const DAILY_LIMIT_CLAUSE: u8 = 5;
async fn table(
    State(house): State<HouseHandle>,
    Json(request): Json<HouseRequest>,
) -> Result<Json<HouseResponse>, Response> {
    house.table(request).await.map(Json).map_err(|e| {
        // A refusal carries one fixed code and no free text: never the mandate's reason.
        let refused = |refusal| {
            (
                StatusCode::BAD_REQUEST,
                Json(table_relay::RefusalBody { refusal }),
            )
                .into_response()
        };
        match e {
            Error::App(table_app::Error::Refused(r)) if r.clause == DAILY_LIMIT_CLAUSE => {
                refused(table_relay::Refusal::DailyLimit)
            }
            Error::Invalid
            | Error::App(
                table_app::Error::Refused(_)
                | table_app::Error::Agent(_)
                | table_app::Error::Permission,
            ) => refused(table_relay::Refusal::Other),
            Error::Full => StatusCode::TOO_MANY_REQUESTS.into_response(),
            _ => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        }
    })
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn six_hour_window_polls_a_few_hundred_times_not_21600() {
        let mut s = PollSchedule::new();
        let polls = (0..6 * 3600).filter(|t| s.due(1u8, 7u8, *t)).count();
        assert_eq!(polls, 363, "was 21600 before the backoff");
    }
    #[test]
    fn backoff_doubles_to_the_cap() {
        let mut s = PollSchedule::new();
        let times: Vec<i64> = (0..400).filter(|t| s.due(1u8, 7u8, *t)).collect();
        assert_eq!(&times[..7], &[0, 5, 15, 35, 75, 135, 195]);
    }
    #[test]
    fn state_change_resets_the_interval() {
        let mut s = PollSchedule::new();
        assert!(s.due(1u8, 1u8, 0));
        assert!(s.due(1u8, 1u8, 5));
        assert!(!s.due(1u8, 1u8, 10));
        assert!(s.due(1u8, 2u8, 10), "new state polls at once");
        assert!(!s.due(1u8, 2u8, 14));
        assert!(s.due(1u8, 2u8, 15), "and starts again at 5 s");
    }
    #[test]
    fn deals_are_scheduled_independently_and_forgotten() {
        let mut s = PollSchedule::new();
        assert!(s.due(1u8, 1u8, 0));
        assert!(s.due(2u8, 1u8, 1));
        assert!(!s.due(1u8, 1u8, 4));
        s.forget(&1);
        s.forget(&2);
        assert_eq!(s.len(), 0);
        assert!(s.due(1u8, 1u8, 4));
    }

    use axum::{body::Body as HttpBody, http::Request};
    use tower::ServiceExt;

    #[derive(Debug)]
    struct Fixed(i64);
    impl Clock for Fixed {
        fn now(&self) -> i64 {
            self.0
        }
    }
    fn handle(timeout: Duration, beat: i64) -> (HouseHandle, mpsc::Receiver<Message>) {
        let (h, rx, _) = handle_with_prefixes(timeout, beat);
        (h, rx)
    }
    fn handle_with_prefixes(
        timeout: Duration,
        beat: i64,
    ) -> (
        HouseHandle,
        mpsc::Receiver<Message>,
        mpsc::Receiver<PrefixAsk>,
    ) {
        let (tx, rx) = mpsc::channel(1);
        let (prefixes, prefix_rx) = mpsc::channel(PREFIX_QUEUE);
        (
            HouseHandle {
                tx,
                prefixes,
                heartbeat: Arc::new(AtomicI64::new(beat)),
                clock: Arc::new(Fixed(100)),
                timeout,
                published: Arc::new(RwLock::new(None)),
            },
            rx,
            prefix_rx,
        )
    }
    fn deal() -> DealId {
        "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap()
    }

    #[tokio::test]
    async fn closed_channel_is_unavailable() {
        let (h, rx) = handle(Duration::from_secs(20), 100);
        drop(rx);
        assert!(matches!(h.snapshot(deal()).await, Err(Error::Unavailable)));
    }
    #[tokio::test]
    async fn full_channel_is_full() {
        let (h, _rx) = handle(Duration::from_millis(200), 100);
        let h2 = h.clone();
        let first = tokio::spawn(async move { h2.snapshot(deal()).await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(matches!(h.snapshot(deal()).await, Err(Error::Full)));
        let _ = first.await;
    }
    /// A flood of public prefix reads fills only the prefix queue: the route answers 429 while the
    /// tables queue stays empty, and a buyer's table request still finds its slot. Before, both
    /// shared the actor's one 4-slot queue, so prefix GETs turned buyers away with 429.
    #[tokio::test]
    async fn prefix_reads_never_take_a_tables_slot() {
        let (h, mut rx, _prefixes) = handle_with_prefixes(Duration::from_millis(20), 100);
        for _ in 0..PREFIX_QUEUE {
            // Queued, unanswered here: each caller gives up at its timeout.
            assert!(matches!(h.prefix(1).await, Err(Error::Unavailable)));
        }
        assert!(matches!(h.prefix(1).await, Err(Error::Full)));
        let store = Arc::new(rendezvous::MemoryStore::new(Arc::new(Fixed(100))));
        let response = router(store, h.clone())
            .oneshot(
                Request::get("/v1/house/prefix?rows=1")
                    .body(HttpBody::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(
            rx.try_recv().is_err(),
            "no prefix read is on the tables queue"
        );
        let buyer = h.clone();
        let ask = tokio::spawn(async move { buyer.snapshot(deal()).await });
        assert!(matches!(rx.recv().await, Some(Message::Snapshot(..))));
        let _ = ask.await;
    }
    #[tokio::test]
    async fn reply_that_never_comes_is_unavailable_after_the_timeout() {
        // The receiver stays open and never answers: a stalled actor.
        let (h, _rx) = handle(Duration::from_millis(50), 100);
        let started = std::time::Instant::now();
        assert!(matches!(h.snapshot(deal()).await, Err(Error::Unavailable)));
        assert!(started.elapsed() >= Duration::from_millis(50));
    }
    #[tokio::test]
    async fn healthz_follows_the_heartbeat() {
        let store = Arc::new(rendezvous::MemoryStore::new(Arc::new(Fixed(100))));
        for (beat, want) in [
            (100, StatusCode::OK),
            (100 - HEARTBEAT_STALE, StatusCode::OK),
            (99 - HEARTBEAT_STALE, StatusCode::SERVICE_UNAVAILABLE),
        ] {
            let (h, _rx) = handle(Duration::from_secs(1), beat);
            let response = router(store.clone(), h)
                .oneshot(Request::get("/healthz").body(HttpBody::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), want, "heartbeat {beat}");
        }
    }
}
