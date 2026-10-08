//! Shop around (T8): the group guard in the ledger. At most one table of a group holds our ACCEPT,
//! at most one ever agrees, the schema refuses a second agreement below Rust, and two ACCEPTs
//! racing on two connections make exactly one agreement.
use super::*;
use ed25519_dalek::SigningKey;
use table_core::*;
use table_proto::*;

fn signer() -> AgentSigner {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).unwrap();
    let signer = AgentSigner::from_key(SigningKey::from_bytes(&bytes));
    bytes.fill(0);
    signer
}
fn money(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
/// A fresh random ULID-shaped id.
fn fresh<T: std::str::FromStr>() -> T
where
    T::Err: std::fmt::Debug,
{
    const ALPHABET: &[u8] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut bytes = [0; 24];
    getrandom::fill(&mut bytes).unwrap();
    let tail: String = bytes
        .iter()
        .map(|b| ALPHABET[usize::from(*b) % 32] as char)
        .collect();
    format!("01{tail}").parse().unwrap()
}
fn nonce() -> [u8; 16] {
    let mut n = [0; 16];
    getrandom::fill(&mut n).unwrap();
    n
}

/// One buyer wallet with three paired sellers and an open table with each, same item.
struct Fixture {
    ledger: Ledger,
    own: AgentSigner,
    sellers: Vec<AgentSigner>,
    deals: Vec<Deal>,
}
impl Fixture {
    fn new(ledger: Ledger, tables: usize) -> Self {
        let mut ledger = ledger;
        let (owner, own) = (signer(), signer());
        let payload = MandatePayload {
            id: "00000000000000000000000002".parse().unwrap(),
            version: 1,
            agent_key: own.public_key().to_bytes(),
            not_before: 0,
            expires: 10000,
            clauses: vec![
                Clause::Roles {
                    roles: vec![Role::Buy],
                },
                Clause::Counterparties {
                    rule: CpRule::Paired,
                },
                Clause::PerDeal {
                    kind: DealKind::Haggle,
                    max_amount: money(50000),
                    categories: vec![Category::Parts],
                },
                Clause::Band {
                    item_refs: vec![ItemRef::new("monitor").unwrap()],
                    floor: None,
                    ceiling: Some(money(34000)),
                    max_rounds: 6,
                    deadline: 9000,
                },
                Clause::Velocity {
                    max_deals_day: 10,
                    max_total_day: money(100000),
                },
                Clause::HumanPresentOver {
                    amount: money(25000),
                },
                Clause::Payees {
                    payees: vec![PayeeRef::new("merchant").unwrap()],
                },
            ],
        };
        let mandate = OpenMandate {
            owner_sig: owner.sign_payload(&payload).unwrap(),
            payload,
        };
        ledger
            .insert_mandate(&mandate, &owner.public_key(), 100)
            .unwrap();
        let mut sellers = Vec::new();
        let mut deals = Vec::new();
        for n in 0..tables {
            let peer = signer();
            let cp = Counterparty {
                key_id: peer.key_id().unwrap(),
                owner_key: peer.public_key().to_bytes(),
                agent_key: peer.public_key().to_bytes(),
                display_name: table_proto::ShortText::new(format!("Seller {n}")).unwrap(),
                paired_via: PairedVia::Code,
                words_confirmed_at: Some(100),
                declared_payee: PayeeRef::new("merchant").unwrap(),
                first_seen: 100,
            };
            ledger.insert_counterparty(&cp).unwrap();
            let deal = Deal {
                created_at: 100,
                updated_at: 100,
                id: fresh(),
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty: cp.key_id,
                terms: Terms {
                    item_ref: ItemRef::new("monitor").unwrap(),
                    qty: 1,
                    unit_price: money(30000),
                    currency: Currency::USD,
                    delivery: Delivery::DigitalNow,
                },
                state: DealState::Pairing,
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                transcript_head: H256::ZERO,
                paypal: PaypalRefs::default(),
                mode: Mode::Sandbox,
                market: None,
                shield: None,
                decided_by: None,
            };
            ledger.create_deal(&deal, 100).unwrap();
            ledger
                .apply_event(deal.id, DealEvent::ListingVerified, 100)
                .unwrap();
            sellers.push(peer);
            deals.push(deal);
        }
        Self {
            ledger,
            own,
            sellers,
            deals,
        }
    }
    fn group(&mut self) -> GroupRecord {
        let ids: Vec<DealId> = self.deals.iter().map(|d| d.id).collect();
        self.ledger
            .open_group(fresh::<GroupId>(), &ids, 100)
            .unwrap()
    }
    fn deal(&self, n: usize) -> Deal {
        self.ledger.get_deal(self.deals[n].id).unwrap()
    }
    /// An envelope from seller `n` on its table, chained to the current head.
    fn by_seller(&self, n: usize, body: Body) -> VerifiedEnvelope {
        let deal = self.deal(n);
        let peer = &self.sellers[n];
        let e = Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: deal.id,
            seq: self
                .ledger
                .next_sequence(deal.id, Direction::Inbound)
                .unwrap(),
            prev: deal.transcript_head,
            iss: peer.key_id().unwrap(),
            aud: self.own.key_id().unwrap(),
            iat: 100,
            exp: 700,
            nonce: nonce(),
            body,
        };
        self.ledger
            .preview_inbound(deal.id, &peer.sign(&e).unwrap(), 100)
            .unwrap()
    }
    /// Our agent's envelope on table `n`, chained to the current head.
    fn ours(&self, n: usize, body: Body) -> VerifiedEnvelope {
        signed_by(
            &self.ledger,
            &self.own,
            &self.deal(n),
            &self.sellers[n],
            body,
        )
    }
    fn counter(&mut self, n: usize, price: i64) {
        let mut terms = self.deal(n).terms;
        terms.unit_price = money(price);
        let verified = self.by_seller(
            n,
            Body::Counter {
                price: terms.unit_price,
                delivery: Delivery::DigitalNow,
            },
        );
        self.ledger
            .commit_negotiation(
                &verified,
                Direction::Inbound,
                Some(&terms),
                Some(DealEvent::OfferVerified),
                100,
            )
            .unwrap();
    }
    fn offer(&mut self, n: usize, price: i64) {
        let mut terms = self.deal(n).terms;
        terms.unit_price = money(price);
        let verified = self.ours(
            n,
            Body::Offer {
                price: terms.unit_price,
                delivery: Delivery::DigitalNow,
            },
        );
        self.ledger
            .commit_negotiation(
                &verified,
                Direction::Outbound,
                Some(&terms),
                Some(DealEvent::OfferVerified),
                100,
            )
            .unwrap();
    }
    fn accept_body(&self, n: usize) -> Body {
        accept_body(&self.ledger, self.deals[n].id)
    }
    fn accept_out(&mut self, n: usize) -> Result<(), LedgerError> {
        let verified = self.ours(n, self.accept_body(n));
        self.ledger
            .commit_negotiation(&verified, Direction::Outbound, None, None, 100)
    }
    fn accept_in(&mut self, n: usize) -> Result<(), LedgerError> {
        let verified = self.by_seller(n, self.accept_body(n));
        self.ledger
            .commit_negotiation(&verified, Direction::Inbound, None, None, 100)
    }
    fn agreed(&self) -> usize {
        (0..self.deals.len())
            .filter(|n| self.deal(*n).state == DealState::Agreed)
            .count()
    }
}
fn accept_body(ledger: &Ledger, id: DealId) -> Body {
    let (offer_seq, terms_hash) = ledger.pending_offer(id).unwrap();
    Body::Accept {
        offer_seq,
        terms_hash,
        owner_accept: None,
    }
}
fn signed_by(
    ledger: &Ledger,
    own: &AgentSigner,
    deal: &Deal,
    peer: &AgentSigner,
    body: Body,
) -> VerifiedEnvelope {
    let seq = ledger.next_sequence(deal.id, Direction::Outbound).unwrap();
    let audience = peer.key_id().unwrap();
    let e = Envelope {
        v: 1,
        typ: body.typ(),
        deal_id: deal.id,
        seq,
        prev: deal.transcript_head,
        iss: own.key_id().unwrap(),
        aud: audience.clone(),
        iat: 100,
        exp: 700,
        nonce: nonce(),
        body,
    };
    verify(
        &own.sign(&e).unwrap(),
        &own.public_key(),
        &VerifyContext {
            deal_id: deal.id,
            audience: &audience,
            next_sender_seq: seq,
            previous: deal.transcript_head,
            now: 100,
            nonces: ledger,
        },
    )
    .unwrap()
}
fn actions(ledger: &Ledger, action: &str) -> i64 {
    ledger
        .conn
        .query_row(
            "SELECT COUNT(*) FROM audit_log WHERE action=?1",
            [action],
            |r| r.get(0),
        )
        .unwrap()
}

