//! Serialized native wallet actor. No webview, model or MCP tool owns a payment client.
mod actor;
mod configuration;
pub mod credentials;
mod dispatcher;
mod engines;
mod forecast;
mod market;
pub use market::VaultMarketKey;
mod pairing;
mod policy;
mod proof;
pub mod reauth;
mod relay;
mod scheduler;
mod service;
#[cfg(test)]
mod tests;
pub mod vault;
pub use actor::*;
pub use service::*;
use table_client::{CommandError, ErrorCode};
pub(crate) fn invalid() -> CommandError {
    CommandError {
        code: ErrorCode::Invalid,
        message: "Invalid or stale wallet command".into(),
    }
}
pub(crate) fn unavailable(message: &str) -> CommandError {
    CommandError {
        code: ErrorCode::Unavailable,
        message: message.into(),
    }
}
pub(crate) fn permission() -> CommandError {
    table_app::Error::Permission.into()
}
pub(crate) fn app<T>(result: Result<T, table_ledger::LedgerError>) -> Result<T, CommandError> {
    result.map_err(|e| table_app::Error::from(e).into())
}

#[derive(Debug)]
pub struct SystemClock;
impl table_core::Clock for SystemClock {
    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(i64::MAX))
    }
}
