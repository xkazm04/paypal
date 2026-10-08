//! Deterministic hosted seller; payment authority stays in the durable Rust pipeline.
mod environment;
mod glass;
mod hosted;
mod routes;
pub use environment::*;
pub use glass::*;
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
            for offer in [500, 1000, 1999] {
                if let Decision::Counter(m) = p
                    .decide_on_schedule(money(offer), round)
                    .unwrap_or_else(|_| unreachable!())
                {
                    assert!(m.minor() >= 1000);
                }
            }
        }
        // The signed floor is public (scan C-14), so a floor bid does not close in round 1.
        assert_eq!(
            p.decide_on_schedule(money(1000), 1)
                .unwrap_or_else(|_| unreachable!()),
            Decision::Counter(money(1833))
        );
        assert_eq!(
            p.decide_on_schedule(money(1000), 6)
                .unwrap_or_else(|_| unreachable!()),
            Decision::Accept
        );
    }
}
