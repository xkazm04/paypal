//! One deterministic sample deal, as a signed v2 proof file, for the checker that runs in a browser.
//!
//! The browser preview has no wallet and no keys, so it cannot export a proof of its own. This
//! module builds one real file instead: fixed seeds, fixed ids, fixed times, every signature and
//! hash made with the same types the wallet uses (`AgentSigner`, `canonical_bytes`,
//! `H256::chain`), and then checked by the same verifier the wallet and CI run
//! ([`check_proof_file`]). `cargo run -p table-client --bin sample-proof` writes the files the
//! client reads (`golden.tableproof` and `parity.json`); a test here fails when they drift.
//!
//! `parity.json` also holds tampered copies of the file, each as a few JSON edits and the report
//! this verifier gives for the edited file. The TypeScript checker must give the same report for
//! the same edits, and that is the parity test on the client side.
use crate::{ProofReport, check_proof_file};
use ed25519_dalek::SigningKey;
use serde::Serialize;
use serde_json::{Value, json};
use table_core::{
    Category, Clause, ClosedMandate, CpRule, Currency, Deal, DealId, DealKind, DealState,
    DecidedBy, Delivery, GroupId, H256, ItemRef, MandatePayload, MarketCertificate,
    MarketComparable, MarketMatch, MarketRef, Mode, Money, OpenMandate, PayeeRef, PaypalRefs, Role,
    ShieldRelease, ShieldRule, ShieldVerdict, Side, Terms, WatchedItem, canonical_bytes,
    invoice_id,
};
use table_proto::{
    AgentSigner, Body, Envelope, Intent, MsgType, PROOF_FORMAT, ProofAuditHead, ProofAuditRow,
    ProofBundle, ProofCall, ProofClosed, ProofCounterparty, ProofEnvelope, ProofGroup,
    ProofGroupTable, ProofOperation, ProofReceipt, ReceiptStatus, ShortText,
};

type Made<T> = Result<T, Box<dyn std::error::Error>>;

/// Where the client reads the sample from, relative to this crate.
pub const CLIENT_DIR: &str = "../../apps/desktop/client/src/lib/proof/sample";
/// The sample file's name.
pub const GOLDEN: &str = "golden.tableproof";
/// The busy deal's file: a group, a held and released safety check, market prices, a lost answer.
pub const BUSY: &str = "busy.tableproof";
/// The tampered copies and the verifier's reports on them.
pub const PARITY: &str = "parity.json";

const ITEM: &str = "monitor-24-ips";
const PAYEE: &str = "maya-monitors";
/// 2026-10-26 07:33:20 UTC: a Monday morning, so the sample deal sits in this week.
const T0: i64 = 1_793_000_000;

fn money(minor: i64) -> Made<Money> {
    Ok(Money::new(minor, Currency::USD)?)
}
/// A signer from a name: the seed is the hash of a fixed label, so the same file comes out
/// every run. These keys exist only in this sample and guard nothing.
fn signer(name: &str) -> AgentSigner {
    let seed = H256::digest(format!("the-table/sample-proof/{name}").as_bytes());
    AgentSigner::from_key(SigningKey::from_bytes(&seed.0))
}
fn nonce(i: usize) -> [u8; 16] {
    let digest = H256::digest(format!("the-table/sample-proof/nonce/{i}").as_bytes());
    let mut out = [0; 16];
    out.copy_from_slice(&digest.0[..16]);
    out
}
fn text<const N: usize>(value: &str) -> Made<ShortText<N>> {
    Ok(ShortText::new(value.to_owned())?)
}
fn hash_value(hash: H256) -> Made<Value> {
    Ok(serde_json::to_value(hash)?)
}

/// The audit log as the wallet's ledger keeps it: one chain across every deal, so this deal's rows
/// are a slice with gaps where other deals' rows sit. `other_deals` stands in for those rows.
struct Log {
    seq: i64,
    prev: H256,
    deal: DealId,
    rows: Vec<ProofAuditRow>,
}
impl Log {
    fn other_deals(&mut self, count: i64) {
        for _ in 0..count {
            self.seq += 1;
            self.prev = H256::chain(self.prev, format!("another-deal-{}", self.seq).as_bytes());
        }
    }
    /// A row of the chain that belongs to another deal (a table of the same group): it advances the
    /// chain and is returned, not kept.
    fn row_of(
        &mut self,
        deal: DealId,
        at: i64,
        actor: &str,
        action: &str,
        detail: &Value,
    ) -> Made<ProofAuditRow> {
        self.seq += 1;
        let detail_json = String::from_utf8(canonical_bytes(detail)?)?;
        let preimage = json!({
            "seq": self.seq, "at": at, "actor": actor, "action": action,
            "deal_id": deal, "detail_json": detail,
        });
        let hash = H256::chain(self.prev, &canonical_bytes(&preimage)?);
        let row = ProofAuditRow {
            seq: self.seq,
            at,
            actor: actor.to_owned(),
            action: action.to_owned(),
            detail_json,
            prev_hash: self.prev,
            hash,
        };
        self.prev = hash;
        Ok(row)
    }
    fn row(&mut self, at: i64, actor: &str, action: &str, detail: &Value) -> Made<()> {
        let row = self.row_of(self.deal, at, actor, action, detail)?;
        self.rows.push(row);
        Ok(())
    }
}

