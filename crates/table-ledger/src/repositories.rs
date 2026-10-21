use crate::mandates::{read_mandate, read_mandate_evidence};
use crate::{AuditEntry, Ledger, LedgerError, PaypalCall, audit, hash_blob, redact_paypal};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use table_core::{
    Currency, Deal, DealEvent, DealId, DealState, DecidedBy, Delivery, H256, KeyId, Money,
    OpenMandate, PaypalRefs, Refusal, ShieldVerdict, Terms, Timestamp, canonical_bytes, transition,
};
use table_proto::{Body, ProtocolError};

/// An active mandate as the owner's list shows it. `refusal` is set when the signed policy no
/// longer passes `validate()`: it needs signing again or withdrawing, and nothing acts under it.
#[derive(Debug, Clone)]
pub struct ListedMandate {
    pub mandate: OpenMandate,
    pub refusal: Option<Refusal>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Inbound,
    Outbound,
}
impl Direction {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Inbound => "in",
            Self::Outbound => "out",
        }
    }
}
pub(crate) fn enum_text<T: Serialize>(value: &T) -> Result<String, LedgerError> {
    serde_json::to_value(value)?
        .as_str()
        .map(str::to_owned)
        .ok_or(LedgerError::Integrity("enum representation"))
}
pub(crate) fn parse_enum<T: for<'de> Deserialize<'de>>(value: String) -> Result<T, LedgerError> {
    Ok(serde_json::from_value(Value::String(value))?)
}
pub(crate) fn json_text<T: Serialize>(value: &T) -> Result<String, LedgerError> {
    String::from_utf8(canonical_bytes(value)?).map_err(|_| LedgerError::Integrity("UTF-8"))
}

