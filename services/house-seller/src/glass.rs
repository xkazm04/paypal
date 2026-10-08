//! The glass-box HOUSE (T9): a public, typed projection of every house deal and a signed head of
//! the house's audit chain, refreshed at most once a minute by the actor and served from memory.
//!
//! The routes read only the published snapshot: they never touch the ledger, never write, and
//! hold no key. The one signed answer computed per request (a prefix) is signed by the actor.
//! The projection is composed here from typed ledger facts only: an envelope's free-text body, a
//! pay link, a receipt's PayPal id, a payee and a refusal's reason never cross.
use crate::{Error, Seller};
use ed25519_dalek::Signer;
use std::sync::Arc;
use table_core::*;
use table_ledger::{AuditRecord, HouseDealFacts, HouseFacts};
use table_proto::{
    Body, GUEST_PREFIX_CHARS, HOUSE_LEDGER_FORMAT, HouseClosed, HouseDealView, HouseHead,
    HouseLedgerView, HouseMoneyKind, HouseMoneyStep, HouseOutcome, HouseParty, HousePrefix,
    HousePriceKind, HouseRefusals, HouseRound, SignedHouseHead, SignedHousePrefix,
};

/// Deals the published projection holds at most (newest first).
pub const LEDGER_CAP: u32 = 500;
/// Deals one page of `/v1/house/ledger` returns at most.
pub const PAGE_MAX: usize = 100;
/// The published head and projection are refreshed at most this often (seconds).
pub const PUBLISH_EVERY: i64 = 60;

/// One refresh: the projection and the verified chain it was read from.
#[derive(Debug)]
pub struct Published {
    pub view: HouseLedgerView,
    /// The hash of every audit row (row n is `chain[n - 1]`), for signed prefixes.
    chain: Vec<H256>,
}
impl Published {
    /// One page, newest first: deals older than `before` (when given), at most `limit`.
    pub fn page(&self, before: Option<DealId>, limit: usize) -> HouseLedgerView {
        let limit = limit.clamp(1, PAGE_MAX);
        let mut view = self.view.clone();
        let older: Vec<HouseDealView> = view
            .deals
            .into_iter()
            .filter(|d| before.is_none_or(|b| d.deal_id < b))
            .collect();
        let held = u32::try_from(self.view.deals.len()).unwrap_or(u32::MAX);
        view.more = older.len() > limit || self.view.total > held;
        view.deals = older.into_iter().take(limit).collect();
        view
    }
}