#[test]
fn a_group_agrees_once_and_refuses_every_other_accept_before_recording_it() {
    let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 3);
    let group = fx.group();
    assert_eq!(group.tables.len(), 3);
    assert_eq!(group.winner, None);
    assert_eq!(actions(&fx.ledger, "group.opened"), 3);
    for n in 0..3 {
        assert_eq!(fx.ledger.group_of(fx.deals[n].id).unwrap(), Some(group.id));
    }
    fx.counter(0, 31000);
    fx.counter(1, 30500);
    fx.counter(2, 30900);
    // Our ACCEPT on seller 0's counter is the group's one outstanding ACCEPT.
    fx.accept_out(0).unwrap();
    let before = fx.ledger.verify_audit().unwrap();
    assert!(
        fx.ledger
            .group_accept_blocked(fx.deals[1].id, true)
            .unwrap()
    );
    assert!(matches!(fx.accept_out(1), Err(LedgerError::GroupClosed)));
    // Refused before anything was written: no envelope, no audit row.
    assert_eq!(
        fx.ledger
            .envelope_count(fx.deals[1].id, Direction::Outbound)
            .unwrap(),
        0
    );
    assert_eq!(fx.ledger.verify_audit().unwrap(), before);
    // Seller 0 answers: the table agrees and claims the group in the same transaction.
    fx.accept_in(0).unwrap();
    assert_eq!(fx.deal(0).state, DealState::Agreed);
    assert_eq!(
        fx.ledger.deal_group(group.id).unwrap().winner,
        Some(fx.deals[0].id)
    );
    assert_eq!(actions(&fx.ledger, "group.won"), 1);
    // Every other ACCEPT in the group is refused now, ours or theirs.
    let before = fx.ledger.verify_audit().unwrap();
    assert!(matches!(fx.accept_in(1), Err(LedgerError::GroupClosed)));
    assert!(matches!(fx.accept_out(2), Err(LedgerError::GroupClosed)));
    assert_eq!(fx.ledger.verify_audit().unwrap(), before);
    assert_eq!(fx.agreed(), 1);
    // The group rule must withdraw the two others.
    let losers = fx.ledger.group_losers().unwrap();
    assert_eq!(losers.iter().map(|l| l.deal_id).collect::<Vec<_>>(), {
        let mut v = vec![fx.deals[1].id, fx.deals[2].id];
        v.sort();
        v
    });
    assert!(losers.iter().all(|l| l.winner == fx.deals[0].id));
}

