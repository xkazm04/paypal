//! Deterministic policy negotiator: an `EngineAdapter` with no model behind it. It reaches the
//! wallet only through the run's loopback MCP grant, the exact path a native engine uses, so every
//! intent it makes passes the same mandate check. It reads only the typed `table_view` projection
//! (`AgentProjection`: closed by type, so no counterparty free text) plus a typed brief the Rust
//! runtime built from the signed mandate.
use crate::{
    AgentJob, EngineAdapter, EngineEvent, EngineId, EngineInfo, Error, McpGrant, Schema,
    TerminalVerdict,
};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeSet, sync::Arc, sync::Mutex};
use table_core::negotiation::{BuyerPolicy, Decision, Policy};
use table_core::{AgentProjection, Money, RunId, Side, Timestamp};
use tokio::sync::mpsc::Sender;

/// One JSON-RPC POST to the grant's URL. Production speaks HTTP to the loopback listener; tests
/// hand the request to an in-process router. The transport adds the grant's headers itself.
#[async_trait]
pub trait McpTransport: Send + Sync {
    async fn post(&self, grant: &McpGrant, body: Value) -> Result<Value, Error>;
}
/// What the run was started for, decided in Rust from the transcript before the run begins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stance {
    /// Nothing is waiting on this deal: read the table and stop.
    Observe,
    /// Buyer, listing received, no offer sent yet.
    Open,
    /// The peer's latest message is an OFFER or COUNTER nobody has answered.
    Respond,
    /// The peer ACCEPTed the pending offer; countersign it if the mandate lets the agent.
    Confirm,
}
/// Typed policy inputs. Prices are integer minor units; nothing here is counterparty text.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyBrief {
    pub stance: Stance,
    pub side: Side,
    /// Signed band floor (seller's lowest price; the buyer's opening anchor when present).
    pub floor: Option<Money>,
    /// Signed band ceiling (the buyer's highest price).
    pub ceiling: Option<Money>,
    /// The seller's listing price.
    pub ask: Option<Money>,
    pub max_rounds: u8,
    /// Peer messages answered so far plus this one, counted from 1.
    pub round: u8,
    pub offer_seq: u32,
    pub now: Timestamp,
}
const MARKET_FRESH_SECS: i64 = 900;
#[derive(Debug, Clone, PartialEq, Eq)]
enum Act {
    Nothing,
    Offer(Money),
    Accept,
    Withdraw,
}
fn decide(brief: &PolicyBrief, table: &AgentProjection) -> Result<Act, Error> {
    let money = |_| Error::Invalid;
    let price = table.price;
    match brief.stance {
        Stance::Observe => Ok(Act::Nothing),
        Stance::Confirm => Ok(Act::Accept),
        Stance::Open | Stance::Respond => match brief.side {
            Side::Seller => {
                if brief.stance == Stance::Open {
                    return Ok(Act::Nothing);
                }
                let policy = Policy {
                    floor: brief.floor.ok_or(Error::Invalid)?,
                    ask: brief.ask.unwrap_or(price),
                    max_rounds: brief.max_rounds,
                };
                Ok(match policy.decide(price, brief.round).map_err(money)? {
                    Decision::Accept => Act::Accept,
                    Decision::Counter(m) => Act::Offer(m),
                    Decision::Withdraw => Act::Withdraw,
                })
            }
            Side::Buyer => {
                let fresh = table.market.as_ref().filter(|m| {
                    brief.now >= m.retrieved_at && brief.now - m.retrieved_at < MARKET_FRESH_SECS
                });
                let policy = BuyerPolicy::anchored(
                    brief.ceiling.ok_or(Error::Invalid)?,
                    brief.floor,
                    fresh.map(|m| m.p25),
                    fresh.map(|m| m.median),
                    brief.max_rounds,
                )
                .map_err(money)?;
                if brief.stance == Stance::Open {
                    return Ok(Act::Offer(policy.opening().map_err(money)?));
                }
                Ok(match policy.decide(price, brief.round).map_err(money)? {
                    Decision::Accept => Act::Accept,
                    Decision::Counter(m) => Act::Offer(m),
                    Decision::Withdraw => Act::Withdraw,
                })
            }
        },
    }
}
#[derive(Debug)]
pub struct PolicyEngine {
    transport: Arc<dyn McpTransport>,
    cancelled: Mutex<BTreeSet<RunId>>,
}
impl std::fmt::Debug for dyn McpTransport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpTransport")
    }
}
impl PolicyEngine {
    pub fn new(transport: Arc<dyn McpTransport>) -> Self {
        Self {
            transport,
            cancelled: Mutex::new(BTreeSet::new()),
        }
    }
    fn check_cancelled(&self, run: RunId) -> Result<(), Error> {
        if self
            .cancelled
            .lock()
            .map_err(|_| Error::Cancelled)?
            .contains(&run)
        {
            return Err(Error::Cancelled);
        }
        Ok(())
    }
    async fn rpc(
        &self,
        mcp: &McpGrant,
        id: i64,
        method: &str,
        params: Value,
    ) -> Result<Value, Error> {
        let reply = self
            .transport
            .post(
                mcp,
                json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}),
            )
            .await?;
        reply.get("result").cloned().ok_or(Error::Invalid)
    }
    /// `Ok(None)` is a tool-level refusal (the wallet said no and audited it); transport and shape
    /// failures are errors.
    async fn call(
        &self,
        mcp: &McpGrant,
        id: i64,
        name: &str,
        arguments: Value,
    ) -> Result<Option<Value>, Error> {
        let result = self
            .rpc(
                mcp,
                id,
                "tools/call",
                json!({"name":name,"arguments":arguments}),
            )
            .await?;
        if result.get("isError").and_then(Value::as_bool) != Some(false) {
            return Ok(None);
        }
        let text = result
            .pointer("/content/0/text")
            .and_then(Value::as_str)
            .ok_or(Error::Invalid)?;
        serde_json::from_str(text)
            .map(Some)
            .map_err(|_| Error::Invalid)
    }
}
#[async_trait]
impl EngineAdapter for PolicyEngine {
    fn id(&self) -> EngineId {
        EngineId::Scripted
    }
    async fn probe(&self) -> Result<EngineInfo, Error> {
        Ok(EngineInfo {
            id: self.id(),
            available: true,
            version: Some("1".into()),
            reason: Some(
                "Policy negotiator: fixed concession rules inside the signed limits".into(),
            ),
        })
    }
    async fn run(
        &self,
        job: AgentJob,
        mcp: McpGrant,
        tx: Sender<EngineEvent>,
    ) -> Result<TerminalVerdict, Error> {
        tx.send(EngineEvent::Init { engine: self.id() })
            .await
            .map_err(|_| Error::Closed)?;
        let brief: PolicyBrief = serde_json::from_str(&job.prompt).map_err(|_| Error::Invalid)?;
        self.check_cancelled(job.run)?;
        let listed = self.rpc(&mcp, 1, "tools/list", json!({})).await?;
        let tools: BTreeSet<&str> = listed
            .get("tools")
            .and_then(Value::as_array)
            .ok_or(Error::Invalid)?
            .iter()
            .filter_map(|t| t.get("name").and_then(Value::as_str))
            .collect();
        if !["table_view", "send_offer", "accept_offer"]
            .iter()
            .all(|t| tools.contains(t))
        {
            return Err(Error::Isolation);
        }
        self.check_cancelled(job.run)?;
        // The host enables the grant when it processes Init; a read has no side effect, so retry
        // briefly until it has.
        let mut view = None;
        for _ in 0..50 {
            view = self.call(&mcp, 2, "table_view", json!({})).await?;
            if view.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            self.check_cancelled(job.run)?;
        }
        let view = view.ok_or(Error::Invalid)?;
        let table: AgentProjection = serde_json::from_value(view).map_err(|_| Error::Invalid)?;
        let act = decide(&brief, &table)?;
        self.check_cancelled(job.run)?;
        let deal_id = table.deal_id;
        // A refusal is the mandate doing its job: the wallet audited it, the run still ends clean.
        match act {
            Act::Nothing => {}
            Act::Offer(price) => {
                self.call(
                    &mcp,
                    3,
                    "send_offer",
                    json!({"deal_id":deal_id,"price":price.decimal(),"delivery":table.delivery}),
                )
                .await?;
            }
            Act::Accept => {
                self.call(
                    &mcp,
                    3,
                    "accept_offer",
                    json!({"deal_id":deal_id,"offer_seq":brief.offer_seq}),
                )
                .await?;
            }
            Act::Withdraw => {
                self.call(
                    &mcp,
                    3,
                    "withdraw_offer",
                    json!({"deal_id":deal_id,"reason":"PRICE"}),
                )
                .await?;
            }
        }
        tx.send(EngineEvent::Result {
            verdict: TerminalVerdict::Clean,
        })
        .await
        .map_err(|_| Error::Closed)?;
        Ok(TerminalVerdict::Clean)
    }
    async fn structured(&self, _input: &str, schema: &Schema) -> Result<Value, Error> {
        let output = json!({"verdict":"ASK"});
        if schema.validate(&output) {
            Ok(output)
        } else {
            Err(Error::Invalid)
        }
    }
    fn cancel(&self, run: RunId) {
        if let Ok(mut runs) = self.cancelled.lock() {
            runs.insert(run);
        }
    }
}
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use table_core::Currency;
    fn money(n: i64) -> Money {
        Money::new(n, Currency::USD).unwrap()
    }
    fn brief(stance: Stance, side: Side) -> PolicyBrief {
        PolicyBrief {
            stance,
            side,
            floor: Some(money(1000)),
            ceiling: Some(money(2500)),
            ask: Some(money(1200)),
            max_rounds: 4,
            round: 1,
            offer_seq: 3,
            now: 100,
        }
    }
    #[test]
    fn brief_round_trips_as_typed_json() {
        let b = brief(Stance::Respond, Side::Buyer);
        let back: PolicyBrief = serde_json::from_str(&serde_json::to_string(&b).unwrap()).unwrap();
        assert_eq!(back.stance, Stance::Respond);
        assert_eq!(back.ceiling, Some(money(2500)));
        assert!(serde_json::from_str::<PolicyBrief>("{\"stance\":\"free text\"}").is_err());
    }
    fn deal(side: Side, price: i64) -> AgentProjection {
        let deal: table_core::Deal = serde_json::from_value(json!({
            "id":"01J00000000000000000000000","kind":"haggle","side":side,
            "counterparty":"peer",
            "terms":{"item_ref":"monitor","qty":1,"unit_price":Money::new(price,Currency::USD).unwrap(),
                "currency":"USD","delivery":{"type":"digital_now"}},
            "state":"NEGOTIATING",
            "mandate_id":"01J00000000000000000000001","mandate_version":1,
            "transcript_head":vec![0; 32],
            "paypal":{},"mode":"sandbox","market":null,"shield":null
        }))
        .unwrap();
        project(&deal)
    }
    fn project(deal: &table_core::Deal) -> AgentProjection {
        AgentProjection::build(table_core::ProjectionInput {
            deal,
            band: None,
            rounds_used: 0,
            steps: &[],
            offer_seq: None,
            own_accept: false,
            counterparty: table_core::TableCounterparty::PairedWallet,
            lapses_at: None,
            now: 100,
        })
    }
    #[test]
    fn decisions_follow_the_side_and_never_leave_the_signed_band() {
        // Buyer opens at the band floor and concedes by round, never past the ceiling.
        let open = decide(&brief(Stance::Open, Side::Buyer), &deal(Side::Buyer, 1200)).unwrap();
        assert_eq!(open, Act::Offer(money(1000)));
        let mut b = brief(Stance::Respond, Side::Buyer);
        b.max_rounds = 3;
        for round in 1..=3 {
            b.round = round;
            match decide(&b, &deal(Side::Buyer, 9000)).unwrap() {
                Act::Offer(m) => assert!(m.minor() <= 2500),
                other => panic!("{other:?}"),
            }
        }
        b.round = 4;
        assert_eq!(decide(&b, &deal(Side::Buyer, 9000)).unwrap(), Act::Withdraw);
        // A price the buyer can live with is accepted as-is.
        b.round = 1;
        assert_eq!(decide(&b, &deal(Side::Buyer, 1000)).unwrap(), Act::Accept);
        // Seller: an offer at or above the floor is accepted; a missing floor is an error.
        let s = brief(Stance::Respond, Side::Seller);
        assert_eq!(decide(&s, &deal(Side::Seller, 1000)).unwrap(), Act::Accept);
        assert!(matches!(
            decide(&s, &deal(Side::Seller, 400)).unwrap(),
            Act::Offer(m) if m.minor() >= 1000
        ));
        let mut no_floor = brief(Stance::Respond, Side::Seller);
        no_floor.floor = None;
        assert!(decide(&no_floor, &deal(Side::Seller, 1000)).is_err());
        // Observe never acts; a seller has nothing to open with.
        assert_eq!(
            decide(
                &brief(Stance::Observe, Side::Seller),
                &deal(Side::Seller, 1)
            )
            .unwrap(),
            Act::Nothing
        );
        assert_eq!(
            decide(&brief(Stance::Open, Side::Seller), &deal(Side::Seller, 1)).unwrap(),
            Act::Nothing
        );
    }
    #[test]
    fn a_stale_market_median_is_ignored_and_a_fresh_one_caps_the_target() {
        let mut d: table_core::Deal = serde_json::from_value(json!({
            "id":"01J00000000000000000000000","kind":"haggle","side":"buyer",
            "counterparty":"peer",
            "terms":{"item_ref":"monitor","qty":1,"unit_price":money(9000),
                "currency":"USD","delivery":{"type":"digital_now"}},
            "state":"NEGOTIATING",
            "mandate_id":"01J00000000000000000000001","mandate_version":1,
            "transcript_head":vec![0; 32],
            "paypal":{},"mode":"sandbox","market":null,"shield":null
        }))
        .unwrap();
        let mut b = brief(Stance::Respond, Side::Buyer);
        b.max_rounds = 1;
        d.market = Some(
            table_core::MarketRef::from_comparables(vec![money(1500)], 100, table_core::H256::ZERO)
                .unwrap(),
        );
        let table = project(&d);
        b.now = 200;
        assert_eq!(decide(&b, &table).unwrap(), Act::Offer(money(1500)));
        b.now = 100 + 900;
        assert_eq!(decide(&b, &table).unwrap(), Act::Offer(money(2500)));
    }
}
