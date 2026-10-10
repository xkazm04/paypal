//! Injectable HTTP boundary: offline tests use an in-memory transport, no sockets.
use async_trait::async_trait;
use serde_json::Value;
use std::{fmt, time::Duration};
use thiserror::Error;
pub struct Secret(zeroize::Zeroizing<String>);
impl Secret {
    pub fn new(value: String) -> Self {
        Self(zeroize::Zeroizing::new(value))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
}
impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}
pub struct Request {
    pub method: &'static str,
    pub url: String,
    pub headers: Vec<(String, Secret)>,
    pub body: Option<Value>,
    pub form: Option<&'static str>,
}
impl fmt::Debug for Request {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Request")
            .field("method", &self.method)
            .finish_non_exhaustive()
    }
}
#[derive(Clone)]
pub struct Response {
    pub status: u16,
    pub body: Value,
}
impl fmt::Debug for Response {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Response")
            .field("status", &self.status)
            .finish_non_exhaustive()
    }
}
#[derive(Debug, Error)]
#[error("HTTP transport failed (response may be unknown)")]
pub struct TransportError;
/// A response exactly as its bytes arrived, before any parsing. Market calls use it so the
/// wallet hashes what the service actually returned (market-data-2), not a re-serialised body.
#[derive(Clone)]
pub struct RawResponse {
    pub status: u16,
    pub bytes: Vec<u8>,
}
impl fmt::Debug for RawResponse {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RawResponse")
            .field("status", &self.status)
            .field("len", &self.bytes.len())
            .finish()
    }
}
#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, request: Request) -> Result<Response, TransportError>;
    /// The answer's bytes as they arrived, unparsed. A transport that holds only parsed bodies
    /// refuses, so a caller never hashes a re-serialised body by mistake.
    async fn send_raw(&self, request: Request) -> Result<RawResponse, TransportError> {
        let _ = request;
        Err(TransportError)
    }
}
/// The bound on one HTTP request (an OAuth token request or an API call), in seconds.
pub const REQUEST_TIMEOUT_SECS: u64 = 30;
/// How long [`ExponentialBackoff`] waits after a failed attempt (counted from 0), in seconds.
pub const fn backoff_secs(attempt: u8) -> u64 {
    1 << if attempt < 4 { attempt } else { 4 }
}
#[derive(Debug)]
pub struct ReqwestTransport(reqwest::Client);
/// Builds one header; Authorization is marked sensitive so reqwest and hyper never print it.
/// An invalid name or value fails the request and is never logged.
fn header_pair(
    name: &str,
    value: &Secret,
) -> Result<(reqwest::header::HeaderName, reqwest::header::HeaderValue), TransportError> {
    let name =
        reqwest::header::HeaderName::from_bytes(name.as_bytes()).map_err(|_| TransportError)?;
    let mut value =
        reqwest::header::HeaderValue::from_str(value.expose()).map_err(|_| TransportError)?;
    if name == reqwest::header::AUTHORIZATION {
        value.set_sensitive(true);
    }
    Ok((name, value))
}
impl ReqwestTransport {
    pub fn new() -> Result<Self, TransportError> {
        Ok(Self(
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
                .build()
                .map_err(|_| TransportError)?,
        ))
    }
}
#[async_trait]
impl Transport for ReqwestTransport {
    async fn send(&self, request: Request) -> Result<Response, TransportError> {
        let RawResponse { status, bytes } = self.fetch(request).await?;
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).map_err(|_| TransportError)?
        };
        Ok(Response { status, body })
    }
    async fn send_raw(&self, request: Request) -> Result<RawResponse, TransportError> {
        self.fetch(request).await
    }
}
impl ReqwestTransport {
    /// Sends the request and reads at most 1 MiB of the answer, unparsed.
    async fn fetch(&self, request: Request) -> Result<RawResponse, TransportError> {
        let method =
            reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| TransportError)?;
        let mut builder = self.0.request(method, request.url);
        for (name, value) in &request.headers {
            let (name, value) = header_pair(name, value)?;
            builder = builder.header(name, value);
        }
        if let Some(body) = request.body {
            builder = builder.json(&body);
        }
        if let Some(form) = request.form {
            builder = builder
                .header("Content-Type", "application/x-www-form-urlencoded")
                .body(form);
        }
        let mut response = builder.send().await.map_err(|_| TransportError)?;
        let status = response.status().as_u16();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| TransportError)? {
            if bytes.len() + chunk.len() > 1_048_576 {
                return Err(TransportError);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(RawResponse { status, bytes })
    }
}
#[async_trait]
pub trait Backoff: Send + Sync {
    async fn wait(&self, attempt: u8);
}
#[derive(Debug)]
pub struct ExponentialBackoff;
#[async_trait]
impl Backoff for ExponentialBackoff {
    async fn wait(&self, attempt: u8) {
        tokio::time::sleep(Duration::from_secs(backoff_secs(attempt))).await;
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn authorization_header_is_sensitive() {
        let (name, value) = header_pair("Authorization", &Secret::new("Bearer x".into())).unwrap();
        assert_eq!(name, reqwest::header::AUTHORIZATION);
        assert!(value.is_sensitive());
        let (_, other) =
            header_pair("Prefer", &Secret::new("return=representation".into())).unwrap();
        assert!(!other.is_sensitive());
    }

    #[test]
    fn invalid_header_value_fails() {
        assert!(
            header_pair(
                "Authorization",
                &Secret::new(
                    "a
b"
                    .into()
                )
            )
            .is_err()
        );
    }
}
