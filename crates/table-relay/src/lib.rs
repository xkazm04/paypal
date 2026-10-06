//! Bounded rendezvous transport. The relay carries opaque data and grants no authority.
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use table_core::H256;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid relay configuration or response")]
    Invalid,
    #[error("relay temporarily unavailable")]
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Batch {
    pub generation: String,
    pub after: u64,
    pub messages: Vec<String>,
}
impl Batch {
    pub fn validate(&self) -> Result<(), Error> {
        if self.generation.len() != 32
            || !self.generation.bytes().all(|b| b.is_ascii_hexdigit())
            || self.messages.len() > 256
            || self.after > 256
            || self.after.saturating_add(self.messages.len() as u64) > 256
            || self
                .messages
                .iter()
                .any(|s| s.len() > 16384 || !s.is_ascii())
        {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

#[async_trait]
pub trait RelayApi: Send + Sync {
    async fn house_table(
        &self,
        _: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, Error> {
        Err(Error::Unavailable)
    }
    /// A bodiless request to the deployment's health route: wakes a sleeping host (the co-hosted
    /// HOUSE) and carries nothing. Implementations without a host to wake say so.
    async fn wake(&self) -> Result<(), Error> {
        Err(Error::Unavailable)
    }
    async fn create(&self, mailbox: H256) -> Result<(), Error>;
    async fn send(&self, mailbox: H256, jws: &str) -> Result<(), Error>;
    async fn poll(
        &self,
        mailbox: H256,
        generation: &str,
        after: u64,
        wait: u8,
    ) -> Result<Batch, Error>;
}

#[derive(Debug)]
pub struct Client {
    origin: url::Url,
    http: reqwest::Client,
}
impl Client {
    /// The deployment supplies the HTTPS origin; no webview supplies an arbitrary URL.
    pub fn new(origin: &str) -> Result<Self, Error> {
        let origin = url::Url::parse(origin).map_err(|_| Error::Invalid)?;
        if origin.scheme() != "https"
            || origin.host_str().is_none()
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.query().is_some()
            || origin.fragment().is_some()
            || origin.path() != "/"
        {
            return Err(Error::Invalid);
        }
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|_| Error::Invalid)?;
        Ok(Self { origin, http })
    }
    fn endpoint(&self, mailbox: H256, suffix: &str) -> Result<url::Url, Error> {
        self.origin
            .join(&format!("v1/mailbox/{}{suffix}", mailbox.hex()))
            .map_err(|_| Error::Invalid)
    }
    async fn checked(request: reqwest::RequestBuilder) -> Result<reqwest::Response, Error> {
        let response = request.send().await.map_err(|_| Error::Unavailable)?;
        if !response.status().is_success() {
            return Err(Error::Unavailable);
        }
        Ok(response)
    }
}
#[async_trait]
impl RelayApi for Client {
    async fn house_table(
        &self,
        request: &table_proto::HouseRequest,
    ) -> Result<table_proto::HouseResponse, Error> {
        let response = Self::checked(
            self.http
                .post(
                    self.origin
                        .join("v1/house/tables")
                        .map_err(|_| Error::Invalid)?,
                )
                .json(request),
        )
        .await?;
        if response.content_length().is_some_and(|n| n > 16384) {
            return Err(Error::Invalid);
        }
        let mut response = response;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Unavailable)? {
            if bytes.len().saturating_add(chunk.len()) > 16384 {
                return Err(Error::Invalid);
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)
    }
    async fn wake(&self) -> Result<(), Error> {
        // The rendezvous service's own /healthz route (services/rendezvous), not a PayPal call.
        // UNVERIFIED: that this request shortens a hosted cold start (Render timing unmeasured).
        Self::checked(
            self.http
                .get(self.origin.join("healthz").map_err(|_| Error::Invalid)?),
        )
        .await?;
        Ok(())
    }
    async fn create(&self, mailbox: H256) -> Result<(), Error> {
        Self::checked(self.http.put(self.endpoint(mailbox, "")?)).await?;
        Ok(())
    }
    async fn send(&self, mailbox: H256, jws: &str) -> Result<(), Error> {
        if jws.len() > 16384 || !jws.is_ascii() {
            return Err(Error::Invalid);
        }
        Self::checked(
            self.http
                .post(self.endpoint(mailbox, "/envelopes")?)
                .body(jws.to_owned()),
        )
        .await?;
        Ok(())
    }
    async fn poll(
        &self,
        mailbox: H256,
        generation: &str,
        after: u64,
        wait: u8,
    ) -> Result<Batch, Error> {
        if wait > 25 || after > 256 {
            return Err(Error::Invalid);
        }
        let mut response = Self::checked(self.http.get(self.endpoint(mailbox, "/sync")?).query(&[
            ("generation", generation.to_owned()),
            ("after", after.to_string()),
            ("wait", wait.to_string()),
        ]))
        .await?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error::Unavailable)? {
            if bytes.len().saturating_add(chunk.len()) > 256 * 16384 + 32768 {
                return Err(Error::Invalid);
            }
            bytes.extend_from_slice(&chunk);
        }
        let batch: Batch = serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?;
        batch.validate()?;
        Ok(batch)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn origin_and_batch_are_bounded_without_network() {
        for url in [
            "http://localhost/",
            "https://user:pass@example.com/",
            "https://example.com/a",
            "https://example.com/?q=1",
        ] {
            assert!(Client::new(url).is_err());
        }
        let mut batch = Batch {
            generation: "a".repeat(32),
            after: 0,
            messages: vec!["a.b.c".into()],
        };
        assert!(batch.validate().is_ok());
        batch.after = 256;
        assert!(batch.validate().is_err());
    }
}
