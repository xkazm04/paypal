//! The quit confirm's forecast lines, read through the real runtime: what will not happen while
//! the wallet is off, what PayPal still does by itself, and the confirmation binding over both.
use super::*;
use table_attention::{QuitEffect, QuitLine};

async fn summary(r: &mut Runtime) -> QuitSummary {
    serde_json::from_value(
        r.execute(caller("main", None), Action::QuitSummary)
            .await
            .unwrap(),
    )
    .unwrap()
}
fn effects(lines: &[QuitLine], id: DealId) -> Vec<QuitEffect> {
    lines
        .iter()
        .filter(|l| l.deal_id == id)
        .map(|l| l.effect)
        .collect()
}
/// A seller order created at 100 on the mandate rule, awaiting the buyer at PayPal.
async fn seller_awaiting(r: &mut Runtime, vault: &MemoryVault, delivery: Delivery) -> Deal {
    credentials(vault);
    let (deal, peer) = setup_delivery(r, Side::Seller, delivery);
    agree(r, &deal, &peer);
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::AwaitingApproval
    );
    deal
}

#[tokio::test]
async fn quit_with_no_open_deals_has_nothing_pending() {
    let (mut r, _, _, _, _) = runtime(true);
    let s = summary(&mut r).await;
    assert!(s.pending.is_empty());
    assert_eq!(s.while_off, Some(Vec::new()));
    assert_eq!(s.at_paypal, Some(Vec::new()));
    assert!(s.on_quit.contains("close the window instead"));
}

#[tokio::test]
async fn quit_says_a_seller_order_awaiting_the_buyer_is_not_collected_while_off() {
    let (mut r, vault, _, _, _) = runtime(true);
    let deal = seller_awaiting(&mut r, &vault, Delivery::DigitalNow).await;
    let s = summary(&mut r).await;
    assert_eq!(s.pending, [deal.id]);
    let off = s.while_off.unwrap();
    assert_eq!(effects(&off, deal.id), [QuitEffect::NotCollectedIfApproved]);
    assert!(off[0].text.starts_with("If the buyer approves on PayPal"));
    assert!(
        off[0]
            .text
            .contains("not collected until you open The Table again")
    );
    assert_eq!(
        effects(&s.at_paypal.unwrap(), deal.id),
        [QuitEffect::RequestRunsOut]
    );
    // What was shown is what the confirm binds: it is accepted unchanged.
    r.execute(
        caller("main", None),
        Action::QuitConfirm(QuitArgs {
            confirmation_id: s.confirmation_id,
        }),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn quit_says_an_authorized_hold_releases_at_paypal_by_itself() {
    let (mut r, vault, _, _, _) = runtime(true);
    let deal = seller_awaiting(&mut r, &vault, Delivery::ShipThenCapture { days: 1 }).await;
    // The offline PayPal approves at the poll; the seller mandate authorizes, nothing captures.
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    let s = summary(&mut r).await;
    let paypal = s.at_paypal.unwrap();
    assert_eq!(effects(&paypal, deal.id), [QuitEffect::HoldRunsOut]);
    assert!(
        paypal[0]
            .text
            .contains("PayPal releases the hold by itself")
    );
    // Nothing to collect for a shipped order before delivery, so nothing is said to stop.
    assert!(effects(&s.while_off.unwrap(), deal.id).is_empty());
}

#[tokio::test]
async fn quit_confirm_refuses_when_the_shown_lines_changed_though_the_deals_did_not() {
    let (mut r, vault, _, _, _) = runtime(true);
    let deal = seller_awaiting(&mut r, &vault, Delivery::DigitalNow).await;
    let before = summary(&mut r).await;
    // "Let it lapse" is a preference, not a deal change: the seller mandate no longer collects
    // on approval, so the line that said it will not be collected while off is gone.
    r.pipeline
        .wallet
        .ledger
        .set_preference(&format!("lapse.{}", deal.id), &true)
        .unwrap();
    let after = summary(&mut r).await;
    assert_eq!(before.pending, after.pending);
    assert!(effects(&after.while_off.unwrap(), deal.id).is_empty());
    assert_ne!(before.confirmation_id, after.confirmation_id);
    assert!(
        r.execute(
            caller("main", None),
            Action::QuitConfirm(QuitArgs {
                confirmation_id: before.confirmation_id,
            }),
        )
        .await
        .is_err()
    );
}

#[tokio::test]
async fn quit_with_an_unreadable_forecast_promises_nothing_per_deal() {
    let (mut r, vault, _, _, _) = runtime(true);
    let deal = seller_awaiting(&mut r, &vault, Delivery::DigitalNow).await;
    r.fail_forecast = true;
    let s = summary(&mut r).await;
    assert_eq!(s.pending, [deal.id]);
    assert!(s.while_off.is_none() && s.at_paypal.is_none());
    r.execute(
        caller("main", None),
        Action::QuitConfirm(QuitArgs {
            confirmation_id: s.confirmation_id,
        }),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_held_deal_waits_in_the_quit_confirm_until_it_ends() {
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, _) = setup(&mut r, Side::Buyer);
    r.pipeline
        .wallet
        .ledger
        .raise_shield(deal.id, ShieldVerdict::Block, 100)
        .unwrap();
    let s = summary(&mut r).await;
    assert_eq!(s.pending, [deal.id]);
    assert_eq!(effects(&s.while_off.unwrap(), deal.id), [QuitEffect::Waits]);
    // Once the deal has ended, its verdict alone no longer makes it a pending decision.
    r.pipeline
        .wallet
        .ledger
        .apply_event(deal.id, DealEvent::Deadline, 100)
        .unwrap();
    let s = summary(&mut r).await;
    assert!(s.pending.is_empty());
    assert_eq!(s.while_off, Some(Vec::new()));
}
