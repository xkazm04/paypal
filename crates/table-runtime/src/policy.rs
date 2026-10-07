//! Policy negotiator wiring: the typed brief a run starts from, the loopback MCP transport and the
//! scheduler's re-arming. The engine itself lives in `table-engine`; it moves no money and holds
//! no payment client, and every intent it makes passes the wallet's mandate check over MCP.
use crate::{CommandError, Runtime, app, unavailable};
use async_trait::async_trait;
use serde_json::Value;
use table_core::*;
use table_engine::{Error as EngineError, McpGrant, McpTransport, PolicyBrief, Stance};
use table_ledger::Direction;
use table_proto::Body;

/// The production transport: JSON-RPC over HTTP to the wallet's own loopback listener.
#[derive(Debug)]
pub(crate) struct HttpMcp(reqwest::Client);
impl HttpMcp {
    pub(crate) fn new() -> Result<Self, EngineError> {
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map(Self)
            .map_err(|_| EngineError::Process)
    }
}
#[async_trait]
impl McpTransport for HttpMcp {
    async fn post(&self, grant: &McpGrant, body: Value) -> Result<Value, EngineError> {
        let response = self
            .0
            .post(&grant.url)
            .header("x-wallet-secret", &grant.secret)
            .header("x-wallet-session", &grant.token)
            .json(&body)
            .send()
            .await
            .map_err(|_| EngineError::Process)?;
        if !response.status().is_success() {
            return Err(EngineError::Process);
        }
        response.json().await.map_err(|_| EngineError::Invalid)
    }
}
/// Hard ceiling on how long the policy negotiator waits on the wallet.
const MAX_ROUNDS: u8 = u8::MAX;
impl Runtime {
    /// Reads only typed state: the signed band, the transcript's shape and the deal projection.
    pub(crate) fn policy_brief(&self, deal: &Deal) -> Result<PolicyBrief, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let owner = crate::vault::existing_signing_key(self.vault.as_ref(), "owner")
            .map_err(|_| unavailable("Owner key unavailable"))?
            .verifying_key();
        let mandate = app(ledger.active_mandate(deal.mandate_id, deal.mandate_version, &owner))?;
        let (floor, ceiling, band_rounds) = mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                Clause::Band {
                    floor,
                    ceiling,
                    max_rounds,
                    ..
                } => Some((*floor, *ceiling, *max_rounds)),
                _ => None,
            })
            .ok_or_else(|| unavailable("Mandate has no price band"))?;
        let last = app(ledger.last_message(deal.id))?;
        let status = app(ledger.negotiation_status(deal.id))?;
        let steps = app(ledger.deal_transcript(deal.id))?;
        let heard = |typ: TranscriptType| {
            steps
                .iter()
                .filter(|s| s.by == TranscriptBy::Them && s.typ == typ)
                .count()
        };
        let (stance, heard) = match (deal.state, deal.side, last) {
            (
                DealState::Negotiating,
                Side::Seller,
                Some((Direction::Inbound, Body::Offer { .. })),
            ) => (Stance::Respond, heard(TranscriptType::Offer)),
            (
                DealState::Negotiating,
                Side::Buyer,
                Some((Direction::Inbound, Body::Counter { .. })),
            ) => (Stance::Respond, heard(TranscriptType::Counter)),
            (DealState::Negotiating, _, Some((Direction::Inbound, Body::Accept { .. })))
                if status.as_ref().is_some_and(|s| !s.own_accept) =>
            {
                (Stance::Confirm, 0)
            }
            // Listed means nothing has been offered yet; the owner starts this run.
            (DealState::Listed, Side::Buyer, _) => (Stance::Open, 0),
            _ => (Stance::Observe, 0),
        };
        // An offer is only safe if the wallet would also let it go out, so the buyer leaves one
        // round for the reply its own concession invites.
        let max_rounds = match deal.side {
            Side::Buyer => band_rounds.saturating_sub(1).max(1),
            Side::Seller => band_rounds,
        };
        #[cfg(test)]
        let (floor, ceiling) = self.brief_tamper.unwrap_or((floor, ceiling));
        Ok(PolicyBrief {
            stance,
            side: deal.side,
            floor,
            ceiling,
            ask: steps
                .iter()
                .find(|s| s.typ == TranscriptType::Listing)
                .and_then(|s| s.price),
            max_rounds,
            round: u8::try_from(heard).unwrap_or(MAX_ROUNDS),
            offer_seq: status.map_or(0, |s| s.offer_seq),
            now: self.clock.now(),
        })
    }
    /// Re-arm: when the peer has spoken last on a negotiating deal, start a policy run for it.
    /// Failures are not faults: the run cap, pause and one-run-per-deal stay authoritative inside
    /// `start_agent`, and a deal is retried when its transcript moves or capacity frees up.
    pub(crate) fn arm_policy_run(&mut self, deal: &Deal) {
        if self.paused
            || self.engine != table_engine::EngineId::Scripted
            || deal.state != DealState::Negotiating
            || self.runs.len() >= 4
            || self.runs.values().any(|r| r.scope.deal_id == deal.id)
            || self.armed.get(&deal.id) == Some(&deal.transcript_head)
        {
            return;
        }
        match self.policy_brief(deal) {
            Ok(brief) if matches!(brief.stance, Stance::Respond | Stance::Confirm) => {}
            _ => return,
        }
        if self.start_agent(deal.id).is_ok() {
            self.armed.insert(deal.id, deal.transcript_head);
        }
    }
}
