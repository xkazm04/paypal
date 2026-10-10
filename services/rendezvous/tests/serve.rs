#![allow(clippy::unwrap_used, clippy::expect_used)]
use axum::{Router, routing::get};
use rendezvous::{Limits, serve_with};
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
};

async fn start(
    limits: Limits,
) -> (
    std::net::SocketAddr,
    oneshot::Sender<()>,
    tokio::task::JoinHandle<std::io::Result<()>>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let (stop, stopped) = oneshot::channel::<()>();
    let app = Router::new().route("/ping", get(|| async { "pong" }));
    let task = tokio::spawn(serve_with(
        listener,
        app,
        async {
            let _ = stopped.await;
        },
        limits,
    ));
    (addr, stop, task)
}
fn limits(max_connections: usize, header_ms: u64) -> Limits {
    Limits {
        max_connections,
        header_read_timeout: Duration::from_millis(header_ms),
        ..Limits::default()
    }
}
const PING: &[u8] = b"GET /ping HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n";

async fn read_all(s: &mut TcpStream) -> String {
    let mut out = Vec::new();
    s.read_to_end(&mut out).await.unwrap();
    String::from_utf8_lossy(&out).into_owned()
}

#[tokio::test]
async fn a_normal_request_is_answered() {
    let (addr, _stop, _task) = start(limits(8, 5000)).await;
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(PING).await.unwrap();
    let reply = read_all(&mut s).await;
    assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
    assert!(reply.ends_with("pong"), "{reply}");
}

#[tokio::test]
async fn a_partial_header_is_closed_after_the_header_timeout() {
    let (addr, _stop, _task) = start(limits(8, 150)).await;
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(b"GET /ping HTTP/1.1\r\nhost: x\r\n")
        .await
        .unwrap();
    let started = std::time::Instant::now();
    // Never finishes the head: the server must close, so the read ends instead of hanging.
    let closed = tokio::time::timeout(Duration::from_secs(5), read_all(&mut s)).await;
    assert!(closed.is_ok(), "server kept a half-sent header open");
    assert!(started.elapsed() >= Duration::from_millis(100));
}

#[tokio::test]
async fn the_connection_limit_holds_and_frees_on_close() {
    let (addr, _stop, _task) = start(limits(1, 5000)).await;
    // The first connection holds the only permit by staying open and idle.
    let first = TcpStream::connect(addr).await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    // The kernel accepts the second into the backlog, but it is not served.
    let mut second = TcpStream::connect(addr).await.unwrap();
    second.write_all(PING).await.unwrap();
    let mut buf = [0u8; 16];
    let waited = tokio::time::timeout(Duration::from_millis(400), second.read(&mut buf)).await;
    assert!(
        waited.is_err(),
        "second connection was served over the limit"
    );
    // Closing the first frees the permit and the waiting one is answered.
    drop(first);
    let reply = tokio::time::timeout(Duration::from_secs(5), read_all(&mut second))
        .await
        .unwrap();
    assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
}

#[tokio::test]
async fn shutdown_stops_accepting_and_returns() {
    let (addr, stop, task) = start(limits(8, 5000)).await;
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(PING).await.unwrap();
    assert!(read_all(&mut s).await.starts_with("HTTP/1.1 200"));
    stop.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
}

async fn start_app(app: Router, limits: Limits) -> std::net::SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(serve_with(listener, app, std::future::pending(), limits));
    addr
}

#[tokio::test]
async fn a_body_trickled_past_the_timeout_is_refused() {
    let app = Router::new().route(
        "/up",
        axum::routing::post(|body: String| async move { body }),
    );
    let addr = start_app(
        app,
        Limits {
            request_body_timeout: Duration::from_millis(200),
            ..Limits::default()
        },
    )
    .await;
    let mut s = TcpStream::connect(addr).await.unwrap();
    // Promises 100 bytes, sends 3, then stalls past the body timeout.
    s.write_all(b"POST /up HTTP/1.1\r\nhost: x\r\ncontent-length: 100\r\n\r\nabc")
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(5), async {
        let mut buf = vec![0u8; 512];
        let n = s.read(&mut buf).await.unwrap();
        String::from_utf8_lossy(&buf[..n]).into_owned()
    })
    .await
    .expect("stalled body was never answered");
    assert!(
        reply.starts_with("HTTP/1.1 400") || reply.starts_with("HTTP/1.1 408"),
        "{reply}"
    );
}

