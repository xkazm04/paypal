//! "Your safety record" (moonshot card ops-and-delivery-1, slice 2): the hostile-agent gauntlet's
//! whole-ledger money-authority predicate ([`table_verify::safety`]) run on the owner's own
//! ledger. Read-only: it verifies the audit chain once, exports the newest deals' unsigned slices
//! (each export re-verifies the deal's transcript), counts money steps by authority and refusals
//! by kind, and lists every break of the invariant. It writes nothing and calls nothing outside
//! the process. No counterparty text is read into the answer: the predicate runs without note
//! needles here, and findings name steps, rules and paths only.
use crate::{Runtime, app};
use table_client::{
    CommandError, SAFETY_DEALS, SAFETY_VIOLATIONS, SafetyMoney, SafetyRecord, SafetyRefusalCount,
    SafetyRefusalFamily, SafetyViolation, SafetyViolationKind,
};
use table_core::RefusalCode;
use table_ledger::LedgerError;
use table_verify::safety::{self, Authority, Tally, Violation, ViolationKind};

impl Runtime {
    pub(crate) fn safety_record(&self) -> Result<SafetyRecord, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let owner = self.owner()?.verifying_key();
        let now = self.clock.now();
        let records = app(ledger.audit_count())?;
        match ledger.verify_audit() {
            Ok(_) => {}
            // A broken chain is the finding; nothing past it can be trusted, so nothing is counted.
            Err(error @ (LedgerError::Integrity(_) | LedgerError::Json(_))) => {
                return Ok(record(
                    now,
                    records,
                    None,
                    0,
                    &[],
                    safety::ledger_violations(Err(error.to_string()), &[], &[]),
                ));
            }
            Err(error) => return app(Err(error)),
        }
        let export =
            app(ledger.export_proofs(SAFETY_DEALS, &owner, now, self.house_release.as_ref()))?;
        let deals: Vec<safety::DealExport> = export
            .deals
            .into_iter()
            .map(|deal| deal.map_err(|(id, error)| (id, error.to_string())))
            .collect();
        let found = safety::ledger_violations(Ok(()), &deals, &[]);
        Ok(record(
            now,
            records,
            Some(export.head),
            export.total,
            &deals,
            found,
        ))
    }
}

/// The record from the chain's facts, the exports and the predicate's findings. Pure.
fn record(
    now: i64,
    records: u64,
    head: Option<table_core::H256>,
    deals_total: u64,
    deals: &[safety::DealExport],
    found: Vec<Violation>,
) -> SafetyRecord {
    let tally = safety::tally(deals.iter().filter_map(|d| d.as_ref().ok()));
    let violations_total = u32::try_from(found.len()).unwrap_or(u32::MAX);
    SafetyRecord {
        checked_at: now,
        records,
        intact: head.is_some(),
        head,
        deals_total,
        deals_checked: u32::try_from(deals.len()).unwrap_or(u32::MAX),
        transcripts_verified: tally.transcripts,
        money: money(&tally),
        refusals: u32::try_from(tally.refusals.len()).unwrap_or(u32::MAX),
        refusal_families: families(&tally.refusals),
        refused_deals: tally.refused_deals,
        refused_deal_calls: tally.refused_deal_calls,
        violations: found
            .into_iter()
            .take(SAFETY_VIOLATIONS)
            .map(|v| SafetyViolation {
                deal_id: v.deal,
                kind: kind(v.kind),
                detail: v.detail,
            })
            .collect(),
        violations_total,
    }
}

fn money(tally: &Tally) -> SafetyMoney {
    let (safe_default, safe_default_voids) = tally.steps_of(Authority::SafeDefault);
    SafetyMoney {
        owner: tally.steps_of(Authority::Owner).0,
        signed_rule: tally.steps_of(Authority::SignedRule).0,
        shop_rules: tally.steps_of(Authority::SellerRules).0,
        house_rules: tally.steps_of(Authority::HouseRules).0,
        safe_default,
        safe_default_voids,
    }
}

/// The kind of reason a refusal code is, in the owner's terms.
pub(crate) const fn family(code: Option<RefusalCode>) -> SafetyRefusalFamily {
    match code {
        Some(
            RefusalCode::MandateClause { .. }
            | RefusalCode::WalletLimit { .. }
            | RefusalCode::OutsideBand
            | RefusalCode::RoundsExhausted
            | RefusalCode::DeadlinePassed
            | RefusalCode::OwnerApproval { .. }
            | RefusalCode::GroupClosed,
        ) => SafetyRefusalFamily::YourRules,
        Some(RefusalCode::ShieldHold { .. }) => SafetyRefusalFamily::ScamCheck,
        Some(
            RefusalCode::NotYourTurn
            | RefusalCode::TableClosed
            | RefusalCode::Paused
            | RefusalCode::RunEnded
            | RefusalCode::SessionNotEnabled,
        ) => SafetyRefusalFamily::OutOfTurn,
        Some(RefusalCode::ToolAbsent | RefusalCode::OutOfScope) => SafetyRefusalFamily::NotAllowed,
        Some(
            RefusalCode::MalformedCall
            | RefusalCode::InvalidRequest
            | RefusalCode::MarketUnavailable
            | RefusalCode::Unavailable,
        ) => SafetyRefusalFamily::Unusable,
        None => SafetyRefusalFamily::Older,
    }
}

/// Refusal counts per family, in the family order, families with none left out.
fn families(codes: &[Option<RefusalCode>]) -> Vec<SafetyRefusalCount> {
    let mut out: Vec<SafetyRefusalCount> = Vec::new();
    for code in codes {
        let family = family(*code);
        match out.iter_mut().find(|c| c.family == family) {
            Some(count) => count.count = count.count.saturating_add(1),
            None => out.push(SafetyRefusalCount { family, count: 1 }),
        }
    }
    out.sort_by_key(|c| c.family);
    out
}

const fn kind(kind: ViolationKind) -> SafetyViolationKind {
    match kind {
        ViolationKind::Authority => SafetyViolationKind::Authority,
        ViolationKind::UntrackedCall => SafetyViolationKind::UntrackedCall,
        ViolationKind::CounterpartyText => SafetyViolationKind::CounterpartyText,
        ViolationKind::RefusedDealCalled => SafetyViolationKind::RefusedDealCalled,
        ViolationKind::VerifierCheck => SafetyViolationKind::VerifierCheck,
        ViolationKind::ChainBroken => SafetyViolationKind::ChainBroken,
        ViolationKind::EvidenceUnreadable => SafetyViolationKind::EvidenceUnreadable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_refusal_code_has_a_family_and_a_row_without_one_is_older() {
        for code in RefusalCode::ALL {
            assert_ne!(family(Some(code)), SafetyRefusalFamily::Older, "{code:?}");
        }
        assert_eq!(family(None), SafetyRefusalFamily::Older);
        let counted = families(&[
            Some(RefusalCode::ToolAbsent),
            None,
            Some(RefusalCode::OutsideBand),
            Some(RefusalCode::MandateClause { clause: 3 }),
        ]);
        assert_eq!(
            counted,
            vec![
                SafetyRefusalCount {
                    family: SafetyRefusalFamily::YourRules,
                    count: 2
                },
                SafetyRefusalCount {
                    family: SafetyRefusalFamily::NotAllowed,
                    count: 1
                },
                SafetyRefusalCount {
                    family: SafetyRefusalFamily::Older,
                    count: 1
                },
            ]
        );
    }
}
