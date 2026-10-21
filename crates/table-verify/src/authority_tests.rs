//! One money-authority rule (challenge-2026-10-15, offline-proof-verifier A): the offline
//! verifier's "authority" check and the safety predicate's `unlawful` read every money step the
//! same way. The one difference is deliberate: a first-format (v1) file is not asked for the owner
//! decision row by the verifier, while the safety predicate asks for it on every file.
use crate::safety::{money_kind, unlawful};
use crate::verify_bundle;
use serde_json::{Value, json};
use table_core::{
    Category, Clause, CpRule, Currency, DealKind, DealState, DecidedBy, Delivery, H256, ItemRef,
    KeyId, Mode, Money, OpenMandate, PayeeRef, PaypalRefs, Role, Side, Terms,
};
use table_proto::{
    PROOF_FORMAT, PROOF_FORMAT_V1, ProofAuditHead, ProofAuditRow, ProofBundle, ProofCall,
    ProofCounterparty, ProofOperation,
};

const OPS: [&str; 7] = [
    "create",
    "authorize",
    "capture",
    "void",
    "invoice-create",
    "invoice-send",
    "refund",
];
const KINDS: [DealKind; 4] = [
    DealKind::Purchase,
    DealKind::Haggle,
    DealKind::ShopOrder,
    DealKind::Rescue,
];

fn money(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}

/// A deal slice with no rows yet: the amount is `minor`, the human-present threshold 15.00. The
/// mandate is one valid signed policy whatever the deal's side and kind: the authority rules read
/// only its hash and its clause 6.
fn bundle(side: Side, kind: DealKind, minor: i64) -> ProofBundle {
    let payload = table_core::MandatePayload {
        id: "00000000000000000000000002".parse().unwrap(),
        version: 1,
        agent_key: [7; 32],
        not_before: 0,
        expires: 1_000_000,
        clauses: vec![
            Clause::Roles {
                roles: vec![Role::Buy],
            },
            Clause::Counterparties {
                rule: CpRule::Paired,
            },
            Clause::PerDeal {
                kind: DealKind::Purchase,
                max_amount: money(2500),
                categories: vec![Category::Parts],
            },
            Clause::Velocity {
                max_deals_day: 10,
                max_total_day: money(100_000),
            },
            Clause::HumanPresentOver {
                amount: money(1500),
            },
            Clause::Payees {
                payees: vec![PayeeRef::new("merchant").unwrap()],
            },
        ],
    };
    let deal = table_core::Deal {
        id: "00000000000000000000000001".parse().unwrap(),
        created_at: 100,
        updated_at: 100,
        kind,
        side,
        counterparty: KeyId::new(H256::digest(b"peer").hex()).unwrap(),
        terms: Terms {
            item_ref: ItemRef::new("monitor").unwrap(),
            qty: 1,
            unit_price: money(minor),
            currency: Currency::USD,
            delivery: Delivery::DigitalNow,
        },
        state: DealState::Agreed,
        mandate_id: payload.id,
        mandate_version: 1,
        transcript_head: H256::ZERO,
        paypal: PaypalRefs::default(),
        mode: Mode::Sandbox,
        market: None,
        shield: None,
        decided_by: None,
        shield_rule: None,
        shield_release: None,
    };
    ProofBundle {
        format: PROOF_FORMAT.into(),
        exported_at: 1_000,
        deal,
        owner_key: [1; 32],
        mandate: OpenMandate {
            payload,
            owner_sig: Vec::new(),
        },
        counterparty: ProofCounterparty {
            agent_key: [2; 32],
            owner_key: [3; 32],
        },
        transcript: Vec::new(),
        closed_mandates: Vec::new(),
        operations: Vec::new(),
        paypal_calls: Vec::new(),
        receipts: Vec::new(),
        audit: Vec::new(),
        audit_head: ProofAuditHead {
            seq: 0,
            hash: H256::ZERO,
        },
        authority_manifest: Some(H256::ZERO),
        group: None,
        house: None,
        evidence_head: H256::ZERO,
        evidence_sig: Vec::new(),
    }
}

