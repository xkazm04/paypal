//! Shop around (T8) in the runtime: the owner groups tables in main, the group agrees once, the
//! group rule withdraws the others with signed WITHDRAWs, a refused second ACCEPT (agent or owner)
//! makes no PayPal call, and the daily budget and wallet limits count the group once.
use super::*;
use table_app::AgentService;

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
/// A buyer wallet with `n` open tables for the same monitor, each with its own paired seller,
/// under one signed buyer mandate, each priced against a market reference so the shield passes.
struct Shop {
    r: Runtime,
    http: Arc<OfflineHttp>,
    tables: Vec<(Deal, AgentSigner)>,
}
fn shop(n: usize, clauses: Vec<Clause>) -> Shop {
    let (mut r, _, http, _, _) = runtime(true);
    let mandate = r
        .sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses,
            not_before: 0,
            expires: 1_000_000,
        })
        .unwrap();
    let mut tables = Vec::new();
    for i in 0..n {
        let peer = AgentSigner::from_key(signing_key(&MemoryVault::default(), "peer").unwrap());
        r.pipeline
            .wallet
            .ledger
            .insert_counterparty(&Counterparty {
                key_id: peer.key_id().unwrap(),
                owner_key: peer.public_key().to_bytes(),
                agent_key: peer.public_key().to_bytes(),
                display_name: ShortText::new(format!("Seller {i}")).unwrap(),
                paired_via: PairedVia::Code,
                words_confirmed_at: Some(100),
                declared_payee: PayeeRef::new("merchant").unwrap(),
                first_seen: 0,
            })
            .unwrap();
        let deal = r
            .create_deal(DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty: peer.key_id().unwrap(),
                mandate_id: mandate.payload.id,
                mandate_version: 1,
                category: Category::Parts,
                terms: Terms {
                    item_ref: ItemRef::new("monitor").unwrap(),
                    qty: 1,
                    unit_price: usd(1200),
                    currency: Currency::USD,
                    delivery: Delivery::DigitalNow,
                },
            })
            .unwrap();
        r.pipeline
            .wallet
            .ledger
            .store_market_reference(
                deal.id,
                &MarketRef::from_comparables(
                    vec![usd(1200), usd(1300), usd(1600)],
                    100,
                    H256::ZERO,
                )
                .unwrap(),
                100,
            )
            .unwrap();
        tables.push((deal, peer));
    }
    Shop { r, http, tables }
}
impl Shop {
    fn id(&self, n: usize) -> DealId {
        self.tables[n].0.id
    }
    fn deal(&self, n: usize) -> Deal {
        self.r.pipeline.wallet.ledger.get_deal(self.id(n)).unwrap()
    }
    /// Seller `n`'s signed message, delivered as the relay would (`receive_relay`).
    fn by_seller(&mut self, n: usize, body: Body) -> Result<(), table_app::Error> {
        let raw = self.seller_raw(n, body);
        self.r
            .pipeline
            .wallet
            .receive_relay(self.id(n), &raw, Category::Parts, 100)
    }
    fn seller_raw(&self, n: usize, body: Body) -> String {
        let deal = self.deal(n);
        let peer = &self.tables[n].1;
        let mut nonce = [0; 16];
        getrandom::fill(&mut nonce).unwrap();
        let e = Envelope {
            v: 1,
            typ: body.typ(),
            deal_id: deal.id,
            seq: self
                .r
                .pipeline
                .wallet
                .ledger
                .next_sequence(deal.id, table_ledger::Direction::Inbound)
                .unwrap(),
            prev: deal.transcript_head,
            iss: peer.key_id().unwrap(),
            aud: table_proto::key_id(&self.r.pipeline.wallet.agent_public_key()).unwrap(),
            iat: 100,
            exp: 700,
            nonce,
            body,
        };
        peer.sign(&e).unwrap()
    }
    /// The seller lists at 12.00 and counters at `price`.
    fn counter(&mut self, n: usize, price: i64) {
        let deal = self.deal(n);
        if deal.state == DealState::Pairing {
            self.by_seller(
                n,
                Body::Listing {
                    item_ref: deal.terms.item_ref.clone(),
                    ask: deal.terms.unit_price,
                    delivery: deal.terms.delivery.clone(),
                },
            )
            .unwrap();
        }
        self.by_seller(
            n,
            Body::Counter {
                price: usd(price),
                delivery: Delivery::DigitalNow,
            },
        )
        .unwrap();
    }
    fn accept_body(&self, n: usize) -> Body {
        let (offer_seq, terms_hash) = self
            .r
            .pipeline
            .wallet
            .ledger
            .pending_offer(self.id(n))
            .unwrap();
        Body::Accept {
            offer_seq,
            terms_hash,
            owner_accept: None,
        }
    }
    fn seller_accepts(&mut self, n: usize) -> Result<(), table_app::Error> {
        let body = self.accept_body(n);
        self.by_seller(n, body)
    }
    /// Our negotiator's `accept_offer`, through the agent service (the MCP tool's path).
    fn agent_accepts(&mut self, n: usize) -> Result<serde_json::Value, table_app::Error> {
        let (offer_seq, _) = self
            .r
            .pipeline
            .wallet
            .ledger
            .pending_offer(self.id(n))
            .unwrap();
        let id = self.id(n);
        self.r.pipeline.wallet.invoke(
            &table_app::AgentScope {
                deal_id: id,
                role: table_app::AgentRole::Negotiator,
                category: Category::Parts,
            },
            table_app::AgentRequest::Accept(table_app::AcceptInput {
                deal_id: id,
                offer_seq,
            }),
            100,
        )
    }
    async fn group(&mut self, tables: &[usize]) -> DealGroupView {
        let deal_ids = tables.iter().map(|n| self.id(*n)).collect();
        let value = self
            .r
            .execute(
                caller("main", None),
                Action::GroupOpen(DealGroupOpenArgs { deal_ids }),
            )
            .await
            .unwrap();
        serde_json::from_value(value).unwrap()
    }
    async fn groups(&mut self) -> Vec<DealGroupView> {
        serde_json::from_value(
            self.r
                .execute(caller("main", None), Action::Groups)
                .await
                .unwrap(),
        )
        .unwrap()
    }
    fn audit(&self, action: &str) -> Vec<table_ledger::AuditRecord> {
        let (rows, _) = self
            .r
            .pipeline
            .wallet
            .ledger
            .history_rows(None, None, None, 4000)
            .unwrap();
        rows.into_iter().filter(|r| r.action == action).collect()
    }
    fn no_paypal(&self) {
        assert!(self.http.0.lock().unwrap().paths.is_empty());
        for (deal, _) in &self.tables {
            assert_eq!(
                self.r
                    .pipeline
                    .wallet
                    .ledger
                    .paypal_call_count(deal.id)
                    .unwrap(),
                0
            );
        }
    }
}

