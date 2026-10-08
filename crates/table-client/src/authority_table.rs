//! The authority table: who may call each IPC command, written once (theme T11).
//!
//! This file is plain `const` data with no dependencies so the desktop shell's `build.rs` can
//! include it by path for the Tauri command list. Everything else is derived from it: `COMMANDS`,
//! `RELEASE_COMMANDS`, the three capability files, the browser mock's gate table
//! (`bindings/authority.ts`), the runtime dispatcher's label / token / unlock / selected-deal gate
//! and the manifest fingerprint in `get_settings`. Adding a command is one row here, then
//! `cargo run -p table-client --bin generate-bindings`.
//!
//! Never widen a row to make a test pass: a generator bug or a careless row widens a grant
//! everywhere at once, which is why `table-client/src/authority.rs` also pins invariants that do
//! not read this table (the release set is approval-only, every decision needs token + unlock +
//! the selected deal) and the manifest fingerprint itself.

/// A window label. The Tauri shell assigns it; a webview cannot choose its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum WindowLabel {
    Main,
    Tumbler,
    Approval,
}
impl WindowLabel {
    pub const ALL: [WindowLabel; 3] = [
        WindowLabel::Main,
        WindowLabel::Tumbler,
        WindowLabel::Approval,
    ];
    pub const fn as_str(self) -> &'static str {
        match self {
            WindowLabel::Main => "main",
            WindowLabel::Tumbler => "tumbler",
            WindowLabel::Approval => "approval",
        }
    }
    pub fn parse(label: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|l| l.as_str() == label)
    }
}

/// What a command can do, weakest first. `Session` and above form the release set: those
/// commands are granted to the approval window only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Tier {
    /// Reads; changes nothing.
    Read,
    /// Window placement, routing between windows and the owner's display preferences.
    Ui,
    /// Changes wallet state without moving money or granting authority: withdraw, let lapse,
    /// snooze, pause, start an agent inside its signed rules, pairing up to (not including) the
    /// pin, quit.
    Act,
    /// The approval capability itself: the IPC token handout and the native unlock.
    Session,
    /// Owner authority: signed rules and limits, keys, pinned connections, deals the owner opens,
    /// paid market lookups.
    Owner,
    /// An owner decision on the selected deal: the steps that lead to money at PayPal.
    Decision,
}
impl Tier {
    pub const ALL: [Tier; 6] = [
        Tier::Read,
        Tier::Ui,
        Tier::Act,
        Tier::Session,
        Tier::Owner,
        Tier::Decision,
    ];
    pub const fn as_str(self) -> &'static str {
        match self {
            Tier::Read => "read",
            Tier::Ui => "ui",
            Tier::Act => "act",
            Tier::Session => "session",
            Tier::Owner => "owner",
            Tier::Decision => "decision",
        }
    }
    /// The release set: granted only to the approval window.
    pub const fn release(self) -> bool {
        self as u8 >= Tier::Session as u8
    }
}

/// Which selection the command is bound to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Selection {
    /// Any deal (or none).
    None,
    /// From the approval window, only the deal that window was opened for.
    InApproval,
    /// Always the selected deal (the approval window's), from any admitted window.
    Required,
    /// From the approval window, only the pairing that window was opened for.
    PairingInApproval,
}
impl Selection {
    pub const ALL: [Selection; 4] = [
        Selection::None,
        Selection::InApproval,
        Selection::Required,
        Selection::PairingInApproval,
    ];
    pub const fn as_str(self) -> &'static str {
        match self {
            Selection::None => "none",
            Selection::InApproval => "in_approval",
            Selection::Required => "required",
            Selection::PairingInApproval => "pairing_in_approval",
        }
    }
}

/// Where the gate is enforced besides the Tauri capability files.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Enforcer {
    /// The wallet runtime (`table-runtime` dispatcher or actor) checks every column.
    Runtime,
    /// A window-surface command the shell answers itself; the shell checks the label.
    Shell,
}
impl Enforcer {
    pub const ALL: [Enforcer; 2] = [Enforcer::Runtime, Enforcer::Shell];
    pub const fn as_str(self) -> &'static str {
        match self {
            Enforcer::Runtime => "runtime",
            Enforcer::Shell => "shell",
        }
    }
}

