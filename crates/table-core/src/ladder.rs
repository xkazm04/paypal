//! The attention ladder's rungs as recorded evidence (attention-ladder-1): what the owner was
//! actually offered for one deal and deadline. Closed names and times only, never words of the
//! other side, so a rung row can sit in the hash-chained audit log and cross to every window.
use crate::Timestamp;
use serde::{Deserialize, Serialize};

/// One rung of the ladder the wallet recorded for a deal's deadline.
#[derive(
    ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(rename_all = "snake_case")]
pub enum LadderRung {
    /// The card first appeared on the Tumbler's stack.
    Shown,
    /// The deadline came within two hours: the ring breathes.
    Breathing,
    /// The one OS notification was shown.
    Notified,
    /// The notification was due but not shown (see [`NotifySuppression`]).
    NotifySuppressed,
    /// The owner opened the deal from its card.
    CardOpened,
    /// The owner opened the review in the approval window.
    ReviewOpened,
    /// The owner snoozed the card.
    Snoozed,
}
impl LadderRung {
    pub const ALL: [LadderRung; 7] = [
        LadderRung::Shown,
        LadderRung::Breathing,
        LadderRung::Notified,
        LadderRung::NotifySuppressed,
        LadderRung::CardOpened,
        LadderRung::ReviewOpened,
        LadderRung::Snoozed,
    ];
    /// The wire name, as stored in the audit row.
    pub const fn name(self) -> &'static str {
        match self {
            LadderRung::Shown => "shown",
            LadderRung::Breathing => "breathing",
            LadderRung::Notified => "notified",
            LadderRung::NotifySuppressed => "notify_suppressed",
            LadderRung::CardOpened => "card_opened",
            LadderRung::ReviewOpened => "review_opened",
            LadderRung::Snoozed => "snoozed",
        }
    }
    /// The owner acted on the card (opened, reviewed or snoozed it), as opposed to being told.
    pub const fn owner_act(self) -> bool {
        matches!(
            self,
            LadderRung::CardOpened | LadderRung::ReviewOpened | LadderRung::Snoozed
        )
    }
}
/// Why the due notification was not shown.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotifySuppression {
    /// The Tumbler's Do Not Disturb was on.
    DoNotDisturb,
    /// The owner turned decision notifications off.
    NotificationsOff,
    /// The computer's own focus or quiet mode held notifications back.
    SystemQuiet,
    /// The notification could not be shown.
    NotShown,
}
/// One recorded rung, as a deal's history carries it.
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RungMark {
    pub rung: LadderRung,
    pub at: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional = nullable)]
    pub reason: Option<NotifySuppression>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_rung_name_is_its_wire_name() {
        for rung in LadderRung::ALL {
            assert_eq!(serde_json::to_value(rung).unwrap(), rung.name());
        }
    }
}
