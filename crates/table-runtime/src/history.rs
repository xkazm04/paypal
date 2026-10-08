//! The Rewind read: the verified audit chain projected to closed history steps, each naming who
//! decided it (the owner, a rule the owner signed, the seller or HOUSE mandate, a safe default or
//! an agent's proposal) and whether PayPal was asked. Only typed fields of a row are read (its
//! action name, `decided_by`, `from` / `to`, the envelope type and direction, the money operation
//! and its confirmation); free detail, payloads, request ids and counterparty words never cross.
use crate::{Runtime, app, invalid};
use std::collections::BTreeMap;
use table_client::*;
use table_core::{DealId, DealState, DecidedBy, RungMark, Timestamp};
use table_ledger::AuditRecord;

/// Steps returned at most; older steps in the window are left out and `truncated` is set.
pub const HISTORY_STEPS: usize = 500;
/// Audit rows read at most per request (a step folds one to four rows).
const HISTORY_ROWS: u32 = 4000;

impl Runtime {
    pub(crate) fn deal_history(&self, args: DealHistoryArgs) -> Result<DealHistory, CommandError> {
        if matches!((args.from, args.to), (Some(from), Some(to)) if from >= to) {
            return Err(invalid());
        }
        let ledger = &self.pipeline.wallet.ledger;
        let (rows, more) =
            app(ledger.history_rows(args.deal_id, args.from, args.to, HISTORY_ROWS))?;
        let mut failure = None;
        let mut steps = project(&rows, |id, at| {
            ledger.paypal_statuses_at(id, at).unwrap_or_else(|e| {
                failure.get_or_insert(e);
                Vec::new()
            })
        });
        if let Some(error) = failure {
            return app(Err(error));
        }
        let mut truncated = more;
        if steps.len() > HISTORY_STEPS {
            truncated = true;
            steps.drain(..steps.len() - HISTORY_STEPS);
        }
        Ok(DealHistory { steps, truncated })
    }
}

