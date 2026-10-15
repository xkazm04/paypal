//! The one relay inbox pass (`table_app::drain_inbox`) that both the wallet runtime and the HOUSE
//! run: duplicates apply without the caller's policy, a ledger fault leaves its message pending and
//! the pass continues, and rejected messages cost one audit row per deal and generation.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use table_app::*;
use table_core::*;
use table_ledger::*;

const GEN: &str = "0123456789abcdef0123456789abcdef";

fn staged(messages: &[&str]) -> (Wallet, Deal) {
    let (mut wallet, deal, _, _) = support::setup(Side::Seller, DealKind::Haggle);
    wallet
        .ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    let raws: Vec<String> = messages.iter().map(|m| (*m).to_owned()).collect();
    wallet
        .ledger
        .stage_relay_batch(deal.id, GEN, 0, &raws, 100)
        .unwrap();
    (wallet, deal)
}
fn wallet_of(w: &mut Wallet) -> &mut Wallet {
    w
}
/// Classifies by the real receive rule, except that the message `fault` meets a ledger fault.
fn receive_or_fault(
    fault: &'static str,
) -> impl FnMut(&mut Wallet, &InboxMessage) -> InboxOutcome<Error> {
    move |wallet, message| {
        if message.raw == fault {
            return InboxOutcome::of(Err(Error::Ledger(LedgerError::Integrity("test fault"))));
        }
        InboxOutcome::of(wallet.receive_relay(message.deal_id, &message.raw, Category::Parts, 100))
    }
}
fn statuses(wallet: &Wallet) -> Vec<(u64, String)> {
    let pending: Vec<u64> = wallet
        .ledger
        .pending_inbox()
        .unwrap()
        .into_iter()
        .map(|m| m.position)
        .collect();
    (1..=3)
        .map(|p| {
            (
                p,
                if pending.contains(&p) {
                    "pending".into()
                } else {
                    "finished".into()
                },
            )
        })
        .collect()
}
fn rejections(wallet: &Wallet, id: DealId) -> Vec<serde_json::Value> {
    let (rows, _) = wallet.ledger.audit_page(None, u16::MAX).unwrap();
    rows.into_iter()
        .filter(|r| r.action == "envelope.rejected" && r.deal_id == Some(id))
        .map(|r| r.detail)
        .collect()
}

#[test]
fn a_retry_leaves_its_message_pending_finishes_the_others_and_is_returned() {
    let (mut wallet, deal) = staged(&["a.b.c", "d.e.f", "g.h.i"]);
    let mut seen = Vec::new();
    let result = drain_inbox(&mut wallet, wallet_of, 100, |_, message| {
        seen.push(message.position);
        match message.position {
            2 => InboxOutcome::Retry(Error::Unavailable),
            _ => InboxOutcome::Reject,
        }
    });
    assert!(matches!(result, Err(Error::Unavailable)));
    assert_eq!(seen, [1, 2, 3]);
    assert_eq!(
        statuses(&wallet),
        [
            (1, "finished".into()),
            (2, "pending".into()),
            (3, "finished".into())
        ]
    );
    // Messages 1 and 3 share one row; message 2 has none.
    let rows = rejections(&wallet, deal.id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["count"], 2);
    let digests: Vec<H256> = ["a.b.c", "g.h.i"]
        .iter()
        .map(|m| H256::digest(m.as_bytes()))
        .collect();
    assert_eq!(rows[0]["raw_hashes"], serde_json::json!(digests));
}

#[test]
fn a_ledger_fault_continues_the_pass_and_still_writes_the_grouped_rejection() {
    // Coordinator case 6: the wallet's behaviour today (runtime relay.rs consume_inbox).
    let (mut wallet, deal) = staged(&["a.b.c", "d.e.f", "g.h.i"]);
    let result = drain_inbox(&mut wallet, wallet_of, 100, receive_or_fault("d.e.f"));
    assert!(matches!(
        result,
        Err(Error::Ledger(LedgerError::Integrity("test fault")))
    ));
    assert_eq!(
        statuses(&wallet),
        [
            (1, "finished".into()),
            (2, "pending".into()),
            (3, "finished".into())
        ]
    );
    let rows = rejections(&wallet, deal.id);
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["count"], 2);
}

#[test]
fn a_stored_envelope_applies_without_asking_the_caller() {
    let (mut wallet, deal, _, _) = support::setup(Side::Seller, DealKind::Haggle);
    // Our own LISTING, echoed back by the relay: an exact signed duplicate.
    let raw = wallet.list(deal.id, 100).unwrap();
    wallet
        .ledger
        .bind_relay(deal.id, H256::digest(b"mailbox"), 100)
        .unwrap();
    wallet
        .ledger
        .stage_relay_batch(deal.id, GEN, 0, &[raw], 100)
        .unwrap();
    let before = wallet.ledger.audit_count().unwrap();
    let result: Result<(), Error> = drain_inbox(&mut wallet, wallet_of, 100, |_, _| {
        panic!("a duplicate never reaches the caller's policy")
    });
    result.unwrap();
    assert!(wallet.ledger.pending_inbox().unwrap().is_empty());
    assert!(rejections(&wallet, deal.id).is_empty());
    assert_eq!(wallet.ledger.audit_count().unwrap(), before);
}

#[test]
fn junk_from_two_generations_is_one_row_each_and_an_empty_inbox_writes_nothing() {
    let (mut wallet, deal) = staged(&["a.b.c", "d.e.f"]);
    drain_inbox(&mut wallet, wallet_of, 100, receive_or_fault("-")).unwrap();
    let other = "fedcba9876543210fedcba9876543210";
    wallet
        .ledger
        .stage_relay_batch(deal.id, other, 0, &["x.y.z".to_owned()], 200)
        .unwrap();
    drain_inbox(&mut wallet, wallet_of, 200, receive_or_fault("-")).unwrap();
    let rows = rejections(&wallet, deal.id);
    let mut counts: Vec<u64> = rows.iter().map(|r| r["count"].as_u64().unwrap()).collect();
    counts.sort_unstable();
    assert_eq!(counts, [1, 2]);
    let before = wallet.ledger.audit_count().unwrap();
    drain_inbox(&mut wallet, wallet_of, 300, receive_or_fault("-")).unwrap();
    assert_eq!(wallet.ledger.audit_count().unwrap(), before);
}

#[test]
fn the_receive_rule_maps_ledger_faults_to_retry_and_everything_else_to_reject() {
    assert!(matches!(
        InboxOutcome::<Error>::of(Ok(())),
        InboxOutcome::Apply
    ));
    assert!(matches!(
        InboxOutcome::<Error>::of(Err(Error::Ledger(LedgerError::Integrity("x")))),
        InboxOutcome::Retry(_)
    ));
    assert!(matches!(
        InboxOutcome::<Error>::of(Err(Error::Ledger(LedgerError::Conflict))),
        InboxOutcome::Reject
    ));
    assert!(matches!(
        InboxOutcome::<Error>::of(Err(Error::Invalid)),
        InboxOutcome::Reject
    ));
}
