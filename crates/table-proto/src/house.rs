//! Public release trust anchor. Deployment secrets never enter the wallet build.
use crate::{PairingError, SignedPairingIdentity, verify_mandate_signature};
use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use table_core::{Category, DealId, H256, OpenMandate, PayeeRef, Side, Terms};

// A shipping wallet/service must carry the same owner-approved public trust anchor.
#[cfg(not(debug_assertions))]
const _: () = assert!(
    option_env!("TABLE_HOUSE_RELEASE_JSON").is_some(),
    "release builds require TABLE_HOUSE_RELEASE_JSON (public data only)"
);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseRelease {
    pub owner_key: [u8; 32],
    pub agent_key: [u8; 32],
    pub payee: PayeeRef,
    pub mandate_commitment: H256,
    pub owner_signature: Vec<u8>,
}
impl HouseRelease {
    pub fn compiled() -> Result<Self, PairingError> {
        let release: Self =
            serde_json::from_str(option_env!("TABLE_HOUSE_RELEASE_JSON").ok_or(PairingError)?)
                .map_err(|_| PairingError)?;
        release.verify()?;
        Ok(release)
    }
    pub fn verify(&self) -> Result<(), PairingError> {
        if self.owner_key == self.agent_key {
            return Err(PairingError);
        }
        VerifyingKey::from_bytes(&self.agent_key).map_err(|_| PairingError)?;
        VerifyingKey::from_bytes(&self.owner_key)
            .map_err(|_| PairingError)?
            .verify_strict(
                &self.mandate_commitment.0,
                &Signature::from_slice(&self.owner_signature).map_err(|_| PairingError)?,
            )
            .map_err(|_| PairingError)
    }
    pub fn verify_mandate(&self, mandate: &OpenMandate) -> Result<(), PairingError> {
        self.verify()?;
        if mandate.payload.hash().map_err(|_| PairingError)? != self.mandate_commitment
            || mandate.payload.agent_key != self.agent_key
            || !mandate.payload.clauses.iter().any(|clause|matches!(clause,table_core::Clause::Payees{payees} if payees.as_slice()==[self.payee.clone()]))
        {
            return Err(PairingError);
        }
        verify_mandate_signature(
            &mandate.payload,
            &mandate.owner_sig,
            &VerifyingKey::from_bytes(&self.owner_key).map_err(|_| PairingError)?,
        )
        .map_err(|_| PairingError)
    }
    pub fn verify_peer(&self, peer: &SignedPairingIdentity) -> Result<(), PairingError> {
        self.verify()?;
        peer.verify()?;
        let p = &peer.identity;
        if p.owner_key != self.owner_key
            || p.agent_key != self.agent_key
            || p.payee != self.payee
            || p.side != Side::Seller
        {
            return Err(PairingError);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
pub struct HouseTable {
    pub negotiation_deadline: i64,
    pub deal_id: DealId,
    pub terms: Terms,
    pub category: Category,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseRequest {
    pub buyer: SignedPairingIdentity,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HouseResponse {
    pub seller: SignedPairingIdentity,
    pub mandate: OpenMandate,
    pub table: HouseTable,
    /// Agent signature binds the table and mandate to this buyer's initiating identity.
    pub signature: Vec<u8>,
}
impl HouseResponse {
    pub fn signing_bytes(&self) -> Result<Vec<u8>, PairingError> {
        table_core::canonical_bytes(&(&self.seller, &self.mandate, &self.table))
            .map_err(|_| PairingError)
    }
    pub fn verify(
        &self,
        release: &HouseRelease,
        buyer: &SignedPairingIdentity,
        now: i64,
    ) -> Result<(), PairingError> {
        buyer.verify()?;
        release.verify_peer(&self.seller)?;
        release.verify_mandate(&self.mandate)?;
        let b = &buyer.identity;
        let s = &self.seller.identity;
        if b.side != Side::Buyer
            || b.in_reply_to.is_some()
            || s.code_hash != b.code_hash
            || s.in_reply_to != Some(buyer.identity_hash()?)
            || s.expires != b.expires
            || s.expires <= now
            || s.expires > now.saturating_add(86400)
            || now < self.mandate.payload.not_before
            || now >= self.mandate.payload.expires
        {
            return Err(PairingError);
        }
        self.table.terms.hash().map_err(|_| PairingError)?;
        if self.table.negotiation_deadline <= now
            || self.table.negotiation_deadline > self.mandate.payload.expires
        {
            return Err(PairingError);
        }
        VerifyingKey::from_bytes(&release.agent_key)
            .map_err(|_| PairingError)?
            .verify_strict(
                &self.signing_bytes()?,
                &Signature::from_slice(&self.signature).map_err(|_| PairingError)?,
            )
            .map_err(|_| PairingError)
    }
}
