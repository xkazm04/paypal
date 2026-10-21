use crate::service::default_purchase_deadline;

#[test]
fn default_deadline_is_a_day_after_now() {
    assert_eq!(default_purchase_deadline(1_000), 1_000 + 24 * 3600);
}

#[test]
fn default_deadline_saturates_near_i64_max() {
    assert_eq!(default_purchase_deadline(i64::MAX), i64::MAX);
    assert_eq!(default_purchase_deadline(i64::MAX - 1), i64::MAX);
}
