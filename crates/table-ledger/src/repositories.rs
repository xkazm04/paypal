use crate::{AuditEntry, Ledger, LedgerError, PaypalCall, audit, hash_blob, redact_paypal};
use ed25519_dalek::{Signature, VerifyingKey};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use table_core::{
    ClosedMandate, Currency, Deal, DealEvent, DealId, DealState, DecidedBy, Delivery, H256, KeyId,
    MandateId, Money, OpenMandate, PayeeRef, PaypalRefs, Refusal, ShieldVerdict, Terms, Timestamp,
    canonical_bytes, commitment, invoice_id, transition,
};
use table_proto::{
    Body, NonceLookup, ProtocolError, VerifiedEnvelope, VerifyContext, key_id, verify,
    verify_mandate_signature,
};

/// An active mandate as the owner's list shows it. `refusal` is set when the signed policy no
/// longer passes `validate()`: it needs signing again or withdrawing, and nothing acts under it.
#[derive(Debug, Clone)]
pub struct ListedMandate {
    pub mandate: OpenMandate,
    pub refusal: Option<Refusal>,
}
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
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Inbound,
    Outbound,
}
#[derive(Debug)]
pub struct OperationOutcome<'a> {
    pub id: DealId,
    pub attempt: u8,
    pub operation: &'a str,
    pub calls: &'a [PaypalCall],
    pub refs: &'a PaypalRefs,
    pub event: Option<DealEvent>,
    pub at: Timestamp,
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
fn read_mandate(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let active: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM mandates WHERE id=?1 AND version=?2 AND status='active')",
        params![id.to_string(), version],
        |r| r.get(0),
    )?;
    if !active {
        return Err(LedgerError::NotFound);
    }
    read_mandate_evidence(conn, id, version)
}
fn read_mandate_evidence(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let mandate = read_mandate_row(conn, id, version)?;
    mandate.payload.hash()?;
    Ok(mandate)
}
/// The stored row checked for integrity (commitment, canonical body, id and version) but not
/// against today's `validate()` rules. Callers decide what a policy refusal means; nothing may
/// act on a mandate read only through this.
fn read_mandate_row(
    conn: &Connection,
    id: MandateId,
    version: u32,
) -> Result<OpenMandate, LedgerError> {
    let (body, hash, sig): (String, Vec<u8>, Vec<u8>) = conn
        .query_row(
            "SELECT body_json,body_hash,owner_sig FROM mandates WHERE id=?1 AND version=?2",
            params![id.to_string(), version],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    let mandate = OpenMandate {
        payload: serde_json::from_str(&body)?,
        owner_sig: sig,
    };
    if commitment(&mandate.payload)? != hash_blob(hash)?
        || json_text(&mandate.payload)? != body
        || mandate.payload.id != id
        || mandate.payload.version != version
    {
        return Err(LedgerError::Integrity("stored mandate"));
    }
    Ok(mandate)
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
fn apply_decided(
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
    if let Some(decided) = decided {
        conn.execute(
            "UPDATE deals SET decided_by=?1 WHERE id=?2",
            params![json_text(decided)?, id.to_string()],
        )?;
        detail["decided_by"] = serde_json::to_value(decided)?;
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
/// States in the forward chain from AGREED on, every one reached through AGREED.
fn agreed_or_later(state: DealState) -> bool {
    use DealState as S;
    matches!(
        state,
        S::Agreed
            | S::Settling
            | S::AwaitingApproval
            | S::Approved
            | S::Authorized
            | S::Captured
            | S::Receipted
            | S::Reconciled
            | S::Refunded
            | S::Disputed
    )
}
struct DbNonces<'a>(&'a Connection);
impl NonceLookup for DbNonces<'_> {
    fn contains(&self, key: &KeyId, nonce: &[u8; 16]) -> Result<bool, ProtocolError> {
        self.0
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM nonces_seen WHERE key_id=?1 AND nonce=?2)",
                params![key.as_str(), &nonce[..]],
                |r| r.get(0),
            )
            .map_err(|_| ProtocolError::NonceStore)
    }
}
impl NonceLookup for Ledger {
    fn contains(&self, key: &KeyId, nonce: &[u8; 16]) -> Result<bool, ProtocolError> {
        DbNonces(&self.conn).contains(key, nonce)
    }
}

