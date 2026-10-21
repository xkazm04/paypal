use crate::{DealId, Timestamp};
use serde::{Deserialize, Serialize};

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
    /// For a deal that ended UNCONFIRMED: true when a statement read of PayPal came back
    /// unmatched before it ended, false when no read was made; null for any other deal. Older
    /// shells omit it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub statement_unmatched: Option<bool>,
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