/// The money steps' PayPal answers, as the wallet redacts and stores them.
fn order_body(id: &str, invoice: &str, value: &str, status: &str, extra: Option<Value>) -> Value {
    let mut unit = json!({
        "amount": { "currency_code": "USD", "value": value },
        "invoice_id": invoice,
    });
    if let (Some(extra), Some(object)) = (extra, unit.as_object_mut()) {
        object.insert("payments".into(), extra);
    }
    json!({ "id": id, "intent": "AUTHORIZE", "purchase_units": [unit], "status": status })
}

/// The two agents' signed messages, each chained to the one before by its hash.
struct Wire<'a> {
    deal: DealId,
    agent: &'a AgentSigner,
    peer: &'a AgentSigner,
    seqs: (u32, u32),
    heads: Vec<H256>,
    transcript: Vec<ProofEnvelope>,
}
impl Wire<'_> {
    fn head(&self) -> H256 {
        self.heads.last().copied().unwrap_or(H256::ZERO)
    }
    fn send(&mut self, out: bool, at: i64, ttl: i64, body: Body) -> Made<()> {
        let (signer, other, seq) = if out {
            self.seqs.0 += 1;
            (self.agent, self.peer, self.seqs.0)
        } else {
            self.seqs.1 += 1;
            (self.peer, self.agent, self.seqs.1)
        };
        let envelope = Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: self.deal,
            seq,
            prev: self.head(),
            iss: signer.key_id()?,
            aud: other.key_id()?,
            iat: at,
            exp: at + ttl,
            nonce: nonce(self.transcript.len()),
            body,
        };
        let raw = signer.sign(&envelope)?;
        self.heads.push(H256::digest(raw.as_bytes()));
        self.transcript.push(ProofEnvelope {
            inbound: !out,
            raw,
            received_at: at,
        });
        Ok(())
    }
}

/// The sample deal: Maya's shop sells a refurbished monitor to a buyer's agent, the price is
/// haggled from $249.00 to $212.00, Maya countersigns the order, the buyer approves at PayPal,
/// her shop rule authorizes it, and Maya captures it once the monitor ships.
pub fn sample_bundle() -> Made<ProofBundle> {
    build(false)
}
/// The busy deal: the same shop sells the same kind of monitor, but this one is one table of a
/// shop-around group, was agreed against a market price, was held by the safety check until Maya
/// released it, and its capture's answer was lost and read back. It has the records the first
/// deal has none of.
pub fn busy_bundle() -> Made<ProofBundle> {
    build(true)
}

