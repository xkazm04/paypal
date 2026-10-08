//! Evidence of informed silence (attention-ladder-1) against a scripted clock: the rungs the
//! owner was offered are recorded once each, only for a card she could see, and the safe default
//! cites their chain by a hash anyone can recompute. A rung never delays or changes the default.
use super::*;
use std::collections::BTreeMap;
use table_attention::LADDER;
use table_core::{LadderRung as R, NotifySuppression};

const H: i64 = 3600;

fn rungs(r: &Runtime, id: DealId, deadline: i64) -> Vec<R> {
    r.pipeline
        .wallet
        .ledger
        .rungs(id, Some(deadline))
        .unwrap()
        .into_iter()
        .map(|row| row.mark.rung)
        .collect()
}
fn at(clock: &TestClock, now: i64) {
    clock.0.store(now, Ordering::SeqCst);
}
/// A seller deal at AGREED (a GATE: "Countersign") whose deadline is `deadline`.
fn gate(r: &mut Runtime, deadline: i64) -> Deal {
    let (deal, peer) = setup(r, Side::Seller);
    agree(r, &deal, &peer);
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, deadline, None, 100)
        .unwrap();
    deal
}
/// The audit detail of the row that applied the deal's safe default.
fn default_row(r: &Runtime, id: DealId) -> Value {
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
    rows.into_iter()
        .find(|row| {
            row.deal_id == Some(id)
                && matches!(row.action.as_str(), "deal.transition" | "money.authorized")
                && row.detail["decided_by"]["type"] == "safe_default"
        })
        .expect("a safe default row")
        .detail
}
/// The deal's last history step, as the deal page reads it.
async fn last_step(r: &mut Runtime, id: DealId) -> HistoryStep {
    let history: DealHistory = serde_json::from_value(
        r.execute(
            caller("main", None),
            Action::DealHistory(DealHistoryArgs {
                deal_id: Some(id),
                ..Default::default()
            }),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    history.steps.last().cloned().unwrap()
}
async fn tumbler(r: &mut Runtime, action: Action) -> Value {
    r.execute(caller("tumbler", None), action).await.unwrap()
}
/// The rows' own audit hashes, after the whole chain verified, folded as the default cites them.
fn recomputed(r: &Runtime, id: DealId, deadline: i64) -> H256 {
    r.pipeline.wallet.ledger.verify_audit().unwrap();
    let rows = r.pipeline.wallet.ledger.rungs(id, Some(deadline)).unwrap();
    table_ledger::rung_chain_hash(rows.iter().map(|row| &row.hash))
}

#[tokio::test]
async fn an_ignored_gate_is_shown_breathes_is_notified_and_its_lapse_cites_the_chain() {
    let (mut r, _, http, clock, _) = runtime(true);
    // Created three hours before its deadline, then left alone.
    let deadline = 100 + 3 * H;
    let deal = gate(&mut r, deadline);
    r.attention().unwrap();
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown]);
    // Every second's read is the same evidence: one row per rung.
    for _ in 0..3 {
        r.attention().unwrap();
    }
    at(&clock, deadline - LADDER.breathe_secs - 1);
    r.attention().unwrap();
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown]);
    at(&clock, deadline - LADDER.breathe_secs);
    r.attention().unwrap();
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown, R::Breathing]);
    // The shell claims the one notification, shows it and says so.
    at(&clock, deadline - 14 * 60);
    let shown = || Action::NotificationShown {
        deal_id: deal.id,
        deadline,
    };
    // Not claimed yet: a "shown" is refused.
    assert_eq!(tumbler(&mut r, shown()).await, json!(false));
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            Action::ClaimNotification {
                deal_id: deal.id,
                deadline
            }
        )
        .await
        .unwrap(),
        json!(true)
    );
    assert_eq!(tumbler(&mut r, shown()).await, json!(true));
    assert_eq!(tumbler(&mut r, shown()).await, json!(false));
    assert!(
        r.execute(
            caller("main", None),
            Action::NotificationShown {
                deal_id: deal.id,
                deadline
            }
        )
        .await
        .is_err()
    );
    assert_eq!(
        rungs(&r, deal.id, deadline),
        [R::Shown, R::Breathing, R::Notified]
    );
    // The deadline passes: the default runs, unchanged, and cites what she was shown.
    at(&clock, deadline);
    r.tick().await.unwrap();
    let state = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
    assert!(state.terminal(), "{state:?}");
    let detail = default_row(&r, deal.id);
    assert_eq!(detail["rung_deadline"], json!(deadline));
    assert_eq!(detail["rung_count"], json!(3));
    assert_eq!(detail["last_rung"], json!("notified"));
    assert_eq!(
        serde_json::from_value::<H256>(detail["rung_chain_hash"].clone()).unwrap(),
        recomputed(&r, deal.id, deadline)
    );
    // No rung after the deadline: the card it would describe is gone.
    r.attention().unwrap();
    assert_eq!(rungs(&r, deal.id, deadline).len(), 3);
    // The deal page reads the lapse with the rungs it cites, times included.
    let last = last_step(&mut r, deal.id).await;
    assert_eq!(last.authority, HistoryAuthority::SafeDefault);
    assert!(matches!(
        last.kind,
        HistoryKind::Lapsed | HistoryKind::Expired
    ));
    let marks = last.rungs.unwrap();
    assert_eq!(
        marks.iter().map(|m| (m.rung, m.at)).collect::<Vec<_>>(),
        [
            (R::Shown, 100),
            (R::Breathing, deadline - LADDER.breathe_secs),
            (R::Notified, deadline - 14 * 60)
        ]
    );
    // No money moved, and no PayPal call was made.
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn do_not_disturb_records_why_the_owner_was_not_notified() {
    let (mut r, _, _, clock, _) = runtime(true);
    let deadline = 100 + 3 * H;
    let deal = gate(&mut r, deadline);
    r.preferences.dnd = true;
    r.attention().unwrap();
    at(&clock, deadline - H);
    r.attention().unwrap();
    // Do Not Disturb stops the breathing too.
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown]);
    at(&clock, deadline - 10 * 60);
    r.attention().unwrap();
    // The shell's own report of the same suppression adds nothing.
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            Action::NotificationSuppressed {
                deal_id: deal.id,
                deadline,
                reason: NotifySuppression::SystemQuiet,
            }
        )
        .await
        .unwrap(),
        json!(false)
    );
    let rows = r.pipeline.wallet.ledger.rungs(deal.id, None).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| (row.mark.rung, row.mark.reason))
            .collect::<Vec<_>>(),
        [
            (R::Shown, None),
            (R::NotifySuppressed, Some(NotifySuppression::DoNotDisturb))
        ]
    );
    at(&clock, deadline);
    r.tick().await.unwrap();
    let detail = default_row(&r, deal.id);
    assert_eq!(detail["last_rung"], json!("notify_suppressed"));
    let last = last_step(&mut r, deal.id).await;
    let marks = last.rungs.unwrap();
    assert_eq!(
        marks.last().unwrap().reason,
        Some(NotifySuppression::DoNotDisturb)
    );

    // Notifications on, but the computer's quiet mode held the toast back: the shell says so.
    let (mut r, _, _, clock, _) = runtime(true);
    let deal = gate(&mut r, deadline);
    at(&clock, deadline - 10 * 60);
    let suppressed = |reason| Action::NotificationSuppressed {
        deal_id: deal.id,
        deadline,
        reason,
    };
    // Only for the card whose notification is due, and from the Tumbler only.
    assert!(
        r.execute(
            caller("main", None),
            suppressed(NotifySuppression::SystemQuiet)
        )
        .await
        .is_err()
    );
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            Action::NotificationSuppressed {
                deal_id: deal.id,
                deadline: deadline + 1,
                reason: NotifySuppression::SystemQuiet,
            }
        )
        .await
        .unwrap(),
        json!(false)
    );
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            suppressed(NotifySuppression::SystemQuiet)
        )
        .await
        .unwrap(),
        json!(true)
    );
    // A toast that failed to show after its claim says it was not shown.
    let (mut r, _, _, clock, _) = runtime(true);
    let deal = gate(&mut r, deadline);
    at(&clock, deadline - 10 * 60);
    for action in [
        Action::ClaimNotification {
            deal_id: deal.id,
            deadline,
        },
        Action::ReleaseNotification {
            deal_id: deal.id,
            deadline,
        },
    ] {
        r.execute(caller("tumbler", None), action).await.unwrap();
    }
    let rows = r.pipeline.wallet.ledger.rungs(deal.id, None).unwrap();
    assert_eq!(
        rows.last().map(|row| (row.mark.rung, row.mark.reason)),
        Some((R::NotifySuppressed, Some(NotifySuppression::NotShown)))
    );
}

