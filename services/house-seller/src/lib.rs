//! Deterministic hosted seller; payment authority stays in the durable Rust pipeline.
mod environment;
mod hosted;
pub use environment::*;
pub use hosted::*;
pub use table_core::negotiation::{Decision, Policy};
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use table_core::Money;
    #[test]
    fn house_never_counters_below_signed_floor() {
        let money = |n| Money::new(n, table_core::Currency::USD).unwrap_or_else(|_| unreachable!());
        let p = Policy {
            floor: money(1000),
            ask: money(2000),
            max_rounds: 6,
        };
        for round in 1..=6 {
            if let Decision::Counter(m) = p
                .decide(money(500), round)
                .unwrap_or_else(|_| unreachable!())
            {
                assert!(m.minor() >= 1000);
            }
        }
        assert_eq!(
            p.decide(money(1000), 1).unwrap_or_else(|_| unreachable!()),
            Decision::Accept
        );
    }
}
