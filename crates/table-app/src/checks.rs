//! The approval checklist (design §10.3), composed from the predicates the money steps run.
//!
//! [`compose`] is pure: it turns [`CheckFacts`] into the six lines the approval window renders
//! verbatim. [`Pipeline::approval_checks`] gathers those facts from the ledger, the scam shield
//! and the mandate check at `now`; it calls no PayPal and writes nothing. The runtime recomputes
//! the list when the owner decides and refuses a decision whose `checks_hash` differs, so the
//! audit row proves which checks the owner saw.
//!
//! `text` is Layer 1 (plain words for the owner, no ids or clause numbers, docs/ux/UX-GUIDE.md);
//! `detail` is Layer 2 and may name clauses, hosts and ids.
use crate::{Error, Pipeline};
use table_core::{
    ApprovalCheck, ApprovalCheckId, ApprovalCheckStatus, Clause, Currency, Deal, DealKind,
    DealState, H256, MandateDecision, Mode, Money, PayeeRef, ShieldRule, ShieldVerdict, Side,
    Timestamp, invoice_id,
};
use table_ledger::LedgerError;
use table_proto::Body;

/// The latest stored SETTLE: the payment request the order was made from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SettleFact {
    pub amount: Money,
    pub invoice_id: String,
    pub approve_url: String,
    pub attempt: u8,
    /// The order holds the money first (intent AUTHORIZE), as the protocol requires.
    pub authorize: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PayeeFact {
    /// Who the order pays (`settlement_payee`). `own` = the owner's own single approved payee
    /// (a seller deal); otherwise the counterparty's declared payee, `paired` when the owner
    /// confirmed that key's pairing words. `approved` is the mandate's Payees rule, if any.
    Bound {
        payee: PayeeRef,
        own: bool,
        paired: bool,
        approved: Option<Vec<PayeeRef>>,
    },
    Unreadable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MandateFact {
    Allow {
        per_deal: Option<Money>,
        ask_above: Option<Money>,
    },
    /// The mandate asks the owner (clause 6 above its threshold): an owner decision satisfies it.
    Ask {
        clause: u8,
        threshold: Option<Money>,
    },
    Refused {
        clause: u8,
        reason: String,
    },
    /// Revoked, replaced, expired or not yet in force.
    Retired,
    Unavailable,
}

/// Everything [`compose`] reads. `settle: Err(())` = the stored request or the signed transcript
/// did not verify; `shield: None` = the verdict could not be computed. Both fail closed.
#[derive(Debug, Clone)]
pub struct CheckFacts<'a> {
    pub deal: &'a Deal,
    pub attempt: u8,
    pub settle: Result<Option<SettleFact>, ()>,
    /// On a buyer haggle the owner is asked to accept: the latest inbound counter's terms hash.
    pub offer_terms: Option<H256>,
    pub payee: PayeeFact,
    pub shield: Option<ShieldVerdict>,
    /// The rule behind the shield's verdict (shield slice 2); `None` for a CLEAR or unknown.
    pub shield_rule: Option<ShieldRule>,
    /// The verdict is a HOLD the owner released for these terms (it reads as ASK in `shield`).
    pub shield_released: bool,
    pub mandate: MandateFact,
}

fn line(
    id: ApprovalCheckId,
    status: ApprovalCheckStatus,
    text: String,
    detail: String,
) -> ApprovalCheck {
    ApprovalCheck {
        id,
        status,
        text,
        detail,
    }
}

/// Money in the owner's words: "$1,329.00", "€12.50", "1,200 JPY" (the client's formatMoney).
pub fn plain_money(m: Money) -> String {
    let decimal = m.decimal();
    let (whole, frac) = decimal.split_once('.').unwrap_or((decimal.as_str(), ""));
    let mut grouped = String::new();
    for (i, c) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(c);
    }
    let body = if frac.is_empty() {
        grouped
    } else {
        format!("{grouped}.{frac}")
    };
    match m.currency() {
        Currency::USD => format!("${body}"),
        Currency::EUR => format!("€{body}"),
        Currency::GBP => format!("£{body}"),
        other => format!("{body} {other}"),
    }
}

fn short(hash: H256) -> String {
    let hex = hash.hex();
    format!("{}…{}", &hex[..8], &hex[hex.len() - 4..])
}

