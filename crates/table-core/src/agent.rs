//! What an agent sees at the table, what it is told when the wallet says no, and the fixed role
//! playbooks it starts from (design report §6.4). Pure: the ledger supplies the inputs.
//!
//! Every type here is closed. No field is a free `String`: identifiers are the restricted id
//! types, prices are `Money`, everything else is an enum, a number or a time. So counterparty
//! words (a NOTE, a display name, a listing title) cannot reach an agent through this module by
//! type, not by the caller happening to leave them out.
use crate::{
    Currency, Deal, DealId, DealKind, DealState, Delivery, ENVELOPE_CLAUSE, EnvelopeLimit, ItemRef,
    Money, Refusal, ShieldRule, Side, Timestamp, TranscriptBy, TranscriptStep, TranscriptType,
    market_fresh,
};
use serde::{Deserialize, Serialize};

/// Who sits across the table, as a fixed label. Never a name the other side chose.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableCounterparty {
    House,
    PairedWallet,
    Unpaired,
}
/// Where the deal is, in the words an agent needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TablePhase {
    Pairing,
    Listed,
    Negotiating,
    Agreed,
    /// Agreed and being paid at PayPal (order made, awaiting approval, approved or on hold).
    Settling,
    Paid,
    Closed,
}
impl TablePhase {
    pub const fn of(state: DealState) -> Self {
        use DealState as S;
        match state {
            S::Pairing => Self::Pairing,
            S::Listed => Self::Listed,
            S::Negotiating => Self::Negotiating,
            S::Agreed => Self::Agreed,
            S::Settling | S::AwaitingApproval | S::Approved | S::Authorized => Self::Settling,
            S::Captured | S::Receipted | S::Reconciled => Self::Paid,
            S::Withdrawn
            | S::Expired
            | S::Refused
            | S::Mismatch
            | S::Failed
            | S::Voided
            | S::AutoVoided
            | S::Refunded
            | S::Disputed
            // PayPal never showed the seller's payment: an end, never paid.
            | S::Unconfirmed => Self::Closed,
        }
    }
    /// Bargaining is possible: an offer can still go out.
    pub const fn open(self) -> bool {
        matches!(self, Self::Listed | Self::Negotiating)
    }
}
/// A signed step of the transcript, prices only. NOTE, HELLO and APPROVED never appear.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableAct {
    Listing,
    Offer,
    Counter,
    Accept,
    Withdraw,
    Settle,
    Receipt,
}
impl From<TranscriptType> for TableAct {
    fn from(t: TranscriptType) -> Self {
        match t {
            TranscriptType::Listing => Self::Listing,
            TranscriptType::Offer => Self::Offer,
            TranscriptType::Counter => Self::Counter,
            TranscriptType::Accept => Self::Accept,
            TranscriptType::Withdraw => Self::Withdraw,
            TranscriptType::Settle => Self::Settle,
            TranscriptType::Receipt => Self::Receipt,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableStep {
    pub seq: u32,
    pub by: TranscriptBy,
    pub act: TableAct,
    pub price: Option<Money>,
    pub at: Timestamp,
}
/// Whose move it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableTurn {
    Yours,
    Theirs,
    /// Bargaining is over (or has not begun): nobody moves at the table.
    None,
}
/// The signed band clause (clause 4) as its owner signed it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BandTerms {
    pub floor: Option<Money>,
    pub ceiling: Option<Money>,
    pub max_rounds: u8,
    pub deadline: Timestamp,
}
/// The band the agent may use: the signed numbers plus the rounds it has spent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableBand {
    pub floor: Option<Money>,
    pub ceiling: Option<Money>,
    pub max_rounds: u8,
    pub rounds_used: u32,
    pub rounds_left: u32,
    pub deadline: Timestamp,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TableMarket {
    pub p25: Money,
    pub median: Money,
    pub p75: Money,
    pub retrieved_at: Timestamp,
    pub fresh: bool,
}
/// The negotiator's tools, by their MCP names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentTool {
    TableView,
    MarketReference,
    SendOffer,
    AcceptOffer,
    WithdrawOffer,
}
impl AgentTool {
    pub const fn name(self) -> &'static str {
        match self {
            Self::TableView => "table_view",
            Self::MarketReference => "market_reference",
            Self::SendOffer => "send_offer",
            Self::AcceptOffer => "accept_offer",
            Self::WithdrawOffer => "withdraw_offer",
        }
    }
}
/// The most recent steps an agent is shown; older ones are dropped (rounds are bounded anyway).
pub const TABLE_HISTORY_MAX: usize = 64;

