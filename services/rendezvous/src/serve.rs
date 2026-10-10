//! The one HTTP server loop of the public relay and the HOUSE. `axum::serve` has no header-read
//! timeout and no connection limit, so a few hundred idle sockets could starve a 512 MB instance
//! (scan-2026-10-07 C-6). Every bound is a named constant; tests pass smaller ones in [`Limits`].
use axum::{
    Router,
    http::{HeaderMap, StatusCode},
};
use hyper::{body::Incoming, service::Service as _};
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    server::graceful::GracefulShutdown,
    service::TowerToHyperService,
};
use std::{
    future::Future,
    net::{IpAddr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{net::TcpListener, sync::Semaphore};
use tower_http::timeout::{RequestBodyTimeoutLayer, TimeoutLayer};

/// Open connections at once; the rest wait in the kernel backlog. Far above real load (a few
/// wallets long-polling), well below the file-descriptor and memory limits of the host.
pub const MAX_CONNECTIONS: usize = 512;
/// A client has this long to send a full request head; stops slow-loris sockets.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);
/// Each body chunk must arrive within this; bodies are at most 16 KiB, so a stall is hostile.
pub const REQUEST_BODY_TIMEOUT: Duration = Duration::from_secs(10);
/// The whole request, handler included. Above the 25 s long-poll cap and the HOUSE's 20 s actor
/// reply timeout, so no legitimate request is cut short.
pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
/// How many reverse proxies sit in front of the relay, read once by [`serve`]. Unset or empty
/// means none: the caller is the TCP peer and `X-Forwarded-For` is ignored.
// UNVERIFIED: the root render.yaml sets this to 1, assuming Render puts exactly one proxy in front
// of a web service and that the proxy appends the client's address as the rightmost
// `X-Forwarded-For` entry. Nothing in .research documents Render's forwarding behaviour.
pub const TRUSTED_PROXY_HOPS_VAR: &str = "RELAY_TRUSTED_PROXY_HOPS";
/// More hops than any real deployment has; a larger value is a typo, not a topology.
pub const MAX_TRUSTED_PROXY_HOPS: usize = 8;

/// The bounds [`serve_with`] enforces. [`Default`] is the production set.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_connections: usize,
    pub header_read_timeout: Duration,
    pub request_body_timeout: Duration,
    pub request_timeout: Duration,
    /// Reverse proxies in front of the relay (see [`TRUSTED_PROXY_HOPS_VAR`]). Zero trusts no
    /// forwarding header.
    pub trusted_proxy_hops: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_connections: MAX_CONNECTIONS,
            header_read_timeout: HEADER_READ_TIMEOUT,
            request_body_timeout: REQUEST_BODY_TIMEOUT,
            request_timeout: REQUEST_TIMEOUT,
            trusted_proxy_hops: 0,
        }
    }
}

/// Serve `app` with the production [`Limits`] until `shutdown` resolves: then no new connection
/// is accepted and those in flight finish before this returns. The proxy hop count comes from
/// [`TRUSTED_PROXY_HOPS_VAR`]; a value that does not parse stops startup (see [`proxy_hops`]).
pub async fn serve<F>(listener: TcpListener, app: Router, shutdown: F) -> std::io::Result<()>
where
    F: Future<Output = ()>,
{
    let trusted_proxy_hops = proxy_hops(std::env::var(TRUSTED_PROXY_HOPS_VAR).ok().as_deref())?;
    let limits = Limits {
        trusted_proxy_hops,
        ..Limits::default()
    };
    serve_with(listener, app, shutdown, limits).await
}

/// Reads the proxy hop setting. Unset or empty is zero. Anything else must be a whole number up to
/// [`MAX_TRUSTED_PROXY_HOPS`], or startup fails. Falling back to zero would key every caller on the
/// proxy's address, so the first client to reach its mailbox allowance would lock out everyone
/// else, quietly; falling back to trusting the header would let any client pick its own key. A
/// failed start is loud: the platform keeps the previous deploy and shows the error.
pub fn proxy_hops(value: Option<&str>) -> std::io::Result<usize> {
    let value = value.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        return Ok(0);
    }
    value
        .parse::<usize>()
        .ok()
        .filter(|hops| *hops <= MAX_TRUSTED_PROXY_HOPS)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                format!(
                    "{TRUSTED_PROXY_HOPS_VAR} must be a whole number from 0 to {MAX_TRUSTED_PROXY_HOPS}"
                ),
            )
        })
}

/// What [`serve_with`] knows about the connection a request came in on. It is attached to every
/// request it serves, so a handler can tell who is calling.
#[derive(Debug, Clone, Copy)]
pub struct Connection {
    peer: SocketAddr,
    trusted_proxy_hops: usize,
}