/// The rule's name (UX-GUIDE "Rule names"), for Layer 1.
fn rule_name(clause: u8) -> &'static str {
    match clause {
        1 => "what agents may do",
        2 => "who they deal with",
        3 => "the limit per deal",
        4 => "the price range",
        5 => "the daily limit",
        0 => "your wallet limits",
        6 => "ask me above",
        7 => "approved payees",
        8 => "fixes for failed renewals",
        _ => "a rule",
    }
}

/// An order is still to be made for this deal: its request-dependent checks wait for that step.
fn order_expected(state: DealState) -> bool {
    matches!(state, DealState::Agreed | DealState::Settling)
}

/// The six lines, in [`ApprovalCheckId`] order.
pub fn compose(f: &CheckFacts<'_>) -> Vec<ApprovalCheck> {
    vec![
        amount(f),
        payee(f),
        host(f),
        invoice(f),
        shield(f),
        mandate(f),
    ]
}

fn amount(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Amount;
    let (Ok(terms), Ok(terms_hash)) = (f.deal.terms.amount(), f.deal.terms.hash()) else {
        return line(
            id,
            Fail,
            "The agreed amount can’t be read.".into(),
            "the signed terms do not give a valid amount".into(),
        );
    };
    let signed = format!(
        "signed terms {} × {} = {terms} (terms {})",
        f.deal.terms.qty,
        f.deal.terms.unit_price,
        short(terms_hash)
    );
    if f.deal.state == DealState::Mismatch {
        return line(
            id,
            Fail,
            format!(
                "The payment request didn’t match the {} you agreed.",
                plain_money(terms)
            ),
            format!(
                "deal state MISMATCH: the payment request (SETTLE or PayPal order) disagreed with the {signed}; a refused request is never stored"
            ),
        );
    }
    match &f.settle {
        Err(()) => line(
            id,
            Fail,
            "The payment request can’t be read, so it can’t be compared.".into(),
            "the stored SETTLE or the signed transcript did not verify".into(),
        ),
        Ok(Some(s)) if s.amount != terms => line(
            id,
            Fail,
            format!(
                "The payment request asks {}, but you agreed {}.",
                plain_money(s.amount),
                plain_money(terms)
            ),
            format!(
                "SETTLE amount {} (attempt {}) ≠ {signed}",
                s.amount, s.attempt
            ),
        ),
        Ok(Some(s)) if !s.authorize => line(
            id,
            Fail,
            "The payment request would take the money at once instead of holding it first.".into(),
            format!("SETTLE intent is not AUTHORIZE (attempt {})", s.attempt),
        ),
        Ok(Some(s)) => line(
            id,
            Pass,
            format!(
                "The payment request is for {}, the amount you agreed.",
                plain_money(terms)
            ),
            format!(
                "SETTLE amount {} (attempt {}, intent AUTHORIZE) = {signed}",
                s.amount, s.attempt
            ),
        ),
        Ok(None) => match f.offer_terms {
            Some(offer) if offer == terms_hash => line(
                id,
                Pass,
                format!(
                    "Their latest offer is {}, the price you’re approving.",
                    plain_money(terms)
                ),
                format!("latest inbound COUNTER terms {} = {signed}", short(offer)),
            ),
            Some(offer) => line(
                id,
                Fail,
                "Their latest offer isn’t the price shown here.".into(),
                format!("latest inbound COUNTER terms {} ≠ {signed}", short(offer)),
            ),
            None => line(
                id,
                Wait,
                "Checked when the PayPal order is made, before any money moves.".into(),
                format!(
                    "no payment request yet; making the order verifies its amount against the {signed} and stops the deal as MISMATCH otherwise"
                ),
            ),
        },
    }
}