fn own_hash(b: &ProofBundle) -> H256 {
    b.mandate.payload.hash().unwrap()
}

/// Appends an audit row (the authority rules read only its action, detail and order).
fn row(b: &mut ProofBundle, action: &str, detail: Value) {
    let seq = i64::try_from(b.audit.len()).unwrap() + 1;
    b.audit.push(ProofAuditRow {
        seq,
        at: 150,
        actor: "wallet".into(),
        action: action.into(),
        detail_json: serde_json::to_string(&detail).unwrap(),
        prev_hash: H256::ZERO,
        hash: H256::ZERO,
    });
}
fn approved(b: &mut ProofBundle) {
    row(
        b,
        "deal.transition",
        json!({"from": "AUTHORIZE", "to": "APPROVED"}),
    );
}
fn decision(b: &mut ProofBundle, name: &str, by: &DecidedBy) {
    row(
        b,
        "owner.decision",
        json!({"decision": name, "decided_by": by, "checks_hash": H256::digest(b"checks")}),
    );
}
/// Reserves `operation` under `by` (its `money.authorized` row) and records the step.
fn step(b: &mut ProofBundle, operation: &str, by: &DecidedBy) -> ProofOperation {
    let request_id = format!("req-{operation}");
    row(
        b,
        "money.authorized",
        json!({"operation": operation, "request_id": request_id, "decided_by": by}),
    );
    let op = ProofOperation {
        attempt: 1,
        operation: operation.into(),
        decided_by: by.clone(),
        status: "SENT".into(),
        request_id: Some(request_id),
    };
    b.operations.push(op.clone());
    op
}
fn authority_line(b: &ProofBundle) -> crate::Check {
    verify_bundle(b)
        .checks
        .into_iter()
        .find(|c| c.id == "authority")
        .unwrap()
}

#[test]
fn a_clause_6_countersign_on_a_purchase_fails_the_authority_check() {
    let mut b = bundle(Side::Buyer, DealKind::Purchase, 1000);
    let op = step(&mut b, "create", &DecidedBy::Policy { clause: 6 });
    assert!(unlawful(&b, &op).is_some());
    let line = authority_line(&b);
    assert!(!line.ok, "{line:?}");
    assert!(line.detail.contains("Purchase"), "{line:?}");
}

#[test]
fn a_seller_mandate_capture_before_the_buyer_approved_fails_the_authority_check() {
    let mut b = bundle(Side::Seller, DealKind::Haggle, 1000);
    let hash = own_hash(&b);
    step(
        &mut b,
        "capture",
        &DecidedBy::SellerMandate { mandate_hash: hash },
    );
    let line = authority_line(&b);
    assert!(!line.ok, "{line:?}");
    assert!(
        line.detail
            .contains("before the buyer approved the order at PayPal"),
        "{line:?}"
    );
    // After the buyer approved, the same capture stands on the seller's mandate.
    let mut b = bundle(Side::Seller, DealKind::Haggle, 1000);
    approved(&mut b);
    step(
        &mut b,
        "capture",
        &DecidedBy::SellerMandate { mandate_hash: hash },
    );
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
}

#[test]
fn a_house_mandate_void_fails_the_authority_check() {
    let mut b = bundle(Side::Seller, DealKind::Haggle, 1000);
    approved(&mut b);
    let hash = own_hash(&b);
    step(
        &mut b,
        "void",
        &DecidedBy::HouseMandate { mandate_hash: hash },
    );
    assert!(!authority_line(&b).ok, "{:?}", authority_line(&b));
}

#[test]
fn a_clause_6_void_under_the_threshold_fails_the_authority_check() {
    let mut b = bundle(Side::Seller, DealKind::Haggle, 1000);
    step(&mut b, "void", &DecidedBy::Policy { clause: 6 });
    assert!(!authority_line(&b).ok, "{:?}", authority_line(&b));
}

