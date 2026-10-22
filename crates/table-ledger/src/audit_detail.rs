//! The write-path door for audit details (standard audit-logging/write-path-sanitization).
//!
//! The audit table is append-only and hash-chained, so whatever is stored can never be erased.
//! Everything a caller hands to [`crate::audit::append`] therefore passes here first, before the
//! preimage is built:
//!
//! 1. **Allowlist**: each action names the detail keys it may carry (`ACTION_KEYS`, one table
//!    entry per action). Other top-level keys are dropped and their names recorded, sorted, in a
//!    `dropped` array. An action that is *not* in the table still writes its row (an audit write
//!    never fails for a missing entry) but every key goes into `dropped`; the test
//!    `every_action_the_workspace_writes_is_in_the_table` fails until the new action has an entry.
//! 2. **Scrub**: a string value that is credential-shaped (bearer value, JWS/JWT, `access_token`
//!    style text, an email address) and any value under a credential-named key becomes
//!    `[redacted]`, at any depth.
//! 3. **Cap**: a detail whose canonical bytes exceed [`MAX_DETAIL_BYTES`] is replaced by a marker
//!    object (`truncated`, `original_bytes`, a scrubbed `head` prefix and any `dropped`).
//!
//! Rows already in the chain are untouched: verification re-hashes the stored bytes.
use crate::LedgerError;
use serde_json::{Map, Value, json};
use table_core::canonical_bytes;

pub(crate) const REDACTED: &str = "[redacted]";
/// Canonical-byte cap on one detail. The largest legitimate detail (a market record) is far below.
pub(crate) const MAX_DETAIL_BYTES: usize = 64 * 1024;
const HEAD_BYTES: usize = 2048;

