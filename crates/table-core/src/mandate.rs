use crate::{
    DealKind, DomainError, H256, ItemRef, KeyId, MandateId, Money, PayeeRef, Side, Terms,
    Timestamp, commitment,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Buy,
    Sell,
    Shop,
    Rescue,
}
#[derive(ts_rs::TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Category {
    Office,
    Parts,
    Compute,
    Service,
    Other,
}
#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum CpRule {
    Pinned { keys: Vec<KeyId> },
    Paired,
    House,
}

#[derive(ts_rs::TS, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Clause {
    Roles {
        roles: Vec<Role>,
    },
    Counterparties {
        rule: CpRule,
    },
    PerDeal {
        kind: DealKind,
        max_amount: Money,
        categories: Vec<Category>,
    },
    Band {
        item_refs: Vec<ItemRef>,
        floor: Option<Money>,
        ceiling: Option<Money>,
        max_rounds: u8,
        deadline: Timestamp,
    },
    Velocity {
        max_deals_day: u16,
        max_total_day: Money,
    },
    HumanPresentOver {
        amount: Money,
    },
    Payees {
        payees: Vec<PayeeRef>,
    },
}
impl Clause {
    pub const fn number(&self) -> u8 {
        match self {
            Self::Roles { .. } => 1,
            Self::Counterparties { .. } => 2,
            Self::PerDeal { .. } => 3,
            Self::Band { .. } => 4,
            Self::Velocity { .. } => 5,
            Self::HumanPresentOver { .. } => 6,
            Self::Payees { .. } => 7,
        }
    }
}

/// The owner signs the canonical payload, excluding the signature itself.
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MandatePayload {
    pub id: MandateId,
    pub version: u32,
    pub agent_key: [u8; 32],
    pub clauses: Vec<Clause>,
    pub not_before: Timestamp,
    pub expires: Timestamp,
}
#[derive(ts_rs::TS, Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenMandate {
    pub payload: MandatePayload,
    pub owner_sig: Vec<u8>,
}

