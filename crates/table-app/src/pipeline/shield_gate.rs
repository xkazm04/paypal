use table_core::{DecidedBy, ShieldRule, ShieldVerdict};
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
