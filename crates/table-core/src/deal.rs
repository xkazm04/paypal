use crate::{
    Currency, DealId, H256, ItemRef, KeyId, MandateId, Money, MoneyError, PayeeRef, ShieldRelease,
    ShieldRule, ShieldVerdict, Timestamp, commitment,
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
    /// A buyer's deal the seller said was paid (RECEIPTED on the seller's signed receipt alone)
    /// whose payment PayPal's own statement never showed within [`CORROBORATION_SECS`]. An end the
    /// owner reads: this wallet moved no money, and a statement match that comes later still
    /// moves it to RECONCILED.
    Unconfirmed,
}
impl DealState {
    /// Every state, in declaration order (a test pins it to the enum's own serialised names).
    pub const ALL: [Self; 21] = [
        Self::Pairing,
        Self::Listed,
        Self::Negotiating,
        Self::Agreed,
        Self::Settling,
        Self::AwaitingApproval,
        Self::Approved,
        Self::Authorized,
        Self::Captured,
        Self::Receipted,
        Self::Reconciled,
        Self::Withdrawn,
        Self::Expired,
        Self::Refused,
        Self::Mismatch,
        Self::Failed,
        Self::Voided,
        Self::AutoVoided,
        Self::Refunded,
        Self::Disputed,
        Self::Unconfirmed,
    ];
    /// The states a deal frees its budget in: it never agreed, or was given back unpaid. One
    /// list for the exposure fold and for the ledger's SQL filter: [`Self::ALL`] filtered by
    /// [`Self::is_released`], so the two cannot disagree.
    pub const RELEASED: [Self; 5] = {
        let mut out = [Self::Pairing; 5];
        let (mut i, mut n) = (0, 0);
        while i < Self::ALL.len() {
            if Self::ALL[i].is_released() {
                out[n] = Self::ALL[i];
                n += 1;
            }
            i += 1;
        }
        assert!(n == out.len(), "RELEASED's length is is_released's count");
        out
    };
    pub const fn is_released(self) -> bool {
        matches!(
            self,
            Self::Refused | Self::Withdrawn | Self::Expired | Self::Voided | Self::AutoVoided
        )
    }
    /// States in the forward chain from AGREED on: [`Self::through_agreed`] minus the released
    /// ones (a test walks `transition()` to pin it). The one definition behind the exposure fold
    /// and the ledger's per-mandate usage count.
    pub const fn is_agreed_or_later(self) -> bool {
        matches!(
            self,
            Self::Agreed
                | Self::Settling
                | Self::AwaitingApproval
                | Self::Approved
                | Self::Authorized
                | Self::Captured
                | Self::Receipted
                | Self::Reconciled
                | Self::Refunded
                | Self::Disputed
                | Self::Unconfirmed
        )
    }
    /// The states `transition()` reaches only through AGREED, released ones included (EXPIRED,
    /// VOIDED, AUTO_VOIDED): a deal in one has a recorded agreement. A test walks the graph to
    /// pin it. The client's fair price counts as committed in these, as Rust's `fair_price` does
    /// once the agreement row exists.
    pub const fn through_agreed(self) -> bool {
        self.is_agreed_or_later() || matches!(self, Self::Expired | Self::Voided | Self::AutoVoided)
    }
}
/// How long a buyer's deal that only the seller says is paid waits for PayPal's statement to
/// show the payment before it ends UNCONFIRMED: 72 hours. Reporting lags up to 3 hours
/// (.research/paypal-platform.md:36 and :490 [S-spec]); 72 hours is 24 times that lag and gives
/// the owner three days to check the statement. Ending it moves no money and makes no PayPal call.
pub const CORROBORATION_SECS: i64 = 72 * 3600;
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
                | Self::Unconfirmed
        )
    }
    /// Where `transition(self, Withdraw)` is accepted, and where a mismatch or a failure can still
    /// end the deal: before capture, and not a held authorization (that one needs a void).
    pub const fn withdrawable(self) -> bool {
        self.pre_capture() && !matches!(self, Self::Authorized)
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
    /// [`CORROBORATION_SECS`] passed on a buyer's seller-attested RECEIPTED deal with no matching
    /// PayPal statement row. Supplied only by the ledger's corroboration lapse.
    CorroborationLapsed,
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
impl DealEvent {
    /// Every event, in declaration order (a test pins it to the enum), so a walk over
    /// `transition()` can derive the state sets.
    pub const ALL: [Self; 24] = [
        Self::ListingVerified,
        Self::OfferVerified,
        Self::TwoAcceptsVerified,
        Self::PurchaseCleared,
        Self::BeginSettlement,
        Self::SettleVerified,
        Self::OrderApproved,
        Self::AuthorizationConfirmed,
        Self::CaptureConfirmed,
        Self::ReceiptVerified,
        Self::SellerReceiptVerified,
        Self::ReportingMatched,
        Self::CorroborationLapsed,
        Self::Withdraw,
        Self::Deadline,
        Self::Refuse,
        Self::Mismatch,
        Self::Fail,
        Self::Void,
        Self::AutoVoid,
        Self::Refund,
        Self::Dispute,
        Self::RescueOpened,
        Self::InvoiceDrafted,
    ];
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
        (S::Receipted, E::CorroborationLapsed) => S::Unconfirmed,
        // A statement match that comes after the lapse still counts.
        (S::Unconfirmed, E::ReportingMatched) => S::Reconciled,
        (S::Captured | S::Receipted | S::Reconciled, E::Refund) => S::Refunded,
        (S::Captured | S::Receipted | S::Reconciled, E::Dispute) => S::Disputed,
        (S::Authorized, E::Void) => S::Voided,
        (S::Authorized, E::AutoVoid) => S::AutoVoided,
        // A held authorization needs a confirmed void, not a fictitious withdrawal.
        (s, E::Withdraw) if s.withdrawable() => S::Withdrawn,
        (S::Pairing | S::Listed | S::Negotiating | S::Agreed, E::Deadline) => S::Withdrawn,
        (S::Settling | S::AwaitingApproval | S::Approved, E::Deadline) => S::Expired,
        (S::Pairing | S::Listed | S::Negotiating, E::Refuse) => S::Refused,
        (s, E::Mismatch) if s.withdrawable() => S::Mismatch,
        (s, E::Fail) if s.withdrawable() => S::Failed,
        _ => return Err(DomainError::InvalidTransition { state, event }),
    };
    Ok(next)
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
            DealState::Unconfirmed,
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
    fn only_a_receipted_deal_lapses_unconfirmed_and_a_late_statement_match_still_counts() {
        assert_eq!(
            transition(DealState::Receipted, DealEvent::CorroborationLapsed).unwrap(),
            DealState::Unconfirmed
        );
        assert_eq!(
            transition(DealState::Unconfirmed, DealEvent::ReportingMatched).unwrap(),
            DealState::Reconciled
        );
        assert!(DealState::Unconfirmed.terminal());
        assert!(!DealState::Unconfirmed.pre_capture());
        for state in [
            DealState::AwaitingApproval,
            DealState::Approved,
            DealState::Captured,
            DealState::Reconciled,
            DealState::Unconfirmed,
            DealState::Expired,
        ] {
            assert!(transition(state, DealEvent::CorroborationLapsed).is_err());
        }
        for event in [
            DealEvent::Withdraw,
            DealEvent::Deadline,
            DealEvent::Mismatch,
            DealEvent::Fail,
            DealEvent::Void,
            DealEvent::SellerReceiptVerified,
        ] {
            assert!(transition(DealState::Unconfirmed, event).is_err());
        }
        assert_eq!(CORROBORATION_SECS, 24 * 3 * 3600);
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
            DealState::Unconfirmed,
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
    /// Every state `transition()` reaches from `from` without entering `avoid`.
    fn reachable(from: DealState, avoid: Option<DealState>) -> Vec<DealState> {
        let mut seen = vec![from];
        let mut queue = vec![from];
        while let Some(state) = queue.pop() {
            for event in DealEvent::ALL {
                if let Ok(next) = transition(state, event)
                    && Some(next) != avoid
                    && !seen.contains(&next)
                {
                    seen.push(next);
                    queue.push(next);
                }
            }
        }
        seen
    }
    #[test]
    fn every_deal_event_is_listed_once() {
        // Exhaustive: a new event fails to compile here until it is added to ALL.
        let position = |e: DealEvent| match e {
            DealEvent::ListingVerified => 0,
            DealEvent::OfferVerified => 1,
            DealEvent::TwoAcceptsVerified => 2,
            DealEvent::PurchaseCleared => 3,
            DealEvent::BeginSettlement => 4,
            DealEvent::SettleVerified => 5,
            DealEvent::OrderApproved => 6,
            DealEvent::AuthorizationConfirmed => 7,
            DealEvent::CaptureConfirmed => 8,
            DealEvent::ReceiptVerified => 9,
            DealEvent::SellerReceiptVerified => 10,
            DealEvent::ReportingMatched => 11,
            DealEvent::CorroborationLapsed => 12,
            DealEvent::Withdraw => 13,
            DealEvent::Deadline => 14,
            DealEvent::Refuse => 15,
            DealEvent::Mismatch => 16,
            DealEvent::Fail => 17,
            DealEvent::Void => 18,
            DealEvent::AutoVoid => 19,
            DealEvent::Refund => 20,
            DealEvent::Dispute => 21,
            DealEvent::RescueOpened => 22,
            DealEvent::InvoiceDrafted => 23,
        };
        for (i, event) in DealEvent::ALL.into_iter().enumerate() {
            assert_eq!(position(event), i, "{event:?}");
        }
    }
    #[test]
    fn withdrawable_is_exactly_where_transition_accepts_withdraw() {
        for state in DealState::ALL {
            assert_eq!(
                state.withdrawable(),
                transition(state, DealEvent::Withdraw).is_ok(),
                "{state:?}"
            );
        }
        assert!(!DealState::Authorized.withdrawable());
        assert!(DealState::Approved.withdrawable());
    }
    #[test]
    fn agreement_sets_are_the_transition_graph_through_agreed() {
        // Through AGREED: reachable from PAIRING, but not once AGREED is walled off.
        let all = reachable(DealState::Pairing, None);
        let around = reachable(DealState::Pairing, Some(DealState::Agreed));
        for state in DealState::ALL {
            assert!(all.contains(&state), "{state:?} is unreachable");
            let through = !around.contains(&state);
            assert_eq!(state.through_agreed(), through, "{state:?}");
            assert_eq!(
                state.is_agreed_or_later(),
                through && !state.is_released(),
                "{state:?}"
            );
        }
        for state in [DealState::Expired, DealState::Voided, DealState::AutoVoided] {
            assert!(state.through_agreed() && state.is_released(), "{state:?}");
        }
        assert!(!DealState::Mismatch.through_agreed());
        let released: Vec<DealState> = DealState::ALL
            .into_iter()
            .filter(|s| s.is_released())
            .collect();
        assert_eq!(released, DealState::RELEASED);
    }
}
