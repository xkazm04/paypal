//! The whole-ledger money-authority predicate (moonshot card ops-and-delivery-1). Pure: it reads
//! exported deal slices ([`ProofBundle`]s) and nothing else.
//!
//! The hostile-agent gauntlet (`crates/table-app/tests/gauntlet.rs`) holds every session to it,
//! and the wallet runs the same predicate on the owner's own ledger for "Your safety record". The
//! caller does the IO: it verifies the audit chain and exports each deal (the export re-verifies
//! the transcript), then hands the results to [`ledger_violations`]. Empty means the invariant
//! holds: every `operations` row stands on an authority AGENTS.md allows for that operation,
//! every money-shaped PayPal call has its operation, a refused deal made no call, no stored call
//! carries a counterparty note, and the offline verifier's checks hold on every exported deal.
use serde_json::Value;
use std::fmt;
use table_core::{Clause, DealId, DealKind, DealState, DecidedBy, RefusalCode, Side};
use table_proto::{ProofAuditRow, ProofBundle, ProofOperation};

/// The offline verifier's checks every exported deal is held to. Left out: the file's format,
/// permissions fingerprint and evidence signature, which the runtime adds when it signs an export
/// for sharing; the predicate reads unsigned ledger slices.
pub const VERIFIER_CHECKS: [&str; 13] = [
    "mandate",
    "transcript",
    "countersign",
    "authority",
    "paypal_order",
    "audit",
    "receipt",
    "owner_saw",
    "one_request",
    "group",
    "shield",
    "house_record",
    "market",
];

/// What kind of break a [`Violation`] is. Closed, so a client can say it in its own words.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ViolationKind {
    /// A money step whose recorded authority does not fit it (or has no authority row at all).
    Authority,
    /// A money-shaped PayPal call with no recorded money step behind it.
    UntrackedCall,
    /// Something stored about PayPal carries the other side's words.
    CounterpartyText,
    /// A deal the rules refused has PayPal calls.
    RefusedDealCalled,
    /// One of the offline verifier's checks failed on the deal's exported slice.
    VerifierCheck,
    /// The audit chain does not verify.
    ChainBroken,
    /// A deal's evidence could not be exported (its transcript or rows do not verify).
    EvidenceUnreadable,
}

/// One break of the invariant: the deal it is on (none for the chain itself), its kind and a
/// precise description for whoever investigates (it names operations, clauses and paths).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub deal: Option<DealId>,
    pub kind: ViolationKind,
    pub detail: String,
}
impl fmt::Display for Violation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.detail)
    }
}

fn detail(row: &ProofAuditRow) -> Value {
    serde_json::from_str(&row.detail_json).unwrap_or(Value::Null)
}

/// The money step a PayPal call is, from its method and path (as the offline verifier reads it):
/// `None` for a read, `"unclassified"` for a money-shaped POST nobody named.
pub fn money_kind(method: &str, path: &str) -> Option<&'static str> {
    if method != "POST" {
        return None;
    }
    let path = path.split('?').next().unwrap_or("");
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    match segments.as_slice() {
        ["v1", "oauth2", "token"] => None,
        ["v2", "checkout", "orders"] => Some("create"),
        ["v2", "checkout", "orders", _, "authorize"] => Some("authorize"),
        ["v2", "payments", "authorizations", _, "capture"] => Some("capture"),
        ["v2", "payments", "authorizations", _, "void"] => Some("void"),
        ["v2", "invoicing", "invoices"] => Some("invoice-create"),
        ["v2", "invoicing", "invoices", _, "send"] => Some("invoice-send"),
        ["v2", "invoicing", "search-invoices"] => None,
        _ => Some("unclassified"),
    }
}

/// The owner decision (the approval window's command, `Decision::name`) that may start `operation`.
fn owner_decision_fits(decision: &str, operation: &str) -> bool {
    match operation {
        "create" | "authorize" => decision == "deal_countersign",
        "capture" => decision == "deal_capture",
        "void" => decision == "deal_void",
        "invoice-create" | "invoice-send" => decision == "rescue_approve",
        _ => false,
    }
}

