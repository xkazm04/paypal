//! Durable delivery state. A staged inbox survives crashes before and after semantic commit.
use crate::{AuditEntry, Ledger, LedgerError, audit, hash_blob};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use table_core::{DealId, H256, KeyId, Timestamp};

#[derive(Debug, Clone)]
pub struct RelayWork {
    pub deal_id: DealId,
    pub mailbox: H256,
    pub generation: String,
    pub cursor: u64,
    pub outgoing: Vec<(H256, String)>,
    /// When the deal was receipted, for a route that is polled only to notice a relay restart
    /// (RECEIPTED, nothing owed); `None` for every other route. DECISIONS section 46.
    pub settled_at: Option<Timestamp>,
}
/// How long after settlement a RECEIPTED deal with nothing owed is still polled so that a relay
/// restart is noticed and the signed history resent: 72 hours, the same span as the buyer's
/// corroboration window (DECISIONS section 28). After it the route is retired from the relay scan.
/// DECISIONS section 46 amends section 6.
pub const RECOVERY_WINDOW_SECS: i64 = 72 * 3600;
/// The first interval between polls of a settled route; the interval then grows with the time
/// since settlement (see [`recovery_interval`]).
pub const RECOVERY_POLL_BASE_SECS: i64 = 5;
/// The longest interval between polls of a settled route inside the window.
pub const RECOVERY_POLL_CEILING_SECS: i64 = 3600;
/// The wait after a poll made `age` seconds after settlement: the age itself, so each wait doubles
/// the age, clamped between the base and the ceiling (polls at 0, 5, 10, 20, 40 s ... then hourly).
pub fn recovery_interval(age: i64) -> i64 {
    age.clamp(RECOVERY_POLL_BASE_SECS, RECOVERY_POLL_CEILING_SECS)
}
/// Remembers, in memory only, when each settled route was last polled and thins them to the
/// decaying cadence. A restart forgets it, so the first poll after a restart is at once, which
/// is also when a relay restart is most likely to need noticing.
#[derive(Debug, Default)]
pub struct SettledPollClock {
    last: std::collections::BTreeMap<DealId, Timestamp>,
}
impl SettledPollClock {
    /// Keeps the work due at `now`: every route that owes something or is not settled, and a
    /// settled route only when its interval since the last poll has passed. Routes that left the
    /// scan are forgotten. Nothing is marked polled here: the caller sends only part of the due
    /// work in one pass and marks what it sent with [`Self::polled`] (scan 2026-10-16 R-1).
    pub fn due(&mut self, work: Vec<RelayWork>, now: Timestamp) -> Vec<RelayWork> {
        self.last
            .retain(|id, _| work.iter().any(|w| w.deal_id == *id));
        work.into_iter()
            .filter(|w| {
                let Some(settled) = w.settled_at else {
                    return true;
                };
                // A last poll later than `now` means the clock stepped back: count it as due.
                self.last.get(&w.deal_id).is_none_or(|last| {
                    *last > now
                        || now.saturating_sub(*last)
                            >= recovery_interval(last.saturating_sub(settled))
                })
            })
            .collect()
    }
    /// Marks the settled routes of `sent` as polled at `now`; the next poll of each waits its
    /// interval.
    pub fn polled(&mut self, sent: &[RelayWork], now: Timestamp) {
        for work in sent.iter().filter(|w| w.settled_at.is_some()) {
            self.last.insert(work.deal_id, now);
        }
    }
}
#[derive(Debug)]
pub struct InboxMessage {
    pub deal_id: DealId,
    pub generation: String,
    pub position: u64,
    pub raw: String,
}
/// A legitimate relay resets a deal's generation on a restart or a 24-hour mailbox expiry, not twice
/// in ten minutes; a refused reset only delays that deal and never moves money. The window counts
/// from the last reset. The first adoption from the empty generation is not a reset and does not
/// start it, so a fresh deal recovers at once from one lost mailbox. `generation_at` 0 means the
/// route has never been reset.
const RESET_WINDOW_SECS: i64 = 600;
/// Backstop only: one generation holds at most 256 rows and settled rows of earlier generations are
/// pruned on reset, so a legitimate deal never nears this.
const INBOX_CAP: i64 = 1024;
impl Ledger {
    pub fn pin_pairing_mailbox(&mut self, peer: &KeyId, hash: H256) -> Result<(), LedgerError> {
        self.conn.execute(
            "INSERT INTO pairing_mailboxes(counterparty,code_hash) VALUES (?1,?2)",
            params![peer.as_str(), &hash.0[..]],
        )?;
        Ok(())
    }
    pub fn bind_paired_relay(&mut self, id: DealId, at: Timestamp) -> Result<bool, LedgerError> {
        let deal = self.get_deal(id)?;
        let code: Option<Vec<u8>> = self
            .conn
            .query_row(
                "SELECT code_hash FROM pairing_mailboxes WHERE counterparty=?1",
                [deal.counterparty.as_str()],
                |r| r.get(0),
            )
            .optional()?;
        let Some(code) = code else {
            return Ok(false);
        };
        let mut binding = hash_blob(code)?.0.to_vec();
        binding.extend_from_slice(id.to_string().as_bytes());
        self.bind_relay(id, H256::digest(&binding), at)?;
        Ok(true)
    }
    /// Trusted Rust setup, after owner pairing/deal checks; never an agent tool.
    pub fn bind_relay(
        &mut self,
        id: DealId,
        mailbox: H256,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if !matches!(
            crate::repositories::read_deal(&tx, id)?.mode,
            table_core::Mode::Sandbox
        ) {
            return Err(LedgerError::Conflict);
        }
        let existing: Option<Vec<u8>> = tx
            .query_row(
                "SELECT mailbox FROM relay_routes WHERE deal_id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(existing) = existing {
            if hash_blob(existing)? != mailbox {
                return Err(LedgerError::Conflict);
            }
            return Ok(());
        }
        // Only routes of pre-capture deals hold capacity; captured and finished deals release theirs.
        let pre_capture = table_core::DealState::ALL
            .into_iter()
            .filter(|s| s.pre_capture())
            .map(|s| crate::repositories::enum_text(&s))
            .collect::<Result<Vec<_>, _>>()?;
        let live: u32 = tx.query_row(
            "SELECT COUNT(*) FROM relay_routes r JOIN deals d ON d.id=r.deal_id \
             WHERE d.state IN (SELECT value FROM json_each(?1))",
            [serde_json::to_string(&pre_capture)?],
            |r| r.get(0),
        )?;
        if live >= 64 {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "INSERT INTO relay_routes(deal_id,mailbox) VALUES (?1,?2)",
            params![id.to_string(), &mailbox.0[..]],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "relay.bound".into(),
                deal_id: Some(id),
                detail: serde_json::json!({"mailbox":mailbox}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// [`Self::relay_work_at`] at the system clock, for callers that keep no injected clock.
    pub fn relay_work(&self) -> Result<Vec<RelayWork>, LedgerError> {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs() as i64);
        self.relay_work_at(now)
    }
    /// The routes to deliver and poll at `now`. A route that owes envelopes is always returned. A
    /// finished route with nothing owed is dropped. A RECEIPTED route with nothing owed is returned
    /// (with `settled_at`) only until [`RECOVERY_WINDOW_SECS`] after settlement, then retired
    /// (DECISIONS section 46); a deal with no settlement row is retired too, since it cannot be aged.
    pub fn relay_work_at(&self, now: Timestamp) -> Result<Vec<RelayWork>, LedgerError> {
        let mut q = self.conn.prepare(
            "SELECT r.deal_id,r.mailbox,r.generation,r.cursor,d.state FROM relay_routes r \
             JOIN deals d ON d.id=r.deal_id ORDER BY r.deal_id",
        )?;
        let rows = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, Vec<u8>>(1)?,
                    r.get::<_, String>(2)?,
                    u64::from(r.get::<_, u32>(3)?),
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        // Every route's undelivered outgoing envelopes in one pass, in seq order per deal.
        let mut q = self.conn.prepare(
            "SELECT e.deal_id,e.hash,e.raw_jws FROM envelopes e \
             JOIN relay_routes r ON r.deal_id=e.deal_id \
             WHERE e.dir='out' AND NOT EXISTS(SELECT 1 FROM relay_delivered a \
             WHERE a.deal_id=e.deal_id AND a.hash=e.hash AND a.generation=r.generation) \
             ORDER BY e.deal_id,e.seq",
        )?;
        let mut owed = std::collections::HashMap::<String, Vec<(H256, String)>>::new();
        for row in q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Vec<u8>>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (id, hash, raw) = row?;
            owed.entry(id).or_default().push((hash_blob(hash)?, raw));
        }
        let mut work = Vec::new();
        for (id, mailbox, generation, cursor, state) in rows {
            let outgoing = owed.remove(&id).unwrap_or_default();
            let state: table_core::DealState = crate::repositories::parse_enum(state)?;
            let deal_id = id.parse().map_err(|_| LedgerError::Integrity("deal id"))?;
            // A finished deal still delivers what it owes (a WITHDRAW, a RECEIPT), then goes quiet.
            // A Receipted deal is also polled for the recovery window after settlement, because a
            // relay restart is only noticed by polling and both wallets must then resend the signed
            // history; after the window it is retired (section 46, amending section 6).
            let mut settled_at = None;
            if outgoing.is_empty() {
                if state == table_core::DealState::Receipted {
                    // A settlement later than `now` (clock stepped back) is clamped to `now`.
                    let at = self.receipted_at(deal_id)?.unwrap_or(0).min(now);
                    if now.saturating_sub(at) >= RECOVERY_WINDOW_SECS {
                        continue;
                    }
                    settled_at = Some(at);
                } else if state.terminal() {
                    continue;
                }
            }
            work.push(RelayWork {
                deal_id,
                mailbox: hash_blob(mailbox)?,
                generation,
                cursor,
                outgoing,
                settled_at,
            });
        }
        Ok(work)
    }
    /// When the deal first moved to RECEIPTED, from its `deal.transition` audit row.
    fn receipted_at(&self, id: DealId) -> Result<Option<Timestamp>, LedgerError> {
        Ok(self
            .conn
            .query_row(
                "SELECT MIN(CAST(at AS INTEGER)) FROM audit_log WHERE deal_id=?1 AND action='deal.transition' AND json_extract(detail_json,'$.to')=?2",
                params![id.to_string(), "RECEIPTED"],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }
    /// Cursor and raw inbox are committed together; network completion never advances deal state.
    pub fn stage_relay_batch(
        &mut self,
        id: DealId,
        generation: &str,
        after: u64,
        messages: &[String],
        now: Timestamp,
    ) -> Result<(), LedgerError> {
        if generation.len() != 32
            || !generation.bytes().all(|b| b.is_ascii_hexdigit())
            || after.saturating_add(messages.len() as u64) > 256
            || messages.iter().any(|s| s.len() > 16384 || !s.is_ascii())
        {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let (old, cursor, changed_at): (String, u64, i64) = tx.query_row(
            "SELECT generation,cursor,generation_at FROM relay_routes WHERE deal_id=?1",
            [id.to_string()],
            |r| Ok((r.get(0)?, u64::from(r.get::<_, u32>(1)?), r.get(2)?)),
        )?;
        let reset = old != generation;
        let real_reset = reset && !old.is_empty();
        if (!reset && cursor != after) || (reset && after != 0) {
            return Err(LedgerError::Conflict);
        }
        if real_reset && changed_at > 0 && now.saturating_sub(changed_at) < RESET_WINDOW_SECS {
            drop(tx);
            self.note_relay_refusal(id, generation, "reset_window", now)?;
            return Err(LedgerError::Conflict);
        }
        if reset {
            // Transport staging, not evidence: an applied message lives in envelopes and a
            // rejected one is in the audit log by its raw hash. Pending rows are kept.
            tx.execute(
                "DELETE FROM relay_inbox WHERE deal_id=?1 AND generation<>?2 AND status IN ('applied','rejected')",
                params![id.to_string(), generation],
            )?;
        }
        for (offset, raw) in messages.iter().enumerate() {
            tx.execute(
                "INSERT INTO relay_inbox(deal_id,generation,position,raw_jws) VALUES (?1,?2,?3,?4)",
                params![
                    id.to_string(),
                    generation,
                    (after + offset as u64 + 1) as u32,
                    raw
                ],
            )?;
        }
        let held: i64 = tx.query_row(
            "SELECT COUNT(*) FROM relay_inbox WHERE deal_id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        if held > INBOX_CAP {
            drop(tx);
            self.note_relay_refusal(id, generation, "inbox_cap", now)?;
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "UPDATE relay_routes SET generation=?1,cursor=?2,generation_at=CASE WHEN ?4 THEN ?5 ELSE generation_at END WHERE deal_id=?3",
            params![
                generation,
                (after + messages.len() as u64) as u32,
                id.to_string(),
                real_reset,
                now
            ],
        )?;
        tx.commit()?;
        Ok(())
    }
    /// Records a refused relay behaviour (a second generation reset inside the window, an inbox
    /// past its cap) once per (deal, generation, reason): the same refused poll repeats every
    /// cycle and must not grow the chain. Names no message text, only the generation.
    fn note_relay_refusal(
        &mut self,
        id: DealId,
        generation: &str,
        reason: &str,
        now: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let seen: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM audit_log WHERE deal_id=?1 AND action='relay.reset_refused' AND json_extract(detail_json,'$.generation')=?2 AND json_extract(detail_json,'$.reason')=?3)",
            params![id.to_string(), generation, reason],
            |r| r.get(0),
        )?;
        if !seen {
            audit::append(
                &tx,
                &AuditEntry {
                    at: now,
                    actor: "relay".into(),
                    action: "relay.reset_refused".into(),
                    deal_id: Some(id),
                    detail: serde_json::json!({"generation": generation, "reason": reason}),
                },
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn acknowledge_relay(
        &mut self,
        id: DealId,
        generation: &str,
        hash: H256,
    ) -> Result<(), LedgerError> {
        self.conn.execute("INSERT INTO relay_delivered(deal_id,hash,generation) SELECT ?1,?2,?3 WHERE EXISTS(SELECT 1 FROM envelopes WHERE deal_id=?1 AND dir='out' AND hash=?2) ON CONFLICT(deal_id,hash) DO UPDATE SET generation=excluded.generation", params![id.to_string(),&hash.0[..],generation])?;
        Ok(())
    }
    pub fn pending_inbox(&self) -> Result<Vec<InboxMessage>, LedgerError> {
        let mut q = self.conn.prepare("SELECT deal_id,generation,position,raw_jws FROM relay_inbox WHERE status='pending' ORDER BY rowid")?;
        q.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                u64::from(r.get::<_, u32>(2)?),
                r.get::<_, String>(3)?,
            ))
        })?
        .map(|r| {
            let (id, generation, position, raw) = r?;
            Ok(InboxMessage {
                deal_id: id.parse().map_err(|_| LedgerError::Integrity("deal id"))?,
                generation,
                position,
                raw,
            })
        })
        .collect()
    }
    pub fn has_envelope_hash(&self, id: DealId, hash: H256) -> Result<bool, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM envelopes WHERE deal_id=?1 AND hash=?2 AND verified=1)",
            params![id.to_string(), &hash.0[..]],
            |r| r.get(0),
        )?)
    }
    /// Finishes one inbox message. An accepted message becomes `applied`; a rejected one goes
    /// through [`Self::reject_inbox`] as a batch of one, so every relay rejection has one shape.
    pub fn finish_inbox(
        &mut self,
        message: &InboxMessage,
        accepted: bool,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !accepted {
            return self.reject_inbox(std::slice::from_ref(message), at);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute("UPDATE relay_inbox SET status='applied' WHERE deal_id=?1 AND generation=?2 AND position=?3 AND status='pending'", params![message.deal_id.to_string(),message.generation,u32::try_from(message.position).map_err(|_|LedgerError::Conflict)?])? != 1 { return Err(LedgerError::Conflict); }
        tx.commit()?;
        Ok(())
    }
    /// Rejects a batch of pending inbox messages with one `envelope.rejected` audit row.
    ///
    /// An empty slice writes nothing and returns `Ok(())`. Every message must carry the first
    /// message's `deal_id` and `generation`, and there may be at most 256 of them; otherwise it
    /// returns `Conflict` and writes nothing. It runs in one Immediate transaction: each
    /// message's `relay_inbox` row (deal, generation, position, status `pending`) becomes
    /// `rejected`; if an UPDATE changes anything other than exactly one row (a position repeated
    /// in the slice ends here too) it returns `Conflict` and drops the transaction. It then
    /// appends exactly one audit row (actor `relay`, action `envelope.rejected`, the deal) whose
    /// detail holds `generation`, `count`, `raw_hashes` (digests in slice order) and `reason`.
    /// Raw text never reaches the audit log, only digests. Then it commits.
    pub fn reject_inbox(
        &mut self,
        messages: &[InboxMessage],
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let Some(first) = messages.first() else {
            return Ok(());
        };
        if messages.len() > 256
            || messages
                .iter()
                .any(|m| m.deal_id != first.deal_id || m.generation != first.generation)
        {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        for message in messages {
            let position = u32::try_from(message.position).map_err(|_| LedgerError::Conflict)?;
            if tx.execute(
                "UPDATE relay_inbox SET status='rejected' WHERE deal_id=?1 AND generation=?2 AND position=?3 AND status='pending'",
                params![message.deal_id.to_string(), message.generation, position],
            )? != 1
            {
                return Err(LedgerError::Conflict);
            }
        }
        let raw_hashes: Vec<H256> = messages
            .iter()
            .map(|m| H256::digest(m.raw.as_bytes()))
            .collect();
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "relay".into(),
                action: "envelope.rejected".into(),
                deal_id: Some(first.deal_id),
                detail: serde_json::json!({
                    "generation": first.generation,
                    "count": messages.len(),
                    "raw_hashes": raw_hashes,
                    "reason": "protocol or mandate rejection",
                }),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