/// Every audit action the workspace writes and the detail keys it writes today.
/// Adding an action is one entry here.
pub(crate) const ACTION_KEYS: &[(&str, &[&str])] = &[
    ("attention.rung", &["deadline", "rung", "reason"]),
    ("command.refused", &["command", "window", "tier"]),
    ("counterparty.expiry_set", &["key_id", "expires_at"]),
    ("counterparty.pinned", &["key_id", "paired_via"]),
    ("counterparty.revoked", &["key_id"]),
    ("deadline.set", &["due_at", "authorization_at"]),
    ("deal.countersigned", &["attempt", "hash", "decided_by"]),
    ("deal.created", &["kind", "mode", "terms_hash"]),
    ("deal.mandate_rebound", &["version"]),
    (
        "deal.owner_accept",
        &[
            "decided_by",
            "counter_hash",
            "terms_hash",
            "owner_key",
            "signature",
        ],
    ),
    (
        "deal.transition",
        &[
            "from",
            "to",
            "market",
            "decided_by",
            "rung_deadline",
            "rung_chain_hash",
            "rung_count",
            "last_rung",
        ],
    ),
    ("envelope.accepted", &["seq", "typ", "direction", "hash"]),
    (
        "envelope.rejected",
        &["reason", "raw_hash", "generation", "count", "raw_hashes"],
    ),
    ("group.opened", &["group_id", "tables"]),
    ("group.withdrawn", &["group_id", "winner", "decided_by"]),
    ("group.won", &["group_id"]),
    (
        "house.head_checked",
        &["epoch", "row_count", "audit_head", "prefix_rows"],
    ),
    (
        "house.head_refused",
        &["epoch", "row_count", "audit_head", "check"],
    ),
    (
        "house.head_kept",
        &["epoch", "row_count", "audit_head", "prefix_rows"],
    ),
    (
        "intent.refused",
        &["layer", "tool", "code", "clause", "reason"],
    ),
    ("mandate.revoked", &["id"]),
    ("mandate.signed", &["id", "version", "commitment"]),
    (
        "market.checked",
        &[
            "mandate_id",
            "mandate_version",
            "mandate_hash",
            "item_ref",
            "product_id",
            "day",
            "count",
            "max_per_day",
        ],
    ),
    (
        "market.observed",
        &["retrieved_at", "response_hash", "digest", "reference"],
    ),
    (
        "money.authorized",
        &[
            "operation",
            "request_id",
            "decided_by",
            "rung_deadline",
            "rung_chain_hash",
            "rung_count",
            "last_rung",
        ],
    ),
    ("money.observed", &["operation", "confirmed", "decided_by"]),
    (
        "money.resolved",
        &[
            "operation",
            "request_id",
            "observed",
            "outcome",
            "confirmed",
            "decided_by",
        ],
    ),
    ("offer.declined", &["hash", "reason"]),
    (
        "owner.decision",
        &[
            "decision",
            "decided_by",
            "checks_hash",
            "terms_hash",
            "attempt",
        ],
    ),
    ("paypal.response", &["status", "path", "debug_id"]),
    ("purchase.proposed", &["amount"]),
    ("receipt.reconciled", &["capture_id", "amount", "matched"]),
    ("receipt.refused", &["raw_hash", "reason"]),
    ("receipt.reporting_checked", &["from", "to", "capture_id"]),
    ("receipt.reporting_unmatched", &["from", "to", "capture_id"]),
    (
        "receipt.seller_attested",
        &["capture_id", "transcript_head"],
    ),
    (
        "receipt.unconfirmed",
        &[
            "capture_id",
            "received_at",
            "reconciliation",
            "statement_unmatched",
            "decided_by",
        ],
    ),
    ("receipt.verified", &["capture_id", "transcript_head"]),
    ("relay.bound", &["mailbox"]),
    (
        "rescue.opened",
        &[
            "source",
            "lever",
            "cycle",
            "discount",
            "invoice",
            "failed_payments",
            "next_retry_at",
        ],
    ),
    ("rescue.paid", &["invoice_id", "amount", "mode", "counted"]),
    ("rescue.watch_added", &["subscription_id", "plan"]),
    (
        "rescue.watch_read",
        &["subscription_id", "day", "count", "max_per_day"],
    ),
    ("rescue.watch_seen", &["subscription_id", "failed_payments"]),
    ("rescue.watch_stopped", &["subscription_id"]),
    ("rescue.watch_unread", &["subscription_id", "tries"]),
    (
        "run.finish",
        &["run", "deal_id", "engine", "mode", "state", "playbook"],
    ),
    ("run.start", &["run", "engine", "mode", "playbook"]),
    ("settlement.rejected", &["raw_hash", "reason"]),
    ("shield.checked", &["verdict", "rule", "terms_hash"]),
    ("shield.raised", &["verdict", "rule", "terms_hash"]),
    (
        "shield.refused",
        &[
            "step",
            "attempt",
            "verdict",
            "rule",
            "terms_hash",
            "refused_authority",
        ],
    ),
    (
        "shield.released",
        &["from", "to", "rules", "terms_hash", "decided_by"],
    ),
    ("wallet_limit.signed", &["version", "commitment"]),
];

pub(crate) fn allowed_keys(action: &str) -> Option<&'static [&'static str]> {
    ACTION_KEYS
        .iter()
        .find(|(name, _)| *name == action)
        .map(|(_, keys)| *keys)
}

/// A key whose value must never be stored, whatever it holds.
fn credential_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "access_token",
        "refresh_token",
        "id_token",
        "client_secret",
        "secret",
        "password",
        "api_key",
        "bearer",
    ]
    .iter()
    .any(|marker| key.contains(marker))
        // Exact: `authorization_at` is a timestamp, the header is the credential.
        || key == "authorization"
        || key == "proxy-authorization"
}