#[test]
fn a_new_counter_releases_our_outstanding_accept_to_another_table() {
    let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 2);
    fx.group();
    fx.counter(0, 31000);
    fx.counter(1, 30500);
    fx.accept_out(0).unwrap();
    assert!(matches!(fx.accept_out(1), Err(LedgerError::GroupClosed)));
    // Seller 0 counters instead of accepting: our ACCEPT no longer binds anything there.
    fx.counter(0, 31500);
    fx.accept_out(1).unwrap();
    fx.accept_in(1).unwrap();
    assert_eq!(fx.deal(1).state, DealState::Agreed);
    assert_eq!(fx.agreed(), 1);
    assert!(matches!(fx.accept_out(0), Err(LedgerError::GroupClosed)));
}

#[test]
fn a_group_withdrawal_is_signed_audited_and_decided_by_the_group_rule() {
    let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 2);
    let group = fx.group();
    fx.counter(0, 31000);
    fx.counter(1, 30500);
    // Not yet: a group with no winner withdraws nothing under the group rule.
    let early = fx.ours(
        1,
        Body::Withdraw {
            reason: ReasonCode::Price,
        },
    );
    assert!(fx.ledger.commit_group_withdraw(&early, 100).is_err());
    fx.accept_out(0).unwrap();
    fx.accept_in(0).unwrap();
    // The winner itself is never withdrawn by the rule.
    let own = fx.ours(
        0,
        Body::Withdraw {
            reason: ReasonCode::Price,
        },
    );
    assert!(fx.ledger.commit_group_withdraw(&own, 100).is_err());
    let verified = fx.ours(
        1,
        Body::Withdraw {
            reason: ReasonCode::Price,
        },
    );
    fx.ledger.commit_group_withdraw(&verified, 101).unwrap();
    assert_eq!(fx.deal(1).state, DealState::Withdrawn);
    assert_eq!(fx.deal(0).state, DealState::Agreed);
    assert!(fx.ledger.group_losers().unwrap().is_empty());
    // The signed WITHDRAW is in the transcript, verifiable like any other message.
    fx.ledger.verify_transcript(fx.deals[1].id).unwrap();
    let steps = fx.ledger.deal_transcript(fx.deals[1].id).unwrap();
    assert_eq!(
        steps.last().map(|s| s.typ),
        Some(table_core::TranscriptType::Withdraw)
    );
    let detail: String = fx
        .ledger
        .conn
        .query_row(
            "SELECT detail_json FROM audit_log WHERE action='group.withdrawn' AND deal_id=?1",
            [fx.deals[1].id.to_string()],
            |r| r.get(0),
        )
        .unwrap();
    let detail: serde_json::Value = serde_json::from_str(&detail).unwrap();
    assert_eq!(detail["decided_by"], GROUP_RULE);
    assert_eq!(detail["winner"], fx.deals[0].id.to_string());
    assert_eq!(detail["group_id"], group.id.to_string());
    fx.ledger.verify_audit().unwrap();
    // No PayPal call anywhere in the group's story.
    let calls: i64 = fx
        .ledger
        .conn
        .query_row("SELECT COUNT(*) FROM paypal_calls", [], |r| r.get(0))
        .unwrap();
    assert_eq!(calls, 0);
}