#[derive(ts_rs::TS, Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[error("mandate clause {clause}: {reason}")]
#[serde(deny_unknown_fields)]
pub struct Refusal {
    pub clause: u8,
    pub reason: String,
}
impl Refusal {
    fn new(clause: u8, reason: impl Into<String>) -> Self {
        Self {
            clause,
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Intent<'a> {
    pub kind: DealKind,
    pub side: Side,
    pub role: Role,
    pub category: Category,
    pub terms: &'a Terms,
    pub counterparty: &'a KeyId,
    pub paired: bool,
    pub house: bool,
    pub payee: &'a PayeeRef,
    pub rounds_used: u8,
}
#[derive(Debug, Clone, Copy)]
pub struct Usage {
    pub deals_today: u16,
    pub total_today: Money,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MandateDecision {
    Allow,
    Ask { clause: u8 },
}

impl MandatePayload {
    pub fn hash(&self) -> Result<H256, DomainError> {
        self.validate().map_err(|_| DomainError::InvalidTerms)?;
        Ok(commitment(self)?)
    }
    /// Reject ambiguous policies up front; every intent is denied by default.
    pub fn validate(&self) -> Result<(), Refusal> {
        if self.version == 0
            || self.expires <= self.not_before
            || self.not_before < 0
            || self.expires > crate::money::MAX_SAFE_INTEGER
        {
            return Err(Refusal::new(1, "invalid mandate version or validity"));
        }
        let mut seen = [false; 8];
        let mut clauses: Vec<_> = self.clauses.iter().collect();
        clauses.sort_by_key(|clause| clause.number());
        for clause in clauses {
            let index = usize::from(clause.number());
            if seen[index] {
                return Err(Refusal::new(clause.number(), "duplicate clause"));
            }
            seen[index] = true;
            match clause {
                Clause::Roles { roles } if roles.is_empty() => {
                    return Err(Refusal::new(1, "empty roles"));
                }
                Clause::Counterparties {
                    rule: CpRule::Pinned { keys },
                } if keys.is_empty() => return Err(Refusal::new(2, "empty pinned keys")),
                Clause::PerDeal { categories, .. } if categories.is_empty() => {
                    return Err(Refusal::new(3, "empty categories"));
                }
                Clause::Band {
                    item_refs,
                    floor,
                    ceiling,
                    max_rounds,
                    deadline,
                } => {
                    if item_refs.is_empty()
                        || *max_rounds == 0
                        || *deadline > self.expires
                        || *deadline <= self.not_before
                        || (floor.is_none() && ceiling.is_none())
                    {
                        return Err(Refusal::new(4, "invalid band"));
                    }
                    if let (Some(lo), Some(hi)) = (floor, ceiling)
                        && (lo.currency() != hi.currency() || lo.minor() > hi.minor())
                    {
                        return Err(Refusal::new(4, "invalid floor/ceiling"));
                    }
                }
                Clause::Velocity { max_deals_day, .. } if *max_deals_day == 0 => {
                    return Err(Refusal::new(5, "empty velocity allowance"));
                }
                Clause::Payees { payees } if payees.is_empty() => {
                    return Err(Refusal::new(7, "empty payee allowance"));
                }
                _ => {}
            }
        }
        for number in [1, 2, 3, 5, 6, 7] {
            if !seen[number] {
                return Err(Refusal::new(number as u8, "required clause missing"));
            }
        }
        // A policy check() could never allow is refused at signing, not discovered per intent.
        let mut currency = None;
        for clause in &self.clauses {
            let amounts = match clause {
                Clause::PerDeal { max_amount, .. } => vec![*max_amount],
                Clause::Band { floor, ceiling, .. } => {
                    floor.iter().chain(ceiling).copied().collect()
                }
                Clause::Velocity { max_total_day, .. } => vec![*max_total_day],
                Clause::HumanPresentOver { amount } => vec![*amount],
                _ => Vec::new(),
            };
            for amount in amounts {
                if *currency.get_or_insert(amount.currency()) != amount.currency() {
                    return Err(Refusal::new(
                        clause.number(),
                        "currency differs across clauses",
                    ));
                }
            }
        }
        let banded = self.clauses.iter().any(|c| {
            matches!(
                c,
                Clause::PerDeal {
                    kind: DealKind::Haggle | DealKind::ShopOrder,
                    ..
                }
            )
        });
        if banded && !seen[4] {
            return Err(Refusal::new(4, "band required for haggle and shop orders"));
        }
        Ok(())
    }

    pub fn check(
        &self,
        intent: &Intent<'_>,
        usage: Usage,
        now: Timestamp,
    ) -> Result<MandateDecision, Refusal> {
        self.validate()?;
        if now < self.not_before || now >= self.expires {
            return Err(Refusal::new(1, "mandate is not active"));
        }
        let amount = intent
            .terms
            .amount()
            .map_err(|_| Refusal::new(3, "invalid terms or amount"))?;
        // A caller cannot claim a different role to sidestep the owner's roles clause.
        let role_ok = matches!(
            (intent.role, intent.side, intent.kind),
            (
                Role::Buy,
                Side::Buyer,
                DealKind::Purchase | DealKind::Haggle | DealKind::Invoice
            ) | (
                Role::Sell,
                Side::Seller,
                DealKind::Haggle | DealKind::Invoice
            ) | (Role::Shop, Side::Seller, DealKind::ShopOrder)
                | (Role::Rescue, Side::Seller, DealKind::Rescue)
        );
        if !role_ok {
            return Err(Refusal::new(1, "role does not match the deal side/kind"));
        }
        let mut decision = MandateDecision::Allow;
        let mut clauses: Vec<_> = self.clauses.iter().collect();
        clauses.sort_by_key(|clause| clause.number());
        for clause in clauses {
            match clause {
                Clause::Roles { roles } if !roles.contains(&intent.role) => {
                    return Err(Refusal::new(1, "role not allowed"));
                }
                Clause::Counterparties { rule } => {
                    let allowed = match rule {
                        CpRule::Pinned { keys } => {
                            intent.paired && keys.contains(intent.counterparty)
                        }
                        CpRule::Paired => intent.paired,
                        CpRule::House => intent.paired && intent.house,
                    };
                    if !allowed {
                        return Err(Refusal::new(
                            2,
                            "counterparty is not pinned/paired as required",
                        ));
                    }
                }
                Clause::PerDeal {
                    kind,
                    max_amount,
                    categories,
                } => {
                    if *kind != intent.kind {
                        return Err(Refusal::new(3, "deal kind not allowed"));
                    }
                    if max_amount.currency() != amount.currency() {
                        return Err(Refusal::new(3, "currency not allowed"));
                    }
                    let over = amount.minor() > max_amount.minor();
                    let bad_category = !categories.contains(&intent.category);
                    if over || bad_category {
                        // F1's exact message is part of the public refusal contract.
                        let max = if max_amount.currency() == crate::Currency::USD
                            && max_amount.minor() % 100 == 0
                        {
                            format!("${}", max_amount.minor() / 100)
                        } else {
                            max_amount.to_string()
                        };
                        let reason = if bad_category {
                            format!(
                                "max_amount {max} per deal; category {} not allowed",
                                format!("{:?}", intent.category).to_lowercase()
                            )
                        } else {
                            format!(
                                "amount {} above max_amount {max} per deal",
                                amount.decimal()
                            )
                        };
                        return Err(Refusal::new(3, reason));
                    }
                }
                Clause::Band {
                    item_refs,
                    floor,
                    ceiling,
                    max_rounds,
                    deadline,
                } => {
                    if !item_refs.contains(&intent.terms.item_ref) {
                        return Err(Refusal::new(4, "item outside band"));
                    }
                    if now >= *deadline {
                        return Err(Refusal::new(4, "deadline reached"));
                    }
                    if intent.rounds_used >= *max_rounds {
                        return Err(Refusal::new(4, "max_rounds reached"));
                    }
                    // Band refers to the signed unit price, per-deal/velocity to the full total.
                    let price = intent.terms.unit_price;
                    let bound = match intent.side {
                        Side::Buyer => ceiling,
                        Side::Seller => floor,
                    };
                    let bound =
                        bound.ok_or_else(|| Refusal::new(4, "required side of band missing"))?;
                    if bound.currency() != price.currency() {
                        return Err(Refusal::new(4, "currency outside band"));
                    }
                    match intent.side {
                        Side::Buyer if price.minor() > bound.minor() => {
                            return Err(Refusal::new(
                                4,
                                format!(
                                    "price {} above ceiling {}",
                                    price.decimal(),
                                    bound.decimal()
                                ),
                            ));
                        }
                        Side::Seller if price.minor() < bound.minor() => {
                            return Err(Refusal::new(
                                4,
                                format!(
                                    "price {} below floor {}",
                                    price.decimal(),
                                    bound.decimal()
                                ),
                            ));
                        }
                        _ => {}
                    }
                }
                Clause::Velocity {
                    max_deals_day,
                    max_total_day,
                } => {
                    if usage.deals_today >= *max_deals_day {
                        return Err(Refusal::new(5, "max_deals_day reached"));
                    }
                    let total = usage
                        .total_today
                        .checked_add(amount)
                        .map_err(|_| Refusal::new(5, "invalid daily currency or total"))?;
                    if total.currency() != max_total_day.currency()
                        || total.minor() > max_total_day.minor()
                    {
                        return Err(Refusal::new(5, "max_total_day exceeded"));
                    }
                }
                Clause::HumanPresentOver { amount: threshold } => {
                    if threshold.currency() != amount.currency() {
                        return Err(Refusal::new(6, "threshold currency mismatch"));
                    }
                    if amount.minor() > threshold.minor() {
                        decision = MandateDecision::Ask { clause: 6 };
                    }
                }
                Clause::Payees { payees } if !payees.contains(intent.payee) => {
                    return Err(Refusal::new(7, "payee not allowed"));
                }
                _ => {}
            }
        }
        if matches!(intent.kind, DealKind::Haggle | DealKind::ShopOrder)
            && !self
                .clauses
                .iter()
                .any(|c| matches!(c, Clause::Band { .. }))
        {
            return Err(Refusal::new(4, "band missing"));
        }
        Ok(decision)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Currency, Delivery};
    fn money(minor: i64) -> Money {
        Money::new(minor, Currency::USD).unwrap()
    }
    fn policy(kind: DealKind, side: Side) -> MandatePayload {
        MandatePayload {
            id: MandateId(ulid::Ulid::from(1_u128)),
            version: 1,
            agent_key: [1; 32],
            not_before: 0,
            expires: 1000,
            clauses: vec![
                Clause::Roles {
                    roles: vec![if side == Side::Buyer {
                        Role::Buy
                    } else {
                        Role::Shop
                    }],
                },
                Clause::Counterparties {
                    rule: CpRule::Paired,
                },
                Clause::PerDeal {
                    kind,
                    max_amount: money(20000),
                    categories: vec![Category::Office, Category::Parts],
                },
                Clause::Band {
                    item_refs: vec![ItemRef::new("dock").unwrap()],
                    floor: Some(money(5800)),
                    ceiling: Some(money(10000)),
                    max_rounds: 6,
                    deadline: 900,
                },
                Clause::Velocity {
                    max_deals_day: 2,
                    max_total_day: money(20000),
                },
                Clause::HumanPresentOver {
                    amount: money(6400),
                },
                Clause::Payees {
                    payees: vec![PayeeRef::new("seller").unwrap()],
                },
            ],
        }
    }
    fn check(
        p: &MandatePayload,
        minor: i64,
        side: Side,
        category: Category,
        rounds: u8,
        now: i64,
    ) -> Result<MandateDecision, Refusal> {
        let t = Terms {
            item_ref: ItemRef::new("dock").unwrap(),
            qty: 1,
            unit_price: money(minor),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        };
        let cp = KeyId::new("peer").unwrap();
        let payee = PayeeRef::new("seller").unwrap();
        p.check(
            &Intent {
                kind: if side == Side::Buyer {
                    DealKind::Purchase
                } else {
                    DealKind::ShopOrder
                },
                side,
                role: if side == Side::Buyer {
                    Role::Buy
                } else {
                    Role::Shop
                },
                category,
                terms: &t,
                counterparty: &cp,
                paired: true,
                house: false,
                payee: &payee,
                rounds_used: rounds,
            },
            Usage {
                deals_today: 0,
                total_today: money(0),
            },
            now,
        )
    }
    #[test]
    fn f1_refusal_message_is_exact() {
        let p = policy(DealKind::Purchase, Side::Buyer);
        assert_eq!(
            check(&p, 4_000_000, Side::Buyer, Category::Compute, 0, 100)
                .unwrap_err()
                .to_string(),
            "mandate clause 3: max_amount $200 per deal; category compute not allowed"
        );
    }
    #[test]
    fn band_floor_and_ceiling_property_style() {
        let buyer = policy(DealKind::Purchase, Side::Buyer);
        let seller = policy(DealKind::ShopOrder, Side::Seller);
        for minor in (0..=20000).step_by(100) {
            assert_eq!(
                check(&buyer, minor, Side::Buyer, Category::Office, 0, 100).is_ok(),
                minor > 0 && minor <= 10000
            );
            assert_eq!(
                check(&seller, minor, Side::Seller, Category::Office, 0, 100).is_ok(),
                minor >= 5800
            );
        }
    }
    #[test]
    fn deadline_rounds_validity_and_human_boundary() {
        let p = policy(DealKind::Purchase, Side::Buyer);
        assert_eq!(
            check(&p, 6400, Side::Buyer, Category::Parts, 0, 100).unwrap(),
            MandateDecision::Allow
        );
        assert_eq!(
            check(&p, 6401, Side::Buyer, Category::Parts, 0, 100).unwrap(),
            MandateDecision::Ask { clause: 6 }
        );
        assert_eq!(
            check(&p, 6400, Side::Buyer, Category::Parts, 6, 100)
                .unwrap_err()
                .clause,
            4
        );
        assert_eq!(
            check(&p, 6400, Side::Buyer, Category::Parts, 0, 900)
                .unwrap_err()
                .clause,
            4
        );
        assert_eq!(
            check(&p, 6400, Side::Buyer, Category::Parts, 0, 1000)
                .unwrap_err()
                .clause,
            1
        );
    }
    #[test]
    fn missing_duplicate_or_conflicting_clauses_fail_closed() {
        let mut p = policy(DealKind::Purchase, Side::Buyer);
        p.clauses.clear();
        assert!(p.validate().is_err());
        let mut p = policy(DealKind::Purchase, Side::Buyer);
        p.clauses.push(p.clauses[0].clone());
        assert!(p.validate().is_err());
        let mut p = policy(DealKind::Purchase, Side::Buyer);
        p.expires = 0;
        assert!(p.validate().is_err());
    }
    #[test]
    fn mandates_that_could_never_allow_an_intent_are_refused_at_signing() {
        let eur = Money::new(6400, Currency::EUR).unwrap();
        for (number, replacement) in [
            (6, Clause::HumanPresentOver { amount: eur }),
            (
                5,
                Clause::Velocity {
                    max_deals_day: 2,
                    max_total_day: eur,
                },
            ),
        ] {
            let mut p = policy(DealKind::Purchase, Side::Buyer);
            for clause in &mut p.clauses {
                if clause.number() == number {
                    *clause = replacement.clone();
                }
            }
            let refusal = p.validate().unwrap_err();
            assert_eq!(refusal.reason, "currency differs across clauses");
        }
        for kind in [DealKind::Haggle, DealKind::ShopOrder] {
            let mut p = policy(kind, Side::Buyer);
            p.clauses.retain(|c| c.number() != 4);
            assert_eq!(p.validate().unwrap_err().clause, 4);
        }
        let mut p = policy(DealKind::Purchase, Side::Buyer);
        p.clauses.retain(|c| c.number() != 4);
        assert!(p.validate().is_ok());
    }
    #[test]
    fn pairing_payees_roles_velocity_currency_checks_are_independent() {
        let p = policy(DealKind::Purchase, Side::Buyer);
        let t = Terms {
            item_ref: ItemRef::new("dock").unwrap(),
            qty: 1,
            unit_price: money(6400),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        };
        let cp = KeyId::new("peer").unwrap();
        let payee = PayeeRef::new("seller").unwrap();
        let mut i = Intent {
            kind: DealKind::Purchase,
            side: Side::Buyer,
            role: Role::Buy,
            category: Category::Office,
            terms: &t,
            counterparty: &cp,
            paired: false,
            house: false,
            payee: &payee,
            rounds_used: 0,
        };
        let mut u = Usage {
            deals_today: 0,
            total_today: money(0),
        };
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 2);
        i.paired = true;
        let bad_payee = PayeeRef::new("stranger").unwrap();
        i.payee = &bad_payee;
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 7);
        i.payee = &payee;
        i.role = Role::Sell;
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 1);
        i.role = Role::Buy;
        u.deals_today = 2;
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 5);
        u.deals_today = 0;
        u.total_today = money(15000);
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 5);
        let mut foreign = t.clone();
        foreign.currency = Currency::EUR;
        foreign.unit_price = Money::new(6400, Currency::EUR).unwrap();
        i.terms = &foreign;
        assert_eq!(p.check(&i, u, 100).unwrap_err().clause, 3);
    }
    #[test]
    fn mandate_commitment_covers_version_and_band_but_not_signature() {
        let mut p = policy(DealKind::Purchase, Side::Buyer);
        let h = p.hash().unwrap();
        p.version = 2;
        assert_ne!(h, p.hash().unwrap());
    }
}
