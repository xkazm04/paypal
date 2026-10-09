//! The one HTTP server loop of the public relay and the HOUSE. `axum::serve` has no header-read
//! timeout and no connection limit, so a few hundred idle sockets could starve a 512 MB instance
//! (scan-2026-10-07 C-6). Every bound is a named constant; tests pass smaller ones in [`Limits`].
use axum::Router;
use hyper_util::{
    rt::{TokioIo, TokioTimer},
    server::graceful::GracefulShutdown,
    service::TowerToHyperService,
};
use std::{future::Future, sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::Semaphore};

/// Open connections at once; the rest wait in the kernel backlog. Far above real load (a few
/// wallets long-polling), well below the file-descriptor and memory limits of the host.
pub const MAX_CONNECTIONS: usize = 512;
/// A client has this long to send a full request head; stops slow-loris sockets.
pub const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(10);

/// The bounds [`serve_with`] enforces. [`Default`] is the production set.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_connections: usize,
    pub header_read_timeout: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_connections: MAX_CONNECTIONS,
            header_read_timeout: HEADER_READ_TIMEOUT,
        }
    }
}

/// Serve `app` with the production [`Limits`] until `shutdown` resolves: then no new connection
/// is accepted and those in flight finish before this returns.
pub async fn serve<F>(listener: TcpListener, app: Router, shutdown: F) -> std::io::Result<()>
where
    F: Future<Output = ()>,
{
    serve_with(listener, app, shutdown, Limits::default()).await
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
        let stream = tokio::select! {
            () = &mut shutdown => break,
            r = listener.accept() => match r {
                Ok((stream, _)) => stream,
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
        let conn =
            http.serve_connection(TokioIo::new(stream), TowerToHyperService::new(app.clone()));
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
