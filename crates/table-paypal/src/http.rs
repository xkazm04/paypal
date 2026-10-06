//! Injectable HTTP boundary: offline tests use an in-memory transport, no sockets.
use async_trait::async_trait;
use serde_json::Value;
use std::{fmt, time::Duration};
use thiserror::Error;
pub struct Secret(String);
impl Secret {
    pub fn new(value: String) -> Self {
        Self(value)
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
#[async_trait]
pub trait Transport: Send + Sync {
    async fn send(&self, request: Request) -> Result<Response, TransportError>;
}
#[derive(Debug)]
pub struct ReqwestTransport(reqwest::Client);
impl ReqwestTransport {
    pub fn new() -> Result<Self, TransportError> {
        Ok(Self(
            reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()
                .map_err(|_| TransportError)?,
        ))
    }
}
#[async_trait]
impl Transport for ReqwestTransport {
    async fn send(&self, request: Request) -> Result<Response, TransportError> {
        let method =
            reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| TransportError)?;
        let mut builder = self.0.request(method, request.url);
        for (name, value) in request.headers {
            builder = builder.header(name, value.expose());
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
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).map_err(|_| TransportError)?
        };
        Ok(Response { status, body })
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
        tokio::time::sleep(Duration::from_secs(1 << attempt.min(4))).await;
    }
}
