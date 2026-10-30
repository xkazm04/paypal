//! PayPal, recorded instead of reached. Both wallets hold a real `table_paypal::Client` whose
//! transport is this recorder: any request the money pipeline made would be counted here and
//! answered as if the network were down. Nothing leaves the process.
use async_trait::async_trait;
use std::sync::{
    Arc,
    atomic::{AtomicU64, Ordering},
};
use table_paypal::http::{Backoff, Request, Response, Transport, TransportError};

/// Counts every request one wallet's PayPal client tried to send.
#[derive(Debug, Default)]
pub struct Recorder {
    asked: AtomicU64,
}
impl Recorder {
    pub fn asked(&self) -> u64 {
        self.asked.load(Ordering::SeqCst)
    }
}
/// The transport handed to `table_paypal::Client::sandbox`.
#[derive(Debug, Clone)]
pub struct Recording(pub Arc<Recorder>);
#[async_trait]
impl Transport for Recording {
    async fn send(&self, _: Request) -> Result<Response, TransportError> {
        self.0.asked.fetch_add(1, Ordering::SeqCst);
        Err(TransportError)
    }
}
/// No waits between the client's retries: a recorded call fails at once.
#[derive(Debug)]
pub struct NoDelay;
#[async_trait]
impl Backoff for NoDelay {
    async fn wait(&self, _: u8) {}
}
