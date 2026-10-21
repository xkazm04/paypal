use crate::Timestamp;
use serde::{Deserialize, Serialize};

/// Ordered caution levels. An engine may only increase the deterministic verdict.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ShieldVerdict {
    Clear,
    Ask,
    Hold,
    Block,
}
/// The scam shield rule that decided a verdict, in the shield's own order (report §7). Closed:
/// the deterministic rules over typed facts, and the one quarantined second opinion that can only
/// add caution. Never derived from counterparty free text.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShieldRule {
    /// BLOCK: the money would go to another payee than the agreed one.
    PayeeMismatch,
    /// BLOCK: a request to be paid as friends and family (no buyer protection).
    FriendsAndFamily,
    /// ASK: no market reference recent enough to clear the price.
    NoMarketReference,
    /// HOLD: the unit price is more than 1.4 x the market median.
    PriceOverMarket,
    /// ASK: a counterparty first seen in the last 24 hours, over the threshold.
    NewCounterpartyOverThreshold,
    /// A raised verdict from outside the rules; it can only add caution.
    ModelCaution,
}
/// The owner's release of a shield HOLD, decided in the approval window (`decided_by` human at
/// `at`). It covers the rules it names, for the terms hash it was given for, and nothing else.
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShieldRelease {
    pub terms_hash: crate::H256,
    pub rules: Vec<ShieldRule>,
    pub at: Timestamp,
}
impl ShieldRelease {
    /// A hold whose rule is unknown is never covered: only a named rule can be released.
    pub fn covers(&self, rule: Option<ShieldRule>) -> bool {
        rule.is_some_and(|r| self.rules.contains(&r))
    }
}
