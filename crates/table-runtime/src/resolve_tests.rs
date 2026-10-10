//! T10 on the wallet scheduler: a seller capture whose answer was lost is resolved with PayPal
//! by the next tick, before the deal's next step, with no second request id. A seller authorize
//! whose answer was lost and is first read back at the order's deadline is recorded as the hold
//! PayPal shows, under the seller's own rules.
use crate::tests::h5_tests::{money_authorities, owner_ordered, owner_ordered_for};
use crate::tests::*;
use std::sync::atomic::AtomicBool;

/// The offline sandbox client behind a wire that loses the first capture answer, before or
/// after PayPal commits it. The offline HTTP mock has no authorization route and does not
/// record captures on the order, so this layer answers those two reads from what it saw.
struct LosingCapture {
    inner: table_paypal::Client,
    after: bool,
    lose: AtomicBool,
    captured: AtomicBool,
}
#[async_trait]
impl table_paypal::PayPalApi for LosingCapture {
    async fn create_order(
        &self,
        order: &table_paypal::CreateOrder,
        id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.create_order(order, id).await
    }
    async fn get_order(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        let mut r = self.inner.get_order(id).await?;
        if self.captured.load(Ordering::SeqCst) {
            let unit = &mut r.value.purchase_units[0];
            let amount = unit.amount.clone();
            unit.payments.authorizations = vec![table_paypal::Payment {
                id: "AUTH1".into(),
                status: "CAPTURED".into(),
                amount: amount.clone(),
            }];
            unit.payments.captures = vec![table_paypal::Payment {
                id: "CAPTURE1".into(),
                status: "COMPLETED".into(),
                amount,
            }];
            r.value.status = table_paypal::OrderStatus::Completed;
        }
        Ok(r)
    }
    async fn authorize(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.authorize(id, request).await
    }
    async fn capture(
        &self,
        id: &table_paypal::ResourceId,
        amount: Money,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        let lose = self.lose.swap(false, Ordering::SeqCst);
        if lose && !self.after {
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
        let r = self.inner.capture(id, amount, request).await?;
        self.captured.store(true, Ordering::SeqCst);
        if lose {
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
        Ok(r)
    }
    async fn void(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<()>, table_paypal::Error> {
        self.inner.void(id, request).await
    }
    async fn get_authorization(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        let order = table_paypal::ResourceId::new("ORDER1")?;
        let amount = self.inner.get_order(&order).await?.value.purchase_units[0]
            .amount
            .clone();
        let value = table_paypal::Payment {
            id: id.as_str().into(),
            status: if self.captured.load(Ordering::SeqCst) {
                "CAPTURED"
            } else {
                "CREATED"
            }
            .into(),
            amount,
        };
        Ok(table_paypal::ApiResponse {
            observations: vec![table_paypal::Observation {
                method: "GET",
                path: format!("/v2/payments/authorizations/{}", id.as_str()),
                request_id: String::new(),
                status: 200,
                body: serde_json::to_value(&value).unwrap(),
                binding: None,
            }],
            value,
        })
    }
}

#[tokio::test]
async fn wallet_tick_resolves_a_lost_capture_before_the_next_step_with_one_request_id() {
    for after in [false, true] {
        let (_, vault, http, clock, hello) = runtime(true);
        let api = Arc::new(LosingCapture {
            inner: table_paypal::Client::sandbox(
                http.clone(),
                Arc::new(VaultCredentials(vault.clone())),
                clock.clone(),
                Arc::new(NoDelay),
            ),
            after,
            lose: AtomicBool::new(true),
            captured: AtomicBool::new(false),
        });
        let mut r = Runtime::new(
            Ledger::in_memory().unwrap(),
            vault.clone(),
            hello,
            api.clone(),
            clock.clone(),
        )
        .unwrap();
        let deal = owner_ordered(&mut r, &vault, &http).await;
        clock.0.store(2000, Ordering::SeqCst);
        // Approval seen, authorize, then the capture's answer is lost.
        assert!(r.tick().await.is_err(), "after={after}");
        let state = |r: &Runtime| r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
        assert_eq!(state(&r), DealState::Authorized, "after={after}");
        let captures = |http: &OfflineHttp| {
            http.0
                .lock()
                .unwrap()
                .paths
                .iter()
                .filter(|p| p.ends_with("/capture"))
                .count()
        };
        assert_eq!(captures(&http), usize::from(after), "after={after}");
        // The next tick reads PayPal's truth back before anything else and settles it once.
        clock.0.store(2010, Ordering::SeqCst);
        r.tick().await.unwrap();
        assert_eq!(state(&r), DealState::Receipted, "after={after}");
        assert_eq!(captures(&http), 1, "after={after}");
        let (rows, _) = r.pipeline.wallet.ledger.audit_page(None, 1000).unwrap();
        let reserved: Vec<_> = rows
            .iter()
            .filter(|row| row.deal_id == Some(deal.id) && row.action == "money.authorized")
            .filter(|row| row.detail["operation"] == "capture")
            .map(|row| row.detail["request_id"].clone())
            .collect();
        assert_eq!(
            reserved,
            vec![serde_json::Value::from(
                table_paypal::RequestId::for_operation(deal.id, 1, "capture")
                    .unwrap()
                    .as_str()
            )],
            "after={after}"
        );
        let mut outcomes: Vec<_> = rows
            .iter()
            .filter(|row| row.deal_id == Some(deal.id) && row.action == "money.resolved")
            .map(|row| row.detail["outcome"].as_str().unwrap().to_owned())
            .collect();
        outcomes.reverse();
        let expected: &[&str] = if after {
            &["confirmed"]
        } else {
            &["resent", "confirmed"]
        };
        assert_eq!(outcomes, expected, "after={after}");
        assert!(
            r.pipeline
                .open_operations(Some(deal.id), 2010)
                .unwrap()
                .is_empty()
        );
        r.pipeline.wallet.ledger.verify_audit().unwrap();
    }
}

/// The offline sandbox client behind a wire that loses the first authorize answer after PayPal
/// committed it. The offline HTTP mock records the authorization on the order, so the
/// read-back sees the hold.
struct LosingAuthorize {
    inner: table_paypal::Client,
    lose: AtomicBool,
}
#[async_trait]
impl table_paypal::PayPalApi for LosingAuthorize {
    async fn create_order(
        &self,
        order: &table_paypal::CreateOrder,
        id: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.create_order(order, id).await
    }
    async fn get_order(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        self.inner.get_order(id).await
    }
    async fn authorize(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Order>, table_paypal::Error> {
        let r = self.inner.authorize(id, request).await?;
        if self.lose.swap(false, Ordering::SeqCst) {
            return Err(table_paypal::Error::Unknown {
                observations: vec![],
            });
        }
        Ok(r)
    }
    async fn capture(
        &self,
        id: &table_paypal::ResourceId,
        amount: Money,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        self.inner.capture(id, amount, request).await
    }
    async fn void(
        &self,
        id: &table_paypal::ResourceId,
        request: &table_paypal::RequestId,
    ) -> Result<table_paypal::ApiResponse<()>, table_paypal::Error> {
        self.inner.void(id, request).await
    }
    async fn get_authorization(
        &self,
        id: &table_paypal::ResourceId,
    ) -> Result<table_paypal::ApiResponse<table_paypal::Payment>, table_paypal::Error> {
        self.inner.get_authorization(id).await
    }
}

/// Deal-to-settlement robustness-3 (r3): a seller's authorize sent on its own rules just before
/// the order's deadline, whose answer was lost after PayPal placed the hold. The deadline tick
/// reads the order back (no second authorize), records the hold and re-arms the deadline to the
/// first attempt + 72 h. Delivered at once: the next tick collects it, once, on the seller's own
/// rules and never on the safe default, because the buyer approved the order at PayPal and the
/// authorize went out before the deadline. Any other delivery: the scheduler never collects it,
/// and the re-armed deadline releases the hold.
#[tokio::test]
async fn a_sellers_hold_found_at_the_deadline_is_collected_only_when_delivered_at_once() {
    for delivery in [Delivery::DigitalNow, Delivery::ShipThenCapture { days: 1 }] {
        let case = format!("{delivery:?}");
        let (_, vault, http, clock, hello) = runtime(true);
        let api = Arc::new(LosingAuthorize {
            inner: table_paypal::Client::sandbox(
                http.clone(),
                Arc::new(VaultCredentials(vault.clone())),
                clock.clone(),
                Arc::new(NoDelay),
            ),
            lose: AtomicBool::new(true),
        });
        let mut r = Runtime::new(
            Ledger::in_memory().unwrap(),
            vault.clone(),
            hello,
            api,
            clock.clone(),
        )
        .unwrap();
        let deal = owner_ordered_for(&mut r, &vault, &http, delivery.clone()).await;
        let count = |end: &str| {
            http.0
                .lock()
                .unwrap()
                .paths
                .iter()
                .filter(|p| p.ends_with(end))
                .count()
        };
        let state = |r: &Runtime| r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
        let (due, _) = r.pipeline.wallet.ledger.deadline(deal.id).unwrap().unwrap();
        // Before the deadline: the buyer's approval is seen, the authorize goes out on the
        // seller's rules and its answer is lost. Nothing is collected.
        let sent = due - 10;
        clock.0.store(sent, Ordering::SeqCst);
        assert!(r.tick().await.is_err(), "{case}");
        assert_eq!(state(&r), DealState::Approved, "{case}");
        assert_eq!(count("/authorize"), 1, "{case}");
        assert_eq!(count("/capture"), 0, "{case}");
        assert!(r.pipeline.has_open_operation(deal.id).unwrap(), "{case}");
        // The deadline tick: read back, no second authorize, the hold recorded and re-armed.
        let reads = count("/orders/ORDER1");
        clock.0.store(due, Ordering::SeqCst);
        r.tick().await.unwrap();
        assert_eq!(state(&r), DealState::Authorized, "{case}");
        assert_eq!(count("/orders/ORDER1"), reads + 1, "{case}");
        assert_eq!(count("/authorize"), 1, "{case}");
        assert_eq!(count("/capture"), 0, "{case}");
        let authorize = table_paypal::RequestId::for_operation(deal.id, 1, "authorize").unwrap();
        assert_eq!(
            r.pipeline
                .wallet
                .ledger
                .resolutions(authorize.as_str())
                .unwrap(),
            [("CREATED".to_owned(), "confirmed".to_owned())],
            "{case}"
        );
        let honor = sent + 72 * 3600;
        assert_eq!(
            r.pipeline
                .wallet
                .ledger
                .deadline(deal.id)
                .unwrap()
                .unwrap()
                .0,
            honor,
            "{case}"
        );
        // The ticks after it.
        for at in [due + 10, due + 20] {
            clock.0.store(at, Ordering::SeqCst);
            r.tick().await.unwrap();
        }
        let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
        let authorities = money_authorities(&r, deal.id);
        assert!(
            authorities
                .iter()
                .all(|(_, d)| !matches!(d, DecidedBy::SafeDefault { .. })),
            "{case}: {authorities:?}"
        );
        if delivery == Delivery::DigitalNow {
            // Collected exactly once, on the seller's own rules.
            assert_eq!(after.state, DealState::Receipted, "{case}");
            assert!(
                matches!(after.decided_by, Some(DecidedBy::SellerMandate { .. })),
                "{case}"
            );
            assert_eq!(count("/capture"), 1, "{case}");
            assert_eq!(count("/void"), 0, "{case}");
            let operations: Vec<_> = authorities.iter().map(|(op, _)| op.as_str()).collect();
            assert_eq!(operations, ["create", "authorize", "capture"], "{case}");
            assert!(
                matches!(authorities[2].1, DecidedBy::SellerMandate { .. }),
                "{case}"
            );
        } else {
            // Never collected by the scheduler; the re-armed deadline releases the hold.
            assert_eq!(after.state, DealState::Authorized, "{case}");
            assert_eq!(count("/capture"), 0, "{case}");
            clock.0.store(honor - 1, Ordering::SeqCst);
            r.tick().await.unwrap();
            assert_eq!(state(&r), DealState::Authorized, "{case}");
            assert_eq!(count("/void"), 0, "{case}");
            clock.0.store(honor, Ordering::SeqCst);
            r.tick().await.unwrap();
            let after = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap();
            assert_eq!(after.state, DealState::AutoVoided, "{case}");
            assert_eq!(
                after.decided_by,
                Some(DecidedBy::SafeDefault { deadline: honor }),
                "{case}"
            );
            assert_eq!(count("/void"), 1, "{case}");
            assert_eq!(count("/capture"), 0, "{case}");
        }
        assert!(!r.pipeline.has_open_operation(deal.id).unwrap(), "{case}");
        r.pipeline.wallet.ledger.verify_audit().unwrap();
    }
}
