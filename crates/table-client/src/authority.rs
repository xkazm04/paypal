//! Derived artifacts of the authority table (theme T11): the manifest fingerprint, the Tauri
//! capability files and the TypeScript tables the browser mock gates and delivers events by. The
//! rows themselves live in `authority_table.rs` (dependency-free, so the shell's `build.rs`
//! includes it by path).
//! `generate-bindings` writes the files; `tests/bindings.rs` fails when a committed copy drifts.
pub use crate::authority_table::*;
use serde::Serialize;
use table_core::{H256, canonical_bytes};

/// Domain tag of the manifest fingerprint, so it never equals any other commitment.
pub const AUTHORITY_MANIFEST_DOMAIN: &[u8] = b"table.authority-manifest.v1\0";

/// One row as committed in the manifest: closed words only, no secret, nothing per install.
#[derive(Debug, Clone, Serialize)]
pub struct ManifestRow {
    pub name: &'static str,
    pub labels: Vec<&'static str>,
    pub token: bool,
    pub unlock: bool,
    pub selection: &'static str,
    pub tier: &'static str,
    pub release: bool,
    pub enforcer: &'static str,
}
impl ManifestRow {
    fn of(a: &CommandAuthority) -> Self {
        let mut labels = a.labels.to_vec();
        labels.sort();
        labels.dedup();
        Self {
            name: a.name,
            labels: labels.into_iter().map(WindowLabel::as_str).collect(),
            token: a.token,
            unlock: a.unlock,
            selection: a.selection.as_str(),
            tier: a.tier.as_str(),
            release: a.release(),
            enforcer: a.enforcer.as_str(),
        }
    }
}
/// The manifest: every row, sorted by command name (row order in the source never matters).
pub fn manifest_rows() -> Vec<ManifestRow> {
    command_rows(AUTHORITY)
}
fn command_rows(commands: &[CommandAuthority]) -> Vec<ManifestRow> {
    let mut rows: Vec<_> = commands.iter().map(ManifestRow::of).collect();
    rows.sort_by(|a, b| a.name.cmp(b.name));
    rows
}
/// One event row as committed in the manifest: the event's name and its windows, sorted.
#[derive(Debug, Clone, Serialize)]
pub struct ManifestEvent {
    pub name: &'static str,
    pub labels: Vec<&'static str>,
}
impl ManifestEvent {
    fn of(e: &EventAudience) -> Self {
        let mut labels = e.labels.to_vec();
        labels.sort();
        labels.dedup();
        Self {
            name: e.name,
            labels: labels.into_iter().map(WindowLabel::as_str).collect(),
        }
    }
}
fn event_rows(events: &[EventAudience]) -> Vec<ManifestEvent> {
    let mut rows: Vec<_> = events.iter().map(ManifestEvent::of).collect();
    rows.sort_by(|a, b| a.name.cmp(b.name));
    rows
}
/// What the fingerprint commits to: who may call each command and who is told each event.
#[derive(Serialize)]
struct Manifest {
    commands: Vec<ManifestRow>,
    events: Vec<ManifestEvent>,
}
/// SHA-256 over the domain tag and the canonical (JCS) manifest. Shown to the owner as the
/// "Permissions fingerprint" so anyone can match the policy a build runs with this table.
pub fn manifest() -> Result<H256, serde_json::Error> {
    manifest_over(AUTHORITY, EVENTS)
}
/// [`manifest`] over any table: the JCS of `{"commands": [...], "events": [...]}`, each list
/// sorted by name, so row order in the source never matters.
pub fn manifest_over(
    commands: &[CommandAuthority],
    events: &[EventAudience],
) -> Result<H256, serde_json::Error> {
    let mut bytes = AUTHORITY_MANIFEST_DOMAIN.to_vec();
    bytes.extend(canonical_bytes(&Manifest {
        commands: command_rows(commands),
        events: event_rows(events),
    })?);
    Ok(H256::digest(&bytes))
}
/// [`manifest`] as lowercase hex, computed once per process (the table is `const`).
pub fn manifest_hex() -> Option<&'static str> {
    static HEX: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    HEX.get_or_init(|| manifest().ok().map(H256::hex))
        .as_deref()
}

