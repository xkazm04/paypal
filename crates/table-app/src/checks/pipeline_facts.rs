use super::{CheckFacts, MandateFact, PayeeFact, SettleFact, compose, compose_rescue};
use crate::{Error, Pipeline};
use table_core::{
    ApprovalCheck, Clause, DealKind, DealState, MandateDecision, Money, Side, Timestamp,
};
use table_ledger::LedgerError;
use table_proto::Body;

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
            Some(
                ledger
                    .last_proposal(id)
                    .ok()
                    .filter(|(_, _, dir, counter)| {
                        *dir == table_ledger::Direction::Inbound && *counter
                    })
                    .and_then(|_| ledger.pending_offer(id).ok())
                    .map(|(_, hash)| hash)
                    .ok_or(()),
            )
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
                            .counterparty_policy_at(&deal.counterparty, now)
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
