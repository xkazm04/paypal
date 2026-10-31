//! What the fixture recorders share: one switch that says which recorder rewrites its fixture, and
//! the rule a recorded proof bundle is kept by.
//!
//! The recorders are the arena's (`tests/gauntlet/arena.rs`), the haggle's
//! (`table-runtime/src/haggle_record_tests.rs`, which includes this file by path) and the proof
//! checker's (`table-client/src/sample_proof.rs`). `TABLE_RECORD=arena|haggle|proofs|all`, or a
//! comma list of them, picks which ones rewrite; every other run compares and fails on drift.
//!
//! A proof bundle signs fresh nonces and session tokens every run, so its bytes are never the same
//! twice. A recorded bundle is kept as long as it still verifies and, with every signature, hash, key
//! and id masked, says exactly what the wallet says today; only then is the file on disk left as it
//! is, so a second recording changes nothing.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]
use serde_json::Value;
use table_proto::ProofBundle;

/// Whether this run rewrites the fixture of recorder `name`: `TABLE_RECORD` names it (a comma list,
/// or `all`), or the recorder's own older switch (`legacy`, kept as an alias) is set.
pub fn recording(name: &str, legacy: Option<&str>) -> bool {
    if legacy.is_some_and(|v| std::env::var_os(v).is_some()) {
        return true;
    }
    std::env::var("TABLE_RECORD").is_ok_and(|v| {
        v.split(',')
            .map(str::trim)
            .any(|n| n.eq_ignore_ascii_case(name) || n.eq_ignore_ascii_case("all"))
    })
}

/// A bundle with what differs run to run masked: hex strings (hashes, key ids), signed envelopes and
/// signatures, 32-byte arrays (keys, heads), ULIDs (each run's ids) and the audit rows' JSON detail,
/// which is read and masked the same way. Prices, states, sequence numbers, times, actions, codes and
/// the shape of every record stay as they are.
pub fn masked(v: &Value) -> Value {
    match v {
        Value::String(s) => {
            if let Ok(inner) = serde_json::from_str::<Value>(s)
                && (inner.is_object() || inner.is_array())
            {
                return masked(&inner);
            }
            let hex = s.len() >= 16 && s.bytes().all(|b| b.is_ascii_hexdigit());
            let ulid = s.len() == 26
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || b.is_ascii_uppercase());
            let signed = s.len() > 60 && !s.contains(' ');
            if hex || ulid || signed {
                Value::String("(masked)".into())
            } else {
                v.clone()
            }
        }
        Value::Array(items) if items.len() >= 16 && items.iter().all(Value::is_u64) => {
            Value::String("(bytes)".into())
        }
        Value::Array(items) => Value::Array(items.iter().map(masked).collect()),
        Value::Object(map) => {
            Value::Object(map.iter().map(|(k, v)| (k.clone(), masked(v))).collect())
        }
        other => other.clone(),
    }
}

/// The first place two documents differ, for a drift message.
pub fn first_difference(path: &str, a: &Value, b: &Value) -> Option<String> {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            keys.into_iter().find_map(|k| {
                first_difference(
                    &format!("{path}.{k}"),
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                )
            })
        }
        (Value::Array(x), Value::Array(y)) if x.len() == y.len() => x
            .iter()
            .zip(y)
            .enumerate()
            .find_map(|(i, (p, q))| first_difference(&format!("{path}[{i}]"), p, q)),
        _ if a == b => None,
        _ => Some(format!("{path}: pinned {a}, wallet now {b}")),
    }
}

/// Keeps one recorded bundle at `path`. The file on disk stays when it verifies and, masked, matches
/// `fresh`; otherwise a recording run (`record`) writes `fresh` and any other run fails with the first
/// difference. `fresh` itself must verify: the recorder never pins a bundle the verifier rejects.
pub fn keep_bundle(
    path: &std::path::Path,
    fresh: &ProofBundle,
    record: bool,
    rerun: &str,
) -> Result<(), String> {
    let report = table_verify::verify_bundle(fresh);
    if !report.verified() {
        return Err(format!(
            "{}: the wallet's own export does not verify: {:#?}",
            path.display(),
            report.checks
        ));
    }
    let bytes = serde_json::to_vec_pretty(fresh).map_err(|e| e.to_string())?;
    let now: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let kept = std::fs::read(path).ok();
    let why = match kept.as_deref().map(serde_json::from_slice::<ProofBundle>) {
        None => "it is missing".to_owned(),
        Some(Err(e)) => format!("it is not a proof bundle ({e})"),
        Some(Ok(bundle)) if !table_verify::verify_bundle(&bundle).verified() => {
            "it no longer verifies".to_owned()
        }
        Some(Ok(_)) => {
            let was: Value =
                serde_json::from_slice(kept.as_deref().unwrap_or_default()).unwrap_or(Value::Null);
            match first_difference("bundle", &masked(&was), &masked(&now)) {
                None => return Ok(()),
                Some(diff) => diff,
            }
        }
    };
    if record {
        std::fs::write(path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
        println!("recorded {}", path.display());
        return Ok(());
    }
    Err(format!(
        "{} is not what the wallet exports today: {why}\nIf the change is intended, re-record it: {rerun}",
        path.display()
    ))
}
