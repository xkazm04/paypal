//! Subscription rescue through the shell: the privileged replay, the owner's decision bound to
//! its checklist, the Rescue read, the attention card and the scheduler's PAID read.
use super::*;
use table_paypal::{
    ApiResponse, Dispute, DisputeList, Error as PaypalError, Invoice, InvoiceList, InvoiceRequest,
    Observation, ReportingWindow, RequestId, ResourceId, RevisedSubscription, SecondaryApi,
    Subscription, TransactionPage,
};

#[derive(Debug, Default)]
struct Book {
    status: &'static str,
    amount: Option<Value>,
    reference: String,
    number: String,
    posts: Vec<String>,
    /// The send request is lost before PayPal sees it.
    lose_send: bool,
    /// What a subscription read answers (None: PayPal does not answer), and how many were made.
    subscription: Option<Value>,
    subscription_reads: Vec<String>,
}
#[derive(Debug, Default)]
struct Invoicing(Mutex<Book>);
fn seen(method: &'static str, path: &str, id: &str, body: Value) -> Observation {
    Observation {
        method,
        path: path.into(),
        request_id: id.into(),
        status: 200,
        body,
        binding: None,
    }
}
impl Invoicing {
    fn wire(&self) -> Value {
        let b = self.0.lock().unwrap();
        json!({"id":"INV-1","status":b.status,"amount":b.amount,"detail":{"reference":b.reference,"invoice_number":b.number}})
    }
}
#[async_trait]
impl SecondaryApi for Invoicing {
    async fn create_invoice(
        &self,
        r: &InvoiceRequest,
        id: &RequestId,
    ) -> Result<ApiResponse<Invoice>, PaypalError> {
        let body = r.body()?;
        {
            let mut b = self.0.lock().unwrap();
            b.posts.push(id.as_str().into());
            b.status = "DRAFT";
            b.amount = Some(body["items"][0]["unit_amount"].clone());
            b.reference = body["detail"]["reference"].as_str().unwrap().into();
            b.number = body["detail"]["invoice_number"].as_str().unwrap().into();
        }
        let wire = self.wire();
        Ok(ApiResponse {
            value: serde_json::from_value(wire.clone()).unwrap(),
            observations: vec![seen("POST", "/v2/invoicing/invoices", id.as_str(), wire)],
        })
    }
    async fn send_invoice(
        &self,
        _: &ResourceId,
        id: &RequestId,
    ) -> Result<ApiResponse<()>, PaypalError> {
        let mut b = self.0.lock().unwrap();
        b.posts.push(id.as_str().into());
        if b.lose_send {
            return Err(PaypalError::Unknown {
                observations: vec![seen(
                    "POST",
                    "/v2/invoicing/invoices/INV-1/send",
                    id.as_str(),
                    Value::Null,
                )],
            });
        }
        b.status = "SENT";
        Ok(ApiResponse {
            value: (),
            observations: vec![seen(
                "POST",
                "/v2/invoicing/invoices/INV-1/send",
                id.as_str(),
                Value::Null,
            )],
        })
    }
    async fn get_invoice(&self, _: &ResourceId) -> Result<ApiResponse<Invoice>, PaypalError> {
        let wire = self.wire();
        Ok(ApiResponse {
            value: serde_json::from_value(wire.clone()).unwrap(),
            observations: vec![seen("GET", "/v2/invoicing/invoices/INV-1", "", wire)],
        })
    }
    async fn search_invoices(&self, _: &str) -> Result<ApiResponse<InvoiceList>, PaypalError> {
        Err(PaypalError::Invalid)
    }
    async fn get_subscription(
        &self,
        id: &ResourceId,
    ) -> Result<ApiResponse<Subscription>, PaypalError> {
        let mut b = self.0.lock().unwrap();
        b.subscription_reads.push(id.as_str().into());
        let mut wire = b.subscription.clone().ok_or(PaypalError::Invalid)?;
        wire["id"] = json!(id.as_str());
        let path = format!("/v1/billing/subscriptions/{}", id.as_str());
        Ok(ApiResponse {
            value: serde_json::from_value(wire.clone()).unwrap(),
            observations: vec![seen("GET", &path, "", wire)],
        })
    }
    async fn suspend_subscription(
        &self,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, PaypalError> {
        panic!("rescue never suspends")
    }
    async fn activate_subscription(
        &self,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, PaypalError> {
        panic!("rescue never activates")
    }
    async fn revise_subscription(
        &self,
        _: &ResourceId,
        _: &ResourceId,
        _: &RequestId,
    ) -> Result<ApiResponse<RevisedSubscription>, PaypalError> {
        panic!("rescue never revises")
    }
    async fn capture_outstanding(
        &self,
        _: &ResourceId,
        _: Money,
        _: &RequestId,
    ) -> Result<ApiResponse<()>, PaypalError> {
        panic!("rescue never captures")
    }
    async fn transactions(
        &self,
        _: ReportingWindow,
    ) -> Result<ApiResponse<TransactionPage>, PaypalError> {
        Err(PaypalError::Invalid)
    }
    async fn list_disputes(&self) -> Result<ApiResponse<DisputeList>, PaypalError> {
        Err(PaypalError::Invalid)
    }
    async fn get_dispute(&self, _: &ResourceId) -> Result<ApiResponse<Dispute>, PaypalError> {
        Err(PaypalError::Invalid)
    }
}

fn usd(minor: i64) -> Money {
    Money::new(minor, Currency::USD).unwrap()
}
fn rescue_clauses() -> Vec<Clause> {
    vec![
        Clause::Roles {
            roles: vec![Role::Rescue],
        },
        Clause::Counterparties {
            rule: CpRule::Subscribers,
        },
        Clause::PerDeal {
            kind: DealKind::Rescue,
            max_amount: usd(5000),
            categories: vec![Category::Service],
        },
        Clause::Velocity {
            max_deals_day: 10,
            max_total_day: usd(50_000),
        },
        Clause::HumanPresentOver { amount: usd(0) },
        Clause::Payees {
            payees: vec![PayeeRef::new("shop-merchant").unwrap()],
        },
        Clause::Lever {
            levers: vec![RescueLever::DiscountThisCycle],
            max_discount_bp: 2000,
            max_discount: usd(500),
        },
    ]
}
fn replay_args() -> RescueReplayArgs {
    RescueReplayArgs {
        subscription_id: "I-S14".into(),
        subscriber_email: "subscriber14@example.com".into(),
        plan: ItemRef::new("care-plan").unwrap(),
        amount: usd(1200),
    }
}
fn with_invoicing(r: &mut Runtime) -> Arc<Invoicing> {
    let api = Arc::new(Invoicing::default());
    r.secondary = Some(api.clone());
    r.pipeline.set_secondary(Some(api.clone()));
    api
}

#[tokio::test]
async fn no_rescue_rules_refuses_the_replay_in_plain_words_and_writes_nothing() {
    let (mut r, ..) = runtime(true);
    let token = unlock_runtime(&mut r);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::RescueReplay(replay_args()),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::rescue::NO_RESCUE_RULES);
    assert!(r.pipeline.wallet.ledger.list_deals().unwrap().is_empty());
}

#[tokio::test]
async fn a_replayed_renewal_is_fixed_only_on_the_owners_bound_decision_and_never_counts() {
    let (mut r, vault, ..) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Assistant,
        clauses: rescue_clauses(),
        not_before: 0,
        expires: 10_000_000,
    })
    .unwrap();
    let token = r.pipeline.approval.token("approval").unwrap().to_owned();
    // Main, the Tumbler and an approval window without its token cannot record one; nor a locked
    // approval window.
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        let error = r
            .execute(who, Action::RescueReplay(replay_args()))
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    }
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::RescueReplay(replay_args()),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Locked), "{error:?}");
    let token = unlock_runtime(&mut r);
    let mut bad = replay_args();
    bad.subscriber_email = "not an email".into();
    assert!(
        r.execute(caller("approval", Some(&token)), Action::RescueReplay(bad))
            .await
            .is_err()
    );
    let deal: Deal = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::RescueReplay(replay_args()),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (deal.state, deal.mode, deal.terms.unit_price),
        (DealState::Agreed, Mode::Replay, usd(960))
    );
    assert_eq!(r.selected, Some(deal.id));
    // The card asks for the owner and never carries the subscriber's address.
    let snapshot = r.attention().unwrap();
    let item = snapshot
        .items
        .iter()
        .find(|i| i.deal_id == deal.id)
        .unwrap();
    assert_eq!(item.headline, "Approve rescue lever 9.60 USD");
    assert_eq!(item.on_silence, table_attention::RESCUE_SILENCE);
    assert!(
        !serde_json::to_string(&snapshot)
            .unwrap()
            .contains("subscriber14")
    );
    // The Rescue read: main and approval, masked; never the Tumbler.
    assert!(
        r.execute(caller("tumbler", None), Action::RescueBook)
            .await
            .is_err()
    );
    let book: RescueBook = serde_json::from_value(
        r.execute(caller("main", None), Action::RescueBook)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(book.cases.len(), 1);
    assert_eq!(book.cases[0].recipient, "s•••@example.com");
    assert!(
        book.cases[0]
            .text
            .note
            .contains("9.60 USD instead of 12.00 USD")
    );
    assert!(book.recovered.is_empty());
    // The summary offers the decision, with the fixed wording, and nothing failing.
    let summary = r.summary(deal.id).unwrap();
    assert!(summary.can_release, "{:?}", summary.unavailable_reason);
    assert_eq!(
        summary.rescue.as_ref().unwrap().source,
        RescueSource::Replay
    );
    assert!(
        summary
            .checks
            .iter()
            .all(|c| c.status != ApprovalCheckStatus::Fail)
    );
    // A decision on a checklist the owner did not see sends nothing.
    let mut stale = decision(&mut r, deal.id);
    stale.checks_hash = Some(H256::ZERO);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(stale, Decision::Rescue),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, SUMMARY_CHANGED);
    assert!(paypal.0.lock().unwrap().posts.is_empty());
    // The owner's decision creates and sends the one invoice.
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Rescue),
    )
    .await
    .unwrap();
    assert_eq!(
        paypal.0.lock().unwrap().posts,
        vec![
            format!("{}-1-invoice-create", deal.id),
            format!("{}-1-invoice-send", deal.id)
        ]
    );
    let deal_now = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
    assert_eq!(deal_now.state, DealState::AwaitingApproval);
    assert!(!r.summary(deal.id).unwrap().can_release);
    // The scheduler reads PAID back; the receipt is signed; a replay never counts.
    paypal.0.lock().unwrap().status = "PAID";
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Receipted
    );
    let book = r.rescue_book().unwrap();
    assert!(!book.cases[0].counted);
    assert!(book.recovered.is_empty());
    assert_eq!(paypal.0.lock().unwrap().posts.len(), 2);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// A replayed renewal's fix, signed rules in place, ready for the owner's decision.