fn word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "._~+/=@-%".contains(c)
}
fn base64url(part: &str) -> bool {
    part.chars()
        .all(|c| c.is_ascii_alphanumeric() || "-_=".contains(c))
}
fn jws_shaped(word: &str) -> bool {
    let parts: Vec<&str> = word.split('.').collect();
    parts.len() >= 3
        && parts[0].starts_with("eyJ")
        && parts[0].len() >= 8
        && parts[..parts.len() - 1].iter().all(|p| !p.is_empty())
        && parts.iter().all(|p| base64url(p))
}
fn email_shaped(word: &str) -> bool {
    let Some((local, domain)) = word.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
}
/// Whether a string carries a bearer value, a JWS, `access_token`-style text or an email address.
pub(crate) fn credential_shaped(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    if lower.contains("bearer ")
        || lower.contains("access_token")
        || lower.contains("refresh_token")
        || lower.contains("client_secret")
    {
        return true;
    }
    text.split(|c: char| !word_char(c))
        .filter(|w| !w.is_empty())
        .any(|w| jws_shaped(w) || email_shaped(w))
}

fn scrub(value: &mut Value) {
    match value {
        Value::String(text) if credential_shaped(text) => *text = REDACTED.to_owned(),
        Value::Array(items) => items.iter_mut().for_each(scrub),
        Value::Object(fields) => {
            for (key, field) in fields.iter_mut() {
                if credential_key(key) && !field.is_null() {
                    *field = Value::String(REDACTED.to_owned());
                } else {
                    scrub(field);
                }
            }
        }
        _ => {}
    }
}

