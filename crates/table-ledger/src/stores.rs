//! Store interfaces over the ledger, so application tests can swap in in-memory stores.
use crate::{AuditEntry, Ledger, LedgerError, PaypalCall};
use ed25519_dalek::VerifyingKey;
use table_core::{ClosedMandate, Deal, DealEvent, DealId, H256, MandateId, OpenMandate, Timestamp};
use table_proto::VerifiedEnvelope;

/// Application tests can implement these interfaces with in-memory stores.
pub trait DealStore {
    fn get_deal(&self, id: DealId) -> Result<Deal, LedgerError>;
    fn create_deal(&mut self, deal: &Deal, at: Timestamp) -> Result<(), LedgerError>;
    fn apply_event(
        &mut self,
        id: DealId,
        event: DealEvent,
        at: Timestamp,
    ) -> Result<(), LedgerError>;
}
pub trait MandateStore {
    fn active_mandate(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError>;
    fn insert_mandate(
        &mut self,
        mandate: &OpenMandate,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<(), LedgerError>;
    fn revoke_mandate(&mut self, id: MandateId, at: Timestamp) -> Result<(), LedgerError>;
}
impl MandateStore for Ledger {
    fn active_mandate(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError> {
        Ledger::active_mandate(self, id, version, owner)
    }
    fn insert_mandate(
        &mut self,
        mandate: &OpenMandate,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        Ledger::insert_mandate(self, mandate, owner, at)
    }
    fn revoke_mandate(&mut self, id: MandateId, at: Timestamp) -> Result<(), LedgerError> {
        Ledger::revoke_mandate(self, id, at)
    }
}
pub trait EvidenceStore {
    fn append_audit(&mut self, entry: &AuditEntry) -> Result<H256, LedgerError>;
    fn record_paypal_call(
        &mut self,
        call: &PaypalCall,
        sensitive_values: &[&str],
    ) -> Result<(), LedgerError>;
    fn has_countersign(&self, id: DealId, attempt: u8) -> Result<bool, LedgerError>;
    fn countersign(
        &mut self,
        closed: &ClosedMandate,
        attempt: u8,
        at: Timestamp,
    ) -> Result<(), LedgerError>;
    fn receive(
        &mut self,
        id: DealId,
        raw: &str,
        at: Timestamp,
    ) -> Result<VerifiedEnvelope, LedgerError>;
    fn record_outbound(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError>;
    fn record_receipt(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError>;
}
impl EvidenceStore for Ledger {
    fn append_audit(&mut self, entry: &AuditEntry) -> Result<H256, LedgerError> {
        Ledger::append_audit(self, entry)
    }
    fn record_paypal_call(
        &mut self,
        call: &PaypalCall,
        sensitive_values: &[&str],
    ) -> Result<(), LedgerError> {
        Ledger::record_paypal_call(self, call, sensitive_values)
    }
    fn has_countersign(&self, id: DealId, attempt: u8) -> Result<bool, LedgerError> {
        Ledger::has_countersign(self, id, attempt)
    }
    fn countersign(
        &mut self,
        closed: &ClosedMandate,
        attempt: u8,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        Ledger::countersign(self, closed, attempt, at)
    }
    fn receive(
        &mut self,
        id: DealId,
        raw: &str,
        at: Timestamp,
    ) -> Result<VerifiedEnvelope, LedgerError> {
        Ledger::receive(self, id, raw, at)
    }
    fn record_outbound(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        Ledger::record_outbound(self, verified, at)
    }
    fn record_receipt(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        Ledger::record_receipt(self, verified, at)
    }
}
impl DealStore for Ledger {
    fn get_deal(&self, id: DealId) -> Result<Deal, LedgerError> {
        Ledger::get_deal(self, id)
    }
    fn create_deal(&mut self, deal: &Deal, at: Timestamp) -> Result<(), LedgerError> {
        Ledger::create_deal(self, deal, at)
    }
    fn apply_event(
        &mut self,
        id: DealId,
        event: DealEvent,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        Ledger::apply_event(self, id, event, at)
    }
}
