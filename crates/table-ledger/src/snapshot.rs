//! A restore point before a schema migration (standard migrations/pre-migration-snapshots).
//! The ledger file is the merchant's single store, so a migration never starts without a copy
//! beside it: `<stem>.pre-v<N>.sqlite`, N being the version about to be migrated away from.
//!
//! Decisions: only a file-backed database that already holds a schema (`user_version >= 1`) is
//! snapshotted; an in-memory database and a brand-new empty file have nothing to restore. A
//! snapshot failure refuses the migration. The two newest snapshots (highest N) are kept.
use crate::LedgerError;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// How many pre-migration snapshots stay beside the database.
pub(crate) const KEEP: usize = 2;

fn parts(db: &Path) -> Option<(PathBuf, String)> {
    let stem = db.file_stem()?.to_str()?.to_owned();
    let dir = db.parent().map(Path::to_path_buf).unwrap_or_default();
    Some((dir, stem))
}

/// `VACUUM INTO` a snapshot of the pre-migration state. Must run outside any transaction.
pub(crate) fn take(conn: &Connection, version: i64) -> Result<(), LedgerError> {
    let Some(path) = conn.path().filter(|p| !p.is_empty()) else {
        return Ok(());
    };
    if version < 1 {
        return Ok(());
    }
    let (dir, stem) = parts(Path::new(path)).ok_or(LedgerError::Integrity("snapshot path"))?;
    let target = dir.join(format!("{stem}.pre-v{version}.sqlite"));
    if target.exists() {
        std::fs::remove_file(&target)
            .map_err(|_| LedgerError::Integrity("snapshot replace failed"))?;
    }
    let target = target
        .to_str()
        .ok_or(LedgerError::Integrity("snapshot path"))?;
    conn.execute("VACUUM INTO ?1", [target])?;
    Ok(())
}

/// Delete all but the newest [`KEEP`] snapshots of this database. Best effort: a leftover old
/// snapshot is harmless, so a failure here never fails the open.
pub(crate) fn prune(conn: &Connection) {
    let Some(path) = conn.path().filter(|p| !p.is_empty()) else {
        return;
    };
    let Some((dir, stem)) = parts(Path::new(path)) else {
        return;
    };
    let dir = if dir.as_os_str().is_empty() {
        PathBuf::from(".")
    } else {
        dir
    };
    let prefix = format!("{stem}.pre-v");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    let mut found: Vec<(i64, PathBuf)> = entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_owned();
            let n = name
                .strip_prefix(&prefix)?
                .strip_suffix(".sqlite")?
                .parse::<i64>()
                .ok()?;
            Some((n, e.path()))
        })
        .collect();
    found.sort_by_key(|(n, _)| std::cmp::Reverse(*n));
    for (_, old) in found.into_iter().skip(KEEP) {
        let _ = std::fs::remove_file(old);
    }
}