fn head(text: &str, limit: usize) -> &str {
    let mut end = limit.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// The detail that is hashed and stored for `action`.
pub(crate) fn sanitize(action: &str, detail: &Value) -> Result<Value, LedgerError> {
    let allowed = allowed_keys(action).unwrap_or(&[]);
    let (mut kept, mut dropped) = (Map::new(), Vec::new());
    match detail {
        Value::Object(fields) => {
            for (key, field) in fields {
                if allowed.contains(&key.as_str()) {
                    kept.insert(key.clone(), field.clone());
                } else {
                    dropped.push(key.clone());
                }
            }
        }
        Value::Null => {}
        _ => dropped.push("(not an object)".to_owned()),
    }
    dropped.sort();
    let mut clean = Value::Object(kept);
    scrub(&mut clean);
    if !dropped.is_empty()
        && let Value::Object(fields) = &mut clean
    {
        fields.insert("dropped".to_owned(), json!(dropped));
    }
    let bytes = canonical_bytes(&clean)?;
    if bytes.len() <= MAX_DETAIL_BYTES {
        return Ok(clean);
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut marker = json!({
        "truncated": true,
        "original_bytes": bytes.len(),
        "head": head(&text, HEAD_BYTES),
    });
    if !dropped.is_empty() {
        marker["dropped"] = json!(dropped);
    }
    Ok(marker)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuditEntry, Ledger};
    use std::path::{Path, PathBuf};

    fn entry(action: &str, detail: Value) -> AuditEntry {
        AuditEntry {
            at: 100,
            actor: "owner".into(),
            action: action.into(),
            deal_id: None,
            detail,
        }
    }
    fn last_detail(ledger: &Ledger) -> String {
        ledger
            .conn
            .query_row(
                "SELECT detail_json FROM audit_log ORDER BY seq DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }
    const JWS: &str = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl";

    #[test]
    fn a_secret_bearing_detail_is_stored_redacted() {
        let mut ledger = Ledger::in_memory().unwrap();
        ledger
            .append_audit(&entry(
                "intent.refused",
                json!({
                    "layer": "mandate",
                    "tool": "Bearer A21AAabcdef",
                    "code": JWS,
                    "reason": "payer jo@example.com said {\"access_token\":\"x\"}",
                    "clause": 6,
                    "client_secret": "s3cret",
                }),
            ))
            .unwrap();
        let stored = last_detail(&ledger);
        for leak in ["A21AAabcdef", "eyJhbGci", "jo@example.com", "s3cret"] {
            assert!(!stored.contains(leak), "{leak} leaked into {stored}");
        }
        let value: Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(value["tool"], REDACTED);
        assert_eq!(value["code"], REDACTED);
        assert_eq!(value["reason"], REDACTED);
        assert_eq!(value["layer"], "mandate");
        assert_eq!(value["clause"], 6);
        assert_eq!(value["dropped"], json!(["client_secret"]));
        ledger.verify_audit().unwrap();
    }

    #[test]
    fn plain_values_pass_and_legitimate_hashes_are_not_mistaken_for_secrets() {
        let mut ledger = Ledger::in_memory().unwrap();
        let detail = json!({"due_at": 400, "authorization_at": 120});
        ledger
            .append_audit(&entry("deadline.set", detail.clone()))
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&last_detail(&ledger)).unwrap(),
            detail
        );
        assert!(!credential_shaped(&"ab".repeat(32)));
        assert!(!credential_shaped("outside seller band"));
        assert!(credential_shaped("a@b.co"));
    }

    #[test]
    fn an_oversize_detail_is_capped_with_a_marker() {
        let mut ledger = Ledger::in_memory().unwrap();
        let big = "x".repeat(MAX_DETAIL_BYTES * 2);
        ledger
            .append_audit(&entry("intent.refused", json!({"reason": big, "extra": 1})))
            .unwrap();
        let stored = last_detail(&ledger);
        assert!(stored.len() < MAX_DETAIL_BYTES / 4, "{}", stored.len());
        let value: Value = serde_json::from_str(&stored).unwrap();
        assert_eq!(value["truncated"], true);
        assert!(value["original_bytes"].as_u64().unwrap() > MAX_DETAIL_BYTES as u64);
        assert_eq!(value["dropped"], json!(["extra"]));
        ledger.verify_audit().unwrap();
    }

    #[test]
    fn unknown_keys_are_dropped_by_name_and_an_unlisted_action_drops_every_key() {
        let mut ledger = Ledger::in_memory().unwrap();
        ledger
            .append_audit(&entry(
                "mandate.revoked",
                json!({"id": "m1", "note": "free text"}),
            ))
            .unwrap();
        let value: Value = serde_json::from_str(&last_detail(&ledger)).unwrap();
        assert_eq!(value, json!({"id": "m1", "dropped": ["note"]}));
        ledger
            .append_audit(&entry("not.in.the.table", json!({"b": 1, "a": 2})))
            .unwrap();
        let value: Value = serde_json::from_str(&last_detail(&ledger)).unwrap();
        assert_eq!(value, json!({"dropped": ["a", "b"]}));
        ledger.verify_audit().unwrap();
    }

    #[test]
    fn the_table_has_one_entry_per_action() {
        let mut names: Vec<&str> = ACTION_KEYS.iter().map(|(n, _)| *n).collect();
        let total = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), total);
    }

    fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for e in entries.flatten() {
            let path = e.path();
            let name = e.file_name().to_string_lossy().into_owned();
            if path.is_dir() {
                if !matches!(name.as_str(), "target" | "node_modules" | "tests" | ".git") {
                    sources(&path, out);
                }
            } else if name.ends_with(".rs") && !name.ends_with("tests.rs") {
                out.push(path);
            }
        }
    }
    /// Every `action: "x"` / `.action = "x"` literal in the workspace's non-test sources.
    #[test]
    fn every_action_the_workspace_writes_is_in_the_table() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut files = Vec::new();
        for dir in ["crates", "apps/desktop/src-tauri/src", "services"] {
            sources(&root.join(dir), &mut files);
        }
        assert!(files.len() > 50, "scanned only {} files", files.len());
        let mut found = std::collections::BTreeSet::new();
        for file in files {
            let text = std::fs::read_to_string(&file).unwrap();
            // A source file's own `#[cfg(test)]` module is not production.
            let production = text.split("#[cfg(test)]").next().unwrap_or("");
            for marker in ["action: \"", "action = \""] {
                for part in production.split(marker).skip(1) {
                    if let Some(name) = part.split('"').next() {
                        found.insert(name.to_owned());
                    }
                }
            }
        }
        assert!(found.len() > 40, "found only {found:?}");
        let missing: Vec<_> = found.iter().filter(|a| allowed_keys(a).is_none()).collect();
        assert!(
            missing.is_empty(),
            "actions missing from ACTION_KEYS: {missing:?}"
        );
    }

    /// Drops `//` comments that start a line or follow whitespace (so `https://` survives).
    fn strip_line_comments(text: &str) -> String {
        text.lines()
            .map(|line| {
                let cut = line
                    .match_indices("//")
                    .find(|(i, _)| *i == 0 || line[..*i].ends_with(char::is_whitespace))
                    .map_or(line.len(), |(i, _)| i);
                &line[..cut]
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
    /// The top-level keys of the `{...}` object that `text` starts with, or None if it does not
    /// start with one. Strings are skipped whole, so a value never reads as a key.
    fn object_keys(text: &str) -> Option<Vec<String>> {
        let mut chars = text.trim_start().chars().peekable();
        if chars.next() != Some('{') {
            return None;
        }
        let (mut depth, mut keys) = (1_u32, Vec::new());
        while let Some(c) = chars.next() {
            match c {
                '"' => {
                    let mut word = String::new();
                    while let Some(c) = chars.next() {
                        match c {
                            '\\' => {
                                chars.next();
                            }
                            '"' => break,
                            _ => word.push(c),
                        }
                    }
                    while chars.next_if(|c| c.is_whitespace()).is_some() {}
                    if depth == 1 && chars.peek() == Some(&':') {
                        keys.push(word);
                    }
                }
                '{' | '[' | '(' => depth += 1,
                '}' | ']' | ')' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(keys);
                    }
                }
                _ => {}
            }
        }
        None
    }
    /// The allowlist is the door's half of a pair; the writers are the other half. A key a writer
    /// adds that the table does not list is dropped at the door and survives only as a name in
    /// `dropped`, so every inline `detail: json!({...})` a production writer passes must name
    /// only keys its action's entry allows. Details built elsewhere (`detail,`) are counted, not
    /// parsed; the cases they carry are pinned by their own module tests.
    #[test]
    fn every_inline_detail_key_a_writer_passes_is_in_its_action_entry() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut files = Vec::new();
        for dir in ["crates", "apps/desktop/src-tauri/src", "services"] {
            sources(&root.join(dir), &mut files);
        }
        let (mut checked, mut built_elsewhere, mut unknown) = (0, 0, Vec::new());
        for file in files {
            let text = std::fs::read_to_string(&file).unwrap();
            let production = text.split("#[cfg(test)]").next().unwrap_or("");
            let production = strip_line_comments(production);
            for part in production.split("action: \"").skip(1) {
                let Some(action) = part.split('"').next() else {
                    continue;
                };
                let Some(allowed) = allowed_keys(action) else {
                    continue;
                };
                // `detail` follows `action` in every AuditEntry literal: the first one is its own.
                let Some(at) = part.find("detail") else {
                    continue;
                };
                let value = part[at + "detail".len()..].trim_start();
                let Some(object) = value.strip_prefix(':').map(str::trim_start).and_then(|v| {
                    v.strip_prefix("serde_json::json!(")
                        .or_else(|| v.strip_prefix("json!("))
                }) else {
                    built_elsewhere += 1;
                    continue;
                };
                // `json!(&value)` serializes a struct: its fields are not written out here.
                if !object.starts_with('{') {
                    built_elsewhere += 1;
                    continue;
                }
                let keys = object_keys(object)
                    .unwrap_or_else(|| panic!("{action} in {}: unreadable detail", file.display()));
                checked += 1;
                for key in keys {
                    if !allowed.contains(&key.as_str()) {
                        unknown.push(format!("{action}.{key} ({})", file.display()));
                    }
                }
            }
        }
        assert!(
            checked > 40,
            "checked only {checked} inline details ({built_elsewhere} built elsewhere)"
        );
        assert!(
            unknown.is_empty(),
            "detail keys the door would drop: {unknown:?}"
        );
    }
}
