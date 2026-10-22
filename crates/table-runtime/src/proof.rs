//! Signed proof export for one deal (theme T1). Read-only: it reads the ledger and the agent key,
//! moves nothing and calls nothing outside the process.
use crate::{Runtime, app, unavailable};
use table_client::CommandError;
use table_core::DealId;
use table_proto::{AgentSigner, ProofBundle};

#[cfg(test)]
thread_local! {
    /// Test hook: makes the evidence commitment fail, as a serialisation fault would.
    pub(crate) static FAIL_COMMITMENT: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
/// The wallet could not build its own proof file: a fault of this wallet, not of the request.
fn built_badly() -> CommandError {
    unavailable("Proof file could not be built")
}
impl Runtime {
    fn commitment(bundle: &ProofBundle) -> Result<table_core::H256, ()> {
        #[cfg(test)]
        if FAIL_COMMITMENT.get() {
            return Err(());
        }
        bundle.evidence_commitment().map_err(|_| ())
    }
    /// The bundle's evidence head is signed by the agent key the deal's mandate names, so a
    /// checker needs only the owner key id the owner shows them to anchor everything else. The
    /// file names this build's permissions fingerprint (T11) and carries the HOUSE heads kept
    /// beside the deal's receipt with the release pin they were kept against (T9).
    pub(crate) fn export_proof(&self, id: DealId) -> Result<ProofBundle, CommandError> {
        let owner = self.owner()?.verifying_key();
        let mut bundle = app(self.pipeline.wallet.ledger.export_proof(
            id,
            &owner,
            self.clock.now(),
            self.house_release.as_ref(),
        ))?;
        bundle.authority_manifest =
            Some(table_client::authority::manifest().map_err(|_| built_badly())?);
        self.sign_proof(&mut bundle)?;
        Ok(bundle)
    }
    /// Signs the bundle's evidence head with the agent key its mandate names.
    pub(crate) fn sign_proof(&self, bundle: &mut ProofBundle) -> Result<(), CommandError> {
        let wanted = bundle.mandate.payload.agent_key;
        let signer = self
            .slot_holding(wanted)
            .map(AgentSigner::from_key)
            .map_err(|_| unavailable("Agent key for this deal is unavailable"))?;
        bundle.evidence_head = Self::commitment(bundle).map_err(|()| built_badly())?;
        bundle.evidence_sig = signer.sign_commitment(bundle.evidence_head);
        Ok(())
    }
}
