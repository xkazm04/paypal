//! Pure wallet domain. Time, identity generation and all IO are supplied by callers.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
pub mod agent;
pub mod canonical;
mod checks;
pub use checks::*;
pub mod deal;
mod evidence;
pub use evidence::*;
mod exposure;
pub use exposure::*;
mod display;
pub use display::*;
pub mod ids;
mod ladder;
pub use ladder::*;
pub mod mandate;
mod mandate_decision;
pub use mandate_decision::*;
pub mod market;
pub mod money;
pub mod negotiation;
pub mod rescue;
mod shield;
pub use shield::*;

pub use agent::*;
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
mod market_watch;
pub use market_watch::*;

#[cfg(test)]
pub(crate) mod test_support {
    /// Every wire name serde knows for a closed enum, read from its own "unknown variant" error:
    /// the ground truth a hand-written `ALL` list is checked against.
    pub(crate) fn serde_variants(unknown: &serde_json::Error) -> Vec<String> {
        let text = unknown.to_string();
        let listed = text.split("expected one of ").nth(1).unwrap_or_default();
        listed
            .split('`')
            .skip(1)
            .step_by(2)
            .map(str::to_owned)
            .collect()
    }
}