fn last_proposal(
    conn: &Connection,
    id: DealId,
) -> Result<(u32, H256, Direction, bool), LedgerError> {
    let (seq, hash, dir, typ): (u32, Vec<u8>, String, String) = conn.query_row(
        "SELECT seq,hash,dir,typ FROM envelopes WHERE deal_id=?1 AND typ IN ('OFFER','COUNTER') ORDER BY rowid DESC LIMIT 1",
        [id.to_string()], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
    ).optional()?.ok_or(LedgerError::NotFound)?;
    let direction = match dir.as_str() {
        "in" => Direction::Inbound,
        "out" => Direction::Outbound,
        _ => return Err(LedgerError::Integrity("envelope direction")),
    };
    Ok((seq, hash_blob(hash)?, direction, typ == "COUNTER"))
}
fn check_owner_accept(
    conn: &Connection,
    deal: &Deal,
    direction: Direction,
    proof: &table_proto::OwnerAccept,
) -> Result<(), LedgerError> {
    check_owner_pin(conn, deal, direction, proof)?;
    let (seq, hash, proposal_direction, counter) = last_proposal(conn, deal.id)?;
    if !counter
        || seq != proof.offer_seq
        || hash != proof.counter_hash
        || proposal_direction == direction
        || proof.deal_id != deal.id
        || proof.terms_hash != deal.terms.hash()?
    {
        return Err(ProtocolError::Binding.into());
    }
    Ok(())
}
fn check_owner_pin(
    conn: &Connection,
    deal: &Deal,
    direction: Direction,
    proof: &table_proto::OwnerAccept,
) -> Result<(), LedgerError> {
    proof.verify()?;
    if direction == Direction::Inbound {
        let pinned: Vec<u8> = conn.query_row(
            "SELECT owner_pubkey FROM counterparties WHERE key_id=?1",
            [deal.counterparty.as_str()],
            |r| r.get(0),
        )?;
        if pinned != proof.owner_key {
            return Err(ProtocolError::Binding.into());
        }
    } else {
        let m = read_mandate_evidence(conn, deal.mandate_id, deal.mandate_version)?;
        let key =
            VerifyingKey::from_bytes(&proof.owner_key).map_err(|_| ProtocolError::Signature)?;
        verify_mandate_signature(&m.payload, &m.owner_sig, &key)?;
    }
    Ok(())
}