#[tokio::test]
async fn the_group_agrees_once_and_the_group_rule_withdraws_the_rest_signed_and_audited() {
    let mut s = shop(3, clauses(Side::Buyer, DealKind::Haggle));
    let opened = s.group(&[0, 1, 2]).await;
    assert_eq!(opened.tables.len(), 3);
    assert_eq!(opened.winner, None);
    assert_eq!(opened.item_ref.as_str(), "monitor");
    // Each seller bargains on its own table; the third asks more than the owner lets the agent
    // accept alone (clause 6 over 15.00).
    s.counter(0, 1200);
    s.counter(1, 1300);
    s.counter(2, 1600);
    let view = s.groups().await;
    assert_eq!(
        view[0]
            .tables
            .iter()
            .map(|t| t.seller_price.map(|p| p.minor()))
            .collect::<Vec<_>>(),
        vec![Some(1200), Some(1300), Some(1600)]
    );
    // The negotiator accepts seller 0's counter: the group's one outstanding ACCEPT.
    s.agent_accepts(0).unwrap();
    // A second agent ACCEPT in the group is refused before anything is signed or sent, and the
    // refusal is audited like any other refused intent.
    let refused = s.agent_accepts(1).unwrap_err();
    assert!(matches!(
        refused,
        table_app::Error::Ledger(table_ledger::LedgerError::GroupClosed)
    ));
    assert!(matches!(
        CommandError::from(refused).code,
        ErrorCode::Refused
    ));
    assert_eq!(
        s.r.pipeline
            .wallet
            .ledger
            .envelope_count(s.id(1), table_ledger::Direction::Outbound)
            .unwrap(),
        0
    );
    let refusals = s.audit("intent.refused");
    assert_eq!(refusals.len(), 1);
    assert_eq!(refusals[0].detail["layer"], "group");
    assert_eq!(refusals[0].deal_id, Some(s.id(1)));
    // The owner cannot accept table 2 either while table 0 holds the group's ACCEPT: the approval
    // window is not offered it, and a decision sent anyway is REFUSED before any PayPal call.
    let token = unlock_runtime(&mut s.r);
    s.r.selected = Some(s.id(2));
    let summary = s.r.summary(s.id(2)).unwrap();
    assert!(summary.counter_hash.is_some());
    assert!(!summary.can_owner_accept);
    let args = DecisionArgs {
        deal_id: s.id(2),
        attempt: summary.attempt,
        terms_hash: summary.terms_hash,
        counter_hash: summary.counter_hash,
        checks_hash: Some(summary.checks_hash),
    };
    let owner =
        s.r.decide("approval", Some(&token), args, Decision::OwnerAccept)
            .await
            .unwrap_err();
    assert!(matches!(owner.code, ErrorCode::Refused), "{owner:?}");
    // Seller 0 answers: table 0 agrees and wins the group.
    s.seller_accepts(0).unwrap();
    assert_eq!(s.deal(0).state, DealState::Agreed);
    // Seller 1 accepting now is refused by the ledger: the relay rejects the message.
    assert!(matches!(
        s.seller_accepts(1),
        Err(table_app::Error::Ledger(
            table_ledger::LedgerError::GroupClosed
        ))
    ));
    // The tick applies the group rule: every other table gets our signed WITHDRAW.
    s.r.tick().await.unwrap();
    for n in [1, 2] {
        let deal = s.deal(n);
        assert_eq!(deal.state, DealState::Withdrawn);
        s.r.pipeline
            .wallet
            .ledger
            .verify_transcript(deal.id)
            .unwrap();
        let steps = s.r.pipeline.wallet.ledger.deal_transcript(deal.id).unwrap();
        let last = steps.last().unwrap();
        assert_eq!(last.typ, TranscriptType::Withdraw);
        assert_eq!(last.by, TranscriptBy::You);
        // Rewind: the step is the group rule's, never a money call.
        let history =
            s.r.deal_history(DealHistoryArgs {
                deal_id: Some(deal.id),
                from: None,
                to: None,
            })
            .unwrap();
        let step = history
            .steps
            .iter()
            .find(|h| h.kind == HistoryKind::GroupWithdrawn)
            .unwrap();
        assert_eq!(step.authority, HistoryAuthority::GroupRule);
        assert_eq!(step.state_after, Some(DealState::Withdrawn));
        assert_eq!(step.paypal, HistoryPaypal::None);
        assert!(
            !history
                .steps
                .iter()
                .any(|h| h.kind == HistoryKind::WithdrawSent)
        );
    }
    assert_eq!(s.deal(0).state, DealState::Agreed);
    let withdrawn = s.audit("group.withdrawn");
    assert_eq!(withdrawn.len(), 2);
    assert!(
        withdrawn
            .iter()
            .all(|r| r.detail["decided_by"] == table_ledger::GROUP_RULE
                && r.detail["winner"] == s.id(0).to_string())
    );
    assert_eq!(s.audit("group.won").len(), 1);
    // A second tick has nothing left to withdraw.
    s.r.tick().await.unwrap();
    assert_eq!(s.audit("group.withdrawn").len(), 2);
    let view = s.groups().await;
    assert_eq!(view.len(), 1);
    assert_eq!(view[0].winner, Some(s.id(0)));
    assert_eq!(
        view[0]
            .tables
            .iter()
            .map(|t| t.closed_by_group)
            .collect::<Vec<_>>(),
        vec![false, true, true]
    );
    s.r.pipeline.wallet.ledger.verify_audit().unwrap();
    s.no_paypal();
}

