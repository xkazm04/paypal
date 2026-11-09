//! The checks the second proof format (`table.proof.v2`) adds: the evidence the wallet records
//! since the first format, read only from the file.
//!
//! Each check makes a claim only about facts the file carries. When the deal has no such fact
//! (no owner decision, no second look at PayPal, no group, no shield hold, no house record) the
//! line reads "not checked" and says why; it neither passes nor fails. A v1 file carries none of
//! these records, so on a v1 file every one of them reads "not checked".
use crate::authority::{decision_fits, money_kind, operation_fits};
use crate::{Miss, detail, row_detail, short};
use serde_json::Value;
use table_core::{
    ApprovalCheck, ApprovalCheckId, ApprovalCheckStatus, DealState, DecidedBy, H256,
    MarketCommitment, ShieldRule, ShieldVerdict, checks_hash,
};
use table_proto::{
    DecisionStatement, HeadVerdict, PROOF_FORMAT_V1, ProofAuditRow, ProofBundle, compare_heads,
    prefix_contradicts,
};

fn older(bundle: &ProofBundle) -> Option<Miss> {
    (bundle.format == PROOF_FORMAT_V1).then(|| {
        Miss::absent("not checked: a file in the first proof format does not carry this record")
    })
}
fn text<'a>(value: &'a Value, field: &str) -> Option<&'a str> {
    value.get(field).and_then(Value::as_str)
}
fn typed<T: serde::de::DeserializeOwned>(value: &Value, field: &str) -> Option<T> {
    value
        .get(field)
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
fn rows<'a>(
    bundle: &'a ProofBundle,
    actions: &'a [&str],
) -> impl Iterator<Item = &'a ProofAuditRow> + 'a {
    bundle
        .audit
        .iter()
        .filter(move |r| actions.contains(&r.action.as_str()))
}

/// The audit door's mark for a word it would not keep (an email-shaped payee, a credential).
const REDACTED: &str = "[redacted]";

/// What the file lets a checker say about the checklist recorded with one owner decision.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Lines {
    /// An older row: only the hash of the checklist, not its lines.
    HashOnly,
    /// The lines are in the row and hash to the recorded hash.
    Recomputed(Vec<ApprovalCheck>),
    /// A line names a word the record does not keep, so the lines cannot be hashed again.
    Unkept,
}

/// The lines recorded with a decision, hashed again: the row's `checks` must hash to its
/// `checks_hash`, unless a line holds a word the audit door replaced.
fn lines_of(row: &ProofAuditRow, d: &Value) -> Result<Lines, Miss> {
    let Some(raw) = d.get("checks") else {
        return Ok(Lines::HashOnly);
    };
    let checks: Vec<ApprovalCheck> = serde_json::from_value(raw.clone()).map_err(|_| {
        format!(
            "the checklist recorded with the owner's decision (record #{}) cannot be read",
            row.seq
        )
    })?;
    if checks
        .iter()
        .any(|c| c.text.contains(REDACTED) || c.detail.contains(REDACTED))
    {
        return Ok(Lines::Unkept);
    }
    let recorded = typed::<H256>(d, "checks_hash");
    if recorded.is_none() || checks_hash(&checks).ok() != recorded {
        return Err(format!(
            "the checklist recorded with the owner's decision (record #{}) does not hash to the hash recorded with it",
            row.seq
        )
        .into());
    }
    Ok(Lines::Recomputed(checks))
}

/// Whether a decision row may stand behind the owner's money step `op`: it names that step (when
/// the row says which step it starts) and no line of its checklist failed (the shield line is the
/// one a release decides, so it may fail there).
fn stands_behind(row: &ProofAuditRow, d: &Value, lines: &Lines, op: &str) -> Result<(), String> {
    if let Some(named) = text(d, "operation")
        && !operation_fits(named, op)
    {
        return Err(format!(
            "the owner's decision (record #{}) names the {named} step, not the {op} step that follows it",
            row.seq
        ));
    }
    if let Lines::Recomputed(checks) = lines {
        let release = text(d, "decision") == Some("shield_release");
        if checks.iter().any(|c| {
            c.status == ApprovalCheckStatus::Fail && !(release && c.id == ApprovalCheckId::Shield)
        }) {
            return Err(format!(
                "the owner's {op} step (record #{}) was decided on a checklist with a failed line",
                row.seq
            ));
        }
    }
    Ok(())
}

