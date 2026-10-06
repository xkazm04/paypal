//! `table-verify <bundle.tableproof>`: prints the checklist; exit 0 verified, 1 failed, 2 unreadable.
use std::process::ExitCode;

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: table-verify <bundle.tableproof>");
        return ExitCode::from(2);
    };
    let bundle = match std::fs::read(&path)
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
    {
        Ok(bundle) => bundle,
        Err(error) => {
            eprintln!("cannot read {path}: {error}");
            return ExitCode::from(2);
        }
    };
    let report = table_verify::verify_bundle(&bundle);
    println!(
        "deal {} · {:?} · owner key {}",
        report.deal, report.mode, report.owner_key_id
    );
    for check in &report.checks {
        println!(
            "{} {:<42} {}",
            if check.ok { "✓" } else { "✗" },
            check.name,
            check.detail
        );
    }
    if report.verified() {
        println!("VERIFIED");
        ExitCode::SUCCESS
    } else {
        println!("NOT VERIFIED");
        ExitCode::from(1)
    }
}