fn build(busy: bool) -> Made<ProofBundle> {
    let t0 = if busy { T0 + 2 * 86_400 } else { T0 };
    let (owner, agent) = (signer("owner"), signer("agent"));
    let (peer_owner, peer) = (signer("buyer-owner"), signer("buyer-agent"));
    let (agent_id, peer_id) = (agent.key_id()?, peer.key_id()?);

    let deal_id: DealId = if busy {
        "01K8W4C9X7D2F6H0J3M5P8R1TV"
    } else {
        "01K8W2R6Q4N5M9T3VXZ7B1CD0E"
    }
    .parse()?;
    let mandate_id = if busy {
        "01K8W4C9X0A3B6D9E2G5K8N1QS"
    } else {
        "01K8W2R6Q0F4H8J2KMNPQRSTVW"
    }
    .parse()?;
    let other_table: DealId = "01K8W4C9X2Q7S0V3Y6Z9A2C5EG".parse()?;
    let group_id: GroupId = "01K8W4C9X5B8D1F4H7K0M3P6RT".parse()?;
    let delivery = Delivery::ShipThenCapture { days: 3 };
    let terms_at = |minor: i64| -> Made<Terms> {
        Ok(Terms {
            item_ref: ItemRef::new(ITEM)?,
            qty: 1,
            unit_price: money(minor)?,
            currency: Currency::USD,
            delivery: delivery.clone(),
        })
    };
    let (ask, offer, counter, agreed) = if busy {
        (27_900, 22_000, 25_500, 24_900)
    } else {
        (24_900, 19_000, 23_500, 21_200)
    };
    let terms = terms_at(agreed)?;
    let terms_hash = terms.hash()?;
    let amount_text = terms.amount()?.decimal();
    // The market prices the deal was agreed against (busy only): seven comparables, so the band is
    // computed again from them by anyone.
    let market = if busy {
        let comparables = [11_900, 12_400, 12_900, 13_500, 14_200, 15_000, 16_200]
            .map(|minor| MarketComparable {
                minor,
                product_id: None,
            })
            .to_vec();
        let certificate = MarketCertificate::new(
            "dell-p2422h".into(),
            H256::digest(b"the-table/sample-proof/market-response"),
            MarketMatch::Similar,
            Currency::USD,
            comparables,
        )?;
        Some(MarketRef::certified(certificate, t0 + 30)?)
    } else {
        None
    };
    let market_digest = market
        .as_ref()
        .map(MarketRef::digest)
        .transpose()?
        .flatten();

    // The owner's signed rules. Maya decides every order over $150.00 herself.
    let mut payload = MandatePayload {
        id: mandate_id,
        version: 2,
        agent_key: agent.public_key().to_bytes(),
        clauses: vec![
            Clause::Roles {
                roles: vec![Role::Sell],
            },
            Clause::Counterparties {
                rule: CpRule::Paired,
            },
            Clause::PerDeal {
                kind: DealKind::Haggle,
                max_amount: money(40_000)?,
                categories: vec![Category::Office],
            },
            Clause::Band {
                item_refs: vec![ItemRef::new(ITEM)?],
                floor: Some(money(19_000)?),
                ceiling: Some(money(if busy { 30_000 } else { 26_000 })?),
                max_rounds: 6,
                deadline: t0 + 6 * 86_400,
            },
            Clause::Velocity {
                max_deals_day: 10,
                max_total_day: money(200_000)?,
            },
            Clause::HumanPresentOver {
                amount: money(15_000)?,
            },
            Clause::Payees {
                payees: vec![PayeeRef::new(PAYEE)?],
            },
        ],
        not_before: t0 - 86_400,
        expires: t0 + 30 * 86_400,
    };
    if busy {
        // Maya lets her shop keep this monitor's market price fresh: the rule binds the item to its product.
        payload.clauses.push(Clause::MarketWatch {
            items: vec![WatchedItem {
                item_ref: ItemRef::new(ITEM)?,
                product_id: "dell-p2422h".into(),
            }],
            max_refreshes_day: 12,
        });
    }
    payload.validate()?;
    let mandate = OpenMandate {
        owner_sig: owner.sign_payload(&payload)?,
        payload,
    };
    let mandate_hash = mandate.payload.hash()?;

    // The signed messages, in the order this wallet saw them. `out` is the shop's agent.
    let mut wire = Wire {
        deal: deal_id,
        agent: &agent,
        peer: &peer,
        seqs: (0, 0),
        heads: Vec::new(),
        transcript: Vec::new(),
    };
    let item = ItemRef::new(ITEM)?;
    let (t_list, t_offer, t_counter, t_last, t_accept) =
        (t0, t0 + 95, t0 + 240, t0 + 410, t0 + 415);
    wire.send(
        true,
        t_list,
        86_400,
        Body::Listing {
            item_ref: item,
            ask: money(ask)?,
            qty: Some(1),
            delivery: delivery.clone(),
        },
    )?;
    wire.send(
        false,
        t_offer,
        600,
        Body::Offer {
            price: money(offer)?,
            delivery: delivery.clone(),
        },
    )?;
    wire.send(
        true,
        t_counter,
        600,
        Body::Counter {
            price: money(counter)?,
            delivery: delivery.clone(),
        },
    )?;
    wire.send(
        false,
        t_last,
        600,
        Body::Counter {
            price: money(agreed)?,
            delivery: delivery.clone(),
        },
    )?;
    // Both agents accept the buyer's last counter, the second one the buyer's own sequence 2.
    let accept = || Body::Accept {
        offer_seq: 2,
        terms_hash,
        owner_accept: None,
    };
    wire.send(false, t_accept, 86_400, accept())?;
    wire.send(true, t_accept + 20, 86_400, accept())?;

    let t_owner = t0 + 1_800;
    let invoice = invoice_id(deal_id, 1)?;
    let (order, authorization, capture) = (
        "5O190127TN364715T",
        "8AB21743GP650193R",
        "3C679366HH908993F",
    );
    wire.send(
        true,
        t_owner + 6,
        86_400,
        Body::Settle {
            order_id: text(order)?,
            approve_url: text(&format!(
                "https://www.sandbox.paypal.com/checkoutnow?token={order}"
            ))?,
            amount: terms.amount()?,
            invoice_id: text(&invoice)?,
            intent: Intent::Authorize,
            attempt: 1,
        },
    )?;
    let settle_head = wire.head();
    let (t_approved, t_authorized) = (t0 + 2_100, t0 + 2_135);
    let (t_capture, t_receipt) = (t0 + 86_400 + 3_600 * 5, t0 + 86_400 + 3_600 * 5 + 40);
    wire.send(
        true,
        t_receipt,
        86_400,
        Body::Receipt {
            capture_id: text(capture)?,
            amount: terms.amount()?,
            status: ReceiptStatus::Completed,
            transcript_head: settle_head,
        },
    )?;
    let transcript_head = wire.head();
    let Wire {
        heads, transcript, ..
    } = wire;
    let receipt_raw = transcript
        .last()
        .map(|e| e.raw.clone())
        .ok_or("no receipt")?;

    // The owner's two decisions, the closed mandate, and who decided each money step.
    let (owner_create, owner_capture) = (
        DecidedBy::Human { at: t_owner },
        DecidedBy::Human { at: t_capture },
    );
    let seller_rule = DecidedBy::SellerMandate { mandate_hash };
    let mut closed = ClosedMandate {
        deal_id,
        open_mandate_hash: mandate_hash,
        terms_hash,
        amount: terms.amount()?,
        payee: PayeeRef::new(PAYEE)?,
        invoice_id: invoice.clone(),
        decided_by: owner_create.clone(),
        agent_sig: Vec::new(),
    };
    closed.agent_sig = agent.sign_closed(&closed)?;
    let closed_hash = H256::digest(&closed.signing_bytes()?);
    let request = |step: &str| format!("{invoice}-{step}");
    let operation = |name: &str, by: &DecidedBy| ProofOperation {
        attempt: 1,
        operation: name.into(),
        decided_by: by.clone(),
        status: "confirmed".into(),
        request_id: Some(request(name)),
    };
    let operations = vec![
        operation("create", &owner_create),
        operation("authorize", &seller_rule),
        operation("capture", &owner_capture),
    ];

    // PayPal's answers, redacted, with the identifier-only binding the wallet stores for each order.
    let binding = json!({ "purchase_units": [{
        "amount": { "currency_code": "USD", "value": amount_text },
        "custom_id": terms_hash.hex(),
        "invoice_id": invoice,
        "payee_merchant_id": PAYEE,
    }]});
    let call = |method: &str,
                path: &str,
                status: i64,
                body: Value,
                binding: Option<Value>,
                at: i64,
                request_id: String| ProofCall {
        method: method.into(),
        path: path.into(),
        status: Some(status),
        body,
        binding,
        at,
        request_id: Some(request_id),
    };
    let paypal_calls = vec![
        call(
            "POST",
            "/v2/checkout/orders",
            201,
            order_body(order, &invoice, &amount_text, "CREATED", None),
            Some(binding.clone()),
            t_owner + 2,
            request("create"),
        ),
        call(
            "GET",
            &format!("/v2/checkout/orders/{order}"),
            200,
            order_body(order, &invoice, &amount_text, "APPROVED", None),
            Some(binding.clone()),
            t_approved,
            format!("{deal_id}-poll"),
        ),
        call(
            "POST",
            &format!("/v2/checkout/orders/{order}/authorize"),
            201,
            order_body(
                order,
                &invoice,
                &amount_text,
                "COMPLETED",
                Some(json!({ "authorizations": [{
                    "amount": { "currency_code": "USD", "value": amount_text },
                    "id": authorization, "status": "CREATED",
                }]})),
            ),
            Some(binding),
            t_authorized,
            request("authorize"),
        ),
        call(
            "POST",
            &format!("/v2/payments/authorizations/{authorization}/capture"),
            201,
            json!({
                "amount": { "currency_code": "USD", "value": amount_text },
                "id": capture, "status": "COMPLETED",
            }),
            None,
            t_capture + 3,
            request("capture"),
        ),
    ];
    let mut paypal_calls = paypal_calls;
    if busy {
        // PayPal's answer to the capture never arrived: the call is kept with no answer, and the wallet
        // read the capture back under the same request id.
        if let Some(last) = paypal_calls.last_mut() {
            last.status = None;
            last.body = Value::Null;
        }
    }

    // The deal's slice of the ledger's audit chain.
    let mut log = Log {
        seq: 0,
        prev: H256::digest(b"the-table/sample-proof/before-this-deal"),
        deal: deal_id,
        rows: Vec::new(),
    };
    log.other_deals(61);
    let policy = "policy";
    let agent_actor = format!("agent:{agent_id}");
    let peer_actor = format!("peer:{peer_id}");
    let accepted = |out: bool, index: usize, typ: MsgType, seq: u32| -> Made<Value> {
        Ok(json!({
            "direction": if out { "out" } else { "in" },
            "hash": hash_value(heads[index])?,
            "seq": seq,
            "typ": typ,
        }))
    };
    let transition = |from: DealState, to: DealState| json!({ "from": from, "to": to });
    let decided = |by: &DecidedBy| serde_json::to_value(by);
    log.row(
        t_list,
        policy,
        "deal.created",
        &json!({ "kind": "haggle", "mode": "sandbox", "terms_hash": hash_value(terms_at(ask)?.hash()?)? }),
    )?;
    log.row(
        t_list,
        policy,
        "deadline.set",
        &json!({ "authorization_at": null, "due_at": t0 + 6 * 86_400 }),
    )?;
    // The shop-around group: Maya's agent opened two tables for the same buyer; this is one of them.
    let mut other_rows = Vec::new();
    if busy {
        log.row(
            t_list,
            "owner",
            "group.opened",
            &json!({ "group_id": group_id, "tables": 2 }),
        )?;
        other_rows.push(log.row_of(
            other_table,
            t_list,
            "owner",
            "group.opened",
            &json!({ "group_id": group_id, "tables": 2 }),
        )?);
        if let Some(market) = &market {
            log.row(
                t_list + 30,
                "market",
                "market.observed",
                &json!({
                    "digest": hash_value(market_digest.ok_or("no market digest")?)?,
                    "reference": serde_json::to_value(market)?,
                    "response_hash": hash_value(market.response_hash)?,
                    "retrieved_at": market.retrieved_at,
                }),
            )?;
        }
    }
    log.row(
        t_list,
        &agent_actor,
        "envelope.accepted",
        &accepted(true, 0, MsgType::Listing, 1)?,
    )?;
    log.row(
        t_list,
        policy,
        "deal.transition",
        &transition(DealState::Pairing, DealState::Listed),
    )?;
    log.other_deals(3);
    log.row(
        t_offer,
        &peer_actor,
        "envelope.accepted",
        &accepted(false, 1, MsgType::Offer, 1)?,
    )?;
    log.row(
        t_offer,
        policy,
        "deal.transition",
        &transition(DealState::Listed, DealState::Negotiating),
    )?;
    log.row(
        t_counter,
        &agent_actor,
        "envelope.accepted",
        &accepted(true, 2, MsgType::Counter, 2)?,
    )?;
    log.row(
        t_last,
        &peer_actor,
        "envelope.accepted",
        &accepted(false, 3, MsgType::Counter, 2)?,
    )?;
    log.other_deals(2);
    log.row(
        t_accept,
        &peer_actor,
        "envelope.accepted",
        &accepted(false, 4, MsgType::Accept, 3)?,
    )?;
    let mut agreement = json!({ "decided_by": { "clause": 6, "type": "policy" }, "from": "NEGOTIATING", "to": "AGREED" });
    if let (Some(digest), Some(object)) = (market_digest, agreement.as_object_mut()) {
        object.insert(
            "market".into(),
            json!({ "digest": hash_value(digest)?, "format": "table.market.v2" }),
        );
    }
    log.row(t_accept, policy, "deal.transition", &agreement)?;
    if busy {
        log.row(
            t_accept,
            policy,
            "group.won",
            &json!({ "group_id": group_id }),
        )?;
    }
    log.row(
        t_accept + 20,
        &agent_actor,
        "envelope.accepted",
        &accepted(true, 5, MsgType::Accept, 3)?,
    )?;
    if busy {
        // The group rule calls the other table off after the win.
        other_rows.push(log.row_of(
            other_table,
            t_accept + 25,
            policy,
            "group.withdrawn",
            &json!({ "decided_by": "group_rule", "group_id": group_id, "winner": deal_id }),
        )?);
    }
    log.other_deals(17);
    // What the owner saw is recorded as a hash of the checklist, before the step it covers.
    let saw =
        |what: &str| H256::digest(format!("the-table/sample-proof/checklist/{what}").as_bytes());
    if busy {
        // The safety check held the deal (the price is over 1.4 times the market median); Maya released
        // that hold, for these terms and that rule only, before deciding.
        log.row(
            t_owner - 60,
            "shield",
            "shield.raised",
            &json!({ "rule": "price_over_market", "verdict": "HOLD" }),
        )?;
        log.row(
            t_owner - 40,
            "owner",
            "shield.released",
            &json!({
                "decided_by": decided(&owner_create)?, "from": "hold",
                "rules": ["price_over_market"], "terms_hash": hash_value(terms_hash)?, "to": "released",
            }),
        )?;
    }
    log.row(
        t_owner - 25,
        "owner",
        "owner.decision",
        &json!({
            "attempt": 1, "checks_hash": hash_value(saw("countersign"))?,
            "decided_by": decided(&owner_create)?, "decision": "deal_countersign",
            "terms_hash": hash_value(terms_hash)?,
        }),
    )?;
    if !busy {
        log.row(
            t_owner - 24,
            "shield",
            "shield.checked",
            &json!({ "rule": null, "terms_hash": hash_value(terms_hash)?, "verdict": "CLEAR" }),
        )?;
    }
    log.row(
        t_owner,
        "owner/policy",
        "deal.countersigned",
        &json!({ "attempt": 1, "decided_by": decided(&owner_create)?, "hash": hash_value(closed_hash)? }),
    )?;
    log.row(
        t_owner,
        "pipeline",
        "money.authorized",
        &json!({ "decided_by": decided(&owner_create)?, "operation": "create", "request_id": request("create") }),
    )?;
    log.row(
        t_owner + 1,
        policy,
        "deal.transition",
        &transition(DealState::Agreed, DealState::Settling),
    )?;
    log.row(
        t_owner + 3,
        policy,
        "deal.transition",
        &transition(DealState::Settling, DealState::AwaitingApproval),
    )?;
    log.row(
        t_owner + 3,
        "pipeline",
        "money.observed",
        &json!({ "confirmed": true, "decided_by": decided(&owner_create)?, "operation": "create" }),
    )?;
    log.row(
        t_owner + 3,
        policy,
        "deadline.set",
        &json!({ "authorization_at": null, "due_at": t_owner + 1_800 }),
    )?;
    log.row(
        t_owner + 6,
        &agent_actor,
        "envelope.accepted",
        &accepted(true, 6, MsgType::Settle, 4)?,
    )?;
    log.other_deals(5);
    log.row(
        t_approved,
        "paypal",
        "paypal.response",
        &json!({ "debug_id": null, "path": format!("/v2/checkout/orders/{order}"), "status": 200 }),
    )?;
    log.row(
        t_approved,
        policy,
        "deal.transition",
        &transition(DealState::AwaitingApproval, DealState::Approved),
    )?;
    log.row(
        t_authorized,
        "pipeline",
        "money.authorized",
        &json!({ "decided_by": decided(&seller_rule)?, "operation": "authorize", "request_id": request("authorize") }),
    )?;
    log.row(
        t_authorized + 1,
        policy,
        "deal.transition",
        &transition(DealState::Approved, DealState::Authorized),
    )?;
    log.row(
        t_authorized + 1,
        "pipeline",
        "money.observed",
        &json!({ "confirmed": true, "decided_by": decided(&seller_rule)?, "operation": "authorize" }),
    )?;
    log.row(
        t_authorized + 1,
        policy,
        "deadline.set",
        &json!({ "authorization_at": t_authorized, "due_at": t_authorized + 3 * 86_400 }),
    )?;
    log.other_deals(212);
    log.row(
        t_capture - 2,
        "owner",
        "owner.decision",
        &json!({
            "attempt": 1, "checks_hash": hash_value(saw("capture"))?,
            "decided_by": decided(&owner_capture)?, "decision": "deal_capture",
            "terms_hash": hash_value(terms_hash)?,
        }),
    )?;
    log.row(
        t_capture,
        "pipeline",
        "money.authorized",
        &json!({ "decided_by": decided(&owner_capture)?, "operation": "capture", "request_id": request("capture") }),
    )?;
    if busy {
        // The capture's answer was lost; the wallet read it back, under the one request id it was sent with.
        log.row(
            t_capture + 2,
            "pipeline",
            "money.resolved",
            &json!({
                "confirmed": true, "decided_by": decided(&owner_capture)?, "observed": "completed",
                "operation": "capture", "outcome": "confirmed", "request_id": request("capture"),
            }),
        )?;
    }
    log.row(
        t_capture + 3,
        policy,
        "deal.transition",
        &transition(DealState::Authorized, DealState::Captured),
    )?;
    log.row(
        t_capture + 3,
        "pipeline",
        "money.observed",
        &json!({ "confirmed": true, "decided_by": decided(&owner_capture)?, "operation": "capture" }),
    )?;
    log.row(
        t_receipt,
        &agent_actor,
        "envelope.accepted",
        &accepted(true, 7, MsgType::Receipt, 5)?,
    )?;
    log.row(
        t_receipt,
        &peer_actor,
        "receipt.verified",
        &json!({ "capture_id": capture, "transcript_head": hash_value(settle_head)? }),
    )?;
    log.row(
        t_receipt,
        policy,
        "deal.transition",
        &transition(DealState::Captured, DealState::Receipted),
    )?;
    let last = log.rows.last().map(|r| (r.seq, r.hash)).ok_or("no rows")?;
    // The wallet-wide chain runs on past this deal's last row, so the file names a later head.
    let rows = std::mem::take(&mut log.rows);
    let group = busy.then(|| ProofGroup {
        id: group_id,
        opened_at: t_list,
        winner: Some(deal_id),
        tables: vec![
            ProofGroupTable {
                deal_id,
                state: DealState::Receipted,
                rows: rows
                    .iter()
                    .filter(|r| r.action.starts_with("group."))
                    .cloned()
                    .collect(),
            },
            ProofGroupTable {
                deal_id: other_table,
                state: DealState::Withdrawn,
                rows: other_rows.clone(),
            },
        ],
    });
    log.other_deals(9);
    let audit_head = ProofAuditHead {
        seq: log.seq.max(last.0),
        hash: log.prev,
    };

    let manifest = crate::authority::manifest()?;
    let deal = Deal {
        id: deal_id,
        created_at: t_list,
        updated_at: t_receipt,
        kind: DealKind::Haggle,
        side: Side::Seller,
        counterparty: peer_id.clone(),
        terms,
        state: DealState::Receipted,
        mandate_id,
        mandate_version: 2,
        transcript_head,
        paypal: PaypalRefs {
            order: Some(order.into()),
            authorization: Some(authorization.into()),
            capture: Some(capture.into()),
            subscription: None,
        },
        mode: Mode::Sandbox,
        market,
        shield: Some(if busy {
            ShieldVerdict::Hold
        } else {
            ShieldVerdict::Clear
        }),
        decided_by: Some(owner_capture),
        shield_rule: busy.then_some(ShieldRule::PriceOverMarket),
        shield_release: busy.then(|| ShieldRelease {
            terms_hash,
            rules: vec![ShieldRule::PriceOverMarket],
            at: t_owner - 40,
        }),
    };
    let mut bundle = ProofBundle {
        format: PROOF_FORMAT.into(),
        exported_at: t_receipt + 7_200,
        deal,
        owner_key: owner.public_key().to_bytes(),
        mandate,
        counterparty: ProofCounterparty {
            agent_key: peer.public_key().to_bytes(),
            owner_key: peer_owner.public_key().to_bytes(),
        },
        transcript,
        closed_mandates: vec![ProofClosed {
            attempt: 1,
            mandate: closed,
        }],
        operations,
        paypal_calls,
        receipts: vec![ProofReceipt {
            raw: receipt_raw,
            capture_id: Some(capture.into()),
            amount_minor: Some(agreed),
            transcript_head: settle_head,
        }],
        audit: rows,
        audit_head,
        authority_manifest: Some(manifest),
        group,
        house: None,
        evidence_head: H256::ZERO,
        evidence_sig: Vec::new(),
    };
    bundle.evidence_head = bundle.evidence_commitment()?;
    bundle.evidence_sig = agent.sign_commitment(bundle.evidence_head);
    Ok(bundle)
}

