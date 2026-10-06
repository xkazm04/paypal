//! Deterministic checks are authoritative; model output can only add caution.
use table_core::{DomainError, MarketRef, Money, PayeeRef, ShieldVerdict, Timestamp};
#[derive(Debug)]
pub struct Case<'a> {
    pub expected_payee: &'a PayeeRef,
    pub actual_payee: &'a PayeeRef,
    pub friends_and_family: bool,
    pub amount: Money,
    pub unit_price: Money,
    pub market: Option<&'a MarketRef>,
    pub first_seen: Timestamp,
    pub new_counterparty_threshold: Money,
}
pub fn rules(case: &Case<'_>, now: Timestamp) -> Result<ShieldVerdict, DomainError> {
    if case.expected_payee != case.actual_payee || case.friends_and_family {
        return Ok(ShieldVerdict::Block);
    }
    let Some(market) = case.market else {
        return Ok(ShieldVerdict::Ask);
    };
    if market.over_forty_percent(case.unit_price)? {
        return Ok(ShieldVerdict::Hold);
    }
    case.amount.same_currency(case.new_counterparty_threshold)?;
    if now.saturating_sub(case.first_seen) < 86400
        && case.amount.minor() > case.new_counterparty_threshold.minor()
    {
        return Ok(ShieldVerdict::Ask);
    }
    Ok(ShieldVerdict::Clear)
}
pub fn combine(rules: ShieldVerdict, engine: Option<ShieldVerdict>) -> ShieldVerdict {
    rules.max(engine.unwrap_or(rules))
}
/// The callback receives only quarantine data supplied by the application, never a wallet grant.
pub fn evaluate(
    case: &Case<'_>,
    now: Timestamp,
    model: impl FnOnce() -> Option<ShieldVerdict>,
) -> Result<ShieldVerdict, DomainError> {
    let verdict = rules(case, now)?;
    if verdict == ShieldVerdict::Block {
        return Ok(verdict);
    }
    Ok(combine(verdict, model()))
}
#[cfg(test)]
mod tests {
    use super::*;
    use table_core::{Currency, H256};
    #[test]
    fn s1_payee_blocks_without_engine_and_no_reference_never_passes() {
        let m = |n| Money::new(n, Currency::USD).unwrap_or_else(|_| unreachable!());
        let a = PayeeRef::new("a").unwrap_or_else(|_| unreachable!());
        let b = PayeeRef::new("b").unwrap_or_else(|_| unreachable!());
        let mut case = Case {
            expected_payee: &a,
            actual_payee: &b,
            friends_and_family: false,
            amount: m(100),
            unit_price: m(100),
            market: None,
            first_seen: 0,
            new_counterparty_threshold: m(10000),
        };
        assert_eq!(
            evaluate(&case, 100, || panic!("model must not run"))
                .unwrap_or_else(|_| unreachable!()),
            ShieldVerdict::Block
        );
        case.actual_payee = &a;
        assert_eq!(
            rules(&case, 100).unwrap_or_else(|_| unreachable!()),
            ShieldVerdict::Ask
        );
        let market = MarketRef::from_comparables(vec![m(100)], 100, H256::ZERO)
            .unwrap_or_else(|_| unreachable!());
        case.market = Some(&market);
        case.unit_price = m(141);
        assert_eq!(
            rules(&case, 100).unwrap_or_else(|_| unreachable!()),
            ShieldVerdict::Hold
        );
    }
    #[test]
    fn s2_model_can_never_lower_caution() {
        for r in [
            ShieldVerdict::Clear,
            ShieldVerdict::Ask,
            ShieldVerdict::Hold,
            ShieldVerdict::Block,
        ] {
            for e in [
                ShieldVerdict::Clear,
                ShieldVerdict::Ask,
                ShieldVerdict::Hold,
                ShieldVerdict::Block,
            ] {
                assert!(combine(r, Some(e)) >= r);
            }
        }
    }
}