fn operation(record: &AuditRecord) -> Option<HouseMoneyKind> {
    match record.detail.get("operation")?.as_str()? {
        "create" => Some(HouseMoneyKind::Create),
        "authorize" => Some(HouseMoneyKind::Authorize),
        "capture" => Some(HouseMoneyKind::Capture),
        "void" => Some(HouseMoneyKind::Void),
        _ => None,
    }
}
fn decided(record: &AuditRecord) -> Option<DecidedBy> {
    serde_json::from_value(record.detail.get("decided_by")?.clone()).ok()
}
/// The PayPal transitions of one deal, from its verified audit rows (typed fields only).
fn money(audit: &[AuditRecord]) -> Vec<HouseMoneyStep> {
    let mut steps: Vec<HouseMoneyStep> = Vec::new();
    // A 4xx answer recorded while an operation was open: PayPal refused it.
    let mut refused = false;
    let finish = |steps: &mut Vec<HouseMoneyStep>, kind, outcome| {
        if let Some(step) = steps.iter_mut().rev().find(|s| s.step == kind) {
            step.outcome = outcome;
        }
    };
    for record in audit {
        match record.action.as_str() {
            "money.authorized" => {
                if let Some(step) = operation(record) {
                    refused = false;
                    steps.push(HouseMoneyStep {
                        seq: record.seq,
                        at: record.at,
                        step,
                        outcome: HouseOutcome::Unknown,
                        decided_by: decided(record),
                    });
                }
            }
            "paypal.response" => {
                let status = record.detail.get("status").and_then(|s| s.as_u64());
                refused |= status.is_some_and(|s| (400..500).contains(&s));
            }
            "money.observed" => {
                if let Some(step) = operation(record) {
                    let confirmed =
                        record.detail.get("confirmed").and_then(|c| c.as_bool()) == Some(true);
                    let outcome = if confirmed {
                        HouseOutcome::Ok
                    } else if refused {
                        HouseOutcome::Failed
                    } else {
                        HouseOutcome::Unknown
                    };
                    finish(&mut steps, step, outcome);
                }
            }
            "money.resolved" => {
                if let Some(step) = operation(record) {
                    let outcome = match record.detail.get("outcome").and_then(|o| o.as_str()) {
                        Some(o) if o.starts_with("confirmed") => HouseOutcome::Ok,
                        Some("not_done") => HouseOutcome::Failed,
                        _ => HouseOutcome::Unknown,
                    };
                    finish(&mut steps, step, outcome);
                }
            }
            "deal.transition"
                if record.detail.get("to").and_then(|t| t.as_str()) == Some("APPROVED") =>
            {
                steps.push(HouseMoneyStep {
                    seq: record.seq,
                    at: record.at,
                    step: HouseMoneyKind::ApprovalSeen,
                    outcome: HouseOutcome::Ok,
                    decided_by: None,
                });
            }
            _ => {}
        }
    }
    steps
}
/// The negotiation's priced messages. Notes, pay links, approval notices, receipts and the
/// pairing hello are not rounds and are dropped here, by type.
fn rounds(facts: &HouseDealFacts) -> Vec<HouseRound> {
    let declined: Vec<H256> = facts
        .audit
        .iter()
        .filter(|r| r.action == "offer.declined")
        .filter_map(|r| serde_json::from_value(r.detail.get("hash")?.clone()).ok())
        .collect();
    let mut out = Vec::new();
    let mut round = 0_u32;
    let mut last: Option<Money> = None;
    for e in &facts.envelopes {
        let from = if e.inbound {
            HouseParty::Guest
        } else {
            HouseParty::House
        };
        let (kind, price) = match &e.body {
            Body::Listing { ask, .. } => (HousePriceKind::Listing, Some(*ask)),
            Body::Offer { price, .. } => (HousePriceKind::Offer, Some(*price)),
            Body::Counter { price, .. } => (HousePriceKind::Counter, Some(*price)),
            Body::Accept { .. } => (HousePriceKind::Accept, last),
            Body::Withdraw { .. } => (HousePriceKind::Withdraw, None),
            Body::Hello { .. }
            | Body::Settle { .. }
            | Body::Approved { .. }
            | Body::Receipt { .. }
            | Body::Note { .. } => continue,
        };
        let is_declined = declined.contains(&e.hash);
        if e.inbound && matches!(kind, HousePriceKind::Offer | HousePriceKind::Counter) {
            round = round.saturating_add(1);
        }
        if matches!(
            kind,
            HousePriceKind::Listing | HousePriceKind::Offer | HousePriceKind::Counter
        ) && !is_declined
        {
            last = price;
        }
        out.push(HouseRound {
            round,
            from,
            kind,
            price,
            declined: is_declined,
            hash: e.hash,
            at: e.at,
        });
    }
    out
}
/// Pure projection of one deal's facts. `ask` is the signed ask used when no listing is stored.
pub fn project_deal(facts: &HouseDealFacts, ask: Money) -> HouseDealView {
    let deal = &facts.deal;
    let rounds = rounds(facts);
    let ask = rounds
        .iter()
        .find(|r| r.kind == HousePriceKind::Listing)
        .and_then(|r| r.price)
        .unwrap_or(ask);
    HouseDealView {
        deal_id: deal.id,
        created_at: deal.created_at,
        updated_at: deal.updated_at,
        item_ref: deal.terms.item_ref.clone(),
        ask,
        price: deal.terms.unit_price,
        state: deal.state,
        guest: deal
            .counterparty
            .as_str()
            .chars()
            .take(GUEST_PREFIX_CHARS)
            .collect(),
        rounds,
        refused_intents: u32::try_from(
            facts
                .audit
                .iter()
                .filter(|r| r.action == "intent.refused")
                .count(),
        )
        .unwrap_or(u32::MAX),
        closed: facts
            .closed
            .iter()
            .filter_map(|(attempt, c)| {
                Some(HouseClosed {
                    attempt: *attempt,
                    hash: H256::digest(&c.signing_bytes().ok()?),
                    open_mandate_hash: c.open_mandate_hash,
                    amount: c.amount,
                    decided_by: c.decided_by.clone(),
                })
            })
            .collect(),
        decided_by: deal.decided_by.clone(),
        money: money(&facts.audit),
        paypal_calls: facts.paypal_calls,
        transcript_head: deal.transcript_head,
    }
}