#[test]
fn grouping_takes_only_open_buyer_tables_for_one_item_under_one_mandate() {
    let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 3);
    let ids: Vec<DealId> = fx.deals.iter().map(|d| d.id).collect();
    // One table is no group; nine are too many; a table twice is refused.
    for tables in [
        vec![ids[0]],
        vec![ids[0], ids[0]],
        std::iter::repeat_n(ids[0], 9).collect::<Vec<_>>(),
    ] {
        assert!(
            fx.ledger
                .open_group(fresh::<GroupId>(), &tables, 100)
                .is_err()
        );
    }
    // A table already holding our ACCEPT cannot join a group.
    fx.counter(0, 31000);
    fx.accept_out(0).unwrap();
    assert!(fx.ledger.open_group(fresh::<GroupId>(), &ids, 100).is_err());
    let group = fx
        .ledger
        .open_group(fresh::<GroupId>(), &ids[1..], 100)
        .unwrap();
    // A table joins one group, once.
    assert!(
        fx.ledger
            .open_group(fresh::<GroupId>(), &[ids[1], ids[0]], 100)
            .is_err()
    );
    assert_eq!(fx.ledger.deal_groups().unwrap(), vec![group]);
    assert_eq!(actions(&fx.ledger, "group.opened"), 2);
}

