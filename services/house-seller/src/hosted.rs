use crate::{Decision, Policy};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::post,
};
use ed25519_dalek::{Signer, SigningKey};
use std::sync::Arc;
use table_app::{
    AgentRequest, AgentRole, AgentScope, AgentService, Authority, OfferInput, Pipeline, Wallet,
};
use table_core::*;
use table_ledger::{Counterparty, Direction, Ledger, LedgerError, PairedVia};
use table_proto::{
    AgentSigner, Body, HouseRelease, HouseRequest, HouseResponse, HouseTable, PairingIdentity,
    ReasonCode, ShortText, SignedPairingIdentity,
};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid house configuration or request")]
    Invalid,
    #[error("house capacity reached")]
    Full,
    #[error("house temporarily unavailable")]
    Unavailable,
    #[error(transparent)]
    App(#[from] table_app::Error),
    #[error(transparent)]
    Ledger(#[from] LedgerError),
}
impl From<DomainError> for Error {
    fn from(e: DomainError) -> Self {
        Self::App(e.into())
    }
}
impl From<table_proto::ProtocolError> for Error {
    fn from(e: table_proto::ProtocolError) -> Self {
        Self::App(e.into())
    }
}

pub struct Seller {
    pub pipeline: Pipeline,
    owner: SigningKey,
    agent: SigningKey,
    release: HouseRelease,
    mandate: OpenMandate,
    policy: Policy,
    terms: Terms,
    category: Category,
    clock: Arc<dyn Clock>,
    relay: Arc<dyn table_relay::RelayApi>,
}
impl std::fmt::Debug for Seller {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HostedSeller { [REDACTED] }")
    }
}
impl Seller {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        ledger: Ledger,
        owner: SigningKey,
        agent: SigningKey,
        release: HouseRelease,
        mandate: OpenMandate,
        api: Arc<dyn table_paypal::PayPalApi>,
        clock: Arc<dyn Clock>,
        relay: Arc<dyn table_relay::RelayApi>,
    ) -> Result<Self, Error> {
        release
            .verify_mandate(&mandate)
            .map_err(|_| Error::Invalid)?;
        if owner.verifying_key().to_bytes() != release.owner_key
            || agent.verifying_key().to_bytes() != release.agent_key
            || clock.now() < mandate.payload.not_before
            || clock.now() >= mandate.payload.expires
        {
            return Err(Error::Invalid);
        }
        // A single release-owned demo item. All money and limits come from its signed clauses.
        let (item, floor, ask, max_rounds) = mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                Clause::Band {
                    item_refs,
                    floor: Some(floor),
                    ceiling: Some(ask),
                    max_rounds,
                    ..
                } if item_refs.len() == 1 => {
                    Some((item_refs[0].clone(), *floor, *ask, *max_rounds))
                }
                _ => None,
            })
            .ok_or(Error::Invalid)?;
        let category = mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                Clause::PerDeal {
                    kind: DealKind::Haggle,
                    categories,
                    ..
                } if categories.len() == 1 => Some(categories[0]),
                _ => None,
            })
            .ok_or(Error::Invalid)?;
        if floor.currency() != ask.currency() || floor.minor() > ask.minor() {
            return Err(Error::Invalid);
        }
        let terms = Terms {
            item_ref: item,
            qty: 1,
            unit_price: ask,
            currency: ask.currency(),
            delivery: Delivery::DigitalNow,
        };
        let mut pipeline = Pipeline::new(
            Wallet::new(
                ledger,
                AgentSigner::from_key(agent.clone()),
                owner.verifying_key(),
            ),
            api,
            clock.now(),
        )?;
        if pipeline
            .wallet
            .ledger
            .next_mandate_version(mandate.payload.id)?
            == 1
        {
            pipeline
                .wallet
                .ledger
                .insert_mandate(&mandate, &owner.verifying_key(), clock.now())?;
        }
        let active = pipeline.wallet.ledger.active_mandate(
            mandate.payload.id,
            mandate.payload.version,
            &owner.verifying_key(),
        )?;
        release
            .verify_mandate(&active)
            .map_err(|_| Error::Invalid)?;
        pipeline.enable_house(release.clone(), &active)?;
        Ok(Self {
            pipeline,
            owner,
            agent,
            release,
            mandate,
            policy: Policy {
                floor,
                ask,
                max_rounds,
            },
            terms,
            category,
            clock,
            relay,
        })
    }
    pub fn table(&mut self, request: HouseRequest) -> Result<HouseResponse, Error> {
        let now = self.clock.now();
        self.pipeline.wallet.ledger.active_mandate(
            self.mandate.payload.id,
            self.mandate.payload.version,
            &self.owner.verifying_key(),
        )?;
        request.buyer.verify().map_err(|_| Error::Invalid)?;
        let buyer = &request.buyer.identity;
        if buyer.side != Side::Buyer
            || buyer.in_reply_to.is_some()
            || buyer.expires <= now
            || buyer.expires > now.saturating_add(86400)
            || buyer.agent_key == self.release.agent_key
        {
            return Err(Error::Invalid);
        }
        let digest = request.buyer.identity_hash().map_err(|_| Error::Invalid)?;
        let key = table_proto::key_id(
            &ed25519_dalek::VerifyingKey::from_bytes(&buyer.agent_key)
                .map_err(|_| Error::Invalid)?,
        )?;
        let ledger = &mut self.pipeline.wallet.ledger;
        let reserved = ledger.house_request(digest)?;
        let id = reserved.unwrap_or_else(|| DealId(ulid::Ulid::new()));
        let bound = ledger.counterparty_binding(&key)?;
        if let Some((hash, owner, payee)) = &bound
            && (*hash != buyer.code_hash || *owner != buyer.owner_key || *payee != buyer.payee)
        {
            return Err(Error::Invalid);
        }
        let deal = Deal {
            created_at: now,
            updated_at: now,
            id,
            kind: DealKind::Haggle,
            side: Side::Seller,
            counterparty: key,
            mandate_id: self.mandate.payload.id,
            mandate_version: self.mandate.payload.version,
            terms: self.terms.clone(),
            state: DealState::Pairing,
            transcript_head: H256::ZERO,
            paypal: PaypalRefs::default(),
            mode: Mode::Sandbox,
            market: None,
            shield: None,
            decided_by: None,
        };
        // No PayPal call (including a poll) can precede a successful mandate check.
        self.mandate
            .payload
            .check(
                &Intent {
                    kind: deal.kind,
                    side: deal.side,
                    role: Role::Sell,
                    category: self.category,
                    terms: &deal.terms,
                    counterparty: &deal.counterparty,
                    paired: true,
                    house: false,
                    payee: &self.release.payee,
                    rounds_used: 0,
                },
                self.pipeline.wallet.ledger.usage_for(&deal, now)?,
                now,
            )
            .map_err(table_app::Error::from)?;
        // Nothing is written for a request until it has passed every check above.
        let ledger = &mut self.pipeline.wallet.ledger;
        if reserved.is_none() {
            if ledger.house_open_request_count()? >= 64 {
                return Err(Error::Full);
            }
            ledger.reserve_house_request(digest, id)?;
        }
        if bound.is_none() {
            ledger.insert_paired_counterparty(
                &Counterparty {
                    key_id: deal.counterparty.clone(),
                    owner_key: buyer.owner_key,
                    agent_key: buyer.agent_key,
                    display_name: ShortText::new("House guest".into())?,
                    paired_via: PairedVia::Code,
                    words_confirmed_at: Some(now),
                    declared_payee: buyer.payee.clone(),
                    first_seen: now,
                },
                buyer.code_hash,
            )?;
        }
        match self.pipeline.wallet.ledger.get_deal(id) {
            Err(LedgerError::NotFound) => self.pipeline.wallet.ledger.create_deal(&deal, now)?,
            Ok(existing) if existing.counterparty == deal.counterparty => {}
            _ => return Err(Error::Invalid),
        }
        let ledger = &mut self.pipeline.wallet.ledger;
        match ledger.deal_category(id) {
            Err(LedgerError::NotFound) => ledger.set_deal_category(id, self.category)?,
            Ok(category) if category == self.category => {}
            _ => return Err(Error::Invalid),
        }
        ledger.bind_paired_relay(id, now)?;
        if ledger.get_deal(id)?.state == DealState::Pairing {
            self.pipeline.wallet.list(id, now)?;
        }
        if self.pipeline.wallet.ledger.deadline(id)?.is_none() {
            let due = self
                .mandate
                .payload
                .clauses
                .iter()
                .find_map(|c| match c {
                    Clause::Band { deadline, .. } => Some(*deadline),
                    _ => None,
                })
                .ok_or(Error::Invalid)?
                .min(now.saturating_add(300));
            self.pipeline
                .wallet
                .ledger
                .set_deadline(id, due, None, now)?;
        }
        let identity = PairingIdentity {
            code_hash: buyer.code_hash,
            owner_key: self.release.owner_key,
            agent_key: self.release.agent_key,
            side: Side::Seller,
            payee: self.release.payee.clone(),
            expires: buyer.expires,
            in_reply_to: Some(digest),
        };
        let bytes = canonical_bytes(&identity).map_err(|_| Error::Invalid)?;
        let mut response = HouseResponse {
            seller: SignedPairingIdentity {
                identity,
                owner_signature: self.owner.sign(&bytes).to_bytes().to_vec(),
                agent_signature: self.agent.sign(&bytes).to_bytes().to_vec(),
            },
            mandate: self.mandate.clone(),
            table: HouseTable {
                negotiation_deadline: self
                    .pipeline
                    .wallet
                    .ledger
                    .deadline(id)?
                    .ok_or(Error::Invalid)?
                    .0,
                deal_id: id,
                terms: self.terms.clone(),
                category: self.category,
            },
            signature: vec![],
        };
        response.signature = self
            .agent
            .sign(&response.signing_bytes().map_err(|_| Error::Invalid)?)
            .to_bytes()
            .to_vec();
        Ok(response)
    }
    pub async fn tick(&mut self) -> Result<(), Error> {
        let now = self.clock.now();
        let mut failure = None;
        // Defaults run first and independently of transport failures.
        for deal in self.pipeline.wallet.ledger.list_deals()? {
            let result = self.advance(&deal, now).await;
            if let Err(e) = result {
                failure.get_or_insert(e);
            }
        }
        for work in self.pipeline.wallet.ledger.relay_work()? {
            let result = self.deliver(work).await;
            if let Err(e) = result {
                failure.get_or_insert(e);
            }
        }
        for message in self.pipeline.wallet.ledger.pending_inbox()? {
            let duplicate = self
                .pipeline
                .wallet
                .ledger
                .has_envelope_hash(message.deal_id, H256::digest(message.raw.as_bytes()))?;
            let accepted = if duplicate {
                true
            } else {
                match self.receive(message.deal_id, &message.raw, now) {
                    Ok(()) => true,
                    Err(Error::Ledger(LedgerError::Sql(_) | LedgerError::Integrity(_))) => {
                        return Err(Error::Unavailable);
                    }
                    Err(_) => false,
                }
            };
            self.pipeline
                .wallet
                .ledger
                .finish_inbox(&message, accepted, now)?;
        }
        for deal in self.pipeline.wallet.ledger.list_deals()? {
            if let Err(e) = self.negotiate(&deal, now) {
                failure.get_or_insert(e);
            }
        }
        failure.map_or(Ok(()), Err)
    }
    async fn deliver(&mut self, work: table_ledger::RelayWork) -> Result<(), Error> {
        self.relay
            .create(work.mailbox)
            .await
            .map_err(|_| Error::Unavailable)?;
        let batch = self
            .relay
            .poll(work.mailbox, &work.generation, work.cursor, 0)
            .await
            .map_err(|_| Error::Unavailable)?;
        batch.validate().map_err(|_| Error::Invalid)?;
        let generation = batch.generation.clone();
        self.pipeline.wallet.ledger.stage_relay_batch(
            work.deal_id,
            &generation,
            batch.after,
            &batch.messages,
        )?;
        // Generation changes replay durable history on the next tick, just like the wallet.
        if work.generation == generation {
            for (hash, raw) in work.outgoing {
                self.relay
                    .send(work.mailbox, &raw)
                    .await
                    .map_err(|_| Error::Unavailable)?;
                self.pipeline
                    .wallet
                    .ledger
                    .acknowledge_relay(work.deal_id, &generation, hash)?;
            }
        }
        Ok(())
    }
    fn receive(&mut self, id: DealId, raw: &str, now: i64) -> Result<(), Error> {
        let verified = self.pipeline.wallet.ledger.preview_inbound(id, raw, now)?;
        if let Body::Offer { price, delivery } = &verified.envelope().body {
            let round = self
                .pipeline
                .wallet
                .ledger
                .peer_offer_count(id)?
                .saturating_add(1);
            if *delivery != self.terms.delivery
                || matches!(
                    self.policy
                        .decide(*price, u8::try_from(round).unwrap_or(u8::MAX))
                        .map_err(|_| Error::Invalid)?,
                    Decision::Counter(_) | Decision::Withdraw
                )
            {
                self.pipeline.wallet.check_mandate(id, self.category, now)?;
                self.pipeline
                    .wallet
                    .ledger
                    .record_declined_offer(&verified, now)?;
                return Ok(());
            }
        }
        self.pipeline
            .wallet
            .receive_relay(id, raw, self.category, now)?;
        Ok(())
    }
    fn negotiate(&mut self, deal: &Deal, now: i64) -> Result<(), Error> {
        if !matches!(deal.state, DealState::Listed | DealState::Negotiating)
            || self
                .pipeline
                .wallet
                .ledger
                .deadline(deal.id)?
                .is_some_and(|d| d.0 <= now)
            || deal.shield.is_some_and(|s| s >= ShieldVerdict::Hold)
        {
            return Ok(());
        }
        if let Some((Direction::Inbound, Body::Offer { price, delivery })) =
            self.pipeline.wallet.ledger.last_message(deal.id)?
        {
            let round = self.pipeline.wallet.ledger.peer_offer_count(deal.id)?;
            let decision = self
                .policy
                .decide(price, u8::try_from(round).unwrap_or(u8::MAX))
                .map_err(|_| Error::Invalid)?;
            let decision = if delivery != self.terms.delivery && decision == Decision::Accept {
                Decision::Counter(price)
            } else {
                decision
            };
            match decision {
                Decision::Withdraw => {
                    self.pipeline
                        .wallet
                        .withdraw(deal.id, ReasonCode::Rounds, now)?;
                    return Ok(());
                }
                Decision::Counter(price) => {
                    self.pipeline.wallet.invoke(
                        &AgentScope {
                            deal_id: deal.id,
                            role: AgentRole::Negotiator,
                            category: self.category,
                        },
                        AgentRequest::Offer(OfferInput {
                            deal_id: deal.id,
                            price: price.decimal(),
                            delivery: self.terms.delivery.clone(),
                        }),
                        now,
                    )?;
                }
                Decision::Accept => {}
            }
        }
        if let Some(status) = self.pipeline.wallet.ledger.negotiation_status(deal.id)?
            && !status.own_accept
        {
            self.pipeline
                .wallet
                .accept(deal.id, status.offer_seq, self.category, now)?;
        }
        Ok(())
    }
    async fn advance(&mut self, deal: &Deal, now: i64) -> Result<(), Error> {
        if deal.state.terminal() {
            return Ok(());
        }
        if self
            .pipeline
            .wallet
            .ledger
            .deadline(deal.id)?
            .is_some_and(|d| d.0 <= now)
        {
            if deal.state == DealState::Authorized {
                self.pipeline.auto_void(deal.id, 1, now).await?;
            } else if deal.state.pre_capture() {
                self.pipeline
                    .wallet
                    .ledger
                    .apply_deadline_default(deal.id, now)?;
            }
            return Ok(());
        }
        match deal.state {
            DealState::Agreed => {
                self.pipeline
                    .create(deal.id, 1, self.category, Authority::HouseMandate, now)
                    .await?;
            }
            DealState::AwaitingApproval => {
                self.pipeline
                    .wallet
                    .check_mandate(deal.id, self.category, now)?;
                self.pipeline.poll_approval(deal.id, 1, now).await?;
            }
            DealState::Approved => {
                self.pipeline
                    .authorize(deal.id, 1, self.category, Authority::HouseMandate, now)
                    .await?;
            }
            DealState::Authorized => {
                if deal.shield.is_some_and(|s| s >= ShieldVerdict::Hold) {
                    self.pipeline.auto_void(deal.id, 1, now).await?;
                } else {
                    self.pipeline
                        .capture(deal.id, 1, self.category, Authority::HouseMandate, now)
                        .await?;
                }
            }
            _ => {}
        }
        Ok(())
    }
}

