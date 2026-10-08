#![allow(clippy::unwrap_used, clippy::expect_used)]
use async_trait::async_trait;
use std::sync::Arc;
use table_core::*;
use table_market::*;
use table_paypal::http::*;
#[derive(Debug)]
struct EnvKey;
#[async_trait]
impl ApiKey for EnvKey {
    async fn load(&self) -> Result<Secret, Error> {
        Ok(Secret::new(
            std::env::var("CHANNEL3_API_KEY").map_err(|_| Error::Unavailable)?,
        ))
    }
}
#[derive(Debug)]
struct Time;
impl Clock for Time {
    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0))
    }
}
#[tokio::test]
#[ignore = "owner-run Channel3 comparable/tracking probe; scripts/spike.ps1 -Spike 7"]
async fn spike_7_channel3_demo_monitor_tracking() {
    assert_eq!(std::env::var("TABLE_LIVE_MARKET").as_deref(), Ok("1"));
    let client = Client::new(
        Arc::new(ReqwestTransport::new().unwrap()),
        Arc::new(EnvKey),
        Arc::new(Time),
    );
    let product = std::env::var("CHANNEL3_DEMO_PRODUCT_ID")
        .expect("Choose a real canonical demo monitor product id");
    let reference = client.comparables(&product, Currency::USD).await.unwrap();
    assert!(reference.median.minor() > 0);
    client.start_tracking(&product).await.unwrap();
    let history = client.history(&product, 1).await;
    println!(
        "TABLE_SPIKE_EVIDENCE:{}",
        serde_json::json!({"spike":7,"product_id":product,"currency":"USD","p25_minor":reference.p25.minor(),"median_minor":reference.median.minor(),"p75_minor":reference.p75.minor(),"response_hash":reference.response_hash,"retrieved_at":reference.retrieved_at,"comparables":reference.certificate.as_ref().map(|c|c.comparables.len()),"comparables_with_id":reference.certificate.as_ref().map(|c|c.comparables.iter().filter(|x|x.product_id.is_some()).count()),"tracking":"active","history_points":history.as_ref().ok().map(|h|h.len()),"history_status":if history.is_ok(){"available"}else{"unverified"},"history_failure":history.as_ref().err().map(|e|e.to_string()),"verdict":"comparables_and_tracking_verified"})
    );
}
