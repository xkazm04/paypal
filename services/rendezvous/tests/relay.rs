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
