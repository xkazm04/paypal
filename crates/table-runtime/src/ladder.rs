//! Evidence of informed silence (attention-ladder-1): the runtime records each rung of the
//! attention ladder the owner was actually offered as an `attention.rung` audit row (table-ledger
//! `attention.rs`). Only a card of an attention snapshot with a live deadline gets a rung, so no
//! row is ever written for a deal the owner could not have seen. A rung that cannot be written is
//! logged and dropped: no rung ever delays, blocks or changes a default.
use crate::Runtime;
use table_attention::{AttentionItem, AttnKind, LADDER};
use table_core::{DealId, LadderRung, NotifySuppression, Timestamp};

impl Runtime {
    /// Records `rung` for this card's deadline once; returns whether a row was written.
    pub(crate) fn record_rung(
        &mut self,
        item: &AttentionItem,
        rung: LadderRung,
        reason: Option<NotifySuppression>,
        now: Timestamp,
    ) -> bool {
        let Some(deadline) = item.deadline.filter(|d| *d > now) else {
            return false;
        };
        let key = (item.deal_id, deadline, rung);
        if self.rungs_recorded.contains(&key) {
            return false;
        }
        #[cfg(test)]
        if self.fail_rungs {
            eprintln!("The Table: an attention rung could not be recorded");
            return false;
        }
        match self
            .pipeline
            .wallet
            .ledger
            .record_rung(item.deal_id, deadline, rung, reason, now)
        {
            Ok(written) => {
                self.rungs_recorded.insert(key);
                written
            }
            Err(_) => {
                // The kind of failure only: no deal text, no counterparty words.
                eprintln!("The Table: an attention rung could not be recorded");
                false
            }
        }
    }
    /// The rungs a snapshot itself is: each card shown, each GATE whose ring breathes, and each
    /// due notification the owner's Do Not Disturb (or notifications off) holds back.
    pub(crate) fn record_snapshot_rungs(&mut self, items: &[AttentionItem], now: Timestamp) {
        let dnd = self.preferences.dnd;
        let silent = !self.preferences.notifications;
        for item in items {
            self.record_rung(item, LadderRung::Shown, None, now);
            if item.kind != AttnKind::Gate {
                continue;
            }
            if !dnd && LADDER.breathes(item.deadline, now) {
                self.record_rung(item, LadderRung::Breathing, None, now);
            }
            if LADDER.notify_due(item.deadline, now) {
                let reason = if dnd {
                    Some(NotifySuppression::DoNotDisturb)
                } else if silent {
                    Some(NotifySuppression::NotificationsOff)
                } else {
                    None
                };
                if reason.is_some() {
                    self.record_rung(item, LadderRung::NotifySuppressed, reason, now);
                }
            }
        }
    }
    /// This deal's card in the current snapshot, if the owner can see one.
    pub(crate) fn card(&mut self, deal: DealId) -> Option<AttentionItem> {
        self.attention()
            .ok()?
            .items
            .into_iter()
            .find(|i| i.deal_id == deal)
    }
    /// The GATE card whose notification for `deadline` is due now.
    pub(crate) fn due_gate(&mut self, deal: DealId, deadline: Timestamp) -> Option<AttentionItem> {
        let now = self.clock.now();
        self.card(deal).filter(|i| {
            i.kind == AttnKind::Gate
                && i.deadline == Some(deadline)
                && LADDER.notify_due(i.deadline, now)
        })
    }
    /// Records an owner act on a card (opened, reviewed, snoozed) when the deal has one.
    pub(crate) fn record_card_rung(&mut self, deal: DealId, rung: LadderRung) {
        let now = self.clock.now();
        if let Some(item) = self.card(deal) {
            self.record_rung(&item, rung, None, now);
        }
    }
}
