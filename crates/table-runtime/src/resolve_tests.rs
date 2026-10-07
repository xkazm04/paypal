//! T10 on the wallet scheduler: a seller capture whose answer was lost is resolved with PayPal
//! by the next tick, before the deal's next step, with no second request id.
use crate::tests::h5_tests::owner_ordered;
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
