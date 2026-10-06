use crate::{Body, Intent};
use table_core::{DealId, H256, Mode, Terms, invoice_id};
use thiserror::Error;
use url::Url;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SettlementError {
    #[error("SETTLE/ACCEPT body required")]
    Body,
    #[error("settlement amount, invoice, intent or attempt mismatches signed terms")]
    Mismatch,
    #[error("approval link must be HTTPS on the mode's exact PayPal host")]
    Host,
}
/// Browser edge accepts this opaque result, never a URL supplied by a webview.
#[derive(Debug, Clone)]
pub struct VerifiedApprovalUrl(Url);
impl VerifiedApprovalUrl {
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}
pub fn approval_url(raw: &str, mode: Mode) -> Result<VerifiedApprovalUrl, SettlementError> {
    let url = Url::parse(raw).map_err(|_| SettlementError::Host)?;
    if mode == Mode::Replay
        || url.scheme() != "https"
        || url.host_str() != Some("www.sandbox.paypal.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some_and(|p| p != 443)
        || url.fragment().is_some()
    {
        return Err(SettlementError::Host);
    }
    Ok(VerifiedApprovalUrl(url))
}
pub fn validate_settle(
    body: &Body,
    deal: DealId,
    terms: &Terms,
    mode: Mode,
) -> Result<VerifiedApprovalUrl, SettlementError> {
    let Body::Settle {
        approve_url,
        amount,
        invoice_id: inv,
        intent,
        attempt,
        ..
    } = body
    else {
        return Err(SettlementError::Body);
    };
    let expected = invoice_id(deal, *attempt).map_err(|_| SettlementError::Mismatch)?;
    if *intent != Intent::Authorize
        || terms.amount().map_err(|_| SettlementError::Mismatch)? != *amount
        || inv.as_str() != expected
    {
        return Err(SettlementError::Mismatch);
    }
    approval_url(approve_url.as_str(), mode)
}
pub fn validate_accept(
    body: &Body,
    last_offer_seq: u32,
    terms_hash: H256,
) -> Result<(), SettlementError> {
    match body {
        Body::Accept {
            offer_seq,
            terms_hash: hash,
            ..
        } if *offer_seq == last_offer_seq && *hash == terms_hash => Ok(()),
        _ => Err(SettlementError::Mismatch),
    }
}
