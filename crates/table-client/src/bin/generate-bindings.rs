use ts_rs::TS;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../bindings");
    let config = ts_rs::Config::new()
        .with_out_dir(root)
        .with_large_int("number");
    table_client::CommandContract::export_all(&config)?;
    table_client::EventContract::export_all(&config)?;
    table_client::CommandError::export_all(&config)?;
    table_client::IpcHeaders::export_all(&config)?;
    Ok(())
}
