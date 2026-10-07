//! Wallet-wide limits in the ledger (T14): append-only signed versions, fail-closed reads, and
//! the exposure fold reading the same agreement moments as the per-mandate velocity.
use super::*;

fn limits(version: u32, out: i64) -> WalletEnvelope {
    WalletEnvelope {
        version,
        currency: Currency::USD,
        max_out_day: Money::new(out, Currency::USD).unwrap(),
        max_held: Money::new(out, Currency::USD).unwrap(),
        max_deals_day: 3,
        expires: 100_000,
    }
}
fn signed(owner: &AgentSigner, payload: WalletEnvelope) -> SignedEnvelope {
    SignedEnvelope {
        owner_sig: owner.sign_wallet_envelope(&payload).unwrap(),
        payload,
    }
}

#[test]
fn signed_limits_are_versioned_append_only_audited_and_verified_on_read() {
    let (mut ledger, _, owner, ..) = setup();
    assert!(
        ledger
            .active_wallet_envelope(&owner.public_key())
            .unwrap()
            .is_none()
    );
    assert_eq!(ledger.next_envelope_version().unwrap(), 1);
    ledger
        .insert_wallet_envelope(&signed(&owner, limits(1, 15000)), &owner.public_key(), 120)
        .unwrap();
    // A skipped or repeated version is a conflict, and nothing is written.
    for version in [1, 3] {
        assert!(matches!(
            ledger.insert_wallet_envelope(
                &signed(&owner, limits(version, 9000)),
                &owner.public_key(),
                121
            ),
            Err(LedgerError::Conflict)
        ));
    }
    ledger
        .insert_wallet_envelope(&signed(&owner, limits(2, 9000)), &owner.public_key(), 130)
        .unwrap();
    let (active, at) = ledger
        .active_wallet_envelope(&owner.public_key())
        .unwrap()
        .unwrap();
    assert_eq!((active.payload.version, at), (2, 130));
    assert_eq!(active.payload.max_out_day.minor(), 9000);
    let rows: i64 = ledger
        .conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action='wallet_limit.signed'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(rows, 2);
    ledger.verify_audit().unwrap();
    for sql in [
        "UPDATE wallet_envelopes SET created_at='1' WHERE version=1",
        "DELETE FROM wallet_envelopes WHERE version=2",
    ] {
        assert!(ledger.conn.execute(sql, []).is_err(), "{sql}");
    }
}

#[test]
fn forged_or_tampered_limits_never_read_as_none() {
    let (mut ledger, _, owner, own, _) = setup();
    // Another key's signature is refused at insert.
    assert!(
        ledger
            .insert_wallet_envelope(&signed(&own, limits(1, 15000)), &owner.public_key(), 120)
            .is_err()
    );
    // A signature over the bare canonical payload, as mandates are signed (no domain tag), never
    // verifies as wallet limits.
    use ed25519_dalek::Signer;
    let key = SigningKey::from_bytes(&[7; 32]);
    let payload = limits(1, 15000);
    let bare = key.sign(&canonical_bytes(&payload).unwrap()).to_bytes();
    assert!(verify_wallet_envelope_signature(&payload, &bare, &key.verifying_key()).is_err());
    let tagged = key.sign(&payload.signing_bytes().unwrap()).to_bytes();
    assert!(verify_wallet_envelope_signature(&payload, &tagged, &key.verifying_key()).is_ok());
    // A row written behind the ledger's back by another key reads as an error.
    let forged = signed(&own, limits(1, 999_999));
    ledger
        .conn
        .execute(
            "INSERT INTO wallet_envelopes(version,body_json,body_hash,owner_sig,created_at) VALUES (1,?1,?2,?3,'120')",
            params![
                String::from_utf8(canonical_bytes(&forged.payload).unwrap()).unwrap(),
                &forged.payload.hash().unwrap().0[..],
                forged.owner_sig
            ],
        )
        .unwrap();
    assert!(ledger.active_wallet_envelope(&owner.public_key()).is_err());
    // A body that does not match its commitment is an integrity failure too.
    let (mut ledger, _, owner, ..) = setup();
    ledger
        .insert_wallet_envelope(&signed(&owner, limits(1, 15000)), &owner.public_key(), 120)
        .unwrap();
    ledger
        .conn
        .execute_batch("DROP TRIGGER wallet_envelopes_no_update")
        .unwrap();
    ledger
        .conn
        .execute(
            "UPDATE wallet_envelopes SET body_json=replace(body_json,'15000','99999')",
            [],
        )
        .unwrap();
    assert!(ledger.active_wallet_envelope(&owner.public_key()).is_err());
}

/// The fold reads the per-mandate velocity's own agreement moments: for a wallet with one
/// mandate, the day's window of every deal equals `usage_for` exactly.
#[test]
fn the_exposure_window_equals_the_velocity_window_under_one_mandate() {
    let (mut ledger, base, ..) = setup();
    let a = budget_deal(&mut ledger, &base, 1);
    let b = budget_deal(&mut ledger, &base, 2);
    let c = budget_deal(&mut ledger, &base, 3);
    let old = budget_deal(&mut ledger, &base, 4);
    let open = budget_deal(&mut ledger, &base, 5);
    agree(&mut ledger, &old, 86400 - 10);
    agree(&mut ledger, &b, 86400 + 150);
    agree(&mut ledger, &a, 86400 + 150);
    agree(&mut ledger, &c, 86400 + 160);
    let ghost = budget_deal(&mut ledger, &base, 6);
    ledger
        .conn
        .execute(
            "UPDATE deals SET state='AGREED' WHERE id=?1",
            [ghost.id.to_string()],
        )
        .unwrap();
    let deals = ledger.exposure_deals().unwrap();
    for now in [86400 - 5, 86400 + 200] {
        for deal in [&a, &b, &c, &old, &open, &ghost, &base] {
            let usage = ledger.usage_for(deal, now).unwrap();
            let window = exposure_for_deal(&deals, deal.id, Currency::USD, now).unwrap();
            assert_eq!(
                (window.deals_today, window.out_today),
                (usage.deals_today, usage.total_today),
                "{} at {now}",
                deal.id
            );
        }
    }
    // Withdrawn deals leave the fold; the open tables are listed but count nowhere.
    ledger
        .apply_event(c.id, DealEvent::Withdraw, 86400 + 170)
        .unwrap();
    let now = fold_exposure(&ledger.exposure_deals().unwrap(), 86400 + 200).unwrap();
    assert_eq!(now[0].deals_today, 2);
    assert_eq!(now[0].committed.minor(), 4 * 32900);
}
