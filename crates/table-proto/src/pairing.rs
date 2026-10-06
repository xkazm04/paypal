use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fmt;
use table_core::{H256, PayeeRef, Side, canonical_bytes};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("pairing code must be HOUSE or TBL- followed by 128 bits of uppercase hex")]
pub struct PairingError;

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
pub struct PairingIdentity {
    pub code_hash: H256,
    pub owner_key: [u8; 32],
    pub agent_key: [u8; 32],
    pub side: Side,
    pub payee: PayeeRef,
    pub expires: i64,
    /// A reply commits to the entire initiating identity, including payee and expiry.
    pub in_reply_to: Option<H256>,
}
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
pub struct SignedPairingIdentity {
    pub identity: PairingIdentity,
    pub owner_signature: Vec<u8>,
    pub agent_signature: Vec<u8>,
}
const PAIRING_HEADER: &[u8] = br#"{"alg":"EdDSA","typ":"table-pairing+jws","v":1}"#;
impl SignedPairingIdentity {
    pub fn verify(&self) -> Result<(), PairingError> {
        let bytes = canonical_bytes(&self.identity).map_err(|_| PairingError)?;
        for (key, signature) in [
            (self.identity.owner_key, &self.owner_signature),
            (self.identity.agent_key, &self.agent_signature),
        ] {
            VerifyingKey::from_bytes(&key)
                .map_err(|_| PairingError)?
                .verify_strict(
                    &bytes,
                    &Signature::from_slice(signature).map_err(|_| PairingError)?,
                )
                .map_err(|_| PairingError)?;
        }
        Ok(())
    }
    pub fn identity_hash(&self) -> Result<H256, PairingError> {
        Ok(H256::digest(
            &canonical_bytes(&self.identity).map_err(|_| PairingError)?,
        ))
    }
    /// Distinct JWS type prevents pairing bundles from being interpreted as deal envelopes.
    pub fn to_jws(&self, agent: &SigningKey) -> Result<String, PairingError> {
        self.verify()?;
        if agent.verifying_key().to_bytes() != self.identity.agent_key {
            return Err(PairingError);
        }
        let input = format!(
            "{}.{}",
            URL_SAFE_NO_PAD.encode(PAIRING_HEADER),
            URL_SAFE_NO_PAD.encode(canonical_bytes(self).map_err(|_| PairingError)?)
        );
        let raw = format!(
            "{input}.{}",
            URL_SAFE_NO_PAD.encode(agent.sign(input.as_bytes()).to_bytes())
        );
        if raw.len() > crate::MAX_JWS_BYTES {
            return Err(PairingError);
        }
        Ok(raw)
    }
    pub fn from_jws(raw: &str) -> Result<Self, PairingError> {
        if raw.len() > crate::MAX_JWS_BYTES || !raw.is_ascii() {
            return Err(PairingError);
        }
        let parts = raw.split('.').collect::<Vec<_>>();
        let [header, payload, signature] = parts.as_slice() else {
            return Err(PairingError);
        };
        if URL_SAFE_NO_PAD.decode(header).map_err(|_| PairingError)? != PAIRING_HEADER {
            return Err(PairingError);
        }
        let bytes = URL_SAFE_NO_PAD.decode(payload).map_err(|_| PairingError)?;
        let bundle: Self = serde_json::from_slice(&bytes).map_err(|_| PairingError)?;
        if canonical_bytes(&bundle).map_err(|_| PairingError)? != bytes {
            return Err(PairingError);
        }
        bundle.verify()?;
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| PairingError)?;
        VerifyingKey::from_bytes(&bundle.identity.agent_key)
            .map_err(|_| PairingError)?
            .verify_strict(
                format!("{header}.{payload}").as_bytes(),
                &Signature::from_slice(&signature).map_err(|_| PairingError)?,
            )
            .map_err(|_| PairingError)?;
        Ok(bundle)
    }
}
/// One-time 128-bit entropy supplied by the application CSPRNG.
#[derive(Clone)]
pub struct PairingCode(String);
impl fmt::Debug for PairingCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PairingCode([REDACTED])")
    }
}
impl PairingCode {
    pub fn from_entropy(entropy: [u8; 16]) -> Self {
        Self(format!(
            "TBL-{}",
            entropy
                .iter()
                .map(|b| format!("{b:02X}"))
                .collect::<String>()
        ))
    }
    pub fn parse(code: &str) -> Result<Self, PairingError> {
        if code != "HOUSE"
            && (code.len() != 36
                || !code.starts_with("TBL-")
                || !code[4..]
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b)))
        {
            return Err(PairingError);
        }
        Ok(Self(code.into()))
    }
    pub fn expose_for_pairing(&self) -> &str {
        &self.0
    }
    pub fn mailbox_hash(&self) -> H256 {
        H256::digest(self.0.as_bytes())
    }
}