/// Tauri core permissions each window needs besides its commands (events, its own window).
fn core_permissions(label: WindowLabel) -> &'static [&'static str] {
    match label {
        WindowLabel::Main => &["core:event:allow-listen", "core:event:allow-unlisten"],
        WindowLabel::Tumbler => &[
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "core:window:allow-start-dragging",
        ],
        WindowLabel::Approval => &[
            "core:window:allow-close",
            "core:event:allow-listen",
            "core:event:allow-unlisten",
        ],
    }
}
#[derive(Serialize)]
struct Capability {
    identifier: &'static str,
    description: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    windows: Option<[&'static str; 1]>,
    #[serde(skip_serializing_if = "Option::is_none")]
    webviews: Option<[&'static str; 1]>,
    permissions: Vec<String>,
}
/// The capability file for one window: its core permissions, then `allow-<command>` for every
/// command the table grants it, in table order.
pub fn capability_json(label: WindowLabel) -> Result<String, serde_json::Error> {
    let name = label.as_str();
    let mut permissions: Vec<String> = core_permissions(label)
        .iter()
        .map(|p| (*p).to_owned())
        .collect();
    permissions.extend(
        AUTHORITY
            .iter()
            .filter(|a| a.labels.contains(&label))
            .map(|a| format!("allow-{}", a.name.replace('_', "-"))),
    );
    let capability = Capability {
        identifier: name,
        description: "Generated from crates/table-client/src/authority_table.rs by generate-bindings; do not edit.",
        // Main is selected by its webview (S·athena ui.json); the others by their window.
        windows: (label != WindowLabel::Main).then_some([name]),
        webviews: (label == WindowLabel::Main).then_some([name]),
        permissions,
    };
    Ok(serde_json::to_string_pretty(&capability)? + "\n")
}
/// `(file name, contents)` for `apps/desktop/src-tauri/capabilities/`.
pub fn capability_files() -> Result<Vec<(String, String)>, serde_json::Error> {
    WindowLabel::ALL
        .into_iter()
        .map(|l| Ok((format!("{}.json", l.as_str()), capability_json(l)?)))
        .collect()
}

fn union(words: impl IntoIterator<Item = &'static str>) -> String {
    words
        .into_iter()
        .map(|w| format!("\"{w}\""))
        .collect::<Vec<_>>()
        .join(" | ")
}
/// `bindings/authority.ts`: the table for the browser mock, keyed by command, plus the manifest.
pub fn typescript() -> Result<String, serde_json::Error> {
    let mut out = String::from(
        "// Generated by `cargo run -p table-client --bin generate-bindings` from\n\
         // crates/table-client/src/authority_table.rs. Do not edit: change the row there.\n\n",
    );
    out += &format!(
        "export type AuthorityLabel = {};\n",
        union(WindowLabel::ALL.map(WindowLabel::as_str))
    );
    out += &format!(
        "export type AuthorityTier = {};\n",
        union(Tier::ALL.map(Tier::as_str))
    );
    out += &format!(
        "export type AuthoritySelection = {};\n",
        union(Selection::ALL.map(Selection::as_str))
    );
    out += &format!(
        "export type AuthorityEnforcer = {};\n",
        union(Enforcer::ALL.map(Enforcer::as_str))
    );
    out += "export type CommandAuthority = { labels: Array<AuthorityLabel>, token: boolean, \
            unlock: boolean, selection: AuthoritySelection, tier: AuthorityTier, \
            release: boolean, enforcer: AuthorityEnforcer, };\n\n";
    out += "/** Lowercase hex SHA-256 of the canonical table; get_settings reports the same value. */\n";
    out += &format!(
        "export const AUTHORITY_MANIFEST = \"{}\";\n\n",
        manifest()?.hex()
    );
    out += "export const AUTHORITY = {\n";
    for a in AUTHORITY {
        let r = ManifestRow::of(a);
        out += &format!(
            "  {}: {{ labels: [{}], token: {}, unlock: {}, selection: \"{}\", tier: \"{}\", release: {}, enforcer: \"{}\" }},\n",
            r.name,
            r.labels
                .iter()
                .map(|l| format!("\"{l}\""))
                .collect::<Vec<_>>()
                .join(", "),
            r.token,
            r.unlock,
            r.selection,
            r.tier,
            r.release,
            r.enforcer
        );
    }
    out += "} satisfies Record<string, CommandAuthority>;\n\n";
    out += "/** Who is told each window event, keyed by event name: the shell sends to exactly these. */\n";
    out += "export const EVENT_AUDIENCE = {\n";
    for e in EVENTS {
        let r = ManifestEvent::of(e);
        out += &format!(
            "  \"{}\": [{}],\n",
            r.name,
            r.labels
                .iter()
                .map(|l| format!("\"{l}\""))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }
    out += "} satisfies Record<string, Array<AuthorityLabel>>;\n";
    Ok(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    /// Pinned on purpose: any change to who may call what changes this value, so the change shows
    /// up in review as an edit to this line (and to `bindings/authority.ts`). Update it only when
    /// the table change is intended.
    const PINNED_MANIFEST: &str =
        "b2f04fe9561ade53614a195e09f37555a76106c00e3750525add74b1ab854ac4";

    #[test]
    fn the_manifest_fingerprint_is_pinned() {
        assert_eq!(
            manifest().unwrap().hex(),
            PINNED_MANIFEST,
            "the authority table changed: if intended, update PINNED_MANIFEST and run generate-bindings"
        );
    }

    #[test]
    fn manifest_is_domain_separated_and_ignores_row_order() {
        let rows = manifest_rows();
        let undomained = H256::digest(&canonical_bytes(&rows).unwrap());
        assert_ne!(manifest().unwrap(), undomained);
        assert!(rows.windows(2).all(|w| w[0].name < w[1].name));
    }

    #[test]
    fn rows_are_unique_and_well_formed() {
        let names: BTreeSet<_> = AUTHORITY.iter().map(|a| a.name).collect();
        assert_eq!(names.len(), AUTHORITY.len(), "duplicate command row");
        assert_eq!(COMMANDS.len(), AUTHORITY.len());
        for a in AUTHORITY {
            assert!(!a.labels.is_empty(), "{} is granted to no window", a.name);
            assert!(
                a.name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'),
                "{}",
                a.name
            );
            // The token exists only in the approval window; unlock is checked against it.
            if a.token || a.unlock || a.release() {
                assert_eq!(a.labels, &[WindowLabel::Approval], "{}", a.name);
            }
            assert!(!a.unlock || a.token, "{} unlock without token", a.name);
            if a.tier >= Tier::Owner {
                assert!(a.token && a.unlock, "{} must be privileged", a.name);
            }
            if a.tier == Tier::Decision {
                assert_eq!(a.selection, Selection::Required, "{}", a.name);
            }
            if a.enforcer == Enforcer::Shell {
                assert!(!a.token && !a.unlock && !a.release(), "{}", a.name);
            }
        }
    }

    /// These lists are written out by hand, not read from the table: a careless row cannot widen
    /// them without failing here.
    #[test]
    fn the_release_set_and_the_money_decisions_are_pinned_independently() {
        let release: BTreeSet<&str> = [
            "deal_owner_accept",
            "market_refresh",
            "unlock",
            "deal_countersign",
            "deal_capture",
            "deal_void",
            "shield_release",
            "rescue_approve",
            "open_paypal_in_browser",
            "approval_token",
            "set_credentials",
            "mandate_sign",
            "mandate_revoke",
            "band_set",
            "pairing_confirm",
            "deal_create",
            "deal_join",
            "envelope_sign",
            "rescue_replay",
            "rescue_watch_add",
            "rescue_watch_stop",
            "counterparty_revoke",
        ]
        .into();
        assert_eq!(
            RELEASE_COMMANDS.iter().copied().collect::<BTreeSet<_>>(),
            release
        );
        for name in [
            "deal_owner_accept",
            "deal_countersign",
            "deal_capture",
            "deal_void",
            "shield_release",
            "rescue_approve",
            "open_paypal_in_browser",
        ] {
            let a = authority(name).unwrap();
            assert_eq!(a.labels, &[WindowLabel::Approval], "{name}");
            assert!(
                a.token && a.unlock && a.selection == Selection::Required,
                "{name}"
            );
            assert_eq!(a.enforcer, Enforcer::Runtime, "{name}");
        }
        // Untrusted counterparty words never reach the Tumbler.
        for name in ["counterparty_note", "counterparty_list", "deal_transcript"] {
            assert!(!admits(name, "tumbler"), "{name}");
        }
        assert!(!admits("counterparty_note", "approval"));
        assert!(!admits("deal_capture", "main") && !admits("no_such_command", "approval"));
        assert!(!admits("get_settings", "devtools"));
    }

    #[test]
    fn event_audiences_come_from_the_table() {
        use WindowLabel::{Approval, Main, Tumbler};
        assert_eq!(
            event_audience("settings:changed"),
            Some(&[Main, Tumbler, Approval][..])
        );
        assert_eq!(event_audience("approval:summary"), Some(&[Approval][..]));
        assert_eq!(event_audience("deal:changed"), Some(&[Main][..]));
        assert_eq!(event_audience("no:such"), None);
    }

    #[test]
    fn event_rows_are_unique_and_well_formed() {
        let names: BTreeSet<_> = EVENTS.iter().map(|e| e.name).collect();
        assert_eq!(names.len(), EVENTS.len(), "duplicate event row");
        for e in EVENTS {
            assert!(!e.labels.is_empty(), "{} is told to no window", e.name);
            let labels: BTreeSet<_> = e.labels.iter().collect();
            assert_eq!(
                labels.len(),
                e.labels.len(),
                "{} names a window twice",
                e.name
            );
            let (scope, word) = e.name.split_once(':').unwrap();
            assert!(
                [scope, word]
                    .iter()
                    .all(|w| !w.is_empty() && w.bytes().all(|b| b.is_ascii_lowercase())),
                "{}",
                e.name
            );
        }
    }

    /// What each window is told, written out by hand, not read from the table: a careless event
    /// row cannot widen who learns what without failing here.
    #[test]
    fn what_each_window_is_told_is_pinned_independently() {
        use WindowLabel::{Approval, Main, Tumbler};
        let told = |event: &str, label| event_audience(event).is_some_and(|a| a.contains(&label));
        // The owner-review summary reaches the approval window only.
        assert!(told("approval:summary", Approval));
        assert!(!told("approval:summary", Main) && !told("approval:summary", Tumbler));
        // Deals, agent runs and pinned counterparties carry counterparty and deal detail: main
        // only, never the Tumbler or the approval window.
        for event in ["deal:changed", "agent:changed", "pairing:pinned"] {
            assert!(told(event, Main), "{event}");
            assert!(!told(event, Tumbler) && !told(event, Approval), "{event}");
        }
        // The Tumbler's own surface events never reach the approval window.
        let tumbler: Vec<_> = EVENTS
            .iter()
            .filter(|e| e.name.starts_with("tumbler:"))
            .collect();
        assert!(!tumbler.is_empty());
        for e in tumbler {
            assert!(!e.labels.contains(&Approval), "{}", e.name);
        }
    }

    #[test]
    fn the_fingerprint_covers_who_is_told_each_event() {
        assert_eq!(
            manifest_over(AUTHORITY, EVENTS).unwrap(),
            manifest().unwrap()
        );
        let mut narrowed = EVENTS.to_vec();
        let settings = narrowed
            .iter_mut()
            .find(|e| e.name == "settings:changed")
            .unwrap();
        settings.labels = &[WindowLabel::Main, WindowLabel::Tumbler];
        assert_ne!(
            manifest_over(AUTHORITY, &narrowed).unwrap(),
            manifest().unwrap()
        );
        // Row order never matters, for events as for commands.
        let mut reversed = EVENTS.to_vec();
        reversed.reverse();
        assert_eq!(
            manifest_over(AUTHORITY, &reversed).unwrap(),
            manifest().unwrap()
        );
    }

    /// The Tauri core permissions each window holds besides its commands, written out by hand:
    /// they are not table rows and not in the fingerprint, so this is what stops a careless edit
    /// to `core_permissions` (regenerated into the capability files) from widening a window.
    #[test]
    fn core_permissions_are_pinned_independently() {
        use WindowLabel::{Approval, Main, Tumbler};
        let pinned = |label| -> BTreeSet<&str> {
            match label {
                Main => ["core:event:allow-listen", "core:event:allow-unlisten"].into(),
                Tumbler => [
                    "core:event:allow-listen",
                    "core:event:allow-unlisten",
                    "core:window:allow-start-dragging",
                ]
                .into(),
                Approval => [
                    "core:window:allow-close",
                    "core:event:allow-listen",
                    "core:event:allow-unlisten",
                ]
                .into(),
            }
        };
        for label in [Main, Tumbler, Approval] {
            let v: serde_json::Value =
                serde_json::from_str(&capability_json(label).unwrap()).unwrap();
            let core: BTreeSet<&str> = v["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| p.as_str())
                .filter(|p| !p.starts_with("allow-"))
                .collect();
            assert_eq!(core, pinned(label), "{}", label.as_str());
        }
    }

    #[test]
    fn capability_files_grant_exactly_the_table() {
        for label in WindowLabel::ALL {
            let v: serde_json::Value =
                serde_json::from_str(&capability_json(label).unwrap()).unwrap();
            let granted: BTreeSet<String> = v["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|p| {
                    p.as_str()?
                        .strip_prefix("allow-")
                        .map(|c| c.replace('-', "_"))
                })
                .collect();
            let expected: BTreeSet<String> = AUTHORITY
                .iter()
                .filter(|a| a.admits(label.as_str()))
                .map(|a| a.name.to_owned())
                .collect();
            assert_eq!(granted, expected, "{}", label.as_str());
        }
    }
}
