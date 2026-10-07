//! Pure wallet domain. Time, identity generation and all IO are supplied by callers.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod canonical;
mod checks;
pub use checks::*;
pub mod deal;
mod exposure;
pub use exposure::*;
mod display;
pub use display::*;
pub mod ids;
pub mod mandate;
pub mod market;
pub mod money;
pub mod negotiation;
pub mod rescue;

pub use canonical::{H256, canonical_bytes, commitment};
pub use deal::*;
pub use ids::*;
pub use mandate::*;
pub use market::*;
pub use money::*;
pub use rescue::*;

/// Unix seconds, never a floating point time. Protocol edges check time bounds.
pub type Timestamp = i64;
pub trait Clock: Send + Sync {
    fn now(&self) -> Timestamp;
}

#[derive(Debug, Clone, Copy)]
pub struct FixedClock(pub Timestamp);
impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        self.0
    }
}
mod book;
pub use book::*;
