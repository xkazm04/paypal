//! The owner's decision row carries the checklist the owner saw (the six lines, not only their
//! hash) and the step it starts, so a stranger's checker hashes the lines again offline, finds no
//! failed line behind a money step and matches the decision to the step that follows it.
use super::*;
use table_proto::ProofBundle;

/// An owner-countersigned seller order the owner then captures: two owner decisions, each before
/// its money step.
async fn captured() -> (Runtime, Deal) {
    decided(false).await
}
/// The same, with the owner key unreadable from the vault after unlock when `unreadable_owner`.
async fn decided(unreadable_owner: bool) -> (Runtime, Deal) {
    let (mut r, vault, _http, _clock, _) = runtime(true);
    credentials(vault.as_ref());
    let (deal, peer) = setup_delivery(&mut r, Side::Seller, Delivery::ShipThenCapture { days: 1 });
    agree(&mut r, &deal, &peer);
    let token = unlock_runtime(&mut r);
    let owner = vault.read("owner").unwrap().unwrap();
    if unreadable_owner {
        vault.write("owner", b"not a key").unwrap();
    }
    r.selected = Some(deal.id);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Countersign),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Capture),
    )
    .await
    .unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    // Exporting a proof needs the owner key again.
    vault.write("owner", &owner).unwrap();
    (r, deal)
}

fn decisions(bundle: &ProofBundle) -> Vec<usize> {
    bundle
        .audit
        .iter()
        .enumerate()
        .filter(|(_, r)| r.action == "owner.decision")
        .map(|(i, _)| i)
        .collect()
}
fn detail_of(bundle: &ProofBundle, at: usize) -> serde_json::Value {
    serde_json::from_str(&bundle.audit[at].detail_json).unwrap()
}

/// Rewrites one audit row's detail the way someone holding the database would: the row's hash is
/// computed again and every row chained after it follows, so the record itself still reads whole.
pub(crate) fn rewrite_row(
    bundle: &mut ProofBundle,
    at: usize,
    edit: impl FnOnce(&mut serde_json::Value),
) {
    let mut detail = detail_of(bundle, at);
    edit(&mut detail);
    let deal = bundle.deal.id;
    bundle.audit[at].detail_json = String::from_utf8(canonical_bytes(&detail).unwrap()).unwrap();
    let mut index = at;
    loop {
        let row = &bundle.audit[index];
        let detail: serde_json::Value = serde_json::from_str(&row.detail_json).unwrap();
        let preimage = serde_json::json!({
            "seq": row.seq, "at": row.at, "actor": row.actor, "action": row.action,
            "deal_id": deal, "detail_json": detail,
        });
        let hash = H256::chain(row.prev_hash, &canonical_bytes(&preimage).unwrap());
        bundle.audit[index].hash = hash;
        let seq = bundle.audit[index].seq;
        match bundle.audit.get_mut(index + 1) {
            Some(next) if next.seq == seq + 1 => {
                next.prev_hash = hash;
                index += 1;
            }
            _ => break,
        }
    }
    if let Some(last) = bundle.audit.last()
        && last.seq == bundle.audit_head.seq
    {
        bundle.audit_head.hash = last.hash;
    }
}

/// A row as the wallet wrote it before the owner key signed decisions: the forgeries below test the
/// checklist rules on their own, so the signature (which would catch them first) is left out.
fn unsigned(d: &mut serde_json::Value) {
    let o = d.as_object_mut().unwrap();
    o.remove("owner_key");
    o.remove("signature");
}

/// Every line of the report but `id` is what it was: the forgery is caught by `id` alone.
fn only_this_fails(r: &Runtime, bundle: &ProofBundle, id: &str) -> table_verify::Check {
    let mut forged = bundle.clone();
    r.sign_proof(&mut forged).unwrap();
    let report = table_verify::verify_bundle(&forged);
    let red: Vec<&str> = report
        .checks
        .iter()
        .filter(|c| c.applies && !c.ok)
        .map(|c| c.id)
        .collect();
    assert_eq!(red, vec![id], "{:#?}", report.checks);
    report.checks.into_iter().find(|c| c.id == id).unwrap()
}

