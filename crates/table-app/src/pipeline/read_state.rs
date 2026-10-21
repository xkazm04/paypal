//! The in-memory read schedule of open money steps, and its bounds (DECISIONS 52b).
//!
//! `rescue_polled`, `parked_read` and `rescue_read_backoff` grow with deals. A deal's entries are
//! dropped once they can no longer govern a read: the deal is terminal, the step is no longer
//! open, or the deal is past the wallet's own read window (`PARKED_READ_WINDOW_SECS`, counted from
//! the durable deadline). A hard cap per map is the backstop. The first three cases read nothing
//! more on their own. After a drop by the cap, a step with no entry may be read sooner than its
//! dropped backed-off or hourly schedule, but never sooner than `RESCUE_POLL_SECS` (the floor)
//! after the drop and never past the durable window, and never on a 1 s tick.
use super::{PARKED_READ_WINDOW_SECS, Pipeline};
use crate::{Error, RESCUE_POLL_SECS, auth::TICKET_SECS};
use std::collections::BTreeMap;
use table_core::*;

/// The most entries each per-deal read-schedule map holds (`rescue_polled`, `parked_read`,
/// `rescue_read_backoff`). At about three entries per failing deal it is far above the deals a
/// wallet keeps open at once; past it the entry with the oldest time is dropped, under the floor.
pub const READ_STATE_CAP: usize = 4096;

/// Inserts `key`; while the map is over `cap`, the entry (other than `key`) with the oldest
/// `time` is dropped. Whether one was dropped.
fn insert_capped<K: Ord + Clone, V>(
    map: &mut BTreeMap<K, V>,
    key: K,
    value: V,
    cap: usize,
    time: impl Fn(&V) -> Timestamp,
) -> bool {
    map.insert(key.clone(), value);
    let mut dropped = false;
    while map.len() > cap.max(1) {
        let Some(oldest) = map
            .iter()
            .filter(|(k, _)| **k != key)
            .min_by_key(|(_, v)| time(v))
            .map(|(k, _)| k.clone())
        else {
            break;
        };
        map.remove(&oldest);
        dropped = true;
    }
    dropped
}

/// The deal a schedule key belongs to: a request id (`{deal}-{attempt}-{operation}`) or the
/// deadline read of a sent invoice (`deadline-read:{deal}`).
fn key_names_deal(key: &str, id: &str) -> bool {
    let rest = key.strip_prefix("deadline-read:").unwrap_or(key);
    // A deal id is its canonical 26-character ULID and holds no '-': the key's first
    // '-'-separated segment is the id exactly when the id is a prefix followed by '-' or the end.
    rest.strip_prefix(id)
        .is_some_and(|tail| tail.is_empty() || tail.starts_with('-'))
}

/// A money read the wallet makes on its own only inside the window past the deadline.
fn windowed(key: &str) -> bool {
    key.ends_with("-authorize") || key.ends_with("-capture") || key.ends_with("-void")
}

