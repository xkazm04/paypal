//! Offline verifier for a deal proof bundle. Pure: no network, no ledger, no wallet keys.
//!
//! Every check runs even when an earlier one fails, so the report shows everything that holds
//! and everything that does not. The bundle's own keys are the trust anchors; the report prints
//! the owner key id so a checker can compare it with the one the owner shows them.
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::Value;
use table_core::{
    Clause, DealId, DealKind, DecidedBy, H256, KeyId, Mode, Side, canonical_bytes, invoice_id,
};
use table_proto::{
    Body, MemoryNonces, PROOF_FORMAT, ProofBundle, VerifyContext, key_id, verify,
    verify_mandate_signature,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    pub name: &'static str,
    pub ok: bool,
    pub detail: String,
}
#[derive(Debug, Clone)]
pub struct Report {
    pub deal: DealId,
    pub mode: Mode,
    pub owner_key_id: String,
    pub checks: Vec<Check>,
}
impl Report {
    pub fn verified(&self) -> bool {
        self.checks.iter().all(|c| c.ok)
    }
}

type Outcome = Result<String, String>;
type CheckFn = fn(&ProofBundle) -> Outcome;

fn agent_key(bundle: &ProofBundle) -> Result<VerifyingKey, String> {
    VerifyingKey::from_bytes(&bundle.mandate.payload.agent_key)
        .map_err(|_| "agent key in the mandate is not a valid Ed25519 key".to_owned())
}
fn signed_by(key: &VerifyingKey, message: &[u8], signature: &[u8]) -> bool {
    Signature::from_slice(signature).is_ok_and(|sig| key.verify_strict(message, &sig).is_ok())
}

fn format(bundle: &ProofBundle) -> Outcome {
    if bundle.format == PROOF_FORMAT {
        Ok(PROOF_FORMAT.into())
    } else {
        Err(format!("unknown format {:?}", bundle.format))
    }
}

fn mandate(bundle: &ProofBundle) -> Outcome {
    let owner = VerifyingKey::from_bytes(&bundle.owner_key)
        .map_err(|_| "owner key is not a valid Ed25519 key".to_owned())?;
    let payload = &bundle.mandate.payload;
    if payload.id != bundle.deal.mandate_id || payload.version != bundle.deal.mandate_version {
        return Err("the mandate is not the one the deal names".into());
    }
    verify_mandate_signature(payload, &bundle.mandate.owner_sig, &owner)
        .map_err(|_| "owner signature over the mandate does not verify".to_owned())?;
    Ok(format!("mandate {} v{}", payload.id, payload.version))
}

fn transcript(bundle: &ProofBundle) -> Outcome {
    let deal = &bundle.deal;
    let own = agent_key(bundle)?;
    let peer = VerifyingKey::from_bytes(&bundle.counterparty.agent_key)
        .map_err(|_| "counterparty agent key is not a valid Ed25519 key".to_owned())?;
    let own_id = key_id(&own).map_err(|e| e.to_string())?;
    let peer_id = key_id(&peer).map_err(|e| e.to_string())?;
    if peer_id != deal.counterparty {
        return Err("counterparty key does not match the deal".into());
    }
    let mut previous = H256::ZERO;
    let (mut next_in, mut next_out) = (1_u32, 1_u32);
    let (mut inbound, mut outbound) = (0_u32, 0_u32);
    let mut nonces = MemoryNonces::default();
    // (seq, hash, received, counter) of the last proposal, as the ledger tracks it.
    let mut proposal: Option<(u32, H256, bool, bool)> = None;
    for (index, entry) in bundle.transcript.iter().enumerate() {
        let (sender, audience, next): (&VerifyingKey, &KeyId, &mut u32) = if entry.inbound {
            (&peer, &own_id, &mut next_in)
        } else {
            (&own, &peer_id, &mut next_out)
        };
        let verified = verify(
            &entry.raw,
            sender,
            &VerifyContext {
                deal_id: deal.id,
                audience,
                next_sender_seq: *next,
                previous,
                now: entry.received_at,
                nonces: &nonces,
            },
        )
        .map_err(|e| format!("message {}: {e}", index + 1))?;
        let envelope = verified.envelope();
        if let Body::Accept {
            owner_accept: Some(proof),
            ..
        } = &envelope.body
        {
            proof
                .verify()
                .map_err(|_| format!("message {}: owner accept signature", index + 1))?;
            let pinned = if entry.inbound {
                bundle.counterparty.owner_key
            } else {
                bundle.owner_key
            };
            if proof.owner_key != pinned
                || proposal != Some((proof.offer_seq, proof.counter_hash, !entry.inbound, true))
            {
                return Err(format!(
                    "message {}: owner accept is not bound to the pinned owner and last counter",
                    index + 1
                ));
            }
        }
        if matches!(envelope.body, Body::Offer { .. } | Body::Counter { .. }) {
            proposal = Some((
                envelope.seq,
                verified.hash(),
                entry.inbound,
                matches!(envelope.body, Body::Counter { .. }),
            ));
        }
        previous = verified.hash();
        nonces.record(envelope.iss.clone(), envelope.nonce);
        *next = next.checked_add(1).ok_or("sequence overflow")?;
        if entry.inbound {
            inbound += 1;
        } else {
            outbound += 1;
        }
    }
    if previous != deal.transcript_head {
        return Err("transcript does not end at the deal's transcript head".into());
    }
    Ok(format!(
        "agent signed {outbound} outbound, peer signed {inbound} inbound; head {}",
        short(previous)
    ))
}