pub(crate) fn append_verified(
    conn: &Connection,
    verified: &VerifiedEnvelope,
    direction: Direction,
    at: Timestamp,
) -> Result<(), LedgerError> {
    let e = verified.envelope();
    if e.iat > at || e.exp <= at {
        return Err(ProtocolError::Time.into());
    }
    let deal = read_deal(conn, e.deal_id)?;
    if deal.transcript_head != e.prev {
        return Err(LedgerError::Conflict);
    }
    let expected: u32 = conn.query_row(
        "SELECT COALESCE(MAX(seq),0)+1 FROM envelopes WHERE deal_id=?1 AND dir=?2",
        params![e.deal_id.to_string(), direction.as_str()],
        |r| r.get(0),
    )?;
    if expected != e.seq {
        return Err(LedgerError::Conflict);
    }
    let mandate = read_mandate(conn, deal.mandate_id, deal.mandate_version)?;
    let own = key_id(
        &VerifyingKey::from_bytes(&mandate.payload.agent_key)
            .map_err(|_| ProtocolError::Signature)?,
    )?;
    let (issuer, audience) = if direction == Direction::Inbound {
        (&deal.counterparty, &own)
    } else {
        (&own, &deal.counterparty)
    };
    if &e.iss != issuer || &e.aud != audience {
        return Err(ProtocolError::Binding.into());
    }
    if let table_proto::Body::Accept {
        owner_accept: Some(proof),
        ..
    } = &e.body
    {
        check_owner_accept(conn, &deal, direction, proof)?;
        audit::append(
            conn,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "deal.owner_accept".into(),
                deal_id: Some(deal.id),
                detail: json!({"decided_by":"owner", "counter_hash":proof.counter_hash,
                "terms_hash":proof.terms_hash,"owner_key":proof.owner_key,"signature":proof.signature}),
            },
        )?;
    }
    // Unique nonce insert and all transcript/evidence writes share one immediate transaction.
    conn.execute(
        "INSERT INTO nonces_seen(key_id,nonce,exp) VALUES (?1,?2,?3)",
        params![e.iss.as_str(), &e.nonce[..], e.exp.to_string()],
    )?;
    conn.execute("INSERT INTO envelopes(deal_id,seq,dir,typ,raw_jws,hash,prev,verified,received_at) VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8)",params![e.deal_id.to_string(),e.seq,direction.as_str(),enum_text(&e.typ)?,verified.raw(),&verified.hash().0[..],&e.prev.0[..],at.to_string()])?;
    conn.execute(
        "UPDATE deals SET transcript_head=?1,updated_at=?2 WHERE id=?3",
        params![
            &verified.hash().0[..],
            at.to_string(),
            e.deal_id.to_string()
        ],
    )?;
    audit::append(
        conn,
        &AuditEntry {
            at,
            actor: format!(
                "{}:{}",
                if direction == Direction::Inbound {
                    "peer"
                } else {
                    "agent"
                },
                e.iss
            ),
            action: "envelope.accepted".into(),
            deal_id: Some(e.deal_id),
            detail: json!({"seq":e.seq,"typ":e.typ,"direction":direction.as_str(),"hash":verified.hash()}),
        },
    )?;
    Ok(())
}