/// One edit to the file's JSON: set the value at a JSON pointer, or remove the key or array item.
#[derive(Debug, Clone, Serialize)]
pub struct Edit {
    pub op: &'static str,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<Value>,
}
impl Edit {
    fn set(path: impl Into<String>, value: Value) -> Self {
        Self {
            op: "set",
            path: path.into(),
            value: Some(value),
        }
    }
    fn remove(path: impl Into<String>) -> Self {
        Self {
            op: "remove",
            path: path.into(),
            value: None,
        }
    }
}
/// A tampered copy of the sample: what is changed and which checks must catch it.
#[derive(Debug, Clone)]
pub struct Variant {
    pub name: &'static str,
    pub edits: Vec<Edit>,
    /// The checks that must read "did not pass" for this edit, in report order.
    pub red: &'static [&'static str],
}

/// Applies `edits` to a JSON document, the way the client's tamper control does.
pub fn apply(document: &mut Value, edits: &[Edit]) -> Made<()> {
    for edit in edits {
        let (parent, key) = edit.path.rsplit_once('/').ok_or("path needs a /")?;
        let target = document
            .pointer_mut(parent)
            .ok_or_else(|| format!("no place at {parent}"))?;
        match (edit.op, target) {
            ("set", Value::Object(object)) => {
                object.insert(
                    key.to_owned(),
                    edit.value.clone().ok_or("set needs a value")?,
                );
            }
            ("set", Value::Array(items)) => {
                let slot = items.get_mut(key.parse::<usize>()?).ok_or("no such item")?;
                *slot = edit.value.clone().ok_or("set needs a value")?;
            }
            ("remove", Value::Object(object)) => {
                object.remove(key).ok_or("no such key")?;
            }
            ("remove", Value::Array(items)) => {
                let at = key.parse::<usize>()?;
                if at >= items.len() {
                    return Err("no such item".into());
                }
                items.remove(at);
            }
            _ => return Err(format!("cannot edit {}", edit.path).into()),
        }
    }
    Ok(())
}

