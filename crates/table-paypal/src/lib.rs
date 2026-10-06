//! Rust-only PayPal executor. Never expose this trait as an agent tool.
mod client;
pub mod http;
mod types;
pub use client::*;
pub use types::*;
mod secondary;
pub use secondary::*;
