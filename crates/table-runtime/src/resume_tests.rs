#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Resume reports the tables waiting on our agent (same predicate the wallet enforces: the
//! projection allows `send_offer` or `accept_offer`), soonest deadline first, and starts none of
//! them: each restart stays the owner's own `agent_start`.
use super::policy_tests::{attach, install, settled};
use super::*;

/// A seller deal (its own mandate, band deadline `band_deadline`) whose peer offered `price`.
fn offered_at(r: &mut Runtime, price: i64, band_deadline: i64) -> Deal {
    let mut terms = clauses(Side::Seller, DealKind::Haggle);
    for c in &mut terms {
        if let Clause::Band { deadline, .. } = c {
            *deadline = band_deadline;
        }
    }
    let (deal, peer) = setup_with(r, Side::Seller, Delivery::DigitalNow, terms);
    r.pipeline.wallet.list(deal.id, 100).unwrap();
    let current = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let raw = peer
        .sign(&Envelope {
            v: 1,
            typ: table_proto::MsgType::Offer,
            deal_id: deal.id,
            seq: 1,
            prev: current.transcript_head,
            iss: peer.key_id().unwrap(),
            aud: table_proto::key_id(&r.pipeline.wallet.agent_public_key()).unwrap(),
            iat: 100,
            exp: 690,
            nonce,
            body: Body::Offer {
                price: Money::new(price, Currency::USD).unwrap(),
                delivery: deal.terms.delivery.clone(),
            },
        })
        .unwrap();
    r.pipeline
        .wallet
        .receive_haggle(deal.id, &raw, Category::Parts, 100)
        .unwrap();
    let deal = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(deal.state, DealState::Negotiating);
    deal
}
/// The policy negotiator wired to a channel nobody reads: runs start and stay live, no actor.
fn detached(
    r: &mut Runtime,
) -> (
    super::policy_tests::Loopback,
    tokio::sync::mpsc::Sender<crate::actor::Message>,
) {
    let loopback = install(r);
    let (tx, rx) = tokio::sync::mpsc::channel(64);
    std::mem::forget(rx);
    r.actor_sender = Some(tx.downgrade());
    let server = table_mcp::Server::with_async(
        Arc::new(crate::engines::ActorBridge(tx.downgrade())),
        8771,
        Arc::new(FixedClock(100)),
    )
    .unwrap();
    r.mcp = Some((server, "http://127.0.0.1:8771/mcp".into()));
    (loopback, tx)
}
async fn resume(r: &mut Runtime) -> ResumeReport {
    let value = r
        .execute(caller("main", None), Action::Resume)
        .await
        .unwrap();
    serde_json::from_value(value).expect("resume_all_agents returns a ResumeReport")
}
fn waiting(deal: &Deal, deadline: i64) -> WaitingTable {
    WaitingTable {
        deal_id: deal.id,
        deadline,
    }
}

#[tokio::test]
async fn resume_lists_exactly_the_tables_whose_next_move_is_ours_soonest_deadline_first() {
    let (mut r, _, _, clock, _) = runtime(true);
    let _wired = detached(&mut r);
    // A and A2: an unanswered offer each, so the move is ours (A2's band ends sooner).
    let a = offered_at(&mut r, 1100, 900_000);
    let a2 = offered_at(&mut r, 1100, 500_000);
    // B: our own listing is the last step, so the move is theirs.
    let (b, _) = setup(&mut r, Side::Seller);
    r.pipeline.wallet.list(b.id, 100).unwrap();
    // C: the owner chose "let it lapse".
    let c = offered_at(&mut r, 1100, 900_000);
    r.pipeline
        .wallet
        .ledger
        .set_preference(&format!("lapse.{}", c.id), &true)
        .unwrap();
    // D: withdrawn, terminal.
    let d = offered_at(&mut r, 1100, 900_000);
    r.execute(caller("main", None), Action::Withdraw(d.id))
        .await
        .unwrap();
    // E: our move, later given a live run.
    let e = offered_at(&mut r, 1100, 700_000);
    // F: our move, but its band deadline passes before the owner resumes.
    let f = offered_at(&mut r, 1100, 150);
    clock.0.store(200, Ordering::SeqCst);

    r.execute(caller("main", None), Action::Pause)
        .await
        .unwrap();
    assert_eq!(
        resume(&mut r).await,
        ResumeReport {
            waiting: vec![
                waiting(&a2, 500_000),
                waiting(&e, 700_000),
                waiting(&a, 900_000)
            ],
        }
    );
    assert!(!r.paused);
    let ids: Vec<DealId> = resume(&mut r)
        .await
        .waiting
        .iter()
        .map(|w| w.deal_id)
        .collect();
    for absent in [b.id, c.id, d.id, f.id] {
        assert!(!ids.contains(&absent));
    }
    // A table with a live run is not waiting on anyone.
    r.execute(caller("main", None), Action::Start(e.id))
        .await
        .unwrap();
    assert_eq!(r.runs.len(), 1);
    assert_eq!(
        resume(&mut r).await,
        ResumeReport {
            waiting: vec![waiting(&a2, 500_000), waiting(&a, 900_000)],
        }
    );
}

#[tokio::test]
async fn resume_starts_nothing_and_the_owners_restart_answers_the_offer_once() {
    let (mut r, _, _, _, _) = runtime(true);
    let (loopback, _tx) = detached(&mut r);
    let a = offered_at(&mut r, 1100, 900_000);
    // The policy run armed for A's offer is cut by Pause: it has claimed the offer's head.
    r.tick().await.unwrap();
    assert_eq!(r.runs.len(), 1);
    r.execute(caller("main", None), Action::Pause)
        .await
        .unwrap();
    assert!(r.runs.is_empty());
    assert_eq!(
        resume(&mut r).await,
        ResumeReport {
            waiting: vec![waiting(&a, 900_000)],
        }
    );
    // Silence never restarts it: three ticks later nothing runs.
    for _ in 0..3 {
        r.tick().await.unwrap();
    }
    assert!(r.runs.is_empty());
    // The owner's Restart is one agent_start; the run answers the offer once. The seller policy
    // accepts any offer at or above its signed floor (and the wallet refuses one below it), so
    // the answer to this in-band offer is one ACCEPT.
    let (actor, _events) = spawn(r);
    attach(&actor, &loopback, 8772).await;
    let run: RunSnapshot = actor
        .execute(caller("main", None), Action::Start(a.id))
        .await
        .unwrap();
    assert_eq!(run.deal_id, a.id);
    let ended = settled(&actor).await;
    assert_eq!(ended.iter().filter(|r| r.run == run.run).count(), 1);
    let steps: Vec<TranscriptStep> = actor
        .execute(caller("main", None), Action::Transcript(a.id))
        .await
        .unwrap();
    let ours: Vec<&TranscriptStep> = steps
        .iter()
        .filter(|s| s.by == TranscriptBy::You && s.typ != TranscriptType::Listing)
        .collect();
    assert_eq!(ours.len(), 1, "{steps:?}");
    assert_eq!(ours[0].typ, TranscriptType::Accept);
    // Our ACCEPT was the last word: the table now waits on them, not on us.
    let report: ResumeReport = actor
        .execute(caller("main", None), Action::Resume)
        .await
        .unwrap();
    assert_eq!(report, ResumeReport { waiting: vec![] });
}