fn row_at(bundle: &ProofBundle, action: &str, nth: usize) -> Made<usize> {
    bundle
        .audit
        .iter()
        .enumerate()
        .filter(|(_, row)| row.action == action)
        .nth(nth)
        .map(|(index, _)| index)
        .ok_or_else(|| format!("no {action} row").into())
}

/// The tampered copies of the sample. Each edit is one a person could make with a text editor.
pub fn variants(bundle: &ProofBundle) -> Made<Vec<Variant>> {
    let deadline = row_at(bundle, "deadline.set", 0)?;
    let capture_decision = row_at(bundle, "owner.decision", 1)?;
    let signature = {
        // Change the first character of one message's signature: still a signature, no longer ours.
        let raw = &bundle.transcript.get(2).ok_or("no message")?.raw;
        let (signed, signature) = raw.rsplit_once('.').ok_or("no signature")?;
        let first = if signature.starts_with('A') { 'B' } else { 'A' };
        format!("{signed}.{first}{}", signature.get(1..).unwrap_or_default())
    };
    let quiet_row = bundle
        .audit
        .get(deadline)
        .ok_or("no row")?
        .detail_json
        .replace(
            &(T0 + 6 * 86_400).to_string(),
            &(T0 + 60 * 86_400).to_string(),
        );
    let capture_call = bundle
        .paypal_calls
        .iter()
        .position(|c| c.path.ends_with("/capture"))
        .ok_or("no capture call")?;
    // The edits scale with what the file holds, so the same ones work on any file shaped like it.
    let amount = bundle.deal.terms.amount()?;
    let raised = amount.minor() / 5 * 7;
    let tenth = Money::new(amount.minor() / 10, Currency::USD)?;
    let band = bundle
        .mandate
        .payload
        .clauses
        .iter()
        .position(|c| matches!(c, Clause::Band { .. }))
        .ok_or("no band clause")?;
    let ceiling = match bundle.mandate.payload.clauses.get(band) {
        Some(Clause::Band {
            ceiling: Some(ceiling),
            ..
        }) => ceiling.minor() * 2,
        _ => return Err("no ceiling".into()),
    };
    let refund = format!(
        "/v2/payments/captures/{}/refund",
        bundle.deal.paypal.capture.as_deref().unwrap_or("CAPTURE")
    );
    Ok(vec![
        Variant {
            name: "price",
            edits: vec![Edit::set("/deal/terms/unit_price/minor", json!(raised))],
            red: &["countersign", "paypal_order", "receipt", "evidence"],
        },
        Variant {
            name: "audit-line",
            edits: vec![Edit::set(
                format!("/audit/{deadline}/detail_json"),
                json!(quiet_row),
            )],
            red: &["audit", "evidence"],
        },
        Variant {
            name: "audit-gap",
            edits: vec![Edit::remove(format!("/audit/{capture_decision}"))],
            red: &["authority", "owner_saw", "evidence"],
        },
        Variant {
            name: "signature",
            edits: vec![Edit::set("/transcript/2/raw", json!(signature))],
            red: &["transcript", "evidence"],
        },
        Variant {
            name: "payee",
            edits: vec![Edit::set(
                "/closed_mandates/0/mandate/payee",
                json!("someone-else"),
            )],
            red: &["countersign", "paypal_order", "evidence"],
        },
        Variant {
            name: "paypal-amount",
            edits: vec![Edit::set(
                "/paypal_calls/0/binding/purchase_units/0/amount/value",
                json!(tenth.decimal()),
            )],
            red: &["paypal_order", "evidence"],
        },
        Variant {
            name: "refund",
            edits: vec![Edit::set(
                format!("/paypal_calls/{capture_call}/path"),
                json!(refund),
            )],
            red: &["authority", "evidence"],
        },
        Variant {
            name: "receipt",
            edits: vec![Edit::set("/receipts/0/amount_minor", json!(tenth.minor()))],
            red: &["receipt", "evidence"],
        },
        Variant {
            name: "rules",
            edits: vec![Edit::set(
                format!("/mandate/payload/clauses/{band}/ceiling/minor"),
                json!(ceiling),
            )],
            red: &["mandate", "countersign", "authority", "evidence"],
        },
        Variant {
            name: "relabel",
            edits: vec![Edit::set("/format", json!("table.proof.v1"))],
            red: &["format", "evidence"],
        },
        Variant {
            name: "owner-key",
            edits: vec![Edit::set(
                "/owner_key",
                serde_json::to_value(bundle.counterparty.owner_key)?,
            )],
            red: &["mandate", "evidence"],
        },
        Variant {
            name: "not-a-proof",
            edits: vec![Edit::remove("/deal")],
            red: &[],
        },
    ])
}