/// What `table_view` returns and what a native run starts from (design §6.4 "What the agent
/// sees"). Never serialised into an outbound envelope: envelope bodies are their own closed enum.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AgentProjection {
    pub deal_id: DealId,
    pub side: Side,
    pub kind: DealKind,
    pub counterparty: TableCounterparty,
    /// The item identifier (a restricted id, never a title). It must sit in the owner's signed
    /// band for any offer to pass.
    pub item_ref: ItemRef,
    pub qty: u32,
    pub currency: Currency,
    pub delivery: Delivery,
    pub phase: TablePhase,
    /// The unit price on the table now (the latest either side signed, or the listing).
    pub price: Money,
    pub our_last_price: Option<Money>,
    pub their_last_price: Option<Money>,
    /// The `offer_seq` `accept_offer` needs while an offer waits; null otherwise.
    pub pending_offer_seq: Option<u32>,
    /// Null when the deal's rules carry no band (then no offer can pass).
    pub band: Option<TableBand>,
    /// The earliest of the band's deadline and the deal's own lapse time.
    pub deadline: Timestamp,
    pub market: Option<TableMarket>,
    pub history: Vec<TableStep>,
    pub turn: TableTurn,
    pub allowed: Vec<AgentTool>,
    pub now: Timestamp,
}
/// The typed facts the ledger hands over. Nothing here is counterparty text either.
#[derive(Debug, Clone, Copy)]
pub struct ProjectionInput<'a> {
    pub deal: &'a Deal,
    pub band: Option<BandTerms>,
    /// Our own OFFER/COUNTER envelopes so far (what clause 4 counts).
    pub rounds_used: u32,
    pub steps: &'a [TranscriptStep],
    /// The negotiation row: the offer an ACCEPT names, and whether we already accepted it.
    pub offer_seq: Option<u32>,
    pub own_accept: bool,
    pub counterparty: TableCounterparty,
    /// When the deal lapses by itself (its silence deadline), if one is set.
    pub lapses_at: Option<Timestamp>,
    pub now: Timestamp,
}
impl AgentProjection {
    pub fn build(input: ProjectionInput<'_>) -> Self {
        let deal = input.deal;
        let phase = TablePhase::of(deal.state);
        let history: Vec<TableStep> = input
            .steps
            .iter()
            .map(|s| TableStep {
                seq: s.seq,
                by: s.by,
                act: s.typ.into(),
                price: s.price,
                at: s.at,
            })
            .collect();
        let history = history[history.len().saturating_sub(TABLE_HISTORY_MAX)..].to_vec();
        let last_price = |by: TranscriptBy| {
            input
                .steps
                .iter()
                .rev()
                .find(|s| {
                    s.by == by
                        && matches!(
                            s.typ,
                            TranscriptType::Listing
                                | TranscriptType::Offer
                                | TranscriptType::Counter
                        )
                })
                .and_then(|s| s.price)
        };
        let band = input.band.map(|b| TableBand {
            floor: b.floor,
            ceiling: b.ceiling,
            max_rounds: b.max_rounds,
            rounds_used: input.rounds_used,
            rounds_left: u32::from(b.max_rounds).saturating_sub(input.rounds_used),
            deadline: b.deadline,
        });
        let deadline = match (band.map(|b| b.deadline), input.lapses_at) {
            (Some(a), Some(b)) => a.min(b),
            (Some(a), None) | (None, Some(a)) => a,
            // No band and no lapse time: nothing can be signed under clause 4 anyway.
            (None, None) => input.now,
        };
        let latest = input
            .steps
            .iter()
            .rev()
            .find(|s| s.typ != TranscriptType::Settle && s.typ != TranscriptType::Receipt);
        let turn = if !phase.open() {
            TableTurn::None
        } else {
            match latest {
                Some(s) if s.by == TranscriptBy::You => TableTurn::Theirs,
                Some(s) if s.typ == TranscriptType::Withdraw => TableTurn::None,
                _ => TableTurn::Yours,
            }
        };
        let market = deal.market.as_ref().map(|m| TableMarket {
            p25: m.p25,
            median: m.median,
            p75: m.p75,
            retrieved_at: m.retrieved_at,
            fresh: market_fresh(Some(m), input.now),
        });
        let mut view = Self {
            deal_id: deal.id,
            side: deal.side,
            kind: deal.kind,
            counterparty: input.counterparty,
            item_ref: deal.terms.item_ref.clone(),
            qty: deal.terms.qty,
            currency: deal.terms.currency,
            delivery: deal.terms.delivery.clone(),
            phase,
            price: deal.terms.unit_price,
            our_last_price: last_price(TranscriptBy::You),
            their_last_price: last_price(TranscriptBy::Them),
            pending_offer_seq: None,
            band,
            deadline,
            market,
            history,
            turn,
            allowed: Vec::new(),
            now: input.now,
        };
        // An offer waits for us when the other side proposed last, or accepted ours and we have
        // not countersigned yet.
        let waiting = match latest {
            Some(s) if s.by == TranscriptBy::Them => match s.typ.into() {
                TableAct::Offer | TableAct::Counter => true,
                TableAct::Accept => !input.own_accept,
                _ => false,
            },
            _ => false,
        };
        if phase == TablePhase::Negotiating && waiting {
            view.pending_offer_seq = input.offer_seq;
        }
        view.allowed = [
            AgentTool::TableView,
            AgentTool::MarketReference,
            AgentTool::SendOffer,
            AgentTool::AcceptOffer,
            AgentTool::WithdrawOffer,
        ]
        .into_iter()
        .filter(|tool| view.refusal(*tool, deal).is_none())
        .collect();
        view
    }
    /// Why `tool` cannot succeed now, from the table alone; `None` when the wallet would go on to
    /// its mandate check. The wallet runs this before every agent intent, so `allowed` and the
    /// refusals never disagree.
    pub fn refusal(&self, tool: AgentTool, deal: &Deal) -> Option<RefusalCode> {
        let shield = deal.shield_held().then_some(RefusalCode::ShieldHold {
            rule: deal.shield_rule,
        });
        let before_deadline = self.now < self.deadline;
        match tool {
            AgentTool::TableView => None,
            AgentTool::MarketReference => match &self.market {
                Some(m) if m.fresh => None,
                _ => Some(RefusalCode::MarketUnavailable),
            },
            AgentTool::SendOffer => shield.or(if !self.phase.open() {
                Some(RefusalCode::TableClosed)
            } else if !before_deadline {
                Some(RefusalCode::DeadlinePassed)
            } else if self.band.is_some_and(|b| b.rounds_left == 0) {
                Some(RefusalCode::RoundsExhausted)
            } else if self.turn != TableTurn::Yours {
                Some(RefusalCode::NotYourTurn)
            } else if self.band.is_none() {
                Some(RefusalCode::MandateClause { clause: 4 })
            } else {
                None
            }),
            AgentTool::AcceptOffer => shield.or(if !self.phase.open() {
                Some(RefusalCode::TableClosed)
            } else if !before_deadline {
                Some(RefusalCode::DeadlinePassed)
            } else if self.pending_offer_seq.is_none() {
                Some(RefusalCode::NotYourTurn)
            } else {
                None
            }),
            AgentTool::WithdrawOffer => {
                if crate::transition(deal.state, crate::DealEvent::Withdraw).is_ok() {
                    None
                } else {
                    Some(RefusalCode::TableClosed)
                }
            }
        }
    }
}