fn payee(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Payee;
    let PayeeFact::Bound {
        payee,
        own,
        paired,
        approved,
    } = &f.payee
    else {
        return line(
            id,
            Fail,
            "Who gets paid can’t be confirmed.".into(),
            "settlement payee unreadable (no single approved payee in your rules, or no counterparty record)".into(),
        );
    };
    let listed = approved.as_ref().map(|list| list.contains(payee));
    let rule = match approved {
        Some(list) => format!(
            "clause 7 approved payees [{}]",
            list.iter()
                .map(PayeeRef::as_str)
                .collect::<Vec<_>>()
                .join(", ")
        ),
        None => "no approved-payees rule (clause 7)".into(),
    };
    if listed == Some(false) {
        return line(
            id,
            Fail,
            "Who gets paid isn’t on your approved payees.".into(),
            format!("payee {payee} is not on {rule}"),
        );
    }
    if *own {
        return line(
            id,
            Pass,
            "Paid to your own payee from your rules.".into(),
            format!("order payee {payee} = the single payee on {rule}"),
        );
    }
    let key = f.deal.counterparty.as_str();
    if *paired {
        return line(
            id,
            Pass,
            "Paid only to the payee their wallet declared when you connected.".into(),
            format!("settlement payee {payee} = declared payee of the paired key {key}; {rule}"),
        );
    }
    if listed == Some(true) {
        return line(
            id,
            Pass,
            "Paid only to a payee on your approved payees.".into(),
            format!("settlement payee {payee} (key {key} not paired) is on {rule}"),
        );
    }
    line(
        id,
        Fail,
        "This wallet isn’t one you connected, so who gets paid can’t be confirmed.".into(),
        format!(
            "key {key} has no confirmed pairing words and its declared payee {payee} is not approved; {rule}"
        ),
    )
}

fn host(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Host;
    match &f.settle {
        Err(()) => line(
            id,
            Fail,
            "The PayPal link can’t be read.".into(),
            "the stored SETTLE or the signed transcript did not verify".into(),
        ),
        Ok(Some(s)) => {
            let host = url::Url::parse(&s.approve_url)
                .ok()
                .and_then(|u| u.host_str().map(str::to_owned))
                .unwrap_or_else(|| "(unparsable link)".into());
            match table_proto::approval_url(&s.approve_url, f.deal.mode) {
                Ok(_) => line(
                    id,
                    Pass,
                    "The PayPal link goes to PayPal’s own sandbox site.".into(),
                    format!(
                        "approve link host {host} over https; allowlist www.sandbox.paypal.com"
                    ),
                ),
                Err(_) => line(
                    id,
                    Fail,
                    if f.deal.mode == Mode::Replay {
                        "A replay never opens PayPal.".into()
                    } else {
                        "The PayPal link doesn’t go to PayPal’s own site.".into()
                    },
                    format!(
                        "approve link host {host} refused: the allowlist is https://www.sandbox.paypal.com (port 443, no credentials, no fragment) in sandbox mode"
                    ),
                ),
            }
        }
        Ok(None) if order_expected(f.deal.state) => line(
            id,
            Wait,
            "The PayPal link is checked when the order is made.".into(),
            "no approval link yet; making the order verifies the link is on the allowlist (www.sandbox.paypal.com)".into(),
        ),
        Ok(None) => line(
            id,
            NotApplicable,
            "No PayPal link is used for this step.".into(),
            "no SETTLE: no approval link exists for this deal".into(),
        ),
    }
}

fn invoice(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Invoice;
    match &f.settle {
        Err(()) => line(
            id,
            Fail,
            "The order number can’t be read.".into(),
            "the stored SETTLE or the signed transcript did not verify".into(),
        ),
        Ok(Some(s)) => {
            let expected = invoice_id(f.deal.id, f.attempt).ok();
            if s.attempt == f.attempt && expected.as_deref() == Some(s.invoice_id.as_str()) {
                line(
                    id,
                    Pass,
                    format!(
                        "The order number is new for this try ({} of 3), so an old order can’t be reused.",
                        f.attempt
                    ),
                    format!(
                        "invoice_id {} = deal id + attempt {}",
                        s.invoice_id, f.attempt
                    ),
                )
            } else {
                line(
                    id,
                    Fail,
                    "The order number doesn’t belong to this try.".into(),
                    format!(
                        "SETTLE invoice_id {} for attempt {}; expected {} for attempt {}",
                        s.invoice_id,
                        s.attempt,
                        expected.unwrap_or_else(|| "(invalid attempt)".into()),
                        f.attempt
                    ),
                )
            }
        }
        Ok(None) if order_expected(f.deal.state) => line(
            id,
            Wait,
            "The order number is set when the order is made.".into(),
            format!(
                "invoice_id {} is bound into the order and the countersign when the order is made",
                invoice_id(f.deal.id, f.attempt).unwrap_or_else(|_| "(invalid attempt)".into())
            ),
        ),
        Ok(None) => line(
            id,
            NotApplicable,
            "No PayPal order is used for this step.".into(),
            "no SETTLE: no order exists for this deal".into(),
        ),
    }
}

