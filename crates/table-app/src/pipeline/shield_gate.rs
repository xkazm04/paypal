use super::Pipeline;
use crate::Error;
use table_core::*;
use table_ledger::ShieldRefusal;
/// The money step a [`Pipeline::step_allowed`] check stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoneyStep {
    Create,
    Authorize,
    Capture,
}
impl MoneyStep {
    /// The operation name the ledger and the audit log use for this step.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Authorize => "authorize",
            Self::Capture => "capture",
        }
    }
}
/// What the scam shield says about a deal at a time, and why (shield slice 2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ShieldGate {
    /// The verdict before any release: what the deal row records.
    pub verdict: ShieldVerdict,
    /// The rule that decided `verdict`; `None` for a CLEAR and for a hold with no named rule.
    pub rule: Option<ShieldRule>,
    /// The verdict is a HOLD the owner released for the deal's current terms, and the release
    /// names every rule holding it. The money steps then judge it as ASK: the owner's decisions
    /// and the seller's money in pass, a clause-6 policy step still waits for the owner.
    pub released: bool,
}
impl ShieldGate {
    /// The verdict the money steps are judged by.
    pub const fn gating(&self) -> ShieldVerdict {
        if self.released {
            ShieldVerdict::Ask
        } else {
            self.verdict
        }
    }
}
/// The scam shield's gate on a money step, shared by `create`, `authorize`, `capture` and
/// [`Pipeline::step_allowed`] so their copies cannot drift. HOLD and BLOCK stop every step under
/// every authority. ASK passes the owner's decision and the house release everywhere, and the
/// seller mandate only on authorize and capture: `authority()` grants that mandate only on a
/// seller deal whose order the buyer already approved at PayPal, and receiving money on it
/// needs no click (acceptance H5). Every other ASK, including the seller's create on policy,
/// still waits for the owner.
pub(crate) fn shield_allows(shield: ShieldVerdict, decision: &DecidedBy, step: MoneyStep) -> bool {
    match shield {
        ShieldVerdict::Clear => true,
        ShieldVerdict::Ask => match decision {
            DecidedBy::Human { .. } | DecidedBy::HouseMandate { .. } => true,
            DecidedBy::SellerMandate { .. } => {
                matches!(step, MoneyStep::Authorize | MoneyStep::Capture)
            }
            DecidedBy::Policy { .. } | DecidedBy::SafeDefault { .. } => false,
        },
        ShieldVerdict::Hold | ShieldVerdict::Block => false,
    }
}
/// One input to the shield's verdict: what the rules computed now, or what the deal row keeps.
#[derive(Debug, Clone, Copy)]
pub(super) struct ShieldSource {
    pub(super) verdict: ShieldVerdict,
    pub(super) rule: Option<ShieldRule>,
}
/// Whether a recorded verdict still binds the deal whatever the rules say now. A raised verdict
/// (a second opinion, the order check's payee BLOCK, a settlement mismatch) and any HOLD or BLOCK
/// do; an ASK the rules computed (no market reference, a new counterparty) is judged again, so
/// a market price that lands later can clear it.
fn binds(verdict: ShieldVerdict, rule: Option<ShieldRule>) -> bool {
    verdict >= ShieldVerdict::Hold
        || !matches!(
            rule,
            Some(ShieldRule::NoMarketReference | ShieldRule::NewCounterpartyOverThreshold)
        )
}
impl Pipeline {
    /// The shield's inputs for `deal` at `now`: what the deal row keeps, if it still binds the
    /// deal (first), and what the deterministic rules compute now. A BLOCK kept on the deal is
    /// final, so the rules are not consulted (`table_shield::evaluate`'s order).
    pub(super) fn shield_sources(
        &self,
        deal: &Deal,
        now: Timestamp,
    ) -> Result<Vec<ShieldSource>, Error> {
        let kept = deal
            .shield_recorded()
            .filter(|v| binds(*v, deal.shield_rule))
            .map(|verdict| ShieldSource {
                verdict,
                rule: deal.shield_rule,
            });
        // A rescue asks the owner's own subscriber to pay the owner: the payee, price and new-
        // counterparty rules guard money going out, so only a verdict raised on the deal applies.
        if deal.kind == DealKind::Rescue {
            return Ok(vec![kept.unwrap_or(ShieldSource {
                verdict: ShieldVerdict::Clear,
                rule: None,
            })]);
        }
        let payee = self.wallet.settlement_payee(deal)?;
        if let Some(block) = kept.filter(|k| k.verdict == ShieldVerdict::Block) {
            return Ok(vec![block]);
        }
        let found = table_shield::explain(
            &table_shield::Case {
                expected_payee: &payee,
                actual_payee: &payee,
                friends_and_family: false,
                amount: deal.terms.amount()?,
                unit_price: deal.terms.unit_price,
                // The 40% rule runs on any reference; only a fresh one can clear the deal.
                market: deal.market.as_ref(),
                market_fresh: market_fresh(deal.market.as_ref(), now),
                first_seen: self
                    .wallet
                    .ledger
                    .counterparty_first_seen(&deal.counterparty)?,
                new_counterparty_threshold: Money::new(10000, deal.terms.currency)
                    .map_err(DomainError::from)?,
            },
            now,
        )?;
        let mut sources: Vec<ShieldSource> = kept.into_iter().collect();
        sources.push(ShieldSource {
            verdict: found.verdict,
            rule: found.rule,
        });
        Ok(sources)
    }
    /// The verdict is the most cautious input (a kept verdict can only add caution, as
    /// `table_shield::combine`). Its rule is a kept one's before a computed one's, and one the
    /// owner has not released before one they have. The release counts only when it names the
    /// rule of every input that holds.
    pub(super) fn judge(deal: &Deal, sources: &[ShieldSource]) -> ShieldGate {
        let verdict = sources
            .iter()
            .map(|s| s.verdict)
            .max()
            .unwrap_or(ShieldVerdict::Clear);
        let covered = |s: &ShieldSource| {
            deal.shield_release
                .as_ref()
                .is_some_and(|r| r.covers(s.rule))
        };
        let top = || sources.iter().filter(|s| s.verdict == verdict);
        let released = verdict == ShieldVerdict::Hold && top().all(covered);
        let rule = top()
            .find(|s| !covered(s))
            .or_else(|| top().next())
            .and_then(|s| s.rule);
        ShieldGate {
            verdict,
            rule,
            released,
        }
    }
    /// What the shield says about `deal` at `now` and why, without recording it.
    pub fn shield_gate(&self, deal: &Deal, now: Timestamp) -> Result<ShieldGate, Error> {
        Ok(Self::judge(deal, &self.shield_sources(deal, now)?))
    }
    pub(crate) fn shield(&self, deal: &Deal, now: Timestamp) -> Result<ShieldVerdict, Error> {
        Ok(self.shield_gate(deal, now)?.gating())
    }
    /// The scam shield's gate on a real money step (shield slice 2): judges the step, records the
    /// verdict and its rule in the deal row (only when they changed), and on a refusal records it
    /// once per (deal, step, verdict) and refuses before any operation, countersign or PayPal call.
    pub(super) fn shield_step(
        &mut self,
        deal: &Deal,
        decision: &DecidedBy,
        step: MoneyStep,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        let gate = self.shield_gate(deal, now)?;
        self.wallet.ledger.record_shield(
            deal.id,
            gate.verdict,
            gate.rule,
            deal.terms.hash()?,
            now,
        )?;
        if shield_allows(gate.gating(), decision, step) {
            return Ok(());
        }
        self.wallet.ledger.record_shield_refusal(&ShieldRefusal {
            id: deal.id,
            step: step.name(),
            attempt,
            verdict: gate.gating(),
            rule: gate.rule,
            refused: decision,
            at: now,
        })?;
        self.shield_refused = Some(deal.id);
        Err(Error::Permission)
    }
    /// Read-only: the scam shield verdict the money steps would judge this deal by at `now`.
    pub fn shield_verdict(&self, id: DealId, now: Timestamp) -> Result<ShieldVerdict, Error> {
        self.shield(&self.wallet.ledger.get_deal(id)?, now)
    }
}