#[tokio::test]
async fn a_request_over_the_whole_timeout_answers_408() {
    let app = Router::new().route(
        "/slow",
        get(|| async {
            tokio::time::sleep(Duration::from_secs(5)).await;
            "late"
        }),
    );
    let addr = start_app(
        app,
        Limits {
            request_timeout: Duration::from_millis(200),
            ..Limits::default()
        },
    )
    .await;
    let mut s = TcpStream::connect(addr).await.unwrap();
    s.write_all(b"GET /slow HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n")
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(3), read_all(&mut s))
        .await
        .unwrap();
    assert!(reply.starts_with("HTTP/1.1 408"), "{reply}");
}

#[tokio::test(start_paused = true)]
async fn a_long_poll_of_25_seconds_still_answers_under_the_default_limits() {
    use rendezvous::{MemoryStore, relay_router};
    use std::sync::Arc;
    let store = Arc::new(MemoryStore::new(Arc::new(table_core::FixedClock(0))));
    let h = "c".repeat(64);
    let app = relay_router(store);
    let app = rendezvous::with_timeouts(app, &Limits::default());
    use tower::ServiceExt;
    let make = |method: &str, uri: String| {
        axum::http::Request::builder()
            .method(method)
            .uri(uri)
            .body(axum::body::Body::empty())
            .unwrap()
    };
    let created = app
        .clone()
        .oneshot(make("PUT", format!("/v1/mailbox/{h}")))
        .await
        .unwrap();
    assert_eq!(created.status(), 201);
    // The paused clock auto-advances through the idle wait: 25 s passes with the empty answer.
    let polled = app
        .oneshot(make(
            "GET",
            format!("/v1/mailbox/{h}/envelopes?after=0&wait=25"),
        ))
        .await
        .unwrap();
    assert_eq!(polled.status(), 200);
}

#[tokio::test(start_paused = true)]
async fn long_polls_past_the_permit_limit_answer_at_once_and_permits_come_back() {
    use rendezvous::{MemoryStore, relay_router};
    use std::sync::Arc;
    use tower::ServiceExt;
    let store = Arc::new(MemoryStore::with_poll_limit(
        Arc::new(table_core::FixedClock(0)),
        1,
    ));
    let app = relay_router(store);
    let h = "d".repeat(64);
    let get = |uri: String| {
        axum::http::Request::builder()
            .uri(uri)
            .body(axum::body::Body::empty())
            .unwrap()
    };
    let put = axum::http::Request::builder()
        .method("PUT")
        .uri(format!("/v1/mailbox/{h}"))
        .body(axum::body::Body::empty())
        .unwrap();
    assert_eq!(app.clone().oneshot(put).await.unwrap().status(), 201);
    // sync only waits when the caller already holds the box's current generation.
    let probe = app
        .clone()
        .oneshot(get(format!("/v1/mailbox/{h}/sync?after=0")))
        .await
        .unwrap();
    let probe: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(probe.into_body(), 1 << 16)
            .await
            .unwrap(),
    )
    .unwrap();
    let generation = probe["generation"].as_str().unwrap().to_string();
    let sync = format!("sync?after=0&generation={generation}");
    for route in ["envelopes?after=0", sync.as_str()] {
        let uri = format!("/v1/mailbox/{h}/{route}&wait=25");
        // The first poll takes the only permit and waits.
        let first = tokio::spawn(app.clone().oneshot(get(uri.clone())));
        tokio::time::sleep(Duration::from_millis(10)).await;
        // The second finds none free and answers now, with the current (empty) content.
        let before = tokio::time::Instant::now();
        let second = app.clone().oneshot(get(uri.clone())).await.unwrap();
        assert_eq!(second.status(), 200);
        assert!(before.elapsed() < Duration::from_secs(1));
        // The first ends at its 25 s wait, and its permit is back for the next poll.
        assert_eq!(first.await.unwrap().unwrap().status(), 200);
        let again = tokio::time::Instant::now();
        let third = app.clone().oneshot(get(uri)).await.unwrap();
        assert_eq!(third.status(), 200);
        assert!(again.elapsed() >= Duration::from_secs(25));
    }
}

/// An app that answers with the caller key `serve_with` attached, as text.
fn who() -> Router {
    Router::new().route(
        "/who",
        get(
            |axum::Extension(c): axum::Extension<rendezvous::Connection>,
             headers: axum::http::HeaderMap| async move {
                c.caller(&headers).ip().to_string()
            },
        ),
    )
}
fn hops(trusted_proxy_hops: usize) -> Limits {
    Limits {
        trusted_proxy_hops,
        ..Limits::default()
    }
}
/// Sends one request with `headers` (each a full `name: value` line) and returns the reply.
async fn request(addr: std::net::SocketAddr, head: &str, headers: &[&str]) -> String {
    let mut s = TcpStream::connect(addr).await.unwrap();
    let mut text = format!("{head} HTTP/1.1\r\nhost: x\r\nconnection: close\r\n");
    for h in headers {
        text.push_str(h);
        text.push_str("\r\n");
    }
    text.push_str("content-length: 0\r\n\r\n");
    s.write_all(text.as_bytes()).await.unwrap();
    read_all(&mut s).await
}
async fn caller_of(addr: std::net::SocketAddr, headers: &[&str]) -> String {
    let reply = request(addr, "GET /who", headers).await;
    assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
    reply.rsplit("\r\n").next().unwrap().to_string()
}