#[tokio::test]
async fn the_daily_budget_and_the_wallet_limits_count_the_group_once() {
    // Room for exactly one 12.00 deal today, in the mandate and in the wallet limits.
    let mut c = clauses(Side::Buyer, DealKind::Haggle);
    for clause in &mut c {
        if let Clause::Velocity {
            max_deals_day,
            max_total_day,
        } = clause
        {
            *max_deals_day = 1;
            *max_total_day = usd(1300);
        }
    }
    let mut s = shop(2, c);
    s.r.sign_envelope(EnvelopeSignArgs {
        currency: Currency::USD,
        max_out_day: usd(1300),
        max_held: usd(1300),
        max_deals_day: 1,
        expires: 1_000_000,
    })
    .unwrap();
    s.group(&[0, 1]).await;
    s.counter(0, 1200);
    s.counter(1, 1250);
    // Two open tables reserve nothing: today's budget and the limits are still whole.
    let usage =
        s.r.pipeline
            .wallet
            .ledger
            .usage_for(&s.deal(0), 100)
            .unwrap();
    assert_eq!(usage.deals_today, 0);
    let view = s.r.envelope_view().unwrap();
    assert!(view.currencies.iter().all(|c| c.deals_today == 0));
    // So the group's one agreement fits both, though two tables are open at 12.00 and 12.50.
    s.agent_accepts(0).unwrap();
    s.seller_accepts(0).unwrap();
    assert_eq!(s.deal(0).state, DealState::Agreed);
    s.r.close_groups().unwrap();
    assert_eq!(s.deal(1).state, DealState::Withdrawn);
    // One reservation for the group: one deal, its one amount.
    let view = s.r.envelope_view().unwrap();
    assert_eq!(view.currencies.len(), 1);
    assert_eq!(view.currencies[0].deals_today, 1);
    assert_eq!(view.currencies[0].out_today, usd(1200));
    assert_eq!(view.currencies[0].committed, usd(1200));
    let usage =
        s.r.pipeline
            .wallet
            .ledger
            .usage_for(&s.deal(1), 100)
            .unwrap();
    assert_eq!(usage.deals_today, 1);
    assert_eq!(usage.total_today, usd(1200));
    s.no_paypal();
}