pub(crate) fn read_deal(conn: &Connection, id: DealId) -> Result<Deal, LedgerError> {
    let row=conn.query_row("SELECT kind,side,counterparty,mandate_id,mandate_version,item_ref,qty,unit_price_minor,currency,delivery,state,terms_hash,transcript_head,pp_order_id,pp_authorization_id,pp_capture_id,pp_subscription_id,mode,market_json,shield_verdict,created_at,updated_at,decided_by,shield_rule,shield_terms,shield_release_json FROM deals WHERE id=?1",[id.to_string()],|r|{
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,u32>(4)?,r.get::<_,String>(5)?,r.get::<_,u32>(6)?,r.get::<_,i64>(7)?,r.get::<_,String>(8)?,r.get::<_,String>(9)?,r.get::<_,String>(10)?,r.get::<_,Vec<u8>>(11)?,r.get::<_,Vec<u8>>(12)?,r.get::<_,Option<String>>(13)?,r.get::<_,Option<String>>(14)?,r.get::<_,Option<String>>(15)?,r.get::<_,Option<String>>(16)?,r.get::<_,String>(17)?,r.get::<_,Option<String>>(18)?,r.get::<_,Option<String>>(19)?,r.get::<_,String>(20)?,r.get::<_,String>(21)?,r.get::<_,Option<String>>(22)?,r.get::<_,Option<String>>(23)?,r.get::<_,Option<Vec<u8>>>(24)?,r.get::<_,Option<String>>(25)?))
    }).optional()?.ok_or(LedgerError::NotFound)?;
    let currency: Currency = parse_enum(row.8)?;
    let terms = Terms {
        item_ref: table_core::ItemRef::new(row.5).map_err(|_| LedgerError::Integrity("item ID"))?,
        qty: row.6,
        unit_price: Money::new(row.7, currency).map_err(table_core::DomainError::from)?,
        currency,
        delivery: serde_json::from_str::<Delivery>(&row.9)?,
    };
    let terms_hash = terms.hash()?;
    if terms_hash != hash_blob(row.11)? {
        return Err(LedgerError::Integrity("stored terms hash"));
    }
    // The shield's record (0013). A verdict the rules computed for other terms is not projected,
    // so a terms change makes the shield judge again; a raised verdict and a BLOCK always are.
    let mut shield: Option<ShieldVerdict> = row.19.map(parse_enum).transpose()?;
    let mut shield_rule: Option<table_core::ShieldRule> = row.23.map(parse_enum).transpose()?;
    if shield != Some(ShieldVerdict::Block)
        && row
            .24
            .is_some_and(|t| hash_blob(t).ok() != Some(terms_hash))
    {
        shield = None;
        shield_rule = None;
    }
    // The owner's release counts for the terms it was given for. A HOLD it covers reads as ASK
    // (the owner's decision is the check), with the release beside it saying so.
    let shield_release = row
        .25
        .map(|text| serde_json::from_str::<table_core::ShieldRelease>(&text))
        .transpose()?
        .filter(|r| r.terms_hash == terms_hash);
    if shield == Some(ShieldVerdict::Hold)
        && shield_release
            .as_ref()
            .is_some_and(|r| r.covers(shield_rule))
    {
        shield = Some(ShieldVerdict::Ask);
    }
    let market: Option<table_core::MarketRef> =
        row.18.map(|text| serde_json::from_str(&text)).transpose()?;
    if let Some(market) = &market {
        market.validate()?;
    }
    Ok(Deal {
        created_at: row
            .20
            .parse()
            .map_err(|_| LedgerError::Integrity("created timestamp"))?,
        updated_at: row
            .21
            .parse()
            .map_err(|_| LedgerError::Integrity("updated timestamp"))?,
        id,
        kind: parse_enum(row.0)?,
        side: parse_enum(row.1)?,
        counterparty: KeyId::new(row.2).map_err(|_| LedgerError::Integrity("key ID"))?,
        mandate_id: row
            .3
            .parse()
            .map_err(|_| LedgerError::Integrity("mandate ID"))?,
        mandate_version: row.4,
        terms,
        state: parse_enum(row.10)?,
        transcript_head: hash_blob(row.12)?,
        paypal: PaypalRefs {
            order: row.13,
            authorization: row.14,
            capture: row.15,
            subscription: row.16,
        },
        mode: parse_enum(row.17)?,
        market,
        shield,
        shield_rule,
        shield_release,
        // Written only as canonical DecidedBy JSON. Text in the DDL comment's older shape never
        // was; anything unreadable projects as "not recorded", never as a guessed authority.
        decided_by: row
            .22
            .and_then(|text| serde_json::from_str::<DecidedBy>(&text).ok()),
    })
}
/// The redacted rows of one money step's PayPal calls, each bound to the step's deal.
pub(crate) fn insert_calls(
    conn: &Connection,
    id: DealId,
    calls: &[PaypalCall],
    at: Timestamp,
) -> Result<(), LedgerError> {
    for call in calls {
        if call.deal_id != id {
            return Err(LedgerError::Conflict);
        }
        let body = redact_paypal(&call.response, &[]);
        let binding = call.binding.as_ref().map(json_text).transpose()?;
        conn.execute("INSERT INTO paypal_calls(deal_id,method,path,request_id,status,debug_id,body_redacted,at,binding_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",params![id.to_string(),call.method.as_str(),call.path.as_str(),call.request_id,call.status,body.get("debug_id").and_then(Value::as_str),json_text(&body)?,at.to_string(),binding])?;
    }
    Ok(())
}
pub(crate) fn apply(
    conn: &Connection,
    id: DealId,
    event: DealEvent,
    at: Timestamp,
) -> Result<(), LedgerError> {
    apply_decided(conn, id, event, None, at)
}
/// A transition that is itself a decision records its authority on the deal row and in the same
/// audit entry, so `Deal::decided_by` is exactly what the hash chain says.
pub(crate) fn apply_decided(
    conn: &Connection,
    id: DealId,
    event: DealEvent,
    decided: Option<&DecidedBy>,
    at: Timestamp,
) -> Result<(), LedgerError> {
    let deal = read_deal(conn, id)?;
    let next = transition(deal.state, event)?;
    conn.execute(
        "UPDATE deals SET state=?1,updated_at=?2 WHERE id=?3",
        params![enum_text(&next)?, at.to_string(), id.to_string()],
    )?;
    let mut detail = json!({"from":deal.state,"to":next});
    // The wallet's own-side commitment to the market price it bargained on (market-data-2):
    // the agreement row names the digest of the market record the deal held when it was agreed.
    if next == DealState::Agreed
        && let Some(market) = &deal.market
    {
        detail["market"] = serde_json::to_value(market.commitment()?)?;
    }
    if let Some(decided) = decided {
        conn.execute(
            "UPDATE deals SET decided_by=?1 WHERE id=?2",
            params![json_text(decided)?, id.to_string()],
        )?;
        detail["decided_by"] = serde_json::to_value(decided)?;
        // A safe default cites what the owner was shown before it (attention-ladder-1).
        if matches!(decided, DecidedBy::SafeDefault { .. }) {
            crate::attention::cite_rungs(conn, id, &mut detail);
        }
    }
    audit::append(
        conn,
        &AuditEntry {
            at,
            actor: "policy".into(),
            action: "deal.transition".into(),
            deal_id: Some(id),
            detail,
        },
    )?;
    Ok(())
}
/// A new deal row (PAIRING, empty transcript, no PayPal refs) under an active mandate, with its
/// `deal.created` audit row and display label, inside the caller's transaction.
pub(crate) fn insert_deal(
    conn: &Connection,
    deal: &Deal,
    at: Timestamp,
) -> Result<(), LedgerError> {
    if deal.state != DealState::Pairing
        || deal.transcript_head != H256::ZERO
        || deal.paypal != PaypalRefs::default()
    {
        return Err(LedgerError::Conflict);
    }
    let hash = deal.terms.hash()?;
    if let Some(market) = &deal.market {
        market.validate()?;
    }
    read_mandate(conn, deal.mandate_id, deal.mandate_version)?;
    conn.execute("INSERT INTO deals(id,kind,side,counterparty,mandate_id,mandate_version,item_ref,qty,unit_price_minor,currency,delivery,state,terms_hash,transcript_head,reconciliation,created_at,updated_at,mode,market_json,shield_verdict,shield_rule) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'n/a',?15,?15,?16,?17,?18,?19)",params![deal.id.to_string(),enum_text(&deal.kind)?,enum_text(&deal.side)?,deal.counterparty.as_str(),deal.mandate_id.to_string(),deal.mandate_version,deal.terms.item_ref.as_str(),deal.terms.qty,deal.terms.unit_price.minor(),deal.terms.currency.to_string(),json_text(&deal.terms.delivery)?,enum_text(&deal.state)?,&hash.0[..],&H256::ZERO.0[..],at.to_string(),enum_text(&deal.mode)?,deal.market.as_ref().map(json_text).transpose()?,deal.shield.as_ref().map(enum_text).transpose()?,deal.shield_rule.as_ref().map(enum_text).transpose()?])?;
    audit::append(
        conn,
        &AuditEntry {
            at,
            actor: "policy".into(),
            action: "deal.created".into(),
            deal_id: Some(deal.id),
            detail: json!({"kind":deal.kind,"mode":deal.mode,"terms_hash":hash}),
        },
    )?;
    conn.execute(
        "INSERT INTO deal_labels(deal_id) VALUES (?1)",
        [deal.id.to_string()],
    )?;
    Ok(())
}
pub(crate) use crate::negotiation::{append_verified, check_owner_pin, commit_negotiation_in};