async fn rescue_ready(r: &mut Runtime) -> (Deal, String) {
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Assistant,
        clauses: rescue_clauses(),
        not_before: 0,
        expires: 10_000_000,
    })
    .unwrap();
    let token = unlock_runtime(r);
    let deal: Deal = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::RescueReplay(replay_args()),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    (deal, token)
}

/// A fix whose one send closed not done (its invoice still a draft) is refused in plain words on
/// a fresh decision, before the owner's decision row or anything else is written. It used to
/// write the decision row and then fail on the ledger's unique request id.
#[tokio::test]
async fn a_fix_whose_send_ended_is_refused_in_plain_words_and_writes_nothing() {
    let (mut r, vault, _, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    let (deal, token) = rescue_ready(&mut r).await;
    paypal.0.lock().unwrap().lose_send = true;
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Rescue),
        )
        .await
        .is_err()
    );
    // The lost send is read back as not done and closed; the fix stays SETTLING, a draft.
    let open = r
        .pipeline
        .wallet
        .ledger
        .open_operations(Some(deal.id), i64::MAX)
        .unwrap();
    r.pipeline
        .wallet
        .ledger
        .record_resolution(table_ledger::Resolution {
            id: deal.id,
            request_id: &open[0].request_id,
            observed: "DRAFT",
            outcome: table_ledger::ResolutionOutcome::Absent,
            calls: &[],
            refs: None,
            event: None,
            at: clock.now(),
        })
        .unwrap();
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Settling
    );
    paypal.0.lock().unwrap().lose_send = false;
    // The approval window no longer offers it.
    assert!(!r.summary(deal.id).unwrap().can_release);
    let posts = paypal.0.lock().unwrap().posts.len();
    let audit = r.pipeline.wallet.ledger.audit_count().unwrap();
    let args = decision(&mut r, deal.id);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Rescue),
        )
        .await
        .unwrap_err();
    assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    assert_eq!(error.message, crate::rescue::RESCUE_ENDED);
    assert_eq!(r.pipeline.wallet.ledger.audit_count().unwrap(), audit);
    assert_eq!(paypal.0.lock().unwrap().posts.len(), posts);
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// The rescue rules revoked while a fix's send is unknown: with no agent key the send is still
/// read back, and at PayPal's retry the draft closes not done and the fix expires. Before, the
/// tick returned at once, the rescue stayed open and refused every later one for the
/// subscription. A sent invoice waits for the key instead: PAID needs the signed receipt.
#[tokio::test]
async fn a_revoked_rescue_mandate_still_lets_an_unsent_fix_expire_and_never_signs_paid() {
    let (mut r, vault, _, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    let (deal, token) = rescue_ready(&mut r).await;
    paypal.0.lock().unwrap().lose_send = true;
    let args = decision(&mut r, deal.id);
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::Decision(args, Decision::Rescue),
        )
        .await
        .is_err()
    );
    assert!(r.pipeline.has_open_operation(deal.id).unwrap());
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, clock.now())
        .unwrap();
    assert!(r.select_signer(deal.id).is_err());
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    clock.0.store(due + 1, Ordering::SeqCst);
    r.tick().await.unwrap();
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        DealState::Expired
    );
    assert!(!r.pipeline.has_open_operation(deal.id).unwrap());
    assert!(!r.pipeline.signer_missing);
    let sent = {
        let b = paypal.0.lock().unwrap();
        (b.status, b.posts.len())
    };
    assert_eq!(sent, ("DRAFT", 2));

    // Sent, then the rules revoked and the invoice paid: nothing is signed without the key, and
    // a paid invoice is never expired unread.
    let (mut r, vault, _, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    let (deal, token) = rescue_ready(&mut r).await;
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Rescue),
    )
    .await
    .unwrap();
    r.pipeline
        .wallet
        .ledger
        .revoke_mandate(deal.mandate_id, clock.now())
        .unwrap();
    paypal.0.lock().unwrap().status = "PAID";
    let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
    for at in [clock.now() + 120, due + 1] {
        clock.0.store(at, Ordering::SeqCst);
        r.tick().await.unwrap();
        assert_eq!(
            r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
            DealState::AwaitingApproval
        );
    }
    assert_eq!(paypal.0.lock().unwrap().posts.len(), 2);
}

