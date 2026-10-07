use std::sync::Arc;
#[derive(Debug)]
struct Time;
impl table_core::Clock for Time {
    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
    }
}
/// Resolves on ctrl-c or SIGTERM (the host's stop signal). A signal that cannot be watched never
/// resolves, so a failed registration cannot stop the HOUSE by itself.
async fn shutdown() {
    let interrupt = async {
        if tokio::signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        () = interrupt => {}
        () = terminate => {}
    }
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = house_seller::Configuration::from_environment()?;
    let release =
        table_proto::HouseRelease::compiled().map_err(|_| house_seller::Error::Invalid)?;
    let clock = Arc::new(Time);
    let relay = Arc::new(rendezvous::MemoryStore::new(clock.clone()));
    let credentials = Arc::new(house_seller::EnvironmentCredentials);
    // Fail startup on missing credentials without making an OAuth request.
    table_paypal::Credentials::load(credentials.as_ref()).await?;
    let api = Arc::new(table_paypal::Client::sandbox(
        Arc::new(table_paypal::http::ReqwestTransport::new()?),
        credentials,
        clock.clone(),
        Arc::new(table_paypal::http::ExponentialBackoff),
    ));
    let path = std::env::var("HOUSE_LEDGER_PATH")?;
    let ledger = table_ledger::Ledger::open(std::path::Path::new(&path))?;
    let seller = house_seller::Seller::new(
        ledger,
        config.owner,
        config.agent,
        release,
        config.mandate,
        api,
        clock,
        relay.clone(),
    )?;
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await?;
    // Starts the actor, which first reads back from PayPal any money operation a previous run
    // left unknown (confirm, re-send under the same request id, or park), one log line each.
    let house = house_seller::start(seller);
    // On a stop signal: no new connections, requests in flight finish, then the actor drains
    // (the tick in flight finishes) before the process exits.
    axum::serve(listener, house_seller::router(relay, house.handle.clone()))
        .with_graceful_shutdown(shutdown())
        .await?;
    house.drain().await;
    Ok(())
}
