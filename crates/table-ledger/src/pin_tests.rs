//! Standard device-pairing/revocation-and-expiry: a pin passes while unrevoked and unexpired, is
//! refused with its own error once revoked or expired, and a ledger migrated from v15 keeps
//! every existing pin valid.
use super::*;
use crate::tests::setup;

fn inbound_at(
    ledger: &Ledger,
    deal: &Deal,
    own: &AgentSigner,
    peer: &AgentSigner,
    at: i64,
) -> Result<VerifiedEnvelope, LedgerError> {
    let raw = peer.sign(&super::inbound(deal, own, peer)).unwrap();
    ledger.preview_inbound(deal.id, &raw, at)
}
fn rows(ledger: &Ledger, action: &str) -> usize {
    let (all, _) = ledger.audit_page(None, 500).unwrap();
    all.iter().filter(|r| r.action == action).count()
}

#[test]
fn an_unrevoked_unexpired_pin_passes_and_reads_as_paired() {
    let (mut ledger, deal, _, own, peer) = setup();
    assert!(inbound_at(&ledger, &deal, &own, &peer, 100).is_ok());
    assert_eq!(
        ledger.pin_state(&deal.counterparty, 100).unwrap(),
        PinState::Live
    );
    // An expiry in the future still passes; clearing it passes too.
    ledger
        .set_counterparty_expiry(&deal.counterparty, Some(500), 100)
        .unwrap();
    assert!(inbound_at(&ledger, &deal, &own, &peer, 499).is_ok());
    assert!(
        ledger
            .counterparty_policy_at(&deal.counterparty, 499)
            .unwrap()
            .0
    );
    ledger
        .set_counterparty_expiry(&deal.counterparty, None, 100)
        .unwrap();
    assert!(inbound_at(&ledger, &deal, &own, &peer, 100).is_ok());
    assert_eq!(
        ledger.pin_state(&deal.counterparty, 10_000_000).unwrap(),
        PinState::Live
    );
}

#[test]
fn a_revoked_pin_is_refused_with_its_own_error_and_one_audit_row() {
    let (mut ledger, deal, _, own, peer) = setup();
    ledger.revoke_counterparty(&deal.counterparty, 150).unwrap();
    ledger.revoke_counterparty(&deal.counterparty, 160).unwrap();
    assert!(matches!(
        inbound_at(&ledger, &deal, &own, &peer, 200),
        Err(LedgerError::PinRevoked)
    ));
    assert!(
        !ledger
            .counterparty_policy_at(&deal.counterparty, 200)
            .unwrap()
            .0
    );
    assert_eq!(rows(&ledger, "counterparty.revoked"), 1);
    ledger.verify_audit().unwrap();
}

#[test]
fn an_expired_pin_is_refused_with_its_own_error_from_the_expiry_instant() {
    let (mut ledger, deal, _, own, peer) = setup();
    ledger
        .set_counterparty_expiry(&deal.counterparty, Some(200), 100)
        .unwrap();
    assert!(inbound_at(&ledger, &deal, &own, &peer, 199).is_ok());
    assert!(matches!(
        inbound_at(&ledger, &deal, &own, &peer, 200),
        Err(LedgerError::PinExpired)
    ));
    assert!(
        !ledger
            .counterparty_policy_at(&deal.counterparty, 200)
            .unwrap()
            .0
    );
    assert_eq!(rows(&ledger, "counterparty.expiry_set"), 1);
    ledger.verify_audit().unwrap();
}

#[test]
fn only_a_confirmed_pin_can_be_revoked() {
    let (mut ledger, _, _, _, _) = setup();
    let stranger = signer().key_id().unwrap();
    assert!(matches!(
        ledger.revoke_counterparty(&stranger, 100),
        Err(LedgerError::NotFound)
    ));
}

#[test]
fn a_v15_ledger_migrates_with_every_existing_pin_still_valid() {
    let dir = snapshot_dir("pin");
    let db = dir.join("wallet.sqlite");
    let peer = signer();
    {
        let mut file = Ledger::open(&db).unwrap();
        let cp = Counterparty {
            key_id: peer.key_id().unwrap(),
            owner_key: peer.public_key().to_bytes(),
            agent_key: peer.public_key().to_bytes(),
            display_name: ShortText::new("Dan".into()).unwrap(),
            paired_via: PairedVia::Code,
            words_confirmed_at: Some(100),
            declared_payee: PayeeRef::new("merchant").unwrap(),
            first_seen: 100,
        };
        file.insert_counterparty(&cp).unwrap();
    }
    // Step the file back to v15: the two columns do not exist there.
    let raw = rusqlite::Connection::open(&db).unwrap();
    raw.execute_batch(
        "ALTER TABLE counterparties DROP COLUMN revoked_at; ALTER TABLE counterparties DROP COLUMN expires_at; PRAGMA user_version=15;",
    )
    .unwrap();
    drop(raw);
    let ledger = Ledger::open(&db).unwrap();
    let key = peer.key_id().unwrap();
    assert_eq!(ledger.pin_state(&key, 1_000_000).unwrap(), PinState::Live);
    assert!(ledger.counterparty_policy_at(&key, 1_000_000).unwrap().0);
    let raw = rusqlite::Connection::open(&db).unwrap();
    assert_eq!(super::user_version(&raw), 16);
    drop(raw);
    drop(ledger);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn the_counterparty_list_reads_a_revoked_pin_as_unpaired_like_the_gate() {
    let (mut ledger, deal, ..) = setup();
    let pairing = |ledger: &Ledger| {
        ledger
            .counterparty_list()
            .unwrap()
            .into_iter()
            .find(|c| c.key_id == deal.counterparty)
            .unwrap()
            .pairing
    };
    assert_eq!(pairing(&ledger), CounterpartyPairing::WordsConfirmed);
    ledger.revoke_counterparty(&deal.counterparty, 150).unwrap();
    assert_eq!(pairing(&ledger), CounterpartyPairing::Unpaired);
}
