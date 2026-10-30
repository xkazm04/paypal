//! Writes the verifier's word on every `.tableproof` file in a directory: `real-proofs <dir> <out.json>`.
//! The client's parity test holds the browser checker to it on files the wallet's own runtime wrote.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let (Some(dir), Some(out)) = (args.next(), args.next()) else {
        return Err("usage: real-proofs <dir> <out.json>".into());
    };
    let json = table_client::sample_proof::outcomes_in(std::path::Path::new(&dir))?;
    std::fs::write(out, json)?;
    Ok(())
}
