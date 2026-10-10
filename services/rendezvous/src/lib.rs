//! Bounded store-and-forward relay. It has no signing keys or PayPal credentials.
pub mod serve;
use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Extension, Path, Query, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post, put},
};
use serde::Deserialize;
pub use serve::{Caller, Connection, Limits, serve, serve_with, with_timeouts};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use table_core::Clock;
use tokio::sync::{Mutex, Notify, Semaphore};
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("mailbox not found or expired")]
    Missing,
    #[error("invalid relay request")]
    Invalid,
    /// The store, a mailbox or the caller's allowance is full (HTTP 429).
    #[error("relay capacity reached")]
    Full,
}
#[async_trait]
pub trait Mailbox: Send + Sync {
    async fn create(&self, hash: &str) -> Result<(), Error>;
    async fn send(&self, hash: &str, jws: String) -> Result<u64, Error>;
    async fn read(&self, hash: &str, after: u64) -> Result<Vec<String>, Error>;
    async fn remove(&self, hash: &str) -> Result<(), Error>;
}
/// Per-mailbox and whole-store caps on stored message bytes. The count caps alone allow about
/// 1 GiB of strings, which would kill a 512 MB instance (and the co-hosted HOUSE with it).
const MAX_MAILBOX_BYTES: usize = 256 * 1024;
const MAX_TOTAL_BYTES: usize = 64 * 1024 * 1024;
/// A read returns at most this many messages; the caller advances its cursor by what it got.
const READ_PAGE: usize = 32;
/// Live mailboxes in the whole store.
pub const MAX_MAILBOXES: usize = 256;
/// Slots HTTP creates can never take, so the co-hosted HOUSE (which creates in process, through
/// `table_relay::RelayApi`) always has room. HTTP-created mailboxes alone are counted against the
/// remaining `MAX_MAILBOXES - HOUSE_RESERVE`; HOUSE mailboxes count only against the store cap.
/// The HOUSE ledger holds at most 64 live relay routes
/// (`bind_relay` in `table-ledger`), one mailbox each, so 64 slots cover every deal it can have
/// open. A wallet's create of a HOUSE deal's mailbox finds it already made and costs nothing.
pub const HOUSE_RESERVE: usize = 64;
/// Live mailboxes one caller (see [`Caller`]) may have created over HTTP. A wallet creates one
/// mailbox per relay work item (`deliver` in `table-runtime/src/relay.rs`), and its ledger holds
/// at most 64 live relay routes (`bind_relay`); pending pairings add a mailbox each, but a demo
/// pairs a handful of times, far below what a full book of routes leaves unused. Two wallets
/// behind one home NAT address (the two-desktop demo) share one key, so 2 x 64 = 128. That
/// leaves 256 - 64 - 128 = 64 HTTP slots for every other caller while one caller is at its limit,
/// and that holds with the HOUSE full too: its 64 mailboxes are not in the HTTP count, so 192 HTTP
/// plus 64 HOUSE fit the 256 store cap exactly.
pub const CALLER_ALLOWANCE: usize = 128;
#[derive(Debug)]
struct BoxState {
    generation: String,
    expires: i64,
    messages: Vec<Arc<str>>,
    bytes: usize,
    /// Long-polls wait on their own mailbox only; a send elsewhere never wakes them.
    changed: Arc<Notify>,
    /// Who created it over HTTP, charged against that caller's allowance until it expires. None
    /// for an in-process create (the HOUSE), which no allowance counts.
    creator: Option<Caller>,
}
#[derive(Debug, Default)]
struct Inner {
    boxes: BTreeMap<String, BoxState>,
    total_bytes: usize,
}
impl Inner {
    /// Drops expired mailboxes and releases their bytes.
    fn sweep(&mut self, now: i64) {
        let mut released = 0;
        self.boxes.retain(|_, b| {
            let live = b.expires > now;
            if !live {
                released += b.bytes;
            }
            live
        });
        self.total_bytes = self.total_bytes.saturating_sub(released);
    }
}
/// Long-polls held open at once, across both poll routes. A held poll costs a task and a waker, so
/// this bounds that memory; past it a poll answers at once as if `wait=0` and the client re-polls.
pub const MAX_LONG_POLLS: usize = 128;
pub struct MemoryStore {
    inner: Mutex<Inner>,
    clock: Arc<dyn Clock>,
    polls: Semaphore,
}
impl std::fmt::Debug for MemoryStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MemoryMailboxStore")
    }
}
impl MemoryStore {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self::with_poll_limit(clock, MAX_LONG_POLLS)
    }
    /// A store that holds at most `max_polls` long-polls open at once (tests pass a small one).
    pub fn with_poll_limit(clock: Arc<dyn Clock>, max_polls: usize) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            clock,
            polls: Semaphore::new(max_polls),
        }
    }
    async fn waiter(&self, h: &str) -> Arc<Notify> {
        self.inner
            .lock()
            .await
            .boxes
            .get(h)
            .map_or_else(|| Arc::new(Notify::new()), |b| b.changed.clone())
    }
}
fn valid_hash(h: &str) -> bool {
    h.len() == 64
        && h.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
/// One page of a mailbox from `after`: pointer clones only, so the lock is held briefly.
fn page(messages: &[Arc<str>], after: usize) -> Vec<Arc<str>> {
    messages
        .iter()
        .skip(after)
        .take(READ_PAGE)
        .cloned()
        .collect()
}
fn valid_jws(jws: &str) -> bool {
    jws.len() <= 16384
        && jws.split('.').count() == 3
        && jws.split('.').all(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        })
}
impl MemoryStore {
    /// Creates a mailbox for an HTTP caller: refused [`HOUSE_RESERVE`] slots below the store cap,
    /// and once `caller` holds [`CALLER_ALLOWANCE`] live mailboxes. Re-creating one that exists
    /// succeeds and costs nothing; an expired mailbox no longer counts.
    pub async fn create_as(&self, h: &str, caller: Caller) -> Result<(), Error> {
        self.create_by(h, Some(caller)).await
    }
    async fn create_by(&self, h: &str, caller: Option<Caller>) -> Result<(), Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let mut inner = self.inner.lock().await;
        inner.sweep(self.clock.now());
        if inner.boxes.contains_key(h) {
            return Ok(());
        }
        if inner.boxes.len() >= MAX_MAILBOXES {
            return Err(Error::Full);
        }
        if let Some(caller) = caller {
            let held = inner
                .boxes
                .values()
                .filter(|b| b.creator == Some(caller))
                .count();
            // Only HTTP-created mailboxes fill the HTTP share, so live HOUSE mailboxes (which have
            // their own reserve) never cost wallet pairings a slot. The store cap above still
            // refuses every create once all 256 are live.
            let http = inner.boxes.values().filter(|b| b.creator.is_some()).count();
            if http >= MAX_MAILBOXES - HOUSE_RESERVE || held >= CALLER_ALLOWANCE {
                return Err(Error::Full);
            }
        }
        inner.boxes.insert(
            h.into(),
            BoxState {
                generation: {
                    let mut bytes = [0; 16];
                    getrandom::fill(&mut bytes).map_err(|_| Error::Full)?;
                    bytes.iter().map(|b| format!("{b:02x}")).collect()
                },
                expires: self.clock.now().saturating_add(86400),
                messages: Vec::new(),
                bytes: 0,
                changed: Arc::new(Notify::new()),
                creator: caller,
            },
        );
        Ok(())
    }
}
#[async_trait]
impl Mailbox for MemoryStore {
    /// An in-process create: no caller, no allowance, no reserve; only the store cap applies.
    async fn create(&self, h: &str) -> Result<(), Error> {
        self.create_by(h, None).await
    }
    async fn send(&self, h: &str, jws: String) -> Result<u64, Error> {
        if !valid_hash(h) || !valid_jws(&jws) {
            return Err(Error::Invalid);
        }
        let mut inner = self.inner.lock().await;
        inner.sweep(self.clock.now());
        let total = inner.total_bytes;
        let b = inner.boxes.get_mut(h).ok_or(Error::Missing)?;
        // A send is retried byte-for-byte. It must not consume another slot or any budget, so
        // it is answered before the capacity checks (a full mailbox still acknowledges it).
        if let Some(position) = b.messages.iter().position(|s| **s == *jws) {
            return Ok(position as u64 + 1);
        }
        let len = jws.len();
        if b.messages.len() >= 256
            || b.bytes.saturating_add(len) > MAX_MAILBOX_BYTES
            || total.saturating_add(len) > MAX_TOTAL_BYTES
        {
            return Err(Error::Full);
        }
        b.messages.push(jws.into());
        b.bytes += len;
        let index = b.messages.len() as u64;
        let changed = b.changed.clone();
        inner.total_bytes += len;
        drop(inner);
        changed.notify_waiters();
        Ok(index)
    }
    async fn read(&self, h: &str, after: u64) -> Result<Vec<String>, Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let inner = self.inner.lock().await;
        let b = inner
            .boxes
            .get(h)
            .filter(|b| b.expires > self.clock.now())
            .ok_or(Error::Missing)?;
        let after = usize::try_from(after).map_err(|_| Error::Invalid)?;
        if after > b.messages.len() {
            return Err(Error::Invalid);
        }
        let page = page(&b.messages, after);
        drop(inner);
        Ok(page.iter().map(|m| m.to_string()).collect())
    }
    async fn remove(&self, h: &str) -> Result<(), Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let mut inner = self.inner.lock().await;
        let removed = inner.boxes.remove(h);
        if let Some(b) = &removed {
            inner.total_bytes = inner.total_bytes.saturating_sub(b.bytes);
        }
        drop(inner);
        if let Some(b) = removed {
            b.changed.notify_waiters();
        }
        Ok(())
    }
}
impl From<Error> for StatusCode {
    fn from(e: Error) -> Self {
        match e {
            Error::Missing => Self::NOT_FOUND,
            Error::Invalid => Self::BAD_REQUEST,
            Error::Full => Self::TOO_MANY_REQUESTS,
        }
    }
}
pub fn router(store: Arc<MemoryStore>) -> Router {
    relay_router(store).route("/healthz", get(|| async { StatusCode::OK }))
}
/// The mailbox routes alone, for a host that serves its own `/healthz` (HOUSE ties it to its actor).
pub fn relay_router(store: Arc<MemoryStore>) -> Router {
    Router::new()
        // No DELETE: wallets never remove a mailbox, and an unauthenticated delete would let
        // anyone who learns a mailbox hash force a generation reset on both parties.
        .route("/v1/mailbox/{hash}", put(create))
        .route("/v1/mailbox/{hash}/envelopes", post(send).get(read))
        .route("/v1/mailbox/{hash}/sync", get(sync))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(store)
}
/// Co-hosted house uses the same mailbox contract without making loopback HTTP requests.
#[async_trait]
impl table_relay::RelayApi for MemoryStore {
    async fn create(&self, hash: table_core::H256) -> Result<(), table_relay::Error> {
        Mailbox::create(self, &hash.hex())
            .await
            .map_err(|_| table_relay::Error::Unavailable)
    }
    async fn send(&self, hash: table_core::H256, jws: &str) -> Result<(), table_relay::Error> {
        Mailbox::send(self, &hash.hex(), jws.into())
            .await
            .map(|_| ())
            .map_err(|_| table_relay::Error::Unavailable)
    }
    async fn poll(
        &self,
        hash: table_core::H256,
        generation: &str,
        after: u64,
        wait: u8,
    ) -> Result<table_relay::Batch, table_relay::Error> {
        if wait > 25 {
            return Err(table_relay::Error::Invalid);
        }
        self.batch(&hash.hex(), generation, after)
            .await
            .map_err(|_| table_relay::Error::Unavailable)
    }
}
async fn create(
    State(s): State<Arc<MemoryStore>>,
    Path(h): Path<String>,
    connection: Option<Extension<Connection>>,
    headers: HeaderMap,
) -> Result<StatusCode, StatusCode> {
    match connection {
        Some(Extension(connection)) => s.create_as(&h, connection.caller(&headers)?).await?,
        // A request with no connection info comes from a router driven in process (the
        // table-runtime and HOUSE tests call it with `oneshot`), and keeps the plain store cap.
        // Production never gets here: `serve_with` attaches a `Connection` to every request.
        None => s.create(&h).await?,
    }
    Ok(StatusCode::CREATED)
}
async fn send(
    State(s): State<Arc<MemoryStore>>,
    Path(h): Path<String>,
    body: String,
) -> Result<(StatusCode, Json<Index>), StatusCode> {
    let idx = s.send(&h, body).await?;
    Ok((StatusCode::ACCEPTED, Json(Index { idx })))
}
#[derive(Debug, serde::Serialize)]
struct Index {
    idx: u64,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Poll {
    #[serde(default)]
    after: u64,
    #[serde(default)]
    wait: u8,
}
async fn read(
    State(s): State<Arc<MemoryStore>>,
    Path(h): Path<String>,
    Query(q): Query<Poll>,
) -> Result<Json<Vec<String>>, StatusCode> {
    if q.wait > 25 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let waiter = s.waiter(&h).await;
    let notified = waiter.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    let result = s.read(&h, q.after).await?;
    // No free poll slot: answer now with what there is, as if wait=0 (never an error).
    let slot = s.polls.try_acquire();
    if !result.is_empty() || q.wait == 0 || slot.is_err() {
        return Ok(Json(result));
    }
    let _ = tokio::time::timeout(Duration::from_secs(u64::from(q.wait)), notified).await;
    Ok(Json(s.read(&h, q.after).await?))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncPoll {
    #[serde(default)]
    generation: String,
    #[serde(default)]
    after: u64,
    #[serde(default)]
    wait: u8,
}
impl MemoryStore {
    pub async fn batch(
        &self,
        h: &str,
        generation: &str,
        after: u64,
    ) -> Result<table_relay::Batch, Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let inner = self.inner.lock().await;
        let b = inner
            .boxes
            .get(h)
            .filter(|b| b.expires > self.clock.now())
            .ok_or(Error::Missing)?;
        let after = if generation == b.generation { after } else { 0 };
        let offset = usize::try_from(after).map_err(|_| Error::Invalid)?;
        if offset > b.messages.len() {
            return Err(Error::Invalid);
        }
        let generation = b.generation.clone();
        let page = page(&b.messages, offset);
        drop(inner);
        Ok(table_relay::Batch {
            generation,
            after,
            messages: page.iter().map(|m| m.to_string()).collect(),
        })
    }
}
async fn sync(
    State(s): State<Arc<MemoryStore>>,
    Path(h): Path<String>,
    Query(q): Query<SyncPoll>,
) -> Result<Json<table_relay::Batch>, StatusCode> {
    if q.wait > 25 || q.after > 256 || q.generation.len() > 32 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let waiter = s.waiter(&h).await;
    let notified = waiter.notified();
    tokio::pin!(notified);
    notified.as_mut().enable();
    let batch = s.batch(&h, &q.generation, q.after).await?;
    let slot = s.polls.try_acquire();
    if !batch.messages.is_empty()
        || q.wait == 0
        || batch.generation != q.generation
        || slot.is_err()
    {
        return Ok(Json(batch));
    }
    let _ = tokio::time::timeout(Duration::from_secs(u64::from(q.wait)), notified).await;
    Ok(Json(s.batch(&h, &q.generation, q.after).await?))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    #[tokio::test]
    async fn long_polls_share_a_waker_only_within_one_mailbox() {
        let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
        let (a, b) = ("a".repeat(64), "b".repeat(64));
        s.create(&a).await.unwrap();
        s.create(&b).await.unwrap();
        assert!(Arc::ptr_eq(&s.waiter(&a).await, &s.waiter(&a).await));
        assert!(!Arc::ptr_eq(&s.waiter(&a).await, &s.waiter(&b).await));
        let waiter = s.waiter(&a).await;
        let woken = waiter.notified();
        tokio::pin!(woken);
        woken.as_mut().enable();
        s.send(&b, "a.b.c".into()).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(50), woken.as_mut())
                .await
                .is_err()
        );
        s.send(&a, "a.b.c".into()).await.unwrap();
        tokio::time::timeout(Duration::from_millis(50), woken)
            .await
            .unwrap();
    }
}