impl Ledger {
    /// Market evidence is supplied by a trusted provider, never as a client verdict.
    pub fn store_market_reference(
        &mut self,
        id: DealId,
        market: &table_core::MarketRef,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        market.validate()?;
        let deal = self.get_deal(id)?;
        if market.p25.currency() != deal.terms.currency || market.retrieved_at > at {
            return Err(LedgerError::Conflict);
        }
        // A re-checkable record (market-data-2) names the product it priced: it must be the
        // product the deal's rules bind to the deal's item.
        if let Some(certificate) = &market.certificate {
            let mandate = read_mandate_evidence(&self.conn, deal.mandate_id, deal.mandate_version)?;
            if mandate.payload.market_product_for(&deal.terms.item_ref)
                != Some(certificate.product_id.as_str())
            {
                return Err(LedgerError::Conflict);
            }
        }
        let mut detail =
            json!({"retrieved_at":market.retrieved_at,"response_hash":market.response_hash});
        // The whole record goes into the hash chain, so the snapshot a deal is agreed on can be
        // re-checked later from the wallet's own rows and from a proof file.
        if let Some(digest) = market.digest()? {
            let mut kept = market.clone();
            kept.cached = false;
            detail["digest"] = serde_json::to_value(digest)?;
            detail["reference"] = serde_json::to_value(&kept)?;
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute(
            "UPDATE deals SET market_json=?1,updated_at=?3 WHERE id=?2",
            params![json_text(market)?, id.to_string(), at.to_string()],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "market".into(),
                action: "market.observed".into(),
                deal_id: Some(id),
                detail,
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn preference<T: for<'de> Deserialize<'de>>(
        &self,
        key: &str,
    ) -> Result<Option<T>, LedgerError> {
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT value_json FROM local_preferences WHERE key=?1",
                [key],
                |r| r.get(0),
            )
            .optional()?;
        raw.map(|v| serde_json::from_str(&v).map_err(Into::into))
            .transpose()
    }
    /// Non-secret native preferences only. This has no audit UPDATE/DELETE path.
    pub fn set_preference<T: Serialize>(
        &mut self,
        key: &str,
        value: &T,
    ) -> Result<(), LedgerError> {
        self.conn.execute("INSERT INTO local_preferences(key,value_json) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json", params![key,json_text(value)?])?;
        Ok(())
    }
    pub fn set_deal_category(
        &mut self,
        id: DealId,
        category: table_core::Category,
    ) -> Result<(), LedgerError> {
        self.conn.execute(
            "INSERT INTO deal_context(deal_id,category_json) VALUES(?1,?2)",
            params![id.to_string(), json_text(&category)?],
        )?;
        Ok(())
    }
    pub fn deal_category(&self, id: DealId) -> Result<table_core::Category, LedgerError> {
        let raw: String = self
            .conn
            .query_row(
                "SELECT category_json FROM deal_context WHERE deal_id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        Ok(serde_json::from_str(&raw)?)
    }
    pub fn handoff(&mut self, id: DealId) -> Result<(), LedgerError> {
        if self.conn.execute(
            "UPDATE deal_context SET browser_handoff=1 WHERE deal_id=?1",
            [id.to_string()],
        )? != 1
        {
            return Err(LedgerError::NotFound);
        }
        Ok(())
    }
    pub fn handed_off(&self, id: DealId) -> Result<bool, LedgerError> {
        Ok(self
            .conn
            .query_row(
                "SELECT browser_handoff FROM deal_context WHERE deal_id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .unwrap_or(false))
    }
    /// True only before the wallet has signed, paired or dealt anything.
    pub fn is_fresh(&self) -> Result<bool, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT NOT EXISTS (SELECT 1 FROM mandates) AND NOT EXISTS (SELECT 1 FROM deals)              AND NOT EXISTS (SELECT 1 FROM counterparties)",
            [],
            |r| r.get(0),
        )?)
    }
    /// Stored binding facts for a deal's PayPal calls, oldest first (calls before 0007 are skipped).
    pub fn paypal_bindings(&self, id: DealId) -> Result<Vec<Value>, LedgerError> {
        let mut statement = self.conn.prepare(
            "SELECT binding_json FROM paypal_calls WHERE deal_id=?1 AND binding_json IS NOT NULL ORDER BY id",
        )?;
        let rows = statement
            .query_map([id.to_string()], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.iter()
            .map(|raw| serde_json::from_str(raw).map_err(Into::into))
            .collect()
    }
    /// Every distinct agent public key any mandate row ever bound, whatever its status (active,
    /// superseded, revoked or expired). Read-only; a key that is not 32 bytes is an integrity fault.
    pub fn mandate_agent_keys(&self) -> Result<Vec<[u8; 32]>, LedgerError> {
        let mut statement = self
            .conn
            .prepare("SELECT DISTINCT agent_pubkey FROM mandates ORDER BY agent_pubkey")?;
        let raw = statement
            .query_map([], |r| r.get::<_, Vec<u8>>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        raw.into_iter()
            .map(|key| {
                key.try_into()
                    .map_err(|_| LedgerError::Integrity("agent key length"))
            })
            .collect()
    }
    /// Read-only: the body of the deal's latest stored SETTLE (the seller's own outbound one, or a
    /// buyer's inbound one that passed `accept_buyer_settle`), after the whole signed transcript
    /// verifies. `None` when no SETTLE is stored yet. A SETTLE refused as a mismatch is never
    /// stored, so its amount is not readable here (the deal's MISMATCH state says it).
    pub fn latest_settle(&self, id: DealId) -> Result<Option<Body>, LedgerError> {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        self.verify_transcript(id)?;
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT raw_jws FROM envelopes WHERE deal_id=?1 AND typ='SETTLE' ORDER BY rowid DESC LIMIT 1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let payload = URL_SAFE_NO_PAD
            .decode(raw.split('.').nth(1).ok_or(ProtocolError::Shape)?)
            .map_err(|_| ProtocolError::Shape)?;
        let envelope: table_proto::Envelope = serde_json::from_slice(&payload)?;
        if !matches!(envelope.body, Body::Settle { .. }) {
            return Err(LedgerError::Integrity("SETTLE row holds another message"));
        }
        Ok(Some(envelope.body))
    }
    pub fn verified_approval_link(&self, id: DealId, attempt: u8) -> Result<String, LedgerError> {
        use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
        self.verify_transcript(id)?;
        let deal = self.get_deal(id)?;
        let raw: String = self.conn.query_row("SELECT raw_jws FROM envelopes WHERE deal_id=?1 AND typ='SETTLE' ORDER BY rowid DESC LIMIT 1",[id.to_string()],|r|r.get(0)).optional()?.ok_or(LedgerError::NotFound)?;
        let payload = URL_SAFE_NO_PAD
            .decode(raw.split('.').nth(1).ok_or(ProtocolError::Shape)?)
            .map_err(|_| ProtocolError::Shape)?;
        let envelope: table_proto::Envelope = serde_json::from_slice(&payload)?;
        if !matches!(&envelope.body,Body::Settle{attempt:a,order_id,..} if *a==attempt && Some(order_id.as_str())==deal.paypal.order.as_deref())
        {
            return Err(LedgerError::Conflict);
        }
        table_proto::validate_settle(&envelope.body, id, &deal.terms, deal.mode)
            .map(|url| url.as_str().to_owned())
            .map_err(|_| LedgerError::Conflict)
    }
    /// The daily budget a deal is checked against. A deal's place in the budget is fixed when it
    /// first reaches AGREED (the first `deal.transition` audit row whose `to` is AGREED; the audit
    /// `seq` orders two agreements in the same second). A deal counts against this one when it
    /// agreed earlier on the same UTC day as this deal's own agreement; deals that agree later,
    /// and tables that never agreed, never do. A deal that has not agreed yet is counted as if it
    /// agreed now, after everyone agreed so far. Fail closed: a deal past agreement whose
    /// agreement row cannot be read counts against every other deal.
    pub fn usage_for(&self, deal: &Deal, now: Timestamp) -> Result<table_core::Usage, LedgerError> {
        const AGREED_ROW: &str = "SELECT {c} FROM audit_log WHERE deal_id={id} AND action='deal.transition' AND json_extract(detail_json,'$.to')='AGREED' ORDER BY seq LIMIT 1";
        let agreed = |c: &str, id: &str| AGREED_ROW.replace("{c}", c).replace("{id}", id);
        let own: Option<(i64, i64)> = self
            .conn
            .query_row(
                &agreed("seq,CAST(at AS INTEGER)", "?1"),
                [deal.id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        // The day of the window: this deal's agreement day, else today.
        let day = table_core::utc_day(own.map_or(now, |(_, at)| at));
        // The released states come from table-core's one list, not a literal here.
        let released = DealState::RELEASED
            .iter()
            .map(|state| enum_text(state).map(|text| format!("'{text}'")))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        let sql = format!(
            "SELECT qty,unit_price_minor,currency,state,CAST(created_at AS INTEGER),({}),({}) FROM deals d WHERE mandate_id=?1 AND id!=?2 AND state NOT IN ({released})",
            agreed("seq", "d.id"),
            agreed("CAST(at AS INTEGER)", "d.id"),
        );
        let mut q = self.conn.prepare(&sql)?;
        let rows = q.query_map(
            params![deal.mandate_id.to_string(), deal.id.to_string()],
            |r| {
                Ok((
                    r.get::<_, u32>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<i64>>(5)?,
                    r.get::<_, Option<i64>>(6)?,
                ))
            },
        )?;
        let mut usage = table_core::Usage {
            deals_today: 0,
            total_today: Money::new(0, deal.terms.currency)
                .map_err(table_core::DomainError::from)?,
        };
        for row in rows {
            let (qty, minor, currency, state, created, seq, at) = row?;
            let counts = match (seq, at) {
                (Some(seq), Some(at)) => {
                    table_core::utc_day(at) == day
                        && match own {
                            Some((own_seq, _)) => seq < own_seq,
                            // Unreadable own moment or not agreed yet: everyone agreed so far.
                            None => true,
                        }
                }
                // Agreed, but the moment is unreadable: counts against every other deal.
                _ => {
                    let state: DealState = parse_enum(state)?;
                    state.is_agreed_or_later() && table_core::utc_day(created) == day
                }
            };
            if !counts {
                continue;
            }
            usage.deals_today = usage
                .deals_today
                .checked_add(1)
                .ok_or(LedgerError::Conflict)?;
            let amount = Money::new(minor, parse_enum(currency)?)
                .map_err(table_core::DomainError::from)?
                .checked_mul(qty)
                .map_err(table_core::DomainError::from)?;
            usage.total_today = usage
                .total_today
                .checked_add(amount)
                .map_err(table_core::DomainError::from)?;
        }
        Ok(usage)
    }
    pub fn propose_purchase(&mut self, deal: &Deal, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let original = read_deal(&tx, deal.id)?;
        if original.state != DealState::Pairing
            || original.kind != table_core::DealKind::Purchase
            || original.side != table_core::Side::Buyer
            || original.terms.item_ref != deal.terms.item_ref
            || original.terms.unit_price != deal.terms.unit_price
        {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "UPDATE deals SET qty=?1,terms_hash=?2,updated_at=?3 WHERE id=?4",
            params![
                deal.terms.qty,
                &deal.terms.hash()?.0[..],
                at.to_string(),
                deal.id.to_string()
            ],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "agent".into(),
                action: "purchase.proposed".into(),
                deal_id: Some(deal.id),
                detail: json!({"amount":deal.terms.amount()?}),
            },
        )?;
        // The mandate check already passed (agent.rs); a purchase has no counterparty to sign.
        apply(&tx, deal.id, DealEvent::PurchaseCleared, at)?;
        tx.commit()?;
        Ok(())
    }
    pub fn settled_attempt(&self, id: DealId) -> Result<u8, LedgerError> {
        self.conn
            .query_row(
                "SELECT attempt FROM deals WHERE id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)
    }
    pub fn list_deals(&self) -> Result<Vec<Deal>, LedgerError> {
        self.read_deals("SELECT id FROM deals ORDER BY id")
    }
    /// Every deal not in a terminal state, in id order. RECEIPTED is not terminal and is listed:
    /// the tick lapses a buyer's uncorroborated receipt. The state list is `DealState::ALL`
    /// filtered by `terminal()`, not a literal here.
    pub fn list_live_deals(&self) -> Result<Vec<Deal>, LedgerError> {
        let terminal = DealState::ALL
            .iter()
            .filter(|state| state.terminal())
            .map(|state| enum_text(state).map(|text| format!("'{text}'")))
            .collect::<Result<Vec<_>, _>>()?
            .join(",");
        self.read_deals(&format!(
            "SELECT id FROM deals WHERE state NOT IN ({terminal}) ORDER BY id"
        ))
    }
    fn read_deals(&self, id_query: &str) -> Result<Vec<Deal>, LedgerError> {
        let mut query = self.conn.prepare(id_query)?;
        let ids = query
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|id| {
                read_deal(
                    &self.conn,
                    id.parse().map_err(|_| LedgerError::Integrity("deal id"))?,
                )
            })
            .collect()
    }
    pub fn create_deal(&mut self, deal: &Deal, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        insert_deal(&tx, deal, at)?;
        tx.commit()?;
        Ok(())
    }
    pub fn get_deal(&self, id: DealId) -> Result<Deal, LedgerError> {
        read_deal(&self.conn, id)
    }
    pub fn apply_event(
        &mut self,
        id: DealId,
        event: DealEvent,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        apply(&tx, id, event, at)?;
        tx.commit()?;
        Ok(())
    }
    /// A mandate refusal: the clause that refused is the deal's recorded decision.
    pub fn refuse(&mut self, id: DealId, clause: u8, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        apply_decided(
            &tx,
            id,
            DealEvent::Refuse,
            Some(&DecidedBy::Policy { clause }),
            at,
        )?;
        tx.commit()?;
        Ok(())
    }
    /// Silence on a pre-capture deal: the safe default (withdraw or expire) at its recorded
    /// deadline. Never a money call; an authorization needs the void path instead. A deal with
    /// an authorize whose outcome is not settled (live, unknown or parked) is refused
    /// (`Conflict`): PayPal may hold money for it, and an expired deal would never void it.
    pub fn apply_deadline_default(&mut self, id: DealId, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let open_authorize: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM operations o WHERE o.deal_id=?1 AND o.operation='authorize'
             AND o.status IN ('pending','unknown')
             AND NOT EXISTS(SELECT 1 FROM operation_resolutions r WHERE r.request_id=o.request_id AND r.outcome IN ('confirmed','absent')))",
            [id.to_string()],
            |r| r.get(0),
        )?;
        if open_authorize {
            return Err(LedgerError::Conflict);
        }
        let due: Timestamp = tx
            .query_row(
                "SELECT due_at FROM deadlines WHERE deal_id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        let deal = read_deal(&tx, id)?;
        if due.saturating_add(crate::receipt::lapse_grace(&tx, &deal)?) > at {
            return Err(LedgerError::Conflict);
        }
        apply_decided(
            &tx,
            id,
            DealEvent::Deadline,
            Some(&DecidedBy::SafeDefault { deadline: due }),
            at,
        )?;
        tx.commit()?;
        Ok(())
    }
}