/// One row of the authority table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandAuthority {
    pub name: &'static str,
    /// The windows granted the command (capability files and runtime label check).
    pub labels: &'static [WindowLabel],
    /// Needs the approval window's IPC token.
    pub token: bool,
    /// Needs the approval window unlocked (not idle-locked).
    pub unlock: bool,
    pub selection: Selection,
    pub tier: Tier,
    pub enforcer: Enforcer,
}
impl CommandAuthority {
    pub const fn release(&self) -> bool {
        self.tier.release()
    }
    pub fn admits(&self, label: &str) -> bool {
        self.labels.iter().any(|l| l.as_str() == label)
    }
}

use Enforcer::{Runtime as R, Shell as S};
use Selection::{
    InApproval as IN_APPROVAL, None as ANY, PairingInApproval as PAIRING, Required as SELECTED,
};
use Tier::{Act, Decision, Owner, Read, Session, Ui};
const ALL: &[WindowLabel] = &WindowLabel::ALL;
const MAIN: &[WindowLabel] = &[WindowLabel::Main];
const TUMBLER: &[WindowLabel] = &[WindowLabel::Tumbler];
const APPROVAL: &[WindowLabel] = &[WindowLabel::Approval];
/// Main and the Tumbler: routing and preferences.
const ROUTE: &[WindowLabel] = &[WindowLabel::Main, WindowLabel::Tumbler];
/// Main and the approval window: reviewing.
const REVIEW: &[WindowLabel] = &[WindowLabel::Main, WindowLabel::Approval];
/// No token, no unlock.
const OPEN: (bool, bool) = (false, false);
/// The approval token only (the unlock itself).
const TOKEN: (bool, bool) = (true, false);
/// Approval token and unlocked: privileged.
const PRIVILEGED: (bool, bool) = (true, true);

const fn row(
    name: &'static str,
    labels: &'static [WindowLabel],
    tier: Tier,
    (token, unlock): (bool, bool),
    selection: Selection,
    enforcer: Enforcer,
) -> CommandAuthority {
    CommandAuthority {
        name,
        labels,
        token,
        unlock,
        selection,
        tier,
        enforcer,
    }
}