type Reply = oneshot::Sender<Result<HouseResponse, Error>>;
#[derive(Debug)]
enum Message {
    Table(HouseRequest, Reply),
    Snapshot(DealId, oneshot::Sender<Result<Deal, Error>>),
}
#[derive(Debug, Clone)]
pub struct HouseHandle(mpsc::Sender<Message>);
impl HouseHandle {
    pub async fn table(&self, request: HouseRequest) -> Result<HouseResponse, Error> {
        let (tx, rx) = oneshot::channel();
        self.0
            .try_send(Message::Table(request, tx))
            .map_err(|_| Error::Full)?;
        rx.await.map_err(|_| Error::Unavailable)?
    }
    /// Trusted Rust inspection; no public HTTP route exposes financial state.
    pub async fn snapshot(&self, id: DealId) -> Result<Deal, Error> {
        let (tx, rx) = oneshot::channel();
        self.0
            .try_send(Message::Snapshot(id, tx))
            .map_err(|_| Error::Full)?;
        rx.await.map_err(|_| Error::Unavailable)?
    }
}
pub fn spawn(mut seller: Seller) -> HouseHandle {
    let (tx, mut rx) = mpsc::channel::<Message>(4);
    tokio::spawn(async move {
        let mut timer = tokio::time::interval(std::time::Duration::from_secs(1));
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                request=rx.recv()=>match request {
                    Some(Message::Table(request,reply))=>{if !reply.is_closed(){let _=reply.send(seller.table(request));}},
                    Some(Message::Snapshot(id,reply))=>{let _=reply.send(seller.pipeline.wallet.ledger.get_deal(id).map_err(Error::from));},
                    None=>break,
                },
                _=timer.tick()=>{let _=seller.tick().await;},
            }
        }
    });
    HouseHandle(tx)
}
pub fn router(relay: Arc<rendezvous::MemoryStore>, house: HouseHandle) -> Router {
    rendezvous::router(relay).merge(
        Router::new()
            .route("/v1/house/tables", post(table))
            .layer(DefaultBodyLimit::max(16384))
            .with_state(house),
    )
}
async fn table(
    State(house): State<HouseHandle>,
    Json(request): Json<HouseRequest>,
) -> Result<Json<HouseResponse>, StatusCode> {
    house.table(request).await.map(Json).map_err(|e| match e {
        Error::Invalid
        | Error::App(table_app::Error::Refused(_) | table_app::Error::Permission) => {
            StatusCode::BAD_REQUEST
        }
        Error::Full => StatusCode::TOO_MANY_REQUESTS,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    })
}
