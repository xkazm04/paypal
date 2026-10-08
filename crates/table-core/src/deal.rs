use crate::{
    Currency, DealId, H256, ItemRef, KeyId, MandateId, Money, MoneyError, PayeeRef, Timestamp,
    commitment,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DealKind {
    Purchase,
    Haggle,
    ShopOrder,
    Rescue,
    Invoice,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Buyer,
    Seller,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Sandbox,
    Replay,
    ScriptedEngine,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Module {
    Tables,
    Spend,
    Counter,
    Book,
    Shield,
    Rescue,
}

#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Delivery {
    DigitalNow,
    ShipThenCapture { days: u8 },
    PickupLocal,
    ServiceOnDate { unix_day: i32 },
}
impl Delivery {
    pub fn validate(&self) -> Result<(), DomainError> {
        if matches!(self, Self::ShipThenCapture { days } if *days == 0 || *days > 3) {
            return Err(DomainError::InvalidTerms);
        }
        Ok(())
    }
}

#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Terms {
    pub item_ref: ItemRef,
    pub qty: u32,
    pub unit_price: Money,
    pub currency: Currency,
    pub delivery: Delivery,
}
impl Terms {
    pub fn amount(&self) -> Result<Money, DomainError> {
        if self.qty == 0
            || self.unit_price.minor() == 0
            || self.currency != self.unit_price.currency()
        {
            return Err(DomainError::InvalidTerms);
        }
        self.delivery.validate()?;
        Ok(self.unit_price.checked_mul(self.qty)?)
    }
    pub fn hash(&self) -> Result<H256, DomainError> {
        self.amount()?;
        Ok(commitment(self)?)
    }
}

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DealState {
    Pairing,
    Listed,
    Negotiating,
    Agreed,
    Settling,
    AwaitingApproval,
    Approved,
    Authorized,
    Captured,
    Receipted,
    Reconciled,
    Withdrawn,
    Expired,
    Refused,
    Mismatch,
    Failed,
    Voided,
    AutoVoided,
    Refunded,
    Disputed,
}
/// How long the buyer has to approve an order the seller's wallet created: PayPal's default
/// window for the payer's approval, 6 hours from creation (.research/paypal-platform.md,
/// "Approval window" [S-spec]). Silence past it lets the deal lapse; no money moves.
pub const ORDER_APPROVAL_SECS: i64 = 6 * 3600;
/// The hosted HOUSE seller's approval window: 30 minutes, well inside PayPal's 6 hours. The HOUSE
/// is a practice shop with 64 table slots, and an agreed deal holds its slot until it is paid or
/// lapses; a person who just agreed at its table approves within minutes, so an abandoned deal
/// now frees its slot after 30 minutes instead of 6 hours. Both the HOUSE and a buyer wallet
/// that paired with the HOUSE through its release pin use it, so the buyer's countdown is true.
pub const HOUSE_APPROVAL_SECS: i64 = 30 * 60;
/// How long past [`HOUSE_APPROVAL_SECS`] a buyer wallet paired with the HOUSE waits before an
/// order still out for approval lapses there. The HOUSE may see the approval in the last seconds
/// of its window, then authorize, capture and relay its RECEIPT; the buyer's wallet must still be
/// listening when it lands. The person's approval countdown still ends with the HOUSE's window;
/// only the lapse waits, and waiting moves no money. house-seller asserts at compile time that it
/// covers the HOUSE's slowest finish, and the HOUSE voids rather than capture when it could not.
pub const HOUSE_RECEIPT_GRACE_SECS: i64 = 15 * 60;
impl DealState {
    pub const fn pre_capture(self) -> bool {
        matches!(
            self,
            Self::Pairing
                | Self::Listed
                | Self::Negotiating
                | Self::Agreed
                | Self::Settling
                | Self::AwaitingApproval
                | Self::Approved
                | Self::Authorized
        )
    }
    pub const fn terminal(self) -> bool {
        matches!(
            self,
            Self::Withdrawn
                | Self::Expired
                | Self::Refused
                | Self::Mismatch
                | Self::Failed
                | Self::Voided
                | Self::AutoVoided
                | Self::Refunded
                | Self::Disputed
                | Self::Reconciled
        )
    }
}