/// Every IPC command. Append new rows at the end; never reorder.
/// Columns: name, windows, tier, (token, unlock), selected deal, enforcer.
#[rustfmt::skip]
pub const AUTHORITY: &[CommandAuthority] = &[
    row("deal_snooze",            TUMBLER,  Act,      OPEN,       ANY,         R),
    row("approval_selection",     APPROVAL, Read,     OPEN,       ANY,         R),
    row("deal_display",           ALL,      Read,     OPEN,       IN_APPROVAL, R),
    row("deal_transcript",        REVIEW,   Read,     OPEN,       IN_APPROVAL, R),
    row("counterparty_list",      REVIEW,   Read,     OPEN,       ANY,         R),
    row("approval_pairing",       APPROVAL, Read,     OPEN,       ANY,         R),
    row("deal_owner_accept",      APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("get_settings",           ALL,      Read,     OPEN,       ANY,         R),
    row("list_deals",             MAIN,     Read,     OPEN,       ANY,         R),
    row("get_deal",               MAIN,     Read,     OPEN,       ANY,         R),
    row("deal_evidence",          MAIN,     Read,     OPEN,       ANY,         R),
    row("deal_reconcile",         MAIN,     Read,     OPEN,       ANY,         R),
    row("engine_status",          MAIN,     Read,     OPEN,       ANY,         R),
    // The approval window sees only its own deal's item (a filter, not a refusal).
    row("attention_list",         ALL,      Read,     OPEN,       ANY,         R),
    row("main_open",              ROUTE,    Ui,       OPEN,       ANY,         S),
    row("approval_open",          ROUTE,    Ui,       OPEN,       ANY,         R),
    row("approval_summary",       APPROVAL, Read,     OPEN,       SELECTED,    R),
    row("approval_token",         APPROVAL, Session,  OPEN,       ANY,         R),
    row("tumbler_set_form",       TUMBLER,  Ui,       OPEN,       ANY,         S),
    row("tumbler_pin",            TUMBLER,  Ui,       OPEN,       ANY,         S),
    row("deal_withdraw",          ALL,      Act,      OPEN,       IN_APPROVAL, R),
    row("deal_let_lapse",         ROUTE,    Act,      OPEN,       ANY,         R),
    row("unlock",                 APPROVAL, Session,  TOKEN,      ANY,         R),
    row("deal_countersign",       APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("deal_capture",           APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("deal_void",              APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("shield_release",         APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("rescue_approve",         APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("open_paypal_in_browser", APPROVAL, Decision, PRIVILEGED, SELECTED,    R),
    row("set_credentials",        APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("engine_select",          MAIN,     Act,      OPEN,       ANY,         R),
    row("mandate_list",           REVIEW,   Read,     OPEN,       ANY,         R),
    row("mandate_sign",           APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("mandate_revoke",         APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("band_set",               APPROVAL, Owner,    PRIVILEGED, SELECTED,    R),
    row("pairing_create",         MAIN,     Act,      OPEN,       ANY,         R),
    row("pairing_join",           MAIN,     Act,      OPEN,       ANY,         R),
    row("pairing_poll",           MAIN,     Act,      OPEN,       ANY,         R),
    row("pairing_confirm",        APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("settings_write",         ROUTE,    Ui,       OPEN,       ANY,         R),
    row("deal_create",            APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("deal_join",              APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("pause_all_agents",       ROUTE,    Act,      OPEN,       ANY,         R),
    row("resume_all_agents",      MAIN,     Act,      OPEN,       ANY,         R),
    row("agent_start",            MAIN,     Act,      OPEN,       ANY,         R),
    row("agent_runs",             MAIN,     Read,     OPEN,       ANY,         R),
    row("market_refresh",         APPROVAL, Owner,    PRIVILEGED, SELECTED,    R),
    row("quit_summary",           ROUTE,    Read,     OPEN,       ANY,         R),
    row("quit_confirm",           ROUTE,    Act,      OPEN,       ANY,         R),
    row("tumbler_drag",           TUMBLER,  Ui,       OPEN,       ANY,         S),
    row("tumbler_snap",           TUMBLER,  Ui,       OPEN,       ANY,         S),
    // Untrusted words: main only, never the Tumbler.
    row("counterparty_note",      MAIN,     Read,     OPEN,       ANY,         R),
    row("pairing_abort",          REVIEW,   Act,      OPEN,       PAIRING,     R),
    row("house_wake",             MAIN,     Act,      OPEN,       ANY,         R),
    row("approval_handoff",       APPROVAL, Read,     OPEN,       ANY,         R),
    row("audit_page",             MAIN,     Read,     OPEN,       ANY,         R),
    row("owner_facts",            REVIEW,   Read,     OPEN,       ANY,         R),
    row("book_query",             MAIN,     Read,     OPEN,       ANY,         R),
    row("deal_export_proof",      REVIEW,   Read,     OPEN,       ANY,         R),
    row("proof_check",            MAIN,     Read,     OPEN,       ANY,         S),
    row("deal_history",           MAIN,     Read,     OPEN,       ANY,         R),
    row("mandate_simulate",       APPROVAL, Read,     OPEN,       ANY,         R),
    row("envelope_sign",          APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("envelope_get",           ALL,      Read,     OPEN,       ANY,         R),
    row("rescue_replay",          APPROVAL, Owner,    PRIVILEGED, ANY,         R),
    row("rescue_book",            REVIEW,   Read,     OPEN,       ANY,         R),
    // Shop around (T8): grouping only restricts (first to agree wins, the rest are withdrawn).
    row("deal_group_open",        MAIN,     Act,      OPEN,       ANY,         R),
    row("deal_groups",            MAIN,     Read,     OPEN,       ANY,         R),
];

const fn release_count() -> usize {
    let mut n = 0;
    let mut i = 0;
    while i < AUTHORITY.len() {
        if AUTHORITY[i].tier.release() {
            n += 1;
        }
        i += 1;
    }
    n
}
const COMMAND_NAMES: [&str; AUTHORITY.len()] = {
    let mut out = [""; AUTHORITY.len()];
    let mut i = 0;
    while i < AUTHORITY.len() {
        out[i] = AUTHORITY[i].name;
        i += 1;
    }
    out
};
const RELEASE_NAMES: [&str; release_count()] = {
    let mut out = [""; release_count()];
    let mut i = 0;
    let mut n = 0;
    while i < AUTHORITY.len() {
        if AUTHORITY[i].tier.release() {
            out[n] = AUTHORITY[i].name;
            n += 1;
        }
        i += 1;
    }
    out
};
/// Every IPC command name, in table order.
pub const COMMANDS: &[&str] = &COMMAND_NAMES;
/// The release set (tier `Session` and above): granted to the approval window only.
pub const RELEASE_COMMANDS: &[&str] = &RELEASE_NAMES;

/// The row for a command, if it is one.
pub fn authority(command: &str) -> Option<&'static CommandAuthority> {
    AUTHORITY.iter().find(|a| a.name == command)
}
/// Whether the command is granted to this window label. Unknown commands and labels: no.
pub fn admits(command: &str, label: &str) -> bool {
    authority(command).is_some_and(|a| a.admits(label))
}
