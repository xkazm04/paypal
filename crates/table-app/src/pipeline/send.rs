use super::{Authority, Completion, MoneyStep, Pipeline, Resolve};
use crate::Error;
use table_core::*;
use table_paypal::{CreateOrder, Order, OrderStatus, Payment, RequestId, ResourceId};
use table_proto::{Body, ShortText};
/// What [`Pipeline::send_settle`] signs for the buyer: the created order, its approval link and
/// the time its approval window counts from.
pub(super) struct Settle<'a> {
    pub(super) id: DealId,
    pub(super) attempt: u8,
    pub(super) order_id: String,
    pub(super) url: &'a str,
    pub(super) expected: &'a CreateOrder,
    pub(super) created: Timestamp,
}
impl Pipeline {
    pub async fn create(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Agreed
            || deal.mode == Mode::Replay
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Create, attempt, now)?;
        let expected = self.expected(&deal, attempt)?;
        expected.body().map_err(|_| Error::Invalid)?;
        self.countersign(&deal, attempt, &decision, now)?;
        let request =
            RequestId::for_operation(id, attempt, "create").map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "create",
            request.as_str(),
            &decision,
            now,
        )?;
        self.wallet
            .ledger
            .apply_event(id, DealEvent::BeginSettlement, now)?;
        self.send_create(&deal, attempt, &expected, &request, now, now)
            .await
    }
    /// Send the create reserved under `request` and finish its operation with PayPal's answer.
    /// The approval deadline runs from `created_from`: the reservation time on a re-send, so it
    /// never outlasts PayPal's own window for an order that may be older than this answer.
    pub(crate) async fn send_create(
        &mut self,
        deal: &Deal,
        attempt: u8,
        expected: &CreateOrder,
        request: &RequestId,
        created_from: Timestamp,
        now: Timestamp,
    ) -> Result<String, Error> {
        let id = deal.id;
        let deal = deal.clone();
        let response = match self.api.create_order(expected, request).await {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    Completion {
                        operation: "create",
                        observations: e.observations(),
                        refs: &deal.paypal,
                        event: None,
                    },
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let mut refs = deal.paypal.clone();
        refs.order = Some(response.value.id.clone());
        let Some(url) = self.created_link(&deal, expected, &response.value) else {
            self.raise_payee_mismatch(&deal, &response.value, expected, now)?;
            self.complete(
                &deal,
                attempt,
                Completion {
                    operation: "create",
                    observations: &response.observations,
                    refs: &refs,
                    event: Some(DealEvent::Mismatch),
                },
                now,
            )?;
            return Err(Error::Invalid);
        };
        self.complete(
            &deal,
            attempt,
            Completion {
                operation: "create",
                observations: &response.observations,
                refs: &refs,
                event: Some(DealEvent::SettleVerified),
            },
            now,
        )?;
        self.send_settle(
            Settle {
                id,
                attempt,
                order_id: response.value.id,
                url: &url,
                expected,
                created: created_from,
            },
            now,
        )
    }
    /// The verified approval link of a freshly created order, or `None` when it fails the
    /// truth checks `create` runs: the order binding, status CREATED and one PayPal-host link
    /// that opens this very order, by the rule the buyer's `validate_settle` applies
    /// (`table_proto::order_approval_url`). The seller never signs a SETTLE its buyer refuses.
    pub(super) fn created_link(
        &self,
        deal: &Deal,
        expected: &CreateOrder,
        order: &Order,
    ) -> Option<String> {
        if order.verify(expected).is_err() || order.status != OrderStatus::Created {
            return None;
        }
        order
            .approval_url()
            .ok()
            .and_then(|url| {
                table_proto::order_approval_url(url.as_str(), &order.id, deal.mode).ok()
            })
            .map(|url| url.as_str().to_owned())
    }
    /// Starts the approval window at `settle.created` and signs and records the SETTLE to the buyer.
    pub(super) fn send_settle(
        &mut self,
        settle: Settle<'_>,
        now: Timestamp,
    ) -> Result<String, Error> {
        let Settle {
            id,
            attempt,
            order_id,
            url,
            expected,
            created,
        } = settle;
        // The HOUSE pipeline (its release-pinned authority is installed) lets an unapproved
        // order lapse sooner, so an abandoned table frees its slot (HOUSE_APPROVAL_SECS).
        let window = if self.house.is_some() {
            HOUSE_APPROVAL_SECS
        } else {
            ORDER_APPROVAL_SECS
        };
        self.wallet
            .ledger
            .set_deadline(id, created.saturating_add(window), None, now)?;
        let updated = self.wallet.ledger.get_deal(id)?;
        let envelope = self.wallet.signed(
            &updated,
            Body::Settle {
                order_id: ShortText::new(order_id)?,
                approve_url: ShortText::new(url.into())?,
                amount: expected.amount,
                invoice_id: ShortText::new(invoice_id(id, attempt)?)?,
                intent: table_proto::Intent::Authorize,
                attempt,
            },
            now,
        )?;
        self.wallet.ledger.record_outbound(&envelope, now)?;
        Ok(envelope.raw().into())
    }
    /// The authorization id an authorize answer proves, or `None`: the order is the one
    /// authorized, COMPLETED, bound to the deal, and holds exactly one CREATED authorization
    /// of the deal's amount.
    pub(super) fn verified_authorization(
        &self,
        deal: &Deal,
        attempt: u8,
        order_id: &str,
        order: &Order,
    ) -> Result<Option<String>, Error> {
        let authorization = order
            .purchase_units
            .first()
            .and_then(|u| u.payments.authorizations.first());
        let valid = order.id == order_id
            && order.status == OrderStatus::Completed
            && order.verify(&self.recorded_order(deal, attempt)?).is_ok()
            && order.purchase_units[0].payments.authorizations.len() == 1
            && authorization.is_some_and(|a| {
                a.status == "CREATED"
                    && a.amount.money().ok() == deal.terms.amount().ok()
                    && ResourceId::new(&a.id).is_ok()
            });
        Ok(authorization.filter(|_| valid).map(|a| a.id.clone()))
    }
    /// A capture answer proves the capture: COMPLETED, the deal's amount, a well-formed id.
    pub(super) fn verified_capture(deal: &Deal, payment: &Payment) -> Result<bool, Error> {
        Ok(payment.status == "COMPLETED"
            && payment.amount.money().ok() == Some(deal.terms.amount()?)
            && ResourceId::new(&payment.id).is_ok())
    }
    /// Signs and records the receipt of a confirmed capture and moves the deal to RECEIPTED.
    pub(super) fn send_receipt(
        &mut self,
        id: DealId,
        capture_id: String,
        now: Timestamp,
    ) -> Result<String, Error> {
        let updated = self.wallet.ledger.get_deal(id)?;
        let receipt = self.wallet.signed(
            &updated,
            Body::Receipt {
                capture_id: ShortText::new(capture_id)?,
                amount: updated.terms.amount()?,
                status: table_proto::ReceiptStatus::Completed,
                transcript_head: updated.transcript_head,
            },
            now,
        )?;
        self.wallet.ledger.record_outbound(&receipt, now)?;
        self.wallet.ledger.record_receipt(&receipt, now)?;
        self.wallet
            .ledger
            .apply_event(id, DealEvent::ReceiptVerified, now)?;
        Ok(receipt.raw().into())
    }
    /// The order check's half of the payee rule: an order PayPal shows paying another payee than
    /// the agreed one is a scam shield BLOCK on the deal (rule `payee_mismatch`), raised before the
    /// deal enters MISMATCH. It reads only PayPal's typed payee field, never a counterparty's words.
    pub(super) fn raise_payee_mismatch(
        &mut self,
        deal: &Deal,
        order: &table_paypal::Order,
        expected: &CreateOrder,
        now: Timestamp,
    ) -> Result<(), Error> {
        let other = order
            .purchase_units
            .iter()
            .any(|u| u.payee.merchant_id != expected.merchant_id.as_str());
        if other {
            self.wallet.ledger.raise_shield_for(
                deal.id,
                ShieldVerdict::Block,
                ShieldRule::PayeeMismatch,
                now,
            )?;
        }
        Ok(())
    }
    pub async fn poll_approval(
        &mut self,
        id: DealId,
        attempt: u8,
        now: Timestamp,
    ) -> Result<bool, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::AwaitingApproval
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Invalid);
        }
        let order = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        let r = match self.api.get_order(&order).await {
            Ok(response) => response,
            Err(error) => {
                for call in self.calls(id, error.observations(), now)? {
                    self.wallet.ledger.record_paypal_call(&call, &[])?;
                }
                return Err(Error::Unavailable);
            }
        };
        for call in self.calls(id, &r.observations, now)? {
            self.wallet.ledger.record_paypal_call(&call, &[])?;
        }
        let expected = self.expected(&deal, attempt)?;
        if r.value.id != order.as_str() || r.value.verify(&expected).is_err() {
            self.raise_payee_mismatch(&deal, &r.value, &expected, now)?;
            self.wallet
                .ledger
                .apply_event(id, DealEvent::Mismatch, now)?;
            return Err(Error::Invalid);
        }
        if r.value.status == OrderStatus::Approved {
            self.wallet
                .ledger
                .apply_event(id, DealEvent::OrderApproved, now)?;
            return Ok(true);
        }
        Ok(false)
    }
    pub async fn authorize(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Approved
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Permission);
        }
        if self.has_open_operation(id)? {
            // The owner's decision on a deal whose authorize is still open asks PayPal what
            // happened, once per ticket, and sends nothing (DECISIONS 52a).
            return match authority {
                Authority::Owner(ticket) => {
                    self.owner_read_authorize(&deal, attempt, category, ticket, now)
                        .await
                }
                _ => Err(Error::Permission),
            };
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Authorize, attempt, now)?;
        self.countersign(&deal, attempt, &decision, now)?;
        let request =
            RequestId::for_operation(id, attempt, "authorize").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "authorize",
            request.as_str(),
            &decision,
            now,
        )?;
        self.send_authorize(&deal, attempt, &resource, &request, now)
            .await
    }
    /// Send the authorize reserved under `request` and finish its operation with PayPal's answer.
    pub(crate) async fn send_authorize(
        &mut self,
        deal: &Deal,
        attempt: u8,
        resource: &ResourceId,
        request: &RequestId,
        now: Timestamp,
    ) -> Result<(), Error> {
        let id = deal.id;
        let deal = deal.clone();
        let r = match self.api.authorize(resource, request).await {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    Completion {
                        operation: "authorize",
                        observations: e.observations(),
                        refs: &deal.paypal,
                        event: None,
                    },
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let authorization =
            self.verified_authorization(&deal, attempt, resource.as_str(), &r.value)?;
        let valid = authorization.is_some();
        let mut refs = deal.paypal.clone();
        if valid {
            refs.authorization = authorization;
        }
        self.complete(
            &deal,
            attempt,
            Completion {
                operation: "authorize",
                observations: &r.observations,
                refs: &refs,
                event: if valid {
                    Some(DealEvent::AuthorizationConfirmed)
                } else {
                    None
                },
            },
            now,
        )?;
        if !valid {
            return Err(Error::Invalid);
        }
        self.wallet
            .ledger
            .set_deadline(id, now.saturating_add(72 * 3600), Some(now), now)?;
        Ok(())
    }
    pub async fn capture(
        &mut self,
        id: DealId,
        attempt: u8,
        category: Category,
        authority: Authority,
        now: Timestamp,
    ) -> Result<String, Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
            || self.has_open_operation(id)?
        {
            return Err(Error::Permission);
        }
        let decision = self.authority(&deal, category, authority, attempt, now)?;
        self.shield_step(&deal, &decision, MoneyStep::Capture, attempt, now)?;
        let deadline = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?;
        if now >= deadline.0 {
            return Err(Error::Permission);
        }
        if !self.wallet.ledger.has_countersign(id, attempt)? {
            return Err(Error::Permission);
        }
        let request =
            RequestId::for_operation(id, attempt, "capture").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.authorization.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "capture",
            request.as_str(),
            &decision,
            now,
        )?;
        self.send_capture(&deal, attempt, &resource, &request, now)
            .await
    }
    /// Send the capture reserved under `request` and finish its operation with PayPal's answer;
    /// a confirmed capture signs and records the receipt.
    pub(crate) async fn send_capture(
        &mut self,
        deal: &Deal,
        attempt: u8,
        resource: &ResourceId,
        request: &RequestId,
        now: Timestamp,
    ) -> Result<String, Error> {
        let id = deal.id;
        let deal = deal.clone();
        let r = match self
            .api
            .capture(resource, deal.terms.amount()?, request)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                self.complete(
                    &deal,
                    attempt,
                    Completion {
                        operation: "capture",
                        observations: e.observations(),
                        refs: &deal.paypal,
                        event: None,
                    },
                    now,
                )?;
                return Err(Error::Unavailable);
            }
        };
        let valid = Self::verified_capture(&deal, &r.value)?;
        let mut refs = deal.paypal.clone();
        if valid {
            refs.capture = Some(r.value.id.clone());
        }
        self.complete(
            &deal,
            attempt,
            Completion {
                operation: "capture",
                observations: &r.observations,
                refs: &refs,
                event: if valid {
                    Some(DealEvent::CaptureConfirmed)
                } else {
                    None
                },
            },
            now,
        )?;
        if !valid {
            return Err(Error::Invalid);
        }
        self.send_receipt(id, r.value.id, now)
    }
    pub async fn auto_void(
        &mut self,
        id: DealId,
        attempt: u8,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        if deal.state != DealState::Authorized
            || deal.mode == Mode::Replay
            || attempt != self.wallet.ledger.settled_attempt(id)?
        {
            return Err(Error::Invalid);
        }
        let due = self.wallet.ledger.deadline(id)?.ok_or(Error::Invalid)?.0;
        let held = deal.shield_held();
        if now < due && !held {
            return Err(Error::Permission);
        }
        // An authorize or capture whose outcome is unknown is read back first, and a void left
        // unknown is settled (or sent once more) instead of reserved again. A capture PayPal
        // shows committed is confirmed and no void is sent; one still unknown, or a read-back
        // that failed, leaves the hold in place this tick, which moves no money
        // (`deadline_default` answers `Ok(false)` when only parked steps remain).
        if !self.resolve_deal(id, Resolve::Deadline, now).await? {
            return Err(Error::Unavailable);
        }
        if self.wallet.ledger.get_deal(id)?.state != DealState::Authorized {
            return Ok(());
        }
        let authority = DecidedBy::SafeDefault {
            deadline: if held { now } else { due },
        };
        let request = RequestId::for_operation(id, attempt, "void").map_err(|_| Error::Invalid)?;
        let resource = ResourceId::new(deal.paypal.authorization.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        self.wallet.ledger.reserve_operation(
            id,
            attempt,
            "void",
            request.as_str(),
            &authority,
            now,
        )?;
        let event = if held {
            DealEvent::Void
        } else {
            DealEvent::AutoVoid
        };
        self.send_void(&deal, attempt, &resource, &request, event, now)
            .await
    }
}
