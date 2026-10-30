//! Keeps the verifier's word on random edits to proof files: `fuzz-proofs <corpus.json> <out.json>` (see
//! `apps/desktop/client/scripts/proof-fuzz.mjs`). The client's `fuzz.test.ts` holds the browser checker to it.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let (Some(corpus), Some(out)) = (args.next(), args.next()) else {
        return Err("usage: fuzz-proofs <corpus.json> <out.json>".into());
    };
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../apps/desktop/client/src/lib/proof");
    std::fs::write(
        out,
        table_client::sample_proof::fuzz_digests(&dir, &std::fs::read(corpus)?)?,
    )?;
    Ok(())
}