impl Seller {
    pub(crate) fn note_refusal(&mut self, error: &Error) {
        let r = &mut self.refusals;
        match error {
            Error::App(table_app::Error::Refused(refusal))
                if refusal.clause == crate::hosted::DAILY_LIMIT_CLAUSE =>
            {
                r.daily_limit = r.daily_limit.saturating_add(1);
            }
            Error::Full => r.full = r.full.saturating_add(1),
            Error::Invalid
            | Error::App(table_app::Error::Refused(_) | table_app::Error::Permission) => {
                r.other = r.other.saturating_add(1);
            }
            _ => {}
        }
    }
    /// Table requests turned away since the house started.
    pub fn refusals(&self) -> HouseRefusals {
        self.refusals
    }
    fn sign_head(&self, head: HouseHead) -> Result<SignedHouseHead, Error> {
        Ok(SignedHouseHead {
            signature: self
                .agent
                .sign(&head.signing_bytes().map_err(|_| Error::Invalid)?)
                .to_bytes()
                .to_vec(),
            head,
        })
    }
    /// Reads the verified chain and the newest deals, signs the head and publishes both. Writes
    /// nothing. Use [`Seller::refresh`] on the timer; this always reads.
    pub fn publish(&mut self) -> Result<Arc<Published>, Error> {
        let now = self.clock.now();
        let HouseFacts {
            chain,
            first_at,
            deals,
            total,
        } = self.pipeline.wallet.ledger.house_facts(LEDGER_CAP)?;
        let (Some(epoch), Some(audit_head), Some(epoch_started)) =
            (chain.first().copied(), chain.last().copied(), first_at)
        else {
            return Err(Error::Unavailable);
        };
        let head = self.sign_head(HouseHead {
            epoch,
            epoch_started,
            row_count: u64::try_from(chain.len()).map_err(|_| Error::Invalid)?,
            audit_head,
            at: now.max(epoch_started),
        })?;
        let view = HouseLedgerView {
            format: HOUSE_LEDGER_FORMAT.into(),
            head,
            release: self.release.clone(),
            mandate: self.mandate.clone(),
            deals: deals
                .iter()
                .map(|facts| project_deal(facts, self.policy.ask))
                .collect(),
            total,
            more: false,
            refusals: self.refusals,
        };
        let published = Arc::new(Published { view, chain });
        if let Ok(mut slot) = self.published.write() {
            *slot = Some(published.clone());
        }
        self.published_at = Some(now);
        Ok(published)
    }
    /// Publishes when the last refresh is at least [`PUBLISH_EVERY`] seconds old.
    pub(crate) fn refresh(&mut self) -> Result<(), Error> {
        let now = self.clock.now();
        if self
            .published_at
            .is_some_and(|at| now < at.saturating_add(PUBLISH_EVERY))
        {
            return Ok(());
        }
        self.publish().map(|_| ())
    }
    /// The house's signed hash at `rows`, read from the published chain.
    pub fn prefix(&self, rows: u64) -> Result<SignedHousePrefix, Error> {
        let published = self
            .published
            .read()
            .map_err(|_| Error::Unavailable)?
            .clone()
            .ok_or(Error::Unavailable)?;
        let head = &published.view.head.head;
        let index = usize::try_from(rows).map_err(|_| Error::Invalid)?;
        if rows == 0 || rows > head.row_count {
            return Err(Error::Invalid);
        }
        let prefix = HousePrefix {
            epoch: head.epoch,
            row_count: rows,
            audit_head: *published
                .chain
                .get(index.saturating_sub(1))
                .ok_or(Error::Invalid)?,
            within: head.row_count,
            at: self.clock.now(),
        };
        Ok(SignedHousePrefix {
            signature: self
                .agent
                .sign(&prefix.signing_bytes().map_err(|_| Error::Invalid)?)
                .to_bytes()
                .to_vec(),
            prefix,
        })
    }
}
