use crate::{Error, Pipeline};
use table_core::*;
use table_paypal::{ReportingWindow, SecondaryApi};
impl Pipeline {
    pub async fn reconcile(
        &mut self,
        id: DealId,
        api: &dyn SecondaryApi,
        mut window: ReportingWindow,
        now: Timestamp,
    ) -> Result<(), Error> {
        window.validate().map_err(|_| Error::Invalid)?;
        let deal = self.wallet.ledger.get_deal(id)?;
        // UNCONFIRMED too: a statement match after the corroboration lapse still counts.
        if deal.mode != Mode::Sandbox
            || !matches!(deal.state, DealState::Receipted | DealState::Unconfirmed)
            || window.page != 1
        {
            return Err(Error::Permission);
        }
        let capture = deal.paypal.capture.as_deref().ok_or(Error::Invalid)?;
        self.wallet.ledger.append_audit(&table_ledger::AuditEntry {
            at: now,
            actor: "owner".into(),
            action: "receipt.reporting_checked".into(),
            deal_id: Some(id),
            detail: serde_json::json!({"from":window.from,"to":window.to,"capture_id":capture}),
        })?;
        let mut matches = Vec::new();
        for page in 1..=20 {
            window.page = page;
            let response = match api.transactions(window).await {
                Ok(response) => response,
                Err(error) => {
                    for call in self.calls(id, error.observations(), now)? {
                        self.wallet.ledger.record_paypal_call(&call, &[])?;
                    }
                    return Err(Error::Unavailable);
                }
            };
            let calls = self.calls(id, &response.observations, now)?;
            for call in &calls {
                self.wallet.ledger.record_paypal_call(call, &[])?;
            }
            if response.value.page != page
                || response.value.total_pages > 20
                || response.value.transaction_details.len() > usize::from(window.page_size)
                || !calls.iter().any(|c| {
                    matches!(c.method, table_ledger::HttpMethod::Get)
                        && c.path.as_str() == "/v1/reporting/transactions"
                        && c.status == 200
                })
            {
                return Err(Error::Invalid);
            }
            for row in response.value.transaction_details {
                let info = row.transaction_info;
                if info.transaction_id == capture {
                    if info.transaction_status != "S" {
                        return Err(Error::Invalid);
                    }
                    let lexical = &info.transaction_amount.value;
                    // UNVERIFIED: buyer account reporting uses a negative debit and the seller's
                    // capture id as transaction_id. Absent/different mappings fail closed (spike 3).
                    let value = if deal.side == Side::Buyer {
                        lexical.strip_prefix('-').ok_or(Error::Invalid)?
                    } else {
                        lexical.as_str()
                    };
                    let amount = Money::parse(value, info.transaction_amount.currency_code)
                        .map_err(DomainError::from)?;
                    matches.push(amount);
                }
            }
            if page >= response.value.total_pages {
                break;
            }
        }
        // Ambiguous/partial reporting cannot promote a peer claim.
        if matches.len() > 1 {
            return Err(Error::Invalid);
        }
        if let Some(amount) = matches.first() {
            self.wallet
                .ledger
                .confirm_reporting(id, capture, *amount, now)?;
        } else {
            // The statement read found no such payment: recorded, so the owner sees it was looked
            // for. Nothing else changes.
            self.wallet.ledger.append_audit(&table_ledger::AuditEntry {
                at: now,
                actor: "paypal-reporting".into(),
                action: "receipt.reporting_unmatched".into(),
                deal_id: Some(id),
                detail: serde_json::json!({"from":window.from,"to":window.to,"capture_id":capture}),
            })?;
        }
        Ok(())
    }
}
