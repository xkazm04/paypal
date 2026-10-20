//! The money-authority rule of AGENTS.md, written once. The offline verifier's "authority" and
//! "countersign" checks and the safety predicate ([`crate::safety::unlawful`]) all judge a money
//! step here, so the verifier a judge runs is exactly as strict as the gauntlet. The independent
//! reading that matters (this crate against table-app's pipeline) is kept; only this crate's own
//! copies of the rule were merged.
use crate::detail;
use serde_json::Value;
use table_core::{Clause, DealKind, DecidedBy, Side};
use table_proto::{PROOF_FORMAT_V1, ProofAuditRow, ProofBundle, ProofOperation};

/// The money steps the wallet sends to PayPal. Closed: a new step is named here, and every reader
/// of a proof file gets it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoneyOp {
    Create,
    Authorize,
    Capture,
    Void,
    /// Subscription rescue: the owner's discount invoice (create, then send).
    InvoiceCreate,
    InvoiceSend,
}
impl MoneyOp {
    pub const ALL: [Self; 6] = [
        Self::Create,
        Self::Authorize,
        Self::Capture,
        Self::Void,
        Self::InvoiceCreate,
        Self::InvoiceSend,
    ];
    /// The name an `operations` row and a `money.authorized` row record.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Authorize => "authorize",
            Self::Capture => "capture",
            Self::Void => "void",
            Self::InvoiceCreate => "invoice-create",
            Self::InvoiceSend => "invoice-send",
        }
    }
    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|op| op.name() == name)
    }
    /// The owner decision (the approval window's command, service.rs `Decision::name`) that may
    /// start this step.
    pub const fn owner_decision(self) -> &'static str {
        match self {
            Self::Create | Self::Authorize => "deal_countersign",
            Self::Capture => "deal_capture",
            Self::Void => "deal_void",
            Self::InvoiceCreate | Self::InvoiceSend => "rescue_approve",
        }
    }
}

/// What a stored PayPal call is, from its method and path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Call {
    /// Moves no money: any method but POST, the token call, the invoice search.
    Read,
    Op(MoneyOp),
    /// A money-shaped POST nobody named. The wallet never puts a query on a money POST, so a
    /// query makes the call unclassified rather than the step its path would otherwise name.
    Unclassified,
}

/// The one path table every reader of a proof file uses.
pub fn classify(method: &str, path: &str) -> Call {
    if method != "POST" {
        return Call::Read;
    }
    let (path, query) = match path.split_once('?') {
        Some((path, _)) => (path, true),
        None => (path, false),
    };
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    let named = match segments.as_slice() {
        ["v1", "oauth2", "token"] | ["v2", "invoicing", "search-invoices"] => return Call::Read,
        ["v2", "checkout", "orders"] => MoneyOp::Create,
        ["v2", "checkout", "orders", _, "authorize"] => MoneyOp::Authorize,
        ["v2", "payments", "authorizations", _, "capture"] => MoneyOp::Capture,
        ["v2", "payments", "authorizations", _, "void"] => MoneyOp::Void,
        ["v2", "invoicing", "invoices"] => MoneyOp::InvoiceCreate,
        ["v2", "invoicing", "invoices", _, "send"] => MoneyOp::InvoiceSend,
        _ => return Call::Unclassified,
    };
    if query {
        Call::Unclassified
    } else {
        Call::Op(named)
    }
}

/// [`classify`] as a step name: `None` for a read, `"unclassified"` for a money-shaped POST nobody
/// named.
pub fn money_kind(method: &str, path: &str) -> Option<&'static str> {
    match classify(method, path) {
        Call::Read => None,
        Call::Op(op) => Some(op.name()),
        Call::Unclassified => Some("unclassified"),
    }
}

/// Whether the owner decision `decision` may start the step named `operation`.
pub fn decision_fits(decision: &str, operation: &str) -> bool {
    MoneyOp::from_name(operation).is_some_and(|op| op.owner_decision() == decision)
}

/// Who is reading the step, which decides one thing only: whether a first-format (v1) file is
/// asked for the rows the wallet records since (each step's `money.authorized` row by request id,
/// and the owner decision before an owner's step).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reader {
    /// The safety predicate: every file is held to every row, whatever its format.
    Safety,
    /// The offline verifier: a v1 file is read under its own rules, with no new demand on it.
    Verifier,
}

/// Whether `op` is lawful for this deal, judged only from the deal's own evidence: why it is, or
/// why it is not.
pub fn judge(b: &ProofBundle, op: &ProofOperation, reader: Reader) -> Result<String, String> {
    let name = op.operation.as_str();
    let reserved = b.audit.iter().find(|r| {
        r.action == "money.authorized"
            && detail(r)["request_id"].as_str() == op.request_id.as_deref()
            && detail(r)["operation"].as_str() == Some(name)
    });
    let first_format = reader == Reader::Verifier && b.format == PROOF_FORMAT_V1;
    match reserved {
        Some(row) => rule(b, name, &op.decided_by, Some(row.seq), !first_format),
        None if first_format => rule(b, name, &op.decided_by, None, false),
        None => Err("no money.authorized row records its authority".into()),
    }
}