/// Why the wallet said no to an agent, as a closed code. It is what the agent hears (with a
/// fixed sentence) and what `intent.refused` records. No variant carries text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "snake_case", deny_unknown_fields)]
pub enum RefusalCode {
    /// A signed mandate clause refused (roles, counterparty, per deal, band, velocity, payees,
    /// fixes).
    MandateClause { clause: u8 },
    /// The owner's wallet-wide limits refused (clause 0); the limit when it is known.
    WalletLimit { limit: Option<EnvelopeLimit> },
    /// Clause 4: the price is outside the signed band (the refusal's detail names the bound).
    OutsideBand,
    /// Clause 4: no rounds left.
    RoundsExhausted,
    /// Clause 4 (or the deal's lapse time): too late to sign anything.
    DeadlinePassed,
    /// The decision is above the owner's in-person threshold (clause 6): only the owner can make
    /// it.
    OwnerApproval { clause: u8 },
    /// Shop around: another table of the same group agreed or holds the one ACCEPT.
    GroupClosed,
    /// The scam shield holds the deal for its owner; the rule that raised it when recorded.
    ShieldHold { rule: Option<ShieldRule> },
    /// Our own proposal is the latest: wait for the other side.
    NotYourTurn,
    /// The deal is past bargaining (or the step does not apply to it any more).
    TableClosed,
    /// The owner paused every agent.
    Paused,
    /// The run this call belongs to has ended, expired or was replaced.
    RunEnded,
    /// The session's grant is not enabled yet.
    SessionNotEnabled,
    /// No such tool for this role (for example any money tool: none exists).
    ToolAbsent,
    /// The call or its arguments do not match the tool's schema.
    MalformedCall,
    /// Another deal, another item or another role than this run was started for.
    OutOfScope,
    /// No fresh market reference is cached for this item.
    MarketUnavailable,
    /// The wallet could not use the request (a wrong offer number, a bad price string).
    InvalidRequest,
    /// The wallet could not answer.
    Unavailable,
}
impl RefusalCode {
    /// Every code, one value per variant, for docs and tests.
    pub const ALL: [Self; 19] = [
        Self::MandateClause { clause: 3 },
        Self::WalletLimit { limit: None },
        Self::OutsideBand,
        Self::RoundsExhausted,
        Self::DeadlinePassed,
        Self::OwnerApproval { clause: 6 },
        Self::GroupClosed,
        Self::ShieldHold { rule: None },
        Self::NotYourTurn,
        Self::TableClosed,
        Self::Paused,
        Self::RunEnded,
        Self::SessionNotEnabled,
        Self::ToolAbsent,
        Self::MalformedCall,
        Self::OutOfScope,
        Self::MarketUnavailable,
        Self::InvalidRequest,
        Self::Unavailable,
    ];
    /// The code's wire name.
    pub const fn tag(self) -> &'static str {
        match self {
            Self::MandateClause { .. } => "mandate_clause",
            Self::WalletLimit { .. } => "wallet_limit",
            Self::OutsideBand => "outside_band",
            Self::RoundsExhausted => "rounds_exhausted",
            Self::DeadlinePassed => "deadline_passed",
            Self::OwnerApproval { .. } => "owner_approval",
            Self::GroupClosed => "group_closed",
            Self::ShieldHold { .. } => "shield_hold",
            Self::NotYourTurn => "not_your_turn",
            Self::TableClosed => "table_closed",
            Self::Paused => "paused",
            Self::RunEnded => "run_ended",
            Self::SessionNotEnabled => "session_not_enabled",
            Self::ToolAbsent => "tool_absent",
            Self::MalformedCall => "malformed_call",
            Self::OutOfScope => "out_of_scope",
            Self::MarketUnavailable => "market_unavailable",
            Self::InvalidRequest => "invalid_request",
            Self::Unavailable => "unavailable",
        }
    }
    /// The signed clause behind the code, when a clause refused.
    pub const fn clause(self) -> Option<u8> {
        match self {
            Self::MandateClause { clause } | Self::OwnerApproval { clause } => Some(clause),
            Self::OutsideBand | Self::RoundsExhausted | Self::DeadlinePassed => Some(4),
            Self::WalletLimit { .. } => Some(ENVELOPE_CLAUSE),
            _ => None,
        }
    }
    /// The fixed sentence the agent hears. Never built from counterparty input.
    pub const fn text(self) -> &'static str {
        match self {
            Self::MandateClause { .. } => {
                "A rule your owner signed does not allow this. Nothing moved. Do not retry it."
            }
            Self::WalletLimit { .. } => {
                "Your owner's wallet-wide limit does not allow this. Nothing moved. Stop."
            }
            Self::OutsideBand => {
                "The price is outside the signed price range. Nothing moved. Retry inside the range."
            }
            Self::RoundsExhausted => {
                "No offers are left in the signed range. Accept their price if it is inside the range, or withdraw."
            }
            Self::DeadlinePassed => "The deadline has passed. Nothing more can be signed. Stop.",
            Self::OwnerApproval { .. } => {
                "This needs your owner in person. Nothing moved. Do not retry it."
            }
            Self::GroupClosed => "Another table in the same search already agreed. Stop.",
            Self::ShieldHold { .. } => "The scam shield holds this deal for your owner. Stop.",
            Self::NotYourTurn => "It is not your turn. Wait for the other side.",
            Self::TableClosed => "This deal is past bargaining. Stop.",
            Self::Paused => "Your owner paused every agent. Stop.",
            Self::RunEnded => "This session has ended. Stop.",
            Self::SessionNotEnabled => "This session is not enabled yet. Stop.",
            Self::ToolAbsent => "No such tool. Use only the tools you were given.",
            Self::MalformedCall => "The call does not match the tool's schema. Fix the arguments.",
            Self::OutOfScope => "This is not the deal, item or role this session was started for.",
            Self::MarketUnavailable => "No fresh market price is cached for this item.",
            Self::InvalidRequest => {
                "The wallet could not use this request. Read the table again and fix it."
            }
            Self::Unavailable => "The wallet could not answer. Stop.",
        }
    }
    /// The code for a mandate or wallet-limit refusal. Clause 4's band reasons get their own
    /// codes; every other clause is named by number.
    pub fn from_refusal(refusal: &Refusal) -> Self {
        if refusal.clause == ENVELOPE_CLAUSE {
            let limit = [
                EnvelopeLimit::OutDay,
                EnvelopeLimit::Held,
                EnvelopeLimit::DealsDay,
                EnvelopeLimit::Currency,
                EnvelopeLimit::Expired,
                EnvelopeLimit::Unverified,
            ]
            .into_iter()
            .find(|l| {
                refusal
                    .reason
                    .strip_prefix(l.name())
                    .is_some_and(|rest| rest.starts_with(':'))
            });
            return Self::WalletLimit { limit };
        }
        if refusal.clause == 4 {
            if refusal.reason == crate::DEADLINE_REACHED {
                return Self::DeadlinePassed;
            }
            if refusal.reason == crate::MAX_ROUNDS_REACHED {
                return Self::RoundsExhausted;
            }
            if refusal.reason.starts_with(crate::BAND_PRICE) {
                return Self::OutsideBand;
            }
        }
        Self::MandateClause {
            clause: refusal.clause,
        }
    }
    /// What the agent receives as the structured part of an `isError` result: the code's fields,
    /// the clause when one refused, and the fixed sentence.
    pub fn wire(self) -> serde_json::Value {
        let mut value = serde_json::to_value(self).unwrap_or_else(|_| serde_json::json!({}));
        if let Some(object) = value.as_object_mut() {
            object.insert("clause".into(), serde_json::json!(self.clause()));
            object.insert("text".into(), self.text().into());
        }
        value
    }
}

