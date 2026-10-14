//! Standard authorization-audit: every refused privileged command leaves one audit row (command,
//! window label, tier; never arguments or the token), the volume is bounded, and the row can
//! never change the refusal.
use super::*;

fn refusal_rows(r: &Runtime) -> Vec<table_ledger::AuditRecord> {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 500).unwrap();
    rows.into_iter()
        .filter(|row| row.action == "command.refused")
        .collect()
}
fn revoke() -> Action {
    Action::Revoke(MandateRevokeArgs {
        id: "01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap(),
    })
}
const SECRET_ARG: &str = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

#[tokio::test]
async fn a_refused_privileged_command_leaves_one_row_without_arguments_or_token() {
    let (mut r, ..) = runtime(true);
    let guess = "guessed-token-value";
    let refused = r
        .execute(caller("approval", Some(guess)), revoke())
        .await
        .unwrap_err();
    assert!(matches!(refused.code, ErrorCode::Permission));
    let rows = refusal_rows(&r);
    assert_eq!(rows.len(), 1);
    let detail = rows[0].detail.as_object().unwrap();
    let mut keys: Vec<_> = detail.keys().cloned().collect();
    keys.sort();
    assert_eq!(keys, ["command", "tier", "window"]);
    assert_eq!(detail["command"], "mandate_revoke");
    assert_eq!(detail["window"], "approval");
    assert_eq!(detail["tier"], "owner");
    let text = rows[0].detail.to_string();
    assert!(!text.contains(guess) && !text.contains(SECRET_ARG));
    let real = r.pipeline.approval.token("approval").unwrap().to_owned();
    assert!(!text.contains(&real));
}

#[tokio::test]
async fn wrong_window_and_idle_lock_refusals_are_recorded_and_stay_refusals() {
    let (mut r, ..) = runtime(true);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    let wrong_window = r
        .execute(caller("main", Some(&token)), revoke())
        .await
        .unwrap_err();
    assert!(matches!(wrong_window.code, ErrorCode::Permission));
    let locked = r
        .execute(caller("approval", Some(&token)), revoke())
        .await
        .unwrap_err();
    assert!(matches!(locked.code, ErrorCode::Locked));
    let windows: Vec<_> = refusal_rows(&r)
        .iter()
        .map(|row| row.detail["window"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(windows.len(), 2);
    assert!(windows.contains(&"main".to_owned()) && windows.contains(&"approval".to_owned()));
}

#[tokio::test]
async fn refusals_that_are_not_privileged_commands_write_nothing() {
    let (mut r, ..) = runtime(true);
    // deal_snooze is a tumbler-only act with no token: a wrong window is a refusal, not a probe
    // of a privileged command.
    let refused = r
        .execute(
            caller("main", None),
            Action::Snooze("01ARZ3NDEKTSV4RRFFQ69G5FAV".parse().unwrap()),
        )
        .await
        .unwrap_err();
    assert!(matches!(refused.code, ErrorCode::Permission));
    assert!(refusal_rows(&r).is_empty());
    // An admitted privileged call leaves no refusal row either.
    unlock_runtime(&mut r);
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    let _ = r.execute(caller("approval", Some(&token)), revoke()).await;
    assert!(refusal_rows(&r).is_empty());
}

#[tokio::test]
async fn a_probe_loop_is_bounded_and_the_overflow_is_counted() {
    let (mut r, ..) = runtime(true);
    for _ in 0..200 {
        let refused = r
            .execute(caller("approval", Some("probe")), revoke())
            .await
            .unwrap_err();
        assert!(matches!(refused.code, ErrorCode::Permission));
    }
    assert_eq!(refusal_rows(&r).len(), 60);
    assert_eq!(r.refusals.unrecorded, 140);
}
