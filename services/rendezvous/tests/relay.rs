#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use rendezvous::*;
use std::sync::{
    Arc,
    atomic::{AtomicI64, Ordering},
};
use table_core::Clock;
use tower::ServiceExt;
#[derive(Debug)]
struct Time(AtomicI64);
impl Clock for Time {
    fn now(&self) -> i64 {
        self.0.load(Ordering::SeqCst)
    }
}
#[tokio::test]
async fn mailbox_ttl_cursor_size_and_no_parsing_or_keys() {
    let clock = Arc::new(Time(AtomicI64::new(0)));
    let s = MemoryStore::new(clock.clone());
    let h = "a".repeat(64);
    s.create(&h).await.unwrap();
    assert_eq!(s.send(&h, "aaa.bbb.ccc".into()).await.unwrap(), 1);
    assert_eq!(s.read(&h, 0).await.unwrap(), vec!["aaa.bbb.ccc"]);
    assert!(s.read(&h, 1).await.unwrap().is_empty());
    assert!(s.read(&h, 2).await.is_err());
    assert!(s.send(&h, "bad".into()).await.is_err());
    assert!(s.send(&h, "x".repeat(16385)).await.is_err());
    clock.0.store(86400, Ordering::SeqCst);
    assert!(s.read(&h, 0).await.is_err());
    s.create(&h).await.unwrap();
    assert!(s.read(&h, 0).await.unwrap().is_empty());
    s.remove(&h).await.unwrap();
    assert!(s.read(&h, 0).await.is_err());
}
#[tokio::test]
async fn relay_only_http_contract_has_no_house_authority() {
    let s = Arc::new(MemoryStore::new(Arc::new(table_core::FixedClock(0))));
    let app = router(s);
    let h = "b".repeat(64);
    for (method, path, body, expected) in [
        ("PUT", format!("/v1/mailbox/{h}"), "", StatusCode::CREATED),
        (
            "POST",
            format!("/v1/mailbox/{h}/envelopes"),
            "aaa.bbb.ccc",
            StatusCode::ACCEPTED,
        ),
        (
            "GET",
            format!("/v1/mailbox/{h}/envelopes?after=0&wait=0"),
            "",
            StatusCode::OK,
        ),
        ("POST", "/v1/house/tables".into(), "", StatusCode::NOT_FOUND),
        (
            "DELETE",
            format!("/v1/mailbox/{h}"),
            "",
            StatusCode::METHOD_NOT_ALLOWED,
        ),
    ] {
        let r = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(r.status(), expected);
        if method == "GET" {
            assert_eq!(
                &to_bytes(r.into_body(), 65536).await.unwrap()[..],
                br#"["aaa.bbb.ccc"]"#
            );
        }
    }
}
#[tokio::test]
async fn sync_generation_reset_and_send_retry_do_not_lose_or_duplicate_messages() {
    let store = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let hash = "c".repeat(64);
    store.create(&hash).await.unwrap();
    let original = store.batch(&hash, "", 0).await.unwrap();
    assert_eq!(store.send(&hash, "a.b.c".into()).await.unwrap(), 1);
    assert_eq!(store.send(&hash, "a.b.c".into()).await.unwrap(), 1);
    assert_eq!(
        store
            .batch(&hash, &original.generation, 0)
            .await
            .unwrap()
            .messages
            .len(),
        1
    );
    store.remove(&hash).await.unwrap();
    store.create(&hash).await.unwrap();
    let reset = store.batch(&hash, &original.generation, 1).await.unwrap();
    assert_ne!(reset.generation, original.generation);
    assert_eq!(reset.after, 0);
}
/// A valid 3-part JWS of exactly `len` (>= 9) bytes, distinct per `n`.
fn jws(n: usize, len: usize) -> String {
    let head = format!("a.b.{n:04x}");
    format!("{head}{}", "c".repeat(len - head.len()))
}
fn hash(n: usize) -> String {
    format!("{n:064x}")
}
const FULL: usize = 16384;
#[tokio::test]
async fn per_mailbox_byte_budget_accepts_the_boundary_and_refuses_past_it() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let (a, b) = (hash(1), hash(2));
    s.create(&a).await.unwrap();
    s.create(&b).await.unwrap();
    // Exactly 256 KiB is accepted; the next message is refused.
    for n in 0..16 {
        s.send(&a, jws(n, FULL)).await.unwrap();
    }
    assert!(matches!(s.send(&a, jws(16, 9)).await, Err(Error::Full)));
    // Just under: 256 KiB - 1 accepted, one more minimal message hits the boundary, then refused.
    for n in 0..15 {
        s.send(&b, jws(n, FULL)).await.unwrap();
    }
    s.send(&b, jws(15, FULL - 9)).await.unwrap();
    s.send(&b, jws(16, 9)).await.unwrap();
    assert!(matches!(s.send(&b, jws(17, 9)).await, Err(Error::Full)));
}
/// 256 boxes x 256 KiB is exactly the 64 MiB total, so the global budget is the last line
/// behind the box-count and per-box caps: once the store is full every mailbox refuses.
async fn fill(s: &MemoryStore) {
    for b in 0..256 {
        let h = hash(b);
        s.create(&h).await.unwrap();
        for n in 0..16 {
            s.send(&h, jws(n, FULL)).await.unwrap();
        }
    }
}
#[tokio::test]
async fn global_byte_budget_refuses_across_many_mailboxes() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    fill(&s).await;
    for b in [0, 100, 255] {
        assert!(matches!(
            s.send(&hash(b), jws(1000, 9)).await,
            Err(Error::Full)
        ));
    }
}
#[tokio::test]
async fn expired_mailbox_releases_its_bytes() {
    let clock = Arc::new(Time(AtomicI64::new(0)));
    let s = MemoryStore::new(clock.clone());
    fill(&s).await;
    clock.0.store(86400, Ordering::SeqCst);
    // The sweep inside send drops every expired box (the old one is gone, not Full).
    assert!(matches!(
        s.send(&hash(0), jws(1, FULL)).await,
        Err(Error::Missing)
    ));
    // Its bytes were released: a fresh mailbox takes a full 256 KiB again.
    let fresh = hash(999);
    s.create(&fresh).await.unwrap();
    for n in 0..16 {
        s.send(&fresh, jws(n, FULL)).await.unwrap();
    }
}
#[tokio::test]
async fn identical_resend_keeps_its_sequence_number_even_when_full() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let h = hash(7);
    s.create(&h).await.unwrap();
    for n in 0..16 {
        assert_eq!(s.send(&h, jws(n, FULL)).await.unwrap(), n as u64 + 1);
    }
    assert_eq!(s.send(&h, jws(3, FULL)).await.unwrap(), 4);
    assert!(matches!(s.send(&h, jws(50, 9)).await, Err(Error::Full)));
}
