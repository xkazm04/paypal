//! The words of the OS decision toast. Pure, so every host can test them: the toast shows the
//! card's own owner-bound lines (its label and headline, and the "if you do nothing" line
//! `table_attention::word_silence` wrote from the forecast), never a runtime-internal string.
use table_attention::AttentionItem;

/// Said when the card has no "if you do nothing" line, so the toast is still a whole sentence.
const OPEN_TO_DECIDE: &str = "Open The Table to decide.";

/// The toast's title and body for `item`.
pub fn toast_text(item: &AttentionItem) -> (String, String) {
    let headline = item.headline.trim().trim_end_matches('.');
    let silence = item.on_silence.trim().trim_end_matches('.');
    let body = if silence.is_empty() {
        format!("{headline}. {OPEN_TO_DECIDE}")
    } else {
        format!("{headline}. If you do nothing, {silence}.")
    };
    (format!("{} · decision due", item.label), body)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use table_attention::{AttnKind, Urgency};
    use table_core::{Currency, Mode, Module};

    fn item(headline: &str, on_silence: &str) -> AttentionItem {
        AttentionItem {
            deal_id: format!("{:026}", 193).parse().unwrap(),
            label: "D-0193".into(),
            kind: AttnKind::Gate,
            module: Module::Tables,
            headline: headline.into(),
            amount_minor: 34_000,
            currency: Currency::USD,
            counterparty: None,
            clause: None,
            deadline: None,
            on_silence: on_silence.into(),
            urgency: Urgency::Calm,
            mode: Mode::Sandbox,
            actions: vec![],
            money_check: None,
            shield_rule: None,
        }
    }

    #[test]
    fn the_body_words_the_cards_silence_line_and_no_internal_label() {
        let (title, body) = toast_text(&item(
            "Capture or void 340.00 USD",
            "the hold releases itself at the deadline; nothing is taken",
        ));
        assert_eq!(title, "D-0193 · decision due");
        assert_eq!(
            body,
            "Capture or void 340.00 USD. If you do nothing, the hold releases itself at the deadline; nothing is taken."
        );
        assert!(!body.contains("If ignored"), "{body}");
        assert!(!body.contains(". ."), "{body}");
    }

    #[test]
    fn a_deal_with_no_silence_line_still_gives_a_sentence() {
        for blank in ["", "  ", "."] {
            let (_, body) = toast_text(&item("Approve 340.00 USD.", blank));
            assert_eq!(body, "Approve 340.00 USD. Open The Table to decide.");
            assert!(!body.contains("If ignored") && !body.contains("If you do nothing"));
        }
    }
}
