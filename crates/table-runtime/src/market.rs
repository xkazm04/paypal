//! Owner-bound market fetching is outside the actor; the result is rechecked on return.
use crate::*;
use std::sync::Arc;
use table_client::*;
use table_core::*;
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MarketBinding {
    pub deal_id: DealId,
    pub terms_hash: H256,
    pub mandate_id: MandateId,
    pub mandate_version: u32,
    pub currency: Currency,
    /// The market product the deal's rules bind to its item (market-data-2): the only product a
    /// market record for this deal may price.
    pub product_id: String,
}
/// A market record may be stored for the deal only when it is re-checkable and prices the
/// product the binding names.
pub(crate) fn record_prices(reference: &MarketRef, product_id: &str) -> bool {
    reference
        .certificate
        .as_ref()
        .is_some_and(|c| c.product_id == product_id)
        && reference.validate().is_ok()
}
/// market_refresh's answer when the market has no comparable prices for the item.
pub(crate) const NO_COMPARABLES: &str =
    "The market has no comparable prices for this item, so no market price was kept.";
/// The market key's name in the process environment and in a `.env` file.
const MARKET_KEY_NAME: &str = "CHANNEL3_API_KEY";
/// One value as a `.env` line writes it: quoted, or up to the first whitespace (so a trailing
/// `# comment` is not part of it). Empty is no value.
fn env_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let value = match raw.chars().next() {
        Some(q @ ('"' | '\'')) => raw[1..].split(q).next().unwrap_or(""),
        _ => raw.split_whitespace().next().unwrap_or(""),
    };
    (!value.is_empty() && !value.starts_with('#')).then(|| value.to_owned())
}
/// The market key a `.env` file names, if any.
fn market_key_in_dotenv(text: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let line = line.trim_start();
        let line = line.strip_prefix("export ").unwrap_or(line);
        let (name, value) = line.split_once('=')?;
        (name.trim() == MARKET_KEY_NAME).then(|| env_value(value))?
    })
}
/// A market key for whoever runs the app without one in the vault (a judge's own key): the process
/// environment first, then the nearest `.env` from `start` upward that names it.
#[must_use]
pub fn market_key_from_environment(start: &std::path::Path) -> Option<String> {
    if let Some(key) = std::env::var(MARKET_KEY_NAME)
        .ok()
        .as_deref()
        .and_then(env_value)
    {
        return Some(key);
    }
    start
        .ancestors()
        .find_map(|dir| market_key_in_dotenv(&std::fs::read_to_string(dir.join(".env")).ok()?))
}
/// The market key: the vault's when it holds one, else the one from the environment.
pub struct VaultMarketKey(pub Arc<dyn crate::vault::Vault>, pub Option<String>);
impl std::fmt::Debug for VaultMarketKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultMarketKey { [REDACTED] }")
    }
}
#[async_trait::async_trait]
impl table_market::ApiKey for VaultMarketKey {
    async fn load(&self) -> Result<table_paypal::http::Secret, table_market::Error> {
        let Some(bytes) = self
            .0
            .read("channel3")
            .map_err(|_| table_market::Error::Unavailable)?
        else {
            return self
                .1
                .as_deref()
                .map(|key| table_paypal::http::Secret::new(key.into()))
                .ok_or(table_market::Error::Unavailable);
        };
        let text = std::str::from_utf8(&bytes).map_err(|_| table_market::Error::Unavailable)?;
        Ok(table_paypal::http::Secret::new(text.into()))
    }
}
impl Runtime {
    pub fn attach_market(&mut self, market: Arc<dyn table_market::MarketApi>) {
        self.market = Some(market);
    }
    /// Says a market key came from the environment, so settings report the market as configured.
    pub fn note_market_key_from_environment(&mut self) {
        self.market_key_from_environment = true;
    }
    pub(crate) fn prepare_market(&mut self, id: DealId) -> Result<MarketBinding, CommandError> {
        if self.selected != Some(id) {
            return Err(permission());
        }
        self.select_signer(id)?;
        let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
        if deal.mode == Mode::Replay || deal.state.terminal() {
            return Err(invalid());
        }
        let category = app(self.pipeline.wallet.ledger.deal_category(id))?;
        self.pipeline
            .wallet
            .check_mandate(id, category, self.clock.now())?;
        let mandate = app(self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.pipeline.wallet.owner_public_key(),
        ))?;
        // An item no rule binds to a market product has no market price to fetch.
        let product_id = mandate
            .payload
            .market_product_for(&deal.terms.item_ref)
            .ok_or_else(invalid)?
            .to_owned();
        Ok(MarketBinding {
            deal_id: id,
            terms_hash: deal.terms.hash().map_err(table_app::Error::from)?,
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            currency: deal.terms.currency,
            product_id,
        })
    }
    pub(crate) fn store_market(
        &mut self,
        binding: MarketBinding,
        reference: MarketRef,
    ) -> Result<MarketRef, CommandError> {
        let current = self.prepare_market(binding.deal_id)?;
        if current.terms_hash != binding.terms_hash
            || current.mandate_id != binding.mandate_id
            || current.mandate_version != binding.mandate_version
            || current.currency != binding.currency
            || current.product_id != binding.product_id
            || !record_prices(&reference, &binding.product_id)
        {
            return Err(invalid());
        }
        app(self.pipeline.wallet.ledger.store_market_reference(
            binding.deal_id,
            &reference,
            self.clock.now(),
        ))?;
        Ok(reference)
    }
}
impl ActorHandle {
    pub async fn market_refresh(
        &self,
        caller: Caller,
        args: MarketRefreshArgs,
    ) -> Result<MarketRef, CommandError> {
        // The one product-id rule the market client and the mandate's binding also use.
        if !table_core::market_product_valid(&args.product_id) {
            return Err(invalid());
        }
        let binding: MarketBinding = self
            .execute(
                Caller {
                    label: caller.label.clone(),
                    token: caller.token.clone(),
                },
                Action::MarketPrepare(args.deal_id),
            )
            .await?;
        // The asked product must be the one the deal's rules bind to its item: refused before
        // any market call.
        if args.product_id != binding.product_id {
            return Err(invalid());
        }
        let market = self
            .market
            .as_ref()
            .ok_or_else(|| unavailable("Market executor not attached"))?;
        let reference = market
            .comparables(&args.product_id, binding.currency)
            .await
            .map_err(|error| match error {
                // An answer about the item, not an outage: trying again will not change it.
                table_market::Error::NoReference => unavailable(NO_COMPARABLES),
                _ => unavailable("Market reference unavailable"),
            })?;
        self.execute(caller, Action::MarketStore(binding, reference))
            .await
    }
}
#[cfg(test)]
mod tests {
    use super::{env_value, market_key_in_dotenv};
    #[test]
    fn a_dotenv_key_is_read_without_quotes_or_a_trailing_comment() {
        for line in [
            "CHANNEL3_API_KEY=abc",
            "CHANNEL3_API_KEY = abc  # from the dashboard, key=value",
            "CHANNEL3_API_KEY=\"abc\" # quoted",
            "export CHANNEL3_API_KEY='abc'",
        ] {
            assert_eq!(market_key_in_dotenv(line).as_deref(), Some("abc"), "{line}");
        }
    }
    #[test]
    fn a_blank_comment_only_or_other_line_is_no_key() {
        for text in [
            "CHANNEL3_API_KEY=",
            "CHANNEL3_API_KEY=   # paste yours here",
            "#CHANNEL3_API_KEY=abc",
            "OTHER=abc
CHANNEL3_DEMO_PRODUCT_ID=abc",
        ] {
            assert_eq!(market_key_in_dotenv(text), None, "{text}");
        }
        assert_eq!(env_value("\"\""), None);
    }
}
