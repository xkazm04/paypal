fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!(
        "{}",
        serde_json::to_string(&house_seller::public_agent_key()?)?
    );
    Ok(())
}