/// Why `op` is not lawful for this deal, judged only from the deal's own evidence. The three
/// authorities of AGENTS.md: an owner decision in the approval window (Human, with its decision
/// row before the money row); a rule the owner signed (clause 6 under the human-present threshold
/// on a haggle; the seller's or the house's mandate, on the seller side of an order the buyer
/// already approved at PayPal, and the house's create); a safe default (only a void).
pub fn unlawful(b: &ProofBundle, op: &ProofOperation) -> Option<String> {
    let deal = &b.deal;
    let name = op.operation.as_str();
    let Some(reserved) = b.audit.iter().find(|r| {
        r.action == "money.authorized"
            && detail(r)["request_id"].as_str() == op.request_id.as_deref()
            && detail(r)["operation"].as_str() == Some(name)
    }) else {
        return Some("no money.authorized row records its authority".into());
    };
    let earlier = |test: &dyn Fn(&ProofAuditRow, &Value) -> bool| {
        b.audit
            .iter()
            .filter(|r| r.seq < reserved.seq)
            .any(|r| test(r, &detail(r)))
    };
    if name.starts_with("invoice-")
        && (deal.kind != DealKind::Rescue || !matches!(op.decided_by, DecidedBy::Human { .. }))
    {
        return Some("an invoice goes out only on the owner's decision on a rescue deal".into());
    }
    let money_step = matches!(name, "create" | "authorize" | "capture");
    match &op.decided_by {
        DecidedBy::SafeDefault { .. } => {
            (name != "void").then(|| format!("a safe default decided a {name}; it may only void"))
        }
        DecidedBy::Policy { clause: 6 } => {
            let threshold = b.mandate.payload.clauses.iter().find_map(|c| match c {
                Clause::HumanPresentOver { amount } => Some(*amount),
                _ => None,
            });
            let under = match (threshold, deal.terms.amount()) {
                (Some(limit), Ok(amount)) => {
                    limit.currency() == amount.currency() && amount.minor() <= limit.minor()
                }
                _ => false,
            };
            if !money_step {
                Some(format!("the clause-6 rule decided a {name}"))
            } else if deal.kind != DealKind::Haggle {
                Some(format!(
                    "the clause-6 rule decided a {name} on a {:?} deal",
                    deal.kind
                ))
            } else if !under {
                Some(format!(
                    "the clause-6 rule decided a {name} above the human-present threshold"
                ))
            } else {
                None
            }
        }
        DecidedBy::Policy { clause } => Some(format!(
            "clause {clause} decided a {name}; only clause 6 countersigns"
        )),
        DecidedBy::Human { .. } => {
            let decided = serde_json::to_value(&op.decided_by).unwrap_or(Value::Null);
            let saw = earlier(&|r, d| {
                r.action == "owner.decision"
                    && d["decided_by"] == decided
                    && d["decision"]
                        .as_str()
                        .is_some_and(|n| owner_decision_fits(n, name))
            });
            (!saw).then(|| {
                format!("an owner {name} with no owner decision in the approval window before it")
            })
        }
        DecidedBy::SellerMandate { mandate_hash } | DecidedBy::HouseMandate { mandate_hash } => {
            let house = matches!(op.decided_by, DecidedBy::HouseMandate { .. });
            let approved = earlier(&|r, d| r.action == "deal.transition" && d["to"] == "APPROVED");
            if deal.side != Side::Seller {
                Some(format!(
                    "a seller's mandate decided a {name} on the buyer side"
                ))
            } else if b.mandate.payload.hash().ok() != Some(*mandate_hash) {
                Some(format!(
                    "the mandate behind a {name} is not this deal's signed mandate"
                ))
            } else if house && deal.kind != DealKind::Haggle {
                Some(format!("the house mandate decided a {name} off a haggle"))
            } else {
                match name {
                    "create" if house => None,
                    "authorize" | "capture" if approved => None,
                    "authorize" | "capture" => Some(format!(
                        "a seller's mandate decided a {name} before the buyer approved the order at PayPal"
                    )),
                    _ => Some(format!("a seller's mandate decided a {name}")),
                }
            }
        }
    }
}

