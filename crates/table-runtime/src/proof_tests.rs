//! Proof bundle v2: the evidence the wallet records since the first format (the owner's
//! checklist hash per decision, the read-back resolver's one request id, the permissions
//! fingerprint) is exported, verifies offline, and each forgery fails its own named check.
use super::*;

fn count(http: &OfflineHttp, end: &str) -> usize {
    http.0
        .lock()
        .unwrap()
        .paths
        .iter()
        .filter(|p| p.ends_with(end))
        .count()
}
fn rows(bundle: &table_proto::ProofBundle, action: &str) -> Vec<i64> {
    bundle
        .audit
        .iter()
        .filter(|r| r.action == action)
        .map(|r| r.seq)
        .collect()
}

/// An owner-countersigned seller order the owner then captures; the capture's answer is lost,
/// so the read-back resolver checks it again with PayPal under its one request id.
#[tokio::test]
async fn a_v2_proof_shows_the_checklist_behind_each_owner_decision_and_one_request_per_step() {
    let (mut r, vault, http, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
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
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Authorized
    );
    // Before any second look at PayPal, the request-id line has nothing to say.
    let early = assert_proof_verifies(&r, deal.id);
    let line = proof_line(&early, "one_request");
    assert!(
        !line.applies && line.detail.starts_with("not checked"),
        "{line:?}"
    );
    assert!(proof_line(&early, "owner_saw").ok);

    http.0.lock().unwrap().fail_capture = true;
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Capture),
        )
        .await
        .is_err()
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    http.0.lock().unwrap().fail_capture = false;
    clock.0.fetch_add(60, Ordering::SeqCst);
    r.tick().await.unwrap();
    clock.0.fetch_add(60, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert!(count(&http, "/capture") >= 1);

    let bundle = assert_proof_verifies(&r, deal.id);
    assert!(
        !rows(&bundle, "money.resolved").is_empty()
            || !rows(&bundle, "money.parked").is_empty()
            || !rows(&bundle, "money.resent").is_empty(),
        "the resolver looked again"
    );
    let saw = proof_line(&bundle, "owner_saw");
    assert!(
        saw.ok && saw.detail.starts_with("2 owner decision"),
        "{saw:?}"
    );
    let one = proof_line(&bundle, "one_request");
    assert!(one.ok && one.applies, "{one:?}");
    // Every capture call names the one request id its operation was reserved under.
    let capture = bundle
        .operations
        .iter()
        .find(|o| o.operation == "capture")
        .unwrap();
    assert!(
        bundle
            .paypal_calls
            .iter()
            .filter(|c| c.path.ends_with("/capture"))
            .all(|c| c.request_id == capture.request_id)
    );
    // No group, no shield hold and no house record: those lines read "not checked".
    for id in ["group", "shield", "house_record"] {
        let line = proof_line(&bundle, id);
        assert!(!line.ok && !line.checked && !line.applies, "{line:?}");
    }

    // The owner's checklist row for the capture is left out: the capture has no record that the
    // owner saw the checklist (the audit segment may skip other deals' rows, so only this fails).
    let capture_decision = bundle
        .audit
        .iter()
        .rfind(|r| r.action == "owner.decision")
        .unwrap()
        .seq;
    assert_forgery_fails(&r, &bundle, "owner_saw", |p| {
        p.audit.retain(|row| row.seq != capture_decision);
    });
    // The owner's capture claimed as a decision the owner never recorded.
    assert_forgery_fails(&r, &bundle, "owner_saw", |p| {
        let create = p
            .operations
            .iter_mut()
            .find(|o| o.operation == "create")
            .unwrap();
        create.decided_by = DecidedBy::Human { at: 1 };
    });
    // A capture call sent under a second request id.
    assert_forgery_fails(&r, &bundle, "one_request", |p| {
        let call = p
            .paypal_calls
            .iter_mut()
            .find(|c| c.path.ends_with("/capture"))
            .unwrap();
        call.request_id = Some("a-second-request-id".into());
    });
    // The capture operation recorded under an id its rows never name.
    assert_forgery_fails(&r, &bundle, "one_request", |p| {
        let op = p
            .operations
            .iter_mut()
            .find(|o| o.operation == "capture")
            .unwrap();
        op.request_id = Some("another-id".into());
    });
    // A v2 file must name the permissions it was saved under; a v1 file carries no v2 record.
    assert_forgery_fails(&r, &bundle, "format", |p| p.authority_manifest = None);
    assert_forgery_fails(&r, &bundle, "format", |p| {
        p.format = table_proto::PROOF_FORMAT_V1.into();
    });
    // Relabelling a signed v2 file as v1 (without re-signing) breaks the signed evidence head.
    let mut relabelled = as_v1(&r, &bundle);
    relabelled.format = table_proto::PROOF_FORMAT.into();
    assert!(!proof_line(&relabelled, "evidence").ok);
    // A file from a build with other permissions still verifies, and reads "a different version".
    let mut other = bundle.clone();
    other.authority_manifest = Some(H256([5; 32]));
    r.sign_proof(&mut other).unwrap();
    let file = table_client::check_proof_file(&serde_json::to_vec(&other).unwrap()).unwrap();
    assert!(file.verified);
    assert_eq!(file.same_version, Some(false));
    assert_eq!(file.authority_manifest, Some(H256([5; 32]).hex()));
}