fn closed(bundle: &ProofBundle) -> Outcome {
    let deal = &bundle.deal;
    if bundle.closed_mandates.is_empty() {
        return Ok("no countersign in this deal".into());
    }
    let own = agent_key(bundle)?;
    let open = bundle
        .mandate
        .payload
        .hash()
        .map_err(|_| "mandate payload does not validate".to_owned())?;
    let terms = deal.terms.hash().map_err(|e| e.to_string())?;
    let amount = deal.terms.amount().map_err(|e| e.to_string())?;
    // Clause 7 governs every countersign on either side: the wallet refuses a payee outside it.
    let payees = bundle.mandate.payload.clauses.iter().find_map(|c| match c {
        Clause::Payees { payees } => Some(payees),
        _ => None,
    });
    for record in &bundle.closed_mandates {
        let c = &record.mandate;
        let bytes = c.signing_bytes().map_err(|e| e.to_string())?;
        let expected_invoice = invoice_id(deal.id, record.attempt).map_err(|e| e.to_string())?;
        if c.deal_id != deal.id
            || c.open_mandate_hash != open
            || c.terms_hash != terms
            || c.amount != amount
            || c.invoice_id != expected_invoice
        {
            return Err(format!(
                "attempt {}: closed mandate does not bind this deal's mandate, terms and amount",
                record.attempt
            ));
        }
        if !signed_by(&own, &bytes, &c.agent_sig) {
            return Err(format!(
                "attempt {}: agent signature over the closed mandate does not verify",
                record.attempt
            ));
        }
        if payees.is_some_and(|list| !list.contains(&c.payee)) {
            return Err(format!(
                "attempt {}: countersigned payee is not in the owner-signed payee list",
                record.attempt
            ));
        }
        lawful(bundle, "create", &c.decided_by)
            .map_err(|e| format!("attempt {}: {e}", record.attempt))?;
    }
    let payee = if payees.is_some() {
        "payee is in the owner-signed payee list"
    } else {
        "payee signed by the agent; the mandate names no payee list"
    };
    Ok(format!(
        "{} countersign(s) bind terms {} and {}; {payee}",
        bundle.closed_mandates.len(),
        short(terms),
        amount
    ))
}

/// The three authorities AGENTS.md allows, judged from what the bundle can show.
fn lawful(bundle: &ProofBundle, operation: &str, decided_by: &DecidedBy) -> Result<String, String> {
    let deal = &bundle.deal;
    let payload = &bundle.mandate.payload;
    let open = || {
        payload
            .hash()
            .map_err(|_| "mandate payload does not validate".to_owned())
    };
    match decided_by {
        DecidedBy::SafeDefault { .. } if operation == "void" => Ok("safe default (void)".into()),
        DecidedBy::SafeDefault { .. } => Err(format!("a safe default cannot {operation}")),
        DecidedBy::Policy { clause: 6 } => {
            let amount = deal.terms.amount().map_err(|e| e.to_string())?;
            let under = payload.clauses.iter().any(|c| {
                matches!(c, Clause::HumanPresentOver { amount: limit }
                    if limit.currency() == amount.currency() && amount.minor() <= limit.minor())
            });
            if under {
                Ok("owner-signed rule: clause 6, under the human-present threshold".into())
            } else {
                Err("clause 6 policy used above the human-present threshold".into())
            }
        }
        DecidedBy::Policy { clause } => Err(format!("clause {clause} cannot authorise money")),
        DecidedBy::Human { at } => {
            if *at >= payload.not_before && *at <= bundle.exported_at {
                Ok("owner decision in the approval window (recorded by the wallet)".into())
            } else {
                Err("owner decision time is outside the mandate's validity".into())
            }
        }
        DecidedBy::SellerMandate { mandate_hash } => {
            if deal.side == Side::Seller && *mandate_hash == open()? {
                Ok("owner-signed seller mandate (buyer approved on PayPal)".into())
            } else {
                Err("seller-mandate authority does not match this seller's mandate".into())
            }
        }
        DecidedBy::HouseMandate { mandate_hash } => {
            if deal.side == Side::Seller
                && deal.kind == DealKind::Haggle
                && *mandate_hash == open()?
            {
                Ok("release-pinned house mandate (pin itself not in the bundle)".into())
            } else {
                Err("house authority does not match this deal's mandate".into())
            }
        }
    }
}

