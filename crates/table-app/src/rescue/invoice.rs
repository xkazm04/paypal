//! The invoice plumbing of the rescue flow: create, send and resolve the one invoice a fix makes.

use super::*;

impl Pipeline {
    /// Create the invoice reserved under `request` and finish its operation with PayPal's answer:
    /// a DRAFT for exactly the deal's amount and reference is recorded as the deal's invoice.
    pub(super) async fn send_invoice_create(
        &mut self,
        api: &dyn SecondaryApi,
        deal: &Deal,
        request: &InvoiceRequest,
        rid: &RequestId,
        now: Timestamp,
    ) -> Result<String, Error> {
        match api.create_invoice(request, rid).await {
            Ok(r) => {
                let valid = r.value.status == DRAFT && self.invoice_matches(deal, &r.value);
                let mut refs = deal.paypal.clone();
                refs.order = valid.then(|| r.value.id.clone());
                self.complete(
                    deal,
                    1,
                    "invoice-create",
                    &r.observations,
                    &refs,
                    Some(if valid {
                        DealEvent::InvoiceDrafted
                    } else {
                        DealEvent::Mismatch
                    }),
                    now,
                )?;
                if valid {
                    Ok(r.value.id)
                } else {
                    Err(Error::Invalid)
                }
            }
            Err(e) => {
                self.complete(
                    deal,
                    1,
                    "invoice-create",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                Err(Error::Unavailable)
            }
        }
    }

    /// Reserve and send the deal's drafted invoice under `decision`.
    pub(super) async fn send_rescue_invoice(
        &mut self,
        api: &dyn SecondaryApi,
        id: DealId,
        decision: &DecidedBy,
        now: Timestamp,
    ) -> Result<(), Error> {
        let deal = self.wallet.ledger.get_deal(id)?;
        let invoice = ResourceId::new(deal.paypal.order.clone().ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
        let rid = RequestId::for_operation(id, 1, "invoice-send").map_err(|_| Error::Invalid)?;
        self.wallet
            .ledger
            .reserve_operation(id, 1, "invoice-send", rid.as_str(), decision, now)?;
        self.send_invoice(api, &deal, &invoice, &rid, now).await
    }

    /// Send the invoice reserved under `rid` and finish its operation with PayPal's answer.
    pub(crate) async fn send_invoice(
        &mut self,
        api: &dyn SecondaryApi,
        deal: &Deal,
        invoice: &ResourceId,
        rid: &RequestId,
        now: Timestamp,
    ) -> Result<(), Error> {
        match api.send_invoice(invoice, rid).await {
            Ok(r) => {
                self.complete(
                    deal,
                    1,
                    "invoice-send",
                    &r.observations,
                    &deal.paypal,
                    Some(DealEvent::SettleVerified),
                    now,
                )?;
                self.wallet.ledger.set_deadline(
                    deal.id,
                    now.saturating_add(RESCUE_INVOICE_OPEN_SECS),
                    None,
                    now,
                )?;
                Ok(())
            }
            Err(e) => {
                self.complete(
                    deal,
                    1,
                    "invoice-send",
                    e.observations(),
                    &deal.paypal,
                    None,
                    now,
                )?;
                Err(Error::Unavailable)
            }
        }
    }

    /// The invoice PayPal returned is this deal's: same amount, and the deal's own reference and
    /// invoice number wherever PayPal echoes them.
    pub(super) fn invoice_matches(&self, deal: &Deal, invoice: &Invoice) -> bool {
        let number = rescue_invoice_number(deal.id, 1).ok();
        ResourceId::new(&invoice.id).is_ok()
            && invoice
                .amount
                .as_ref()
                .and_then(|a| a.money().ok())
                .is_some_and(|a| deal.terms.amount().ok() == Some(a))
            && invoice.detail.as_ref().is_none_or(|d| {
                d.reference
                    .as_deref()
                    .is_none_or(|r| r == deal.id.to_string())
                    && d.invoice_number
                        .as_deref()
                        .is_none_or(|n| Some(n) == number.as_deref())
            })
    }

    /// One open invoice step: the lost create or the lost send.
    pub(crate) async fn resolve_invoice(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<(), Error> {
        if deal.kind != DealKind::Rescue || deal.state.terminal() {
            return Ok(());
        }
        let request = RequestId::for_operation(deal.id, op.attempt, op.operation)
            .map_err(|_| Error::Invalid)?;
        if request.as_str() != op.request_id {
            return self.park(deal, op, "none", &[], now);
        }
        match op.operation {
            "invoice-create" => self.resolve_invoice_create(deal, op, now).await,
            _ => {
                self.resolve_invoice_send(deal, op, &request, ticket, now)
                    .await
            }
        }
    }

    /// A lost invoice create: PayPal is searched by the deal's own invoice number. Exactly one
    /// invoice with this deal's number, reference and amount: it exists, and the deal records it
    /// (the owner then decides the send). Anything else parks; a create is never sent again, so
    /// a second invoice can never be made.
    async fn resolve_invoice_create(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        now: Timestamp,
    ) -> Result<(), Error> {
        if deal.state != DealState::Settling || deal.paypal.order.is_some() {
            return self.park(deal, op, "none", &[], now);
        }
        let Ok(api) = self.invoicing() else {
            return self.wait(deal, op, &[], now);
        };
        let number = rescue_invoice_number(deal.id, op.attempt).map_err(|_| Error::Invalid)?;
        let (observations, found) = match api.search_invoices(&number).await {
            Ok(r) => (r.observations, Some(r.value.items)),
            Err(e) => (e.observations().to_vec(), None),
        };
        let Some(items) = found else {
            return self.read_failed(deal, op, &observations, now);
        };
        self.rescue_read_backoff.remove(&op.request_id);
        let ours: Vec<&Invoice> = items
            .iter()
            .filter(|i| {
                i.detail.as_ref().is_some_and(|d| {
                    d.invoice_number.as_deref() == Some(number.as_str())
                        && d.reference.as_deref() == Some(deal.id.to_string().as_str())
                }) && self.invoice_matches(deal, i)
            })
            .collect();
        let [invoice] = ours.as_slice() else {
            return self.park(deal, op, "other", &observations, now);
        };
        if invoice.status != DRAFT {
            // Sent by someone else, paid or cancelled: not a state this wallet put it in.
            return self.park(deal, op, "other", &observations, now);
        }
        let mut refs = deal.paypal.clone();
        refs.order = Some(invoice.id.clone());
        self.record(
            deal,
            op,
            DRAFT,
            Outcome::Confirmed,
            &observations,
            Some(&refs),
            Some(DealEvent::InvoiceDrafted),
            now,
        )
    }

    /// A lost invoice send: the invoice is read. SENT (or already paid): it went out. DRAFT: it
    /// did not, and only the owner's fresh decision sends it again, once, under the same request
    /// id, inside the fix's deadline and the request id's window; outside them it closes not done.
    async fn resolve_invoice_send(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        request: &RequestId,
        ticket: Option<OwnerTicket>,
        now: Timestamp,
    ) -> Result<(), Error> {
        let Some(invoice) = deal
            .paypal
            .order
            .as_deref()
            .and_then(|o| ResourceId::new(o).ok())
        else {
            return self.park(deal, op, "none", &[], now);
        };
        if deal.state != DealState::Settling {
            return self.park(deal, op, "none", &[], now);
        }
        let Ok(api) = self.invoicing() else {
            return self.wait(deal, op, &[], now);
        };
        let (observations, read) = match api.get_invoice(&invoice).await {
            Ok(r) => (r.observations, Some(r.value)),
            Err(e) => (e.observations().to_vec(), None),
        };
        let Some(read) = read else {
            return self.read_failed(deal, op, &observations, now);
        };
        self.rescue_read_backoff.remove(&op.request_id);
        if read.id != invoice.as_str() || !self.invoice_matches(deal, &read) {
            return self.park(deal, op, "other", &observations, now);
        }
        if SENT_STATUSES.contains(&read.status.as_str()) {
            return self.confirm_invoice_sent(deal, op, &read.status, &observations, now);
        }
        if read.status != DRAFT {
            return self.park(deal, op, "other", &observations, now);
        }
        // A draft never sent asked nobody to pay. Past the fix's deadline (PayPal's next retry)
        // or past the request id's window it is never sent again, not even on a fresh decision:
        // the step closes not done, and at the deadline its default applies (the fix expires and
        // PayPal retries by itself), so the subscription is free for a later rescue.
        let deadline_passed = self
            .wallet
            .ledger
            .deadline(deal.id)?
            .is_some_and(|(due, _)| due <= now);
        if deadline_passed || now.saturating_sub(op.started_at) >= REQUEST_ID_KEPT_SECS {
            self.record(
                deal,
                op,
                DRAFT,
                Outcome::Absent,
                &observations,
                None,
                None,
                now,
            )?;
            if deadline_passed {
                self.wallet.ledger.apply_deadline_default(deal.id, now)?;
            }
            return Ok(());
        }
        // The owner's decision was recorded as this step's authority and is not reused: a send
        // goes again only on a fresh one, and only once.
        let Some(ticket) = ticket else {
            return self.park(deal, op, DRAFT, &observations, now);
        };
        if op.resent {
            return self.park(deal, op, DRAFT, &observations, now);
        }
        // Without the deal's agent key no answer could be signed: wait for it.
        if self.signer_missing {
            return Ok(());
        }
        let category = self.wallet.ledger.deal_category(deal.id)?;
        let allowed =
            match self.authority(deal, category, Authority::Owner(ticket), op.attempt, now) {
                Ok(decided) => {
                    matches!(
                        (&decided, &op.decided_by),
                        (DecidedBy::Human { .. }, DecidedBy::Human { .. })
                    ) && shield_allows(self.shield(deal, now)?, &decided, MoneyStep::Create)
                }
                Err(_) => false,
            };
        if !allowed {
            return self.park(deal, op, DRAFT, &observations, now);
        }
        self.record(
            deal,
            op,
            DRAFT,
            Outcome::Resent,
            &observations,
            None,
            None,
            now,
        )?;
        match api.send_invoice(&invoice, request).await {
            Ok(r) => self.confirm_invoice_sent(deal, op, SENT, &r.observations, now),
            Err(e) => self.wait(deal, op, e.observations(), now),
        }
    }

    /// The invoice is out: the send is confirmed and the invoice is read for PAID from now on.
    fn confirm_invoice_sent(
        &mut self,
        deal: &Deal,
        op: &OpenOperation,
        observed: &str,
        observations: &[Observation],
        now: Timestamp,
    ) -> Result<(), Error> {
        self.record(
            deal,
            op,
            observed,
            Outcome::Confirmed,
            observations,
            Some(&deal.paypal),
            Some(DealEvent::SettleVerified),
            now,
        )?;
        self.wallet.ledger.set_deadline(
            deal.id,
            op.started_at.saturating_add(RESCUE_INVOICE_OPEN_SECS),
            None,
            now,
        )?;
        Ok(())
    }
}
