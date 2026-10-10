use crate::{Ledger, LedgerError};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::OptionalExtension;
use table_core::*;
use table_proto::{Body, Envelope};
impl Ledger {
    pub fn display_number(&self, id: DealId) -> Result<u32, LedgerError> {
        Ok(self.conn.query_row(
            "SELECT number FROM deal_labels WHERE deal_id=?1",
            [id.to_string()],
            |r| r.get(0),
        )?)
    }
    pub fn counterparty_list(&self) -> Result<Vec<CounterpartyDisplay>, LedgerError> {
        // UNCONFIRMED counts as a closed deal (it ended), never as a paid one: this count says closed.
        let mut stmt = self.conn.prepare("SELECT c.key_id,c.display_name,c.paired_via,c.first_seen,
            (SELECT COUNT(*) FROM deals d WHERE d.counterparty=c.key_id AND d.state IN ('RECEIPTED','RECONCILED','UNCONFIRMED')),
            c.words_confirmed_at,c.declared_payee
            FROM counterparties c WHERE c.key_id NOT LIKE 'sub:%' ORDER BY c.key_id")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, u32>(4)?,
                r.get::<_, Option<String>>(5)?,
                r.get::<_, Option<String>>(6)?,
            ))
        })?;
        rows.map(|row| {
            let (key, name, via, at, closed, confirmed, payee) = row?;
            let pairing = match (confirmed.is_some(), via.as_str()) {
                (true, "house") => CounterpartyPairing::HousePinned,
                (true, _) => CounterpartyPairing::WordsConfirmed,
                (false, _) => CounterpartyPairing::Unpaired,
            };
            // The name is entered locally at owner confirmation, never from HELLO; a key the owner
            // never confirmed gets fixed text. URL-shaped local labels are also kept out.
            let name = name
                .filter(|_| pairing != CounterpartyPairing::Unpaired)
                .filter(|s| !s.contains([':', '/', '\\', '@']) && !s.chars().any(char::is_control))
                .unwrap_or_else(|| {
                    if pairing == CounterpartyPairing::Unpaired {
                        "Unpaired counterparty".into()
                    } else {
                        "Paired counterparty".into()
                    }
                });
            Ok(CounterpartyDisplay {
                key_id: KeyId::new(key).map_err(|_| LedgerError::Integrity("key"))?,
                display_name: name,
                house: pairing == CounterpartyPairing::HousePinned,
                first_seen: at
                    .parse()
                    .map_err(|_| LedgerError::Integrity("timestamp"))?,
                deals_closed: closed,
                pairing,
                // A closed identifier; a stored value that no longer parses is withheld.
                declared_payee: payee.and_then(|p| PayeeRef::new(p).ok()),
            })
        })
        .collect()
    }
    /// The counterparty's latest signed NOTE on this deal, as quarantined plain text. The chain is
    /// re-verified first, exactly as for the transcript; the text is only length-capped, never
    /// parsed or interpreted.
    pub fn latest_note(&self, id: DealId) -> Result<Option<CounterpartyNote>, LedgerError> {
        self.verify_transcript(id)?;
        let raw: Option<String> = self
            .conn
            .query_row(
                "SELECT raw_jws FROM envelopes WHERE deal_id=?1 AND dir='in' AND typ='NOTE' ORDER BY seq DESC LIMIT 1",
                [id.to_string()],
                |r| r.get(0),
            )
            .optional()?;
        let Some(raw) = raw else {
            return Ok(None);
        };
        let payload = URL_SAFE_NO_PAD
            .decode(raw.split('.').nth(1).ok_or(LedgerError::Integrity("JWS"))?)
            .map_err(|_| LedgerError::Integrity("JWS"))?;
        let e: Envelope = serde_json::from_slice(&payload)?;
        let Body::Note { text } = e.body else {
            return Err(LedgerError::Integrity("note type"));
        };
        Ok(Some(CounterpartyNote {
            deal_id: id,
            seq: e.seq,
            at: e.iat,
            text: text.as_str().chars().take(NOTE_MAX_CHARS).collect(),
        }))
    }
    pub fn deal_transcript(&self, id: DealId) -> Result<Vec<TranscriptStep>, LedgerError> {
        self.verify_transcript(id)?;
        let mut stmt = self
            .conn
            .prepare("SELECT dir,raw_jws FROM envelopes WHERE deal_id=?1 ORDER BY rowid")?;
        let rows = stmt.query_map([id.to_string()], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut steps = Vec::new();
        for row in rows {
            let (dir, raw) = row?;
            let payload = URL_SAFE_NO_PAD
                .decode(raw.split('.').nth(1).ok_or(LedgerError::Integrity("JWS"))?)
                .map_err(|_| LedgerError::Integrity("JWS"))?;
            let e: Envelope = serde_json::from_slice(&payload)?;
            let (typ, price) = match e.body {
                Body::Listing { ask, .. } => (TranscriptType::Listing, Some(ask)),
                Body::Offer { price, .. } => (TranscriptType::Offer, Some(price)),
                Body::Counter { price, .. } => (TranscriptType::Counter, Some(price)),
                Body::Accept { .. } => (TranscriptType::Accept, None),
                Body::Withdraw { .. } => (TranscriptType::Withdraw, None),
                Body::Settle { amount, .. } => (TranscriptType::Settle, Some(amount)),
                Body::Receipt { amount, .. } => (TranscriptType::Receipt, Some(amount)),
                Body::Hello { .. } | Body::Note { .. } | Body::Approved { .. } => continue,
            };
            steps.push(TranscriptStep {
                seq: e.seq,
                by: if dir == "out" {
                    TranscriptBy::You
                } else {
                    TranscriptBy::Them
                },
                typ,
                price,
                at: e.iat,
                verified: true,
            });
        }
        Ok(steps)
    }
}