/// The three authorities AGENTS.md allows: an owner decision in the approval window (Human, with
/// its decision row before the money row when `owner_row`); a rule the owner signed (clause 6
/// under the human-present threshold, on a haggle's create, authorize or capture; the seller's
/// mandate authorizing or capturing on the seller side of an order the buyer already approved at
/// PayPal; the house mandate's create on a haggle, and its authorize or capture after that
/// approval); a safe default (only a void). `reserved` is the seq of the step's
/// `money.authorized` row: only earlier rows count; with none (a countersign, or a v1 step the
/// file cannot place) every row of the deal counts.
pub(crate) fn rule(
    b: &ProofBundle,
    name: &str,
    decided_by: &DecidedBy,
    reserved: Option<i64>,
    owner_row: bool,
) -> Result<String, String> {
    let deal = &b.deal;
    let payload = &b.mandate.payload;
    let earlier = |test: &dyn Fn(&ProofAuditRow, &Value) -> bool| {
        b.audit
            .iter()
            .filter(|r| reserved.is_none_or(|seq| r.seq < seq))
            .any(|r| test(r, &detail(r)))
    };
    if name.starts_with("invoice-")
        && (deal.kind != DealKind::Rescue || !matches!(decided_by, DecidedBy::Human { .. }))
    {
        return Err("an invoice goes out only on the owner's decision on a rescue deal".into());
    }
    let money_step = matches!(name, "create" | "authorize" | "capture");
    match decided_by {
        DecidedBy::SafeDefault { .. } if name == "void" => Ok("safe default (void)".into()),
        DecidedBy::SafeDefault { .. } => {
            Err(format!("a safe default decided a {name}; it may only void"))
        }
        DecidedBy::Policy { clause: 6 } => {
            let threshold = payload.clauses.iter().find_map(|c| match c {
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
                Err(format!("the clause-6 rule decided a {name}"))
            } else if deal.kind != DealKind::Haggle {
                Err(format!(
                    "the clause-6 rule decided a {name} on a {:?} deal",
                    deal.kind
                ))
            } else if !under {
                Err(format!(
                    "the clause-6 rule decided a {name} above the human-present threshold"
                ))
            } else {
                Ok("owner-signed rule: clause 6, under the human-present threshold".into())
            }
        }
        DecidedBy::Policy { clause } => Err(format!(
            "clause {clause} decided a {name}; only clause 6 countersigns"
        )),
        DecidedBy::Human { at } => {
            if owner_row {
                let decided = serde_json::to_value(decided_by).unwrap_or(Value::Null);
                let saw = earlier(&|r, d| {
                    r.action == "owner.decision"
                        && d["decided_by"] == decided
                        && d["decision"]
                            .as_str()
                            .is_some_and(|n| decision_fits(n, name))
                });
                if !saw {
                    return Err(format!(
                        "an owner {name} with no owner decision in the approval window before it"
                    ));
                }
            }
            if MoneyOp::from_name(name).is_none() {
                Err(format!(
                    "an owner {name}: not a money step the wallet sends"
                ))
            } else if *at >= payload.not_before && *at <= b.exported_at {
                Ok("owner decision in the approval window (recorded by the wallet)".into())
            } else {
                Err("owner decision time is outside the mandate's validity".into())
            }
        }
        DecidedBy::SellerMandate { mandate_hash } | DecidedBy::HouseMandate { mandate_hash } => {
            let house = matches!(decided_by, DecidedBy::HouseMandate { .. });
            if deal.side != Side::Seller {
                Err(format!(
                    "a seller's mandate decided a {name} on the buyer side"
                ))
            } else if payload.hash().ok() != Some(*mandate_hash) {
                Err(format!(
                    "the mandate behind a {name} is not this deal's signed mandate"
                ))
            } else if house && deal.kind != DealKind::Haggle {
                Err(format!("the house mandate decided a {name} off a haggle"))
            } else {
                let approved =
                    || earlier(&|r, d| r.action == "deal.transition" && d["to"] == "APPROVED");
                match name {
                    "create" if house => {
                        Ok("release-pinned house mandate (pin itself not in the bundle)".into())
                    }
                    "authorize" | "capture" if approved() => Ok(if house {
                        "release-pinned house mandate (buyer approved on PayPal)".into()
                    } else {
                        "owner-signed seller mandate (buyer approved on PayPal)".into()
                    }),
                    "authorize" | "capture" => Err(format!(
                        "a seller's mandate decided a {name} before the buyer approved the order at PayPal"
                    )),
                    _ => Err(format!("a seller's mandate decided a {name}")),
                }
            }
        }
    }
}
