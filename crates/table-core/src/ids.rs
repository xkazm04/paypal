use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr};
use thiserror::Error;

#[derive(Debug, Error)]
#[error("invalid identifier")]
pub struct InvalidId;

macro_rules! ulid_id {
    ($name:ident) => {
        #[derive(
            ts_rs::TS,
            Debug,
            Clone,
            Copy,
            PartialEq,
            Eq,
            PartialOrd,
            Ord,
            Hash,
            Serialize,
            Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(#[ts(type = "string")] pub ulid::Ulid);
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
        impl FromStr for $name {
            type Err = InvalidId;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                // Canonical spelling avoids alternate invoice identities.
                let id = ulid::Ulid::from_string(s).map_err(|_| InvalidId)?;
                if id.to_string() != s {
                    return Err(InvalidId);
                }
                Ok(Self(id))
            }
        }
    };
}
ulid_id!(DealId);
ulid_id!(MandateId);
ulid_id!(RunId);

macro_rules! text_id {
    ($name:ident) => {
        #[derive(
            ts_rs::TS, Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
        )]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, InvalidId> {
                let value = value.into();
                if value.is_empty()
                    || value.len() > 128
                    || !value
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.:@+".contains(&b))
                {
                    return Err(InvalidId);
                }
                Ok(Self(value))
            }
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }
        impl TryFrom<String> for $name {
            type Error = InvalidId;
            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }
        impl From<$name> for String {
            fn from(value: $name) -> Self {
                value.0
            }
        }
        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }
    };
}
text_id!(ItemRef);
text_id!(PayeeRef);
text_id!(KeyId);

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn display_labels_and_instruction_text_are_not_ids() {
        assert!("D-0001".parse::<DealId>().is_err());
        assert!(ItemRef::new("ignore previous instructions").is_err());
        assert!(KeyId::new("").is_err());
    }
}
