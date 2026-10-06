//! Typed negotiation inspection and refusal evidence for the deterministic hosted seller.
use crate::{AuditEntry, Direction, Ledger, LedgerError, audit, repositories::append_verified};
use rusqlite::{OptionalExtension, TransactionBehavior};
use table_core::{DealId, DealState, H256, Timestamp};
use table_proto::{Body, VerifiedEnvelope};

#[derive(Debug)]
pub struct NegotiationStatus {
    pub offer_seq: u32,
    pub own_accept: bool,
}
impl Ledger {
    pub fn negotiation_rounds(&self, id: DealId) -> Result<u32, LedgerError> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM envelopes WHERE deal_id=?1 AND dir='out' AND typ IN ('OFFER','COUNTER')",[id.to_string()],|r|r.get(0))?)
    }
    /// Reservations still holding seller capacity: a request whose deal is missing or has not
    /// left the pre-capture states. Finished negotiations release their slot.
    pub fn house_open_request_count(&self) -> Result<u32, LedgerError> {
        let mut statement = self
            .conn
            .prepare("SELECT value_json FROM local_preferences WHERE key LIKE 'house.request.%'")?;
        let rows = statement.query_map([], |r| r.get::<_, String>(0))?;
        let mut open = 0;
        for raw in rows {
            let id: DealId = serde_json::from_str(&raw?)?;
            match self.get_deal(id) {
                Ok(deal) if !deal.state.pre_capture() => {}
                Ok(_) | Err(LedgerError::NotFound) => open += 1,
                Err(e) => return Err(e),
            }
        }
        Ok(open)
    }
    pub fn last_message(&self, id: DealId) -> Result<Option<(Direction, Body)>, LedgerError> {
        use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
        let row: Option<(String,String)> = self.conn.query_row("SELECT dir,raw_jws FROM envelopes WHERE deal_id=?1 AND verified=1 ORDER BY rowid DESC LIMIT 1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        row.map(|(dir, raw)| {
            let bytes = URL_SAFE_NO_PAD
                .decode(
                    raw.split('.')
                        .nth(1)
                        .ok_or(LedgerError::Integrity("envelope shape"))?,
                )
                .map_err(|_| LedgerError::Integrity("envelope encoding"))?;
            let e: table_proto::Envelope = serde_json::from_slice(&bytes)?;
            Ok((
                if dir == "in" {
                    Direction::Inbound
                } else {
                    Direction::Outbound
                },
                e.body,
            ))
        })
        .transpose()
    }
    pub fn negotiation_status(&self, id: DealId) -> Result<Option<NegotiationStatus>, LedgerError> {
        Ok(self
            .conn
            .query_row(
                "SELECT offer_seq,own_accept FROM negotiation WHERE deal_id=?1",
                [id.to_string()],
                |r| {
                    Ok(NegotiationStatus {
                        offer_seq: r.get(0)?,
                        own_accept: r.get(1)?,
                    })
                },
            )
            .optional()?)
    }
    /// A declined inbound proposal advances only signed history; it cannot become accepted terms.
    pub fn record_declined_offer(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let id = verified.envelope().deal_id;
        if !matches!(verified.envelope().body, Body::Offer { .. })
            || !matches!(
                self.get_deal(id)?.state,
                DealState::Listed | DealState::Negotiating
            )
        {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        append_verified(&tx, verified, Direction::Inbound, at)?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "offer.declined".into(),
                deal_id: Some(id),
                detail: serde_json::json!({"hash":verified.hash(),"reason":"outside seller band"}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn peer_offer_count(&self, id: DealId) -> Result<u32, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM envelopes WHERE deal_id=?1 AND typ='OFFER' AND dir='in'",
            [id.to_string()],
            |r| r.get(0),
        )?)
    }
    pub fn counterparty_binding(
        &self,
        key: &table_core::KeyId,
    ) -> Result<Option<(H256, [u8; 32], table_core::PayeeRef)>, LedgerError> {
        let row: Option<(Vec<u8>,Vec<u8>,String)> = self.conn.query_row("SELECT m.code_hash,c.owner_pubkey,c.declared_payee FROM pairing_mailboxes m JOIN counterparties c ON c.key_id=m.counterparty WHERE m.counterparty=?1",[key.as_str()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?;
        row.map(|(hash, owner, payee)| {
            Ok((
                crate::hash_blob(hash)?,
                owner
                    .try_into()
                    .map_err(|_| LedgerError::Integrity("owner key"))?,
                table_core::PayeeRef::new(payee).map_err(|_| LedgerError::Integrity("payee"))?,
            ))
        })
        .transpose()
    }
    pub fn house_request(&self, request: H256) -> Result<Option<DealId>, LedgerError> {
        self.preference(&format!("house.request.{}", request.hex()))
    }
    pub fn reserve_house_request(&mut self, request: H256, id: DealId) -> Result<(), LedgerError> {
        self.set_preference(&format!("house.request.{}", request.hex()), &id)
    }
}
