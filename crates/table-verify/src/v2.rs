//! The checks the second proof format (`table.proof.v2`) adds: the evidence the wallet records
//! since the first format, read only from the file.
//!
//! Each check makes a claim only about facts the file carries. When the deal has no such fact
//! (no owner decision, no second look at PayPal, no group, no shield hold, no house record) the
//! line reads "not checked" and says why; it neither passes nor fails. A v1 file carries none of
//! these records, so on a v1 file every one of them reads "not checked".
use crate::{Miss, operation_of, row_detail};
use serde_json::Value;
use table_core::{DealState, DecidedBy, H256, ShieldRule, ShieldVerdict};
use table_proto::{
    HeadVerdict, PROOF_FORMAT_V1, ProofAuditRow, ProofBundle, compare_heads, prefix_contradicts,
};

fn older(bundle: &ProofBundle) -> Option<Miss> {
    (bundle.format == PROOF_FORMAT_V1).then(|| {
        Miss::absent("not checked: a file in the first proof format does not carry this record")
    })
}
/// A row's detail; the audit check proves the rows themselves.
fn detail(row: &ProofAuditRow) -> Value {
    serde_json::from_str(&row.detail_json).unwrap_or(Value::Null)
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

/// The owner decision that may start each owner-decided money step (service.rs `Decision::name`).
fn decision_fits(decision: &str, operation: &str) -> bool {
    match operation {
        "create" | "authorize" => decision == "deal_countersign",
        "capture" => decision == "deal_capture",
        "invoice-create" | "invoice-send" => decision == "rescue_approve",
        _ => ["deal_countersign", "deal_capture", "rescue_approve"].contains(&decision),
    }
}

/// T5: every money step the owner decided has an `owner.decision` row before it, at the same
/// time, naming the decision and the hash of the checklist the owner saw.
pub(crate) fn owner_saw(bundle: &ProofBundle) -> Result<String, Miss> {
    if let Some(miss) = older(bundle) {
        return Err(miss);
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
        return Err(Miss::absent(
            "not checked: no money step in this deal was the owner's decision",
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
    for (row, op, by) in &steps {
        let saw = rows(bundle, &["owner.decision"])
            .filter(|r| r.seq < row.seq)
            .map(detail)
            .any(|d| {
                typed::<DecidedBy>(&d, "decided_by").as_ref() == Some(by)
                    && text(&d, "decision").is_some_and(|name| decision_fits(name, op))
                    && typed::<H256>(&d, "checks_hash").is_some()
            });
        if !saw {
            return Err(format!(
                "the owner's {op} step (record #{}) has no earlier record of the checklist the owner saw",
                row.seq
            )
            .into());
        }
    }
    Ok(format!(
        "{} owner decision(s), each recorded with the hash of the checklist the owner saw, before its money step",
        steps.len()
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
        let Some(kind) = operation_of(&call.method, &call.path) else {
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