/// Whether the owner key the file names signed this decision for the step it names
/// (`DecisionStatement`, under `table.owner-decision.v1`). A row with no signature (an older row,
/// or one written while the owner key could not be read) is unsigned; a signature that does not
/// verify, or a signed row missing a field the statement needs, fails.
fn signed_by_owner(bundle: &ProofBundle, row: &ProofAuditRow, d: &Value) -> Result<bool, Miss> {
    let Some(signature) = d.get("signature") else {
        return Ok(false);
    };
    let statement = (|| {
        let Some(DecidedBy::Human { at }) = typed::<DecidedBy>(d, "decided_by") else {
            return None;
        };
        Some(DecisionStatement {
            deal_id: bundle.deal.id,
            decision: text(d, "decision")?.to_owned(),
            operation: text(d, "operation")?.to_owned(),
            attempt: typed(d, "attempt")?,
            terms_hash: typed(d, "terms_hash")?,
            checks_hash: typed(d, "checks_hash")?,
            at,
        })
    })();
    let bytes: Option<Vec<u8>> = serde_json::from_value(signature.clone()).ok();
    match (statement, bytes) {
        (Some(statement), Some(bytes)) if statement.verify(&bundle.owner_key, &bytes) => Ok(true),
        _ => Err(format!(
            "the owner's decision (record #{}) is not signed by the owner key",
            row.seq
        )
        .into()),
    }
}

/// One decision as the file lets a checker read it: its checklist and whether the owner key
/// signed it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Seen {
    lines: Lines,
    signed: bool,
}

/// A decision whose row carries the lines of the checklist the owner saw comes from a wallet that
/// signs every decision it records that way, unless it could not read the owner key then. Such a
/// row without the owner key's signature is either that honest case or a row whose signature was
/// taken off, and nothing in the file tells the two apart (no other record claims the decision was
/// signed). So the line is not passed and not called tampered: it reads "not checked" and holds
/// the file back from "verified". A row that carries only the checklist's hash comes from an older
/// wallet that signed nothing, and still reads "hash only".
fn lines_without_signature(
    decisions: &[(&ProofAuditRow, Value)],
    seen: &[Seen],
) -> Result<(), Miss> {
    match decisions
        .iter()
        .zip(seen)
        .find(|(_, s)| !s.signed && s.lines != Lines::HashOnly)
    {
        Some(((row, _), _)) => Err(Miss {
            detail: format!(
                "not checked: the owner's decision (record #{}) records the checklist the owner saw but carries no signature by the owner key, so nothing in this file shows the owner key approved it (the signatures were taken off, or the wallet could not read the owner key then)",
                row.seq
            ),
            checked: false,
            applies: true,
        }),
        None => Ok(()),
    }
}

/// How the decisions' checklists were checked and signed, counted, for the line's detail.
fn tally<'a>(seen: impl Iterator<Item = &'a Seen>) -> String {
    let (mut again, mut hash_only, mut unkept, mut signed) = (0, 0, 0, 0);
    for Seen {
        lines: l,
        signed: s,
    } in seen
    {
        if *s {
            signed += 1;
        }
        match l {
            Lines::Recomputed(_) => again += 1,
            Lines::HashOnly => hash_only += 1,
            Lines::Unkept => unkept += 1,
        }
    }
    let mut parts = Vec::new();
    if again > 0 {
        parts.push(format!(
            "{again} checklist(s) hashed again from the lines in the file"
        ));
    }
    if hash_only > 0 {
        parts.push(format!(
            "{hash_only} hash only (the lines are not in this file)"
        ));
    }
    if unkept > 0 {
        parts.push(format!(
            "{unkept} not checked: a line names an address the record does not keep"
        ));
    }
    if signed > 0 {
        parts.push(format!("{signed} signed by the owner key after unlock"));
    }
    parts.join("; ")
}

