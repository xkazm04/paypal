//! Wallet-wide limits (T14): the owner signs them in the approval window; every window reads the
//! limits and the live exposure numbers. The check itself runs in table-app, after the mandate.
use crate::{Runtime, app};
use table_client::*;
use table_core::*;
use table_proto::AgentSigner;

impl Runtime {
    /// Signs and stores the next version of the wallet limits. A limit set that could never be
    /// used (zero, mixed currency, already expired) is REFUSED with its reason, before signing.
    pub(crate) fn sign_envelope(
        &mut self,
        args: EnvelopeSignArgs,
    ) -> Result<SignedEnvelope, CommandError> {
        let now = self.clock.now();
        let payload = WalletEnvelope {
            version: app(self.pipeline.wallet.ledger.next_envelope_version())?,
            currency: args.currency,
            max_out_day: args.max_out_day,
            max_held: args.max_held,
            max_deals_day: args.max_deals_day,
            expires: args.expires,
        };
        payload.validate().map_err(table_app::Error::from)?;
        if payload.expires <= now {
            return Err(table_app::Error::from(Refusal {
                clause: ENVELOPE_CLAUSE,
                reason: "expires: the wallet limits would already have run out".into(),
            })
            .into());
        }
        let signer = AgentSigner::from_key(self.owner()?);
        let envelope = SignedEnvelope {
            owner_sig: signer
                .sign_wallet_envelope(&payload)
                .map_err(table_app::Error::from)?,
            payload,
        };
        app(self.pipeline.wallet.ledger.insert_wallet_envelope(
            &envelope,
            &signer.public_key(),
            now,
        ))?;
        Ok(envelope)
    }
    /// Limits and live exposure numbers only: no deal, counterparty, key or signature.
    pub(crate) fn envelope_view(&self) -> Result<ExposureView, CommandError> {
        let now = self.clock.now();
        let ledger = &self.pipeline.wallet.ledger;
        let currencies =
            fold_exposure(&app(ledger.exposure_deals())?, now).map_err(table_app::Error::from)?;
        let (status, limits, signed_at) =
            match ledger.active_wallet_envelope(&self.owner()?.verifying_key()) {
                Ok(None) => (EnvelopeStatus::None, None, None),
                Ok(Some((envelope, at))) => (
                    if now >= envelope.payload.expires {
                        EnvelopeStatus::Expired
                    } else {
                        EnvelopeStatus::Active
                    },
                    Some(envelope.payload),
                    Some(at),
                ),
                Err(table_ledger::LedgerError::Sql(error)) => {
                    return app(Err(table_ledger::LedgerError::Sql(error)));
                }
                // Fail closed and say so: the agents' money out is refused until they are signed
                // again (table-app `envelope_check`).
                Err(_) => (EnvelopeStatus::Unverified, None, None),
            };
        Ok(ExposureView {
            status,
            limits,
            signed_at,
            currencies,
            day_start: utc_day(now).saturating_mul(86_400),
        })
    }
}
