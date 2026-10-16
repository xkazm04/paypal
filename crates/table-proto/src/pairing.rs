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
const COMMIT_HEADER: &[u8] = br#"{"typ":"table-pairing-commit","v":1}"#;
const REVEAL_HEADER: &[u8] = br#"{"typ":"table-pairing-reveal","v":1}"#;
const COMMIT_TAG: &[u8] = b"table-pairing-commit-v1";
/// The initiator's first publication in owner-to-owner pairing (DECISIONS section 47): its signed
/// bundle stays hidden behind `commit` until the joiner's bundle is fixed, so a relay that holds
/// the code must choose its key before it can see the key the words will be computed with.
/// `code_hash`, `side` and `expires` travel in the clear so the joiner can answer; the reveal
/// must repeat them exactly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingCommit {
    pub code_hash: H256,
    pub side: Side,
    pub expires: i64,
    pub commit: H256,
}
/// The initiator's bundle and the 32-byte nonce, published only after the joiner's reply.
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PairingReveal {
    pub bundle: SignedPairingIdentity,
    pub nonce: [u8; 32],
}
impl fmt::Debug for PairingReveal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("PairingReveal([REDACTED])")
    }
}
fn commitment(bundle: &SignedPairingIdentity, nonce: &[u8; 32]) -> Result<H256, PairingError> {
    let mut bytes = COMMIT_TAG.to_vec();
    bytes.extend_from_slice(&canonical_bytes(bundle).map_err(|_| PairingError)?);
    bytes.extend_from_slice(nonce);
    Ok(H256::digest(&bytes))
}
/// `header.payload.tag`, the three-part shape the relay carries. The header's `typ` keeps either
/// form from parsing as a signed pairing bundle or a deal envelope, and the reverse. The tag is
/// SHA-256 of `header.payload`, a checksum and not a signature: a commit is authenticated by the
/// reveal that opens it, and a reveal by that commit and its bundle's own signatures.
fn to_wire<T: Serialize>(header: &[u8], value: &T) -> Result<String, PairingError> {
    let input = format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header),
        URL_SAFE_NO_PAD.encode(canonical_bytes(value).map_err(|_| PairingError)?)
    );
    let raw = format!(
        "{input}.{}",
        URL_SAFE_NO_PAD.encode(H256::digest(input.as_bytes()).0)
    );
    if raw.len() > crate::MAX_JWS_BYTES {
        return Err(PairingError);
    }
    Ok(raw)
}
fn from_wire<T: Serialize + serde::de::DeserializeOwned>(
    header: &[u8],
    raw: &str,
) -> Result<T, PairingError> {
    if raw.len() > crate::MAX_JWS_BYTES || !raw.is_ascii() {
        return Err(PairingError);
    }
    let parts = raw.split('.').collect::<Vec<_>>();
    let [head, payload, tag] = parts.as_slice() else {
        return Err(PairingError);
    };
    if URL_SAFE_NO_PAD.decode(head).map_err(|_| PairingError)? != header
        || URL_SAFE_NO_PAD.decode(tag).map_err(|_| PairingError)?
            != H256::digest(format!("{head}.{payload}").as_bytes()).0
    {
        return Err(PairingError);
    }
    let bytes = URL_SAFE_NO_PAD.decode(payload).map_err(|_| PairingError)?;
    let value: T = serde_json::from_slice(&bytes).map_err(|_| PairingError)?;
    if canonical_bytes(&value).map_err(|_| PairingError)? != bytes {
        return Err(PairingError);
    }
    Ok(value)
}
impl PairingCommit {
    /// Commits to a verified initiating bundle with a fresh nonce from the application CSPRNG.
    pub fn seal(
        bundle: &SignedPairingIdentity,
        nonce: [u8; 32],
    ) -> Result<(Self, PairingReveal), PairingError> {
        bundle.verify()?;
        if bundle.identity.in_reply_to.is_some() {
            return Err(PairingError);
        }
        let commit = Self {
            code_hash: bundle.identity.code_hash,
            side: bundle.identity.side,
            expires: bundle.identity.expires,
            commit: commitment(bundle, &nonce)?,
        };
        Ok((
            commit,
            PairingReveal {
                bundle: bundle.clone(),
                nonce,
            },
        ))
    }
    pub fn to_wire(&self) -> Result<String, PairingError> {
        to_wire(COMMIT_HEADER, self)
    }
    pub fn from_wire(raw: &str) -> Result<Self, PairingError> {
        from_wire(COMMIT_HEADER, raw)
    }
}
impl PairingReveal {
    /// The reveal opens `commit` only with the exact bundle and nonce committed to, a bundle whose
    /// signatures verify and whose code, side and expiry are the ones the commit showed.
    pub fn opens(&self, commit: &PairingCommit) -> Result<(), PairingError> {
        self.bundle.verify()?;
        let identity = &self.bundle.identity;
        if identity.code_hash != commit.code_hash
            || identity.side != commit.side
            || identity.expires != commit.expires
            || identity.in_reply_to.is_some()
            || commitment(&self.bundle, &self.nonce)? != commit.commit
        {
            return Err(PairingError);
        }
        Ok(())
    }
    pub fn to_wire(&self) -> Result<String, PairingError> {
        self.bundle.verify()?;
        to_wire(REVEAL_HEADER, self)
    }
    pub fn from_wire(raw: &str) -> Result<Self, PairingError> {
        let reveal: Self = from_wire(REVEAL_HEADER, raw)?;
        reveal.bundle.verify()?;
        Ok(reveal)
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
/// Four words from a 64-word list commit to 24 bits; compare all words out of band. In owner-to-owner
/// pairing the joiner computes them only after the initiator's reveal opens its commit
/// ([`PairingCommit`]), so neither side's key can be chosen after the other's is seen.
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
    fn bundle(code_hash: H256, side: Side, expires: i64) -> SignedPairingIdentity {
        let owner = key();
        let agent = key();
        let identity = PairingIdentity {
            code_hash,
            owner_key: owner.verifying_key().to_bytes(),
            agent_key: agent.verifying_key().to_bytes(),
            side,
            payee: PayeeRef::new("merchant").unwrap(),
            expires,
            in_reply_to: None,
        };
        let bytes = canonical_bytes(&identity).unwrap();
        SignedPairingIdentity {
            identity,
            owner_signature: owner.sign(&bytes).to_bytes().to_vec(),
            agent_signature: agent.sign(&bytes).to_bytes().to_vec(),
        }
    }
    #[test]
    fn a_reveal_opens_its_commit_only_with_the_committed_bundle_and_nonce() {
        let code = PairingCode::from_entropy([7; 16]);
        let honest = bundle(code.mailbox_hash(), Side::Seller, 100);
        let (commit, reveal) = PairingCommit::seal(&honest, [1; 32]).unwrap();
        assert!(reveal.opens(&commit).is_ok());
        // The commit shows no key: only the code hash, side, expiry and the digest travel.
        let wire = commit.to_wire().unwrap();
        let shown: serde_json::Value = serde_json::from_slice(
            &URL_SAFE_NO_PAD
                .decode(wire.split('.').nth(1).unwrap())
                .unwrap(),
        )
        .unwrap();
        let mut fields = shown.as_object().unwrap().keys().collect::<Vec<_>>();
        fields.sort();
        assert_eq!(fields, ["code_hash", "commit", "expires", "side"]);
        assert_eq!(PairingCommit::from_wire(&wire).unwrap(), commit);
        let raw = reveal.to_wire().unwrap();
        assert!(
            PairingReveal::from_wire(&raw)
                .unwrap()
                .opens(&commit)
                .is_ok()
        );
        // Wire forms do not cross: a commit or reveal is never a bundle, and the reverse.
        assert!(SignedPairingIdentity::from_jws(&wire).is_err());
        assert!(SignedPairingIdentity::from_jws(&raw).is_err());
        assert!(PairingCommit::from_wire(&raw).is_err());
        assert!(PairingReveal::from_wire(&wire).is_err());
        let (input, _) = raw.rsplit_once('.').unwrap();
        let bad_tag = format!("{input}.{}", URL_SAFE_NO_PAD.encode([0; 32]));
        assert!(PairingReveal::from_wire(&bad_tag).is_err());
        assert!(PairingCommit::from_wire(&format!("{wire}.x")).is_err());
        // Another nonce, another bundle, or a bundle with a different expiry opens nothing.
        let mut wrong_nonce = reveal.clone();
        wrong_nonce.nonce = [2; 32];
        assert!(wrong_nonce.opens(&commit).is_err());
        let other = PairingReveal {
            bundle: bundle(code.mailbox_hash(), Side::Seller, 100),
            nonce: [1; 32],
        };
        assert!(other.opens(&commit).is_err());
        let mut shown_expiry = commit.clone();
        shown_expiry.expires = 101;
        assert!(reveal.opens(&shown_expiry).is_err());
        let mut shown_side = commit.clone();
        shown_side.side = Side::Buyer;
        assert!(reveal.opens(&shown_side).is_err());
        // An altered bundle fails its own signatures before the commit is even checked.
        let mut altered = reveal.clone();
        altered.bundle.identity.payee = PayeeRef::new("other").unwrap();
        assert!(altered.opens(&commit).is_err());
        assert!(altered.to_wire().is_err());
        assert!(!format!("{reveal:?}").contains("nonce"));
    }
    #[test]
    fn a_relay_holding_the_code_cannot_pick_its_key_after_the_joiners_key() {
        // The relay commits to its own key M first: that is all the joiner sees before it answers.
        let code = PairingCode::from_entropy([9; 16]);
        let m = bundle(code.mailbox_hash(), Side::Seller, 100);
        let (commit, committed) = PairingCommit::seal(&m, [3; 32]).unwrap();
        // Now the joiner's key is public. The relay tries other keys for its reveal, as many as it
        // likes, so the words would match the honest initiator's: none opens the commit.
        let joiner = key().verifying_key().to_bytes();
        for n in 0..64_u8 {
            let ground = PairingReveal {
                bundle: bundle(code.mailbox_hash(), Side::Seller, 100),
                nonce: [n; 32],
            };
            assert!(ground.opens(&commit).is_err());
        }
        // Only M opens it, and M was fixed before the joiner's key existed: whether its words match
        // the target is the 2^-24 chance of one guess, not the result of a search.
        assert!(committed.opens(&commit).is_ok());
        assert_eq!(committed.bundle.identity.agent_key, m.identity.agent_key);
        assert_eq!(
            pairing_words(joiner, m.identity.agent_key, &code),
            pairing_words(joiner, committed.bundle.identity.agent_key, &code)
        );
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
