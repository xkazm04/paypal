//! Rescue detection: the owner's own subscriptions the wallet watches for a failed renewal
//! (migration 0014). The owner adds and stops a watch in the approval window; the scheduler reads
//! each due watch from PayPal (a read only) and opens at most one rescue per run of failures.
//!
//! Every read is one `rescue.watch_read` audit row written before PayPal is asked, so a day's read
//! budget is counted from the append-only chain and can never be exceeded, not even across a crash
//! between the row and the read. The subscriber's email the owner entered stays in the watch row:
//! it is never audited, logged or shown in full.
use crate::{AuditEntry, Ledger, LedgerError, Recipient, audit, valid_subscription_id};
use rusqlite::{Connection, OptionalExtension, Row, TransactionBehavior, params};
use serde_json::json;
use table_core::{
    ItemRef, RESCUE_WATCH_READ_SECS, Timestamp, market_watch_day, rescue_watch_retry_secs,
};

/// One watched subscription, as the ledger keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RescueWatch {
    /// PayPal's subscription id.
    pub subscription_id: String,
    /// The subscriber's email as the owner entered it; the fix's invoice goes there.
    pub recipient: Recipient,
    /// The plan, as the owner's own item reference (the rescue deal's title).
    pub plan: ItemRef,
    pub added_at: Timestamp,
    pub next_read_at: Timestamp,
    /// Reads in a row that could not be used (the backoff).
    pub tries: u32,
    pub last_read_at: Option<Timestamp>,
    /// PayPal's count of consecutive failed payments at the last good read.
    pub last_failed: Option<u32>,
    /// When the current run of failed payments was first seen; None while renewals are paid.
    pub failing_since: Option<Timestamp>,
}

const COLUMNS: &str = "subscription_id,recipient,plan,added_at,next_read_at,tries,last_read_at,last_failed,failing_since";

fn watch_row(r: &Row<'_>) -> rusqlite::Result<RescueWatchRaw> {
    Ok(RescueWatchRaw {
        subscription_id: r.get(0)?,
        recipient: r.get(1)?,
        plan: r.get(2)?,
        added_at: r.get(3)?,
        next_read_at: r.get(4)?,
        tries: r.get(5)?,
        last_read_at: r.get(6)?,
        last_failed: r.get(7)?,
        failing_since: r.get(8)?,
    })
}
struct RescueWatchRaw {
    subscription_id: String,
    recipient: String,
    plan: String,
    added_at: Timestamp,
    next_read_at: Timestamp,
    tries: u32,
    last_read_at: Option<Timestamp>,
    last_failed: Option<u32>,
    failing_since: Option<Timestamp>,
}
impl RescueWatchRaw {
    fn typed(self) -> Result<RescueWatch, LedgerError> {
        Ok(RescueWatch {
            subscription_id: self.subscription_id,
            recipient: Recipient::new(self.recipient)
                .map_err(|_| LedgerError::Integrity("watch recipient"))?,
            plan: ItemRef::new(self.plan).map_err(|_| LedgerError::Integrity("watch plan"))?,
            added_at: self.added_at,
            next_read_at: self.next_read_at,
            tries: self.tries,
            last_read_at: self.last_read_at,
            last_failed: self.last_failed,
            failing_since: self.failing_since,
        })
    }
}

fn active_watch(conn: &Connection, subscription_id: &str) -> Result<RescueWatch, LedgerError> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM rescue_watches WHERE subscription_id=?1 AND active=1"),
        [subscription_id],
        watch_row,
    )
    .optional()?
    .ok_or(LedgerError::NotFound)?
    .typed()
}

fn reads_on(conn: &Connection, at: Timestamp) -> Result<u32, LedgerError> {
    let (start, end) = market_watch_day(at);
    let used: i64 = conn.query_row(
        "SELECT COUNT(*) FROM audit_log WHERE action='rescue.watch_read' AND CAST(at AS INTEGER)>=?1 AND CAST(at AS INTEGER)<?2",
        params![start, end],
        |r| r.get(0),
    )?;
    u32::try_from(used).map_err(|_| LedgerError::Integrity("watch read count"))
}