/// The shield rule in the owner's words: what was found, never who said what.
pub fn shield_rule_words(rule: ShieldRule) -> &'static str {
    match rule {
        ShieldRule::PayeeMismatch => "The money would go to another payee than the one you agreed",
        ShieldRule::FriendsAndFamily => {
            "It asks to be paid as friends and family, which has no buyer protection"
        }
        ShieldRule::NoMarketReference => "There is no recent usual price to compare it with",
        ShieldRule::PriceOverMarket => "The price is far above the usual price",
        ShieldRule::NewCounterpartyOverThreshold => "A new payee is asking for a large amount",
        ShieldRule::ModelCaution => "A second look asked for caution",
    }
}
/// The rule's own name for the technical detail line.
fn shield_rule_name(rule: Option<ShieldRule>) -> String {
    rule.and_then(|r| serde_json::to_value(r).ok())
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| "none".into())
}
fn shield(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Shield;
    let why = f
        .shield_rule
        .map(|r| format!(" {}.", shield_rule_words(r)))
        .unwrap_or_default();
    let rule = shield_rule_name(f.shield_rule);
    if f.shield_released && f.shield == Some(ShieldVerdict::Ask) {
        return line(
            id,
            Pass,
            format!(
                "Scam check: you let this go on after a pause.{why} Your decision is the check."
            ),
            format!(
                "shield verdict HOLD (rule {rule}) released by the owner for these terms: judged as ASK"
            ),
        );
    }
    match f.shield {
        Some(ShieldVerdict::Clear) => line(
            id,
            Pass,
            "Scam check: looks safe.".into(),
            "shield verdict CLEAR (rules re-run now, combined with any stored verdict)".into(),
        ),
        Some(ShieldVerdict::Ask) => line(
            id,
            Pass,
            format!("Scam check: check with you.{why} Your decision is the check."),
            format!(
                "shield verdict ASK (rule {rule}): only an owner decision (or the house release) passes it"
            ),
        ),
        Some(ShieldVerdict::Hold) => line(
            id,
            Fail,
            format!("Scam check: paused for you.{why} Unpause it first."),
            format!(
                "shield verdict HOLD (rule {rule}) stops every money step under every authority"
            ),
        ),
        Some(ShieldVerdict::Block) => line(
            id,
            Fail,
            format!("Scam check: blocked.{why} It can’t be released."),
            format!("shield verdict BLOCK (rule {rule}) stops every money step; no release exists"),
        ),
        None => line(
            id,
            Fail,
            "The scam check couldn’t run, so nothing can go ahead.".into(),
            "shield verdict unavailable (a ledger read failed)".into(),
        ),
    }
}

fn mandate(f: &CheckFacts<'_>) -> ApprovalCheck {
    use ApprovalCheckStatus::*;
    let id = ApprovalCheckId::Mandate;
    let which = format!("mandate {} v{}", f.deal.mandate_id, f.deal.mandate_version);
    match &f.mandate {
        MandateFact::Allow {
            per_deal,
            ask_above,
        } => line(
            id,
            Pass,
            match per_deal {
                Some(max) => format!("Inside your rules: up to {} per deal.", plain_money(*max)),
                None => "Inside your rules.".into(),
            },
            format!(
                "{which}: allowed{}{}",
                per_deal
                    .map(|m| format!("; clause 3 limit per deal {m}"))
                    .unwrap_or_default(),
                ask_above
                    .map(|m| format!("; clause 6 asks above {m}, not reached"))
                    .unwrap_or_default()
            ),
        ),
        MandateFact::Ask { clause, threshold } => line(
            id,
            Pass,
            match threshold {
                Some(t) => format!(
                    "Above your ask-me limit of {}, so it’s your call.",
                    plain_money(*t)
                ),
                None => "Your rules ask you to decide this one.".into(),
            },
            format!(
                "{which}: clause {clause} asks the owner{}; the owner decision satisfies it",
                threshold.map(|t| format!(" above {t}")).unwrap_or_default()
            ),
        ),
        MandateFact::Refused { clause, reason } => line(
            id,
            Fail,
            format!("Outside your rules: {}.", rule_name(*clause)),
            format!("{which}: clause {clause} refuses: {reason}"),
        ),
        MandateFact::Retired => line(
            id,
            Fail,
            "These rules are no longer in force.".into(),
            format!("{which} is not active (revoked, replaced, expired or not yet in force)"),
        ),
        MandateFact::Unavailable => line(
            id,
            Fail,
            "Your rules couldn’t be checked, so nothing can go ahead.".into(),
            format!("{which}: the mandate check could not run"),
        ),
    }
}

