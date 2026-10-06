//! Inbound financial evidence is verified by Rust, independently of agents and windows.
use crate::{Error, Wallet};
use table_core::*;
use table_proto::Body;
impl Wallet {
    pub fn receive_relay(
        &mut self,
        id: DealId,
        raw: &str,
        category: Category,
        now: Timestamp,
    ) -> Result<(), Error> {
        // Exact signed duplicates (including our own relay echo) are recovery, not a new intent.
        if self
            .ledger
            .has_envelope_hash(id, H256::digest(raw.as_bytes()))?
        {
            return Ok(());
        }
        let verified = self.ledger.preview_inbound(id, raw, now)?;
        match verified.envelope().body {
            Body::Settle { .. } => {
                self.check_mandate(id, category, now)?;
                self.ledger.accept_buyer_settle(&verified, now)?;
            }
            Body::Receipt { .. } => self.ledger.accept_seller_receipt(&verified, now)?,
            _ => self.receive_haggle(id, raw, category, now)?,
        }
        Ok(())
    }
}
