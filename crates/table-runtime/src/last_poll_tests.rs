//! The poll-time map holds only deals the tick still walks as non-terminal, and the 10 s poll
//! spacing is untouched.
use super::*;

#[tokio::test]
async fn ended_deals_are_pruned_and_live_deals_keep_their_poll_time() {
    let (mut r, _, _, clock, _) = runtime(true);
    let (live, _) = setup(&mut r, Side::Seller);
    let (ended, _) = setup(&mut r, Side::Seller);
    r.last_poll.insert(live.id, 90);
    r.last_poll.insert(ended.id, 90);
    r.execute(caller("tumbler", None), Action::Withdraw(ended.id))
        .await
        .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(ended.id).unwrap().state,
        DealState::Withdrawn
    );
    clock.0.fetch_add(1, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert!(!r.last_poll.contains_key(&ended.id));
    assert_eq!(r.last_poll.get(&live.id), Some(&90));
}

#[tokio::test]
async fn polling_is_still_spaced_ten_seconds_apart() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    let reads = |http: &OfflineHttp| http.0.lock().unwrap().paths.len();
    let start = clock.0.load(Ordering::SeqCst);
    // A recent poll time holds the poll back; the entry survives the prune of the same tick.
    r.last_poll.insert(deal.id, start);
    let before = reads(&http);
    clock.0.store(start + 9, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(reads(&http), before);
    assert_eq!(r.last_poll.get(&deal.id), Some(&start));
    // Ten seconds on, the deal is polled and its poll time moves.
    clock.0.store(start + 10, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert!(reads(&http) > before);
    assert_eq!(r.last_poll.get(&deal.id), Some(&(start + 10)));
}
