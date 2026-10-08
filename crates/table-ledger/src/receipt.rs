//! Atomic buyer acceptance of signed seller evidence; this never creates a PayPal observation.
use crate::{
    AuditEntry, Direction, Ledger, LedgerError, audit,
    repositories::{append_verified, apply, read_deal},
};
use rusqlite::{Connection, TransactionBehavior, params};
use table_core::*;
use table_proto::{Body, ReceiptStatus, VerifiedEnvelope};
// Same local identifier policy as table-paypal::ResourceId. Peer prose must not
// enter Deal.paypal (which is part of the closed engine projection).
fn paypal_identifier(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 127
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}
fn paired_via_house(conn: &Connection, deal: &Deal) -> Result<bool, LedgerError> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM counterparties WHERE key_id=?1 AND paired_via='house')",
        [deal.counterparty.as_str()],
        |r| r.get(0),
    )?)
}
/// How long past its recorded deadline a deal waits before the safe default lets it lapse.
/// Zero, except for a buyer deal paired with the HOUSE whose order is out for approval: the
/// HOUSE may see the approval in the last seconds of its window and then authorize, capture and
/// relay its RECEIPT, so this wallet waits [`HOUSE_RECEIPT_GRACE_SECS`] more for it. The recorded
/// deadline (the person's approval countdown) is unchanged; waiting moves no money.
pub(crate) fn lapse_grace(conn: &Connection, deal: &Deal) -> Result<i64, LedgerError> {
    let awaiting = deal.side == Side::Buyer
        && matches!(
            deal.state,
            DealState::AwaitingApproval | DealState::Approved
        );
    Ok(if awaiting && paired_via_house(conn, deal)? {
        HOUSE_RECEIPT_GRACE_SECS
    } else {
        0
    })
}
impl Ledger {
    /// When the deal's safe default applies: its recorded deadline plus [`lapse_grace`]; `None`
    /// when the deal has no deadline.
    pub fn lapse_at(&self, id: DealId) -> Result<Option<Timestamp>, LedgerError> {
        let Some((due, _)) = self.deadline(id)? else {
            return Ok(None);
        };
        let deal = read_deal(&self.conn, id)?;
        Ok(Some(due.saturating_add(lapse_grace(&self.conn, &deal)?)))
    }
    pub fn accept_buyer_settle(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let e = verified.envelope();
        let Body::Settle {
            order_id, attempt, ..
        } = &e.body
        else {
            return Err(LedgerError::Conflict);
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, e.deal_id)?;
        if deal.side != Side::Buyer
            || !matches!(deal.kind, DealKind::Haggle | DealKind::ShopOrder)
            || deal.state != DealState::Agreed
            || deal.mode != Mode::Sandbox
        {
            return Err(LedgerError::Conflict);
        }
        if !paypal_identifier(order_id.as_str())
            || table_proto::validate_settle(&e.body, deal.id, &deal.terms, deal.mode).is_err()
        {
            tx.execute(
                // A raised HOLD with no rule (a mismatch is never released); a BLOCK stays.
                "UPDATE deals SET shield_verdict=CASE WHEN shield_verdict='BLOCK' THEN 'BLOCK' ELSE 'HOLD' END,shield_rule=CASE WHEN shield_verdict='BLOCK' THEN shield_rule END,shield_terms=CASE WHEN shield_verdict='BLOCK' THEN shield_terms END,shield_release_json=NULL WHERE id=?1",
                [deal.id.to_string()],
            )?;
            apply(&tx, deal.id, DealEvent::Mismatch, at)?;
            audit::append(
                &tx,
                &AuditEntry {
                    at,
                    actor: format!("peer:{}", e.iss),
                    action: "settlement.rejected".into(),
                    deal_id: Some(deal.id),
                    detail: serde_json::json!({"raw_hash":verified.hash(),"reason":"settlement truth mismatch"}),
                },
            )?;
            tx.commit()?;
            return Err(LedgerError::Conflict);
        }
        append_verified(&tx, verified, Direction::Inbound, at)?;
        tx.execute(
            "UPDATE deals SET pp_order_id=?1,attempt=?2 WHERE id=?3",
            params![order_id.as_str(), attempt, deal.id.to_string()],
        )?;
        apply(&tx, deal.id, DealEvent::BeginSettlement, at)?;
        apply(&tx, deal.id, DealEvent::SettleVerified, at)?;
        // A seller paired through the HOUSE release pin lets its order lapse sooner
        // (HOUSE_APPROVAL_SECS), so this wallet's countdown matches the seller's.
        let window = if paired_via_house(&tx, &deal)? {
            HOUSE_APPROVAL_SECS
        } else {
            ORDER_APPROVAL_SECS
        };
        tx.execute("INSERT INTO deadlines(deal_id,due_at) VALUES (?1,?2) ON CONFLICT(deal_id) DO UPDATE SET due_at=excluded.due_at",params![deal.id.to_string(),e.iat.saturating_add(window)])?;
        tx.commit()?;
        Ok(())
    }
    pub fn accept_seller_receipt(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let e = verified.envelope();
        let Body::Receipt {
            capture_id,
            amount,
            status: ReceiptStatus::Completed,
            transcript_head,
        } = &e.body
        else {
            return Err(LedgerError::Conflict);
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, e.deal_id)?;
        if deal.side != Side::Buyer
            || !matches!(deal.kind, DealKind::Haggle | DealKind::ShopOrder)
            || deal.mode != Mode::Sandbox
            || !matches!(
                deal.state,
                DealState::AwaitingApproval | DealState::Approved
            )
            || deal.paypal.order.is_none()
            || !paypal_identifier(capture_id.as_str())
            || *amount != deal.terms.amount()?
            || *transcript_head != e.prev
        {
            return Err(LedgerError::Conflict);
        }
        append_verified(&tx, verified, Direction::Inbound, at)?;
        tx.execute("INSERT INTO receipts(deal_id,capture_id,amount_minor,issuer_key,raw_jws,transcript_head,verified_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![deal.id.to_string(),capture_id.as_str(),amount.minor(),e.iss.as_str(),verified.raw(),&transcript_head.0[..],at.to_string()])?;
        tx.execute("UPDATE deals SET pp_capture_id=?1,receipt_evidence='seller_attested',reconciliation='pending_reporting' WHERE id=?2",params![capture_id.as_str(),deal.id.to_string()])?;
        apply(&tx, deal.id, DealEvent::SellerReceiptVerified, at)?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: format!("peer:{}", e.iss),
                action: "receipt.seller_attested".into(),
                deal_id: Some(deal.id),
                detail: serde_json::json!({"capture_id":capture_id.as_str(),"transcript_head":transcript_head}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn deal_evidence(&self, id: DealId) -> Result<DealEvidence, LedgerError> {
        let (receipt, reconciliation): (String, String) = self.conn.query_row(
            "SELECT receipt_evidence,reconciliation FROM deals WHERE id=?1",
            [id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(DealEvidence {
            deal_id: id,
            receipt: match receipt.as_str() {
                "none" => ReceiptEvidence::None,
                "seller_attested" => ReceiptEvidence::SellerAttested,
                "paypal_verified" => ReceiptEvidence::PaypalVerified,
                _ => return Err(LedgerError::Integrity("receipt evidence")),
            },
            reconciliation: match reconciliation.as_str() {
                "n/a" => Reconciliation::NotApplicable,
                "pending_reporting" => Reconciliation::PendingReporting,
                "matched" => Reconciliation::Matched,
                "mismatch" => Reconciliation::Mismatch,
                _ => return Err(LedgerError::Integrity("reconciliation")),
            },
            money_check: self.money_check(id)?,
            house_record: self.house_record(id)?,
        })
    }
    /// Only own-account reporting can promote seller attestation. This grants no payment authority.
    pub fn confirm_reporting(
        &mut self,
        id: DealId,
        capture: &str,
        amount: Money,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, id)?;
        if deal.state != DealState::Receipted
            || deal.mode != Mode::Sandbox
            || deal.paypal.capture.as_deref() != Some(capture)
        {
            return Err(LedgerError::Conflict);
        }
        let mut query=tx.prepare("SELECT body_redacted FROM paypal_calls WHERE deal_id=?1 AND method='GET' AND status=200 AND path='/v1/reporting/transactions' ORDER BY id DESC")?;
        let bodies = query
            .query_map([id.to_string()], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let proven = bodies.iter().any(|text| {
            let Ok(body) = serde_json::from_str::<serde_json::Value>(text) else {
                return false;
            };
            body.get("transaction_details")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|rows| {
                    rows.iter().any(|row| {
                        let info = &row["transaction_info"];
                        let lexical = info["transaction_amount"]["value"].as_str().unwrap_or("");
                        let value = if deal.side == Side::Buyer {
                            lexical.strip_prefix('-').unwrap_or("")
                        } else {
                            lexical
                        };
                        let currency = serde_json::from_value::<Currency>(
                            info["transaction_amount"]["currency_code"].clone(),
                        )
                        .ok();
                        info["transaction_id"].as_str() == Some(capture)
                            && info["transaction_status"].as_str() == Some("S")
                            && currency.is_some_and(|c| Money::parse(value, c).ok() == Some(amount))
                    })
                })
        });
        drop(query);
        if !proven {
            return Err(LedgerError::Conflict);
        }
        let matched = deal.terms.amount()? == amount;
        tx.execute("UPDATE deals SET reconciliation=?1,receipt_evidence=CASE WHEN ?2 THEN 'paypal_verified' ELSE receipt_evidence END,updated_at=?4 WHERE id=?3",params![if matched {"matched"}else{"mismatch"},matched,id.to_string(),at.to_string()])?;
        if matched {
            apply(&tx, id, DealEvent::ReportingMatched, at)?;
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "paypal-reporting".into(),
                action: "receipt.reconciled".into(),
                deal_id: Some(id),
                detail: serde_json::json!({"capture_id":capture,"amount":amount,"matched":matched}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
}
