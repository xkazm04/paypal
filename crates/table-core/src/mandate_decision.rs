use crate::{Category, DealKind, KeyId, Money, PayeeRef, Role, Side, Terms};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Clause 4's reasons, as the text a refusal shows. An agent refusal's code is read from the
/// typed [`RefusalCause`] the check attaches, never parsed back out of this text.
pub const DEADLINE_REACHED: &str = "deadline reached";
pub const MAX_ROUNDS_REACHED: &str = "max_rounds reached";
/// The start of clause 4's "price X above ceiling Y" / "price X below floor Y" text.
pub const BAND_PRICE: &str = "price ";
#[derive(ts_rs::TS, Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[error("{}", refusal_text(*.clause, .reason))]
#[serde(deny_unknown_fields)]
pub struct Refusal {
    pub clause: u8,
    pub reason: String,
    /// What kind of refusal this is, for the code an agent receives. In-process only: it is not
    /// part of the wire form, and the text above is what a person reads.
    #[serde(skip)]
    #[ts(skip)]
    pub cause: Option<RefusalCause>,
}
/// The refusals an agent is told apart by code (`RefusalCode::from_refusal`). The check that
/// refuses names the cause itself; nothing reads it back out of the reason's text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusalCause {
    /// A wallet-wide limit (clause 0).
    Envelope(crate::EnvelopeLimit),
    /// Clause 4: the deal's deadline passed.
    Deadline,
    /// Clause 4: the rounds allowed are used.
    Rounds,
    /// Clause 4: the price is outside the signed band.
    Band,
}
/// A mandate clause names itself; clause 0 is the wallet-wide limits (`ENVELOPE_CLAUSE`).
fn refusal_text(clause: u8, reason: &str) -> String {
    if clause == crate::ENVELOPE_CLAUSE {
        format!("wallet limit {reason}")
    } else {
        format!("mandate clause {clause}: {reason}")
    }
}
impl Refusal {
    pub fn new(clause: u8, reason: impl Into<String>) -> Self {
        Self {
            clause,
            reason: reason.into(),
            cause: None,
        }
    }
    pub fn caused_by(mut self, cause: RefusalCause) -> Self {
        self.cause = Some(cause);
        self
    }
}

#[derive(Debug, Clone)]
pub struct Intent<'a> {
    pub kind: DealKind,
    pub side: Side,
    pub role: Role,
    pub category: Category,
    pub terms: &'a Terms,
    pub counterparty: &'a KeyId,
    pub paired: bool,
    pub house: bool,
    pub payee: &'a PayeeRef,
    pub rounds_used: u8,
}
#[derive(Debug, Clone, Copy)]
pub struct Usage {
    pub deals_today: u16,
    pub total_today: Money,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MandateDecision {
    Allow,
    Ask { clause: u8 },
}
