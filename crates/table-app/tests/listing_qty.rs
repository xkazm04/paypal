#![allow(clippy::unwrap_used, clippy::expect_used)]
mod support;
use table_app::*;
use table_core::*;
use table_proto::*;

/// A LISTING signed by the counterparty, carrying `qty` exactly as given.
fn listing(buyer: &Wallet, deal: &Deal, seller: &AgentSigner, qty: Option<u32>) -> String {
    let mut nonce = [0; 16];
    getrandom::fill(&mut nonce).unwrap();
    let body = Body::Listing {
        item_ref: deal.terms.item_ref.clone(),
        ask: deal.terms.unit_price,
        qty,
        delivery: deal.terms.delivery.clone(),
    };
    seller
        .sign(&Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: deal.id,
            seq: 1,
            prev: deal.transcript_head,
            iss: seller.key_id().unwrap(),
            aud: key_id(&buyer.agent_public_key()).unwrap(),
            iat: 100,
            exp: 700,
            nonce,
            body,
        })
        .unwrap()
}

#[test]
fn a_listing_without_a_quantity_is_refused_and_a_matching_one_is_accepted() {
    let (mut buyer, deal, _, seller) = support::setup(Side::Buyer, DealKind::Haggle);
    let bare = listing(&buyer, &deal, &seller, None);
    assert!(matches!(
        buyer.receive_haggle(deal.id, &bare, Category::Parts, 100),
        Err(Error::Invalid)
    ));
    let wrong = listing(&buyer, &deal, &seller, Some(deal.terms.qty + 1));
    assert!(matches!(
        buyer.receive_haggle(deal.id, &wrong, Category::Parts, 100),
        Err(Error::Invalid)
    ));
    let good = listing(&buyer, &deal, &seller, Some(deal.terms.qty));
    buyer
        .receive_haggle(deal.id, &good, Category::Parts, 100)
        .unwrap();
}