#[test]
fn the_schema_refuses_a_second_agreement_and_any_rewrite_of_a_group() {
    let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 2);
    let group = fx.group();
    let (a, b) = (fx.deals[0].id.to_string(), fx.deals[1].id.to_string());
    let conn = &fx.ledger.conn;
    // No grouped deal reaches AGREED unless it is the group's winner.
    assert!(
        conn.execute("UPDATE deals SET state='AGREED' WHERE id=?1", [&a])
            .is_err()
    );
    // A winner must be one of the group's tables.
    assert!(
        conn.execute(
            "UPDATE deal_groups SET winner='00000000000000000000000009' WHERE id=?1",
            [group.id.to_string()],
        )
        .is_err()
    );
    conn.execute(
        "UPDATE deal_groups SET winner=?1 WHERE id=?2",
        [&a, &group.id.to_string()],
    )
    .unwrap();
    conn.execute("UPDATE deals SET state='AGREED' WHERE id=?1", [&a])
        .unwrap();
    assert!(
        conn.execute("UPDATE deals SET state='AGREED' WHERE id=?1", [&b])
            .is_err()
    );
    // Won once; never deleted; a table never leaves or changes its group.
    assert!(
        conn.execute(
            "UPDATE deal_groups SET winner=?1 WHERE id=?2",
            [&b, &group.id.to_string()],
        )
        .is_err()
    );
    assert!(conn.execute("DELETE FROM deal_groups", []).is_err());
    assert!(
        conn.execute("UPDATE deals SET group_id=NULL WHERE id=?1", [&b])
            .is_err()
    );
}

#[test]
fn every_ordering_of_accepts_and_counters_leaves_at_most_one_table_agreed() {
    // A small deterministic generator over arrival orders: counters, our ACCEPTs and theirs on
    // three tables. Whatever the order, the group never holds two agreements.
    let mut state = 0x2545_f491_4f6c_dd1d_u64;
    let mut next = |n: u64| {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state % n
    };
    let mut agreements = 0;
    for _ in 0..60 {
        let mut fx = Fixture::new(Ledger::in_memory().unwrap(), 3);
        fx.group();
        for n in 0..3 {
            fx.counter(n, 30000 + 100 * n as i64);
        }
        for _ in 0..12 {
            let n = next(3) as usize;
            if fx.deal(n).state != DealState::Negotiating {
                continue;
            }
            match next(3) {
                0 => {
                    let _ = fx.accept_out(n);
                }
                1 => {
                    let _ = fx.accept_in(n);
                }
                _ => {
                    // A fresh counter only lands while nobody accepted on this table.
                    if fx
                        .ledger
                        .negotiation_status(fx.deals[n].id)
                        .unwrap()
                        .is_some_and(|s| !s.own_accept)
                    {
                        fx.counter(n, 31000 + next(500) as i64);
                    }
                }
            }
            assert!(fx.agreed() <= 1);
        }
        agreements += fx.agreed();
        fx.ledger.verify_audit().unwrap();
    }
    assert!(agreements > 0, "the generator reaches agreements");
}

/// A file-backed ledger opened twice: two connections, as two concurrent writers would be.
struct TempLedger(std::path::PathBuf);
impl TempLedger {
    fn new() -> Self {
        let mut name = [0; 8];
        getrandom::fill(&mut name).unwrap();
        let file = format!(
            "table-groups-{}.sqlite",
            name.iter().map(|b| format!("{b:02x}")).collect::<String>()
        );
        Self(std::env::temp_dir().join(file))
    }
    fn open(&self) -> Ledger {
        Ledger::open(&self.0).unwrap()
    }
}
impl Drop for TempLedger {
    fn drop(&mut self) {
        for suffix in ["", "-journal", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", self.0.display()));
        }
    }
}