const WORDS: [&str; 64] = [
    "acorn", "amber", "anchor", "apple", "arch", "aster", "basil", "beacon", "birch", "bison",
    "bloom", "brook", "cabin", "cactus", "cedar", "cherry", "cliff", "clover", "coral", "crane",
    "delta", "dove", "dune", "elm", "fern", "finch", "flint", "forest", "fox", "frost", "garden",
    "glen", "grove", "harbor", "hazel", "heron", "iris", "island", "jade", "juniper", "lake",
    "lark", "leaf", "lily", "maple", "meadow", "moss", "oak", "olive", "otter", "pearl", "pine",
    "plum", "quartz", "reed", "river", "robin", "sage", "shore", "spruce", "stone", "thyme",
    "vale", "willow",
];
/// Buyer key then seller key; role order makes both wallets calculate identical SAS.
/// Four words from a 64-word list commit to 24 bits; compare all words out of band.
pub fn pairing_words(buyer: [u8; 32], seller: [u8; 32], code: &PairingCode) -> [&'static str; 4] {
    let mut bytes = Vec::with_capacity(100);
    bytes.extend_from_slice(&buyer);
    bytes.extend_from_slice(&seller);
    bytes.extend_from_slice(code.0.as_bytes());
    let digest = H256::digest(&bytes).0;
    let value = u32::from_be_bytes([0, digest[0], digest[1], digest[2]]);
    [
        WORDS[((value >> 18) & 63) as usize],
        WORDS[((value >> 12) & 63) as usize],
        WORDS[((value >> 6) & 63) as usize],
        WORDS[(value & 63) as usize],
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    fn key() -> SigningKey {
        let mut bytes = [0; 32];
        getrandom::fill(&mut bytes).unwrap();
        SigningKey::from_bytes(&bytes)
    }
    #[test]
    fn pairing_jws_binds_both_keys_payee_expiry_reply_and_wire_type() {
        let owner = key();
        let agent = key();
        let identity = PairingIdentity {
            code_hash: H256::digest(b"code"),
            owner_key: owner.verifying_key().to_bytes(),
            agent_key: agent.verifying_key().to_bytes(),
            side: Side::Seller,
            payee: PayeeRef::new("merchant").unwrap(),
            expires: 100,
            in_reply_to: None,
        };
        let bytes = canonical_bytes(&identity).unwrap();
        let bundle = SignedPairingIdentity {
            identity,
            owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
            agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
        };
        let raw = bundle.to_jws(&agent).unwrap();
        assert_eq!(
            SignedPairingIdentity::from_jws(&raw)
                .unwrap()
                .identity_hash()
                .unwrap(),
            bundle.identity_hash().unwrap()
        );
        for change in 0..6 {
            let mut altered = bundle.clone();
            match change {
                0 => altered.identity.payee = PayeeRef::new("other").unwrap(),
                1 => altered.identity.expires += 1,
                2 => altered.identity.in_reply_to = Some(H256::ZERO),
                3 => altered.identity.owner_key = key().verifying_key().to_bytes(),
                4 => altered.identity.agent_key = key().verifying_key().to_bytes(),
                _ => altered.identity.code_hash = H256::ZERO,
            }
            assert!(altered.verify().is_err());
            assert!(altered.to_jws(&agent).is_err());
        }
        assert!(bundle.to_jws(&key()).is_err());
        let (_, rest) = raw.split_once('.').unwrap();
        let wrong_type = format!(
            "{}.{rest}",
            URL_SAFE_NO_PAD.encode(br#"{"alg":"EdDSA","typ":"JWT"}"#)
        );
        assert!(SignedPairingIdentity::from_jws(&wrong_type).is_err());
        let (input, _) = raw.rsplit_once('.').unwrap();
        assert!(
            SignedPairingIdentity::from_jws(&format!(
                "{input}.{}",
                URL_SAFE_NO_PAD.encode([0; 64])
            ))
            .is_err()
        );
        assert!(SignedPairingIdentity::from_jws(&"a".repeat(crate::MAX_JWS_BYTES + 1)).is_err());
    }
}