fn operation_of(method: &str, path: &str) -> Option<&'static str> {
    if method != "POST" {
        return None;
    }
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    match segments.as_slice() {
        ["v2", "checkout", "orders"] => Some("create"),
        ["v2", "checkout", "orders", _, "authorize"] => Some("authorize"),
        ["v2", "payments", "authorizations", _, "capture"] => Some("capture"),
        ["v2", "payments", "authorizations", _, "void"] => Some("void"),
        _ => Some("unclassified"),
    }
}

fn authority(bundle: &ProofBundle) -> Outcome {
    let mut verdicts = Vec::new();
    for op in &bundle.operations {
        let why = lawful(bundle, &op.operation, &op.decided_by)
            .map_err(|e| format!("{} (attempt {}): {e}", op.operation, op.attempt))?;
        verdicts.push(format!("{}: {why}", op.operation));
    }
    for call in &bundle.paypal_calls {
        let Some(kind) = operation_of(&call.method, &call.path) else {
            continue;
        };
        if kind == "unclassified" {
            return Err(format!(
                "money-shaped POST {} has no known operation",
                call.path
            ));
        }
        if !bundle.operations.iter().any(|op| op.operation == kind) {
            return Err(format!(
                "POST {} ({kind}) has no recorded authority",
                call.path
            ));
        }
    }
    if verdicts.is_empty() {
        Ok("no money operation in this deal".into())
    } else {
        Ok(verdicts.join("; "))
    }
}

/// The calls PayPal answers with an order, so the wallet projects a binding from every 2xx answer:
/// create, authorize and the order read.
fn answers_with_order(method: &str, path: &str) -> bool {
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();
    matches!(
        (method, segments.as_slice()),
        ("POST", ["v2", "checkout", "orders"])
            | ("POST", ["v2", "checkout", "orders", _, "authorize"])
            | ("GET", ["v2", "checkout", "orders", _])
    )
}

fn bindings(bundle: &ProofBundle) -> Outcome {
    let deal = &bundle.deal;
    let terms = deal.terms.hash().map_err(|e| e.to_string())?.hex();
    let amount = deal.terms.amount().map_err(|e| e.to_string())?;
    let mut checked = 0;
    for call in &bundle.paypal_calls {
        let Some(units) = call
            .binding
            .as_ref()
            .and_then(|b| b.get("purchase_units"))
            .and_then(Value::as_array)
            .filter(|units| !units.is_empty())
        else {
            // An order PayPal answered with no stored binding proves nothing. Bundles recorded
            // before the wallet stored bindings fail here too, by design.
            let answered = call.status.is_some_and(|s| (200..300).contains(&s));
            if !answered || !answers_with_order(&call.method, &call.path) {
                continue;
            }
            return Err(format!(
                "{} {}: PayPal answered with an order but no order binding was recorded (a wallet older than the binding record fails here)",
                call.method, call.path
            ));
        };
        for unit in units {
            let field = |name: &str| unit.get(name).and_then(Value::as_str);
            // Every order call PayPal answered with purchase units carries all four facts
            // (Order::verify rejects a body without them); a missing one is not "unchecked".
            let (Some(custom), Some(invoice), Some(payee)) = (
                field("custom_id"),
                field("invoice_id"),
                field("payee_merchant_id"),
            ) else {
                return Err(format!(
                    "{}: the order record lacks custom_id, invoice id or payee, so it proves nothing",
                    call.path
                ));
            };
            if custom != terms {
                return Err(format!(
                    "{}: custom_id is not this deal's terms hash",
                    call.path
                ));
            }
            if !bundle
                .closed_mandates
                .iter()
                .any(|c| c.mandate.invoice_id == invoice)
            {
                return Err(format!("{}: invoice id matches no countersign", call.path));
            }
            if !bundle
                .closed_mandates
                .iter()
                .any(|c| c.mandate.payee.as_str() == payee)
            {
                return Err(format!(
                    "{}: PayPal payee is not the countersigned payee",
                    call.path
                ));
            }
            let (Some(value), Some(currency)) = (
                unit.pointer("/amount/value").and_then(Value::as_str),
                unit.pointer("/amount/currency_code")
                    .and_then(Value::as_str),
            ) else {
                return Err(format!("{}: the order record lacks the amount", call.path));
            };
            if value != amount.decimal() || currency != amount.currency().to_string() {
                return Err(format!(
                    "{}: PayPal amount is not the signed amount",
                    call.path
                ));
            }
            checked += 1;
        }
    }
    if checked == 0 {
        Ok("no PayPal order in this deal, so no order binding to compare".into())
    } else {
        Ok(format!(
            "{checked} PayPal order record(s): custom_id = terms hash, invoice id, payee merchant id and amount compared and matching"
        ))
    }
}

