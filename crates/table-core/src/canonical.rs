use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A digest is serialized as a fixed byte array. This encoding is part of protocol v1.
#[derive(ts_rs::TS, Debug, Default, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct H256(pub [u8; 32]);

impl H256 {
    pub const ZERO: Self = Self([0; 32]);
    pub fn digest(bytes: &[u8]) -> Self {
        Self(Sha256::digest(bytes).into())
    }
    pub fn chain(previous: Self, bytes: &[u8]) -> Self {
        let mut hash = Sha256::new();
        hash.update(previous.0);
        hash.update(bytes);
        Self(hash.finalize().into())
    }
    pub fn hex(self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }
}

pub fn canonical_bytes<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    serde_jcs::to_vec(value)
}
pub fn commitment<T: Serialize + ?Sized>(value: &T) -> Result<H256, serde_json::Error> {
    Ok(H256::digest(&canonical_bytes(value)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn jcs_key_order_does_not_change_commitment() {
        let a: serde_json::Value = serde_json::from_str(r#"{"b":2,"a":1}"#).unwrap();
        let b = json!({"a":1,"b":2});
        assert_eq!(commitment(&a).unwrap(), commitment(&b).unwrap());
        assert_eq!(canonical_bytes(&a).unwrap(), br#"{"a":1,"b":2}"#);
        assert_ne!(
            commitment(&a).unwrap(),
            commitment(&json!({"a":2,"b":2})).unwrap()
        );
    }

    #[test]
    fn jcs_uses_utf16_order_and_ecmascript_number_encoding() {
        let value = json!({"\u{e000}":1,"\u{1f600}":2,"n":1e-7});
        let canonical = String::from_utf8(canonical_bytes(&value).unwrap()).unwrap();
        assert_eq!(canonical, "{\"n\":1e-7,\"\u{1f600}\":2,\"\u{e000}\":1}");
    }
    #[test]
    fn chain_commits_to_previous_hash() {
        assert_ne!(
            H256::chain(H256::ZERO, b"row"),
            H256::chain(H256([1; 32]), b"row")
        );
    }
}
