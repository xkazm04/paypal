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
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "8080".into())
        .parse::<u16>()?;
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::UNSPECIFIED, port)).await?;
    axum::serve(
        listener,
        rendezvous::router(Arc::new(rendezvous::MemoryStore::new(Arc::new(Time)))),
    )
    .await?;
    Ok(())
}
