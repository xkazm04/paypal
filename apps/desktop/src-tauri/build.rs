#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    ensure_client_dist()?;
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(table_commands())),
    )
    .map_err(|e| std::io::Error::other(e.to_string()))?;
    Ok(())
}
/// `tauri::generate_context!` embeds `../client/dist`, a gitignored build output. Debug and test
/// builds get an empty placeholder so the crate compiles without the client toolchain; a release
/// build without the real bundle fails here rather than shipping a blank window.
#[cfg(windows)]
fn ensure_client_dist() -> Result<(), Box<dyn std::error::Error>> {
    println!("cargo:rerun-if-changed=../client/dist/index.html");
    let dist = std::path::Path::new("../client/dist");
    if dist.join("index.html").is_file() {
        return Ok(());
    }
    if std::env::var("PROFILE").is_ok_and(|p| p == "release") {
        return Err("apps/desktop/client/dist/index.html is missing: build the client (pnpm build in apps/desktop/client) before a release build".into());
    }
    std::fs::create_dir_all(dist)?;
    std::fs::write(
        dist.join("index.html"),
        "<!doctype html><title>placeholder</title>",
    )?;
    println!(
        "cargo:warning=client bundle is missing (apps/desktop/client/dist); a placeholder is embedded"
    );
    Ok(())
}
#[cfg(windows)]
fn table_commands() -> &'static [&'static str] {
    &[
        "get_settings",
        "approval_selection",
        "deal_display",
        "deal_transcript",
        "counterparty_list",
        "tumbler_snap",
        "tumbler_drag",
        "quit_confirm",
        "settings_write",
        "quit_summary",
        "pause_all_agents",
        "resume_all_agents",
        "agent_start",
        "agent_runs",
        "market_refresh",
        "deal_create",
        "pairing_confirm",
        "pairing_join",
        "pairing_poll",
        "pairing_create",
        "band_set",
        "mandate_revoke",
        "mandate_sign",
        "mandate_list",
        "engine_select",
        "set_credentials",
        "list_deals",
        "get_deal",
        "deal_evidence",
        "deal_reconcile",
        "deal_join",
        "engine_status",
        "attention_list",
        "main_open",
        "approval_open",
        "approval_summary",
        "approval_pairing",
        "approval_token",
        "tumbler_set_form",
        "tumbler_pin",
        "deal_withdraw",
        "deal_let_lapse",
        "deal_snooze",
        "unlock",
        "deal_countersign",
        "deal_owner_accept",
        "deal_capture",
        "deal_void",
        "shield_release",
        "rescue_approve",
        "open_paypal_in_browser",
        "counterparty_note",
        "pairing_abort",
        "house_wake",
        "approval_handoff",
        "audit_page",
        "owner_facts",
        "book_query",
        "deal_export_proof",
        "proof_check",
        "deal_history",
        "mandate_simulate",
    ]
}
#[cfg(not(windows))]
fn main() {}
