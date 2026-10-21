//! The rescue and shop-around group DTOs.
use serde::{Deserialize, Serialize};
use table_core::DealId;
use ts_rs::TS;
/// A failed renewal and its one fix, as the wallet computed and stored it. No subscriber or
/// agent text: the invoice wording is the wallet's fixed template filled with these numbers.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueView {
    pub deal_id: DealId,
    pub source: table_core::RescueSource,
    pub offer: table_core::RescueOffer,
    pub text: table_core::InvoiceText,
    pub failed_payments: u32,
    /// PayPal's own next retry, when known.
    #[ts(optional = nullable)]
    pub next_retry_at: Option<i64>,
    /// The subscriber's address, masked ("s•••@example.com").
    pub recipient: String,
    /// The PayPal invoice, once made.
    #[ts(optional = nullable)]
    pub invoice: Option<String>,
    /// PayPal showed it paid and the wallet receipted it, on a failure PayPal reported: this is
    /// the only money counted as recovered.
    pub counted: bool,
}
/// Shop around (T8): group open buyer tables for one item, each with a different paired seller,
/// under one signed mandate. The first table to agree wins; the wallet withdraws the others with
/// a signed WITHDRAW. Grouping only restricts: it moves no money and grants nothing.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealGroupOpenArgs {
    pub deal_ids: Vec<DealId>,
}
/// One table of a shop-around group: typed, signed prices only (never the seller's words).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct GroupTable {
    pub deal_id: DealId,
    pub counterparty: table_core::KeyId,
    pub state: table_core::DealState,
    /// The seller's latest signed price (listing or counter); null before any.
    pub seller_price: Option<table_core::Money>,
    /// Our latest signed offer; null before any.
    pub our_price: Option<table_core::Money>,
    /// Withdrawn by the group rule because another table agreed first.
    pub closed_by_group: bool,
}
/// A shop-around group as the owner sees it: one buyer intent, several sellers, one winner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct DealGroupView {
    pub group_id: table_core::GroupId,
    pub item_ref: table_core::ItemRef,
    pub opened_at: i64,
    /// The table that agreed; null while the sellers are still bargaining.
    pub winner: Option<DealId>,
    /// Oldest table first.
    pub tables: Vec<GroupTable>,
}
/// Every rescue, and the recovered money (one total per currency, never summed across them).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueBook {
    pub cases: Vec<RescueView>,
    pub recovered: Vec<table_core::Money>,
    /// The owner's own subscriptions the wallet reads for a failed renewal, oldest first.
    pub watching: Vec<RescueWatchView>,
    /// Subscription reads made today (UTC) and the most the wallet makes in a day.
    pub watch_reads_today: u32,
    pub watch_reads_max: u32,
}
/// Watch one of the owner's own subscriptions for a failed renewal (approval, privileged). The
/// wallet reads it from PayPal every few hours, read only; a failure opens one fix that waits for
/// the owner, PayPal-reported, so what it brings in can count.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchArgs {
    /// The PayPal subscription id to watch.
    pub subscription_id: String,
    /// The subscriber's email address a fix's invoice goes to, as the owner enters it (the
    /// subscription read does not supply it).
    pub subscriber_email: String,
    /// The plan, as your own item name.
    pub plan: table_core::ItemRef,
}
/// Stop watching one subscription (approval, privileged). A fix it already opened is unchanged.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchStopArgs {
    pub subscription_id: String,
}
/// What the wallet last learned about a watched subscription.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RescueWatchState {
    /// Not read yet.
    Waiting,
    /// The last read showed no failed payment.
    Paid,
    /// The current failure already has its one fix.
    FixOpened,
    /// A failure the wallet does not fix on its own (more than one cycle owed, or the rules do
    /// not allow a fix): it is shown, nothing is sent.
    FailedNoFix,
    /// The last reads could not be used; the wallet tries again later.
    CantRead,
}
/// One watched subscription, as the Rescue page and the approval window show it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueWatchView {
    pub subscription_id: String,
    /// The subscriber's address, masked ("s•••@example.com").
    pub recipient: String,
    pub plan: table_core::ItemRef,
    pub state: RescueWatchState,
    pub added_at: i64,
    #[ts(optional = nullable)]
    pub last_read_at: Option<i64>,
    pub next_read_at: i64,
}
/// A failed renewal the owner records as a labelled replay: PayPal documents no way to fail a
/// sandbox renewal. The deal carries the REPLAY mode; its invoice is real, never counted.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
pub struct RescueReplayArgs {
    /// The PayPal subscription id the failure is about.
    pub subscription_id: String,
    /// The subscriber's email address the invoice goes to.
    pub subscriber_email: String,
    /// The plan, as your own item name.
    pub plan: table_core::ItemRef,
    /// The cycle's price at the plan.
    pub amount: table_core::Money,
}