/// The tampered copies of the busy deal: edits to the records only it has.
pub fn busy_variants(bundle: &ProofBundle) -> Made<Vec<Variant>> {
    let released = row_at(bundle, "shield.released", 0)?;
    let group = bundle.group.as_ref().ok_or("no group")?;
    let other = group
        .tables
        .get(1)
        .map(|t| t.deal_id)
        .ok_or("no second table")?;
    let capture = bundle
        .operations
        .iter()
        .position(|o| o.operation == "capture")
        .ok_or("no capture step")?;
    Ok(vec![
        Variant {
            name: "shield-release",
            edits: vec![Edit::remove(format!("/audit/{released}"))],
            red: &["shield", "evidence"],
        },
        Variant {
            name: "market-price",
            edits: vec![Edit::set(
                "/deal/market/certificate/comparables/0/minor",
                json!(5_000),
            )],
            red: &["market", "evidence"],
        },
        Variant {
            name: "group-winner",
            edits: vec![Edit::set("/group/winner", json!(other))],
            red: &["group", "evidence"],
        },
        Variant {
            name: "group-agreed",
            edits: vec![Edit::set("/group/tables/1/state", json!("RECEIPTED"))],
            red: &["group", "evidence"],
        },
        Variant {
            name: "request-id",
            edits: vec![Edit::set(
                format!("/operations/{capture}/request_id"),
                json!("a-second-request-id"),
            )],
            red: &["authority", "one_request", "evidence"],
        },
    ])
}

