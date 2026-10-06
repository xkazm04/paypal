//! Secrets never cross the Rust read boundary. Tests inject the memory implementation.
use async_trait::async_trait;
use ed25519_dalek::SigningKey;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use table_paypal::{Credentials, http::Secret};
use thiserror::Error;
use zeroize::Zeroizing;
pub enum CredentialEntry {
    PaypalSandbox {
        client_id: Zeroizing<String>,
        client_secret: Zeroizing<String>,
    },
    Channel3 {
        key: Zeroizing<String>,
    },
}
impl std::fmt::Debug for CredentialEntry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CredentialEntry { [REDACTED] }")
    }
}

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("OS secret store unavailable")]
    Unavailable,
    #[error("invalid secret or signing key")]
    Invalid,
    #[error("OS secret store unsupported")]
    Unsupported,
    #[error("signing key missing")]
    Missing,
}
pub trait Vault: Send + Sync {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError>;
    fn write(&self, name: &str, value: &[u8]) -> Result<(), VaultError>;
}
#[derive(Default)]
pub struct MemoryVault(Mutex<BTreeMap<String, Zeroizing<Vec<u8>>>>);
impl std::fmt::Debug for MemoryVault {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MemoryVault { [REDACTED] }")
    }
}
impl Vault for MemoryVault {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        Ok(self
            .0
            .lock()
            .map_err(|_| VaultError::Unavailable)?
            .get(name)
            .cloned())
    }
    fn write(&self, name: &str, value: &[u8]) -> Result<(), VaultError> {
        self.0
            .lock()
            .map_err(|_| VaultError::Unavailable)?
            .insert(name.into(), Zeroizing::new(value.to_vec()));
        Ok(())
    }
}
#[derive(Debug)]
pub struct KeyringVault;
impl Vault for KeyringVault {
    fn read(&self, name: &str) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        #[cfg(windows)]
        {
            let entry = keyring::Entry::new("TheTable.AgenticWallet", name)
                .map_err(|_| VaultError::Unavailable)?;
            match entry.get_secret() {
                Ok(bytes) => Ok(Some(Zeroizing::new(bytes))),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(_) => Err(VaultError::Unavailable),
            }
        }
        #[cfg(not(windows))]
        {
            let _ = name;
            Err(VaultError::Unsupported)
        }
    }
    fn write(&self, name: &str, value: &[u8]) -> Result<(), VaultError> {
        #[cfg(windows)]
        {
            keyring::Entry::new("TheTable.AgenticWallet", name)
                .map_err(|_| VaultError::Unavailable)?
                .set_secret(value)
                .map_err(|_| VaultError::Unavailable)
        }
        #[cfg(not(windows))]
        {
            let _ = (name, value);
            Err(VaultError::Unsupported)
        }
    }
}
/// Reads a key that must already exist. A missing entry fails closed instead of minting a new
/// identity: a lost owner key must never silently rotate who signed the wallet's mandates.
pub fn existing_signing_key(vault: &dyn Vault, name: &str) -> Result<SigningKey, VaultError> {
    let bytes = vault.read(name)?.ok_or(VaultError::Missing)?;
    let key: &[u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| VaultError::Invalid)?;
    Ok(SigningKey::from_bytes(key))
}
/// Provisions a key on first use. Only wallet startup may call this.
pub fn signing_key(vault: &dyn Vault, name: &str) -> Result<SigningKey, VaultError> {
    let bytes = match vault.read(name)? {
        Some(bytes) => bytes,
        None => {
            let mut bytes = Zeroizing::new(vec![0; 32]);
            getrandom::fill(&mut bytes).map_err(|_| VaultError::Unavailable)?;
            vault.write(name, &bytes)?;
            bytes
        }
    };
    let key: &[u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| VaultError::Invalid)?;
    Ok(SigningKey::from_bytes(key))
}
pub struct VaultCredentials(pub Arc<dyn Vault>);
impl std::fmt::Debug for VaultCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultCredentials { [REDACTED] }")
    }
}
#[async_trait]
impl Credentials for VaultCredentials {
    async fn load(&self) -> Result<(Secret, Secret), table_paypal::Error> {
        let bytes = self
            .0
            .read("paypal.sandbox")
            .map_err(|_| table_paypal::Error::Credentials)?
            .ok_or(table_paypal::Error::Credentials)?;
        let pair: (String, String) =
            serde_json::from_slice(&bytes).map_err(|_| table_paypal::Error::Credentials)?;
        Ok((Secret::new(pair.0), Secret::new(pair.1)))
    }
}
