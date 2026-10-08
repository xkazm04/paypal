//! Market watch (T15): the price checks the scheduler makes under an owner's signed
//! market-watch rule. Each check is one `market.checked` audit row, written before the market
//! service is asked, so a day's allowance is counted from the append-only chain and can never be
//! exceeded, not even across a crash between the row and the fetch.
use crate::{AuditEntry, Ledger, LedgerError, audit};
use rusqlite::{Connection, TransactionBehavior, params};
use serde_json::json;
use table_core::{DealId, H256, ItemRef, MandateId, Timestamp, market_watch_day};

/// One price check about to be made: which deal, under which signed rule, for which product.
#[derive(Debug, Clone)]
pub struct MarketCheck<'a> {
    pub deal_id: DealId,
    pub mandate_id: MandateId,
    pub mandate_version: u32,
    pub mandate_hash: H256,
    pub item_ref: &'a ItemRef,
    pub product_id: &'a str,
    /// The rule's daily allowance.
    pub max_per_day: u16,
}

fn checks_on(conn: &Connection, mandate: MandateId, at: Timestamp) -> Result<u32, LedgerError> {
    let (start, end) = market_watch_day(at);
    let used: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE action='market.checked' AND json_extract(detail_json,'$.mandate_id')=?1 AND CAST(at AS INTEGER)>=?2 AND CAST(at AS INTEGER)<?3",
        params![mandate.to_string(), start, end],
        |r| r.get(0),
    )?;
    u32::try_from(used).map_err(|_| LedgerError::Integrity("market check count"))
}

impl Ledger {
    /// How many price checks the mandate's market-watch rule used in the UTC day holding `at`,
    /// counted over every version of the mandate.
    pub fn market_checks_today(
        &self,
        mandate: MandateId,
        at: Timestamp,
    ) -> Result<u32, LedgerError> {
        checks_on(&self.conn, mandate, at)
    }
    /// Records one price check before it is made and returns the day's count including it. A
    /// check that would exceed the rule's allowance writes nothing and is a `Conflict`.
    pub fn reserve_market_check(
        &mut self,
        check: &MarketCheck<'_>,
        at: Timestamp,
    ) -> Result<u32, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let used = checks_on(&tx, check.mandate_id, at)?;
        if used >= u32::from(check.max_per_day) {
            return Err(LedgerError::Conflict);
        }
        let (day, _) = market_watch_day(at);
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "market".into(),
                action: "market.checked".into(),
                deal_id: Some(check.deal_id),
                detail: json!({
                    "mandate_id": check.mandate_id,
                    "mandate_version": check.mandate_version,
                    "mandate_hash": check.mandate_hash,
                    "item_ref": check.item_ref,
                    "product_id": check.product_id,
                    "day": day,
                    "count": used + 1,
                    "max_per_day": check.max_per_day,
                }),
            },
        )?;
        tx.commit()?;
        Ok(used + 1)
    }
}