/// Events supplied only after protocol or PayPal evidence has been verified at the IO edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DealEvent {
    ListingVerified,
    OfferVerified,
    TwoAcceptsVerified,
    /// A purchase has no counterparty wallet to sign two ACCEPTs, so it clears straight from
    /// PAIRING to AGREED. Supplied only after the mandate check passed on the closed terms; the
    /// ledger accepts it only for kind Purchase, side Buyer.
    PurchaseCleared,
    BeginSettlement,
    SettleVerified,
    OrderApproved,
    AuthorizationConfirmed,
    CaptureConfirmed,
    ReceiptVerified,
    SellerReceiptVerified,
    ReportingMatched,
    Withdraw,
    Deadline,
    Refuse,
    Mismatch,
    Fail,
    Void,
    AutoVoid,
    Refund,
    Dispute,
    /// A failed renewal was recorded (read from PayPal, or replayed) and its one fix passed the
    /// mandate check: the rescue deal waits at AGREED for the owner. Accepted only on a rescue.
    RescueOpened,
    /// PayPal confirmed the rescue invoice exists as a draft; the deal stays SETTLING until it is
    /// sent. Nobody has been asked to pay yet.
    InvoiceDrafted,
}

pub fn transition(state: DealState, event: DealEvent) -> Result<DealState, DomainError> {
    use DealEvent as E;
    use DealState as S;
    let next = match (state, event) {
        (S::Pairing, E::ListingVerified) => S::Listed,
        (S::Listed | S::Negotiating, E::OfferVerified) => S::Negotiating,
        (S::Negotiating, E::TwoAcceptsVerified) => S::Agreed,
        (S::Pairing, E::PurchaseCleared) => S::Agreed,
        (S::Pairing, E::RescueOpened) => S::Agreed,
        (S::Settling, E::InvoiceDrafted) => S::Settling,
        (S::Agreed, E::BeginSettlement) => S::Settling,
        (S::Settling, E::SettleVerified) => S::AwaitingApproval,
        (S::AwaitingApproval, E::OrderApproved) => S::Approved,
        (S::Approved, E::AuthorizationConfirmed) => S::Authorized,
        (S::Authorized, E::CaptureConfirmed) => S::Captured,
        (S::Captured, E::ReceiptVerified) => S::Receipted,
        (S::AwaitingApproval | S::Approved, E::SellerReceiptVerified) => S::Receipted,
        (S::Receipted, E::ReportingMatched) => S::Reconciled,
        (S::Captured | S::Receipted | S::Reconciled, E::Refund) => S::Refunded,
        (S::Captured | S::Receipted | S::Reconciled, E::Dispute) => S::Disputed,
        (S::Authorized, E::Void) => S::Voided,
        (S::Authorized, E::AutoVoid) => S::AutoVoided,
        // A held authorization needs a confirmed void, not a fictitious withdrawal.
        (s, E::Withdraw) if s.pre_capture() && s != S::Authorized => S::Withdrawn,
        (S::Pairing | S::Listed | S::Negotiating | S::Agreed, E::Deadline) => S::Withdrawn,
        (S::Settling | S::AwaitingApproval | S::Approved, E::Deadline) => S::Expired,
        (S::Pairing | S::Listed | S::Negotiating, E::Refuse) => S::Refused,
        (s, E::Mismatch) if s.pre_capture() && s != S::Authorized => S::Mismatch,
        (s, E::Fail) if s.pre_capture() && s != S::Authorized => S::Failed,
        _ => return Err(DomainError::InvalidTransition { state, event }),
    };
    Ok(next)
}

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReceiptEvidence {
    None,
    SellerAttested,
    PaypalVerified,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Reconciliation {
    NotApplicable,
    PendingReporting,
    Matched,
    Mismatch,
}
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DealEvidence {
    pub deal_id: DealId,
    pub receipt: ReceiptEvidence,
    pub reconciliation: Reconciliation,
    /// A money step whose PayPal outcome is not confirmed yet; null when there is none. Older
    /// shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub money_check: Option<MoneyCheck>,
    /// For a deal with the house: the house's signed record kept with the receipt and how the
    /// house's later record compares with it; null otherwise. Older shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub house_record: Option<HouseRecord>,
    /// The deal's price against the market prices it was bargained on, computed again from the
    /// wallet's own record (market-data-2); null when the deal never had a market price. Older
    /// shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub fair_price: Option<crate::FairPrice>,
}
/// How the house's record compares with the signed head the wallet kept with the receipt (T9).
/// Evidence only: no state here moves or holds money.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseRecordState {
    /// Kept with the receipt; not compared with a later record yet.
    Kept,
    /// A later signed record still contains the kept one.
    Holds,
    /// A later signed record is longer, but the house was not asked to prove it contains the kept
    /// one yet.
    Longer,
    /// The house started a new record (for example after a disk loss).
    Restarted,
    /// The house's record got shorter since the receipt.
    Shorter,
    /// The house's record no longer contains the one it signed at the receipt.
    Rewritten,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseRecord {
    pub state: HouseRecordState,
    /// When the wallet kept the house's signed record.
    pub kept_at: Timestamp,
    /// Entries in the house's record at that moment.
    pub entries: u64,
    /// When the wallet last compared a later record; null when it has not.
    pub checked_at: Option<Timestamp>,
}
/// The PayPal step a [`MoneyCheck`] is about.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoneyCheckStep {
    Create,
    Authorize,
    Capture,
    Void,
    /// A rescue invoice being made (a draft nobody is asked to pay yet).
    InvoiceCreate,
    /// A rescue invoice being sent to the subscriber.
    InvoiceSend,
}
/// `Checking`: the wallet has not asked PayPal yet, or is about to ask again. `Parked`: PayPal's
/// answer could not be read or did not settle the question, so nothing more is sent for this
/// deal until it does; the deadline can only let the deal lapse or release a hold.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MoneyCheckState {
    Checking,
    Parked,
}
/// A money step sent to PayPal whose answer never arrived or could not be read (T10). The
/// wallet reads PayPal's own record before anything else happens to the deal.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoneyCheck {
    pub step: MoneyCheckStep,
    pub state: MoneyCheckState,
    /// When the step was sent.
    pub since: Timestamp,
    /// When the wallet asks PayPal next; null when it is not scheduled.
    pub next_check: Option<Timestamp>,
}
impl MoneyCheckStep {
    pub fn parse(operation: &str) -> Option<Self> {
        match operation {
            "create" => Some(Self::Create),
            "authorize" => Some(Self::Authorize),
            "capture" => Some(Self::Capture),
            "void" => Some(Self::Void),
            "invoice-create" => Some(Self::InvoiceCreate),
            "invoice-send" => Some(Self::InvoiceSend),
            _ => None,
        }
    }
}

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("invalid closed terms")]
    InvalidTerms,
    #[error("invalid transition {state:?} + {event:?}")]
    InvalidTransition { state: DealState, event: DealEvent },
    #[error(transparent)]
    Money(#[from] MoneyError),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
    #[error("settlement attempts must be 1 through 3")]
    InvalidAttempt,
}

