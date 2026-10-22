//! Row classification for the Rewind read: what one audit row says, from its action name and
//! typed fields only, and the small mappings the projection folds those rows with.
use table_client::*;
use table_core::{DealState, DecidedBy, RungMark, Timestamp};
use table_ledger::AuditRecord;

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
pub(super) fn typed<T: serde::de::DeserializeOwned>(record: &AuditRecord, key: &str) -> Option<T> {
    serde_json::from_value(record.detail.get(key)?.clone()).ok()
}
pub(super) fn outcome(status: u16) -> PaypalOutcome {
    match status {
        200..=299 => PaypalOutcome::Ok,
        400..=499 => PaypalOutcome::Failed,
        _ => PaypalOutcome::Unknown,
    }
}
/// The worse of two outcomes for one step that made several calls.
pub(super) fn worse(a: PaypalOutcome, b: PaypalOutcome) -> PaypalOutcome {
    use PaypalOutcome as O;
    match (a, b) {
        (O::Failed, _) | (_, O::Failed) => O::Failed,
        (O::Unknown, _) | (_, O::Unknown) => O::Unknown,
        _ => O::Ok,
    }
}
/// The state a transition reached, as a step kind.
pub(super) fn state_kind(to: DealState, authority: Option<HistoryAuthority>) -> HistoryKind {
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
        S::Unconfirmed => K::Unconfirmed,
        S::Pairing | S::Listed | S::Negotiating | S::Settling => K::Other,
    }
}
/// States a transition passes through on the way to a step it belongs to (never a step alone
/// when the row before it was that step).
pub(super) const fn passing(state: DealState) -> bool {
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
    "relay.reset_refused",
    "run.start",
    "run.finish",
    "counterparty.pinned",
    // The owner revoking a pin or setting when it lapses, and a refused privileged command:
    // wallet-wide records with no deal of their own.
    "counterparty.revoked",
    "counterparty.expiry_set",
    "command.refused",
    "envelope.rejected",
    "mandate.signed",
    "mandate.revoked",
    "deal.mandate_rebound",
    "wallet_limit.signed",
    "house.head_kept",
    "house.head_checked",
    "house.head_refused",
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
    "rescue.watch_unread",
];
/// What one row says, before folding.
pub(super) enum Row {
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
pub(super) fn classify(record: &AuditRecord) -> Row {
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
        // A seller's receipt before the owner opened the PayPal link: refused, nothing changed.
        "receipt.refused" => Row::Step(K::ReceiptRefused, A::None),
        "receipt.reporting_checked" => Row::Step(K::ReportingChecked, A::Owner),
        // A statement read that found no matching payment is part of the owner's check.
        "receipt.reporting_unmatched" => Row::Step(K::ReportingChecked, A::None),
        // PayPal's statement never showed the seller's payment: the safe default ends the deal.
        "receipt.unconfirmed" => Row::Step(K::Unconfirmed, A::SafeDefault),
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
pub(super) fn money_kind(method: PaypalMethod, authority: HistoryAuthority) -> HistoryKind {
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