/// T5: every money step the owner decided has an `owner.decision` row before it, at the same
/// time, naming the decision and the hash of the checklist the owner saw. When a row carries the
/// lines (`checks`), they must hash to that hash; behind a money step none may have failed (the
/// shield line excepted on a release) and the step the row names (`operation`) must be the step
/// that follows. Rows that carry only the hash (older files) read "hash only". A row the owner key
/// signed must verify against the owner key the file names: "signed by the owner key after
/// unlock" says which key signed, never that a person was present. When any decision in the file
/// is signed, every decision must be; and a decision recorded with its checklist's lines but no
/// decision signed reads "not checked" and holds the file back (`lines_without_signature`), so
/// taking every signature off no longer passes.
pub(crate) fn owner_saw(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    let decisions: Vec<(&ProofAuditRow, Value)> = rows(bundle, &["owner.decision"])
        .map(|r| (r, detail(r)))
        .collect();
    let mut seen = Vec::with_capacity(decisions.len());
    for (row, d) in &decisions {
        seen.push(Seen {
            lines: lines_of(row, d)?,
            signed: signed_by_owner(bundle, row, d)?,
        });
    }
    // One file, one owner key: once any decision is signed, an unsigned one is a stripped or an
    // added row, not an older one.
    if seen.iter().any(|s| s.signed)
        && let Some(((row, _), _)) = decisions.iter().zip(&seen).find(|(_, s)| !s.signed)
    {
        return Err(format!(
            "the owner's decision (record #{}) is not signed by the owner key, though other decisions in this file are",
            row.seq
        )
        .into());
    }
    let owner = |by: &DecidedBy| matches!(by, DecidedBy::Human { .. });
    let steps: Vec<(&ProofAuditRow, String, DecidedBy)> = rows(bundle, &["money.authorized"])
        .filter_map(|row| {
            let d = detail(row);
            let op = text(&d, "operation")?.to_owned();
            let by: DecidedBy = typed(&d, "decided_by")?;
            (owner(&by) && op != "void").then_some((row, op, by))
        })
        .collect();
    let decided: Vec<_> = bundle
        .operations
        .iter()
        .filter(|o| owner(&o.decided_by) && o.operation != "void")
        .collect();
    if steps.is_empty() && decided.is_empty() {
        if seen.iter().all(|s| s.lines == Lines::HashOnly && !s.signed) {
            return Err(Miss::absent(
                "not checked: no money step in this deal was the owner's decision",
            ));
        }
        lines_without_signature(&decisions, &seen)?;
        return Ok(format!(
            "{} owner decision(s), no money step yet; {}",
            decisions.len(),
            tally(seen.iter())
        ));
    }
    for op in decided {
        if !steps
            .iter()
            .any(|(_, name, by)| *name == op.operation && *by == op.decided_by)
        {
            return Err(format!(
                "the owner's {} step (attempt {}) has no record in the deal's rows",
                op.operation, op.attempt
            )
            .into());
        }
    }
    let mut behind = Vec::with_capacity(steps.len());
    for (row, op, by) in &steps {
        let mut why = None;
        let saw = decisions
            .iter()
            .zip(&seen)
            .filter(|((r, d), _)| {
                r.seq < row.seq
                    && typed::<DecidedBy>(d, "decided_by").as_ref() == Some(by)
                    && text(d, "decision").is_some_and(|name| decision_fits(name, op))
                    && typed::<H256>(d, "checks_hash").is_some()
            })
            .find(|((r, d), s)| match stands_behind(r, d, &s.lines, op) {
                Ok(()) => true,
                Err(e) => {
                    why = Some(e);
                    false
                }
            });
        match (saw, why) {
            (Some((_, l)), _) => behind.push(l),
            (None, Some(why)) => return Err(why.into()),
            (None, None) => {
                return Err(format!(
                    "the owner's {op} step (record #{}) has no earlier record of the checklist the owner saw",
                    row.seq
                )
                .into());
            }
        }
    }
    lines_without_signature(&decisions, &seen)?;
    Ok(format!(
        "{} owner decision(s), each recorded with the hash of the checklist the owner saw, before its money step; {}",
        steps.len(),
        tally(behind.into_iter())
    ))
}