#[tokio::test]
async fn a_snooze_is_recorded_hides_no_evidence_and_the_notification_rung_pierces_it() {
    let (mut r, _, _, clock, _) = runtime(true);
    let deadline = 100 + 3 * H;
    let deal = gate(&mut r, deadline);
    r.attention().unwrap();
    r.execute(caller("tumbler", None), Action::Snooze(deal.id))
        .await
        .unwrap();
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown, R::Snoozed]);
    // While snoozed the card is gone, so nothing more is recorded for it.
    at(&clock, 100 + LADDER.snooze_secs - 1);
    assert!(r.attention().unwrap().items.is_empty());
    assert_eq!(rungs(&r, deal.id, deadline).len(), 2);
    // The snooze ran out: the card is back, and breathes at its rung.
    at(&clock, deadline - LADDER.breathe_secs);
    assert_eq!(r.attention().unwrap().items.len(), 1);
    assert_eq!(
        rungs(&r, deal.id, deadline),
        [R::Shown, R::Snoozed, R::Breathing]
    );

    // A snooze can never hide the notification rung: the deadline moved closer while snoozed.
    let (mut r, _, _, clock, _) = runtime(true);
    let deal = gate(&mut r, deadline);
    r.attention().unwrap();
    r.execute(caller("tumbler", None), Action::Snooze(deal.id))
        .await
        .unwrap();
    let moved = 100 + 20 * 60;
    r.pipeline
        .wallet
        .ledger
        .set_deadline(deal.id, moved, None, 100)
        .unwrap();
    at(&clock, moved - LADDER.notify_secs - 1);
    assert!(r.attention().unwrap().items.is_empty(), "still snoozed");
    at(&clock, moved - LADDER.notify_secs);
    assert_eq!(r.attention().unwrap().items.len(), 1, "pierced");
    assert_eq!(
        r.execute(
            caller("tumbler", None),
            Action::ClaimNotification {
                deal_id: deal.id,
                deadline: moved
            }
        )
        .await
        .unwrap(),
        json!(true)
    );
    r.execute(
        caller("tumbler", None),
        Action::NotificationShown {
            deal_id: deal.id,
            deadline: moved,
        },
    )
    .await
    .unwrap();
    // The new deadline has its own chain; the old one keeps what was recorded under it.
    assert_eq!(
        rungs(&r, deal.id, moved),
        [R::Shown, R::Breathing, R::Notified]
    );
    assert_eq!(rungs(&r, deal.id, deadline), [R::Shown, R::Snoozed]);
    // Opening the review and the deal from the card are the owner's own acts.
    r.execute(
        caller("tumbler", None),
        Action::OpenApproval(ApprovalOpenArgs {
            deal_id: Some(deal.id),
            pairing: None,
            target: None,
            draft: None,
        }),
    )
    .await
    .unwrap();
    r.execute(caller("tumbler", None), Action::CardOpened(deal.id))
        .await
        .unwrap();
    assert!(
        r.execute(caller("main", None), Action::CardOpened(deal.id))
            .await
            .is_err()
    );
    assert_eq!(
        rungs(&r, deal.id, moved),
        [
            R::Shown,
            R::Breathing,
            R::Notified,
            R::ReviewOpened,
            R::CardOpened
        ]
    );
    at(&clock, moved);
    r.tick().await.unwrap();
    assert_eq!(default_row(&r, deal.id)["rung_count"], json!(5));
}

