//! Offline transcript verification: replays a deal's stored envelopes against the pinned keys.
use crate::repositories::{Direction, check_owner_pin, read_deal};
use crate::{Ledger, LedgerError, hash_blob};
use ed25519_dalek::VerifyingKey;
use rusqlite::params;
use table_core::{DealId, H256, Timestamp};
use table_proto::{Body, ProtocolError, VerifyContext, key_id, verify};

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
}
