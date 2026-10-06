//! Closed analytical queries. There is no SQL string in the public schema.
use serde::{Deserialize, Serialize};
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookView {
    Deals,
    PaypalCalls,
    Receipts,
    Subscriptions,
    Reconciliation,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookField {
    Kind,
    State,
    Counterparty,
    Amount,
    CreatedAt,
    VsMarketPct,
    DecidedBy,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookOp {
    Eq,
    Ne,
    Gt,
    Lt,
    Between,
    In,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookGroup {
    Kind,
    Counterparty,
    State,
    Day,
    DecidedBy,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BookMetric {
    Count,
    SumAmount,
    AvgVsMarketPct,
    RecoveredSum,
}
#[derive(ts_rs::TS, Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BookFilter {
    pub field: BookField,
    pub op: BookOp,
    pub value: serde_json::Value,
}
#[derive(ts_rs::TS, Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BookRange {
    pub from: String,
    pub to: String,
}
#[derive(ts_rs::TS, Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BookQuery {
    pub view: BookView,
    pub metrics: Vec<BookMetric>,
    #[serde(default)]
    pub filters: Vec<BookFilter>,
    #[serde(default)]
    pub group_by: Vec<BookGroup>,
    pub range: Option<BookRange>,
    pub limit: Option<u16>,
}
impl BookQuery {
    pub fn validate(&self) -> Result<(), crate::DomainError> {
        match self.rejection() {
            Some(_) => Err(crate::DomainError::InvalidTerms),
            None => Ok(()),
        }
    }
    /// The shape rule this query breaks, in words, or None. Fixed text: never echoes a value.
    pub fn rejection(&self) -> Option<&'static str> {
        if self.metrics.is_empty() || self.metrics.len() > 4 {
            return Some("metrics: 1 to 4 required");
        }
        if self.filters.len() > 6 {
            return Some("filters: at most 6");
        }
        if self.group_by.len() > 2 {
            return Some("group_by: at most 2");
        }
        if self.limit.is_some_and(|n| n == 0 || n > 500) {
            return Some("limit: 1 to 500");
        }
        if self
            .metrics
            .iter()
            .enumerate()
            .any(|(i, m)| self.metrics[..i].contains(m))
        {
            return Some("metrics: each at most once");
        }
        if self
            .group_by
            .iter()
            .enumerate()
            .any(|(i, g)| self.group_by[..i].contains(g))
        {
            return Some("group_by: each at most once");
        }
        None
    }
}
