//! Outbound PayPal call records, countersigned closed mandates and verified receipts.
use crate::mandates::read_mandate;
use crate::repositories::{json_text, read_deal};
use crate::{AuditEntry, Ledger, LedgerError, PaypalCall, audit, redact_paypal};
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::{Value, json};
use table_core::{ClosedMandate, DealId, DealState, H256, Timestamp, invoice_id};
use table_proto::{Body, ProtocolError, VerifiedEnvelope};

impl Ledger {
    pub fn record_paypal_call(
        &mut self,
        call: &PaypalCall,
        sensitive_values: &[&str],
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, call.deal_id)?;
        if deal.state == DealState::Refused {
            return Err(LedgerError::Conflict);
        }
        let response = redact_paypal(&call.response, sensitive_values);
        let debug = call.debug_id.as_ref().and_then(|s| {
            redact_paypal(&json!({"debug_id":s}), sensitive_values)
                .get("debug_id")
                .and_then(Value::as_str)
                .map(str::to_owned)
        });
        if call.request_id.len() > 128
            || !call
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            || sensitive_values.iter().any(|s| {
                !s.is_empty() && (call.request_id.contains(s) || call.path.as_str().contains(s))
            })
        {
            return Err(LedgerError::Integrity("invalid call metadata"));
        }
        let binding = call.binding.as_ref().map(json_text).transpose()?;
        tx.execute("INSERT INTO paypal_calls(deal_id,method,path,request_id,status,debug_id,body_redacted,at,binding_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![call.deal_id.to_string(),call.method.as_str(),call.path.as_str(),call.request_id,call.status,debug,json_text(&response)?,call.at.to_string(),binding])?;
        audit::append(
            &tx,
            &AuditEntry {
                at: call.at,
                actor: "paypal".into(),
                action: "paypal.response".into(),
                deal_id: Some(call.deal_id),
                detail: json!({"status":call.status,"path":call.path.as_str(),"debug_id":debug}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn paypal_call_count(&self, id: DealId) -> Result<u64, LedgerError> {
        crate::count(self.conn.query_row(
            "SELECT COUNT(*) FROM paypal_calls WHERE deal_id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?)
    }
    pub fn countersign(
        &mut self,
        closed: &ClosedMandate,
        attempt: u8,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, closed.deal_id)?;
        let mandate = read_mandate(&tx, deal.mandate_id, deal.mandate_version)?;
        let threshold = mandate
            .payload
            .clauses
            .iter()
            .find_map(|clause| match clause {
                table_core::Clause::HumanPresentOver { amount } => Some(*amount),
                _ => None,
            })
            .ok_or(LedgerError::Conflict)?;
        let payee_allowed=mandate.payload.clauses.iter().any(|clause|matches!(clause,table_core::Clause::Payees{payees} if payees.contains(&closed.payee)));
        let decision_valid = match closed.decided_by {
            table_core::DecidedBy::Policy { clause: 6 } => {
                closed.amount.currency() == threshold.currency()
                    && closed.amount.minor() <= threshold.minor()
            }
            table_core::DecidedBy::Human { at: human_at } => {
                human_at >= mandate.payload.not_before && human_at <= at
            }
            table_core::DecidedBy::SellerMandate { mandate_hash } => {
                deal.side == table_core::Side::Seller
                    && matches!(deal.state, DealState::Approved | DealState::Authorized)
                    && mandate_hash == mandate.payload.hash()?
            }
            table_core::DecidedBy::HouseMandate { mandate_hash } => {
                let release: Option<table_proto::HouseRelease> = tx
                    .query_row(
                        "SELECT value_json FROM local_preferences WHERE key='house.release'",
                        [],
                        |r| r.get::<_, String>(0),
                    )
                    .optional()?
                    .map(|v| serde_json::from_str(&v))
                    .transpose()?;
                if let Some(release) = release {
                    release
                        .verify_mandate(&mandate)
                        .map_err(|_| LedgerError::Conflict)?;
                    deal.side == table_core::Side::Seller
                        && deal.kind == table_core::DealKind::Haggle
                        && release.mandate_commitment == mandate_hash
                        && closed.payee == release.payee
                        && closed.amount.currency() == threshold.currency()
                        && closed.amount.minor() <= threshold.minor()
                } else {
                    false
                }
            }
            _ => false,
        };
        if !payee_allowed
            || !decision_valid
            || at < mandate.payload.not_before
            || at >= mandate.payload.expires
            || !matches!(
                deal.state,
                DealState::Agreed
                    | DealState::Settling
                    | DealState::AwaitingApproval
                    | DealState::Approved
                    | DealState::Authorized
            )
        {
            return Err(LedgerError::Conflict);
        }
        if deal.side == table_core::Side::Buyer {
            let declared: String = tx.query_row(
                "SELECT declared_payee FROM counterparties WHERE key_id=?1",
                [deal.counterparty.as_str()],
                |r| r.get(0),
            )?;
            if declared != closed.payee.as_str() {
                return Err(LedgerError::Conflict);
            }
        }
        if closed.terms_hash != deal.terms.hash()?
            || closed.amount != deal.terms.amount()?
            || closed.open_mandate_hash != mandate.payload.hash()?
            || closed.invoice_id != invoice_id(deal.id, attempt)?
            || deal.state.terminal()
        {
            return Err(LedgerError::Conflict);
        }
        let key = VerifyingKey::from_bytes(&mandate.payload.agent_key)
            .map_err(|_| ProtocolError::Signature)?;
        let sig = Signature::from_slice(&closed.agent_sig).map_err(|_| ProtocolError::Signature)?;
        key.verify_strict(&closed.signing_bytes()?, &sig)
            .map_err(|_| ProtocolError::Signature)?;
        let body = closed.signing_bytes()?;
        let hash = H256::digest(&body);
        let body = String::from_utf8(body).map_err(|_| LedgerError::Integrity("UTF-8"))?;
        tx.execute("INSERT INTO closed_mandates(deal_id,attempt,body_json,body_hash,agent_sig,created_at) VALUES (?1,?2,?3,?4,?5,?6)",params![deal.id.to_string(),attempt,body,&hash.0[..],closed.agent_sig,at.to_string()])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner/policy".into(),
                action: "deal.countersigned".into(),
                deal_id: Some(deal.id),
                detail: json!({"attempt":attempt,"hash":hash,"decided_by":closed.decided_by}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn has_countersign(&self, id: DealId, attempt: u8) -> Result<bool, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM closed_mandates WHERE deal_id=?1 AND attempt=?2)",
            params![id.to_string(), attempt],
            |r| r.get(0),
        )?)
    }
    pub fn record_receipt(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let e = verified.envelope();
        let Body::Receipt {
            capture_id,
            amount,
            status: table_proto::ReceiptStatus::Completed,
            transcript_head,
        } = &e.body
        else {
            return Err(ProtocolError::Body.into());
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, e.deal_id)?;
        if !matches!(
            deal.state,
            DealState::Approved
                | DealState::Authorized
                | DealState::Captured
                | DealState::Receipted
        ) || *amount != deal.terms.amount()?
            || *transcript_head != e.prev
            || deal.transcript_head != verified.hash()
        {
            return Err(LedgerError::Conflict);
        }
        let exists: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM envelopes WHERE deal_id=?1 AND hash=?2 AND verified=1)",
            params![e.deal_id.to_string(), &verified.hash().0[..]],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(LedgerError::Conflict);
        }
        tx.execute("INSERT INTO receipts(deal_id,capture_id,amount_minor,issuer_key,raw_jws,transcript_head,verified_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![e.deal_id.to_string(),capture_id.as_str(),amount.minor(),e.iss.as_str(),verified.raw(),&transcript_head.0[..],at.to_string()])?;
        tx.execute("UPDATE deals SET receipt_evidence='paypal_verified',reconciliation='pending_reporting' WHERE id=?1 AND side='seller' AND EXISTS(SELECT 1 FROM operations o WHERE o.deal_id=?1 AND o.operation='capture' AND (o.status='confirmed' OR EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.request_id=o.request_id AND r.outcome='confirmed')))",[e.deal_id.to_string()])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: format!("peer:{}", e.iss),
                action: "receipt.verified".into(),
                deal_id: Some(e.deal_id),
                detail: json!({"capture_id":capture_id.as_str(),"transcript_head":transcript_head}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
