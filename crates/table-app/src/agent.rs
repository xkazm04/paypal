use ed25519_dalek::VerifyingKey;
use serde::{Deserialize, Serialize};
use table_core::*;
use table_ledger::{AuditEntry, Direction, GroupLoser, Ledger, LedgerError};
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
    /// An agent intent refused for a reason no other variant names (its turn, the run, the
    /// shield, the owner's in-person threshold). The code is closed; the text is fixed.
    #[error("agent refusal: {}", .0.tag())]
    Agent(RefusalCode),
}
/// The closed code an agent hears for `error`. Never the error's own text: a ledger or protocol
/// error is named only by its category.
pub fn refusal_code(error: &Error) -> RefusalCode {
    match error {
        Error::Agent(code) => *code,
        Error::Refused(refusal) => RefusalCode::from_refusal(refusal),
        Error::Ledger(LedgerError::GroupClosed) => RefusalCode::GroupClosed,
        Error::Permission => RefusalCode::OutOfScope,
        Error::Invalid
        | Error::Domain(_)
        | Error::Protocol(_)
        | Error::Ledger(LedgerError::NotFound) => RefusalCode::InvalidRequest,
        Error::Unavailable | Error::Locked | Error::Ledger(_) => RefusalCode::Unavailable,
    }
}
/// The signed rule's own words for a mandate or wallet-limit refusal ("mandate clause 4: price
/// 352.00 above ceiling 340.00"). The wallet writes them from fixed templates and typed numbers
/// only; no other error's text is ever shown to an agent.
pub fn refusal_detail(error: &Error) -> Option<String> {
    match error {
        Error::Refused(refusal) => Some(refusal.to_string()),
        _ => None,
    }
}
/// A table-side refusal as an error. Clause 4's rounds and deadline stay mandate refusals (the
/// same `Refused` the mandate check returns), so every caller sees one shape for them.
fn refused(code: RefusalCode) -> Error {
    let clause4 = |reason: &str| {
        Error::Refused(Refusal {
            clause: 4,
            reason: reason.into(),
        })
    };
    match code {
        RefusalCode::RoundsExhausted => clause4(MAX_ROUNDS_REACHED),
        RefusalCode::DeadlinePassed => clause4(DEADLINE_REACHED),
        other => Error::Agent(other),
    }
}
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
    /// The owner's public key (public; the private key stays in the keychain).
    pub fn owner_public_key(&self) -> VerifyingKey {
        self.owner
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
        sole_payee(&m)
    }
    /// The payee the deal settles to, from its signed mandate as recorded, even when that mandate
    /// was revoked since. Only to check that an order PayPal shows is the deal's own (a read-back
    /// observation): it grants nothing, and every send takes `settlement_payee`.
    pub(crate) fn recorded_payee(&self, deal: &Deal) -> Result<PayeeRef, Error> {
        if deal.side == Side::Buyer {
            return self.settlement_payee(deal);
        }
        let m = self
            .ledger
            .mandate_evidence(deal.mandate_id, deal.mandate_version, &self.owner)?;
        sole_payee(&m)
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
        // Shop around (T8): refused before anything is signed when another table of the group
        // agreed or holds our one ACCEPT. The ledger checks the same rule again when recording.
        if self.ledger.group_accept_blocked(id, true)? {
            return Err(LedgerError::GroupClosed.into());
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
        let decision = m.payload.check(
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
        )?;
        // A rescue's one fix is checked against the signed fixes clause on every check: an offer
        // the clause no longer allows refuses as clause 8, before any write or PayPal call.
        if deal.kind == DealKind::Rescue {
            let case = self.ledger.rescue_case(deal.id)?.ok_or(Error::Permission)?;
            table_core::check_offer(&m.payload, &case.offer, &deal.terms)?;
        }
        // The wallet-wide limits sit above every mandate: they only ever refuse, after the
        // mandate allowed the intent and before any write, reservation or network call.
        self.envelope_check(deal, now)?;
        Ok(decision)
    }
    /// The owner's signed wallet limits (T14) for `deal` at `now`. No limits signed: no extra
    /// limit. Limits that fail to verify, or ran out, refuse money out (fail closed). Money in
    /// is never limited. Refusals carry [`ENVELOPE_CLAUSE`] and name the limit.
    pub fn envelope_check(&self, deal: &Deal, now: Timestamp) -> Result<(), Error> {
        if deal.side != Side::Buyer {
            return Ok(());
        }
        let envelope = match self.ledger.active_wallet_envelope(&self.owner) {
            Ok(None) => return Ok(()),
            Ok(Some((envelope, _))) => envelope.payload,
            Err(LedgerError::Sql(error)) => return Err(LedgerError::Sql(error).into()),
            Err(_) => {
                return Ok(EnvelopeDecision::refuse(
                    EnvelopeLimit::Unverified,
                    "the wallet limits could not be verified; sign them again",
                )
                .into_result()?);
            }
        };
        let amount = deal.terms.amount()?;
        let exposure = exposure_for_deal(
            &self.ledger.exposure_deals()?,
            deal.id,
            amount.currency(),
            now,
        )?;
        Ok(envelope
            .check(
                &exposure,
                EnvelopeIntent {
                    side: deal.side,
                    amount,
                },
                now,
            )
            .into_result()?)
    }
    /// The group rule's signed WITHDRAW of a table another seller's agreement closed (T8): no
    /// money moves, the seller sees a normal WITHDRAW, and `group.withdrawn` records the group rule
    /// as what decided it, in the same transaction. The caller selects the deal's agent signer.
    pub fn withdraw_for_group(&mut self, loser: &GroupLoser, now: Timestamp) -> Result<(), Error> {
        let deal = self.ledger.get_deal(loser.deal_id)?;
        if self.ledger.group_of(deal.id)? != Some(loser.group_id) {
            return Err(Error::Invalid);
        }
        transition(deal.state, DealEvent::Withdraw)?;
        let envelope = self.signed(
            &deal,
            Body::Withdraw {
                reason: ReasonCode::Price,
            },
            now,
        )?;
        self.ledger.commit_group_withdraw(&envelope, now)?;
        Ok(())
    }
    /// The table as this wallet's agent may see it (design §6.4): typed numbers and enums only,
    /// built from the signed band, the verified transcript's prices and the negotiation row.
    pub fn projection(&self, deal: &Deal, now: Timestamp) -> Result<AgentProjection, Error> {
        let m = self
            .ledger
            .active_mandate(deal.mandate_id, deal.mandate_version, &self.owner)?;
        let band = m.payload.clauses.iter().find_map(|c| match c {
            Clause::Band {
                floor,
                ceiling,
                max_rounds,
                deadline,
                ..
            } => Some(BandTerms {
                floor: *floor,
                ceiling: *ceiling,
                max_rounds: *max_rounds,
                deadline: *deadline,
            }),
            _ => None,
        });
        let (paired, house, _) = self.ledger.counterparty_policy(&deal.counterparty)?;
        let steps = self.ledger.deal_transcript(deal.id)?;
        let status = self.ledger.negotiation_status(deal.id)?;
        Ok(AgentProjection::build(ProjectionInput {
            deal,
            band,
            rounds_used: self.ledger.negotiation_rounds(deal.id)?,
            steps: &steps,
            offer_seq: status.as_ref().map(|s| s.offer_seq),
            own_accept: status.is_some_and(|s| s.own_accept),
            counterparty: match (paired, house) {
                (_, true) => TableCounterparty::House,
                (true, false) => TableCounterparty::PairedWallet,
                (false, false) => TableCounterparty::Unpaired,
            },
            lapses_at: self.ledger.deadline(deal.id)?.map(|(due, _)| due),
            now,
        }))
    }
    /// One `intent.refused` row for a refused agent call: the layer that refused it, the tool
    /// (a bounded identifier; it is model output), the closed code and a reason the wallet wrote
    /// (a mandate's own refusal text, else the code's fixed sentence). Never counterparty text.
    pub fn audit_refusal(
        &mut self,
        deal: DealId,
        layer: &str,
        tool: &str,
        error: &Error,
        now: Timestamp,
    ) -> Result<(), Error> {
        let code = refusal_code(error);
        let reason = match error {
            Error::Refused(refusal) => refusal.to_string(),
            _ => code.text().into(),
        };
        let layer = match code {
            RefusalCode::GroupClosed => "group",
            RefusalCode::WalletLimit { .. } => "wallet_limit",
            _ => layer,
        };
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
            deal_id: Some(deal),
            detail: serde_json::json!({
                "layer": layer,
                "tool": tool,
                "code": code,
                "clause": code.clause(),
                "reason": reason,
            }),
        })?;
        Ok(())
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
        // A money step whose PayPal outcome is unknown keeps the deal reserved until it is read
        // back (T10): walking away now could leave a hold or an order behind at PayPal.
        if !self.ledger.open_operations(Some(id), i64::MAX)?.is_empty() {
            return Err(Error::Permission);
        }
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
        code: RefusalCode,
        now: Timestamp,
    ) -> Result<(), Error> {
        self.audit_refusal(scope.deal_id, "mcp", tool, &Error::Agent(code), now)
    }
    fn invoke(
        &mut self,
        scope: &AgentScope,
        request: AgentRequest,
        now: Timestamp,
    ) -> Result<serde_json::Value, Error> {
        let tool = request.tool();
        let mut audited = false;
        let answer = self.serve(scope, request, now, &mut audited);
        if let Err(error) = &answer
            && !audited
        {
            self.audit_refusal(scope.deal_id, "wallet", tool, error, now)?;
        }
        answer
    }
}
impl Wallet {
    /// The agent's intents. Every check runs before any write; no path here calls PayPal.
    fn serve(
        &mut self,
        scope: &AgentScope,
        request: AgentRequest,
        now: Timestamp,
        audited: &mut bool,
    ) -> Result<serde_json::Value, Error> {
        let mut deal = self.ledger.get_deal(scope.deal_id)?;
        let out_of_scope = Error::Agent(RefusalCode::OutOfScope);
        let negotiator = scope.role == AgentRole::Negotiator;
        match request {
            AgentRequest::Market(input) => {
                if !matches!(scope.role, AgentRole::Negotiator | AgentRole::Shopper)
                    || input.item_ref != deal.terms.item_ref
                {
                    return Err(out_of_scope);
                }
                self.mandate_check(&deal, scope.category, now)?;
                let mut reference = deal
                    .market
                    .filter(|m| market_fresh(Some(m), now))
                    .ok_or(Error::Agent(RefusalCode::MarketUnavailable))?;
                reference.cached = true;
                // The agent sees the band only: the comparables and the market's product ids
                // behind it (market-data-2) are evidence for the owner, never agent input.
                reference.certificate = None;
                Ok(serde_json::to_value(reference).map_err(|_| Error::Invalid)?)
            }
            AgentRequest::Book(query) => {
                if scope.role != AgentRole::Assistant {
                    return Err(out_of_scope);
                }
                self.mandate_check(&deal, scope.category, now)?;
                Ok(self.ledger.book_query(&query)?)
            }
            AgentRequest::Accept(input) => {
                if !negotiator || input.deal_id != scope.deal_id {
                    return Err(out_of_scope);
                }
                if let Some(code) = self
                    .projection(&deal, now)?
                    .refusal(AgentTool::AcceptOffer, &deal)
                {
                    return Err(refused(code));
                }
                // Above the owner's in-person threshold only the owner accepts (clause 6).
                if let MandateDecision::Ask { clause } =
                    self.mandate_check(&deal, scope.category, now)?
                {
                    return Err(Error::Agent(RefusalCode::OwnerApproval { clause }));
                }
                let raw = self.accept(input.deal_id, input.offer_seq, scope.category, now)?;
                Ok(self.answer(raw, None, deal.id, now))
            }
            AgentRequest::View(input) => {
                if !negotiator || input.deal_id.is_some_and(|id| id != scope.deal_id) {
                    return Err(out_of_scope);
                }
                Ok(serde_json::to_value(self.projection(&deal, now)?)
                    .map_err(|_| Error::Invalid)?)
            }
            AgentRequest::Withdraw(input) => {
                if !negotiator || input.deal_id != scope.deal_id {
                    return Err(out_of_scope);
                }
                if let Some(code) = self
                    .projection(&deal, now)?
                    .refusal(AgentTool::WithdrawOffer, &deal)
                {
                    return Err(refused(code));
                }
                let raw = self.withdraw(deal.id, input.reason, now)?;
                Ok(self.answer(raw, None, deal.id, now))
            }
            AgentRequest::Offer(input) => {
                if !negotiator || input.deal_id != scope.deal_id {
                    return Err(out_of_scope);
                }
                // The table first (its turn, rounds, deadline, a shield hold), then the mandate.
                if let Some(code) = self
                    .projection(&deal, now)?
                    .refusal(AgentTool::SendOffer, &deal)
                {
                    return Err(refused(code));
                }
                let price =
                    Money::parse(&input.price, deal.terms.currency).map_err(|_| Error::Invalid)?;
                deal.terms.unit_price = price;
                deal.terms.delivery = input.delivery;
                self.mandate_check_rounds(&deal, scope.category, now, true)?;
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
                Ok(self.answer(
                    envelope.raw().into(),
                    Some(deal.terms.hash()?),
                    deal.id,
                    now,
                ))
            }
            AgentRequest::Purchase(input) => {
                if scope.role != AgentRole::Shopper
                    || deal.kind != DealKind::Purchase
                    || input.category != scope.category
                {
                    return Err(out_of_scope);
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
                    Ok(_) => {
                        // propose_purchase writes the one purchase.proposed row in its transaction.
                        self.ledger.propose_purchase(&deal, now)?;
                        Ok(serde_json::json!({"deal_id":deal.id,"status":"pending"}))
                    }
                    Err(error) => {
                        // The refused intent is recorded before the deal's own refusal, in order.
                        self.audit_refusal(deal.id, "wallet", "propose_purchase", &error, now)?;
                        *audited = true;
                        if let Error::Refused(refusal) = &error {
                            self.ledger.refuse(deal.id, refusal.clause, now)?;
                        }
                        Err(error)
                    }
                }
            }
        }
    }
    /// A signed step's answer: the JWS, the terms hash for an offer, and the table as it stands
    /// now, so the agent never acts on a stale view. The step is already committed: a table that
    /// cannot be read now is left out rather than failing the step.
    fn answer(
        &self,
        jws: String,
        terms_hash: Option<H256>,
        id: DealId,
        now: Timestamp,
    ) -> serde_json::Value {
        let table = self
            .ledger
            .get_deal(id)
            .ok()
            .and_then(|deal| self.projection(&deal, now).ok());
        let mut answer = serde_json::json!({"jws": jws});
        if let Some(hash) = terms_hash {
            answer["terms_hash"] = serde_json::json!(hash);
        }
        if let Some(table) = table {
            answer["table"] = serde_json::to_value(table).unwrap_or(serde_json::Value::Null);
        }
        answer
    }
}

/// The one payee a seller mandate's Payees clause names.
fn sole_payee(m: &OpenMandate) -> Result<PayeeRef, Error> {
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