fn authority_of(decided: &DecidedBy) -> HistoryAuthority {
    match decided {
        DecidedBy::Human { .. } => HistoryAuthority::Owner,
        DecidedBy::Policy { clause } => HistoryAuthority::SignedRule {
            clause: Some(*clause),
        },
        DecidedBy::SellerMandate { .. } => HistoryAuthority::SellerMandate,
        DecidedBy::HouseMandate { .. } => HistoryAuthority::HouseMandate,
        DecidedBy::SafeDefault { .. } => HistoryAuthority::SafeDefault,
    }
}
/// A row's typed `decided_by`; the owner-accept row records the literal "owner". Anything that
/// is not canonical is absent, never guessed.
fn decided(record: &AuditRecord) -> Option<HistoryAuthority> {
    match record.detail.get("decided_by")? {
        serde_json::Value::String(s) if s == "owner" => Some(HistoryAuthority::Owner),
        value => serde_json::from_value::<DecidedBy>(value.clone())
            .ok()
            .map(|d| authority_of(&d)),
    }
}
fn typed<T: serde::de::DeserializeOwned>(record: &AuditRecord, key: &str) -> Option<T> {
    serde_json::from_value(record.detail.get(key)?.clone()).ok()
}
fn outcome(status: u16) -> PaypalOutcome {
    match status {
        200..=299 => PaypalOutcome::Ok,
        400..=499 => PaypalOutcome::Failed,
        _ => PaypalOutcome::Unknown,
    }
}
/// The worse of two outcomes for one step that made several calls.
fn worse(a: PaypalOutcome, b: PaypalOutcome) -> PaypalOutcome {
    use PaypalOutcome as O;
    match (a, b) {
        (O::Failed, _) | (_, O::Failed) => O::Failed,
        (O::Unknown, _) | (_, O::Unknown) => O::Unknown,
        _ => O::Ok,
    }
}
/// The state a transition reached, as a step kind.
fn state_kind(to: DealState, authority: Option<HistoryAuthority>) -> HistoryKind {
    use DealState as S;
    use HistoryKind as K;
    match to {
        S::Agreed => K::Agreed,
        S::AwaitingApproval => K::OrderCreated,
        S::Approved => K::ApprovedByBuyer,
        S::Authorized => K::Authorized,
        S::Captured => K::Captured,
        S::Receipted => K::Receipted,
        S::Reconciled => K::Reconciled,
        S::Withdrawn if authority == Some(HistoryAuthority::SafeDefault) => K::Lapsed,
        S::Withdrawn => K::Withdrawn,
        S::Expired => K::Expired,
        S::Refused => K::Refused,
        S::Mismatch => K::Mismatch,
        S::Failed => K::Failed,
        S::Voided => K::Voided,
        S::AutoVoided => K::AutoVoided,
        S::Refunded => K::Refunded,
        S::Disputed => K::Disputed,
        S::Pairing | S::Listed | S::Negotiating | S::Settling => K::Other,
    }
}
/// States a transition passes through on the way to a step it belongs to (never a step alone
/// when the row before it was that step).
const fn passing(state: DealState) -> bool {
    matches!(
        state,
        DealState::Listed
            | DealState::Negotiating
            | DealState::Settling
            | DealState::AwaitingApproval
    )
}
/// Rows that record bookkeeping, not a step of the deal.
const BOOKKEEPING: &[&str] = &[
    "deadline.set",
    "market.observed",
    "relay.bound",
    "run.start",
    "run.finish",
    "counterparty.pinned",
    "envelope.rejected",
    "mandate.signed",
    "mandate.revoked",
    "deal.mandate_rebound",
    "wallet_limit.signed",
    "house.head_kept",
    "house.head_checked",
    "market.checked",
    // Shop around (T8): grouping tables and the group's one agreement are bookkeeping; the
    // agreement itself is the table's AGREED step and each withdrawal is its own step.
    "group.opened",
    "group.won",
    // The shield (slice 2): a CLEAR or ASK it computed for a money step, and a step it refused,
    // are bookkeeping. A pause is its `shield.raised` row; an ASK waits as the owner's gate.
    "shield.checked",
    "shield.refused",
    // Rescue detection: the owner's watch list and the wallet's subscription reads (GET only).
    // A failure a read finds is its rescue deal's own `rescue.opened` step.
    "rescue.watch_added",
    "rescue.watch_stopped",
    "rescue.watch_read",
    "rescue.watch_seen",
];
/// What one row says, before folding.
enum Row {
    Skip,
    Step(HistoryKind, HistoryAuthority),
    Transition(DealState, Option<HistoryAuthority>),
    MoneyOpen(PaypalMethod, HistoryAuthority),
    MoneyDone {
        method: PaypalMethod,
        authority: HistoryAuthority,
        confirmed: bool,
    },
    PaypalRead(PaypalMethod, PaypalOutcome),
    /// A rung of the attention ladder for one deadline (attention-ladder-1). Not a step: it rides
    /// on the safe default that cites it, so the lapse can say what the owner was shown.
    Rung(Timestamp, RungMark),
}
fn operation(record: &AuditRecord) -> Option<PaypalMethod> {
    match record.detail.get("operation")?.as_str()? {
        "create" => Some(PaypalMethod::CreateOrder),
        "authorize" => Some(PaypalMethod::Authorize),
        "capture" => Some(PaypalMethod::Capture),
        "void" => Some(PaypalMethod::Void),
        "invoice-create" => Some(PaypalMethod::CreateInvoice),
        "invoice-send" => Some(PaypalMethod::SendInvoice),
        _ => None,
    }
}
/// Classify one row by its action and typed fields only.
fn classify(record: &AuditRecord) -> Row {
    use HistoryAuthority as A;
    use HistoryKind as K;
    let action = record.action.as_str();
    if BOOKKEEPING.contains(&action) {
        return Row::Skip;
    }
    let other = Row::Step(K::Other, A::None);
    match action {
        "deal.created" => Row::Step(K::Created, A::None),
        "deal.transition" => match typed::<DealState>(record, "to") {
            Some(to) => Row::Transition(to, decided(record)),
            None => other,
        },
        "deal.owner_accept" => Row::Step(K::OwnerAccepted, A::Owner),
        "deal.countersigned" => match decided(record) {
            Some(authority) => Row::Step(K::Countersigned, authority),
            None => other,
        },
        "purchase.proposed" => Row::Step(K::Proposed, A::AgentIntent),
        // The refusal's reason is never shown; only that a signed rule refused it, and which
        // mandate clause when the row's closed code names one (clause 0, the wallet-wide
        // limits, is not a mandate clause).
        "intent.refused" => Row::Step(
            K::IntentRefused,
            A::SignedRule {
                clause: typed::<u8>(record, "clause").filter(|c| *c != 0),
            },
        ),
        "shield.raised" => Row::Step(K::ShieldHeld, A::None),
        // Only an owner ticket releases a hold (Pipeline::owner_release_hold).
        "shield.released" => Row::Step(K::HoldReleased, A::Owner),
        "money.authorized" => match (operation(record), decided(record)) {
            (Some(method), Some(authority)) => Row::MoneyOpen(method, authority),
            _ => other,
        },
        "money.observed" => match (operation(record), decided(record)) {
            (Some(method), Some(authority)) => Row::MoneyDone {
                method,
                authority,
                confirmed: record.detail.get("confirmed").and_then(|c| c.as_bool()) == Some(true),
            },
            _ => other,
        },
        "paypal.response" => {
            // Our own allowlisted resource path (PaypalPath), matched by family only.
            let path = record
                .detail
                .get("path")
                .and_then(|p| p.as_str())
                .unwrap_or("");
            let method = if path.starts_with("/v2/checkout/orders") {
                PaypalMethod::ReadOrder
            } else if path.starts_with("/v1/reporting/transactions") {
                PaypalMethod::Reporting
            } else if path.starts_with("/v2/invoicing/") {
                PaypalMethod::ReadInvoice
            } else {
                PaypalMethod::Other
            };
            let status = record
                .detail
                .get("status")
                .and_then(|s| s.as_u64())
                .and_then(|s| u16::try_from(s).ok())
                .unwrap_or(0);
            Row::PaypalRead(method, outcome(status))
        }
        "envelope.accepted" => {
            let out = match record.detail.get("direction").and_then(|d| d.as_str()) {
                Some("out") => true,
                Some("in") => false,
                _ => return other,
            };
            let authority = if out { A::AgentIntent } else { A::None };
            let pick = |sent, received| Row::Step(if out { sent } else { received }, authority);
            use table_proto::MsgType as T;
            match typed::<T>(record, "typ") {
                Some(T::Listing | T::Offer | T::Counter) => pick(K::OfferSent, K::OfferReceived),
                Some(T::Accept) => pick(K::AcceptSent, K::AcceptReceived),
                Some(T::Settle) => pick(K::PayLinkSent, K::PayLinkReceived),
                Some(T::Approved) => pick(K::ApprovalNotice, K::ApprovalNotice),
                Some(T::Receipt) => pick(K::ReceiptSent, K::ReceiptReceived),
                Some(T::Withdraw) => pick(K::WithdrawSent, K::WithdrawReceived),
                // A note is the other side's words; that it arrived is not a step.
                Some(T::Hello | T::Note) => Row::Skip,
                None => other,
            }
        }
        "receipt.verified" | "receipt.seller_attested" => Row::Step(K::Receipted, A::None),
        "receipt.reporting_checked" => Row::Step(K::ReportingChecked, A::Owner),
        "receipt.reconciled" => {
            if record.detail.get("matched").and_then(|m| m.as_bool()) == Some(true) {
                Row::Step(K::Reconciled, A::None)
            } else {
                Row::Step(K::ReportingChecked, A::None)
            }
        }
        "settlement.rejected" => Row::Step(K::Mismatch, A::None),
        // A money step whose answer was lost: the wallet parks it until PayPal's record is read.
        "money.parked" => Row::Step(K::CheckingWithPaypal, A::None),
        // A read-back settles a lost step: PayPal's record shows it happened (the step, as
        // `money.observed` would have shown it), or the wallet cannot settle it and the owner
        // must decide. Every other finding (not done, read again, sent once more) is bookkeeping.
        "money.resolved" => match record.detail.get("outcome").and_then(|o| o.as_str()) {
            Some("confirmed") => match (operation(record), decided(record)) {
                (Some(method), Some(authority)) => Row::MoneyDone {
                    method,
                    authority,
                    confirmed: true,
                },
                _ => other,
            },
            Some("needs_owner") => Row::Step(K::CheckingWithPaypal, A::None),
            _ => Row::Skip,
        },
        // A re-send reuses the same operation and request id, and an owner decision's authority
        // is on its money rows.
        "money.resent" | "owner.decision" => Row::Skip,
        // Another table of the group agreed first: the group rule withdrew this one (T8).
        "group.withdrawn" => match record.detail.get("decided_by").and_then(|d| d.as_str()) {
            Some(table_ledger::GROUP_RULE) => Row::Step(K::GroupWithdrawn, A::GroupRule),
            _ => other,
        },
        // A failed renewal opened a rescue: the fix waits for the owner.
        "rescue.opened" => Row::Step(K::RenewalFailed, A::None),
        // PayPal shows the rescue invoice paid; the subscriber paid it on PayPal's page.
        "rescue.paid" => Row::Step(K::InvoicePaid, A::None),
        table_ledger::RUNG_ACTION => match (
            typed::<Timestamp>(record, "deadline"),
            typed(record, "rung"),
            typed(record, "reason"),
        ) {
            (Some(deadline), Some(rung), reason) => Row::Rung(
                deadline,
                RungMark {
                    rung,
                    at: record.at,
                    reason,
                },
            ),
            _ => Row::Skip,
        },
        _ => other,
    }
}
struct Open {
    at: Timestamp,
    seq: u64,
    method: PaypalMethod,
    authority: HistoryAuthority,
    state_after: Option<DealState>,
    rungs: Option<Vec<RungMark>>,
}
/// The rungs a safe default's row cites by its `rung_deadline` (absent on every other row and on
/// defaults recorded before rungs were). The rows before it carry the marks themselves.
fn cited(
    record: &AuditRecord,
    authority: Option<HistoryAuthority>,
    deal: DealId,
    rungs: &BTreeMap<(DealId, Timestamp), Vec<RungMark>>,
) -> Option<Vec<RungMark>> {
    if authority != Some(HistoryAuthority::SafeDefault) {
        return None;
    }
    let deadline = typed::<Timestamp>(record, "rung_deadline")?;
    Some(rungs.get(&(deal, deadline)).cloned().unwrap_or_default())
}
fn money_kind(method: PaypalMethod, authority: HistoryAuthority) -> HistoryKind {
    match method {
        PaypalMethod::CreateOrder => HistoryKind::OrderCreated,
        PaypalMethod::Authorize => HistoryKind::Authorized,
        PaypalMethod::Capture => HistoryKind::Captured,
        PaypalMethod::Void if authority == HistoryAuthority::SafeDefault => HistoryKind::AutoVoided,
        PaypalMethod::Void => HistoryKind::Voided,
        PaypalMethod::CreateInvoice => HistoryKind::InvoiceCreated,
        PaypalMethod::SendInvoice => HistoryKind::InvoiceSent,
        PaypalMethod::ReadOrder
        | PaypalMethod::Reporting
        | PaypalMethod::ReadInvoice
        | PaypalMethod::Other => HistoryKind::Other,
    }
}
/// Fold verified rows (oldest first) into steps (oldest first). `statuses` answers the HTTP
/// statuses a deal's PayPal calls recorded at a time; it is asked only for a money operation
/// the wallet did not confirm, to tell a refusal by PayPal from an unknown outcome.
pub(crate) fn project(
    rows: &[AuditRecord],
    mut statuses: impl FnMut(DealId, Timestamp) -> Vec<u16>,
) -> Vec<HistoryStep> {
    let mut steps: Vec<HistoryStep> = Vec::new();
    // Per deal: an open money operation, a PayPal read waiting for the step it informs, and the
    // index of the deal's latest step.
    let mut open: BTreeMap<DealId, Open> = BTreeMap::new();
    let mut read: BTreeMap<DealId, (Timestamp, PaypalMethod, PaypalOutcome)> = BTreeMap::new();
    let mut last: BTreeMap<DealId, usize> = BTreeMap::new();
    let mut rungs: BTreeMap<(DealId, Timestamp), Vec<RungMark>> = BTreeMap::new();
    for record in rows {
        let Some(deal_id) = record.deal_id else {
            continue;
        };
        let at = record.at;
        if read.get(&deal_id).is_some_and(|(t, _, _)| *t != at) {
            read.remove(&deal_id);
        }
        let previous = last
            .get(&deal_id)
            .copied()
            .filter(|&i| steps.get(i).is_some_and(|s| s.at == at));
        let mut push = |steps: &mut Vec<HistoryStep>, step: HistoryStep| {
            last.insert(deal_id, steps.len());
            steps.push(step);
        };
        let step = |kind, authority, state_after, paypal| HistoryStep {
            at,
            deal_id,
            seq: record.seq,
            kind,
            state_after,
            authority,
            paypal,
            rungs: None,
        };
        match classify(record) {
            Row::Skip => {}
            Row::Rung(deadline, mark) => rungs.entry((deal_id, deadline)).or_default().push(mark),
            Row::Step(kind, authority) => {
                if let Some(p) = previous.and_then(|i| steps.get_mut(i)) {
                    // The owner's accept is sent as the agent's signed ACCEPT; the same fact
                    // written twice (a receipt, a mismatch) is one step.
                    let owner_accept =
                        p.kind == HistoryKind::OwnerAccepted && kind == HistoryKind::AcceptSent;
                    // The group rule's withdrawal is sent as the agent's signed WITHDRAW.
                    let group =
                        p.kind == HistoryKind::GroupWithdrawn && kind == HistoryKind::WithdrawSent;
                    if owner_accept || group || p.kind == kind {
                        continue;
                    }
                }
                push(&mut steps, step(kind, authority, None, HistoryPaypal::None));
            }
            Row::Transition(to, authority) => {
                if authority.is_none() {
                    if let Some(op) = open.get_mut(&deal_id) {
                        op.state_after = Some(to);
                        continue;
                    }
                    if let Some(p) = previous.and_then(|i| steps.get_mut(i)) {
                        let withdraw = matches!(
                            p.kind,
                            HistoryKind::WithdrawSent
                                | HistoryKind::WithdrawReceived
                                | HistoryKind::GroupWithdrawn
                        ) && to == DealState::Withdrawn;
                        // A rescue opens at AGREED and is receipted when PayPal shows it paid.
                        let rescue = (p.kind == HistoryKind::RenewalFailed
                            && to == DealState::Agreed)
                            || (p.kind == HistoryKind::InvoicePaid && to == DealState::Receipted);
                        if p.state_after.is_none()
                            && (passing(to) || withdraw || rescue || state_kind(to, None) == p.kind)
                        {
                            p.state_after = Some(to);
                            continue;
                        }
                    }
                }
                let paypal = match read.remove(&deal_id) {
                    Some((_, method, outcome)) => HistoryPaypal::Call { method, outcome },
                    None => HistoryPaypal::None,
                };
                let mut made = step(
                    state_kind(to, authority),
                    authority.unwrap_or(HistoryAuthority::None),
                    Some(to),
                    paypal,
                );
                made.rungs = cited(record, authority, deal_id, &rungs);
                push(&mut steps, made);
            }
            Row::MoneyOpen(method, authority) => {
                open.insert(
                    deal_id,
                    Open {
                        at,
                        seq: record.seq,
                        method,
                        authority,
                        state_after: None,
                        rungs: cited(record, Some(authority), deal_id, &rungs),
                    },
                );
            }
            Row::MoneyDone {
                method,
                authority,
                confirmed,
            } => {
                let opened = open.remove(&deal_id);
                let cites = opened.as_ref().and_then(|o| o.rungs.clone());
                let state_after = opened.and_then(|o| o.state_after);
                let outcome = if confirmed {
                    PaypalOutcome::Ok
                } else {
                    statuses(deal_id, at)
                        .into_iter()
                        .map(outcome)
                        .filter(|o| *o == PaypalOutcome::Failed)
                        .fold(PaypalOutcome::Unknown, worse)
                };
                let mut made = step(
                    money_kind(method, authority),
                    authority,
                    state_after,
                    HistoryPaypal::Call { method, outcome },
                );
                made.rungs = cites;
                push(&mut steps, made);
            }
            Row::PaypalRead(method, result) => {
                // A reporting check's own calls belong to it; an order read informs the
                // transition it caused (the buyer's approval, a mismatch) or nothing.
                if let Some(p) = previous.and_then(|i| steps.get_mut(i))
                    && p.kind == HistoryKind::ReportingChecked
                {
                    p.paypal = match p.paypal {
                        HistoryPaypal::Call { method, outcome } => HistoryPaypal::Call {
                            method,
                            outcome: worse(outcome, result),
                        },
                        HistoryPaypal::None => HistoryPaypal::Call {
                            method,
                            outcome: result,
                        },
                    };
                    continue;
                }
                let merged = match read.get(&deal_id) {
                    Some((_, m, o)) if *m == method => worse(*o, result),
                    _ => result,
                };
                read.insert(deal_id, (at, method, merged));
            }
        }
    }
    // A money operation reserved but never observed (in flight, or a crash between the call and
    // its record): PayPal may have been asked, and the outcome is not known.
    for (deal_id, op) in open {
        steps.push(HistoryStep {
            at: op.at,
            deal_id,
            seq: op.seq,
            kind: money_kind(op.method, op.authority),
            state_after: op.state_after,
            authority: op.authority,
            paypal: HistoryPaypal::Call {
                method: op.method,
                outcome: PaypalOutcome::Unknown,
            },
            rungs: op.rungs,
        });
    }
    steps.sort_by_key(|s| s.seq);
    steps
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use table_core::H256;

    const DEAL: &str = "01J0000000000000000000000A";
    /// The step one row makes alone; None when it is bookkeeping.
    type Expected = Option<(HistoryKind, HistoryAuthority)>;
    fn row(seq: u64, at: Timestamp, action: &str, detail: Value) -> AuditRecord {
        AuditRecord {
            seq,
            at,
            actor: "policy".into(),
            action: action.into(),
            deal_id: Some(DEAL.parse().unwrap()),
            detail,
        }
    }
    fn one(action: &str, detail: Value) -> Expected {
        project(&[row(1, 100, action, detail)], |_, _| Vec::new())
            .first()
            .map(|s| (s.kind, s.authority))
    }
    /// Every audit action the ledger, the pipeline, the agent service and the runtime write.
    fn written_actions() -> std::collections::BTreeSet<String> {
        let sources = [
            include_str!("../../table-ledger/src/repositories.rs"),
            include_str!("../../table-ledger/src/relay.rs"),
            include_str!("../../table-ledger/src/house.rs"),
            include_str!("../../table-ledger/src/receipt.rs"),
            include_str!("../../table-ledger/src/resolution.rs"),
            include_str!("../../table-app/src/agent.rs"),
            include_str!("../../table-app/src/pipeline.rs"),
            include_str!("../../table-app/src/reconciliation.rs"),
            include_str!("../../table-app/src/relay.rs"),
            include_str!("engines.rs"),
            include_str!("service.rs"),
            include_str!("configuration.rs"),
            include_str!("relay.rs"),
            include_str!("pairing.rs"),
            include_str!("../../table-ledger/src/limits.rs"),
            include_str!("../../table-ledger/src/rescue.rs"),
            include_str!("../../table-app/src/rescue.rs"),
            include_str!("rescue.rs"),
            include_str!("../../table-ledger/src/witness.rs"),
            include_str!("../../table-ledger/src/market_watch.rs"),
            include_str!("../../table-ledger/src/groups.rs"),
            include_str!("groups.rs"),
            include_str!("../../table-ledger/src/shield.rs"),
            include_str!("../../table-ledger/src/rescue_watch.rs"),
            include_str!("../../table-ledger/src/attention.rs"),
        ];
        let mut found = std::collections::BTreeSet::new();
        for source in sources {
            for part in source.split("action: \"").skip(1) {
                if let Some(name) = part.split('"').next() {
                    found.insert(name.to_owned());
                }
            }
        }
        found
    }

    #[test]
    fn every_audit_action_the_wallet_writes_is_classified_by_typed_fields_only() {
        use HistoryAuthority as A;
        use HistoryKind as K;
        let policy6 = json!({"type":"policy","clause":6});
        let seller = json!({"type":"seller_mandate","mandate_hash":H256::ZERO});
        let house = json!({"type":"house_mandate","mandate_hash":H256::ZERO});
        let owner = json!({"type":"human","at":90});
        let lapse = json!({"type":"safe_default","deadline":100});
        let step = |k, a| Some((k, a));
        // (action, typed detail, expected step; None = bookkeeping, not a step)
        let table: Vec<(&str, Value, Expected)> = vec![
            (
                "deal.created",
                json!({"kind":"haggle"}),
                step(K::Created, A::None),
            ),
            ("deadline.set", json!({"due_at":200}), None),
            ("owner.decision", json!({"decided_by":owner}), None),
            ("money.resent", json!({"operation":"capture"}), None),
            (
                "money.resolved",
                json!({"operation":"capture","outcome":"absent"}),
                None,
            ),
            (
                "money.parked",
                json!({"operation":"capture","reason":"unreadable"}),
                step(K::CheckingWithPaypal, A::None),
            ),
            ("market.observed", json!({}), None),
            ("relay.bound", json!({}), None),
            ("run.start", json!({}), None),
            ("run.finish", json!({}), None),
            ("counterparty.pinned", json!({}), None),
            ("envelope.rejected", json!({"reason":"bad"}), None),
            ("mandate.signed", json!({}), None),
            ("mandate.revoked", json!({}), None),
            ("deal.mandate_rebound", json!({"version":2}), None),
            (
                "envelope.accepted",
                json!({"typ":"LISTING","direction":"out"}),
                step(K::OfferSent, A::AgentIntent),
            ),
            (
                "envelope.accepted",
                json!({"typ":"COUNTER","direction":"in"}),
                step(K::OfferReceived, A::None),
            ),
            (
                "envelope.accepted",
                json!({"typ":"ACCEPT","direction":"in"}),
                step(K::AcceptReceived, A::None),
            ),
            (
                "envelope.accepted",
                json!({"typ":"SETTLE","direction":"out"}),
                step(K::PayLinkSent, A::AgentIntent),
            ),
            (
                "envelope.accepted",
                json!({"typ":"APPROVED","direction":"in"}),
                step(K::ApprovalNotice, A::None),
            ),
            (
                "envelope.accepted",
                json!({"typ":"RECEIPT","direction":"in"}),
                step(K::ReceiptReceived, A::None),
            ),
            (
                "envelope.accepted",
                json!({"typ":"WITHDRAW","direction":"out"}),
                step(K::WithdrawSent, A::AgentIntent),
            ),
            (
                "envelope.accepted",
                json!({"typ":"NOTE","direction":"in"}),
                None,
            ),
            (
                "envelope.accepted",
                json!({"typ":"HELLO","direction":"in"}),
                None,
            ),
            (
                "envelope.accepted",
                json!({"typ":"SHOUT","direction":"in"}),
                step(K::Other, A::None),
            ),
            (
                "deal.transition",
                json!({"from":"NEGOTIATING","to":"AGREED"}),
                step(K::Agreed, A::None),
            ),
            (
                "deal.transition",
                json!({"from":"NEGOTIATING","to":"AGREED","decided_by":policy6}),
                step(K::Agreed, A::SignedRule { clause: Some(6) }),
            ),
            (
                "deal.transition",
                json!({"from":"PAIRING","to":"REFUSED","decided_by":{"type":"policy","clause":3}}),
                step(K::Refused, A::SignedRule { clause: Some(3) }),
            ),
            (
                "deal.transition",
                json!({"from":"NEGOTIATING","to":"WITHDRAWN","decided_by":lapse}),
                step(K::Lapsed, A::SafeDefault),
            ),
            (
                "deal.transition",
                json!({"from":"AWAITING_APPROVAL","to":"EXPIRED","decided_by":lapse}),
                step(K::Expired, A::SafeDefault),
            ),
            (
                "deal.transition",
                json!({"from":"AWAITING_APPROVAL","to":"APPROVED"}),
                step(K::ApprovedByBuyer, A::None),
            ),
            (
                "deal.transition",
                json!({"from":"X","to":"NOT_A_STATE"}),
                step(K::Other, A::None),
            ),
            // A decision that is not canonical DecidedBy is absent, never guessed.
            (
                "deal.transition",
                json!({"to":"WITHDRAWN","decided_by":"the owner said so"}),
                step(K::Withdrawn, A::None),
            ),
            (
                "deal.owner_accept",
                json!({"decided_by":"owner"}),
                step(K::OwnerAccepted, A::Owner),
            ),
            (
                "deal.countersigned",
                json!({"attempt":1,"decided_by":owner}),
                step(K::Countersigned, A::Owner),
            ),
            (
                "deal.countersigned",
                json!({"attempt":1,"decided_by":house}),
                step(K::Countersigned, A::HouseMandate),
            ),
            (
                "purchase.proposed",
                json!({"amount":"1"}),
                step(K::Proposed, A::AgentIntent),
            ),
            (
                "intent.refused",
                json!({"reason":"permission denied"}),
                step(K::IntentRefused, A::SignedRule { clause: None }),
            ),
            (
                "shield.raised",
                json!({"verdict":"HOLD"}),
                step(K::ShieldHeld, A::None),
            ),
            (
                "shield.released",
                json!({"from":"hold","to":"ask"}),
                step(K::HoldReleased, A::Owner),
            ),
            (
                "shield.released",
                json!({"from":"hold","to":"released","rules":["model_caution"],"decided_by":owner}),
                step(K::HoldReleased, A::Owner),
            ),
            (
                "shield.raised",
                json!({"verdict":"BLOCK","rule":"payee_mismatch"}),
                step(K::ShieldHeld, A::None),
            ),
            (
                "shield.checked",
                json!({"verdict":"ASK","rule":"no_market_reference"}),
                None,
            ),
            (
                "shield.refused",
                json!({"step":"authorize","verdict":"HOLD","rule":"price_over_market","refused_authority":seller}),
                None,
            ),
            // A reservation never observed: PayPal may have been asked; the outcome is unknown.
            (
                "money.authorized",
                json!({"operation":"capture","decided_by":seller}),
                step(K::Captured, A::SellerMandate),
            ),
            (
                "money.observed",
                json!({"operation":"create","confirmed":true,"decided_by":policy6}),
                step(K::OrderCreated, A::SignedRule { clause: Some(6) }),
            ),
            (
                "money.observed",
                json!({"operation":"authorize","confirmed":true,"decided_by":seller}),
                step(K::Authorized, A::SellerMandate),
            ),
            (
                "money.observed",
                json!({"operation":"void","confirmed":true,"decided_by":owner}),
                step(K::Voided, A::Owner),
            ),
            (
                "money.observed",
                json!({"operation":"void","confirmed":true,"decided_by":lapse}),
                step(K::AutoVoided, A::SafeDefault),
            ),
            (
                "money.observed",
                json!({"operation":"refund","confirmed":true,"decided_by":owner}),
                step(K::Other, A::None),
            ),
            // An order read with no step after it informs nothing.
            (
                "paypal.response",
                json!({"status":200,"path":"/v2/checkout/orders/X"}),
                None,
            ),
            ("receipt.verified", json!({}), step(K::Receipted, A::None)),
            (
                "receipt.seller_attested",
                json!({}),
                step(K::Receipted, A::None),
            ),
            (
                "receipt.reporting_checked",
                json!({}),
                step(K::ReportingChecked, A::Owner),
            ),
            (
                "receipt.reconciled",
                json!({"matched":true}),
                step(K::Reconciled, A::None),
            ),
            (
                "receipt.reconciled",
                json!({"matched":false}),
                step(K::ReportingChecked, A::None),
            ),
            (
                "settlement.rejected",
                json!({"reason":"settlement truth mismatch"}),
                step(K::Mismatch, A::None),
            ),
            (
                "offer.declined",
                json!({"reason":"outside seller band"}),
                step(K::Other, A::None),
            ),
            ("edited.offline", json!({}), step(K::Other, A::None)),
            // Subscription rescue: a failed renewal, the owner's invoice steps, PayPal's PAID.
            (
                "rescue.opened",
                json!({"source":"replay","lever":"DISCOUNT_THIS_CYCLE"}),
                step(K::RenewalFailed, A::None),
            ),
            (
                "money.observed",
                json!({"operation":"invoice-create","confirmed":true,"decided_by":owner}),
                step(K::InvoiceCreated, A::Owner),
            ),
            (
                "money.observed",
                json!({"operation":"invoice-send","confirmed":true,"decided_by":owner}),
                step(K::InvoiceSent, A::Owner),
            ),
            (
                "rescue.paid",
                json!({"invoice_id":"INV-1","counted":false}),
                step(K::InvoicePaid, A::None),
            ),
            // The owner signed new wallet limits: bookkeeping, not a step of any deal.
            ("wallet_limit.signed", json!({"version":1}), None),
            // Rescue detection: the owner's watch list and the reads of it move no money; a
            // failure a read finds is its deal's `rescue.opened` step.
            (
                "rescue.watch_added",
                json!({"subscription_id":"I-1","plan":"care-plan"}),
                None,
            ),
            (
                "rescue.watch_stopped",
                json!({"subscription_id":"I-1"}),
                None,
            ),
            (
                "rescue.watch_read",
                json!({"subscription_id":"I-1","count":1,"max_per_day":100}),
                None,
            ),
            (
                "rescue.watch_seen",
                json!({"subscription_id":"I-1","failed_payments":1}),
                None,
            ),
            // A price check under the owner's market-watch rule reads prices; no money step.
            (
                "market.checked",
                json!({"product_id":"p-1","count":1,"max_per_day":12}),
                None,
            ),
            // An agent intent the wallet limits refused is a signed rule's refusal like any other.
            (
                "intent.refused",
                json!({"layer":"wallet_limit","reason":"wallet limit max_held"}),
                step(K::IntentRefused, A::SignedRule { clause: None }),
            ),
            // The house's signed record kept beside a HOUSE receipt, and a later look at it (T9):
            // evidence bookkeeping, not a step of the deal.
            (
                "house.head_kept",
                json!({"row_count":12,"prefix_rows":null}),
                None,
            ),
            ("house.head_checked", json!({"row_count":14}), None),
            // Shop around (T8): grouping and the group's one agreement are bookkeeping; a table the
            // group rule withdrew is its own step, decided by the group rule, never a money call.
            ("group.opened", json!({"group_id":"G","tables":2}), None),
            ("group.won", json!({"group_id":"G"}), None),
            (
                "group.withdrawn",
                json!({"group_id":"G","winner":"D","decided_by":"group_rule"}),
                step(K::GroupWithdrawn, A::GroupRule),
            ),
            (
                "group.withdrawn",
                json!({"group_id":"G","winner":"D","decided_by":"the seller said so"}),
                step(K::Other, A::None),
            ),
            (
                "intent.refused",
                json!({"layer":"group","reason":"another table in this group already agreed"}),
                step(K::IntentRefused, A::SignedRule { clause: None }),
            ),
            // A coded refusal (agent-tool-surface-1) names its clause when one refused.
            (
                "intent.refused",
                json!({"layer":"wallet","tool":"send_offer","code":{"code":"outside_band"},"clause":4,"reason":"mandate clause 4: price 25.01 above ceiling 25.00"}),
                step(K::IntentRefused, A::SignedRule { clause: Some(4) }),
            ),
            (
                "intent.refused",
                json!({"layer":"mcp","tool":"capture","code":{"code":"tool_absent"},"clause":null,"reason":"No such tool."}),
                step(K::IntentRefused, A::SignedRule { clause: None }),
            ),
            (
                "intent.refused",
                json!({"layer":"wallet","tool":"propose_purchase","code":{"code":"wallet_limit","limit":"held"},"clause":0,"reason":"wallet limit max_held"}),
                step(K::IntentRefused, A::SignedRule { clause: None }),
            ),
            // A rung of the attention ladder (attention-ladder-1) is no step: it rides on the safe
            // default that cites it, so the lapse can say what the owner was shown.
            (
                "attention.rung",
                json!({"deadline":200,"rung":"shown"}),
                None,
            ),
            (
                "attention.rung",
                json!({"deadline":200,"rung":"notify_suppressed","reason":"do_not_disturb"}),
                None,
            ),
            ("attention.rung", json!({"rung":"not_a_rung"}), None),
        ];
        for (action, detail, expected) in &table {
            assert_eq!(one(action, detail.clone()), *expected, "{action} {detail}");
        }
        let covered: std::collections::BTreeSet<&str> = table.iter().map(|(a, _, _)| *a).collect();
        let written = written_actions();
        assert!(written.len() >= 25, "{written:?}");
        for action in &written {
            assert!(
                covered.contains(action.as_str()),
                "audit action {action} has no classification row"
            );
        }
    }

    #[test]
    fn a_safe_default_carries_the_rungs_it_cites_and_no_other_step_does() {
        use table_core::{LadderRung as R, NotifySuppression};
        let lapse = json!({"type":"safe_default","deadline":500});
        let rung = |seq, at, deadline, name: &str| {
            row(
                seq,
                at,
                "attention.rung",
                json!({"deadline":deadline,"rung":name}),
            )
        };
        let rows = [
            row(1, 100, "deal.created", json!({"kind":"haggle"})),
            // A rung for an earlier deadline is not cited by this one's default.
            rung(2, 110, 300, "shown"),
            rung(3, 320, 500, "shown"),
            rung(4, 400, 500, "breathing"),
            row(
                5,
                420,
                "attention.rung",
                json!({"deadline":500,"rung":"notify_suppressed","reason":"do_not_disturb"}),
            ),
            rung(6, 430, 500, "card_opened"),
            row(
                7,
                500,
                "deal.transition",
                json!({"from":"AGREED","to":"WITHDRAWN","decided_by":lapse,"rung_deadline":500,"rung_count":4,"last_rung":"card_opened","rung_chain_hash":H256::ZERO}),
            ),
        ];
        let steps = project(&rows, |_, _| Vec::new());
        assert_eq!(steps.len(), 2, "rungs are no steps: {steps:?}");
        assert_eq!(steps[0].rungs, None);
        let marks = steps[1].rungs.clone().unwrap();
        assert_eq!(steps[1].kind, HistoryKind::Lapsed);
        assert_eq!(
            marks.iter().map(|m| (m.rung, m.at)).collect::<Vec<_>>(),
            [
                (R::Shown, 320),
                (R::Breathing, 400),
                (R::NotifySuppressed, 420),
                (R::CardOpened, 430)
            ]
        );
        assert_eq!(marks[2].reason, Some(NotifySuppression::DoNotDisturb));
        // A default recorded before rungs were cites nothing; one whose card was never shown
        // cites an empty chain.
        let old = [row(
            1,
            500,
            "deal.transition",
            json!({"from":"AGREED","to":"WITHDRAWN","decided_by":lapse}),
        )];
        assert_eq!(project(&old, |_, _| Vec::new())[0].rungs, None);
        let unseen = [row(
            1,
            500,
            "deal.transition",
            json!({"from":"AGREED","to":"WITHDRAWN","decided_by":lapse,"rung_deadline":500}),
        )];
        assert_eq!(
            project(&unseen, |_, _| Vec::new())[0].rungs,
            Some(Vec::new())
        );
        // An auto-void cites its rungs on the reservation; the void step carries them.
        let void = [
            rung(1, 100, 500, "shown"),
            row(
                2,
                500,
                "money.authorized",
                json!({"operation":"void","decided_by":lapse,"rung_deadline":500}),
            ),
            row(
                3,
                500,
                "money.observed",
                json!({"operation":"void","confirmed":true,"decided_by":lapse}),
            ),
        ];
        let steps = project(&void, |_, _| Vec::new());
        assert_eq!(steps.len(), 1);
        assert_eq!(steps[0].kind, HistoryKind::AutoVoided);
        assert_eq!(steps[0].rungs.as_ref().map(Vec::len), Some(1));
        // Only a safe default cites: an owner's step with the same fields carries nothing.
        let owner = [row(
            1,
            500,
            "deal.transition",
            json!({"to":"WITHDRAWN","decided_by":{"type":"human","at":1},"rung_deadline":500}),
        )];
        assert_eq!(project(&owner, |_, _| Vec::new())[0].rungs, None);
    }

    #[test]
    fn a_money_operation_folds_its_transitions_and_an_unconfirmed_call_says_failed_or_unknown() {
        let policy6 = json!({"type":"policy","clause":6});
        let owner = |at: i64| json!({"type":"human","at":at});
        let rows = [
            row(1, 100, "deal.countersigned", json!({"decided_by":policy6})),
            row(
                2,
                100,
                "money.authorized",
                json!({"operation":"create","decided_by":policy6}),
            ),
            row(
                3,
                100,
                "deal.transition",
                json!({"from":"AGREED","to":"SETTLING"}),
            ),
            row(
                4,
                100,
                "deal.transition",
                json!({"from":"SETTLING","to":"AWAITING_APPROVAL"}),
            ),
            row(
                5,
                100,
                "money.observed",
                json!({"operation":"create","confirmed":true,"decided_by":policy6}),
            ),
            row(
                6,
                300,
                "money.authorized",
                json!({"operation":"capture","decided_by":owner(290)}),
            ),
            row(
                7,
                300,
                "money.observed",
                json!({"operation":"capture","confirmed":false,"decided_by":owner(290)}),
            ),
            row(
                8,
                400,
                "money.authorized",
                json!({"operation":"void","decided_by":owner(390)}),
            ),
            row(
                9,
                400,
                "money.observed",
                json!({"operation":"void","confirmed":false,"decided_by":owner(390)}),
            ),
        ];
        let steps = project(
            &rows,
            |_, at| {
                if at == 300 { vec![422] } else { vec![503, 0] }
            },
        );
        assert_eq!(steps.len(), 4);
        assert_eq!(steps[1].kind, HistoryKind::OrderCreated);
        assert_eq!(steps[1].seq, 5);
        assert_eq!(steps[1].state_after, Some(DealState::AwaitingApproval));
        let outcome = |s: &HistoryStep| match s.paypal {
            HistoryPaypal::Call { outcome, .. } => outcome,
            HistoryPaypal::None => panic!("no call"),
        };
        assert_eq!(outcome(&steps[1]), PaypalOutcome::Ok);
        assert_eq!(outcome(&steps[2]), PaypalOutcome::Failed);
        assert_eq!(outcome(&steps[3]), PaypalOutcome::Unknown);
        assert_eq!(steps[2].state_after, None);
    }
}