/// What the verifier says about some bytes: its report, or why it would not read them.
fn outcome(bytes: &[u8]) -> Value {
    match check_proof_file(bytes) {
        Ok(report) => json!({ "report": report }),
        Err(refused) => json!({ "refused": refused.message }),
    }
}
fn report(bytes: &[u8]) -> Made<ProofReport> {
    check_proof_file(bytes).map_err(|e| e.message.into())
}

/// One sample deal as the client reads it: its file, and the copies of it that are tampered with.
#[derive(Debug)]
pub struct Sample {
    /// The key the client finds it under in `parity.json`.
    pub name: &'static str,
    pub file: &'static str,
    pub bundle: fn() -> Made<ProofBundle>,
    pub variants: fn(&ProofBundle) -> Made<Vec<Variant>>,
    /// The checks that read "not checked" for this deal, because it has nothing of their kind.
    pub dashed: &'static [&'static str],
}
pub const SAMPLES: [Sample; 2] = [
    Sample {
        name: "monitor",
        file: GOLDEN,
        bundle: sample_bundle,
        variants,
        dashed: &["one_request", "group", "shield", "house_record", "market"],
    },
    Sample {
        name: "busy",
        file: BUSY,
        bundle: busy_bundle,
        variants: busy_variants,
        dashed: &["house_record"],
    },
];

