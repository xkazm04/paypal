//! Typed reads for the hosted HOUSE's public projection (T9). Read-only: nothing here writes.
//!
//! One call verifies the whole audit chain once and reads every fact the projection needs for the
//! newest deals in a few passes, so a refresh costs O(rows), not O(rows x deals). The caller (the
//! HOUSE) decides which facts cross; an envelope's body is returned typed, and its free-text
//! variants are dropped there.
use crate::{AuditRecord, Ledger, LedgerError, audit, hash_blob, repositories::read_deal};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use std::collections::BTreeMap;
use table_core::{ClosedMandate, Deal, H256, Timestamp};
use table_proto::Body;

/// One stored envelope of a deal, decoded.
#[derive(Debug, Clone)]
pub struct HouseEnvelopeFact {
    pub inbound: bool,
    pub hash: H256,
    pub at: Timestamp,
    pub body: Body,
}
#[derive(Debug, Clone)]
pub struct HouseDealFacts {
    pub deal: Deal,
    /// Oldest first.
    pub envelopes: Vec<HouseEnvelopeFact>,
    /// (attempt, closed mandate) in attempt order.
    pub closed: Vec<(u8, ClosedMandate)>,
    /// The deal's audit rows, oldest first, from the verified chain.
    pub audit: Vec<AuditRecord>,
    /// Rows in `paypal_calls` for the deal.
    pub paypal_calls: u32,
}
#[derive(Debug, Clone)]
pub struct HouseFacts {
    /// The hash of every audit row in order (row n is `chain[n - 1]`), verified.
    pub chain: Vec<H256>,
    /// When the chain's first row was written.
    pub first_at: Option<Timestamp>,
    /// The newest deals (by ULID), newest first.
    pub deals: Vec<HouseDealFacts>,
    /// Deals in the ledger in all.
    pub total: u32,
}

fn timestamp(text: &str) -> Result<Timestamp, LedgerError> {
    text.parse()
        .map_err(|_| LedgerError::Integrity("stored timestamp"))
}
fn body(raw: &str) -> Result<Body, LedgerError> {
    let payload = URL_SAFE_NO_PAD
        .decode(
            raw.split('.')
                .nth(1)
                .ok_or(LedgerError::Integrity("envelope shape"))?,
        )
        .map_err(|_| LedgerError::Integrity("envelope encoding"))?;
    Ok(serde_json::from_slice::<table_proto::Envelope>(&payload)?.body)
}

impl Ledger {
    /// The verified chain and the facts of the newest `limit` deals. A broken chain is an error,
    /// never a partial answer.
    pub fn house_facts(&self, limit: u32) -> Result<HouseFacts, LedgerError> {
        let mut chain = Vec::new();
        let mut first_at = None;
        audit::walk(&self.conn, |hash, at| {
            first_at.get_or_insert(at);
            chain.push(hash);
        })?;
        let total: u32 = self
            .conn
            .query_row("SELECT COUNT(*) FROM deals", [], |r| r.get(0))?;
        let mut statement = self
            .conn
            .prepare("SELECT id FROM deals ORDER BY id DESC LIMIT ?1")?;
        let ids = statement
            .query_map([i64::from(limit)], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let mut deals: BTreeMap<String, HouseDealFacts> = BTreeMap::new();
        for id in &ids {
            let deal = read_deal(
                &self.conn,
                id.parse().map_err(|_| LedgerError::Integrity("deal id"))?,
            )?;
            deals.insert(
                id.clone(),
                HouseDealFacts {
                    deal,
                    envelopes: Vec::new(),
                    closed: Vec::new(),
                    audit: Vec::new(),
                    paypal_calls: 0,
                },
            );
        }
        let mut statement = self.conn.prepare(
            "SELECT deal_id,dir,hash,received_at,raw_jws FROM envelopes WHERE verified=1 ORDER BY rowid",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let Some(facts) = deals.get_mut(&id) else {
                continue;
            };
            let dir: String = row.get(1)?;
            let at: String = row.get(3)?;
            let raw: String = row.get(4)?;
            facts.envelopes.push(HouseEnvelopeFact {
                inbound: dir == "in",
                hash: hash_blob(row.get(2)?)?,
                at: timestamp(&at)?,
                body: body(&raw)?,
            });
        }
        drop(rows);
        let mut statement = self.conn.prepare(
            "SELECT deal_id,attempt,body_json,agent_sig FROM closed_mandates ORDER BY deal_id,attempt",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            let Some(facts) = deals.get_mut(&id) else {
                continue;
            };
            let attempt: u8 = row.get(1)?;
            let body: String = row.get(2)?;
            let sig: Vec<u8> = row.get(3)?;
            // Stored as the signing bytes (no signature) plus the signature column.
            let mut value: serde_json::Value = serde_json::from_str(&body)?;
            value
                .as_object_mut()
                .ok_or(LedgerError::Integrity("closed mandate body"))?
                .insert("agent_sig".into(), serde_json::to_value(sig)?);
            facts.closed.push((attempt, serde_json::from_value(value)?));
        }
        drop(rows);
        let mut statement = self.conn.prepare(
            "SELECT deal_id,COUNT(*) FROM paypal_calls WHERE deal_id IS NOT NULL GROUP BY deal_id",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(0)?;
            if let Some(facts) = deals.get_mut(&id) {
                facts.paypal_calls = row.get(1)?;
            }
        }
        drop(rows);
        let mut statement = self.conn.prepare(
            "SELECT seq,at,actor,action,deal_id,detail_json FROM audit_log WHERE deal_id IS NOT NULL ORDER BY seq",
        )?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let id: String = row.get(4)?;
            let Some(facts) = deals.get_mut(&id) else {
                continue;
            };
            let seq: i64 = row.get(0)?;
            let at: String = row.get(1)?;
            let detail: String = row.get(5)?;
            facts.audit.push(AuditRecord {
                seq: u64::try_from(seq).map_err(|_| LedgerError::Integrity("audit sequence"))?,
                at: timestamp(&at)?,
                actor: row.get(2)?,
                action: row.get(3)?,
                deal_id: Some(facts.deal.id),
                detail: serde_json::from_str(&detail)?,
            });
        }
        drop(rows);
        let deals = ids
            .iter()
            .filter_map(|id| deals.remove(id))
            .collect::<Vec<_>>();
        Ok(HouseFacts {
            chain,
            first_at,
            deals,
            total,
        })
    }
}