fn audit(bundle: &ProofBundle) -> Outcome {
    let mut last: Option<(i64, H256)> = None;
    for row in &bundle.audit {
        let detail: Value = serde_json::from_str(&row.detail_json)
            .map_err(|_| format!("row {}: detail", row.seq))?;
        let canonical = canonical_bytes(&detail).map_err(|e| e.to_string())?;
        if canonical != row.detail_json.as_bytes() {
            return Err(format!("row {}: detail is not canonical", row.seq));
        }
        // The ledger's preimage: {seq, at, actor, action, deal_id, detail_json}, chained.
        let preimage = serde_json::json!({
            "seq": row.seq, "at": row.at, "actor": row.actor, "action": row.action,
            "deal_id": bundle.deal.id, "detail_json": detail,
        });
        let bytes = canonical_bytes(&preimage).map_err(|e| e.to_string())?;
        if H256::chain(row.prev_hash, &bytes) != row.hash {
            return Err(format!("row {}: hash does not match its contents", row.seq));
        }
        if let Some((seq, hash)) = last {
            if row.seq <= seq {
                return Err(format!("row {}: out of order", row.seq));
            }
            if row.seq == seq + 1 && row.prev_hash != hash {
                return Err(format!("row {}: not chained to row {seq}", row.seq));
            }
        }
        last = Some((row.seq, row.hash));
    }
    let head = &bundle.audit_head;
    if let Some((seq, hash)) = last
        && (seq > head.seq || (seq == head.seq && hash != head.hash))
    {
        return Err("audit rows run past the exported chain head".into());
    }
    Ok(format!(
        "{} deal rows hash-consistent; chain head #{} {}",
        bundle.audit.len(),
        head.seq,
        short(head.hash)
    ))
}

fn receipts(bundle: &ProofBundle) -> Outcome {
    for receipt in &bundle.receipts {
        if !bundle.transcript.iter().any(|e| e.raw == receipt.raw) {
            return Err("receipt is not part of the signed transcript".into());
        }
    }
    Ok(match bundle.receipts.len() {
        0 => "no receipt yet".into(),
        n => format!("{n} receipt(s) inside the signed transcript"),
    })
}

fn evidence(bundle: &ProofBundle) -> Outcome {
    let own = agent_key(bundle)?;
    let head = bundle.evidence_commitment().map_err(|e| e.to_string())?;
    if head != bundle.evidence_head {
        return Err("bundle contents differ from the signed evidence head".into());
    }
    if !signed_by(&own, &head.0, &bundle.evidence_sig) {
        return Err("evidence head is not signed by the deal's agent key".into());
    }
    Ok(format!(
        "evidence head {} signed by the deal's agent",
        short(head)
    ))
}

fn short(hash: H256) -> String {
    hash.hex().chars().take(12).collect()
}

pub fn verify_bundle(bundle: &ProofBundle) -> Report {
    let checks: [(&'static str, CheckFn); 9] = [
        ("format", format),
        ("owner signed the mandate", mandate),
        ("transcript signatures and chain", transcript),
        ("closed mandate binds terms and amount", closed),
        ("every money call has a lawful authority", authority),
        ("PayPal order matches the signed terms", bindings),
        ("audit rows hash-consistent", audit),
        ("receipt inside the transcript", receipts),
        ("evidence head signed", evidence),
    ];
    Report {
        deal: bundle.deal.id,
        mode: bundle.deal.mode,
        owner_key_id: VerifyingKey::from_bytes(&bundle.owner_key)
            .ok()
            .and_then(|k| key_id(&k).ok())
            .map_or_else(
                || "invalid".into(),
                |k| k.as_str().chars().take(16).collect(),
            ),
        checks: checks
            .into_iter()
            .map(|(name, check)| {
                let (ok, detail) = match check(bundle) {
                    Ok(detail) => (true, detail),
                    Err(detail) => (false, detail),
                };
                Check { name, ok, detail }
            })
            .collect(),
    }
}
