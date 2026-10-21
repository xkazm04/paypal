use crate::agent::Error;
use serde::{Deserialize, Serialize};
use table_core::*;
use table_proto::ReasonCode;
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Negotiator,
    Shopper,
    Assistant,
}
impl AgentRole {
    /// The fixed playbook a native engine in this role starts from.
    pub const fn playbook(self, side: Side) -> Playbook {
        match (self, side) {
            (Self::Negotiator, Side::Buyer) => Playbook::BuyerHaggler,
            (Self::Negotiator, Side::Seller) => Playbook::SellerCounter,
            (Self::Shopper, _) => Playbook::Shopper,
            (Self::Assistant, _) => Playbook::ShopAssistant,
        }
    }
}
#[derive(Debug, Clone)]
pub struct AgentScope {
    pub deal_id: DealId,
    pub role: AgentRole,
    pub category: Category,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OfferInput {
    pub deal_id: DealId,
    pub price: String,
    pub delivery: Delivery,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WithdrawInput {
    pub deal_id: DealId,
    pub reason: ReasonCode,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurchaseLine {
    #[serde(rename = "ref")]
    pub item_ref: ItemRef,
    pub qty: u32,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PurchaseInput {
    pub payee_ref: PayeeRef,
    pub items: Vec<PurchaseLine>,
    pub amount: String,
    pub category: Category,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewInput {
    pub deal_id: Option<DealId>,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcceptInput {
    pub deal_id: DealId,
    pub offer_seq: u32,
}
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketInput {
    pub item_ref: ItemRef,
}
#[derive(Debug, Clone)]
pub enum AgentRequest {
    Accept(AcceptInput),
    View(ViewInput),
    Offer(OfferInput),
    Withdraw(WithdrawInput),
    Purchase(PurchaseInput),
    Market(MarketInput),
    Book(BookQuery),
}
impl AgentRequest {
    /// The MCP tool this request came from.
    pub const fn tool(&self) -> &'static str {
        match self {
            Self::Accept(_) => "accept_offer",
            Self::View(_) => "table_view",
            Self::Offer(_) => "send_offer",
            Self::Withdraw(_) => "withdraw_offer",
            Self::Purchase(_) => "propose_purchase",
            Self::Market(_) => "market_reference",
            Self::Book(_) => "book_query",
        }
    }
    pub fn decode(name: &str, value: serde_json::Value) -> Result<Self, Error> {
        match name {
            "accept_offer" => serde_json::from_value(value).map(Self::Accept),
            "table_view" => serde_json::from_value(value).map(Self::View),
            "send_offer" => serde_json::from_value(value).map(Self::Offer),
            "withdraw_offer" => serde_json::from_value(value).map(Self::Withdraw),
            "propose_purchase" => serde_json::from_value(value).map(Self::Purchase),
            "market_reference" => serde_json::from_value(value).map(Self::Market),
            "book_query" => serde_json::from_value(value).map(Self::Book),
            _ => return Err(Error::Unavailable),
        }
        .map_err(|_| Error::Invalid)
    }
}
/// This interface contains no network executor or authority method.
pub trait AgentService: Send {
    fn invoke(
        &mut self,
        scope: &AgentScope,
        request: AgentRequest,
        now: Timestamp,
    ) -> Result<serde_json::Value, Error>;
    /// Records a call refused before it reached invoke (session not enabled, a tool outside the
    /// role's catalog, a malformed call), so reaching for a missing money tool leaves a trace.
    /// `invoke` records its own refusals: every refused call leaves exactly one row.
    fn record_refusal(
        &mut self,
        scope: &AgentScope,
        tool: &str,
        code: RefusalCode,
        now: Timestamp,
    ) -> Result<(), Error>;
}