impl Pipeline {
    /// Read-only: the approval checklist for `id` at `now`, from the same predicates the money
    /// steps run (stored SETTLE, settlement payee, shield verdict, mandate check). No PayPal call,
    /// no write. The caller selects the deal's agent signer first (as the steps do); a wrong
    /// signer reads as a failed mandate line, never a pass.
    pub fn approval_checks(
        &self,
        id: table_core::DealId,
        now: Timestamp,
    ) -> Result<Vec<ApprovalCheck>, Error> {
        let ledger = &self.wallet.ledger;
        let deal = ledger.get_deal(id)?;
        let attempt = ledger.settled_attempt(id)?.max(1);
        let settle = match ledger.latest_settle(id) {
            Ok(Some(Body::Settle {
                amount,
                invoice_id,
                approve_url,
                intent,
                attempt,
                ..
            })) => Ok(Some(SettleFact {
                amount,
                invoice_id: invoice_id.as_str().to_owned(),
                approve_url: approve_url.as_str().to_owned(),
                attempt,
                authorize: intent == table_proto::Intent::Authorize,
            })),
            Ok(_) => Ok(None),
            Err(_) => Err(()),
        };
        let offer_terms = if deal.side == Side::Buyer
            && deal.kind == DealKind::Haggle
            && deal.state == DealState::Negotiating
        {
            ledger
                .last_proposal(id)
                .ok()
                .filter(|(_, _, dir, counter)| *dir == table_ledger::Direction::Inbound && *counter)
                .and_then(|_| ledger.pending_offer(id).ok())
                .map(|(_, hash)| hash)
        } else {
            None
        };
        let active =
            ledger.active_mandate(deal.mandate_id, deal.mandate_version, &self.wallet.owner);
        let approved = active.as_ref().ok().and_then(|m| {
            m.payload.clauses.iter().find_map(|c| match c {
                Clause::Payees { payees } => Some(payees.clone()),
                _ => None,
            })
        });
        let payee = match self.wallet.settlement_payee(&deal) {
            Ok(payee) => {
                let own = deal.side == Side::Seller;
                PayeeFact::Bound {
                    payee,
                    own,
                    paired: own
                        || ledger
                            .counterparty_policy(&deal.counterparty)
                            .is_ok_and(|(paired, _, _)| paired),
                    approved,
                }
            }
            Err(_) => PayeeFact::Unreadable,
        };
        let mandate = match &active {
            Err(LedgerError::NotFound) => MandateFact::Retired,
            Err(_) => MandateFact::Unavailable,
            Ok(m) if now < m.payload.not_before || now >= m.payload.expires => MandateFact::Retired,
            Ok(m) => {
                let clause_money = |pick: fn(&Clause, DealKind) -> Option<Money>| {
                    m.payload.clauses.iter().find_map(|c| pick(c, deal.kind))
                };
                let per_deal = clause_money(|c, kind| match c {
                    Clause::PerDeal {
                        kind: k,
                        max_amount,
                        ..
                    } if *k == kind => Some(*max_amount),
                    _ => None,
                });
                let ask_above = clause_money(|c, _| match c {
                    Clause::HumanPresentOver { amount } => Some(*amount),
                    _ => None,
                });
                match ledger
                    .deal_category(id)
                    .map_err(Error::from)
                    .and_then(|category| self.wallet.mandate_check(&deal, category, now))
                {
                    Ok(MandateDecision::Allow) => MandateFact::Allow {
                        per_deal,
                        ask_above,
                    },
                    Ok(MandateDecision::Ask { clause }) => MandateFact::Ask {
                        clause,
                        threshold: if clause == 6 { ask_above } else { None },
                    },
                    Err(Error::Refused(r)) => MandateFact::Refused {
                        clause: r.clause,
                        reason: r.reason,
                    },
                    Err(Error::Ledger(LedgerError::NotFound)) => MandateFact::Retired,
                    Err(_) => MandateFact::Unavailable,
                }
            }
        };
        let gate = self.shield_gate(&deal, now).ok();
        let facts = CheckFacts {
            deal: &deal,
            attempt,
            settle,
            offer_terms,
            payee,
            shield: gate.map(|g| g.gating()),
            shield_rule: gate.and_then(|g| g.rule),
            shield_released: gate.is_some_and(|g| g.released),
            mandate,
        };
        if deal.kind == DealKind::Rescue {
            let lever = active
                .as_ref()
                .ok()
                .and_then(|m| table_core::lever_clause(&m.payload))
                .map(|(_, bp, max)| (bp, max));
            let case = ledger.rescue_case(id).ok().flatten();
            return Ok(compose_rescue(&facts, case.as_ref(), lever));
        }
        Ok(compose(&facts))
    }
}