#[tokio::test]
async fn no_rung_row_is_ever_written_for_a_deal_not_in_a_snapshot() {
    let (mut r, _, _, clock, _) = runtime(true);
    // The walk-away forecast plays no part in which cards exist, and is slow to compute.
    r.fail_forecast = true;
    let base = 100 + 3 * H;
    // Gates with different deadlines, one the owner lets lapse, one with no deadline at all,
    // a listed (in motion) deal and a deal the shield holds.
    let deals: Vec<Deal> = (0..3).map(|i| gate(&mut r, base + i * 1500)).collect();
    let lapsing = gate(&mut r, base);
    r.execute(caller("tumbler", None), Action::LetLapse(lapsing.id))
        .await
        .unwrap();
    let (undated, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &undated, &peer);
    let (listed, _) = setup(&mut r, Side::Seller);
    r.pipeline.wallet.list(listed.id, 100).unwrap();
    r.pipeline
        .wallet
        .ledger
        .set_deadline(listed.id, base, None, 100)
        .unwrap();
    let mut all: Vec<DealId> = deals.iter().map(|d| d.id).collect();
    all.extend([lapsing.id, undated.id, listed.id, DealId(ulid::Ulid::new())]);
    let count = |r: &Runtime| -> BTreeMap<DealId, usize> {
        all.iter()
            .map(|id| {
                (
                    *id,
                    r.pipeline.wallet.ledger.rungs(*id, None).unwrap().len(),
                )
            })
            .collect()
    };
    let mut seed: u64 = 0x5eed;
    let mut next = |n: u64| {
        seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    let mut now = 100;
    for _ in 0..300 {
        now += i64::try_from(next(100)).unwrap();
        at(&clock, now);
        let before = count(&r);
        let visible: Vec<_> = r
            .attention()
            .unwrap()
            .items
            .into_iter()
            .map(|i| (i.deal_id, i.deadline))
            .collect();
        let id = all[usize::try_from(next(all.len() as u64)).unwrap()];
        let deadline = r
            .pipeline
            .wallet
            .ledger
            .deadline(id)
            .ok()
            .flatten()
            .map_or(base, |d| d.0);
        let action = match next(7) {
            0 => Action::ClaimNotification {
                deal_id: id,
                deadline,
            },
            1 => Action::NotificationShown {
                deal_id: id,
                deadline,
            },
            2 => Action::NotificationSuppressed {
                deal_id: id,
                deadline,
                reason: NotifySuppression::SystemQuiet,
            },
            3 => Action::ReleaseNotification {
                deal_id: id,
                deadline,
            },
            4 => Action::CardOpened(id),
            5 => Action::Snooze(id),
            _ => Action::OpenApproval(ApprovalOpenArgs {
                deal_id: Some(id),
                pairing: None,
                target: None,
                draft: None,
            }),
        };
        let _ = r.execute(caller("tumbler", None), action).await;
        for (deal, rows) in count(&r) {
            if rows > before[&deal] {
                assert!(
                    visible.iter().any(|(d, _)| *d == deal),
                    "rung written for {deal} not in the snapshot at {now}"
                );
            }
        }
    }
    // In motion, never a card. The deal let lapse was a card only until the owner chose that.
    assert!(
        r.pipeline
            .wallet
            .ledger
            .rungs(listed.id, None)
            .unwrap()
            .is_empty()
    );
    let lapsed = r.pipeline.wallet.ledger.rungs(lapsing.id, None).unwrap();
    assert!(lapsed.iter().all(|row| row.mark.at == 100), "{lapsed:?}");
    if r.pipeline
        .wallet
        .ledger
        .deadline(undated.id)
        .unwrap()
        .is_none()
    {
        assert!(
            r.pipeline
                .wallet
                .ledger
                .rungs(undated.id, None)
                .unwrap()
                .is_empty()
        );
    }
    // Every rung was written while its deadline was live.
    for id in &all {
        for row in r.pipeline.wallet.ledger.rungs(*id, None).unwrap() {
            assert!(row.mark.at < row.deadline, "{row:?}");
        }
    }
    assert!(
        !r.pipeline
            .wallet
            .ledger
            .rungs(deals[0].id, None)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_rung_that_cannot_be_written_never_delays_the_default() {
    // A GATE left alone lapses at its deadline, rungs or not.
    let (mut r, _, _, clock, _) = runtime(true);
    let deadline = 100 + 3 * H;
    let deal = gate(&mut r, deadline);
    r.fail_rungs = true;
    for now in [100, deadline - H, deadline - 600] {
        at(&clock, now);
        assert_eq!(r.attention().unwrap().items.len(), 1);
    }
    at(&clock, deadline);
    r.tick().await.unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .state
            .terminal()
    );
    let detail = default_row(&r, deal.id);
    assert_eq!(detail["rung_count"], json!(0));
    assert_eq!(detail["rung_chain_hash"], json!(H256::ZERO));

    // A hold left alone is voided at its deadline, with one void call, and no rung written.
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    let due = r
        .pipeline
        .wallet
        .ledger
        .deadline(deal.id)
        .unwrap()
        .unwrap()
        .0;
    r.fail_rungs = true;
    at(&clock, due - 600);
    r.attention().unwrap();
    at(&clock, due);
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::AutoVoided
    );
    let voids = http
        .0
        .lock()
        .unwrap()
        .paths
        .iter()
        .filter(|p| p.ends_with("/void"))
        .count();
    assert_eq!(voids, 1);
    assert!(
        r.pipeline
            .wallet
            .ledger
            .rungs(deal.id, None)
            .unwrap()
            .is_empty()
    );
    let detail = default_row(&r, deal.id);
    assert_eq!(detail["operation"], json!("void"));
    assert_eq!(detail["rung_count"], json!(0));
    assert_eq!(detail["last_rung"], Value::Null);
}