/// The fixed per-role system prompts a native engine starts from (compiled in from
/// `prompts/*.md`). They describe the role's tools, the table fields and the refusal codes, and
/// carry no placeholder: nothing at run time is spliced into them.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Playbook {
    /// A negotiator buying at a haggle table.
    BuyerHaggler,
    /// A negotiator selling: answers offers with counters.
    SellerCounter,
    /// Proposes one purchase from an approved shop.
    Shopper,
    /// Reads the owner's own records (read-only).
    ShopAssistant,
}
impl Playbook {
    pub const ALL: [Self; 4] = [
        Self::BuyerHaggler,
        Self::SellerCounter,
        Self::Shopper,
        Self::ShopAssistant,
    ];
    pub const fn text(self) -> &'static str {
        match self {
            Self::BuyerHaggler => include_str!("../../../prompts/buyer-haggler.md"),
            Self::SellerCounter => include_str!("../../../prompts/seller-counter.md"),
            Self::Shopper => include_str!("../../../prompts/shopper.md"),
            Self::ShopAssistant => include_str!("../../../prompts/shop-assistant.md"),
        }
    }
    pub const fn name(self) -> &'static str {
        match self {
            Self::BuyerHaggler => "buyer_haggler",
            Self::SellerCounter => "seller_counter",
            Self::Shopper => "shopper",
            Self::ShopAssistant => "shop_assistant",
        }
    }
}

#[cfg(test)]
#[path = "agent_tests.rs"]
mod tests;
