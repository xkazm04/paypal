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
