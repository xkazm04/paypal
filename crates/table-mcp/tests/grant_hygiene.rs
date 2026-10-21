#![allow(clippy::unwrap_used, clippy::expect_used)]
#[path = "../../table-app/tests/support/mod.rs"]
mod support;
use std::sync::Arc;
use table_app::*;
use table_core::*;
use table_mcp::*;

#[test]
fn grant_debug_hides_secrets_names_grant_and_still_works() {
    let (wallet, deal, _, _) = support::setup(Side::Buyer, DealKind::Haggle);
    let server = Server::new(Box::new(wallet), 8765, Arc::new(FixedClock(100))).unwrap();
    let grant = server
        .grant_pending(AgentScope {
            deal_id: deal.id,
            role: AgentRole::Negotiator,
            category: Category::Parts,
        })
        .unwrap();
    assert!(!grant.token.is_empty() && !grant.secret.is_empty());
    let shown = format!("{grant:?}");
    assert!(!shown.contains(&grant.token));
    assert!(!shown.contains(&grant.secret));
    assert!(shown.contains("Grant"));
    assert!(!shown.contains("McpGrant"));
    server.enable(&grant).unwrap();
    server.revoke(&grant);
    assert!(server.enable(&grant).is_err());
}
