#[cfg(windows)]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    ensure_client_dist()?;
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(authority_table::COMMANDS)),
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
/// The authority table (T11), included by path so the build script needs no dependency: Tauri's
/// command list is the table's command names, never a hand-kept copy.
#[cfg(windows)]
#[allow(dead_code)]
#[path = "../../../crates/table-client/src/authority_table.rs"]
mod authority_table;
#[cfg(not(windows))]
fn main() {}
