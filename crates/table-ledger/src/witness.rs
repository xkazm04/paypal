//! A buyer wallet's witness of the house's record (T9): the house's signed audit-chain head kept
//! beside a HOUSE deal's receipt, later heads, and how they compare. Evidence only: nothing here
//! moves, holds or releases money, and a warning changes no deal state.
use crate::{AuditEntry, Ledger, LedgerError, audit, repositories::json_text};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use table_core::{DealId, HouseRecord, HouseRecordState, Timestamp};
use table_proto::{
    HeadVerdict, HouseHead, HouseRelease, SignedHouseHead, SignedHousePrefix, compare_heads,
    prefix_contradicts,
};

/// A head the wallet kept, with the prefix fetched alongside it.
#[derive(Debug, Clone)]
pub struct KeptHead {
    pub id: i64,
    pub deal_id: Option<DealId>,
    pub head: SignedHouseHead,
    pub prefix: Option<SignedHousePrefix>,
    pub kept_at: Timestamp,
}

fn kept(row: (i64, Option<String>, String, Option<String>, i64)) -> Result<KeptHead, LedgerError> {
    let (id, deal, head, prefix, kept_at) = row;
    Ok(KeptHead {
        id,
        deal_id: deal
            .map(|d| d.parse())
            .transpose()
            .map_err(|_| LedgerError::Integrity("deal id"))?,
        head: serde_json::from_str(&head)?,
        prefix: prefix.map(|p| serde_json::from_str(&p)).transpose()?,
        kept_at,
    })
}
const COLUMNS: &str = "id,deal_id,head_json,prefix_json,kept_at";
type Row = (i64, Option<String>, String, Option<String>, i64);
fn row(r: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
}
/// What one later head says about a kept one.
fn state_of(verdict: HeadVerdict) -> HouseRecordState {
    match verdict {
        HeadVerdict::Same | HeadVerdict::Extends => HouseRecordState::Holds,
        HeadVerdict::Longer => HouseRecordState::Longer,
        HeadVerdict::NewEpoch => HouseRecordState::Restarted,
        HeadVerdict::Shorter => HouseRecordState::Shorter,
        HeadVerdict::Rewritten => HouseRecordState::Rewritten,
    }
}
/// The most telling of two states: any warning beats reassurance, the worst warning wins, a
/// proven extension beats an unchecked one.
fn rank(state: HouseRecordState) -> u8 {
    match state {
        HouseRecordState::Kept => 0,
        HouseRecordState::Longer => 1,
        HouseRecordState::Holds => 2,
        HouseRecordState::Restarted => 3,
        HouseRecordState::Shorter => 4,
        HouseRecordState::Rewritten => 5,
    }
}

/// Pure fold: the record of a kept head against every head kept after it and every prefix kept
/// at any time.
pub fn house_record_of(receipt: &KeptHead, others: &[KeptHead]) -> HouseRecord {
    let base: &HouseHead = &receipt.head.head;
    let mut state = HouseRecordState::Kept;
    let mut checked_at = None;
    let mut fold = |next: HouseRecordState| {
        if rank(next) > rank(state) {
            state = next;
        }
    };
    for other in others {
        if other
            .prefix
            .as_ref()
            .is_some_and(|p| prefix_contradicts(base, &p.prefix))
        {
            fold(HouseRecordState::Rewritten);
        }
        if other.id <= receipt.id {
            continue;
        }
        checked_at = Some(other.kept_at);
        let prefix = other
            .prefix
            .as_ref()
            .map(|p| &p.prefix)
            .filter(|p| p.row_count == base.row_count);
        fold(state_of(compare_heads(base, &other.head.head, prefix)));
    }
    HouseRecord {
        state,
        kept_at: receipt.kept_at,
        entries: base.row_count,
        checked_at,
    }
}