fn watch_args(id: &str) -> RescueWatchArgs {
    RescueWatchArgs {
        subscription_id: id.into(),
        subscriber_email: "watched@example.com".into(),
        plan: ItemRef::new("care-plan").unwrap(),
    }
}
fn failing(failed: u32, owed: &str) -> Value {
    json!({"id":"","status":"ACTIVE","plan_id":"P-1","billing_info":{"outstanding_balance":{"currency_code":"USD","value":owed},"failed_payments_count":failed}})
}

/// The owner's watch list in the approval window, and the scheduler's read of it: a real failed
/// renewal opens one PayPal-reported fix that waits for the owner, and once the owner approves it
/// and PayPal shows the invoice paid, it counts as recovered. Detection itself only reads.
#[tokio::test]
async fn a_watched_failed_renewal_opens_one_fix_that_counts_only_once_the_owner_approves_and_it_is_paid()
 {
    let (mut r, vault, _, clock, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    // Without rescue rules the watch is refused in plain words and nothing is written.
    let token = unlock_runtime(&mut r);
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::RescueWatchAdd(watch_args("I-W1")),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::rescue::NO_RESCUE_RULES);
    assert!(
        r.pipeline
            .wallet
            .ledger
            .rescue_watches()
            .unwrap()
            .is_empty()
    );
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Assistant,
        clauses: rescue_clauses(),
        not_before: 0,
        expires: 10_000_000,
    })
    .unwrap();
    // Owner configuration: never Main or the Tumbler, never without the token.
    for who in [
        caller("main", Some(&token)),
        caller("tumbler", Some(&token)),
        caller("approval", None),
    ] {
        let error = r
            .execute(who, Action::RescueWatchAdd(watch_args("I-W1")))
            .await
            .unwrap_err();
        assert!(matches!(error.code, ErrorCode::Permission), "{error:?}");
    }
    let token = unlock_runtime(&mut r);
    let mut bad = watch_args("I-W1");
    bad.subscriber_email = "not an email".into();
    assert!(
        r.execute(
            caller("approval", Some(&token)),
            Action::RescueWatchAdd(bad)
        )
        .await
        .is_err()
    );
    let list: Vec<RescueWatchView> = serde_json::from_value(
        r.execute(
            caller("approval", Some(&token)),
            Action::RescueWatchAdd(watch_args("I-W1")),
        )
        .await
        .unwrap(),
    )
    .unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(
        (list[0].state, list[0].recipient.as_str()),
        (RescueWatchState::Waiting, "w•••@example.com")
    );
    assert!(paypal.0.lock().unwrap().subscription_reads.is_empty());
    // The scheduler reads it: one failed payment opens the one fix, from a GET alone.
    paypal.0.lock().unwrap().subscription = Some(failing(1, "12.00"));
    r.tick().await.unwrap();
    let deals = r.pipeline.wallet.ledger.list_deals().unwrap();
    assert_eq!(deals.len(), 1);
    let deal = deals[0].clone();
    assert_eq!(
        (deal.kind, deal.state, deal.mode, deal.terms.unit_price),
        (DealKind::Rescue, DealState::Agreed, Mode::Sandbox, usd(960))
    );
    assert!(paypal.0.lock().unwrap().posts.is_empty());
    let book = r.rescue_book().unwrap();
    assert_eq!(book.cases[0].source, RescueSource::Paypal);
    assert_eq!(book.watching[0].state, RescueWatchState::FixOpened);
    assert_eq!(
        (book.watch_reads_today, book.watch_reads_max),
        (1, table_core::RESCUE_WATCH_READS_DAY)
    );
    // Not due again until the cadence; then read again, and the same failure opens nothing more.
    r.tick().await.unwrap();
    assert_eq!(paypal.0.lock().unwrap().subscription_reads.len(), 1);
    clock.0.store(
        clock.now() + table_core::RESCUE_WATCH_READ_SECS,
        Ordering::SeqCst,
    );
    r.tick().await.unwrap();
    assert_eq!(paypal.0.lock().unwrap().subscription_reads.len(), 2);
    assert_eq!(r.pipeline.wallet.ledger.list_deals().unwrap().len(), 1);
    assert!(paypal.0.lock().unwrap().posts.is_empty());
    // The owner opens it from The Table and approves the fix; PayPal shows it paid; it counts,
    // being PayPal-reported.
    r.execute(
        caller("main", None),
        Action::OpenApproval(ApprovalOpenArgs {
            deal_id: Some(deal.id),
            pairing: None,
            target: None,
            draft: None,
        }),
    )
    .await
    .unwrap();
    let token = unlock_runtime(&mut r);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Rescue),
    )
    .await
    .unwrap();
    assert_eq!(paypal.0.lock().unwrap().posts.len(), 2);
    paypal.0.lock().unwrap().status = "PAID";
    r.tick().await.unwrap();
    let book = r.rescue_book().unwrap();
    assert!(book.cases[0].counted);
    assert_eq!(book.recovered, vec![usd(960)]);
    // The Rewind keeps the watch rows out of the deal's steps; the chain verifies.
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