#[test]
fn an_owner_void_needs_the_owner_decision_row_before_it() {
    let by = DecidedBy::Human { at: 150 };
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    step(&mut b, "void", &by);
    assert!(!authority_line(&b).ok, "{:?}", authority_line(&b));
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    decision(&mut b, "deal_void", &by);
    step(&mut b, "void", &by);
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
}

/// The v1 carve-out is the verifier's only: a first-format file is not asked for the owner
/// decision row, while the safety predicate still asks for it (coordinator revision).
#[test]
fn a_v1_owner_capture_with_no_decision_row_verifies_but_the_safety_predicate_still_names_it() {
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    b.format = PROOF_FORMAT_V1.into();
    b.authority_manifest = None;
    let op = step(&mut b, "capture", &DecidedBy::Human { at: 150 });
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
    let why = unlawful(&b, &op).expect("the safety predicate demands the owner decision row");
    assert!(why.contains("no owner decision"), "{why}");
    // A v1 file as the wallet wrote it (no request ids) reads the same way.
    for o in &mut b.operations {
        o.request_id = None;
    }
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
    assert!(unlawful(&b, &b.operations[0]).is_some());
}

#[test]
fn a_money_post_with_a_query_is_unclassified_by_both_readers() {
    let path = "/v2/payments/authorizations/A1/capture?x=1";
    assert_eq!(money_kind("POST", path), Some("unclassified"));
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    let by = DecidedBy::Human { at: 150 };
    decision(&mut b, "deal_capture", &by);
    step(&mut b, "capture", &by);
    b.paypal_calls.push(ProofCall {
        method: "POST".into(),
        path: path.into(),
        status: Some(201),
        body: Value::Null,
        binding: None,
        at: 150,
        request_id: Some("req-capture".into()),
    });
    let line = authority_line(&b);
    assert!(!line.ok, "{line:?}");
    assert!(line.detail.contains("no known operation"), "{line:?}");
}

/// The wallet sends PayPal only GET and POST (the ledger stores no other method), so a stored call
/// under any other method was not the wallet's: a PATCH can rewrite an order's amount before it
/// is authorized. It is no read in either reader.
#[test]
fn a_call_under_any_method_but_get_or_post_is_unclassified_in_both_readers() {
    assert_eq!(money_kind("GET", "/v2/checkout/orders/O1"), None);
    for (method, path) in [
        ("PATCH", "/v2/checkout/orders/O1"),
        ("PUT", "/v2/checkout/orders/O1"),
        ("DELETE", "/v2/invoicing/invoices/INV2-ABCD"),
        ("post", "/v2/payments/authorizations/A1/capture"),
        ("get", "/v2/checkout/orders/O1"),
    ] {
        assert_eq!(money_kind(method, path), Some("unclassified"), "{method}");
    }
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    b.paypal_calls.push(ProofCall {
        method: "PATCH".into(),
        ..capture_call(None)
    });
    b.paypal_calls[0].path = "/v2/checkout/orders/O1".into();
    let line = authority_line(&b);
    assert!(!line.ok, "{line:?}");
    assert!(!crate::safety::deal_violations(&b, &[]).is_empty());
}

fn capture_call(request_id: Option<&str>) -> ProofCall {
    ProofCall {
        method: "POST".into(),
        path: "/v2/payments/authorizations/A1/capture".into(),
        status: Some(201),
        body: Value::Null,
        binding: None,
        at: 150,
        request_id: request_id.map(str::to_owned),
    }
}

/// A second capture at PayPal under a request id no operation was reserved under has no authority
/// of its own: the verifier names it exactly as the safety predicate does, instead of letting the
/// lawful capture beside it vouch for it by kind.
#[test]
fn a_money_call_under_a_request_id_no_operation_names_fails_in_both_readers() {
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    let by = DecidedBy::Human { at: 150 };
    decision(&mut b, "deal_capture", &by);
    step(&mut b, "capture", &by);
    b.paypal_calls.push(capture_call(Some("req-capture")));
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
    assert!(crate::safety::deal_violations(&b, &[]).is_empty());

    b.paypal_calls
        .push(capture_call(Some("req-second-capture")));
    let line = authority_line(&b);
    assert!(!line.ok, "{line:?}");
    assert!(
        line.detail.contains("has no recorded authority"),
        "{line:?}"
    );
    assert!(!crate::safety::deal_violations(&b, &[]).is_empty());

    // A first-format file stored no request id on its calls: matched by kind, in both readers.
    let mut b = bundle(Side::Buyer, DealKind::Haggle, 1000);
    decision(&mut b, "deal_capture", &by);
    step(&mut b, "capture", &by);
    b.paypal_calls.push(capture_call(None));
    assert!(authority_line(&b).ok, "{:?}", authority_line(&b));
    assert!(crate::safety::deal_violations(&b, &[]).is_empty());
}

