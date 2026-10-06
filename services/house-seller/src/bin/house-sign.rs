//! Owner-operated offline mandate signature. Prints only the signed public policy.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::{Signer, SigningKey};
use zeroize::Zeroizing;
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let raw = Zeroizing::new(
        std::env::var("HOUSE_OWNER_KEY_BASE64").map_err(|_| house_seller::Error::Invalid)?,
    );
    let decoded = Zeroizing::new(
        STANDARD
            .decode(raw.as_bytes())
            .map_err(|_| house_seller::Error::Invalid)?,
    );
    let seed = Zeroizing::new(
        <[u8; 32]>::try_from(decoded.as_slice()).map_err(|_| house_seller::Error::Invalid)?,
    );
    let owner = SigningKey::from_bytes(&seed);
    let raw = Zeroizing::new(
        std::env::var("HOUSE_MANDATE_PAYLOAD_JSON").map_err(|_| house_seller::Error::Invalid)?,
    );
    let payload: table_core::MandatePayload =
        serde_json::from_str(&raw).map_err(|_| house_seller::Error::Invalid)?;
    payload
        .validate()
        .map_err(|_| house_seller::Error::Invalid)?;
    let mandate = table_core::OpenMandate {
        owner_sig: owner
            .sign(&table_core::canonical_bytes(&payload)?)
            .to_bytes()
            .to_vec(),
        payload,
    };
    println!("{}", serde_json::to_string(&mandate)?);
    Ok(())
}