/// T10: a money step the wallet re-sent, parked or resolved by reading PayPal back went to PayPal
/// under the one request id it was reserved under, and no call of that kind used another.
pub(crate) fn one_request(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    let checks: Vec<&ProofAuditRow> =
        rows(bundle, &["money.resolved", "money.resent", "money.parked"]).collect();
    if checks.is_empty() {
        return Err(Miss::absent(
            "not checked: no money step in this deal needed a second look at PayPal",
        ));
    }
    let reserved: Vec<(i64, String, String)> = rows(bundle, &["money.authorized"])
        .filter_map(|row| {
            let d = detail(row);
            Some((
                row.seq,
                text(&d, "operation")?.to_owned(),
                text(&d, "request_id")?.to_owned(),
            ))
        })
        .collect();
    let mut kinds: Vec<String> = Vec::new();
    for row in &checks {
        let d = detail(row);
        let (Some(op), Some(id)) = (text(&d, "operation"), text(&d, "request_id")) else {
            return Err(format!("record #{}: no step or request id", row.seq).into());
        };
        let first = reserved
            .iter()
            .rfind(|(seq, kind, _)| *seq < row.seq && kind == op);
        if first.is_none_or(|(_, _, reserved)| reserved != id) {
            return Err(format!(
                "the {op} step was checked again (record #{}) under a request id it was not first sent with",
                row.seq
            )
            .into());
        }
        if !kinds.iter().any(|k| k == op) {
            kinds.push(op.to_owned());
        }
    }
    let ids = |kind: &str| -> Vec<&str> {
        reserved
            .iter()
            .filter(|(_, k, _)| k == kind)
            .map(|(_, _, id)| id.as_str())
            .collect()
    };
    let mut calls = 0;
    for call in &bundle.paypal_calls {
        let Some(kind) = money_kind(&call.method, &call.path) else {
            continue;
        };
        if !kinds.iter().any(|k| k == kind) {
            continue;
        }
        let Some(id) = call.request_id.as_deref() else {
            return Err(format!(
                "{}: the file does not say which request id it went under",
                call.path
            )
            .into());
        };
        if !ids(kind).contains(&id) {
            return Err(format!("{}: sent to PayPal under a second request id", call.path).into());
        }
        calls += 1;
    }
    for op in &bundle.operations {
        if kinds.contains(&op.operation)
            && op
                .request_id
                .as_deref()
                .is_none_or(|id| !ids(&op.operation).contains(&id))
        {
            return Err(format!(
                "the {} step (attempt {}) is recorded under a request id its rows never name",
                op.operation, op.attempt
            )
            .into());
        }
    }
    let resent = checks.iter().filter(|r| r.action == "money.resent").count();
    Ok(format!(
        "{} step(s) checked again with PayPal, each under the one request id it was first sent with ({resent} re-send(s), {calls} PayPal call(s))",
        kinds.len()
    ))
}

/// A state a table reaches only by agreeing.
fn agreed(state: DealState) -> bool {
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
            | S::Mismatch
            | S::Voided
            | S::AutoVoided
            | S::Refunded
            | S::Disputed
            | S::Unconfirmed
    )
}