#[derive(ts_rs::TS, Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaypalRefs {
    pub order: Option<String>,
    pub authorization: Option<String>,
    pub capture: Option<String>,
    pub subscription: Option<String>,
}

/// Contains no counterparty free text. Human-only evidence has a separate ledger path.
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Deal {
    pub id: DealId,
    // Legacy serialized snapshots may omit timestamps; ledger projections always
    // supply their persisted values. Zero means unavailable, never "created now".
    #[serde(default, skip_serializing_if = "timestamp_unavailable")]
    pub created_at: Timestamp,
    #[serde(default, skip_serializing_if = "timestamp_unavailable")]
    pub updated_at: Timestamp,
    pub kind: DealKind,
    pub side: Side,
    pub counterparty: KeyId,
    pub terms: Terms,
    pub state: DealState,
    pub mandate_id: MandateId,
    pub mandate_version: u32,
    pub transcript_head: H256,
    pub paypal: PaypalRefs,
    pub mode: Mode,
    pub market: Option<crate::MarketRef>,
    pub shield: Option<ShieldVerdict>,
    /// The authority recorded with the deal's latest decision, the same value the audit log
    /// carries: the owner, a rule the owner signed (a clause, the seller or HOUSE mandate), or the
    /// safe default on a deadline. Absent until something decided it (and in legacy snapshots).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub decided_by: Option<DecidedBy>,
    /// Which rule decided `shield` (a closed name, never counterparty text). Absent while nothing
    /// was recorded, for a CLEAR, and for a hold the wallet raised on a settlement mismatch.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub shield_rule: Option<ShieldRule>,
    /// The owner's release of a HOLD in the approval window, while it still applies: only for
    /// the terms it was given for (a terms change drops it and the shield judges again). The
    /// HOLD it covers reads as ASK in `shield`: the owner's decision is the check.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub shield_release: Option<ShieldRelease>,
}
impl Deal {
    /// Whether the recorded verdict stops this deal for the owner: a BLOCK, or a HOLD the owner
    /// has not released for these terms and this rule.
    pub fn shield_held(&self) -> bool {
        self.shield_recorded() >= Some(ShieldVerdict::Hold) && !self.shield_released()
    }
    /// Whether the recorded verdict is a HOLD the owner released for these terms and its rule.
    pub fn shield_released(&self) -> bool {
        matches!(self.shield, Some(ShieldVerdict::Ask | ShieldVerdict::Hold))
            && self
                .shield_release
                .as_ref()
                .is_some_and(|r| r.covers(self.shield_rule))
    }
    /// The verdict as recorded, before the owner's release: a released HOLD is a HOLD here.
    pub fn shield_recorded(&self) -> Option<ShieldVerdict> {
        if self.shield_released() {
            Some(ShieldVerdict::Hold)
        } else {
            self.shield
        }
    }
}
fn timestamp_unavailable(value: &Timestamp) -> bool {
    *value == 0
}
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
impl Deal {
    pub fn apply(&mut self, event: DealEvent) -> Result<(), DomainError> {
        let next = transition(self.state, event)?;
        self.state = next;
        Ok(())
    }
}