#[tokio::test]
async fn the_owner_decision_row_carries_the_lines_and_the_step_and_they_hash_again() {
    let (r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    let rows = decisions(&bundle);
    assert_eq!(rows.len(), 2);
    let steps: Vec<String> = rows
        .iter()
        .map(|i| {
            detail_of(&bundle, *i)["operation"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect();
    assert_eq!(steps, ["create", "capture"]);
    for i in &rows {
        let d = detail_of(&bundle, *i);
        let checks: Vec<ApprovalCheck> = serde_json::from_value(d["checks"].clone()).unwrap();
        assert_eq!(checks.len(), 6);
        let hash: H256 = serde_json::from_value(d["checks_hash"].clone()).unwrap();
        assert_eq!(
            checks_hash(&checks).unwrap(),
            hash,
            "the lines hash to the recorded hash"
        );
    }
    let saw = proof_line(&bundle, "owner_saw");
    assert!(saw.ok, "{saw:?}");
    assert_eq!(
        saw.detail,
        "2 owner decision(s), each recorded with the hash of the checklist the owner saw, before its money step; 2 checklist(s) hashed again from the lines in the file; 2 signed by the owner key after unlock"
    );
}

/// The verify step of the scope: a decision row whose `checks_hash` is any 32 bytes passed
/// `owner_saw` while the row carried only the hash; with the lines in the row it fails.
#[tokio::test]
async fn a_random_checks_hash_fails_once_the_lines_are_in_the_row() {
    let (r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    let capture = *decisions(&bundle).last().unwrap();
    let random = H256::digest(b"any thirty-two bytes");

    // As files were before: the row carries the hash only, so any hash reads as "the owner saw it".
    let mut before = bundle.clone();
    for i in decisions(&before) {
        rewrite_row(&mut before, i, |d| {
            unsigned(d);
            let o = d.as_object_mut().unwrap();
            o.remove("checks");
            o.remove("operation");
        });
    }
    rewrite_row(&mut before, capture, |d| {
        d["checks_hash"] = serde_json::to_value(random).unwrap();
    });
    r.sign_proof(&mut before).unwrap();
    let passed = proof_line(&before, "owner_saw");
    assert!(
        passed.ok,
        "a hash-only row is all the old check had: {passed:?}"
    );
    assert!(
        passed
            .detail
            .ends_with("2 hash only (the lines are not in this file)")
    );
    assert!(table_verify::verify_bundle(&before).verified());

    // Now: the lines are in the row and do not hash to a random hash.
    let mut after = bundle.clone();
    rewrite_row(&mut after, capture, |d| {
        unsigned(d);
        d["checks_hash"] = serde_json::to_value(random).unwrap();
    });
    let line = only_this_fails(&r, &after, "owner_saw");
    assert!(
        line.detail
            .starts_with("the checklist recorded with the owner's decision (record #")
            && line
                .detail
                .ends_with("does not hash to the hash recorded with it"),
        "{line:?}"
    );
}

#[tokio::test]
async fn a_flipped_line_a_failed_line_and_another_step_each_fail() {
    let (r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    let [create, capture] = decisions(&bundle)[..] else {
        panic!("two decisions")
    };

    // One recorded line changed after the fact: it no longer hashes to what the owner saw.
    let mut flipped = bundle.clone();
    rewrite_row(&mut flipped, create, |d| {
        let line = d["checks"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|l| l["status"] != "pass")
            .unwrap();
        line["status"] = "pass".into();
    });
    let line = only_this_fails(&r, &flipped, "owner_saw");
    assert!(line.detail.contains("does not hash"), "{line:?}");

    // A failed line, its hash made again to match: the owner never approves on a failed line.
    let mut failed = bundle.clone();
    rewrite_row(&mut failed, capture, |d| {
        unsigned(d);
        d["checks"][0]["status"] = "fail".into();
        let checks: Vec<ApprovalCheck> = serde_json::from_value(d["checks"].clone()).unwrap();
        d["checks_hash"] = serde_json::to_value(checks_hash(&checks).unwrap()).unwrap();
    });
    let line = only_this_fails(&r, &failed, "owner_saw");
    assert!(
        line.detail
            .ends_with("was decided on a checklist with a failed line"),
        "{line:?}"
    );

    // The capture's decision said it started another step.
    let mut moved = bundle.clone();
    rewrite_row(&mut moved, capture, |d| {
        unsigned(d);
        d["operation"] = "authorize".into();
    });
    let line = only_this_fails(&r, &moved, "owner_saw");
    assert!(
        line.detail
            .ends_with("names the authorize step, not the capture step that follows it"),
        "{line:?}"
    );
}

/// A line that names an email-shaped address is kept as "[redacted]" by the audit door, so the
/// lines cannot be hashed again: that decision reads "not checked", never red.
#[tokio::test]
async fn a_line_the_record_does_not_keep_reads_not_checked_never_red() {
    let (mut r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    let capture = *decisions(&bundle).last().unwrap();
    let mut unkept = bundle.clone();
    rewrite_row(&mut unkept, capture, |d| {
        d["checks"][1]["detail"] = "[redacted]".into();
    });
    r.sign_proof(&mut unkept).unwrap();
    let report = table_verify::verify_bundle(&unkept);
    assert!(report.verified(), "{:#?}", report.checks);
    let line = proof_line(&unkept, "owner_saw");
    assert!(line.ok, "{line:?}");
    assert!(
        line.detail.ends_with(
            "1 checklist(s) hashed again from the lines in the file; 1 not checked: a line names an address the record does not keep; 2 signed by the owner key after unlock"
        ),
        "{line:?}"
    );
    // The audit door does replace an email-shaped payee in a decision row's lines.
    r.pipeline
        .wallet
        .ledger
        .append_audit(&table_ledger::AuditEntry {
            at: 500,
            actor: "owner".into(),
            action: "owner.decision".into(),
            deal_id: Some(deal.id),
            detail: serde_json::json!({
                "checks": [{"id": "payee", "status": "pass", "text": "Paid to your own payee from your rules.",
                    "detail": "order payee maya@example.com = the single payee"}],
            }),
        })
        .unwrap();
    let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, u16::MAX).unwrap();
    let kept = rows
        .iter()
        .find(|a| a.action == "owner.decision" && a.at == 500)
        .unwrap();
    assert_eq!(kept.detail["checks"][0]["detail"], "[redacted]");
}

/// The owner key signs each decision for the one step it starts; the signature verifies against the
/// owner key the file names, and the line says which key signed, never that a person was there.
#[tokio::test]
async fn the_owner_key_signs_each_decision_for_its_one_step() {
    let (r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    for i in decisions(&bundle) {
        let d = detail_of(&bundle, i);
        let owner_key: [u8; 32] = serde_json::from_value(d["owner_key"].clone()).unwrap();
        assert_eq!(owner_key, bundle.owner_key);
        let statement = table_proto::DecisionStatement {
            deal_id: deal.id,
            decision: d["decision"].as_str().unwrap().into(),
            operation: d["operation"].as_str().unwrap().into(),
            attempt: serde_json::from_value(d["attempt"].clone()).unwrap(),
            terms_hash: serde_json::from_value(d["terms_hash"].clone()).unwrap(),
            checks_hash: serde_json::from_value(d["checks_hash"].clone()).unwrap(),
            at: bundle.audit[i].at,
        };
        let signature: Vec<u8> = serde_json::from_value(d["signature"].clone()).unwrap();
        assert!(statement.verify(&bundle.owner_key, &signature));
    }
    let saw = proof_line(&bundle, "owner_saw");
    assert!(
        saw.ok
            && saw
                .detail
                .ends_with("; 2 signed by the owner key after unlock"),
        "{saw:?}"
    );
}

/// The scope's three forgeries, each made by someone holding the database and the agent's key
/// (the record chained again, the file sealed again): only `owner_saw` catches each, and says the
/// decision is not signed by the owner key.
#[tokio::test]
async fn a_forged_a_damaged_and_a_repointed_decision_are_not_signed_by_the_owner_key() {
    let (r, deal) = captured().await;
    let bundle = assert_proof_verifies(&r, deal.id);
    let [create, capture] = decisions(&bundle)[..] else {
        panic!("two decisions")
    };
    let not_signed = |line: &table_verify::Check| {
        assert!(
            line.detail.ends_with("is not signed by the owner key"),
            "{line:?}"
        );
    };

    // An owner decision the owner never made, added with the agent key's signature (the
    // practice deals' `forged decision` tamper, sample_proof.rs).
    let agent = r.slot_holding(bundle.mandate.payload.agent_key).unwrap();
    let mut document = serde_json::to_value(&bundle).unwrap();
    for edit in table_client::sample_proof::forged_decision(&bundle, &agent).unwrap() {
        let target = document
            .pointer_mut(edit.path.rsplit_once('/').unwrap().0)
            .unwrap();
        let key = edit.path.rsplit_once('/').unwrap().1;
        match target {
            serde_json::Value::Array(items) => items.push(edit.value.unwrap()),
            serde_json::Value::Object(map) => {
                map.insert(key.into(), edit.value.unwrap());
            }
            _ => panic!("cannot edit {}", edit.path),
        }
    }
    let forged: ProofBundle = serde_json::from_value(document).unwrap();
    let line = only_this_fails(&r, &forged, "owner_saw");
    not_signed(&line);

    // One byte of the capture decision's signature flipped.
    let mut flipped = bundle.clone();
    rewrite_row(&mut flipped, capture, |d| {
        let first = d["signature"][0].as_u64().unwrap();
        d["signature"][0] = (first ^ 1).into();
    });
    not_signed(&only_this_fails(&r, &flipped, "owner_saw"));

    // The create decision's signed statement re-pointed at the capture: its step now names the
    // capture, under the signature the owner key made for the create.
    let mut moved = bundle.clone();
    rewrite_row(&mut moved, create, |d| d["operation"] = "capture".into());
    not_signed(&only_this_fails(&r, &moved, "owner_saw"));
}

/// When the owner key cannot be read after unlock, the decision goes ahead exactly as before (the
/// gates did not change) and its row is written without a signature: the checker reads it "not
/// signed", never "signed".
#[tokio::test]
async fn an_unreadable_owner_key_leaves_the_row_unsigned_and_the_line_says_so() {
    let (r, deal) = decided(true).await;
    let bundle = assert_proof_verifies(&r, deal.id);
    for i in decisions(&bundle) {
        let d = detail_of(&bundle, i);
        assert!(
            d.get("signature").is_none() && d.get("owner_key").is_none(),
            "{d}"
        );
    }
    let saw = proof_line(&bundle, "owner_saw");
    assert!(
        saw.ok
            && saw
                .detail
                .ends_with("2 checklist(s) hashed again from the lines in the file; 2 not signed"),
        "{saw:?}"
    );
}