/// T8: the shop-around group this deal belonged to left at most one table agreed, the winner,
/// and the group rule withdrew the others only after the win.
pub(crate) fn group(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    let own: Vec<&ProofAuditRow> =
        rows(bundle, &["group.opened", "group.won", "group.withdrawn"]).collect();
    let Some(group) = &bundle.group else {
        if own.is_empty() {
            return Err(Miss::absent(
                "not checked: this deal was not one table of a shop-around group",
            ));
        }
        return Err(
            "the deal's rows name a shop-around group the file leaves out"
                .to_owned()
                .into(),
        );
    };
    let id = serde_json::to_value(group.id).map_err(|e| e.to_string())?;
    let winner = group.winner;
    let Some(this) = group.tables.iter().find(|t| t.deal_id == bundle.deal.id) else {
        return Err("the group does not list this deal".to_owned().into());
    };
    if this.state != bundle.deal.state
        || this
            .rows
            .iter()
            .map(|r| r.hash)
            .ne(own.iter().map(|r| r.hash))
    {
        return Err(
            "the group's record of this deal differs from the deal's own"
                .to_owned()
                .into(),
        );
    }
    let mut won: Option<(usize, i64)> = None;
    for (index, table) in group.tables.iter().enumerate() {
        if group.tables[..index]
            .iter()
            .any(|t| t.deal_id == table.deal_id)
        {
            return Err("the group lists one table twice".to_owned().into());
        }
        for row in &table.rows {
            let d = row_detail(row, table.deal_id)?;
            if d.get("group_id") != Some(&id) {
                return Err(format!("record #{}: another group's row", row.seq).into());
            }
            if row.action == "group.won" {
                if won.is_some() {
                    return Err("two tables of the group claim the win".to_owned().into());
                }
                won = Some((index, row.seq));
            }
        }
    }
    let won_by = won.map(|(index, _)| group.tables[index].deal_id);
    if won_by != winner {
        return Err("the group's winner is not the table that won it"
            .to_owned()
            .into());
    }
    let agreed_tables: Vec<_> = group.tables.iter().filter(|t| agreed(t.state)).collect();
    if agreed_tables.len() > 1 {
        return Err(format!("{} tables of the group agreed", agreed_tables.len()).into());
    }
    if agreed_tables
        .first()
        .is_some_and(|t| Some(t.deal_id) != winner)
    {
        return Err("a table agreed that is not the group's winner"
            .to_owned()
            .into());
    }
    let mut withdrawn = 0;
    for table in &group.tables {
        for row in table.rows.iter().filter(|r| r.action == "group.withdrawn") {
            let d = detail(row);
            let names = typed::<table_core::DealId>(&d, "winner");
            if names.is_none()
                || names != winner
                || Some(table.deal_id) == winner
                || table.state != DealState::Withdrawn
                || won.is_none_or(|(_, seq)| row.seq < seq)
            {
                return Err(format!(
                    "record #{}: a withdrawal that does not follow the group's win",
                    row.seq
                )
                .into());
            }
            withdrawn += 1;
        }
    }
    let ours_agreed = !bundle.closed_mandates.is_empty()
        || !bundle.operations.is_empty()
        || agreed(bundle.deal.state);
    if ours_agreed && winner != Some(bundle.deal.id) {
        return Err("this deal agreed, but another table won the group"
            .to_owned()
            .into());
    }
    let who = match (winner, agreed_tables.is_empty()) {
        (Some(w), false) if w == bundle.deal.id => "this one agreed",
        (Some(_), false) => "another table agreed",
        (Some(_), true) => "the winner has since ended",
        (None, _) => "none agreed yet",
    };
    Ok(format!(
        "{} tables, {who}; {withdrawn} withdrawn by the group rule after the win",
        group.tables.len()
    ))
}

/// Shield slice 2: no money step went ahead while the shield blocked the deal, or held it on
/// these terms without the owner's release naming the holding rule for these terms. A void is
/// the safe direction and is never held.
pub(crate) fn shield(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    if rows(
        bundle,
        &["shield.raised", "shield.released", "shield.refused"],
    )
    .next()
    .is_none()
    {
        return Err(Miss::absent(
            "not checked: the safety check never held or refused a step in this deal",
        ));
    }
    let terms = bundle.deal.terms.hash().map_err(|e| e.to_string())?;
    let mut verdict: Option<(ShieldVerdict, Option<ShieldRule>, Option<H256>)> = None;
    let mut release: Option<(H256, Vec<ShieldRule>)> = None;
    let (mut holds, mut refused, mut released_steps) = (0, 0, 0);
    for row in &bundle.audit {
        let d = detail(row);
        match row.action.as_str() {
            "shield.checked" | "shield.raised" => {
                let Some(v) = typed::<ShieldVerdict>(&d, "verdict") else {
                    return Err(format!("record #{}: no verdict", row.seq).into());
                };
                if v >= ShieldVerdict::Hold {
                    holds += 1;
                }
                verdict = Some((v, typed(&d, "rule"), typed(&d, "terms_hash")));
            }
            "shield.released" => {
                let (Some(at), Some(rules)) = (typed(&d, "terms_hash"), typed(&d, "rules")) else {
                    return Err(format!("record #{}: a release without its terms", row.seq).into());
                };
                release = Some((at, rules));
            }
            "shield.refused" => refused += 1,
            "money.authorized" => {
                let op = text(&d, "operation").unwrap_or("money");
                if op == "void" {
                    continue;
                }
                let Some((v, rule, held)) = verdict
                    .filter(|(v, _, t)| *v >= ShieldVerdict::Hold && t.is_none_or(|t| t == terms))
                else {
                    continue;
                };
                if v == ShieldVerdict::Block {
                    return Err(format!(
                        "the {op} step (record #{}) went ahead while the safety check blocked the deal",
                        row.seq
                    )
                    .into());
                }
                let covered = rule.is_some_and(|rule| {
                    release
                        .as_ref()
                        .is_some_and(|(at, rules)| *at == terms && rules.contains(&rule))
                });
                if !covered {
                    return Err(format!(
                        "the {op} step (record #{}) went ahead while the safety check held the deal{}, with no release by the owner for these terms",
                        row.seq,
                        if held.is_some() { " on these terms" } else { "" }
                    )
                    .into());
                }
                released_steps += 1;
            }
            _ => {}
        }
    }
    Ok(format!(
        "{holds} hold(s) or block(s), {refused} refused step(s); {released_steps} money step(s) after a hold, each under the owner's release for these terms"
    ))
}

