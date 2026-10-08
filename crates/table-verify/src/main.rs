//! `table-verify <bundle.tableproof>`: prints the checklist; exit 0 verified, 1 failed, 2 unreadable.
//! `table-verify --house <ledger.json> [--head <head.json>]... [--pin <release.json>]`: checks a
//! saved page of the HOUSE's public ledger (GET /v1/house/ledger) and any heads saved over time
//! (GET /v1/house/head). The verifier reads files only; fetching them is the caller's choice.
use std::process::ExitCode;

fn read<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    std::fs::read(path)
        .map_err(|e| e.to_string())
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(|e| e.to_string()))
        .map_err(|error| format!("cannot read {path}: {error}"))
}
fn print(checks: &[table_verify::Check]) {
    for check in checks {
        println!(
            "{} {:<42} {}",
            if check.ok { "✓" } else { "✗" },
            check.name,
            check.detail
        );
    }
}
fn verdict(ok: bool) -> ExitCode {
    if ok {
        println!("VERIFIED");
        ExitCode::SUCCESS
    } else {
        println!("NOT VERIFIED");
        ExitCode::from(1)
    }
}
fn house(args: &[String]) -> Result<ExitCode, String> {
    let mut ledger = None;
    let mut heads = Vec::new();
    let mut pin = None;
    let mut it = args.iter();
    while let Some(flag) = it.next() {
        let value = it.next().ok_or_else(|| format!("{flag} needs a file"))?;
        match flag.as_str() {
            "--house" => ledger = Some(read::<table_proto::HouseLedgerView>(value)?),
            "--head" => heads.push(read::<table_proto::SignedHouseHead>(value)?),
            "--pin" => pin = Some(read::<table_proto::HouseRelease>(value)?),
            other => return Err(format!("unknown flag {other}")),
        }
    }
    let ledger = ledger.ok_or("--house <ledger.json> is required")?;
    let report = table_verify::verify_house(&ledger, &heads, pin.as_ref());
    println!(
        "house ledger · {} deal(s) · agent key {} · owner key {}",
        report.deals, report.agent_key_id, report.owner_key_id
    );
    print(&report.checks);
    if pin.is_none() {
        println!("{}", table_verify::HOUSE_KEY_ANCHOR);
    }
    Ok(verdict(report.verified()))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "--house") {
        return house(&args).unwrap_or_else(|error| {
            eprintln!("{error}");
            ExitCode::from(2)
        });
    }
    let Some(path) = args.first() else {
        eprintln!("usage: table-verify <bundle.tableproof>");
        eprintln!(
            "       table-verify --house <ledger.json> [--head <head.json>]... [--pin <release.json>]"
        );
        return ExitCode::from(2);
    };
    let bundle = match read(path) {
        Ok(bundle) => bundle,
        Err(error) => {
            eprintln!("{error}");
            return ExitCode::from(2);
        }
    };
    let report = table_verify::verify_bundle(&bundle);
    println!(
        "deal {} · {:?} · owner key {}",
        report.deal, report.mode, report.owner_key_id
    );
    print(&report.checks);
    println!("{}", table_verify::KEY_ANCHOR);
    println!("{}", table_verify::KNOWN_LIMIT);
    verdict(report.verified())
}