/// The watch pass keeps to its budget: a few reads a tick, none while agents are paused, none of
/// a subscription no longer watched, and never a write at PayPal.
#[tokio::test]
async fn the_watch_pass_reads_a_few_a_tick_never_while_paused_and_never_writes() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    r.sign_mandate(MandateSignArgs {
        id: None,
        agent: AgentSlot::Assistant,
        clauses: rescue_clauses(),
        not_before: 0,
        expires: 10_000_000,
    })
    .unwrap();
    let token = unlock_runtime(&mut r);
    for id in ["I-A", "I-B", "I-C"] {
        r.execute(
            caller("approval", Some(&token)),
            Action::RescueWatchAdd(watch_args(id)),
        )
        .await
        .unwrap();
    }
    paypal.0.lock().unwrap().subscription = Some(failing(0, "0.00"));
    r.paused = true;
    r.tick().await.unwrap();
    assert!(paypal.0.lock().unwrap().subscription_reads.is_empty());
    r.paused = false;
    r.tick().await.unwrap();
    assert_eq!(
        paypal.0.lock().unwrap().subscription_reads.len(),
        table_core::RESCUE_WATCH_PER_TICK
    );
    // The third is read on the next tick, unless the owner stopped watching it.
    r.execute(
        caller("approval", Some(&token)),
        Action::RescueWatchStop(RescueWatchStopArgs {
            subscription_id: "I-C".into(),
        }),
    )
    .await
    .unwrap();
    r.tick().await.unwrap();
    assert_eq!(
        paypal.0.lock().unwrap().subscription_reads,
        vec!["I-A".to_owned(), "I-B".to_owned()]
    );
    let error = r
        .execute(
            caller("approval", Some(&token)),
            Action::RescueWatchStop(RescueWatchStopArgs {
                subscription_id: "I-C".into(),
            }),
        )
        .await
        .unwrap_err();
    assert_eq!(error.message, crate::rescue::NOT_WATCHED);
    let book = r.rescue_book().unwrap();
    assert_eq!(book.watching.len(), 2);
    assert!(
        book.watching
            .iter()
            .all(|w| w.state == RescueWatchState::Paid)
    );
    assert!(r.pipeline.wallet.ledger.list_deals().unwrap().is_empty());
    assert!(paypal.0.lock().unwrap().posts.is_empty());
}