use table_core::percent;

/// The six lines for a rescue fix: what the invoice asks against the signed fixes clause, who is
/// paid (the owner), that no PayPal link is opened, that the subscriber gets one invoice this
/// cycle, the scam check, and the rescue rules.
pub fn compose_rescue(
    f: &CheckFacts<'_>,
    case: Option<&table_ledger::RescueCase>,
    lever: Option<(u16, Money)>,
) -> Vec<ApprovalCheck> {
    use ApprovalCheckStatus::*;
    let mut lines = compose(f);
    let terms = f.deal.terms.amount().ok();
    let amount = match case {
        Some(c) if Some(c.offer.invoice) == terms && f.deal.terms.qty == 1 => line(
            ApprovalCheckId::Amount,
            Pass,
            format!(
                "The invoice asks {}: {} off this cycle’s {}.",
                plain_money(c.offer.invoice),
                percent(c.offer.discount_bp),
                plain_money(c.offer.cycle)
            ),
            format!(
                "rescue offer {:?}: cycle {} − discount {} = invoice {} = signed terms (qty 1)",
                c.offer.lever, c.offer.cycle, c.offer.discount, c.offer.invoice
            ),
        ),
        _ => line(
            ApprovalCheckId::Amount,
            Fail,
            "The fix’s amount can’t be confirmed.".into(),
            "no rescue row, or its offer is not what the deal's terms invoice".into(),
        ),
    };
    let host = line(
        ApprovalCheckId::Host,
        NotApplicable,
        "No PayPal link is opened: PayPal emails the invoice to your subscriber.".into(),
        "Invoicing v2: POST /v2/invoicing/invoices then …/{id}/send; no approve link".into(),
    );
    let replay = f.deal.mode == Mode::Replay;
    let invoice = match (case, &f.deal.paypal.order) {
        (None, _) => line(
            ApprovalCheckId::Invoice,
            Fail,
            "The failed renewal behind this fix can’t be read.".into(),
            "no rescue row for this deal".into(),
        ),
        (Some(_), order) => line(
            ApprovalCheckId::Invoice,
            Pass,
            if replay {
                "A replayed failure: the invoice is real, but what it brings in is not counted as recovered.".into()
            } else {
                "This subscriber gets one invoice for this cycle.".into()
            },
            format!(
                "one rescue per subscription per failed cycle; invoice number {} (attempt 1){}",
                table_paypal::rescue_invoice_number(f.deal.id, 1)
                    .unwrap_or_else(|_| "(invalid)".into()),
                order
                    .as_ref()
                    .map(|o| format!("; PayPal invoice {o}"))
                    .unwrap_or_default()
            ),
        ),
    };
    let mandate = match (&f.mandate, lever) {
        (MandateFact::Allow { .. } | MandateFact::Ask { .. }, Some((bp, max))) => line(
            ApprovalCheckId::Mandate,
            Pass,
            format!(
                "Inside your rescue rules: at most {} or {} off a cycle.",
                percent(bp),
                plain_money(max)
            ),
            format!(
                "mandate {} v{}: clauses 1-7 allow; clause 8 allows DISCOUNT_THIS_CYCLE up to {bp} bp and {max}",
                f.deal.mandate_id, f.deal.mandate_version
            ),
        ),
        _ => lines[5].clone(),
    };
    lines[0] = amount;
    lines[2] = host;
    lines[3] = invoice;
    lines[5] = mandate;
    lines
}
