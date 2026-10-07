//! Bounded store-and-forward relay. It has no signing keys or PayPal credentials.
use async_trait::async_trait;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Query, State},
    http::StatusCode,
    routing::{get, post, put},
};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use table_core::Clock;
use tokio::sync::{Mutex, Notify};
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("mailbox not found or expired")]
    Missing,
    #[error("invalid relay request")]
    Invalid,
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
#[derive(Debug)]
struct BoxState {
    generation: String,
    expires: i64,
    messages: Vec<Arc<str>>,
    bytes: usize,
    /// Long-polls wait on their own mailbox only; a send elsewhere never wakes them.
    changed: Arc<Notify>,
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
pub struct MemoryStore {
    inner: Mutex<Inner>,
    clock: Arc<dyn Clock>,
}
impl std::fmt::Debug for MemoryStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MemoryMailboxStore")
    }
}
impl MemoryStore {
    pub fn new(clock: Arc<dyn Clock>) -> Self {
        Self {
            inner: Mutex::new(Inner::default()),
            clock,
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
#[async_trait]
impl Mailbox for MemoryStore {
    async fn create(&self, h: &str) -> Result<(), Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let mut inner = self.inner.lock().await;
        inner.sweep(self.clock.now());
        if inner.boxes.contains_key(h) {
            return Ok(());
        }
        if inner.boxes.len() >= 256 {
            return Err(Error::Full);
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
            },
        );
        Ok(())
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
    Router::new()
        .route("/healthz", get(|| async { StatusCode::OK }))
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
) -> Result<StatusCode, StatusCode> {
    s.create(&h).await?;
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
    if !result.is_empty() || q.wait == 0 {
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
    if !batch.messages.is_empty() || q.wait == 0 || batch.generation != q.generation {
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
