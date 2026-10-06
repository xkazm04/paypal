//! Opt-in API conformance probes, never wallet runtime entry points.
//! Ignored AND env-gated. Production authority continues to live in table-app.
#![allow(clippy::unwrap_used, clippy::expect_used)]
use async_trait::async_trait;
use serde_json::json;
use std::{sync::Arc, time::Duration};
use table_core::*;
use table_paypal::{http::*, *};
#[derive(Debug)]
struct EnvCredentials;
#[async_trait]
impl Credentials for EnvCredentials {
    async fn load(&self) -> Result<(Secret, Secret), Error> {
        Ok((
            Secret::new(std::env::var("PAYPAL_SANDBOX_CLIENT_ID").map_err(|_| Error::Credentials)?),
            Secret::new(std::env::var("PAYPAL_SANDBOX_SECRET").map_err(|_| Error::Credentials)?),
        ))
    }
}
#[derive(Debug)]
struct LiveClock;
impl Clock for LiveClock {
    fn now(&self) -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| i64::try_from(d.as_secs()).unwrap_or(0))
    }
}
fn client() -> Client {
    assert_eq!(
        std::env::var("TABLE_LIVE_SANDBOX").as_deref(),
        Ok("1"),
        "Live spike requires TABLE_LIVE_SANDBOX=1"
    );
    Client::sandbox(
        Arc::new(ReqwestTransport::new().unwrap()),
        Arc::new(EnvCredentials),
        Arc::new(LiveClock),
        Arc::new(ExponentialBackoff),
    )
}
fn emit(value: serde_json::Value) {
    println!("TABLE_SPIKE_EVIDENCE:{value}");
}
fn order() -> CreateOrder {
    let deal = DealId(ulid::Ulid::new());
    CreateOrder {
        deal,
        attempt: 1,
        amount: Money::parse("1.00", Currency::USD).unwrap(),
        terms_hash: H256::digest(deal.to_string().as_bytes()),
        merchant_id: ResourceId::new(
            std::env::var("PAYPAL_SANDBOX_MERCHANT_ID")
                .expect("Set merchant id to the account that should receive funds"),
        )
        .unwrap(),
    }
}
fn request(order: &CreateOrder, operation: &str) -> RequestId {
    let id = RequestId::for_operation(order.deal, 1, operation).unwrap();
    emit(
        json!({"deal":order.deal,"request_id":id.as_str(),"operation":operation,"mode":"sandbox","amount_minor":order.amount.minor()}),
    );
    id
}
async fn approved(client: &Client, expected: &CreateOrder, created: Order) -> Order {
    created.verify(expected).unwrap();
    let id = ResourceId::new(created.id.clone()).unwrap();
    emit(json!({"order_id":id.as_str(),"intent":created.intent,"stage":"created"}));
    let link = created
        .links
        .iter()
        .find(|l| matches!(l.rel.as_str(), "approve" | "payer-action"))
        .expect("No buyer approval link");
    let url = approve_url(&link.href).expect("Unsafe approval host");
    println!(
        "Open in your system browser as the sandbox buyer (10 minute polling limit): {}",
        url.as_str()
    );
    for _ in 0..120 {
        let current = client
            .get_order(&id)
            .await
            .expect("GET failed; preserve recorded order id and reconcile before rerunning")
            .value;
        current.verify(expected).unwrap();
        if current.status == OrderStatus::Approved {
            return current;
        }
        assert!(
            matches!(
                current.status,
                OrderStatus::Created | OrderStatus::Saved | OrderStatus::PayerActionRequired
            ),
            "Unexpected order state"
        );
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    panic!("Approval timed out; no authorization or capture was attempted")
}
async fn authorize(client: &Client, expected: &CreateOrder, approved: Order) -> ResourceId {
    let response = client
        .authorize(
            &ResourceId::new(approved.id).unwrap(),
            &request(expected, "authorize"),
        )
        .await
        .expect("Unknown authorize outcome: reconcile the recorded order first");
    response.value.verify(expected).unwrap();
    let [unit] = response.value.purchase_units.as_slice() else {
        panic!("Wrong purchase unit count")
    };
    let [authorization] = unit.payments.authorizations.as_slice() else {
        panic!("Wrong authorization count")
    };
    assert_eq!(authorization.amount.money().unwrap(), expected.amount);
    assert_eq!(authorization.status, "CREATED");
    emit(json!({"authorization_id":authorization.id,"stage":"authorized"}));
    ResourceId::new(authorization.id.clone()).unwrap()
}
async fn capture(client: &Client, expected: &CreateOrder, id: &ResourceId) {
    let response = client
        .capture(id, expected.amount, &request(expected, "capture"))
        .await
        .expect("Unknown capture outcome: reconcile the recorded authorization before rerunning");
    assert_eq!(response.value.amount.money().unwrap(), expected.amount);
    assert_eq!(response.value.status, "COMPLETED");
    emit(
        json!({"capture_id":response.value.id,"amount_minor":expected.amount.minor(),"status":"COMPLETED","stage":"captured"}),
    );
}
#[tokio::test]
#[ignore = "owner-run live sandbox; scripts/spike.ps1 -Spike 3"]
async fn spike_3_seller_second_account_authorize_capture() {
    let client = client();
    let expected = order();
    println!(
        "Use the seller's REST app credentials, its own merchant id, and a DIFFERENT sandbox buyer in the browser."
    );
    let created = client
        .create_order(&expected, &request(&expected, "create"))
        .await
        .unwrap()
        .value;
    let approved = approved(&client, &expected, created).await;
    let authorization = authorize(&client, &expected, approved).await;
    capture(&client, &expected, &authorization).await;
    emit(
        json!({"spike":3,"verdict":"captured","buyer_account_identity":"owner_must_confirm_distinct_account","buyer_api_access":"not_tested"}),
    );
}
#[tokio::test]
#[ignore = "owner-run live sandbox; scripts/spike.ps1 -Spike 4"]
async fn spike_4_owner_payee_capture_and_void() {
    let client = client();
    println!(
        "Use the OWNER app credentials and the distinct target merchant's merchant id. Approve each of the TWO orders as the sandbox buyer."
    );
    for do_capture in [true, false] {
        let expected = order();
        let created = client
            .create_order(&expected, &request(&expected, "create"))
            .await
            .unwrap()
            .value;
        let approved = approved(&client, &expected, created).await;
        let authorization = authorize(&client, &expected, approved).await;
        if do_capture {
            capture(&client, &expected, &authorization).await;
        } else {
            client
                .void(&authorization, &request(&expected, "void"))
                .await
                .expect("Unknown void outcome: reconcile recorded authorization");
            let observed = client
                .get_authorization(&authorization)
                .await
                .unwrap()
                .value;
            assert_eq!(observed.status, "VOIDED");
            emit(
                json!({"authorization_id":authorization.as_str(),"stage":"voided","status":observed.status}),
            );
        }
    }
    emit(json!({"spike":4,"verdict":"capture_and_void_verified","payee_match":true}));
}
#[tokio::test]
#[ignore = "owner-run live sandbox; scripts/spike.ps1 -Spike 5"]
async fn spike_5_return_destinations() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let client = client();
    for scheme in [false, true] {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let destination = if scheme {
            ReturnDestination::WalletScheme
        } else {
            ReturnDestination::Loopback {
                port: listener.local_addr().unwrap().port(),
            }
        };
        let mut callback = tokio::spawn(async move {
            let Ok(Ok((mut stream, _))) =
                tokio::time::timeout(Duration::from_secs(600), listener.accept()).await
            else {
                return false;
            };
            let mut bytes = [0; 4096];
            let Ok(n) = stream.read(&mut bytes).await else {
                return false;
            };
            let received =
                bytes[..n].starts_with(b"GET /return?") || bytes[..n].starts_with(b"GET /return ");
            let body = "Return received. Payment truth is polled from PayPal.";
            let reply = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes()).await;
            received
        });
        let expected = order();
        let response = client
            .create_order_returning(&expected, destination, &request(&expected, "create"))
            .await;
        match response {
            Ok(response) => {
                let order = approved(&client, &expected, response.value).await;
                let received = if scheme {
                    false
                } else {
                    tokio::time::timeout(Duration::from_secs(20), &mut callback)
                        .await
                        .unwrap_or(Ok(false))
                        .unwrap_or(false)
                };
                emit(
                    json!({"spike":5,"destination":if scheme{"scheme"}else{"loopback"},"verdict":"order_approved","order_id":order.id,"callback_received":received,"authorized":false,"scheme_handler_registered":false}),
                );
            }
            Err(error) => {
                emit(
                    json!({"spike":5,"destination":if scheme{"scheme"}else{"loopback"},"verdict":"api_rejected","statuses":error.observations().iter().map(|o|o.status).collect::<Vec<_>>()}),
                );
                callback.abort();
            }
        }
        callback.abort();
    }
}
#[tokio::test]
#[ignore = "owner-run live sandbox; scripts/spike.ps1 -Spike 8"]
async fn spike_8_invoice_create_send_paid() {
    let client = client();
    let expected = order();
    let invoice = InvoiceRequest {
        deal: expected.deal,
        recipient_email: std::env::var("PAYPAL_SANDBOX_INVOICE_EMAIL")
            .expect("Recipient sandbox personal account email required"),
        amount: expected.amount,
    };
    let created = client
        .create_invoice(&invoice, &request(&expected, "invoice-create"))
        .await
        .expect("Preserve reference; unknown create is not automatically retried")
        .value;
    let id = ResourceId::new(created.id).unwrap();
    emit(json!({"invoice_id":id.as_str(),"reference":expected.deal,"stage":"invoice_created"}));
    client
        .send_invoice(&id, &request(&expected, "invoice-send"))
        .await
        .expect("Preserve invoice id; unknown send is not automatically retried");
    println!(
        "Invoice {} sent. As the sandbox personal recipient, check email delivery, then locate/pay the invoice on sandbox.paypal.com. No wallet is needed; polling lasts 10 minutes.",
        id.as_str()
    );
    for _ in 0..120 {
        let invoice = client.get_invoice(&id).await.unwrap().value;
        assert_eq!(invoice.id, id.as_str());
        if invoice.status == "PAID" {
            assert_eq!(
                invoice
                    .amount
                    .expect("Paid invoice has no total")
                    .money()
                    .unwrap(),
                expected.amount
            );
            emit(
                json!({"spike":8,"invoice_id":id.as_str(),"status":"PAID","amount_minor":expected.amount.minor(),"email_delivery":"owner_observation_required","verdict":"paid"}),
            );
            return;
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
    panic!(
        "Invoice not paid within polling limit; preserve invoice id and check recipient access/email delivery"
    )
}
