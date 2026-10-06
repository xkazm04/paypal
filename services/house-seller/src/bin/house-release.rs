//! Emit public data only. Owner provisions private seeds and the signed mandate via env.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = house_seller::Configuration::from_environment()?;
    println!("{}", serde_json::to_string(&config.public_release()?)?);
    Ok(())
}
