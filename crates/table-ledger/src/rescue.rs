//! Subscription rescue, one lever (DECISIONS 13): the row a failed renewal leaves, the deal it
//! opens, and the receipt for a rescue invoice PayPal shows PAID.
//!
//! Recovered money is counted here and nowhere else: a rescue deal whose failure PayPal itself
//! reported (`source = paypal`, mode SANDBOX), whose invoice was sent under a confirmed operation,
//! read back PAID and receipted. A replayed failure, an invoice only sent, or a status the owner
//! marked by hand never counts.
use crate::repositories::{append_verified, apply, insert_deal, json_text, read_deal};
use crate::{AuditEntry, Ledger, LedgerError, audit};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use table_core::{
    Category, Currency, Deal, DealEvent, DealId, DealKind, DealState, DecidedBy, KeyId, Mode,
    Money, PayeeRef, RescueOffer, RescueSource, Side, Timestamp,
};
use table_proto::{Body, ReceiptStatus, VerifiedEnvelope};

/// The subscriber's email address, which the rescue invoice is addressed to. It is kept in the
/// rescue row only: never printed, logged, audited or shown in full.
#[derive(Clone, PartialEq, Eq)]
pub struct Recipient(String);
impl std::fmt::Debug for Recipient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Recipient([REDACTED])")
    }
}
impl Recipient {
    pub fn new(email: impl Into<String>) -> Result<Self, LedgerError> {
        let email = email.into();
        let ok = email.len() <= 254
            && email.matches('@').count() == 1
            && email.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty()
                    && domain.contains('.')
                    && !domain.starts_with('.')
                    && !domain.ends_with('.')
            })
            && email
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"@.-_+".contains(&b));
        if !ok {
            return Err(LedgerError::Conflict);
        }
        Ok(Self(email))
    }
    pub fn expose(&self) -> &str {
        &self.0
    }
    /// The first letter, a mask and the domain: what the approval window shows.
    pub fn masked(&self) -> String {
        let (local, domain) = self.0.split_once('@').unwrap_or(("", ""));
        let first = local.chars().next().map(String::from).unwrap_or_default();
        format!("{first}•••@{domain}")
    }
}

/// A failed renewal and the one fix the wallet offered for it, as written with the deal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RescueCase {
    pub source: RescueSource,
    /// PayPal's subscription id (a resource id, never shown as the subscriber's name).
    pub subscription_id: String,
    pub recipient: Recipient,
    pub offer: RescueOffer,
    pub failed_payments: u32,
    /// When the renewal failed. One fix per subscriber per cycle: per UTC day of this time.
    pub failed_at: Timestamp,
    /// PayPal's own next retry, when known.
    pub next_retry_at: Option<Timestamp>,
}

/// A PayPal subscription id as the wallet accepts it: 1-64 letters, digits, `-` or `_`.
pub fn valid_subscription_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
}

/// The key a subscriber's rescue deals are filed under. A subscriber has no wallet: this is no
/// key anyone signs with, and `:` never occurs in a hex wallet key id.
pub fn subscriber_key(subscription_id: &str) -> Result<KeyId, LedgerError> {
    if !valid_subscription_id(subscription_id) {
        return Err(LedgerError::Conflict);
    }
    KeyId::new(format!("sub:{subscription_id}")).map_err(|_| LedgerError::Conflict)
}

const SOURCE_REPLAY: &str = "replay";
const SOURCE_PAYPAL: &str = "paypal";
const fn source_text(source: RescueSource) -> &'static str {
    match source {
        RescueSource::Replay => SOURCE_REPLAY,
        RescueSource::Paypal => SOURCE_PAYPAL,
    }
}

/// The recovered-money predicate, over `deals d` (the one place it is written).
pub(crate) const COUNTED: &str = "d.kind='rescue' AND d.mode='sandbox' AND d.state IN ('RECEIPTED','RECONCILED') AND d.receipt_evidence='paypal_verified' AND EXISTS(SELECT 1 FROM rescue_cases c WHERE c.deal_id=d.id AND c.source='paypal') AND EXISTS(SELECT 1 FROM receipts r WHERE r.deal_id=d.id AND r.verified_at IS NOT NULL AND r.capture_id=d.pp_order_id) AND EXISTS(SELECT 1 FROM operations o WHERE o.deal_id=d.id AND o.operation='invoice-send' AND o.status='confirmed')";