/// T9: the HOUSE heads kept beside this deal's receipt are signed by the pinned house key, the
/// pin is the house this deal was made with, and the house's record never got shorter or was
/// rewritten after the receipt.
pub(crate) fn house_record(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    let kept: Vec<&ProofAuditRow> = rows(bundle, &["house.head_kept"]).collect();
    let Some(house) = &bundle.house else {
        if kept.is_empty() {
            return Err(Miss::absent(
                "not checked: this deal kept no copy of the house seller's signed record",
            ));
        }
        return Err(
            "the deal kept the house's record, but the file leaves it out"
                .to_owned()
                .into(),
        );
    };
    let release = &house.release;
    release
        .verify()
        .map_err(|_| "the house release pin does not verify".to_owned())?;
    if release.agent_key != bundle.counterparty.agent_key {
        return Err("the release pin is not the house this deal was made with"
            .to_owned()
            .into());
    }
    let Some(base) = house.heads.first().filter(|h| h.receipt) else {
        return Err("the file has no head kept beside the receipt"
            .to_owned()
            .into());
    };
    if house.heads.iter().filter(|h| h.receipt).count() != 1 {
        return Err("more than one head is marked as the receipt's"
            .to_owned()
            .into());
    }
    let [row] = kept.as_slice() else {
        return Err("the deal's rows do not record exactly one kept head"
            .to_owned()
            .into());
    };
    let d = detail(row);
    let b = &base.head.head;
    if typed::<H256>(&d, "epoch") != Some(b.epoch)
        || d.get("row_count").and_then(Value::as_u64) != Some(b.row_count)
        || typed::<H256>(&d, "audit_head") != Some(b.audit_head)
    {
        return Err(
            "the receipt's head differs from the one the deal's rows recorded"
                .to_owned()
                .into(),
        );
    }
    for (index, kept) in house.heads.iter().enumerate() {
        kept.head
            .verify(release)
            .map_err(|_| format!("head {} is not signed by the pinned house key", index + 1))?;
        if let Some(prefix) = &kept.prefix {
            prefix.verify(release).map_err(|_| {
                format!("prefix {} is not signed by the pinned house key", index + 1)
            })?;
            if prefix_contradicts(b, &prefix.prefix) {
                return Err("the house signed a different history at your receipt"
                    .to_owned()
                    .into());
            }
        }
        if index == 0 {
            continue;
        }
        if kept.kept_at < house.heads[index - 1].kept_at {
            return Err("the heads are not in the order they were kept"
                .to_owned()
                .into());
        }
        let prefix = kept
            .prefix
            .as_ref()
            .map(|p| &p.prefix)
            .filter(|p| p.row_count == b.row_count);
        match compare_heads(b, &kept.head.head, prefix) {
            HeadVerdict::Shorter => {
                return Err(format!(
                    "the house's record got shorter after your receipt: {} entries, then {}",
                    b.row_count, kept.head.head.row_count
                )
                .into());
            }
            HeadVerdict::Rewritten => {
                return Err("the house's record was rewritten after your receipt"
                    .to_owned()
                    .into());
            }
            _ => {}
        }
    }
    let heads: Vec<_> = house.heads.iter().map(|h| h.head.clone()).collect();
    let consistent = crate::heads_consistent(&heads, release)?;
    Ok(format!(
        "{} entries at your receipt; {consistent}; signed by the pinned house key",
        b.row_count
    ))
}