/// A REPLAY of a watched subscription never counts, and is not the watch's fix: the replay stays
/// what it was, and the watch still opens nothing while that replay's fix is live.
#[tokio::test]
async fn a_replay_of_a_watched_subscription_still_never_counts() {
    let (mut r, vault, _, _, _) = runtime(true);
    credentials(vault.as_ref());
    let paypal = with_invoicing(&mut r);
    let (deal, token) = rescue_ready(&mut r).await;
    r.execute(
        caller("approval", Some(&token)),
        Action::RescueWatchAdd(watch_args("I-S14")),
    )
    .await
    .unwrap();
    paypal.0.lock().unwrap().subscription = Some(failing(1, "12.00"));
    r.tick().await.unwrap();
    assert_eq!(paypal.0.lock().unwrap().subscription_reads.len(), 1);
    // The replay's fix is live, so no second fix opens for the same subscription.
    assert_eq!(r.pipeline.wallet.ledger.list_deals().unwrap().len(), 1);
    let book = r.rescue_book().unwrap();
    assert_eq!(book.watching[0].state, RescueWatchState::FailedNoFix);
    let args = decision(&mut r, deal.id);
    r.execute(
        caller("approval", Some(&token)),
        Action::Decision(args, Decision::Rescue),
    )
    .await
    .unwrap();
    paypal.0.lock().unwrap().status = "PAID";
    r.tick().await.unwrap();
    let book = r.rescue_book().unwrap();
    assert_eq!(book.cases[0].source, RescueSource::Replay);
    assert!(!book.cases[0].counted);
    assert!(book.recovered.is_empty());
}