impl Ledger {
    /// Write a failed renewal and the rescue deal it opens, in one transaction: the subscriber's
    /// filing key, the deal (PAIRING, then AGREED on `RescueOpened`), its category, the rescue row
    /// and its deadline (PayPal's next retry: silence lets it lapse and PayPal retries by itself).
    /// The caller has run the mandate check and `check_offer` on exactly this deal.
    #[allow(clippy::too_many_arguments)] // One atomic write of every fact the deal starts with.
    pub fn open_rescue(
        &mut self,
        deal: &Deal,
        case: &RescueCase,
        payee: &PayeeRef,
        category: Category,
        due: Timestamp,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let mode = match case.source {
            RescueSource::Replay => Mode::Replay,
            RescueSource::Paypal => Mode::Sandbox,
        };
        if deal.kind != DealKind::Rescue
            || deal.side != Side::Seller
            || deal.mode != mode
            || deal.counterparty != subscriber_key(&case.subscription_id)?
            || deal.terms.qty != 1
            || deal.terms.unit_price != case.offer.invoice
            || case.failed_payments == 0
            || due <= at
        {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let live: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM rescue_cases c JOIN deals d ON d.id=c.deal_id WHERE c.subscription_id=?1 AND d.state IN ('PAIRING','AGREED','SETTLING','AWAITING_APPROVAL'))",
            [case.subscription_id.as_str()],
            |r| r.get(0),
        )?;
        if live {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "INSERT OR IGNORE INTO counterparties(key_id,owner_pubkey,agent_pubkey,display_name,paired_via,words_confirmed_at,declared_payee,first_seen) VALUES (?1,zeroblob(32),zeroblob(32),NULL,'local',NULL,?2,?3)",
            params![deal.counterparty.as_str(), payee.as_str(), at.to_string()],
        )?;
        insert_deal(&tx, deal, at)?;
        tx.execute(
            "INSERT INTO deal_context(deal_id,category_json) VALUES(?1,?2)",
            params![deal.id.to_string(), json_text(&category)?],
        )?;
        let inserted = tx.execute(
            "INSERT OR IGNORE INTO rescue_cases(deal_id,source,subscription_id,recipient,offer_json,failed_payments,failed_on,next_retry_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                deal.id.to_string(),
                source_text(case.source),
                case.subscription_id,
                case.recipient.expose(),
                json_text(&case.offer)?,
                case.failed_payments,
                case.failed_at.div_euclid(86400),
                case.next_retry_at
            ],
        )?;
        // The same subscriber already had a fix for this cycle.
        if inserted != 1 {
            return Err(LedgerError::Conflict);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "rescue.opened".into(),
                deal_id: Some(deal.id),
                detail: json!({
                    "source": case.source,
                    "lever": case.offer.lever,
                    "cycle": case.offer.cycle,
                    "discount": case.offer.discount,
                    "invoice": case.offer.invoice,
                    "failed_payments": case.failed_payments,
                    "next_retry_at": case.next_retry_at,
                }),
            },
        )?;
        apply(&tx, deal.id, DealEvent::RescueOpened, at)?;
        tx.execute(
            "INSERT INTO deadlines(deal_id,due_at,authorization_at) VALUES (?1,?2,NULL)",
            params![deal.id.to_string(), due],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "deadline.set".into(),
                deal_id: Some(deal.id),
                detail: json!({"due_at":due,"authorization_at":null}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }

    /// The rescue row of a deal; `None` for a deal that is not a rescue.
    pub fn rescue_case(&self, id: DealId) -> Result<Option<RescueCase>, LedgerError> {
        type Row = (String, String, String, String, u32, i64, Option<i64>);
        let row: Option<Row> = self
            .conn
            .query_row(
                "SELECT source,subscription_id,recipient,offer_json,failed_payments,failed_on,next_retry_at FROM rescue_cases WHERE deal_id=?1",
                [id.to_string()],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                    ))
                },
            )
            .optional()?;
        let Some((source, subscription_id, recipient, offer, failed_payments, failed_on, next)) =
            row
        else {
            return Ok(None);
        };
        let raw = offer;
        let offer: RescueOffer = serde_json::from_str(&raw)?;
        if json_text(&offer)? != raw {
            return Err(LedgerError::Integrity("stored rescue offer"));
        }
        Ok(Some(RescueCase {
            source: match source.as_str() {
                SOURCE_REPLAY => RescueSource::Replay,
                SOURCE_PAYPAL => RescueSource::Paypal,
                _ => return Err(LedgerError::Integrity("rescue source")),
            },
            subscription_id,
            recipient: Recipient::new(recipient)
                .map_err(|_| LedgerError::Integrity("rescue recipient"))?,
            offer,
            failed_payments,
            failed_at: failed_on.saturating_mul(86400),
            next_retry_at: next,
        }))
    }

    /// PayPal shows the rescue invoice PAID for exactly the deal's amount: record the wallet's
    /// signed receipt and move the deal to RECEIPTED, in one transaction. Only after the send was
    /// confirmed, and only for the invoice the deal recorded. A replayed failure is receipted too,
    /// but never counts as recovered.
    pub fn record_rescue_paid(
        &mut self,
        receipt: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let e = receipt.envelope();
        let Body::Receipt {
            capture_id,
            amount,
            status: ReceiptStatus::Completed,
            transcript_head,
        } = &e.body
        else {
            return Err(table_proto::ProtocolError::Body.into());
        };
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, e.deal_id)?;
        let sent: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM operations WHERE deal_id=?1 AND operation='invoice-send' AND status='confirmed')",
            [deal.id.to_string()],
            |r| r.get(0),
        )?;
        if deal.kind != DealKind::Rescue
            || deal.state != DealState::AwaitingApproval
            || deal.paypal.order.as_deref() != Some(capture_id.as_str())
            || *amount != deal.terms.amount()?
            || *transcript_head != e.prev
            || !sent
        {
            return Err(LedgerError::Conflict);
        }
        append_verified(&tx, receipt, crate::Direction::Outbound, at)?;
        tx.execute("INSERT INTO receipts(deal_id,capture_id,amount_minor,issuer_key,raw_jws,transcript_head,verified_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",params![deal.id.to_string(),capture_id.as_str(),amount.minor(),e.iss.as_str(),receipt.raw(),&transcript_head.0[..],at.to_string()])?;
        tx.execute(
            "UPDATE deals SET receipt_evidence='paypal_verified' WHERE id=?1",
            [deal.id.to_string()],
        )?;
        let source: String = tx.query_row(
            "SELECT source FROM rescue_cases WHERE deal_id=?1",
            [deal.id.to_string()],
            |r| r.get(0),
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "paypal".into(),
                action: "rescue.paid".into(),
                deal_id: Some(deal.id),
                detail: json!({
                    "invoice_id": capture_id.as_str(),
                    "amount": amount,
                    "mode": deal.mode,
                    "counted": deal.mode == Mode::Sandbox && source == SOURCE_PAYPAL,
                }),
            },
        )?;
        apply(&tx, deal.id, DealEvent::SellerReceiptVerified, at)?;
        tx.commit()?;
        Ok(())
    }

    /// Whether this deal's money counts as recovered (see the module note).
    pub fn rescue_counted(&self, id: DealId) -> Result<bool, LedgerError> {
        Ok(self.conn.query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM deals d WHERE d.id=?1 AND {COUNTED})"),
            [id.to_string()],
            |r| r.get(0),
        )?)
    }

    /// Recovered money, one total per currency (never summed across currencies).
    pub fn rescue_recovered(&self) -> Result<Vec<Money>, LedgerError> {
        let mut q = self.conn.prepare(&format!(
            "SELECT d.currency,SUM(d.qty*d.unit_price_minor) FROM deals d WHERE {COUNTED} GROUP BY d.currency ORDER BY d.currency"
        ))?;
        let rows = q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter()
            .map(|(currency, minor)| {
                let currency: Currency =
                    serde_json::from_value(serde_json::Value::String(currency))?;
                Ok(Money::new(minor, currency).map_err(table_core::DomainError::from)?)
            })
            .collect()
    }

    /// The decided_by the rescue invoice was created under, if it was.
    pub fn rescue_decision(&self, id: DealId) -> Result<Option<DecidedBy>, LedgerError> {
        let text: Option<String> = self
            .conn
            .query_row(
                "SELECT decided_by FROM operations WHERE deal_id=?1 AND operation='invoice-create'",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        text.map(|t| serde_json::from_str(&t).map_err(Into::into))
            .transpose()
    }
}
