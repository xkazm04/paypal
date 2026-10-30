//! Writes the sample proof file and its parity file for the browser checker (see
//! `table_client::sample_proof`). Run it after anything that changes what the file holds, such as
//! the permissions table.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = std::env::args_os().nth(1).map_or_else(
        || {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join(table_client::sample_proof::CLIENT_DIR)
        },
        std::path::PathBuf::from,
    );
    table_client::sample_proof::write_to(&dir)?;
    println!("wrote {}", dir.display());
    Ok(())
}
