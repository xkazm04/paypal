//! Server configuration is read exclusively from environment variables, never files/keyring.
use crate::Error;
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use ed25519_dalek::SigningKey;
use table_core::OpenMandate;
use table_paypal::{Credentials, http::Secret};
use zeroize::Zeroizing;

pub const ENV_NAMES: &[&str] = &[
    "HOUSE_OWNER_KEY_BASE64",
    "HOUSE_AGENT_KEY_BASE64",
    "HOUSE_MANDATE_JSON",
    "HOUSE_PAYPAL_CLIENT_ID",
    "HOUSE_PAYPAL_CLIENT_SECRET",
    "HOUSE_LEDGER_PATH",
    "PORT",
];
pub struct Configuration {
    pub owner: SigningKey,
    pub agent: SigningKey,
    pub mandate: OpenMandate,
}
impl std::fmt::Debug for Configuration {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HouseConfiguration { [REDACTED] }")
    }
}
/// Why the environment was refused: fixed text naming the variable, never its value.
const OWNER_KEY: [&str; 2] = [
    "HOUSE_OWNER_KEY_BASE64 is missing or empty",
    "HOUSE_OWNER_KEY_BASE64 is not 32 bytes of standard base64",
];
const AGENT_KEY: [&str; 2] = [
    "HOUSE_AGENT_KEY_BASE64 is missing or empty",
    "HOUSE_AGENT_KEY_BASE64 is not 32 bytes of standard base64",
];
fn required(
    read: &impl Fn(&str) -> Option<String>,
    name: &str,
    missing: &'static str,
) -> Result<Zeroizing<String>, Error> {
    read(name)
        .filter(|v| !v.is_empty())
        .map(Zeroizing::new)
        .ok_or(Error::Config(missing))
}
fn key(
    read: &impl Fn(&str) -> Option<String>,
    name: &str,
    [missing, malformed]: [&'static str; 2],
) -> Result<SigningKey, Error> {
    let raw = required(read, name, missing)?;
    let bytes = Zeroizing::new(
        STANDARD
            .decode(raw.as_bytes())
            .map_err(|_| Error::Config(malformed))?,
    );
    let seed: Zeroizing<[u8; 32]> = Zeroizing::new(
        bytes
            .as_slice()
            .try_into()
            .map_err(|_| Error::Config(malformed))?,
    );
    Ok(SigningKey::from_bytes(&seed))
}
/// Offline release preparation: expose only the public agent key for the mandate payload.
pub fn public_agent_key() -> Result<[u8; 32], Error> {
    Ok(key(
        &|name| std::env::var(name).ok(),
        "HOUSE_AGENT_KEY_BASE64",
        AGENT_KEY,
    )?
    .verifying_key()
    .to_bytes())
}
impl Configuration {
    pub fn from_environment() -> Result<Self, Error> {
        Self::read(|name| std::env::var(name).ok())
    }
    /// Injectable reader lets ordinary tests validate configuration without mutating process env.
    pub fn read(read: impl Fn(&str) -> Option<String>) -> Result<Self, Error> {
        let owner = key(&read, "HOUSE_OWNER_KEY_BASE64", OWNER_KEY)?;
        let agent = key(&read, "HOUSE_AGENT_KEY_BASE64", AGENT_KEY)?;
        let raw = required(
            &read,
            "HOUSE_MANDATE_JSON",
            "HOUSE_MANDATE_JSON is missing or empty",
        )?;
        let mandate: OpenMandate = serde_json::from_str(&raw)
            .map_err(|_| Error::Config("HOUSE_MANDATE_JSON is not a signed mandate"))?;
        table_proto::verify_mandate_signature(
            &mandate.payload,
            &mandate.owner_sig,
            &owner.verifying_key(),
        )
        .map_err(|_| Error::Config("HOUSE_MANDATE_JSON is not signed by HOUSE_OWNER_KEY_BASE64"))?;
        if mandate.payload.agent_key != agent.verifying_key().to_bytes() {
            return Err(Error::Config(
                "HOUSE_MANDATE_JSON names another agent key than HOUSE_AGENT_KEY_BASE64",
            ));
        }
        Ok(Self {
            owner,
            agent,
            mandate,
        })
    }
    pub fn public_release(&self) -> Result<table_proto::HouseRelease, Error> {
        use ed25519_dalek::Signer;
        let payee = self
            .mandate
            .payload
            .clauses
            .iter()
            .find_map(|c| match c {
                table_core::Clause::Payees { payees } if payees.len() == 1 => {
                    Some(payees[0].clone())
                }
                _ => None,
            })
            .ok_or(Error::Invalid)?;
        let mandate_commitment = self.mandate.payload.hash()?;
        Ok(table_proto::HouseRelease {
            owner_key: self.owner.verifying_key().to_bytes(),
            agent_key: self.agent.verifying_key().to_bytes(),
            payee,
            mandate_commitment,
            owner_signature: self.owner.sign(&mandate_commitment.0).to_bytes().to_vec(),
        })
    }
}
#[derive(Debug)]
pub struct EnvironmentCredentials;
#[async_trait]
impl Credentials for EnvironmentCredentials {
    async fn load(&self) -> Result<(Secret, Secret), table_paypal::Error> {
        let id =
            std::env::var("HOUSE_PAYPAL_CLIENT_ID").map_err(|_| table_paypal::Error::Invalid)?;
        let secret = std::env::var("HOUSE_PAYPAL_CLIENT_SECRET")
            .map_err(|_| table_paypal::Error::Invalid)?;
        if id.is_empty() || secret.is_empty() {
            return Err(table_paypal::Error::Invalid);
        }
        Ok((Secret::new(id), Secret::new(secret)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;

    /// A seed that must never reach an error text.
    const SEED: [u8; 32] = [7; 32];
    fn reader(over: &'static str, value: Option<&'static str>) -> impl Fn(&str) -> Option<String> {
        move |name: &str| {
            if name == over {
                return value.map(str::to_owned);
            }
            match name {
                "HOUSE_OWNER_KEY_BASE64" | "HOUSE_AGENT_KEY_BASE64" => Some(STANDARD.encode(SEED)),
                "HOUSE_MANDATE_JSON" => Some("{}".into()),
                _ => None,
            }
        }
    }
    fn refusal(read: impl Fn(&str) -> Option<String>) -> String {
        match Configuration::read(read) {
            Err(e @ Error::Config(_)) => e.to_string(),
            Err(e) => format!("not a configuration refusal: {e}"),
            Ok(_) => "accepted".into(),
        }
    }
    #[test]
    fn a_refused_environment_names_the_variable_and_never_its_value() {
        let seed = STANDARD.encode(SEED);
        for (over, value, names) in [
            (
                "HOUSE_OWNER_KEY_BASE64",
                None,
                "HOUSE_OWNER_KEY_BASE64 is missing",
            ),
            (
                "HOUSE_OWNER_KEY_BASE64",
                Some(""),
                "HOUSE_OWNER_KEY_BASE64 is missing",
            ),
            (
                "HOUSE_OWNER_KEY_BASE64",
                Some("not base64!"),
                "HOUSE_OWNER_KEY_BASE64 is not 32",
            ),
            (
                "HOUSE_AGENT_KEY_BASE64",
                None,
                "HOUSE_AGENT_KEY_BASE64 is missing",
            ),
            (
                "HOUSE_AGENT_KEY_BASE64",
                Some("AAAA"),
                "HOUSE_AGENT_KEY_BASE64 is not 32",
            ),
            ("HOUSE_MANDATE_JSON", None, "HOUSE_MANDATE_JSON is missing"),
            (
                "HOUSE_MANDATE_JSON",
                Some("{\"x\":1}"),
                "HOUSE_MANDATE_JSON is not a signed",
            ),
        ] {
            let text = refusal(reader(over, value));
            assert!(text.contains(names), "{over}={value:?}: {text}");
            assert!(!text.contains(&seed), "{over}: the seed leaked into {text}");
            assert_eq!(Error::Config("x").code(), "config");
        }
    }
}
