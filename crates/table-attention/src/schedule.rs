//! The attention ladder's one schedule (attention-ladder-1; window-duality §3): when a GATE's ring
//! breathes, when its one notification is due, when it may be snoozed and for how long, and when
//! the puck goes quiet. The urgency of a card, the shell's breathe flag, the runtime's notification
//! claim and snooze pierce, and the Tumbler page (`bindings/ladder.ts`) all read this one value.
use serde::{Deserialize, Serialize};
use table_core::Timestamp;

/// Seconds before a deadline (or of idleness) at which each rung of the ladder starts.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LadderSchedule {
    /// Deadline this close or closer: the ring breathes (urgency "soon").
    pub breathe_secs: i64,
    /// Deadline this close or closer: the tray dot and the one OS notification (urgency "now").
    /// A snoozed card comes back (pierces) at this rung.
    pub notify_secs: i64,
    /// Snooze is offered only while more than this is left, so a snooze always ends before the
    /// notification rung.
    pub snooze_min_left_secs: i64,
    /// How long a snooze hides the card.
    pub snooze_secs: i64,
    /// After this many seconds without interaction the puck dims, except while a GATE breathes.
    pub quiet_after_secs: i64,
    /// The dimmed puck's opacity.
    pub quiet_opacity_percent: u8,
}

/// The ladder (window-duality §3: 2 h, 15 min, snooze 30 min only when more than 45 min are left,
/// quiet after 45 s at 55 %).
pub const LADDER: LadderSchedule = LadderSchedule {
    breathe_secs: 2 * 3600,
    notify_secs: 15 * 60,
    snooze_min_left_secs: 45 * 60,
    snooze_secs: 30 * 60,
    quiet_after_secs: 45,
    quiet_opacity_percent: 55,
};

impl LadderSchedule {
    /// Seconds left before `deadline`, when it has not passed.
    fn left(deadline: Option<Timestamp>, now: Timestamp) -> Option<i64> {
        deadline.filter(|d| *d > now).map(|d| d.saturating_sub(now))
    }
    /// A live deadline at or inside the breathing rung.
    pub fn breathes(&self, deadline: Option<Timestamp>, now: Timestamp) -> bool {
        Self::left(deadline, now).is_some_and(|left| left <= self.breathe_secs)
    }
    /// A live deadline at or inside the notification rung.
    pub fn notify_due(&self, deadline: Option<Timestamp>, now: Timestamp) -> bool {
        Self::left(deadline, now).is_some_and(|left| left <= self.notify_secs)
    }
    /// A snooze is offered: more than `snooze_min_left_secs` left.
    pub fn snooze_allowed(&self, deadline: Option<Timestamp>, now: Timestamp) -> bool {
        deadline.is_some_and(|d| d.saturating_sub(now) > self.snooze_min_left_secs)
    }
    /// A snooze still hides the card: it has not run out and the deadline has not reached the
    /// notification rung (which always pierces a snooze).
    pub fn snooze_hides(
        &self,
        deadline: Option<Timestamp>,
        snoozed_until: Option<Timestamp>,
        now: Timestamp,
    ) -> bool {
        snoozed_until.is_some_and(|until| until > now)
            && deadline.is_some_and(|d| d.saturating_sub(now) > self.notify_secs)
    }
    /// When a snooze taken at `now` ends.
    pub const fn snooze_until(&self, now: Timestamp) -> Timestamp {
        now.saturating_add(self.snooze_secs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn the_rungs_are_ordered_so_a_snooze_ends_before_the_notification() {
        let l = LADDER;
        assert!(l.notify_secs < l.snooze_min_left_secs);
        assert!(l.snooze_min_left_secs < l.breathe_secs);
        // A snooze is offered only with more than `snooze_min_left_secs` left, so it always ends
        // with more than `notify_secs` left: before the notification rung.
        assert!(l.snooze_min_left_secs - l.snooze_secs >= l.notify_secs);
        assert_eq!(
            serde_json::to_value(l).unwrap(),
            serde_json::json!({"breathe_secs":7200,"notify_secs":900,"snooze_min_left_secs":2700,
                "snooze_secs":1800,"quiet_after_secs":45,"quiet_opacity_percent":55})
        );
    }
    #[test]
    fn boundaries() {
        let l = LADDER;
        assert!(l.breathes(Some(7200), 0) && !l.breathes(Some(7201), 0));
        assert!(l.notify_due(Some(900), 0) && !l.notify_due(Some(901), 0));
        assert!(!l.notify_due(Some(0), 0) && !l.breathes(Some(-1), 0) && !l.breathes(None, 0));
        assert!(l.snooze_allowed(Some(2701), 0) && !l.snooze_allowed(Some(2700), 0));
        assert!(l.snooze_hides(Some(901), Some(1), 0));
        assert!(
            !l.snooze_hides(Some(900), Some(1), 0),
            "the notification rung pierces"
        );
        assert!(
            !l.snooze_hides(Some(5000), Some(0), 0),
            "a snooze that ran out"
        );
        assert_eq!(l.snooze_until(10), 1810);
    }
}
