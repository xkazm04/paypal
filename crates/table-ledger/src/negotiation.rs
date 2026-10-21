//! Negotiation and the signed envelope path: inbound receipt, outbound recording, the atomic
//! negotiation commit and the owner-accept checks.
use crate::mandates::{read_mandate, read_mandate_evidence};
use crate::repositories::{Direction, apply, enum_text, json_text, read_deal};
use crate::{AuditEntry, Ledger, LedgerError, audit, hash_blob};
use ed25519_dalek::VerifyingKey;
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use table_core::{Deal, DealEvent, DealId, DealState, DecidedBy, H256, KeyId, Terms, Timestamp};
use table_proto::{
    Body, NonceLookup, ProtocolError, VerifiedEnvelope, VerifyContext, key_id, verify,
    verify_mandate_signature,
};

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
pub(crate) fn check_owner_pin(
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
    pub fn pending_offer(&self, id: DealId) -> Result<(u32, H256), LedgerError> {
        let (seq, hash): (u32, Vec<u8>) = self
            .conn
            .query_row(
                "SELECT offer_seq,terms_hash FROM negotiation WHERE deal_id=?1",
                [id.to_string()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or(LedgerError::NotFound)?;
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
        crate::pin::require_live(&self.conn, &deal.counterparty, at)?;
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
        crate::pin::require_live(&tx, &deal.counterparty, at)?;
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