pub fn invoice_id(id: DealId, attempt: u8) -> Result<String, DomainError> {
    if !(1..=3).contains(&attempt) {
        return Err(DomainError::InvalidAttempt);
    }
    Ok(format!("{id}-{attempt}"))
}

#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum DecidedBy {
    Policy { clause: u8 },
    Human { at: Timestamp },
    SellerMandate { mandate_hash: H256 },
    HouseMandate { mandate_hash: H256 },
    SafeDefault { deadline: Timestamp },
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClosedMandate {
    pub deal_id: DealId,
    pub open_mandate_hash: H256,
    pub terms_hash: H256,
    pub amount: Money,
    pub payee: PayeeRef,
    pub invoice_id: String,
    pub decided_by: DecidedBy,
    pub agent_sig: Vec<u8>,
}
impl ClosedMandate {
    /// Commitment and signature exclude the signature field itself.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        let mut value = serde_json::to_value(self)?;
        if let Some(object) = value.as_object_mut() {
            object.remove("agent_sig");
        }
        crate::canonical_bytes(&value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_defaults_only_withdraw_or_expire_and_held_funds_require_void() {
        for state in [
            DealState::Pairing,
            DealState::Listed,
            DealState::Negotiating,
            DealState::Agreed,
        ] {
            assert_eq!(
                transition(state, DealEvent::Deadline).unwrap(),
                DealState::Withdrawn
            );
        }
        for state in [
            DealState::Settling,
            DealState::AwaitingApproval,
            DealState::Approved,
        ] {
            assert_eq!(
                transition(state, DealEvent::Deadline).unwrap(),
                DealState::Expired
            );
        }
        assert!(transition(DealState::Authorized, DealEvent::Deadline).is_err());
        assert_eq!(
            transition(DealState::Authorized, DealEvent::AutoVoid).unwrap(),
            DealState::AutoVoided
        );
    }
    #[test]
    fn happy_path_requires_approval_and_authorization_before_capture() {
        let events = [
            DealEvent::ListingVerified,
            DealEvent::OfferVerified,
            DealEvent::TwoAcceptsVerified,
            DealEvent::BeginSettlement,
            DealEvent::SettleVerified,
            DealEvent::OrderApproved,
            DealEvent::AuthorizationConfirmed,
            DealEvent::CaptureConfirmed,
            DealEvent::ReceiptVerified,
            DealEvent::ReportingMatched,
        ];
        let mut state = DealState::Pairing;
        for event in events {
            state = transition(state, event).unwrap();
        }
        assert_eq!(state, DealState::Reconciled);
        assert!(transition(DealState::AwaitingApproval, DealEvent::CaptureConfirmed).is_err());
        assert!(transition(DealState::Approved, DealEvent::CaptureConfirmed).is_err());
    }
    #[test]
    fn terminal_and_captured_states_cannot_withdraw_or_lapse() {
        for state in [
            DealState::Captured,
            DealState::Receipted,
            DealState::Reconciled,
            DealState::Refused,
            DealState::Withdrawn,
            DealState::Expired,
            DealState::Failed,
            DealState::Refunded,
            DealState::Disputed,
        ] {
            for event in [
                DealEvent::Withdraw,
                DealEvent::Deadline,
                DealEvent::CaptureConfirmed,
                DealEvent::BeginSettlement,
            ] {
                assert!(transition(state, event).is_err());
            }
        }
        assert_eq!(
            transition(DealState::Authorized, DealEvent::AutoVoid).unwrap(),
            DealState::AutoVoided
        );
        assert!(transition(DealState::Authorized, DealEvent::Deadline).is_err());
    }
    #[test]
    fn purchase_cleared_moves_only_pairing_to_agreed() {
        assert_eq!(
            transition(DealState::Pairing, DealEvent::PurchaseCleared).unwrap(),
            DealState::Agreed
        );
        for state in [
            DealState::Listed,
            DealState::Negotiating,
            DealState::Agreed,
            DealState::Settling,
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Authorized,
            DealState::Captured,
            DealState::Receipted,
            DealState::Reconciled,
            DealState::Withdrawn,
            DealState::Expired,
            DealState::Refused,
            DealState::Mismatch,
            DealState::Failed,
            DealState::Voided,
            DealState::AutoVoided,
            DealState::Refunded,
            DealState::Disputed,
        ] {
            assert!(matches!(
                transition(state, DealEvent::PurchaseCleared),
                Err(DomainError::InvalidTransition { .. })
            ));
        }
    }
    #[test]
    fn terms_amount_hash_and_delivery_are_checked() {
        let mut t = Terms {
            item_ref: ItemRef::new("dock").unwrap(),
            qty: 2,
            unit_price: Money::parse("64.00", Currency::USD).unwrap(),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        };
        assert_eq!(t.amount().unwrap().minor(), 12800);
        let hash = t.hash().unwrap();
        t.qty = 1;
        assert_ne!(hash, t.hash().unwrap());
        t.qty = 0;
        assert!(t.hash().is_err());
        t.qty = 1;
        t.currency = Currency::EUR;
        assert!(t.hash().is_err());
        assert!(Delivery::ShipThenCapture { days: 4 }.validate().is_err());
    }
    #[test]
    fn invoice_uses_ulid_and_attempt_never_display_label() {
        let a = DealId(ulid::Ulid::from(1_u128));
        let b = DealId(ulid::Ulid::from(2_u128));
        assert_ne!(invoice_id(a, 1).unwrap(), invoice_id(b, 1).unwrap());
        assert!(invoice_id(a, 0).is_err());
        assert!(invoice_id(a, 4).is_err());
    }
}
