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
}
pub struct VaultMarketKey(pub Arc<dyn crate::vault::Vault>);
impl std::fmt::Debug for VaultMarketKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("VaultMarketKey { [REDACTED] }")
    }
}
#[async_trait::async_trait]
impl table_market::ApiKey for VaultMarketKey {
    async fn load(&self) -> Result<table_paypal::http::Secret, table_market::Error> {
        let bytes = self
            .0
            .read("channel3")
            .map_err(|_| table_market::Error::Unavailable)?
            .ok_or(table_market::Error::Unavailable)?;
        let text = std::str::from_utf8(&bytes).map_err(|_| table_market::Error::Unavailable)?;
        Ok(table_paypal::http::Secret::new(text.into()))
    }
}
impl Runtime {
    pub fn attach_market(&mut self, market: Arc<dyn table_market::MarketApi>) {
        self.market = Some(market);
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
        Ok(MarketBinding {
            deal_id: id,
            terms_hash: deal.terms.hash().map_err(table_app::Error::from)?,
            mandate_id: deal.mandate_id,
            mandate_version: deal.mandate_version,
            currency: deal.terms.currency,
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
        if args.product_id.is_empty()
            || args.product_id.len() > 128
            || !args
                .product_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
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
        let market = self
            .market
            .as_ref()
            .ok_or_else(|| unavailable("Market executor not attached"))?;
        let reference = market
            .comparables(&args.product_id, binding.currency)
            .await
            .map_err(|_| unavailable("Market reference unavailable"))?;
        self.execute(caller, Action::MarketStore(binding, reference))
            .await
    }
}