/// market-data-2: the market price the deal was agreed on can be computed again. The agreement
/// row (hash-chained) names the digest of the market record the deal held; that record is in
/// the deal's rows with its comparables. The check recomputes the quartiles from the
/// comparables, matches the digest, checks the record prices the product the owner's rules bind
/// to the item, and reports where the deal price sits. A deal agreed with no market price, or on
/// an older record that kept no comparables, reads "not checked": never a pass by default.
pub(crate) fn market(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    let deal = &bundle.deal;
    if deal.market.as_ref().is_some_and(|m| m.validate().is_err()) {
        return Err(
            "the deal's latest market record does not compute again to its own quartiles"
                .to_owned()
                .into(),
        );
    }
    let details: Vec<(&str, Value)> = bundle
        .audit
        .iter()
        .map(|row| (row.action.as_str(), detail(row)))
        .collect();
    // The deal's latest re-checkable record is one its rows recorded, comparables and all.
    if let Some(latest) = deal.market.as_ref().and_then(|m| m.digest().ok().flatten()) {
        let recorded = details.iter().any(|(action, d)| {
            *action == "market.observed"
                && typed::<H256>(d, "digest") == Some(latest)
                && typed::<table_core::MarketRef>(d, "reference").is_some_and(|r| {
                    r.validate().is_ok() && r.digest().ok().flatten() == Some(latest)
                })
        });
        if !recorded {
            return Err(
                "the deal's latest market record is not the one its rows recorded"
                    .to_owned()
                    .into(),
            );
        }
    }
    let found = table_core::market_rows(details.iter().map(|(a, d)| (*a, d)));
    if !found.agreed {
        return Err(Miss::absent("not checked: the deal is not agreed yet"));
    }
    let digest = match found.commitment {
        None => {
            return Err(Miss::absent(
                "not checked: the deal had no market price when it was agreed",
            ));
        }
        Some(MarketCommitment::V1 { .. }) => {
            return Err(Miss::absent(
                "not checked: the deal was agreed on an older market record, which kept no prices to compute again",
            ));
        }
        Some(MarketCommitment::V2 { digest }) => digest,
    };
    let Some(reference) = found
        .observed
        .iter()
        .rfind(|r| r.digest().ok().flatten() == Some(digest))
    else {
        return Err(
            "the market record the deal was agreed on is missing, or its prices no longer compute to what it said"
                .to_owned()
                .into(),
        );
    };
    let Some(certificate) = reference.certificate.as_ref() else {
        return Err("the committed market record has no prices"
            .to_owned()
            .into());
    };
    if bundle
        .mandate
        .payload
        .market_product_for(&deal.terms.item_ref)
        != Some(certificate.product_id.as_str())
    {
        return Err(
            "the market record prices another product than the owner's rules bind to the item"
                .to_owned()
                .into(),
        );
    }
    let price = deal.terms.unit_price;
    let percentile = certificate
        .percentile(price)
        .map_err(|_| "the market record is in another currency than the deal".to_owned())?;
    Ok(format!(
        "{} {} is the {} percentile of {} market prices for product {}; quartiles {} / {} / {} computed again from them; agreed on record {} (response {})",
        price.decimal(),
        price.currency(),
        ordinal(percentile),
        certificate.comparables.len(),
        certificate.product_id,
        reference.p25.decimal(),
        reference.median.decimal(),
        reference.p75.decimal(),
        short(digest),
        short(reference.response_hash),
    ))
}
/// 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, ...
fn ordinal(n: u8) -> String {
    let suffix = match (n % 10, n % 100) {
        (_, 11..=13) => "th",
        (1, _) => "st",
        (2, _) => "nd",
        (3, _) => "rd",
        _ => "th",
    };
    format!("{n}{suffix}")
}

/// T11: the permissions fingerprint of the build that saved the file. Shown, not judged: the
/// wallet that checks the file compares it with its own.
pub(crate) fn permissions(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
    }
    bundle
        .authority_manifest
        .map(|m| format!("permissions fingerprint {}", m.hex()))
        .ok_or_else(|| {
            "the file does not name the permissions it was saved under"
                .to_owned()
                .into()
        })
}