impl Ledger {
    /// Latest price proposal, including direction and digest: equal prices in a new
    /// round are still a new owner decision.
    pub fn last_proposal(&self, id: DealId) -> Result<(u32, H256, Direction, bool), LedgerError> {
        last_proposal(&self.conn, id)
    }
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
                detail: json!({"retrieved_at":market.retrieved_at,"response_hash":market.response_hash}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn next_mandate_version(&self, id: MandateId) -> Result<u32, LedgerError> {
        let last: u32 = self.conn.query_row(
            "SELECT COALESCE(MAX(version),0) FROM mandates WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?;
        last.checked_add(1).ok_or(LedgerError::Conflict)
    }
    pub fn rebind_mandate(
        &mut self,
        id: DealId,
        version: u32,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, id)?;
        if !matches!(
            deal.state,
            DealState::Pairing | DealState::Listed | DealState::Negotiating | DealState::Agreed
        ) || deal.paypal.order.is_some()
        {
            return Err(LedgerError::Conflict);
        }
        read_mandate(&tx, deal.mandate_id, version)?;
        tx.execute(
            "UPDATE deals SET mandate_version=?1,updated_at=?3 WHERE id=?2",
            params![version, id.to_string(), at.to_string()],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "deal.mandate_rebound".into(),
                deal_id: Some(id),
                detail: json!({"version":version}),
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
    /// Every active mandate for the owner's list. One the owner signed that today's
    /// `validate()` refuses (an older wallet's policy) is listed with that refusal so it can be
    /// signed again or withdrawn; `active_mandate` still refuses it, so nothing acts under it.
    /// Any other integrity failure, a bad signature above all, still fails the whole list.
    pub fn list_mandates(&self, owner: &VerifyingKey) -> Result<Vec<ListedMandate>, LedgerError> {
        let mut statement = self
            .conn
            .prepare("SELECT id,version FROM mandates WHERE status='active' ORDER BY id")?;
        let ids = statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        ids.into_iter()
            .map(|(id, version)| {
                let id = id
                    .parse()
                    .map_err(|_| LedgerError::Integrity("mandate ID"))?;
                let mandate = read_mandate_row(&self.conn, id, version)?;
                let Err(refusal) = mandate.payload.validate() else {
                    return Ok(ListedMandate {
                        mandate: self.active_mandate(id, version, owner)?,
                        refusal: None,
                    });
                };
                // verify_mandate_signature refuses before it checks the signature; check the
                // owner's signature here so a forged row is still tampering, not a stale policy.
                let sig = Signature::from_slice(&mandate.owner_sig)
                    .map_err(|_| ProtocolError::Signature)?;
                owner
                    .verify_strict(&canonical_bytes(&mandate.payload)?, &sig)
                    .map_err(|_| ProtocolError::Signature)?;
                Ok(ListedMandate {
                    mandate,
                    refusal: Some(refusal),
                })
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
        let day = own.map_or(now, |(_, at)| at).div_euclid(86400);
        let sql = format!(
            "SELECT qty,unit_price_minor,currency,state,CAST(created_at AS INTEGER),({}),({}) FROM deals d WHERE mandate_id=?1 AND id!=?2 AND state NOT IN ('REFUSED','WITHDRAWN','EXPIRED','VOIDED','AUTO_VOIDED')",
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
                    at.div_euclid(86400) == day
                        && match own {
                            Some((own_seq, _)) => seq < own_seq,
                            // Unreadable own moment or not agreed yet: everyone agreed so far.
                            None => true,
                        }
                }
                // Agreed, but the moment is unreadable: counts against every other deal.
                _ => {
                    let state: DealState = parse_enum(state)?;
                    agreed_or_later(state) && created.div_euclid(86400) == day
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
        Ok(self.conn.query_row(
            "SELECT attempt FROM deals WHERE id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?)
    }
    pub fn pending_offer(&self, id: DealId) -> Result<(u32, H256), LedgerError> {
        let (seq, hash): (u32, Vec<u8>) = self.conn.query_row(
            "SELECT offer_seq,terms_hash FROM negotiation WHERE deal_id=?1",
            [id.to_string()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((seq, hash_blob(hash)?))
    }
    pub fn preview_inbound(
        &self,
        id: DealId,
        raw: &str,
        at: Timestamp,
    ) -> Result<VerifiedEnvelope, LedgerError> {
        let deal = self.get_deal(id)?;
        let (key, confirmed): (Vec<u8>, Option<String>) = self.conn.query_row(
            "SELECT agent_pubkey,words_confirmed_at FROM counterparties WHERE key_id=?1",
            [deal.counterparty.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if confirmed.is_none() {
            return Err(LedgerError::Conflict);
        }
        let key = VerifyingKey::from_bytes(
            &key.try_into()
                .map_err(|_| LedgerError::Integrity("peer key"))?,
        )
        .map_err(|_| ProtocolError::Signature)?;
        let mandate = read_mandate(&self.conn, deal.mandate_id, deal.mandate_version)?;
        let audience = key_id(
            &VerifyingKey::from_bytes(&mandate.payload.agent_key)
                .map_err(|_| ProtocolError::Signature)?,
        )?;
        Ok(verify(
            raw,
            &key,
            &VerifyContext {
                deal_id: id,
                audience: &audience,
                next_sender_seq: self.next_sequence(id, Direction::Inbound)?,
                previous: deal.transcript_head,
                now: at,
                nonces: self,
            },
        )?)
    }
    pub fn reserve_operation(
        &mut self,
        id: DealId,
        attempt: u8,
        operation: &str,
        request_id: &str,
        authority: &table_core::DecidedBy,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        if !(1..=3).contains(&attempt) {
            return Err(LedgerError::Conflict);
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO operations(deal_id,attempt,operation,request_id,decided_by,status,started_at) VALUES (?1,?2,?3,?4,?5,'pending',?6)",params![id.to_string(),attempt,operation,request_id,json_text(authority)?,at])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "pipeline".into(),
                action: "money.authorized".into(),
                deal_id: Some(id),
                detail: json!({"operation":operation,"request_id":request_id,"decided_by":authority}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn finish_operation(&mut self, outcome: OperationOutcome<'_>) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        crate::resolver::finish(&tx, &outcome, &["pending"], false)?;
        tx.commit()?;
        Ok(())
    }
    pub fn set_deadline(
        &mut self,
        id: DealId,
        due: Timestamp,
        authorization_at: Option<Timestamp>,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        // The deadline drives auto-void and expiry, so every move of it is in the chain.
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO deadlines(deal_id,due_at,authorization_at) VALUES (?1,?2,?3) ON CONFLICT(deal_id) DO UPDATE SET due_at=excluded.due_at,authorization_at=excluded.authorization_at",params![id.to_string(),due,authorization_at])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "policy".into(),
                action: "deadline.set".into(),
                deal_id: Some(id),
                detail: json!({"due_at":due,"authorization_at":authorization_at}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn deadline(
        &self,
        id: DealId,
    ) -> Result<Option<(Timestamp, Option<Timestamp>)>, LedgerError> {
        Ok(self
            .conn
            .query_row(
                "SELECT due_at,authorization_at FROM deadlines WHERE deal_id=?1",
                [id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?)
    }
    pub fn list_deals(&self) -> Result<Vec<Deal>, LedgerError> {
        let mut query = self.conn.prepare("SELECT id FROM deals ORDER BY id")?;
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
    pub fn counterparty_policy(&self, key: &KeyId) -> Result<(bool, bool, PayeeRef), LedgerError> {
        let (confirmed,via,payee):(Option<String>,String,String)=self.conn.query_row("SELECT words_confirmed_at,paired_via,declared_payee FROM counterparties WHERE key_id=?1",[key.as_str()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))?;
        Ok((
            confirmed.is_some(),
            via == "house",
            PayeeRef::new(payee).map_err(|_| LedgerError::Integrity("payee"))?,
        ))
    }
    pub fn counterparty_first_seen(&self, key: &KeyId) -> Result<Timestamp, LedgerError> {
        let at: String = self.conn.query_row(
            "SELECT first_seen FROM counterparties WHERE key_id=?1",
            [key.as_str()],
            |r| r.get(0),
        )?;
        at.parse()
            .map_err(|_| LedgerError::Integrity("counterparty timestamp"))
    }
    pub fn next_sequence(&self, id: DealId, direction: Direction) -> Result<u32, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM envelopes WHERE deal_id=?1 AND dir=?2",
            params![id.to_string(), direction.as_str()],
            |r| r.get(0),
        )?)
    }
    /// Typed Rust-only atomic semantic commit. Caller verifies mandate and protocol before this edge.
    pub fn commit_negotiation(
        &mut self,
        verified: &VerifiedEnvelope,
        direction: Direction,
        terms: Option<&Terms>,
        event: Option<DealEvent>,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        commit_negotiation_in(&tx, verified, direction, terms, event, at)?;
        tx.commit()?;
        Ok(())
    }
}
/// The body of [`Ledger::commit_negotiation`] inside the caller's transaction. A grouped deal's
/// ACCEPT passes the shop-around guard here, in the same transaction that records it.
pub(crate) fn commit_negotiation_in(
    tx: &Connection,
    verified: &VerifiedEnvelope,
    direction: Direction,
    terms: Option<&Terms>,
    event: Option<DealEvent>,
    at: Timestamp,
) -> Result<(), LedgerError> {
    {
        let id = verified.envelope().deal_id;
        let deal = read_deal(tx, id)?;
        if let Some(terms) = terms {
            if !matches!(deal.state, DealState::Listed | DealState::Negotiating) {
                return Err(LedgerError::Conflict);
            }
            let hash = terms.hash()?;
            tx.execute("UPDATE deals SET item_ref=?1,qty=?2,unit_price_minor=?3,currency=?4,delivery=?5,terms_hash=?6 WHERE id=?7",params![terms.item_ref.as_str(),terms.qty,terms.unit_price.minor(),terms.currency.to_string(),json_text(&terms.delivery)?,&hash.0[..],id.to_string()])?;
        }
        match &verified.envelope().body {
            Body::Offer { price, delivery } | Body::Counter { price, delivery } => {
                let t = terms.ok_or(LedgerError::Conflict)?;
                if *price != t.unit_price || *delivery != t.delivery {
                    return Err(LedgerError::Conflict);
                }
                tx.execute("INSERT INTO negotiation(deal_id,offer_seq,terms_hash) VALUES (?1,?2,?3) ON CONFLICT(deal_id) DO UPDATE SET offer_seq=excluded.offer_seq,terms_hash=excluded.terms_hash,own_accept=0,peer_accept=0",params![id.to_string(),verified.envelope().seq,&t.hash()?.0[..]])?;
            }
            Body::Accept {
                offer_seq,
                terms_hash,
                ..
            } => {
                let (seq,hash,own,peer):(u32,Vec<u8>,bool,bool)=tx.query_row("SELECT offer_seq,terms_hash,own_accept,peer_accept FROM negotiation WHERE deal_id=?1",[id.to_string()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)))?;
                if *offer_seq != seq
                    || *terms_hash != hash_blob(hash)?
                    || *terms_hash != deal.terms.hash()?
                    || (direction == Direction::Outbound && own)
                    || (direction == Direction::Inbound && peer)
                    || deal.state != DealState::Negotiating
                {
                    return Err(LedgerError::Conflict);
                }
                // Shop around (T8): at most one table of a group holds our ACCEPT and at most one
                // ever agrees. Checked and claimed here, before the ACCEPT is recorded.
                let agrees = (direction == Direction::Outbound && peer)
                    || (direction == Direction::Inbound && own);
                crate::groups::accept_guard(tx, &deal, direction, agrees, at)?;
                let column = if direction == Direction::Outbound {
                    "own_accept"
                } else {
                    "peer_accept"
                };
                tx.execute(
                    &format!("UPDATE negotiation SET {column}=1 WHERE deal_id=?1"),
                    [id.to_string()],
                )?;
                // Our own ACCEPT is the deal's decision: the owner's signed consent above clause 6,
                // otherwise the agent under the clause-6 policy (agent ACCEPT refuses an ASK).
                if direction == Direction::Outbound {
                    let decided = if matches!(
                        &verified.envelope().body,
                        Body::Accept {
                            owner_accept: Some(_),
                            ..
                        }
                    ) {
                        DecidedBy::Human { at }
                    } else {
                        DecidedBy::Policy { clause: 6 }
                    };
                    tx.execute(
                        "UPDATE deals SET decided_by=?1 WHERE id=?2",
                        params![json_text(&decided)?, id.to_string()],
                    )?;
                }
                if (direction == Direction::Outbound && peer)
                    || (direction == Direction::Inbound && own)
                {
                    apply(tx, id, DealEvent::TwoAcceptsVerified, at)?;
                }
            }
            _ => {}
        }
        append_verified(tx, verified, direction, at)?;
        if let Some(event) = event {
            apply(tx, id, event, at)?;
        }
        Ok(())
    }
}
impl Ledger {
    /// Offline evidence verification also works after a mandate is revoked/superseded.
    pub fn verify_transcript(&self, id: DealId) -> Result<H256, LedgerError> {
        let deal = read_deal(&self.conn, id)?;
        let own: Vec<u8> = self.conn.query_row(
            "SELECT agent_pubkey FROM mandates WHERE id=?1 AND version=?2",
            params![deal.mandate_id.to_string(), deal.mandate_version],
            |r| r.get(0),
        )?;
        let peer: Vec<u8> = self.conn.query_row(
            "SELECT agent_pubkey FROM counterparties WHERE key_id=?1",
            [deal.counterparty.as_str()],
            |r| r.get(0),
        )?;
        let own = VerifyingKey::from_bytes(
            &own.try_into()
                .map_err(|_| LedgerError::Integrity("agent key length"))?,
        )
        .map_err(|_| ProtocolError::Signature)?;
        let peer = VerifyingKey::from_bytes(
            &peer
                .try_into()
                .map_err(|_| LedgerError::Integrity("peer key length"))?,
        )
        .map_err(|_| ProtocolError::Signature)?;
        let own_id = key_id(&own)?;
        let peer_id = key_id(&peer)?;
        if peer_id != deal.counterparty {
            return Err(ProtocolError::Binding.into());
        }
        let mut previous = H256::ZERO;
        let mut next_in = 1_u32;
        let mut next_out = 1_u32;
        let mut nonces = table_proto::MemoryNonces::default();
        let mut proposal = None;
        let mut statement=self.conn.prepare("SELECT dir,raw_jws,hash,prev,seq,received_at,verified FROM envelopes WHERE deal_id=?1 ORDER BY rowid")?;
        let mut rows = statement.query([id.to_string()])?;
        while let Some(row) = rows.next()? {
            let dir: String = row.get(0)?;
            let raw: String = row.get(1)?;
            let hash = hash_blob(row.get(2)?)?;
            let prev = hash_blob(row.get(3)?)?;
            let seq: u32 = row.get(4)?;
            let received: String = row.get(5)?;
            let is_verified: bool = row.get(6)?;
            let now = received
                .parse::<Timestamp>()
                .map_err(|_| LedgerError::Integrity("envelope timestamp"))?;
            let (sender, audience, next) = match dir.as_str() {
                "in" => (&peer, &own_id, &mut next_in),
                "out" => (&own, &peer_id, &mut next_out),
                _ => return Err(LedgerError::Integrity("envelope direction")),
            };
            let verified = verify(
                &raw,
                sender,
                &VerifyContext {
                    deal_id: id,
                    audience,
                    next_sender_seq: *next,
                    previous,
                    now,
                    nonces: &nonces,
                },
            )?;
            if let Body::Accept {
                owner_accept: Some(proof),
                ..
            } = &verified.envelope().body
            {
                let direction = if dir == "in" {
                    Direction::Inbound
                } else {
                    Direction::Outbound
                };
                check_owner_pin(&self.conn, &deal, direction, proof)?;
                if proposal
                    != Some((
                        proof.offer_seq,
                        proof.counter_hash,
                        direction != Direction::Inbound,
                        true,
                    ))
                {
                    return Err(ProtocolError::Binding.into());
                }
            }
            if matches!(
                verified.envelope().body,
                Body::Offer { .. } | Body::Counter { .. }
            ) {
                proposal = Some((
                    seq,
                    hash,
                    dir == "in",
                    matches!(verified.envelope().body, Body::Counter { .. }),
                ));
            }
            if !is_verified
                || verified.hash() != hash
                || verified.envelope().prev != prev
                || verified.envelope().seq != seq
            {
                return Err(LedgerError::Integrity("envelope evidence"));
            }
            previous = verified.hash();
            nonces.record(verified.envelope().iss.clone(), verified.envelope().nonce);
            *next = next.checked_add(1).ok_or(ProtocolError::Sequence)?;
        }
        if previous != deal.transcript_head {
            return Err(LedgerError::Integrity("deal transcript head"));
        }
        Ok(previous)
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
    pub fn insert_mandate(
        &mut self,
        mandate: &OpenMandate,
        owner: &VerifyingKey,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        verify_mandate_signature(&mandate.payload, &mandate.owner_sig, owner)?;
        let payload = &mandate.payload;
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let latest: u32 = tx.query_row(
            "SELECT COALESCE(MAX(version),0) FROM mandates WHERE id=?1",
            [payload.id.to_string()],
            |r| r.get(0),
        )?;
        if payload.version != latest.checked_add(1).ok_or(LedgerError::Conflict)? {
            return Err(LedgerError::Conflict);
        }
        tx.execute(
            "UPDATE mandates SET status='superseded' WHERE id=?1 AND status='active'",
            [payload.id.to_string()],
        )?;
        tx.execute("INSERT INTO mandates(id,version,kind,body_json,body_hash,owner_sig,agent_pubkey,status,created_at) VALUES (?1,?2,'open',?3,?4,?5,?6,'active',?7)",params![payload.id.to_string(),payload.version,json_text(payload)?,&payload.hash()?.0[..],mandate.owner_sig,&payload.agent_key[..],at.to_string()])?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "mandate.signed".into(),
                deal_id: None,
                detail: json!({"id":payload.id,"version":payload.version,"commitment":payload.hash()?}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn active_mandate(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError> {
        let m = read_mandate(&self.conn, id, version)?;
        verify_mandate_signature(&m.payload, &m.owner_sig, owner)?;
        Ok(m)
    }
    /// Historical signed evidence only. Never use this to grant execution authority.
    pub fn mandate_evidence(
        &self,
        id: MandateId,
        version: u32,
        owner: &VerifyingKey,
    ) -> Result<OpenMandate, LedgerError> {
        let m = read_mandate_evidence(&self.conn, id, version)?;
        verify_mandate_signature(&m.payload, &m.owner_sig, owner)?;
        Ok(m)
    }
    pub fn revoke_mandate(&mut self, id: MandateId, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if tx.execute(
            "UPDATE mandates SET status='revoked' WHERE id=?1 AND status='active'",
            [id.to_string()],
        )? != 1
        {
            return Err(LedgerError::NotFound);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "mandate.revoked".into(),
                deal_id: None,
                detail: json!({"id":id}),
            },
        )?;
        tx.commit()?;
        Ok(())
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
    /// deadline. Never a money call; an authorization needs the void path instead.
    pub fn apply_deadline_default(&mut self, id: DealId, at: Timestamp) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let due: Timestamp = tx
            .query_row(
                "SELECT due_at FROM deadlines WHERE deal_id=?1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
        if due > at {
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
    /// Rejection reason and digest only: rejected payload text never reaches the audit log.
    pub fn receive(
        &mut self,
        id: DealId,
        raw: &str,
        at: Timestamp,
    ) -> Result<VerifiedEnvelope, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, id)?;
        let m = read_mandate(&tx, deal.mandate_id, deal.mandate_version)?;
        let (agent, confirmed): (Vec<u8>, Option<String>) = tx.query_row(
            "SELECT agent_pubkey,words_confirmed_at FROM counterparties WHERE key_id=?1",
            [deal.counterparty.as_str()],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if confirmed.is_none() {
            return Err(ProtocolError::Binding.into());
        }
        let agent: [u8; 32] = agent.try_into().map_err(|_| ProtocolError::Signature)?;
        let sender = VerifyingKey::from_bytes(&agent).map_err(|_| ProtocolError::Signature)?;
        let own = key_id(
            &VerifyingKey::from_bytes(&m.payload.agent_key)
                .map_err(|_| ProtocolError::Signature)?,
        )?;
        let next: u32 = tx.query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM envelopes WHERE deal_id=?1 AND dir='in'",
            [id.to_string()],
            |r| r.get(0),
        )?;
        let checked = verify(
            raw,
            &sender,
            &VerifyContext {
                deal_id: id,
                audience: &own,
                next_sender_seq: next,
                previous: deal.transcript_head,
                now: at,
                nonces: &DbNonces(&tx),
            },
        );
        match checked {
            Ok(verified) => {
                append_verified(&tx, &verified, Direction::Inbound, at)?;
                tx.commit()?;
                Ok(verified)
            }
            Err(error) => {
                audit::append(
                    &tx,
                    &AuditEntry {
                        at,
                        actor: format!("peer:{}", deal.counterparty),
                        action: "envelope.rejected".into(),
                        deal_id: Some(id),
                        detail: json!({"reason":error.to_string(),"raw_hash":H256::digest(raw.as_bytes())}),
                    },
                )?;
                tx.commit()?;
                Err(error.into())
            }
        }
    }
    /// Trusted application use: mandates must pass before constructing outbound messages.
    pub fn record_outbound(
        &mut self,
        verified: &VerifiedEnvelope,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        append_verified(&tx, verified, Direction::Outbound, at)?;
        tx.commit()?;
        Ok(())
    }
    pub fn envelope_count(&self, id: DealId, direction: Direction) -> Result<u64, LedgerError> {
        crate::count(self.conn.query_row(
            "SELECT COUNT(*) FROM envelopes WHERE deal_id=?1 AND dir=?2",
            params![id.to_string(), direction.as_str()],
            |r| r.get(0),
        )?)
    }
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
        tx.execute("UPDATE deals SET receipt_evidence='paypal_verified',reconciliation='pending_reporting' WHERE id=?1 AND side='seller' AND EXISTS(SELECT 1 FROM operations WHERE deal_id=?1 AND operation='capture' AND status='confirmed')",[e.deal_id.to_string()])?;
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