impl Connection {
    /// The key a caller's mailbox allowance is counted under. With no trusted proxy it is the TCP
    /// peer. Behind `n` proxies it is the `n`th `X-Forwarded-For` entry from the right: each proxy
    /// appends the address it received from, so the rightmost `n` entries were written by proxies
    /// and everything to their left by the client, who can write anything. A missing or
    /// unreadable entry falls back to the TCP peer (a proxy), never to a client-written entry.
    pub fn caller(&self, headers: &HeaderMap) -> Caller {
        let forwarded = self
            .trusted_proxy_hops
            .checked_sub(1)
            .and_then(|skip| {
                // Repeated headers form one list, in order (RFC 9110 section 5.3).
                let entries: Vec<&str> = headers
                    .get_all("x-forwarded-for")
                    .iter()
                    .map(|v| v.to_str().ok())
                    .collect::<Option<Vec<_>>>()?
                    .into_iter()
                    .flat_map(|v| v.split(','))
                    .collect();
                entries.into_iter().rev().nth(skip)
            })
            .and_then(forwarded_ip);
        Caller::from_ip(forwarded.unwrap_or_else(|| self.peer.ip()))
    }
}

/// One `X-Forwarded-For` entry: a bare address, or one with a port (`1.2.3.4:5`, `[::1]:5`).
fn forwarded_ip(entry: &str) -> Option<IpAddr> {
    let entry = entry.trim();
    entry
        .parse::<IpAddr>()
        .ok()
        .or_else(|| entry.parse::<SocketAddr>().ok().map(|a| a.ip()))
}

/// Who a mailbox allowance is charged to: an IPv4 address, or an IPv6 /64. One home or one
/// server usually holds a whole /64, so keying on the full IPv6 address would hand one machine
/// 2^64 allowances.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Caller(IpAddr);

impl Caller {
    pub fn from_ip(ip: IpAddr) -> Self {
        match ip.to_canonical() {
            IpAddr::V6(v6) => {
                let s = v6.segments();
                Self(IpAddr::V6(Ipv6Addr::new(
                    s[0], s[1], s[2], s[3], 0, 0, 0, 0,
                )))
            }
            v4 => Self(v4),
        }
    }
    pub fn ip(&self) -> IpAddr {
        self.0
    }
}

pub async fn serve_with<F>(
    listener: TcpListener,
    app: Router,
    shutdown: F,
    limits: Limits,
) -> std::io::Result<()>
where
    F: Future<Output = ()>,
{
    let app = with_timeouts(app, &limits);
    let permits = Arc::new(Semaphore::new(limits.max_connections));
    let graceful = GracefulShutdown::new();
    tokio::pin!(shutdown);
    loop {
        // The permit is taken before accept: at the limit the listener stays open, new clients
        // queue in the backlog and are served as connections close.
        let permit = tokio::select! {
            () = &mut shutdown => break,
            p = permits.clone().acquire_owned() => match p {
                Ok(p) => p,
                Err(_) => break,
            },
        };
        let (stream, peer) = tokio::select! {
            () = &mut shutdown => break,
            r = listener.accept() => match r {
                Ok(accepted) => accepted,
                Err(e) => {
                    // Out of descriptors or a reset before accept: back off, keep serving.
                    eprintln!("accept failed: {e}");
                    tokio::time::sleep(Duration::from_millis(100)).await;
                    continue;
                }
            },
        };
        let mut http = hyper::server::conn::http1::Builder::new();
        http.timer(TokioTimer::new())
            .header_read_timeout(limits.header_read_timeout);
        let connection = Connection {
            peer,
            trusted_proxy_hops: limits.trusted_proxy_hops,
        };
        let service = TowerToHyperService::new(app.clone());
        let service = hyper::service::service_fn(move |mut request: hyper::Request<Incoming>| {
            request.extensions_mut().insert(connection);
            service.call(request)
        });
        let conn = http.serve_connection(TokioIo::new(stream), service);
        let conn = graceful.watch(conn);
        tokio::spawn(async move {
            // A connection error (timeout, reset) ends only this connection.
            let _ = conn.await;
            drop(permit);
        });
    }
    graceful.shutdown().await;
    Ok(())
}

/// Adds the body and whole-request timeouts to every route of `app` (the HOUSE merges its own
/// routes into the relay's, so this is applied once, to the finished router, by [`serve_with`]).
/// A stalled body fails the read; a request over the limit answers 408.
pub fn with_timeouts(app: Router, limits: &Limits) -> Router {
    app.layer(RequestBodyTimeoutLayer::new(limits.request_body_timeout))
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            limits.request_timeout,
        ))
}