/// The files the client reads: each sample, and the verifier's word on every sample and its tampered
/// copies. Each is `(file name, bytes)`.
pub fn files() -> Made<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    let mut reports = serde_json::Map::new();
    for sample in &SAMPLES {
        let bundle = (sample.bundle)()?;
        let golden = serde_json::to_vec_pretty(&bundle)?;
        let document: Value = serde_json::from_slice(&golden)?;
        let mut tampered = Vec::new();
        for variant in (sample.variants)(&bundle)? {
            let mut copy = document.clone();
            apply(&mut copy, &variant.edits)?;
            tampered.push(json!({
                "name": variant.name,
                "edits": variant.edits,
                "red": variant.red,
                "outcome": outcome(&serde_json::to_vec_pretty(&copy)?),
            }));
        }
        reports.insert(
            sample.name.to_owned(),
            json!({ "golden": report(&golden)?, "variants": tampered }),
        );
        out.push((sample.file.to_owned(), golden));
    }
    let mut parity = serde_json::to_vec_pretty(&json!({ "samples": reports }))?;
    parity.push(b'\n');
    out.push((PARITY.to_owned(), parity));
    Ok(out)
}

/// Writes every file into `dir`.
pub fn write_to(dir: &std::path::Path) -> Made<()> {
    std::fs::create_dir_all(dir)?;
    for (name, bytes) in files()? {
        std::fs::write(dir.join(name), bytes)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(CLIENT_DIR)
    }
    /// A check "did not pass": it applies, was made, and failed.
    fn red(report: &ProofReport) -> Vec<&str> {
        report
            .checks
            .iter()
            .filter(|c| c.applies && c.checked && !c.ok)
            .map(|c| c.id.as_str())
            .collect()
    }

    #[test]
    fn each_sample_verifies_and_says_what_it_does_not_cover() -> Made<()> {
        for sample in &SAMPLES {
            let golden = serde_json::to_vec_pretty(&(sample.bundle)()?)?;
            let report = report(&golden)?;
            assert!(report.verified, "{}: {:#?}", sample.name, report.checks);
            assert_eq!(report.same_version, Some(true), "{}", sample.name);
            let dashed: Vec<&str> = report
                .checks
                .iter()
                .filter(|c| !c.applies)
                .map(|c| c.id.as_str())
                .collect();
            // What the deal has nothing of reads "not checked", never green (the first deal has no
            // group, hold, market price or second look at PayPal; the busy one has all of them).
            assert_eq!(dashed, sample.dashed, "{}", sample.name);
            assert!(
                report.checks.iter().filter(|c| c.applies).all(|c| c.ok),
                "{}",
                sample.name
            );
        }
        Ok(())
    }

    #[test]
    fn each_tamper_turns_exactly_the_named_checks_red() -> Made<()> {
        for sample in &SAMPLES {
            let bundle = (sample.bundle)()?;
            let document: Value = serde_json::from_slice(&serde_json::to_vec_pretty(&bundle)?)?;
            for variant in (sample.variants)(&bundle)? {
                let mut copy = document.clone();
                apply(&mut copy, &variant.edits)?;
                let bytes = serde_json::to_vec_pretty(&copy)?;
                match check_proof_file(&bytes) {
                    Ok(report) => {
                        assert!(!report.verified, "{} still verifies", variant.name);
                        assert_eq!(red(&report), variant.red, "{}", variant.name);
                    }
                    Err(_) => assert!(variant.red.is_empty(), "{} is refused", variant.name),
                }
            }
        }
        Ok(())
    }

    /// The client reads these files; if they are stale the browser checker would be compared
    /// against the wrong thing.
    #[test]
    fn the_files_the_client_reads_are_current() -> Made<()> {
        for (name, fresh) in files()? {
            let kept = std::fs::read(dir().join(&name))?;
            assert!(
                kept == fresh,
                "{name} is stale: run `cargo run -p table-client --bin sample-proof`"
            );
        }
        Ok(())
    }
}
