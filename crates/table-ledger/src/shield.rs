//! The scam shield's record on a deal (shield slice 2, migration 0013): the verdict, the rule
//! that decided it and the terms it was computed for; the owner's release of a hold, bound to
//! those terms; and one audit row per money step the shield refused. Every write is in one
//! transaction with its audit row. Only typed values are written: a verdict, a closed rule name,
//! a terms hash and a time. Counterparty text never reaches any of it.
use crate::repositories::{enum_text, json_text, parse_enum, read_deal};
use crate::{Ledger, LedgerError, audit, audit::AuditEntry, hash_blob};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde_json::json;
use table_core::{
    DealId, DealState, DecidedBy, H256, ShieldRelease, ShieldRule, ShieldVerdict, Timestamp,
};

/// The raw columns, before the projection drops a verdict computed for other terms.
struct Stored {
    verdict: Option<ShieldVerdict>,
    rule: Option<ShieldRule>,
    terms: Option<H256>,
    release: Option<ShieldRelease>,
}
impl Stored {
    /// A verdict raised from outside the rules (a second opinion, the order check's payee BLOCK,
    /// a settlement mismatch) holds whatever the terms; a computed one is tied to its terms.
    fn raised(&self) -> bool {
        self.verdict.is_some() && self.terms.is_none()
    }
}
fn stored(conn: &Connection, id: DealId) -> Result<Stored, LedgerError> {
    let row = conn
        .query_row(
            "SELECT shield_verdict,shield_rule,shield_terms,shield_release_json FROM deals WHERE id=?1",
            [id.to_string()],
            |r| {
                Ok((
                    r.get::<_, Option<String>>(0)?,
                    r.get::<_, Option<String>>(1)?,
                    r.get::<_, Option<Vec<u8>>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or(LedgerError::NotFound)?;
    Ok(Stored {
        verdict: row.0.map(parse_enum).transpose()?,
        rule: row.1.map(parse_enum).transpose()?,
        terms: row.2.map(hash_blob).transpose()?,
        release: row.3.map(|text| serde_json::from_str(&text)).transpose()?,
    })
}
fn write(
    conn: &Connection,
    id: DealId,
    verdict: ShieldVerdict,
    rule: Option<ShieldRule>,
    terms: Option<H256>,
    release: Option<&ShieldRelease>,
    at: Timestamp,
) -> Result<(), LedgerError> {
    conn.execute(
        "UPDATE deals SET shield_verdict=?1,shield_rule=?2,shield_terms=?3,shield_release_json=?4,updated_at=?5 WHERE id=?6",
        params![
            enum_text(&verdict)?,
            rule.as_ref().map(enum_text).transpose()?,
            terms.map(|t| t.0.to_vec()),
            release.map(json_text).transpose()?,
            at.to_string(),
            id.to_string()
        ],
    )?;
    Ok(())
}
impl Ledger {
    /// Records the verdict the shield computed for a money step on `terms_hash`, and the rule
    /// that decided it, in the deal row and one audit row. Writes only when something changed,
    /// so a step the scheduler retries every tick records its verdict once. A raised verdict is
    /// only ever raised further here (it stays raised), or, when released, takes the rule of a
    /// HOLD its release does not cover; a BLOCK never changes. A release survives only a HOLD
    /// recorded again for the same terms, and covers only the rules it names. Returns whether a
    /// row was written.
    pub fn record_shield(
        &mut self,
        id: DealId,
        verdict: ShieldVerdict,
        rule: Option<ShieldRule>,
        terms_hash: H256,
        at: Timestamp,
    ) -> Result<bool, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let s = stored(&tx, id)?;
        // A raised HOLD with a release for these terms, and a HOLD judged for a rule on the
        // other side of that release: a rule it does not cover (a new hold the release would
        // otherwise hide), or one it does once the uncovered rule stopped holding. The judged
        // rule is recorded, so the deal shows the hold that is really there, naming its rule;
        // the release stays beside it for the rules it covers (the owner's next release adds
        // the rest). Without a live release nothing is hidden and nothing changes here.
        let moved = s.raised()
            && verdict == ShieldVerdict::Hold
            && s.verdict == Some(verdict)
            && rule.is_some()
            && rule != s.rule
            && s.release
                .as_ref()
                .is_some_and(|r| r.terms_hash == terms_hash && r.covers(rule) != r.covers(s.rule));
        let terms = if s.raised() {
            if s.verdict.is_some_and(|old| verdict <= old) && !moved {
                return Ok(false);
            }
            None
        } else {
            if s.verdict == Some(ShieldVerdict::Block)
                || (s.verdict == Some(verdict) && s.rule == rule && s.terms == Some(terms_hash))
            {
                return Ok(false);
            }
            Some(terms_hash)
        };
        let keep = verdict == ShieldVerdict::Hold && (terms.is_none() || s.terms == terms);
        let release = s.release.filter(|_| keep);
        write(&tx, id, verdict, rule, terms, release.as_ref(), at)?;
        // A CLEAR or ASK the rules computed is bookkeeping; a HOLD or BLOCK is a pause the
        // owner sees in the Rewind.
        let mut entry = AuditEntry {
            at,
            actor: "shield".into(),
            action: "shield.checked".into(),
            deal_id: Some(id),
            detail: json!({"verdict":verdict,"rule":rule,"terms_hash":terms}),
        };
        if verdict >= ShieldVerdict::Hold {
            entry.action = "shield.raised".into();
        }
        audit::append(&tx, &entry)?;
        tx.commit()?;
        Ok(true)
    }
    /// Raises a verdict from outside the rules: the quarantined second opinion's caution. It can
    /// only add caution (the stored verdict never goes down) and holds whatever the terms.
    pub fn raise_shield(
        &mut self,
        id: DealId,
        verdict: ShieldVerdict,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        self.raise_shield_for(id, verdict, ShieldRule::ModelCaution, at)
    }
    /// Raises a verdict for `rule` from outside the rules (the order check's payee BLOCK, or the
    /// second opinion). A raised HOLD or BLOCK is new information: any release is dropped.
    pub fn raise_shield_for(
        &mut self,
        id: DealId,
        verdict: ShieldVerdict,
        rule: ShieldRule,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let s = stored(&tx, id)?;
        let (final_verdict, final_rule) = match s.verdict {
            None => (verdict, Some(rule)),
            // An earlier raise keeps its own reason unless this one is more cautious.
            Some(old) if s.raised() && verdict <= old => (old, s.rule),
            Some(old) if verdict >= old => (verdict, Some(rule)),
            Some(old) => (old, s.rule),
        };
        let release = s
            .release
            .filter(|_| verdict < ShieldVerdict::Hold && final_verdict == ShieldVerdict::Hold);
        write(
            &tx,
            id,
            final_verdict,
            final_rule,
            None,
            release.as_ref(),
            at,
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "shield".into(),
                action: "shield.raised".into(),
                deal_id: Some(id),
                detail: json!({"verdict":final_verdict,"rule":final_rule}),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// The owner's release of the deal's HOLD (only from the approval window, under an owner
    /// ticket): it covers `rules` for `terms_hash` only, so a terms change or another rule holds
    /// again. The recorded HOLD stays as it is; the release sits beside it. Recorded as the
    /// owner's decision in the deal row (`decided_by`) and in a `shield.released` audit row. A
    /// BLOCK, a mismatch and a closed deal are never released.
    pub fn release_shield_hold(
        &mut self,
        id: DealId,
        rules: &[ShieldRule],
        terms_hash: H256,
        at: Timestamp,
    ) -> Result<(), LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let deal = read_deal(&tx, id)?;
        let s = stored(&tx, id)?;
        if s.verdict != Some(ShieldVerdict::Hold)
            || rules.is_empty()
            || deal.state.terminal()
            || deal.state == DealState::Mismatch
            || deal.terms.hash()? != terms_hash
        {
            return Err(LedgerError::Conflict);
        }
        let mut covered = s
            .release
            .filter(|r| r.terms_hash == terms_hash)
            .map(|r| r.rules)
            .unwrap_or_default();
        for rule in rules {
            if !covered.contains(rule) {
                covered.push(*rule);
            }
        }
        let release = ShieldRelease {
            terms_hash,
            rules: covered,
            at,
        };
        let decided_by = DecidedBy::Human { at };
        tx.execute(
            "UPDATE deals SET shield_release_json=?1,decided_by=?2,updated_at=?3 WHERE id=?4",
            params![
                json_text(&release)?,
                json_text(&decided_by)?,
                at.to_string(),
                id.to_string()
            ],
        )?;
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "owner".into(),
                action: "shield.released".into(),
                deal_id: Some(id),
                detail: json!({
                    "from": "hold",
                    "to": "released",
                    "rules": release.rules,
                    "terms_hash": terms_hash,
                    "decided_by": decided_by,
                }),
            },
        )?;
        tx.commit()?;
        Ok(())
    }
    /// One audit row per refusal of a money step by the shield: a refusal the scheduler meets
    /// again on every tick (same step, verdict, rule and terms, nothing in the shield's record
    /// changed since) is recorded once. Nothing else is written: no operation, no PayPal call.
    /// Returns whether the row was new.
    #[allow(clippy::too_many_arguments)] // One typed column per fact the row records.
    pub fn record_shield_refusal(
        &mut self,
        id: DealId,
        step: &str,
        attempt: u8,
        verdict: ShieldVerdict,
        rule: Option<ShieldRule>,
        refused: &DecidedBy,
        at: Timestamp,
    ) -> Result<bool, LedgerError> {
        let tx = self
            .conn
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let terms = read_deal(&tx, id)?.terms.hash()?;
        // The same refusal again (step, verdict, rule and terms) is one row while the shield's
        // record of the deal has not changed since it; after a new hold, a release or a new
        // verdict, the step refused again is another refusal and gets its own row.
        let seen: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM audit_log r WHERE r.deal_id=?1 AND r.action='shield.refused' AND json_extract(r.detail_json,'$.step')=?2 AND json_extract(r.detail_json,'$.verdict')=?3 AND json_extract(r.detail_json,'$.rule') IS ?4 AND json_extract(r.detail_json,'$.terms_hash') IS json(?5) AND r.seq>(SELECT COALESCE(MAX(c.seq),0) FROM audit_log c WHERE c.deal_id=?1 AND c.action IN ('shield.checked','shield.raised','shield.released')))",
            params![
                id.to_string(),
                step,
                enum_text(&verdict)?,
                rule.as_ref().map(enum_text).transpose()?,
                serde_json::to_string(&terms)?,
            ],
            |r| r.get(0),
        )?;
        if seen {
            return Ok(false);
        }
        audit::append(
            &tx,
            &AuditEntry {
                at,
                actor: "shield".into(),
                action: "shield.refused".into(),
                deal_id: Some(id),
                detail: json!({
                    "step": step,
                    "attempt": attempt,
                    "verdict": verdict,
                    "rule": rule,
                    "terms_hash": terms,
                    "refused_authority": refused,
                }),
            },
        )?;
        tx.commit()?;
        Ok(true)
    }
}
