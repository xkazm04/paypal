use ts_rs::TS;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = manifest.join("../../bindings");
    let config = ts_rs::Config::new()
        .with_out_dir(&root)
        .with_large_int("number");
    table_client::CommandContract::export_all(&config)?;
    table_client::EventContract::export_all(&config)?;
    table_client::CommandError::export_all(&config)?;
    table_client::IpcHeaders::export_all(&config)?;
    // The authority table's derived files (T11): the mock's gate table and the capability files.
    std::fs::write(
        root.join("authority.ts"),
        table_client::authority::typescript()?,
    )?;
    let capabilities = manifest.join("../../apps/desktop/src-tauri/capabilities");
    for (file, contents) in table_client::authority::capability_files()? {
        std::fs::write(capabilities.join(file), contents)?;
    }
    Ok(())
}
