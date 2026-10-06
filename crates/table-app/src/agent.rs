use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use table_core::*;
use table_ledger::{AuditEntry, Direction, Ledger, LedgerError};
use table_proto::{
    AgentSigner, Body, Envelope, ProtocolError, ReasonCode, VerifiedEnvelope, VerifyContext, verify,
};
use thiserror::Error;
#[derive(Debug, Error)]
pub enum Error {
    #[error(transparent)]
    Refused(#[from] Refusal),
    #[error(transparent)]
    Ledger(#[from] LedgerError),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    #[error(transparent)]
    Domain(#[from] DomainError),
    #[error("invalid intent")]
    Invalid,
    #[error("operation unavailable")]
    Unavailable,
    #[error("permission denied")]
    Permission,
    #[error("LOCKED")]
    Locked,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Negotiator,
    Shopper,
    Assistant,
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
    fn record_refusal(
        &mut self,
        scope: &AgentScope,
        tool: &str,
        reason: &str,
        now: Timestamp,
    ) -> Result<(), Error>;
}
#[derive(Debug)]
pub struct Wallet {
    pub ledger: Ledger,
    pub(crate) signer: AgentSigner,
    pub(crate) owner: VerifyingKey,
}
impl Wallet {
    pub fn check_mandate(
        &self,
        id: DealId,
        category: Category,
        now: Timestamp,
    ) -> Result<MandateDecision, Error> {
        self.mandate_check(&self.ledger.get_deal(id)?, category, now)
    }
    /// The native actor chooses this from a mandate's pinned agent key, never model input.
    pub fn select_signer(&mut self, signer: AgentSigner) {
        self.signer = signer;
    }
    pub fn agent_public_key(&self) -> VerifyingKey {
        self.signer.public_key()
    }
    pub(crate) fn settlement_payee(&self, deal: &Deal) -> Result<PayeeRef, Error> {
        if deal.side == Side::Buyer {
            return Ok(self.ledger.counterparty_policy(&deal.counterparty)?.2);
        }
        let m = self
            .ledger
            .active_mandate(deal.mandate_id, deal.mandate_version, &self.owner)?;
        let payees = m
            .payload
            .clauses
            .iter()
            .find_map(|c| {
                if let Clause::Payees { payees } = c {
                    Some(payees)
                } else {
                    None
                }
            })
            .ok_or(Error::Invalid)?;
        let [payee] = payees.as_slice() else {
            return Err(Error::Invalid);
        };
        Ok(payee.clone())
    }
    pub fn accept(
        &mut self,
        id: DealId,
        offer_seq: u32,
        category: Category,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.ledger.get_deal(id)?;
        if matches!(
            self.mandate_check(&deal, category, now)?,
            MandateDecision::Ask { .. }
        ) {
            return Err(Error::Permission);
        }
        let (seq, hash) = self.ledger.pending_offer(id)?;
        if seq != offer_seq || hash != deal.terms.hash()? {
            return Err(Error::Invalid);
        }
        let envelope = self.signed(
            &deal,
            Body::Accept {
                offer_seq,
                terms_hash: hash,
                owner_accept: None,
            },
            now,
        )?;
        self.ledger
            .commit_negotiation(&envelope, Direction::Outbound, None, None, now)?;
        Ok(envelope.raw().into())
    }
    pub fn receive_haggle(
        &mut self,
        id: DealId,
        raw: &str,
        category: Category,
        now: Timestamp,
    ) -> Result<(), Error> {
        let verified = self.ledger.preview_inbound(id, raw, now)?;
        let mut deal = self.ledger.get_deal(id)?;
        let (terms, event) = match &verified.envelope().body {
            Body::Listing {
                item_ref,
                ask,
                delivery,
            } => {
                if deal.side != Side::Buyer
                    || *item_ref != deal.terms.item_ref
                    || *ask != deal.terms.unit_price
                    || *delivery != deal.terms.delivery
                {
                    return Err(Error::Invalid);
                }
                (None, Some(DealEvent::ListingVerified))
            }
            Body::Offer { price, delivery } if deal.side == Side::Seller => {
                deal.terms.unit_price = *price;
                deal.terms.delivery = delivery.clone();
                self.mandate_check(&deal, category, now)?;
                (Some(deal.terms), Some(DealEvent::OfferVerified))
            }
            Body::Counter { price, delivery } if deal.side == Side::Buyer => {
                deal.terms.unit_price = *price;
                deal.terms.delivery = delivery.clone();
                self.mandate_check(&deal, category, now)?;
                (Some(deal.terms), Some(DealEvent::OfferVerified))
            }
            Body::Accept { .. } => {
                self.mandate_check(&deal, category, now)?;
                (None, None)
            }
            Body::Withdraw { .. } => (None, Some(DealEvent::Withdraw)),
            // Human-only quarantined words: kept in the signed transcript for the owner, never an
            // intent (no mandate check applies, no state changes) and never in an agent projection.
            Body::Note { .. } => (None, None),
            _ => return Err(Error::Invalid),
        };
        self.ledger.commit_negotiation(
            &verified,
            Direction::Inbound,
            terms.as_ref(),
            event,
            now,
        )?;
        Ok(())
    }
    pub fn list(&mut self, id: DealId, now: Timestamp) -> Result<String, Error> {
        let deal = self.ledger.get_deal(id)?;
        if deal.side != Side::Seller {
            return Err(Error::Permission);
        }
        let envelope = self.signed(
            &deal,
            Body::Listing {
                item_ref: deal.terms.item_ref.clone(),
                ask: deal.terms.unit_price,
                delivery: deal.terms.delivery.clone(),
            },
            now,
        )?;
        self.ledger.commit_negotiation(
            &envelope,
            Direction::Outbound,
            None,
            Some(DealEvent::ListingVerified),
            now,
        )?;
        Ok(envelope.raw().into())
    }
    pub fn new(ledger: Ledger, signer: AgentSigner, owner: VerifyingKey) -> Self {
        Self {
            ledger,
            signer,
            owner,
        }
    }
    pub(crate) fn mandate_check(
        &self,
        deal: &Deal,
        category: Category,
        now: Timestamp,
    ) -> Result<MandateDecision, Error> {
        self.mandate_check_rounds(deal, category, now, false)
    }
    fn mandate_check_rounds(
        &self,
        deal: &Deal,
        category: Category,
        now: Timestamp,
        proposing: bool,
    ) -> Result<MandateDecision, Error> {
        let m = self
            .ledger
            .active_mandate(deal.mandate_id, deal.mandate_version, &self.owner)?;
        if m.payload.agent_key != self.signer.public_key().to_bytes() {
            return Err(Error::Permission);
        }
        let (paired, house, _) = self.ledger.counterparty_policy(&deal.counterparty)?;
        let payee = self.settlement_payee(deal)?;
        let usage = self.ledger.usage_for(deal, now)?;
        let role = match (deal.side, deal.kind) {
            (Side::Buyer, _) => Role::Buy,
            (_, DealKind::ShopOrder) => Role::Shop,
            (_, DealKind::Rescue) => Role::Rescue,
            _ => Role::Sell,
        };
        let count = self.ledger.negotiation_rounds(deal.id)?;
        // Proposal N checks N-1 prior rounds. Acceptance/settlement recheck that same round.
        let rounds = if proposing {
            count
        } else {
            count.saturating_sub(1)
        }
        .min(255) as u8;
        Ok(m.payload.check(
            &table_core::Intent {
                kind: deal.kind,
                side: deal.side,
                role,
                category,
                terms: &deal.terms,
                counterparty: &deal.counterparty,
                paired,
                house,
                payee: &payee,
                rounds_used: rounds,
            },
            usage,
            now,
        )?)
    }
    pub(crate) fn signed(
        &self,
        deal: &Deal,
        body: Body,
        now: Timestamp,
    ) -> Result<VerifiedEnvelope, Error> {
        let seq = self.ledger.next_sequence(deal.id, Direction::Outbound)?;
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).map_err(|_| Error::Unavailable)?;
        let e = Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: deal.id,
            seq,
            prev: deal.transcript_head,
            iss: self.signer.key_id()?,
            aud: deal.counterparty.clone(),
            iat: now,
            exp: now.checked_add(600).ok_or(Error::Invalid)?,
            nonce,
            body,
        };
        Ok(verify(
            &self.signer.sign(&e)?,
            &self.signer.public_key(),
            &VerifyContext {
                deal_id: deal.id,
                audience: &deal.counterparty,
                next_sender_seq: seq,
                previous: deal.transcript_head,
                now,
                nonces: &self.ledger,
            },
        )?)
    }
    pub fn withdraw(
        &mut self,
        id: DealId,
        reason: ReasonCode,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.ledger.get_deal(id)?;
        transition(deal.state, DealEvent::Withdraw)?;
        let envelope = self.signed(&deal, Body::Withdraw { reason }, now)?;
        self.ledger.commit_negotiation(
            &envelope,
            Direction::Outbound,
            None,
            Some(DealEvent::Withdraw),
            now,
        )?;
        Ok(envelope.raw().into())
    }
}
impl AgentService for Wallet {
    fn record_refusal(
        &mut self,
        scope: &AgentScope,
        tool: &str,
        reason: &str,
        now: Timestamp,
    ) -> Result<(), Error> {
        // The tool name is model output: only a bounded identifier is kept, never free text.
        let tool = if !tool.is_empty()
            && tool.len() <= 64
            && tool
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            tool
        } else {
            "unrecognised"
        };
        self.ledger.append_audit(&AuditEntry {
            at: now,
            actor: "agent".into(),
            action: "intent.refused".into(),
            deal_id: Some(scope.deal_id),
            detail: serde_json::json!({"layer":"mcp","tool":tool,"reason":reason}),
        })?;
        Ok(())
    }
    fn invoke(
        &mut self,
        scope: &AgentScope,
        request: AgentRequest,
        now: Timestamp,
    ) -> Result<serde_json::Value, Error> {
        let mut deal = self.ledger.get_deal(scope.deal_id)?;
        match request {
            AgentRequest::Market(input) => {
                if !matches!(scope.role, AgentRole::Negotiator | AgentRole::Shopper)
                    || input.item_ref != deal.terms.item_ref
                {
                    return Err(Error::Permission);
                }
                self.mandate_check(&deal, scope.category, now)?;
                let mut reference = deal.market.ok_or(Error::Unavailable)?;
                if now < reference.retrieved_at || now.saturating_sub(reference.retrieved_at) >= 900
                {
                    return Err(Error::Unavailable);
                }
                reference.cached = true;
                Ok(serde_json::to_value(reference).map_err(|_| Error::Invalid)?)
            }
            AgentRequest::Book(query) => {
                if scope.role != AgentRole::Assistant {
                    return Err(Error::Permission);
                }
                self.mandate_check(&deal, scope.category, now)?;
                Ok(self.ledger.book_query(&query)?)
            }
            AgentRequest::Accept(input) => {
                if scope.role != AgentRole::Negotiator || input.deal_id != scope.deal_id {
                    return Err(Error::Permission);
                }
                let raw = self.accept(input.deal_id, input.offer_seq, scope.category, now)?;
                Ok(serde_json::json!({"jws":raw}))
            }
            AgentRequest::View(input) => {
                if scope.role != AgentRole::Negotiator
                    || input.deal_id.is_some_and(|id| id != scope.deal_id)
                {
                    return Err(Error::Permission);
                }
                Ok(serde_json::to_value(deal).map_err(|_| Error::Invalid)?)
            }
            AgentRequest::Withdraw(input) => {
                if scope.role != AgentRole::Negotiator || input.deal_id != scope.deal_id {
                    return Err(Error::Permission);
                }
                let raw = self.withdraw(deal.id, input.reason, now)?;
                Ok(serde_json::json!({"jws":raw}))
            }
            AgentRequest::Offer(input) => {
                if scope.role != AgentRole::Negotiator || input.deal_id != scope.deal_id {
                    return Err(Error::Permission);
                }
                let price =
                    Money::parse(&input.price, deal.terms.currency).map_err(|_| Error::Invalid)?;
                deal.terms.unit_price = price;
                deal.terms.delivery = input.delivery;
                if let Err(error) = self.mandate_check_rounds(&deal, scope.category, now, true) {
                    self.ledger.append_audit(&AuditEntry {
                        at: now,
                        actor: "agent".into(),
                        action: "intent.refused".into(),
                        deal_id: Some(deal.id),
                        detail: serde_json::json!({"reason":error.to_string()}),
                    })?;
                    return Err(error);
                }
                let body = if deal.side == Side::Buyer {
                    Body::Offer {
                        price,
                        delivery: deal.terms.delivery.clone(),
                    }
                } else {
                    Body::Counter {
                        price,
                        delivery: deal.terms.delivery.clone(),
                    }
                };
                let envelope = self.signed(&deal, body, now)?;
                self.ledger.commit_negotiation(
                    &envelope,
                    Direction::Outbound,
                    Some(&deal.terms),
                    Some(DealEvent::OfferVerified),
                    now,
                )?;
                Ok(serde_json::json!({"jws":envelope.raw(),"terms_hash":deal.terms.hash()?}))
            }
            AgentRequest::Purchase(input) => {
                if scope.role != AgentRole::Shopper
                    || deal.kind != DealKind::Purchase
                    || input.category != scope.category
                {
                    return Err(Error::Permission);
                }
                let (_, _, payee) = self.ledger.counterparty_policy(&deal.counterparty)?;
                if input.payee_ref != payee || input.items.len() != 1 {
                    return Err(Error::Invalid);
                }
                let line = &input.items[0];
                if line.item_ref != deal.terms.item_ref || line.qty == 0 {
                    return Err(Error::Invalid);
                }
                deal.terms.qty = line.qty;
                let amount =
                    Money::parse(&input.amount, deal.terms.currency).map_err(|_| Error::Invalid)?;
                if deal.terms.amount()? != amount {
                    return Err(Error::Invalid);
                }
                match self.mandate_check(&deal, scope.category, now) {
                    Ok(decision) => {
                        self.ledger.propose_purchase(&deal, now)?;
                        self.ledger.append_audit(&AuditEntry{at:now,actor:"agent".into(),action:"purchase.proposed".into(),deal_id:Some(deal.id),detail:serde_json::json!({"amount":amount,"needs_human":matches!(decision,MandateDecision::Ask{..})})})?;
                        Ok(serde_json::json!({"deal_id":deal.id,"status":"pending"}))
                    }
                    Err(error) => {
                        if let Error::Refused(refusal) = &error {
                            self.ledger.refuse(deal.id, refusal.clause, now)?;
                        }
                        Err(error)
                    }
                }
            }
        }
    }
}