impl Ledger {
    /// The owner adds a subscription to watch (or changes the email or plan of one watched). At
    /// most `max` are watched at once; over that, or with a malformed id, nothing is written
    /// (`Conflict`). A watch added again after it was stopped keeps its run of failures, so it
    /// never opens a second fix for a failure it already fixed. Read soon after.
    pub fn watch_subscription(
        &mut self,
        subscription_id: &str,
        recipient: &Recipient,
        plan: &ItemRef,
        max: usize,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !valid_subscription_id(subscription_id) {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let others: i64 = tx.query_row(
            "SELECT COUNT(*) FROM rescue_watches WHERE active=1 AND subscription_id<>?1",
            [subscription_id],
            |r| r.get(0),
        )?;
        if usize::try_from(others).map_err(|_| LedgerError::Integrity("watch count"))? >= max {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "INSERT INTO rescue_watches(subscription_id,recipient,plan,active,added_at,next_read_at,tries) VALUES (?1,?2,?3,1,?4,?4,0) ON CONFLICT(subscription_id) DO UPDATE SET recipient=excluded.recipient, plan=excluded.plan, active=1, next_read_at=excluded.next_read_at, tries=0",
            params![subscription_id, recipient.expose(), plan.as_str(), at],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "rescue.watch_added".into(),
                deal_id: None,
                detail: json!({"subscription_id": subscription_id, "plan": plan}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The owner stops watching a subscription: it is read no more. The row stays (stopped, not
    /// deleted). A rescue it already opened is not touched.
    pub fn stop_watching(
        &mut self,
        subscription_id: &str,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE rescue_watches SET active=0 WHERE subscription_id=?1 AND active=1",
            [subscription_id],
        )? != 1
        {
            return Err(LedgerError::NotFound);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "rescue.watch_stopped".into(),
                deal_id: None,
                detail: json!({"subscription_id": subscription_id}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Every subscription being watched, oldest first.
    pub fn rescue_watches(&self) -> Result<Vec<RescueWatch>, LedgerError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM rescue_watches WHERE active=1 ORDER BY added_at, subscription_id"
        ))?;
        let rows = stmt.query_map([], watch_row)?;
        rows.map(|r| r.map_err(LedgerError::from).and_then(RescueWatchRaw::typed))
            .collect()
    }

    /// The watches due for a read at `now`, longest waiting first, at most `limit`.
    pub fn due_rescue_watches(
        &self,
        now: Timestamp,
        limit: usize,
    ) -> Result<Vec<RescueWatch>, LedgerError> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM rescue_watches WHERE active=1 AND next_read_at<=?1 ORDER BY next_read_at, subscription_id LIMIT ?2"
        ))?;
        let limit = i64::try_from(limit).map_err(|_| LedgerError::Integrity("watch limit"))?;
        let rows = stmt.query_map(params![now, limit], watch_row)?;
        rows.map(|r| r.map_err(LedgerError::from).and_then(RescueWatchRaw::typed))
            .collect()
    }

    /// How many subscription reads the watch made in the UTC day holding `at`.
    pub fn rescue_watch_reads_today(&self, at: Timestamp) -> Result<u32, LedgerError> {
        reads_on(&self.conn, at)
    }

    /// Records one subscription read before it is made and returns the day's count including it.
    /// A read over the day's budget, or of a subscription no longer watched, writes nothing
    /// (`Conflict` / `NotFound`).
    pub fn reserve_rescue_watch_read(
        &mut self,
        subscription_id: &str,
        max_per_day: u32,
        at: Timestamp,
    ) -> Result<u32, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        active_watch(&tx, subscription_id)?;
        let used = reads_on(&tx, at)?;
        if used >= max_per_day {
            return Err(LedgerError::Conflict);
        }
        let (day, _) = market_watch_day(at);
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "rescue.watch_read".into(),
                deal_id: None,
                detail: json!({
                    "subscription_id": subscription_id,
                    "day": day,
                    "count": used + 1,
                    "max_per_day": max_per_day,
                }),
            },
        )?;
        tx.commit()?;
        Ok(used + 1)
    }

    /// What a read showed: PayPal's count of consecutive failed payments, or None for a read that
    /// could not be used (it is tried again later, backing off). A count of zero ends the run of
    /// failures; the first failed count starts one. A changed count is one `rescue.watch_seen`
    /// audit row (no email, no amount).
    pub fn record_rescue_watch_read(
        &mut self,
        subscription_id: &str,
        failed_payments: Option<u32>,
        at: Timestamp,
    ) -> Result<RescueWatch, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let before = active_watch(&tx, subscription_id)?;
        match failed_payments {
            None => {
                let tries = before.tries.saturating_add(1);
                tx.execute(
                    "UPDATE rescue_watches SET tries=?2, next_read_at=?3 WHERE subscription_id=?1",
                    params![
                        subscription_id,
                        tries,
                        at.saturating_add(rescue_watch_retry_secs(tries))
                    ],
                )?;
            }
            Some(failed) => {
                let failing_since = (failed > 0).then(|| before.failing_since.unwrap_or(at));
                tx.execute(
                    "UPDATE rescue_watches SET tries=0, last_read_at=?2, last_failed=?3, failing_since=?4, next_read_at=?5 WHERE subscription_id=?1",
                    params![
                        subscription_id,
                        at,
                        failed,
                        failing_since,
                        at.saturating_add(RESCUE_WATCH_READ_SECS)
                    ],
                )?;
                if before.last_failed != Some(failed) {
                    audit::append(
                        &tx,
                        &AuditEntry {
                            at,
                            actor: "policy".into(),
                            action: "rescue.watch_seen".into(),
                            deal_id: None,
                            detail: json!({
                                "subscription_id": subscription_id,
                                "failed_payments": failed,
                            }),
                        },
                    )?;
                }
            }
        }
        let after = active_watch(&tx, subscription_id)?;
        tx.commit()?;
        Ok(after)
    }

    /// Whether the current run of failures of a watched subscription already has its one fix: a
    /// rescue PayPal reported, opened on or after the UTC day the run was first seen. Derived from
    /// the written-once rescue rows, so a crash between opening the fix and anything after it
    /// never opens a second one.
    pub fn rescue_watch_handled(&self, subscription_id: &str) -> Result<bool, LedgerError> {
        let watch = active_watch(&self.conn, subscription_id)?;
        let Some(since) = watch.failing_since else {
            return Ok(false);
        };
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM rescue_cases WHERE subscription_id=?1 AND source='paypal' AND failed_on>=?2)",
            params![subscription_id, since.div_euclid(86400)],
            |r| r.get(0),
        )?)
    }
}