/// Every way one deal's evidence breaks the money-authority invariant. `needles` are counterparty
/// texts (a test's seeded notes and their tags): none may appear in anything stored about PayPal.
pub fn deal_violations(b: &ProofBundle, needles: &[String]) -> Vec<Violation> {
    let deal = &b.deal;
    let at = |kind: ViolationKind, what: String| Violation {
        deal: Some(deal.id),
        kind,
        detail: format!("{:?} deal {}: {what}", deal.kind, deal.id),
    };
    let mut out = Vec::new();
    for op in &b.operations {
        if let Some(why) = unlawful(b, op) {
            out.push(at(
                ViolationKind::Authority,
                format!(
                    "{} (attempt {}, decided_by {:?}): {why}",
                    op.operation, op.attempt, op.decided_by
                ),
            ));
        }
    }
    for call in &b.paypal_calls {
        match money_kind(&call.method, &call.path) {
            None => {}
            Some("unclassified") => out.push(at(
                ViolationKind::UntrackedCall,
                format!("money-shaped POST {} names no known step", call.path),
            )),
            Some(kind) => {
                let authorised = b.operations.iter().any(|op| {
                    op.operation == kind
                        && (call.request_id.is_none() || op.request_id == call.request_id)
                });
                if !authorised {
                    out.push(at(
                        ViolationKind::UntrackedCall,
                        format!("POST {} ({kind}) has no recorded authority", call.path),
                    ));
                }
            }
        }
        if !needles.is_empty() {
            let stored = format!(
                "{} {} {}",
                call.path,
                call.body,
                call.binding.clone().unwrap_or(Value::Null)
            );
            if let Some(needle) = needles.iter().find(|n| stored.contains(n.as_str())) {
                out.push(at(
                    ViolationKind::CounterpartyText,
                    format!("a stored PayPal call carries counterparty text {needle:?}"),
                ));
            }
        }
    }
    if deal.state == DealState::Refused && !b.paypal_calls.is_empty() {
        out.push(at(
            ViolationKind::RefusedDealCalled,
            format!("a refused deal has {} PayPal call(s)", b.paypal_calls.len()),
        ));
    }
    out
}

/// The offline verifier (this crate's [`crate::verify_bundle`]) over the same exported slice: an
/// independent reading of the chain, the transcript, the countersigns and the authorities must
/// agree. Only [`VERIFIER_CHECKS`] that apply count.
pub fn verifier_violations(b: &ProofBundle) -> Vec<Violation> {
    crate::verify_bundle(b)
        .checks
        .into_iter()
        .filter(|c| VERIFIER_CHECKS.contains(&c.id) && c.applies && !c.ok)
        .map(|c| Violation {
            deal: Some(b.deal.id),
            kind: ViolationKind::VerifierCheck,
            detail: format!(
                "deal {}: offline verifier check {} failed: {}",
                b.deal.id, c.id, c.detail
            ),
        })
        .collect()
}

/// One deal as the caller exported it: its slice, or why its evidence would not export.
pub type DealExport = Result<ProofBundle, (DealId, String)>;

/// The predicate over one wallet's ledger: `chain` is the audit chain's own verification (its
/// error text when it does not verify) and `deals` every deal's export. Every deal must export
/// and pass [`deal_violations`] and [`verifier_violations`]. Empty means the invariant holds.
pub fn ledger_violations(
    chain: Result<(), String>,
    deals: &[DealExport],
    needles: &[String],
) -> Vec<Violation> {
    let mut out = Vec::new();
    if let Err(error) = chain {
        out.push(Violation {
            deal: None,
            kind: ViolationKind::ChainBroken,
            detail: format!("the audit chain does not verify: {error}"),
        });
    }
    for deal in deals {
        match deal {
            Ok(bundle) => {
                out.extend(deal_violations(bundle, needles));
                out.extend(verifier_violations(bundle));
            }
            Err((id, error)) => out.push(Violation {
                deal: Some(*id),
                kind: ViolationKind::EvidenceUnreadable,
                detail: format!("deal {id}: its evidence does not verify for export: {error}"),
            }),
        }
    }
    out
}

/// Who a money step stood on, as the safety record counts it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Authority {
    /// The owner, in the approval window.
    Owner,
    /// A rule the owner signed (the clause-6 countersign).
    SignedRule,
    /// The seller's signed shop rules collecting what a buyer approved at PayPal.
    SellerRules,
    /// The house seller's signed rules.
    HouseRules,
    /// A deadline's safe default.
    SafeDefault,
}
impl Authority {
    pub const fn of(decided: &DecidedBy) -> Self {
        match decided {
            DecidedBy::Human { .. } => Self::Owner,
            DecidedBy::Policy { .. } => Self::SignedRule,
            DecidedBy::SellerMandate { .. } => Self::SellerRules,
            DecidedBy::HouseMandate { .. } => Self::HouseRules,
            DecidedBy::SafeDefault { .. } => Self::SafeDefault,
        }
    }
}

