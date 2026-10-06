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
#[derive(Debug)]
struct BoxState {
    generation: String,
    expires: i64,
    messages: Vec<String>,
    /// Long-polls wait on their own mailbox only; a send elsewhere never wakes them.
    changed: Arc<Notify>,
}
pub struct MemoryStore {
    boxes: Mutex<BTreeMap<String, BoxState>>,
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
            boxes: Mutex::new(BTreeMap::new()),
            clock,
        }
    }
    async fn waiter(&self, h: &str) -> Arc<Notify> {
        self.boxes
            .lock()
            .await
            .get(h)
            .map_or_else(|| Arc::new(Notify::new()), |b| b.changed.clone())
    }
}
fn valid_hash(h: &str) -> bool {
    h.len() == 64
        && h.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
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
        let mut boxes = self.boxes.lock().await;
        boxes.retain(|_, b| b.expires > self.clock.now());
        if boxes.contains_key(h) {
            return Ok(());
        }
        if boxes.len() >= 256 {
            return Err(Error::Full);
        }
        boxes.insert(
            h.into(),
            BoxState {
                generation: {
                    let mut bytes = [0; 16];
                    getrandom::fill(&mut bytes).map_err(|_| Error::Full)?;
                    bytes.iter().map(|b| format!("{b:02x}")).collect()
                },
                expires: self.clock.now().saturating_add(86400),
                messages: Vec::new(),
                changed: Arc::new(Notify::new()),
            },
        );
        Ok(())
    }
    async fn send(&self, h: &str, jws: String) -> Result<u64, Error> {
        if !valid_hash(h) || !valid_jws(&jws) {
            return Err(Error::Invalid);
        }
        let mut boxes = self.boxes.lock().await;
        let b = boxes
            .get_mut(h)
            .filter(|b| b.expires > self.clock.now())
            .ok_or(Error::Missing)?;
        // An unknown send is retried byte-for-byte. It must not consume another slot.
        if let Some(position) = b.messages.iter().position(|s| s == &jws) {
            return Ok(position as u64 + 1);
        }
        if b.messages.len() >= 256 {
            return Err(Error::Full);
        }
        b.messages.push(jws);
        let index = b.messages.len() as u64;
        let changed = b.changed.clone();
        drop(boxes);
        changed.notify_waiters();
        Ok(index)
    }
    async fn read(&self, h: &str, after: u64) -> Result<Vec<String>, Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let boxes = self.boxes.lock().await;
        let b = boxes
            .get(h)
            .filter(|b| b.expires > self.clock.now())
            .ok_or(Error::Missing)?;
        let after = usize::try_from(after).map_err(|_| Error::Invalid)?;
        if after > b.messages.len() {
            return Err(Error::Invalid);
        }
        Ok(b.messages[after..].to_vec())
    }
    async fn remove(&self, h: &str) -> Result<(), Error> {
        if !valid_hash(h) {
            return Err(Error::Invalid);
        }
        let removed = self.boxes.lock().await.remove(h);
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
        let boxes = self.boxes.lock().await;
        let b = boxes
            .get(h)
            .filter(|b| b.expires > self.clock.now())
            .ok_or(Error::Missing)?;
        let after = if generation == b.generation { after } else { 0 };
        let offset = usize::try_from(after).map_err(|_| Error::Invalid)?;
        if offset > b.messages.len() {
            return Err(Error::Invalid);
        }
        Ok(table_relay::Batch {
            generation: b.generation.clone(),
            after,
            messages: b.messages[offset..].to_vec(),
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