/// Every operation x authority x side x kind x approved x owner decision: the verifier's verdict
/// on a v2 file is exactly the safety predicate's.
#[test]
fn the_verifier_and_the_safety_predicate_agree_on_every_step() {
    let mut checked = 0;
    for side in [Side::Buyer, Side::Seller] {
        for kind in KINDS {
            for minor in [1000, 2000] {
                let own = own_hash(&bundle(side, kind, minor));
                let other = H256::digest(b"another mandate");
                let authorities = [
                    DecidedBy::SafeDefault { deadline: 150 },
                    DecidedBy::Policy { clause: 6 },
                    DecidedBy::Policy { clause: 3 },
                    DecidedBy::Human { at: 150 },
                    DecidedBy::Human { at: 5_000 },
                    DecidedBy::SellerMandate { mandate_hash: own },
                    DecidedBy::SellerMandate {
                        mandate_hash: other,
                    },
                    DecidedBy::HouseMandate { mandate_hash: own },
                    DecidedBy::HouseMandate {
                        mandate_hash: other,
                    },
                ];
                for op in OPS {
                    for by in &authorities {
                        for was_approved in [false, true] {
                            for decided in [None, Some("fitting"), Some("deal_capture")] {
                                let mut b = bundle(side, kind, minor);
                                if was_approved {
                                    approved(&mut b);
                                }
                                if let Some(name) = decided {
                                    let name = if name == "fitting" { fitting(op) } else { name };
                                    decision(&mut b, name, by);
                                }
                                let step = step(&mut b, op, by);
                                let safety = unlawful(&b, &step);
                                let line = authority_line(&b);
                                assert_eq!(
                                    safety.is_none(),
                                    line.ok,
                                    "{side:?} {kind:?} {minor} {op} {by:?} approved={was_approved} decision={decided:?}: safety {safety:?}, verifier {line:?}"
                                );
                                checked += 1;
                            }
                        }
                    }
                }
            }
        }
    }
    assert_eq!(checked, 2 * 4 * 2 * 7 * 9 * 2 * 3);
}
fn fitting(op: &str) -> &'static str {
    match op {
        "create" | "authorize" => "deal_countersign",
        "capture" => "deal_capture",
        "void" => "deal_void",
        "invoice-create" | "invoice-send" => "rescue_approve",
        _ => "deal_countersign",
    }
}

#[test]
fn rescue_invoices_are_money_steps_and_the_search_is_a_read() {
    assert_eq!(
        money_kind("POST", "/v2/invoicing/invoices"),
        Some("invoice-create")
    );
    assert_eq!(
        money_kind("POST", "/v2/invoicing/invoices/INV2-ABCD/send"),
        Some("invoice-send")
    );
    assert_eq!(money_kind("POST", "/v2/invoicing/search-invoices"), None);
    assert_eq!(money_kind("GET", "/v2/invoicing/invoices/INV2-ABCD"), None);
    assert_eq!(
        money_kind("POST", "/v2/invoicing/invoices/INV2-ABCD/cancel"),
        Some("unclassified")
    );
    assert_eq!(money_kind("POST", "/v2/checkout/orders"), Some("create"));
    // A subscription capture is no step the wallet sends for a deal, in both readers.
    assert_eq!(
        money_kind("POST", "/v1/billing/subscriptions/I-1/capture"),
        Some("unclassified")
    );
}