/// The counts behind the safety record, read from exported slices only.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tally {
    /// Deals whose slice exported (each export re-verified its transcript).
    pub transcripts: u32,
    /// Money steps (`operations` rows) by authority, and how many of them were voids.
    pub steps: Vec<(Authority, u32, u32)>,
    /// One entry per `intent.refused` row: its closed code, `None` when the row has none (an
    /// older record) or it does not read.
    pub refusals: Vec<Option<RefusalCode>>,
    /// Deals the rules refused, and the PayPal calls recorded on them (must be 0).
    pub refused_deals: u32,
    pub refused_deal_calls: u32,
}
impl Tally {
    /// Money steps under `authority`, and how many of them were voids.
    pub fn steps_of(&self, authority: Authority) -> (u32, u32) {
        self.steps
            .iter()
            .find(|(a, _, _)| *a == authority)
            .map_or((0, 0), |(_, n, voids)| (*n, *voids))
    }
}
fn bump(n: &mut u32) {
    *n = n.saturating_add(1);
}

/// Counts money steps by authority, refusals by code and calls on refused deals.
pub fn tally<'a>(bundles: impl IntoIterator<Item = &'a ProofBundle>) -> Tally {
    let mut out = Tally::default();
    for b in bundles {
        bump(&mut out.transcripts);
        for op in &b.operations {
            let authority = Authority::of(&op.decided_by);
            let at = match out.steps.iter().position(|(a, _, _)| *a == authority) {
                Some(at) => at,
                None => {
                    out.steps.push((authority, 0, 0));
                    out.steps.len() - 1
                }
            };
            if let Some(entry) = out.steps.get_mut(at) {
                bump(&mut entry.1);
                if op.operation == "void" {
                    bump(&mut entry.2);
                }
            }
        }
        for row in b.audit.iter().filter(|r| r.action == "intent.refused") {
            let code = serde_json::from_value::<RefusalCode>(detail(row)["code"].clone()).ok();
            out.refusals.push(code);
        }
        if b.deal.state == DealState::Refused {
            bump(&mut out.refused_deals);
            out.refused_deal_calls = out
                .refused_deal_calls
                .saturating_add(u32::try_from(b.paypal_calls.len()).unwrap_or(u32::MAX));
        }
    }
    out.steps.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn money_kind_names_every_money_post_and_reads_nothing_else() {
        assert_eq!(money_kind("POST", "/v2/checkout/orders"), Some("create"));
        assert_eq!(
            money_kind("POST", "/v2/checkout/orders/O1/authorize"),
            Some("authorize")
        );
        assert_eq!(
            money_kind("POST", "/v2/payments/authorizations/A1/capture?x=1"),
            Some("capture")
        );
        assert_eq!(
            money_kind("POST", "/v2/payments/authorizations/A1/void"),
            Some("void")
        );
        assert_eq!(
            money_kind("POST", "/v2/payments/captures/C1/refund"),
            Some("unclassified")
        );
        assert_eq!(money_kind("GET", "/v2/checkout/orders/O1"), None);
        assert_eq!(money_kind("POST", "/v1/oauth2/token"), None);
        assert_eq!(money_kind("POST", "/v2/invoicing/search-invoices"), None);
    }

    #[test]
    fn a_broken_chain_and_an_unexportable_deal_are_named() {
        let id: DealId = "01J9GAVNTH0000000000000001".parse().unwrap();
        let found = ledger_violations(Err("row 4".into()), &[Err((id, "bad".into()))], &[]);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].kind, ViolationKind::ChainBroken);
        assert!(found[0].to_string().contains("row 4"));
        assert_eq!(found[1].kind, ViolationKind::EvidenceUnreadable);
        assert_eq!(found[1].deal, Some(id));
        assert!(ledger_violations(Ok(()), &[], &[]).is_empty());
        assert_eq!(tally(&[]), Tally::default());
    }
}
