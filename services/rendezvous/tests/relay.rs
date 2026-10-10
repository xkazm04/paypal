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
#[tokio::test]
async fn reads_are_paged_and_the_cursor_recovers_every_message_in_order() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let h = hash(9);
    s.create(&h).await.unwrap();
    let sent: Vec<String> = (0..100).map(|n| jws(n, 100)).collect();
    for m in &sent {
        s.send(&h, m.clone()).await.unwrap();
    }
    let generation = s.batch(&h, "", 0).await.unwrap().generation;
    let (mut got, mut via_batch) = (vec![], vec![]);
    loop {
        let page = s.read(&h, got.len() as u64).await.unwrap();
        assert!(page.len() <= 32);
        if page.is_empty() {
            break;
        }
        got.extend(page);
    }
    loop {
        let batch = s
            .batch(&h, &generation, via_batch.len() as u64)
            .await
            .unwrap();
        assert!(batch.messages.len() <= 32);
        assert_eq!(batch.after, via_batch.len() as u64);
        if batch.messages.is_empty() {
            break;
        }
        via_batch.extend(batch.messages);
    }
    assert_eq!(got, sent);
    assert_eq!(via_batch, sent);
}
fn caller(ip: &str) -> Caller {
    Caller::from_ip(ip.parse().unwrap())
}
/// The HOUSE's path: an in-process create through the wallet-facing relay contract.
async fn house_create(s: &MemoryStore, n: usize) -> Result<(), table_relay::Error> {
    table_relay::RelayApi::create(s, table_core::H256::digest(format!("house {n}").as_bytes()))
        .await
}
#[tokio::test]
async fn one_caller_uses_up_its_allowance_and_a_second_caller_and_the_house_still_create() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let (a, b) = (caller("198.51.100.1"), caller("198.51.100.2"));
    for n in 0..CALLER_ALLOWANCE {
        s.create_as(&hash(n), a).await.unwrap();
    }
    assert!(matches!(
        s.create_as(&hash(CALLER_ALLOWANCE), a).await,
        Err(Error::Full)
    ));
    // A fresh pair mailbox from someone else, and the HOUSE's own create, still succeed.
    s.create_as(&hash(1000), b).await.unwrap();
    house_create(&s, 0).await.unwrap();
}
#[tokio::test]
async fn many_callers_filling_the_http_share_leave_the_house_reserve() {
    let s = MemoryStore::new(Arc::new(table_core::FixedClock(0)));
    let share = MAX_MAILBOXES - HOUSE_RESERVE;
    for n in 0..share {
        s.create_as(&hash(n), caller(&format!("10.0.{}.{}", n / 256, n % 256)))
            .await
            .unwrap();
    }
    assert!(matches!(
        s.create_as(&hash(share), caller("192.0.2.1")).await,
        Err(Error::Full)
    ));
    for n in 0..HOUSE_RESERVE {
        house_create(&s, n).await.unwrap();
    }
    // The store cap still holds for the HOUSE too.
    assert!(house_create(&s, HOUSE_RESERVE).await.is_err());
}
#[tokio::test]
async fn re_creating_a_mailbox_costs_nothing_and_expiry_releases_the_allowance() {
    let clock = Arc::new(Time(AtomicI64::new(0)));
    let s = MemoryStore::new(clock.clone());
    let (a, b, c) = (
        caller("198.51.100.1"),
        caller("198.51.100.2"),
        caller("198.51.100.3"),
    );
    // b reaches its allowance, then a fills the rest of the HTTP share.
    for n in 0..CALLER_ALLOWANCE {
        s.create_as(&hash(n), b).await.unwrap();
    }
    assert!(matches!(s.create_as(&hash(500), b).await, Err(Error::Full)));
    let rest = MAX_MAILBOXES - HOUSE_RESERVE - CALLER_ALLOWANCE;
    for n in 0..rest {
        s.create_as(&hash(1000 + n), a).await.unwrap();
    }
    assert!(matches!(s.create_as(&hash(501), a).await, Err(Error::Full)));
    assert!(matches!(s.create_as(&hash(502), c).await, Err(Error::Full)));
    // Re-creating what exists still succeeds for everyone, even at a limit: nothing is added.
    s.create_as(&hash(1000), a).await.unwrap();
    s.create_as(&hash(1000), b).await.unwrap();
    s.create_as(&hash(0), c).await.unwrap();
    s.create(&hash(0)).await.unwrap();
    // A day later every mailbox has expired and the whole allowance is free again.
    clock.0.store(86400, Ordering::SeqCst);
    for n in 0..CALLER_ALLOWANCE {
        s.create_as(&hash(5000 + n), b).await.unwrap();
    }
    assert!(matches!(
        s.create_as(&hash(9999), b).await,
        Err(Error::Full)
    ));
    s.create_as(&hash(9999), a).await.unwrap();
}
#[test]
fn an_ipv6_caller_is_its_slash_64_and_an_ipv4_mapped_one_is_its_ipv4() {
    assert_eq!(caller("2001:db8:1:2::a"), caller("2001:db8:1:2:ffff:1:2:3"));
    assert_ne!(caller("2001:db8:1:2::a"), caller("2001:db8:1:3::a"));
    assert_eq!(caller("2001:db8:1:2::a").ip().to_string(), "2001:db8:1:2::");
    assert_eq!(caller("::ffff:198.51.100.1"), caller("198.51.100.1"));
    assert_ne!(caller("198.51.100.1"), caller("198.51.100.2"));
}
#[test]
fn the_proxy_hop_setting_is_a_small_whole_number_or_startup_fails() {
    use rendezvous::serve::proxy_hops;
    assert_eq!(proxy_hops(None).unwrap(), 0);
    assert_eq!(proxy_hops(Some("")).unwrap(), 0);
    assert_eq!(proxy_hops(Some(" 1 ")).unwrap(), 1);
    assert_eq!(proxy_hops(Some("8")).unwrap(), 8);
    for bad in ["one", "-1", "1.0", "9", "true"] {
        assert!(proxy_hops(Some(bad)).is_err(), "{bad}");
    }
}
