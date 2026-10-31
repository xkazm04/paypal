//! The buyer wallet's relay, served in process by the house seller's own deployed router (its
//! mailbox routes and `/v1/house/*`): the same HTTP routes a hosted HOUSE answers, with no socket.
use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use table_core::H256;
use table_relay::{Batch, Error};
use tower::ServiceExt;

/// The largest relay answer read back: a full mailbox batch.
const MAX_ANSWER: usize = 256 * 16384 + 32768;

pub struct InProcessRelay(pub Router);
impl std::fmt::Debug for InProcessRelay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InProcessRelay")
    }
}
impl InProcessRelay {
    async fn request(&self, method: &str, path: String, body: String) -> Result<Vec<u8>, Error> {
        let request = Request::builder()
            .method(method)
            .header("content-type", "application/json")
            .uri(path)
            .body(Body::from(body))
            .map_err(|_| Error::Invalid)?;
        let response = self
            .0
            .clone()
            .oneshot(request)
            .await
            .map_err(|_| Error::Unavailable)?;
        if response.status().as_u16() == 429 {
            return Err(Error::Full);
        }
        if !response.status().is_success() {
            return Err(Error::Unavailable);
        }
        Ok(to_bytes(response.into_body(), MAX_ANSWER)
            .await
            .map_err(|_| Error::Unavailable)?
            .to_vec())
    }
}
#[async_trait]
impl table_relay::RelayApi for InProcessRelay {
    async fn house_table(
        &self,
        request: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, Error> {
        let body = serde_json::to_string(request).map_err(|_| Error::Invalid)?;
        serde_json::from_slice(
            &self
                .request("POST", "/v1/house/tables".into(), body)
                .await?,
        )
        .map_err(|_| Error::Invalid)
    }
    async fn house_head(&self) -> Result<table_proto::SignedHouseHead, Error> {
        serde_json::from_slice(
            &self
                .request("GET", "/v1/house/head".into(), String::new())
                .await?,
        )
        .map_err(|_| Error::Invalid)
    }
    async fn house_prefix(&self, rows: u64) -> Result<table_proto::SignedHousePrefix, Error> {
        serde_json::from_slice(
            &self
                .request(
                    "GET",
                    format!("/v1/house/prefix?rows={rows}"),
                    String::new(),
                )
                .await?,
        )
        .map_err(|_| Error::Invalid)
    }
    async fn wake(&self) -> Result<(), Error> {
        self.request("GET", "/healthz".into(), String::new())
            .await
            .map(|_| ())
    }
    async fn create(&self, mailbox: H256) -> Result<(), Error> {
        self.request(
            "PUT",
            format!("/v1/mailbox/{}", mailbox.hex()),
            String::new(),
        )
        .await
        .map(|_| ())
    }
    async fn send(&self, mailbox: H256, jws: &str) -> Result<(), Error> {
        self.request(
            "POST",
            format!("/v1/mailbox/{}/envelopes", mailbox.hex()),
            jws.into(),
        )
        .await
        .map(|_| ())
    }
    async fn poll(
        &self,
        mailbox: H256,
        generation: &str,
        after: u64,
        wait: u8,
    ) -> Result<Batch, Error> {
        serde_json::from_slice(
            &self
                .request(
                    "GET",
                    format!(
                        "/v1/mailbox/{}/sync?generation={generation}&after={after}&wait={wait}",
                        mailbox.hex()
                    ),
                    String::new(),
                )
                .await?,
        )
        .map_err(|_| Error::Invalid)
    }
}
