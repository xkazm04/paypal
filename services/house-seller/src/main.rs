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
    axum::serve(
        listener,
        house_seller::router(relay, house_seller::spawn(seller)),
    )
    .await?;
    Ok(())
}
