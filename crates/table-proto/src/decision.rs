//! The owner key's statement over one owner decision: which deal, what was decided, the one step it
//! starts, the attempt, the terms and the checklist the owner saw (by hash), and when. The runtime
//! signs it with the owner key after the unlock gate and stores the signature in the decision's
//! audit row; a checker verifies it against the owner key the proof file names. It proves the
//! owner key signed this decision for this step, not that a person was present.
use ed25519_dalek::{Signature, SigningKey, VerifyingKey};
use serde::Serialize;
use table_core::{DealId, H256, Timestamp, canonical_bytes};

/// Domain tag for [`DecisionStatement`], so the owner's signature over a decision never verifies as
/// any other statement the owner key signs.
pub const OWNER_DECISION_DOMAIN: &[u8] = b"table.owner-decision.v1\0";

/// What the owner key signs for one decision. Every field is in the decision's audit row
/// (`at` is the `decided_by` time), so a checker builds the same bytes from the file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct DecisionStatement {
    pub deal_id: DealId,
    pub decision: String,
    pub operation: String,
    pub attempt: u8,
    pub terms_hash: H256,
    pub checks_hash: H256,
    pub at: Timestamp,
}
impl DecisionStatement {
    /// The domain tag followed by the canonical (JCS) statement.
    pub fn signing_bytes(&self) -> Result<Vec<u8>, serde_json::Error> {
        let mut bytes = OWNER_DECISION_DOMAIN.to_vec();
        bytes.extend(canonical_bytes(self)?);
        Ok(bytes)
    }
    pub fn sign(&self, owner: &SigningKey) -> Result<Vec<u8>, serde_json::Error> {
        Ok(ed25519_dalek::Signer::sign(owner, &self.signing_bytes()?)
            .to_bytes()
            .to_vec())
    }
    /// Whether `signature` is `owner_key`'s strict signature over this statement.
    pub fn verify(&self, owner_key: &[u8; 32], signature: &[u8]) -> bool {
        let (Ok(key), Ok(sig), Ok(bytes)) = (
            VerifyingKey::from_bytes(owner_key),
            Signature::from_slice(signature),
            self.signing_bytes(),
        ) else {
            return false;
        };
        key.verify_strict(&bytes, &sig).is_ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn statement() -> DecisionStatement {
        DecisionStatement {
            deal_id: "01K8W2R6Q4N5M9T3VXZ7B1CD0E".parse().unwrap(),
            decision: "deal_capture".into(),
            operation: "capture".into(),
            attempt: 1,
            terms_hash: H256([1; 32]),
            checks_hash: H256([2; 32]),
            at: 1_793_000_000,
        }
    }

    #[test]
    fn the_owner_signs_one_decision_for_one_step_under_its_own_domain() {
        let owner = SigningKey::from_bytes(&[7; 32]);
        let key = owner.verifying_key().to_bytes();
        let s = statement();
        let sig = s.sign(&owner).unwrap();
        assert!(s.verify(&key, &sig));
        assert!(
            s.signing_bytes()
                .unwrap()
                .starts_with(OWNER_DECISION_DOMAIN)
        );
        // Another step, another decision, another key, one flipped byte: none verifies.
        let other = DecisionStatement {
            operation: "create".into(),
            ..statement()
        };
        assert!(!other.verify(&key, &sig));
        let mut flipped = sig.clone();
        flipped[0] ^= 1;
        assert!(!s.verify(&key, &flipped));
        let agent = SigningKey::from_bytes(&[8; 32]);
        assert!(!s.verify(&agent.verifying_key().to_bytes(), &sig));
        assert!(!s.verify(&key, &s.sign(&agent).unwrap()));
        // The bare canonical statement (no domain tag) is not what is signed.
        let bare = ed25519_dalek::Signer::sign(&owner, &canonical_bytes(&s).unwrap());
        assert!(!s.verify(&key, &bare.to_bytes()));
    }
}