impl Pipeline {
    /// Whether a read with no schedule entry must wait: the cap dropped an entry less than
    /// `RESCUE_POLL_SECS` ago, and it may be that read's.
    pub(crate) fn read_floor_holds(&self, now: Timestamp) -> bool {
        now < self.read_floor_until
    }
    fn dropped_by_cap(&mut self, now: Timestamp) {
        self.read_floor_until = self
            .read_floor_until
            .max(now.saturating_add(RESCUE_POLL_SECS));
    }
    /// Records when a parked step was last read on its own (bounded).
    pub(crate) fn note_parked_read(&mut self, key: &str, now: Timestamp) {
        let cap = self.read_state_cap;
        if insert_capped(&mut self.parked_read, key.to_owned(), now, cap, |at| *at) {
            self.dropped_by_cap(now);
        }
    }
    /// Records when a sent rescue invoice was last read (bounded).
    pub(crate) fn note_rescue_polled(&mut self, id: DealId, now: Timestamp) {
        let cap = self.read_state_cap;
        if insert_capped(&mut self.rescue_polled, id, now, cap, |at| *at) {
            self.dropped_by_cap(now);
        }
    }
    /// Records a run of failed reads and when the next is due (bounded; the oldest is the one
    /// whose next read is due first).
    pub(crate) fn note_read_backoff(&mut self, key: &str, entry: (u32, Timestamp), now: Timestamp) {
        let cap = self.read_state_cap;
        if insert_capped(
            &mut self.rescue_read_backoff,
            key.to_owned(),
            entry,
            cap,
            |(_, next)| *next,
        ) {
            self.dropped_by_cap(now);
        }
    }
    /// Drops the deal's schedule entries that can no longer govern a read: all of them once the
    /// deal is terminal; a step's once it is no longer open; a sent invoice's deadline read once
    /// the deal no longer awaits payment; a rescue poll once the invoice is no longer awaited;
    /// and an authorize, capture or void's, and the deadline read, once the deal is
    /// `PARKED_READ_WINDOW_SECS` past its deadline (durable, so nothing reads them then). Spent
    /// owner tickets are dropped once they could no longer validate. Nothing here reads, sends
    /// or writes, and no read comes sooner for it.
    pub fn prune_read_state(&mut self, id: DealId, now: Timestamp) -> Result<(), Error> {
        let live = |(_, at, _): &(DealId, Timestamp, u64)| at.saturating_add(TICKET_SECS) > now;
        self.rescue_owner_read.retain(live);
        self.authorize_owner_read.retain(live);
        // Most deals hold nothing here: no ledger read for them.
        if self.read_state_of(id) == 0 {
            return Ok(());
        }
        let deal = self.wallet.ledger.get_deal(id)?;
        let terminal = deal.state.terminal();
        let open: Vec<String> = if terminal {
            Vec::new()
        } else {
            self.wallet
                .ledger
                .open_operations(Some(id), Timestamp::MAX)?
                .into_iter()
                .map(|op| op.request_id)
                .collect()
        };
        let window_closed = self
            .wallet
            .ledger
            .deadline(id)?
            .is_some_and(|(due, _)| now.saturating_sub(due) >= PARKED_READ_WINDOW_SECS);
        let awaiting = !terminal && deal.state == DealState::AwaitingApproval;
        let id_text = id.to_string();
        let deadline_key = format!("deadline-read:{id_text}");
        let keep = |key: &str| {
            if !key_names_deal(key, &id_text) {
                return true;
            }
            if key == deadline_key {
                return awaiting && !window_closed;
            }
            open.iter().any(|r| r == key) && !(window_closed && windowed(key))
        };
        self.parked_read.retain(|k, _| keep(k));
        self.rescue_read_backoff.retain(|k, _| keep(k));
        if !(awaiting && deal.kind == DealKind::Rescue) {
            self.rescue_polled.remove(&id);
        }
        if terminal {
            self.rescue_owner_read.retain(|(deal, _, _)| *deal != id);
            self.authorize_owner_read.retain(|(deal, _, _)| *deal != id);
        }
        Ok(())
    }
    /// Lowers the per-map cap of the read schedule (tests); never below one entry.
    pub fn set_read_state_cap(&mut self, cap: usize) {
        self.read_state_cap = cap.max(1);
    }
    /// The read-schedule entries held now: (`rescue_polled`, `parked_read`,
    /// `rescue_read_backoff`). A diagnostic; it reads nothing.
    pub fn read_state_len(&self) -> (usize, usize, usize) {
        (
            self.rescue_polled.len(),
            self.parked_read.len(),
            self.rescue_read_backoff.len(),
        )
    }
    /// How many read-schedule entries and spent owner tickets name this deal. A diagnostic.
    pub fn read_state_of(&self, id: DealId) -> usize {
        let id_text = id.to_string();
        let keyed = |k: &String| key_names_deal(k, &id_text);
        usize::from(self.rescue_polled.contains_key(&id))
            + self.parked_read.keys().filter(|k| keyed(k)).count()
            + self.rescue_read_backoff.keys().filter(|k| keyed(k)).count()
            + self
                .rescue_owner_read
                .iter()
                .chain(&self.authorize_owner_read)
                .filter(|(deal, _, _)| *deal == id)
                .count()
    }
}