#[test]
fn two_agreeing_accepts_racing_on_two_connections_make_exactly_one_agreement() {
    for round in 0..12 {
        let file = TempLedger::new();
        let mut fx = Fixture::new(file.open(), 2);
        fx.group();
        // We offer on both tables and both sellers accept: either of our ACCEPTs now agrees.
        fx.offer(0, 30000);
        fx.offer(1, 30000);
        fx.accept_in(0).unwrap();
        fx.accept_in(1).unwrap();
        assert_eq!(fx.agreed(), 0);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let mut jobs = Vec::new();
        for n in [0_usize, 1] {
            let mut ledger = file.open();
            let deal = ledger.get_deal(fx.deals[n].id).unwrap();
            let verified = signed_by(
                &ledger,
                &fx.own,
                &deal,
                &fx.sellers[n],
                accept_body(&ledger, deal.id),
            );
            let barrier = barrier.clone();
            jobs.push(std::thread::spawn(move || {
                barrier.wait();
                ledger.commit_negotiation(&verified, Direction::Outbound, None, None, 100)
            }));
        }
        let results: Vec<_> = jobs.into_iter().map(|j| j.join().unwrap()).collect();
        let ok = results.iter().filter(|r| r.is_ok()).count();
        assert_eq!(ok, 1, "round {round}: {results:?}");
        assert!(
            results
                .iter()
                .any(|r| matches!(r, Err(LedgerError::GroupClosed))),
            "round {round}: {results:?}"
        );
        let ledger = file.open();
        let agreed = fx
            .deals
            .iter()
            .filter(|d| ledger.get_deal(d.id).unwrap().state == DealState::Agreed)
            .count();
        assert_eq!(agreed, 1);
        assert_eq!(actions(&ledger, "group.won"), 1);
        ledger.verify_audit().unwrap();
    }
}

#[test]
fn two_inbound_accepts_racing_on_two_connections_make_exactly_one_agreement() {
    for round in 0..12 {
        let file = TempLedger::new();
        let mut fx = Fixture::new(file.open(), 2);
        fx.group();
        // Table 0: we accepted seller 0's counter. Table 1: we offered. Both sellers' ACCEPTs
        // arrive at once; only table 0 can agree, and table 1's ACCEPT never makes a second one.
        fx.counter(0, 31000);
        fx.accept_out(0).unwrap();
        fx.offer(1, 30000);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let mut jobs = Vec::new();
        for n in [0_usize, 1] {
            let mut ledger = file.open();
            let deal = ledger.get_deal(fx.deals[n].id).unwrap();
            let peer = &fx.sellers[n];
            let e = Envelope {
                v: 1,
                typ: MsgType::Accept,
                deal_id: deal.id,
                seq: ledger.next_sequence(deal.id, Direction::Inbound).unwrap(),
                prev: deal.transcript_head,
                iss: peer.key_id().unwrap(),
                aud: fx.own.key_id().unwrap(),
                iat: 100,
                exp: 700,
                nonce: nonce(),
                body: accept_body(&ledger, deal.id),
            };
            let raw = peer.sign(&e).unwrap();
            let barrier = barrier.clone();
            jobs.push(std::thread::spawn(move || {
                barrier.wait();
                let verified = ledger.preview_inbound(deal.id, &raw, 100)?;
                ledger.commit_negotiation(&verified, Direction::Inbound, None, None, 100)
            }));
        }
        let results: Vec<_> = jobs.into_iter().map(|j| j.join().unwrap()).collect();
        assert!(results[0].is_ok(), "round {round}: {results:?}");
        let ledger = file.open();
        assert_eq!(
            ledger.get_deal(fx.deals[0].id).unwrap().state,
            DealState::Agreed
        );
        assert_ne!(
            ledger.get_deal(fx.deals[1].id).unwrap().state,
            DealState::Agreed
        );
        assert_eq!(actions(&ledger, "group.won"), 1);
        ledger.verify_audit().unwrap();
    }
}