#[tokio::test]
async fn two_seller_accepts_in_one_inbox_pass_make_exactly_one_agreement() {
    let mut s = shop(2, clauses(Side::Buyer, DealKind::Haggle));
    s.group(&[0, 1]).await;
    s.counter(0, 1200);
    s.counter(1, 1250);
    // Our ACCEPT is out on table 0 only (the group allows one).
    s.agent_accepts(0).unwrap();
    // Both sellers' ACCEPTs arrive in the same relay batch pass.
    for n in [0, 1] {
        let id = s.id(n);
        s.r.pipeline
            .wallet
            .ledger
            .bind_relay(id, H256::digest(id.to_string().as_bytes()), 100)
            .unwrap();
    }
    let raws: Vec<String> = [0, 1]
        .iter()
        .map(|n| s.seller_raw(*n, s.accept_body(*n)))
        .collect();
    for (n, raw) in raws.iter().enumerate() {
        s.r.pipeline
            .wallet
            .ledger
            .stage_relay_batch(s.id(n), &"a".repeat(32), 0, std::slice::from_ref(raw))
            .unwrap();
    }
    s.r.start_relay().unwrap();
    assert!(
        s.r.pipeline
            .wallet
            .ledger
            .pending_inbox()
            .unwrap()
            .is_empty()
    );
    assert_eq!(s.deal(0).state, DealState::Agreed);
    // The pass withdrew table 1 at once (the relay applies the group rule after its inbox).
    assert_eq!(s.deal(1).state, DealState::Withdrawn);
    let agreed = (0..2)
        .filter(|n| s.deal(*n).state == DealState::Agreed)
        .count();
    assert_eq!(agreed, 1);
    assert_eq!(s.audit("group.won").len(), 1);
    s.no_paypal();
}

#[tokio::test]
async fn grouping_is_refused_for_tables_that_are_not_one_open_buyer_intent() {
    let mut s = shop(2, clauses(Side::Buyer, DealKind::Haggle));
    let (other, _) = setup(&mut s.r, Side::Buyer);
    // A table under another mandate is not the same buyer intent.
    let refused =
        s.r.execute(
            caller("main", None),
            Action::GroupOpen(DealGroupOpenArgs {
                deal_ids: vec![s.id(0), other.id],
            }),
        )
        .await
        .unwrap_err();
    assert!(matches!(refused.code, ErrorCode::Invalid));
    // One table is no group.
    assert!(
        s.r.execute(
            caller("main", None),
            Action::GroupOpen(DealGroupOpenArgs {
                deal_ids: vec![s.id(0)],
            }),
        )
        .await
        .is_err()
    );
    // Only main groups; the Tumbler and the approval window are refused by the table's row.
    for label in ["tumbler", "approval"] {
        let refused =
            s.r.execute(
                caller(label, None),
                Action::GroupOpen(DealGroupOpenArgs {
                    deal_ids: vec![s.id(0), s.id(1)],
                }),
            )
            .await
            .unwrap_err();
        assert!(matches!(refused.code, ErrorCode::Permission));
    }
    assert!(s.groups().await.is_empty());
    s.group(&[0, 1]).await;
    assert_eq!(s.groups().await.len(), 1);
    s.no_paypal();
}