#[tokio::test]
async fn with_no_trusted_proxy_a_forged_forwarded_for_does_not_change_the_caller() {
    let addr = start_app(who(), hops(0)).await;
    assert_eq!(caller_of(addr, &[]).await, "127.0.0.1");
    assert_eq!(
        caller_of(addr, &["x-forwarded-for: 203.0.113.9"]).await,
        "127.0.0.1"
    );
    assert_eq!(
        caller_of(addr, &["x-forwarded-for: 203.0.113.9, 198.51.100.4"]).await,
        "127.0.0.1"
    );
}

#[tokio::test]
async fn behind_one_proxy_the_rightmost_forwarded_for_entry_is_the_caller() {
    let addr = start_app(who(), hops(1)).await;
    // The client wrote the left entry; the proxy appended the right one.
    assert_eq!(
        caller_of(addr, &["x-forwarded-for: 203.0.113.9, 198.51.100.4"]).await,
        "198.51.100.4"
    );
    // Repeated headers are one list in order: the last entry of the last header.
    assert_eq!(
        caller_of(
            addr,
            &[
                "x-forwarded-for: 203.0.113.9",
                "x-forwarded-for: 198.51.100.4"
            ]
        )
        .await,
        "198.51.100.4"
    );
    // No header, or an unreadable proxy entry: the TCP peer, never a client entry.
    assert_eq!(caller_of(addr, &[]).await, "127.0.0.1");
    assert_eq!(
        caller_of(addr, &["x-forwarded-for: 203.0.113.9, nonsense"]).await,
        "127.0.0.1"
    );
}

#[tokio::test]
async fn two_ipv6_addresses_in_one_slash_64_share_a_caller() {
    let addr = start_app(who(), hops(1)).await;
    let one = caller_of(addr, &["x-forwarded-for: 2001:db8:1:2::a"]).await;
    let two = caller_of(addr, &["x-forwarded-for: [2001:db8:1:2:ffff::1]:443"]).await;
    let other = caller_of(addr, &["x-forwarded-for: 2001:db8:1:3::a"]).await;
    assert_eq!(one, "2001:db8:1:2::");
    assert_eq!(one, two);
    assert_ne!(one, other);
}

#[tokio::test]
async fn over_a_socket_one_caller_is_refused_past_its_allowance_and_forging_does_not_help() {
    use rendezvous::{CALLER_ALLOWANCE, MemoryStore, relay_router};
    use std::sync::Arc;
    let put = |n: usize| format!("PUT /v1/mailbox/{n:064x}");
    let status = |reply: String| reply[9..12].to_string();
    // Behind one proxy: the proxy-appended entry is the key.
    let store = Arc::new(MemoryStore::new(Arc::new(table_core::FixedClock(0))));
    let addr = start_app(relay_router(store), hops(1)).await;
    let me = "x-forwarded-for: 198.51.100.1";
    for n in 0..CALLER_ALLOWANCE {
        assert_eq!(status(request(addr, &put(n), &[me]).await), "201");
    }
    assert_eq!(
        status(request(addr, &put(CALLER_ALLOWANCE), &[me]).await),
        "429"
    );
    // Re-creating one of its own still answers 201.
    assert_eq!(status(request(addr, &put(0), &[me]).await), "201");
    // A client-written entry to the left of the proxy's changes nothing.
    let forged = "x-forwarded-for: 203.0.113.9, 198.51.100.1";
    assert_eq!(status(request(addr, &put(9000), &[forged]).await), "429");
    let other = "x-forwarded-for: 198.51.100.2";
    assert_eq!(status(request(addr, &put(9000), &[other]).await), "201");
    // With no trusted proxy, a client rotating forged headers is still one caller.
    let store = Arc::new(MemoryStore::new(Arc::new(table_core::FixedClock(0))));
    let addr = start_app(relay_router(store), hops(0)).await;
    for n in 0..CALLER_ALLOWANCE {
        let forged = format!("x-forwarded-for: 203.0.{}.{}", n / 256, n % 256);
        assert_eq!(status(request(addr, &put(n), &[&forged]).await), "201");
    }
    let forged = "x-forwarded-for: 192.0.2.77";
    assert_eq!(
        status(request(addr, &put(CALLER_ALLOWANCE), &[forged]).await),
        "429"
    );
}
