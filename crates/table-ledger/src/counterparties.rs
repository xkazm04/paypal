use crate::repositories::enum_text;
use crate::{AuditEntry, Ledger, LedgerError, audit};
use ed25519_dalek::VerifyingKey;
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use table_core::{H256, KeyId, PayeeRef, Timestamp};
use table_proto::{ProtocolError, key_id};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PairedVia {
    Code,
    House,
    Local,
}
#[derive(Debug, Clone)]
pub struct Counterparty {
    pub key_id: KeyId,
    pub owner_key: [u8; 32],
    pub agent_key: [u8; 32],
    pub display_name: table_proto::ShortText<32>,
    pub paired_via: PairedVia,
    pub words_confirmed_at: Option<Timestamp>,
    pub declared_payee: PayeeRef,
    pub first_seen: Timestamp,
}
impl Ledger {
    pub fn counterparty_policy(&self, key: &KeyId) -> Result<(bool, bool, PayeeRef), LedgerError> {
        // An unknown key is `NotFound`, not a ledger fault (scan J-5).
        let (confirmed,via,payee):(Option<String>,String,String)=self.conn.query_row("SELECT words_confirmed_at,paired_via,declared_payee FROM counterparties WHERE key_id=?1",[key.as_str()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional()?.ok_or(LedgerError::NotFound)?;
        Ok((
            confirmed.is_some(),
            via == "house",
            PayeeRef::new(payee).map_err(|_| LedgerError::Integrity("payee"))?,
        ))
    }
    pub fn counterparty_first_seen(&self, key: &KeyId) -> Result<Timestamp, LedgerError> {
        let at: String = self
            .conn
            .query_row(
                "SELECT first_seen FROM counterparties WHERE key_id=?1",
                [key.as_str()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        at.parse()
            .map_err(|_| LedgerError::Integrity("counterparty timestamp"))
    }
    pub fn insert_counterparty(&mut self, cp: &Counterparty) -> Result<(), LedgerError> {
        self.insert_counterparty_mailbox(cp, None)
    }
    pub fn insert_paired_counterparty(
        &mut self,
        cp: &Counterparty,
        code_hash: H256,
    ) -> Result<(), LedgerError> {
        self.insert_counterparty_mailbox(cp, Some(code_hash))
    }
    fn insert_counterparty_mailbox(
        &mut self,
        cp: &Counterparty,
        code_hash: Option<H256>,
    ) -> Result<(), LedgerError> {
        let key = VerifyingKey::from_bytes(&cp.agent_key).map_err(|_| ProtocolError::Signature)?;
        VerifyingKey::from_bytes(&cp.owner_key).map_err(|_| ProtocolError::Signature)?;
        if key_id(&key)? != cp.key_id {
            return Err(ProtocolError::Binding.into());
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO counterparties(key_id,owner_pubkey,agent_pubkey,display_name,paired_via,words_confirmed_at,declared_payee,first_seen) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",params![cp.key_id.as_str(),&cp.owner_key[..],&cp.agent_key[..],cp.display_name.as_str(),enum_text(&cp.paired_via)?,cp.words_confirmed_at.map(|v|v.to_string()),cp.declared_payee.as_str(),cp.first_seen.to_string()])?;
        if let Some(hash) = code_hash {
            tx.execute(
                "INSERT INTO pairing_mailboxes(counterparty,code_hash) VALUES (?1,?2)",
                params![cp.key_id.as_str(), &hash.0[..]],
            )?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                at: cp.first_seen,
                actor: "owner".into(),
                action: "counterparty.pinned".into(),
                deal_id: None,
                detail: json!({"key_id":cp.key_id,"paired_via":cp.paired_via}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