impl Ledger {
    /// Keeps a head the house signed, beside `deal`'s receipt or as a later check. Refuses a head
    /// or prefix that does not verify against the release pin, a receipt head for a deal that is
    /// not a receipted HOUSE purchase, and a second receipt head for the same deal.
    pub fn keep_house_head(
        &mut self,
        release: &HouseRelease,
        deal: Option<DealId>,
        head: &SignedHouseHead,
        prefix: Option<&SignedHousePrefix>,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        head.verify(release)
            .map_err(|_| LedgerError::Integrity("house head signature"))?;
        if let Some(p) = prefix {
            p.verify(release)
                .map_err(|_| LedgerError::Integrity("house prefix signature"))?;
        }
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        if let Some(id) = deal {
            let eligible: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM deals d JOIN counterparties c ON c.key_id=d.counterparty WHERE d.id=?1 AND d.side='buyer' AND c.paired_via='house' AND d.state IN ('RECEIPTED','RECONCILED'))",
                [id.to_string()],
                |r| r.get(0),
            )?;
            if !eligible {
                return Err(LedgerError::Conflict);
            }
        }
        tx.execute(
            "INSERT INTO house_heads(deal_id,kind,head_json,prefix_json,kept_at) VALUES (?1,?2,?3,?4,?5)",
            params![
                deal.map(|d| d.to_string()),
                if deal.is_some() { "receipt" } else { "check" },
                json_text(head)?,
                prefix.map(json_text).transpose()?,
                at
            ],
        )?;
        let detail = serde_json::json!({
            "epoch": head.head.epoch,
            "row_count": head.head.row_count,
            "audit_head": head.head.audit_head,
            "prefix_rows": prefix.map(|p| p.prefix.row_count),
        });
        let entry = match deal {
            Some(_) => AuditEntry {
                at,
                actor: "house-witness".into(),
                action: "house.head_kept".into(),
                deal_id: deal,
                detail,
            },
            None => AuditEntry {
                at,
                actor: "house-witness".into(),
                action: "house.head_checked".into(),
                deal_id: None,
                detail,
            },
        };
        audit::append(&tx, &entry)?;
        tx.commit()?;
        Ok(())
    }
    /// Receipted HOUSE purchases with no head kept yet, oldest first, with the time the deal
    /// last changed (its receipt, or a later reconciliation).
    pub fn house_deals_awaiting_head(&self) -> Result<Vec<(DealId, Timestamp)>, LedgerError> {
        let mut statement = self.conn.prepare(
            "SELECT d.id,d.updated_at FROM deals d JOIN counterparties c ON c.key_id=d.counterparty WHERE d.side='buyer' AND c.paired_via='house' AND d.state IN ('RECEIPTED','RECONCILED') AND NOT EXISTS(SELECT 1 FROM house_heads h WHERE h.deal_id=d.id) ORDER BY d.id LIMIT 16",
        )?;
        statement
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .map(|row| {
                let (id, at) = row?;
                Ok((
                    id.parse().map_err(|_| LedgerError::Integrity("deal id"))?,
                    at.parse()
                        .map_err(|_| LedgerError::Integrity("deal timestamp"))?,
                ))
            })
            .collect()
    }
    /// The newest head kept beside a receipt: the one a later check proves the house extends.
    pub fn house_anchor(&self) -> Result<Option<KeptHead>, LedgerError> {
        self.conn
            .query_row(
                &format!(
                    "SELECT {COLUMNS} FROM house_heads WHERE kind='receipt' ORDER BY id DESC LIMIT 1"
                ),
                [],
                row,
            )
            .optional()?
            .map(kept)
            .transpose()
    }
    /// The head kept beside `deal`'s receipt.
    pub fn house_receipt_head(&self, deal: DealId) -> Result<Option<KeptHead>, LedgerError> {
        self.conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM house_heads WHERE deal_id=?1 AND kind='receipt'"),
                [deal.to_string()],
                row,
            )
            .optional()?
            .map(kept)
            .transpose()
    }
    /// How the house's later record compares with the head kept beside `deal`'s receipt; `None`
    /// when no head was kept for it.
    pub fn house_record(&self, deal: DealId) -> Result<Option<HouseRecord>, LedgerError> {
        let Some(receipt) = self.house_receipt_head(deal)? else {
            return Ok(None);
        };
        let mut statement = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM house_heads WHERE id>?1 OR prefix_json IS NOT NULL ORDER BY id"
        ))?;
        let others = statement
            .query_map([receipt.id], row)?
            .map(|r| kept(r?))
            .collect::<Result<Vec<_>, LedgerError>>()?;
        Ok(Some(house_record_of(&receipt, &others)))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use table_core::{H256, PayeeRef};
    use table_proto::{HousePrefix, SignedHousePrefix};

    fn keys() -> (SigningKey, HouseRelease) {
        let owner = SigningKey::from_bytes(&[1; 32]);
        let agent = SigningKey::from_bytes(&[2; 32]);
        let commitment = H256([3; 32]);
        let release = HouseRelease {
            owner_key: owner.verifying_key().to_bytes(),
            agent_key: agent.verifying_key().to_bytes(),
            payee: PayeeRef::new("house").unwrap(),
            mandate_commitment: commitment,
            owner_signature: owner.sign(&commitment.0).to_bytes().to_vec(),
        };
        (agent, release)
    }
    fn head(agent: &SigningKey, epoch: u8, rows: u64, hash: u8, at: Timestamp) -> SignedHouseHead {
        let head = HouseHead {
            epoch: H256([epoch; 32]),
            epoch_started: 1,
            row_count: rows,
            audit_head: H256([hash; 32]),
            at,
        };
        SignedHouseHead {
            signature: agent
                .sign(&head.signing_bytes().unwrap())
                .to_bytes()
                .to_vec(),
            head,
        }
    }
    fn prefix(agent: &SigningKey, rows: u64, hash: u8, within: u64) -> SignedHousePrefix {
        let prefix = HousePrefix {
            epoch: H256([1; 32]),
            row_count: rows,
            audit_head: H256([hash; 32]),
            within,
            at: 50,
        };
        SignedHousePrefix {
            signature: agent
                .sign(&prefix.signing_bytes().unwrap())
                .to_bytes()
                .to_vec(),
            prefix,
        }
    }
    fn kept(id: i64, head: SignedHouseHead, prefix: Option<SignedHousePrefix>) -> KeptHead {
        KeptHead {
            id,
            deal_id: None,
            kept_at: id * 10,
            head,
            prefix,
        }
    }

    #[test]
    fn house_heads_are_verified_on_keep_audited_and_append_only() {
        let (agent, release) = keys();
        let mut ledger = Ledger::in_memory().unwrap();
        let good = head(&agent, 1, 10, 7, 20);
        ledger
            .keep_house_head(&release, None, &good, None, 30)
            .unwrap();
        assert_eq!(ledger.audit_count().unwrap(), 1);
        ledger.verify_audit().unwrap();
        // A head or prefix the pinned house key did not sign is never kept.
        let mut forged = good.clone();
        forged.head.row_count = 11;
        assert!(
            ledger
                .keep_house_head(&release, None, &forged, None, 31)
                .is_err()
        );
        let stranger = head(&SigningKey::from_bytes(&[9; 32]), 1, 10, 7, 20);
        assert!(
            ledger
                .keep_house_head(&release, None, &stranger, None, 31)
                .is_err()
        );
        let mut bad_prefix = prefix(&agent, 10, 7, 12);
        bad_prefix.signature[0] ^= 1;
        assert!(
            ledger
                .keep_house_head(&release, None, &good, Some(&bad_prefix), 31)
                .is_err()
        );
        // A receipt head only beside a receipted HOUSE purchase.
        let unknown: DealId = "01J0000000000000000000000A".parse().unwrap();
        assert!(matches!(
            ledger.keep_house_head(&release, Some(unknown), &good, None, 31),
            Err(LedgerError::Conflict)
        ));
        assert_eq!(ledger.audit_count().unwrap(), 1, "refusals write nothing");
        for sql in [
            "UPDATE house_heads SET kept_at=0",
            "DELETE FROM house_heads",
        ] {
            assert!(ledger.conn.execute(sql, []).is_err(), "{sql}");
        }
        assert!(
            ledger.house_anchor().unwrap().is_none(),
            "a check is no anchor"
        );
        assert!(ledger.house_record(unknown).unwrap().is_none());
    }

    #[test]
    fn house_record_takes_the_most_telling_later_head() {
        let (agent, _) = keys();
        let receipt = kept(1, head(&agent, 1, 10, 7, 20), None);
        let record = |others: &[KeptHead]| house_record_of(&receipt, others).state;
        assert_eq!(record(&[]), HouseRecordState::Kept);
        assert_eq!(
            house_record_of(&receipt, &[]).checked_at,
            None,
            "not compared yet"
        );
        let same = kept(2, head(&agent, 1, 10, 7, 80), None);
        assert_eq!(record(std::slice::from_ref(&same)), HouseRecordState::Holds);
        let longer = kept(3, head(&agent, 1, 14, 9, 90), None);
        assert_eq!(
            record(std::slice::from_ref(&longer)),
            HouseRecordState::Longer
        );
        let proven = kept(
            3,
            head(&agent, 1, 14, 9, 90),
            Some(prefix(&agent, 10, 7, 14)),
        );
        assert_eq!(record(&[proven]), HouseRecordState::Holds);
        let rewritten = kept(
            3,
            head(&agent, 1, 14, 9, 90),
            Some(prefix(&agent, 10, 8, 14)),
        );
        assert_eq!(record(&[rewritten]), HouseRecordState::Rewritten);
        let restarted = kept(4, head(&agent, 2, 3, 1, 95), None);
        assert_eq!(
            record(&[same.clone(), restarted.clone()]),
            HouseRecordState::Restarted
        );
        let shorter = kept(5, head(&agent, 1, 8, 7, 99), None);
        let folded = house_record_of(&receipt, &[same, longer, restarted, shorter]);
        assert_eq!(folded.state, HouseRecordState::Shorter, "the worst wins");
        assert_eq!((folded.entries, folded.checked_at), (10, Some(50)));
        // A head kept before the receipt says nothing about it.
        let earlier = kept(0, head(&agent, 1, 4, 2, 5), None);
        assert_eq!(record(&[earlier]), HouseRecordState::Kept);
    }
}
