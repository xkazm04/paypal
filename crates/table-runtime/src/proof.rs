//! Signed proof export for one deal (theme T1). Read-only: it reads the ledger and the agent key,
//! moves nothing and calls nothing outside the process.
use crate::{Runtime, app, invalid, unavailable, vault::existing_signing_key};
use table_client::{AgentSlot, CommandError};
use table_core::DealId;
use table_proto::{AgentSigner, ProofBundle};

impl Runtime {
    /// The bundle's evidence head is signed by the agent key the deal's mandate names, so a
    /// checker needs only the owner key id the owner shows them to anchor everything else.
    pub(crate) fn export_proof(&self, id: DealId) -> Result<ProofBundle, CommandError> {
        let owner = self.owner()?.verifying_key();
        let mut bundle =
            app(self
                .pipeline
                .wallet
                .ledger
                .export_proof(id, &owner, self.clock.now()))?;
        let wanted = bundle.mandate.payload.agent_key;
        let signer = [
            AgentSlot::Negotiator,
            AgentSlot::Shopper,
            AgentSlot::Assistant,
        ]
        .into_iter()
        .filter_map(|slot| existing_signing_key(self.vault.as_ref(), slot.key_name()).ok())
        .find(|key| key.verifying_key().to_bytes() == wanted)
        .map(AgentSigner::from_key)
        .ok_or_else(|| unavailable("Agent key for this deal is unavailable"))?;
        bundle.evidence_head = bundle.evidence_commitment().map_err(|_| invalid())?;
        bundle.evidence_sig = signer.sign_commitment(bundle.evidence_head);
        Ok(bundle)
    }
}
