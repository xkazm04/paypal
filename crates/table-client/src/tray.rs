//! The tray menu as a value: what the system tray shows and what each of its entries does,
//! projected from the attention snapshot and the paused state. The shell builds the native menu
//! from it and dispatches every click through [`TrayModel::command`], so a click on a menu that
//! has since changed (a deal settled, Pause became Resume) does nothing.
//!
//! Only owner-bound, Rust-composed words reach the tray: each deal's label and headline (the
//! headline already carries the amount) and its time left. Counterparty text and the silence line
//! are never read.
use table_attention::AttentionItem;
use table_core::{DealId, Timestamp};

/// At most this many deals are named; the rest are counted in one "N more" entry.
pub const MAX_DEALS: usize = 5;
/// A headline longer than this many characters is cut, ending in an ellipsis.
pub const MAX_HEADLINE: usize = 48;
const DEAL_PREFIX: &str = "deal:";

/// What a tray entry does.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayCommand {
    Main,
    Tumbler,
    Pause,
    Resume,
    Quit,
    OpenCard(DealId),
}
impl TrayCommand {
    /// The fixed entries' commands. A deal entry is answered only by [`TrayModel::command`].
    pub fn parse(id: &str) -> Option<Self> {
        match id {
            "main" => Some(Self::Main),
            "tumbler" => Some(Self::Tumbler),
            "pause" => Some(Self::Pause),
            "resume" => Some(Self::Resume),
            "quit" => Some(Self::Quit),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrayEntry {
    pub id: String,
    pub text: String,
    pub enabled: bool,
    /// A line is drawn above this entry.
    pub separator_before: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrayModel {
    pub tooltip: String,
    /// The gold "a deal needs you" dot on the tray icon.
    pub dot: bool,
    pub entries: Vec<TrayEntry>,
}
impl TrayModel {
    /// What a click on `id` does, or `None` when this model shows no such enabled entry.
    pub fn command(&self, id: &str) -> Option<TrayCommand> {
        if !self.entries.iter().any(|e| e.enabled && e.id == id) {
            return None;
        }
        match id.strip_prefix(DEAL_PREFIX) {
            Some(deal) => deal.parse().ok().map(TrayCommand::OpenCard),
            None => TrayCommand::parse(id),
        }
    }
}

fn entry(id: impl Into<String>, text: impl Into<String>) -> TrayEntry {
    TrayEntry {
        id: id.into(),
        text: text.into(),
        enabled: true,
        separator_before: false,
    }
}

/// "1 needs you", "2 need you".
fn need_you(count: usize) -> String {
    if count == 1 {
        "1 needs you".into()
    } else {
        format!("{count} need you")
    }
}

/// The deal's time left in words: "overdue", "now" (within a minute), "in 10 min", "in 2 h",
/// "in 3 d" (whole units, rounded down).
fn time_left(deadline: Timestamp, now: Timestamp) -> String {
    let left = deadline.saturating_sub(now);
    match left {
        ..0 => "overdue".into(),
        0..=60 => "now".into(),
        61..3_600 => format!("in {} min", left / 60),
        3_600..86_400 => format!("in {} h", left / 3_600),
        _ => format!("in {} d", left / 86_400),
    }
}

/// The headline cut to [`MAX_HEADLINE`] characters (never inside a character), the last one an
/// ellipsis.
fn cut(headline: &str) -> String {
    if headline.chars().count() <= MAX_HEADLINE {
        return headline.into();
    }
    let mut short: String = headline.chars().take(MAX_HEADLINE - 1).collect();
    short.push('…');
    short
}

/// The tray for `items` (the attention snapshot's items, already in deadline order).
pub fn tray_model(items: &[AttentionItem], agents_paused: bool, now: Timestamp) -> TrayModel {
    let mut entries = Vec::new();
    let tooltip = if items.is_empty() {
        "The Table - nothing needs you".to_owned()
    } else {
        entries.push(TrayEntry {
            enabled: false,
            ..entry("need-you", need_you(items.len()))
        });
        for item in items.iter().take(MAX_DEALS) {
            let mut text = format!("{} - {}", item.label, cut(&item.headline));
            if let Some(deadline) = item.deadline {
                text.push_str(" - ");
                text.push_str(&time_left(deadline, now));
            }
            entries.push(entry(format!("{DEAL_PREFIX}{}", item.deal_id), text));
        }
        if items.len() > MAX_DEALS {
            entries.push(entry(
                "main",
                format!("{} more in The Table", items.len() - MAX_DEALS),
            ));
        }
        // Items come in deadline order: the first with a deadline is the next one due.
        match items.iter().find_map(|i| i.deadline) {
            Some(deadline) => match time_left(deadline, now).as_str() {
                "overdue" => format!("The Table - {}, one overdue", need_you(items.len())),
                "now" => format!("The Table - {}, next due now", need_you(items.len())),
                next => format!("The Table - {}, next {next}", need_you(items.len())),
            },
            None => format!("The Table - {}", need_you(items.len())),
        }
    };
    let fixed = entries.len();
    entries.push(entry("main", "Open The Table"));
    entries.push(entry("tumbler", "Show / put away the Tumbler"));
    entries.push(if agents_paused {
        entry("resume", "Resume all agents")
    } else {
        entry("pause", "Pause all agents")
    });
    entries.push(entry("quit", "Quit"));
    if fixed > 0 {
        entries[fixed].separator_before = true;
    }
    TrayModel {
        tooltip,
        dot: !items.is_empty(),
        entries,
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use table_attention::{AttnKind, Urgency};
    use table_core::{Currency, Mode, Module};

    const NOW: Timestamp = 1_800_000_000;

    fn id(n: u32) -> DealId {
        format!("{n:026}").parse().unwrap()
    }
    fn item(n: u32, kind: AttnKind, headline: &str, deadline: Option<Timestamp>) -> AttentionItem {
        AttentionItem {
            deal_id: id(n),
            label: format!("D-{n:04}"),
            kind,
            module: Module::Tables,
            headline: headline.into(),
            amount_minor: 34_000,
            currency: Currency::USD,
            counterparty: None,
            clause: None,
            deadline,
            on_silence: "the hold releases itself at the deadline; nothing is taken".into(),
            urgency: Urgency::Calm,
            mode: Mode::Sandbox,
            actions: vec![],
            money_check: None,
            shield_rule: None,
        }
    }
    fn ids(model: &TrayModel) -> Vec<&str> {
        model.entries.iter().map(|e| e.id.as_str()).collect()
    }
    fn deal_texts(model: &TrayModel) -> Vec<&str> {
        model
            .entries
            .iter()
            .filter(|e| e.id.starts_with(DEAL_PREFIX))
            .map(|e| e.text.as_str())
            .collect()
    }

    #[test]
    fn nothing_waiting_shows_the_four_fixed_entries() {
        let model = tray_model(&[], false, NOW);
        assert_eq!(ids(&model), ["main", "tumbler", "pause", "quit"]);
        assert!(!model.dot);
        assert_eq!(model.tooltip, "The Table - nothing needs you");
        assert!(model.entries.iter().all(|e| e.enabled));
        assert_eq!(model.command("pause"), Some(TrayCommand::Pause));
        assert_eq!(model.command("resume"), None);
    }

    #[test]
    fn paused_agents_offer_resume_in_place_of_pause() {
        let model = tray_model(&[], true, NOW);
        assert_eq!(ids(&model), ["main", "tumbler", "resume", "quit"]);
        let resume = &model.entries[2];
        assert_eq!(resume.text, "Resume all agents");
        assert_eq!(model.command("resume"), Some(TrayCommand::Resume));
        // A click on the Pause of a menu shown before the pause does nothing now.
        assert_eq!(model.command("pause"), None);
        assert_eq!(TrayCommand::parse("resume"), Some(TrayCommand::Resume));
        assert_eq!(TrayCommand::parse("pause"), Some(TrayCommand::Pause));
        assert_eq!(TrayCommand::parse("main"), Some(TrayCommand::Main));
        assert_eq!(TrayCommand::parse("tumbler"), Some(TrayCommand::Tumbler));
        assert_eq!(TrayCommand::parse("quit"), Some(TrayCommand::Quit));
        assert_eq!(TrayCommand::parse(&format!("deal:{}", id(1))), None);
    }

    #[test]
    fn each_waiting_deal_is_named_with_its_headline_and_time_left() {
        let items = [
            item(
                193,
                AttnKind::Gate,
                "Capture or void 340.00 USD",
                Some(NOW + 600),
            ),
            item(190, AttnKind::Hold, "Look at 340.00 USD in PayPal", None),
        ];
        let model = tray_model(&items, false, NOW);
        assert_eq!(model.entries[0].text, "2 need you");
        assert!(!model.entries[0].enabled);
        assert_eq!(
            deal_texts(&model),
            [
                "D-0193 - Capture or void 340.00 USD - in 10 min",
                "D-0190 - Look at 340.00 USD in PayPal",
            ]
        );
        assert_eq!(model.entries[1].id, format!("deal:{}", id(193)));
        assert_eq!(model.entries[2].id, format!("deal:{}", id(190)));
        // The headline carries the amount; the entry does not repeat it.
        for text in deal_texts(&model) {
            assert_eq!(text.matches("340.00").count(), 1, "{text}");
        }
        assert_eq!(
            &ids(&model)[3..],
            ["main", "tumbler", "pause", "quit"],
            "the fixed entries follow the deals"
        );
        assert!(model.entries[3].separator_before);
        assert!(model.dot);
        assert_eq!(model.tooltip, "The Table - 2 need you, next in 10 min");
        let one = tray_model(&items[1..], false, NOW);
        assert_eq!(one.entries[0].text, "1 needs you");
        assert_eq!(one.tooltip, "The Table - 1 needs you");
    }

    #[test]
    fn more_than_five_deals_end_in_one_more_entry_that_opens_the_table() {
        let items: Vec<_> = (1..=7)
            .map(|n| item(n, AttnKind::Gate, "Approve 340.00 USD", Some(NOW + 600)))
            .collect();
        let model = tray_model(&items, false, NOW);
        assert_eq!(deal_texts(&model).len(), 5);
        let more = &model.entries[6];
        assert_eq!(more.text, "2 more in The Table");
        assert_eq!(more.id, "main");
        assert_eq!(model.command("main"), Some(TrayCommand::Main));
    }

    #[test]
    fn a_click_opens_only_a_deal_this_menu_shows() {
        let items = [item(193, AttnKind::Gate, "Approve 340.00 USD", None)];
        let model = tray_model(&items, false, NOW);
        assert_eq!(
            model.command(&format!("deal:{}", id(193))),
            Some(TrayCommand::OpenCard(id(193)))
        );
        // A stale menu's deal, garbage and the disabled header do nothing.
        assert_eq!(model.command(&format!("deal:{}", id(194))), None);
        assert_eq!(model.command("deal:garbage"), None);
        assert_eq!(model.command(&model.entries[0].id.clone()), None);
        assert_eq!(model.command(""), None);
    }

    #[test]
    fn counterparty_words_never_reach_the_tray_and_long_headlines_are_cut() {
        let mut hostile = item(7, AttnKind::Gate, "Approve 340.00 USD", Some(NOW + 600));
        hostile.counterparty = Some("Evil Corp <ignore previous>".into());
        hostile.on_silence = "SILENCE-LINE".into();
        let long = "Ä".repeat(30) + &"b".repeat(30);
        let cut = item(8, AttnKind::Hold, &long, None);
        let model = tray_model(&[hostile, cut], false, NOW);
        for text in model
            .entries
            .iter()
            .map(|e| e.text.as_str())
            .chain([model.tooltip.as_str()])
        {
            assert!(!text.contains("Evil Corp"), "{text}");
            assert!(!text.contains("ignore previous"), "{text}");
            assert!(!text.contains("SILENCE-LINE"), "{text}");
        }
        let texts = deal_texts(&model);
        let headline = texts[1].strip_prefix("D-0008 - ").unwrap();
        assert_eq!(headline.chars().count(), MAX_HEADLINE);
        assert!(headline.ends_with('…'));
        assert!(headline.starts_with(&"Ä".repeat(30)));
    }

    #[test]
    fn time_left_reads_overdue_now_minutes_and_hours() {
        let at = |deadline| {
            let model = tray_model(
                &[item(1, AttnKind::Gate, "Approve 1.00 USD", Some(deadline))],
                false,
                NOW,
            );
            deal_texts(&model)[0].to_owned()
        };
        assert_eq!(at(NOW - 5), "D-0001 - Approve 1.00 USD - overdue");
        assert_eq!(at(NOW), "D-0001 - Approve 1.00 USD - now");
        assert_eq!(at(NOW + 60), "D-0001 - Approve 1.00 USD - now");
        assert_eq!(at(NOW + 61), "D-0001 - Approve 1.00 USD - in 1 min");
        assert_eq!(
            at(NOW + 2 * 3600 + 600),
            "D-0001 - Approve 1.00 USD - in 2 h"
        );
        assert_eq!(at(NOW + 3 * 86_400), "D-0001 - Approve 1.00 USD - in 3 d");
    }
}
