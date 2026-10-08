//! Owner-gated configuration writes; no model input reaches these methods.
use crate::vault::CredentialEntry;
use crate::{Runtime, app, invalid, permission, unavailable, vault::existing_signing_key};
use table_client::*;
use table_core::*;
use table_proto::AgentSigner;
use zeroize::Zeroizing;
impl Runtime {
    /// Selects what the approval window opens on and keeps Main's draft for it. Every draft is
    /// checked here for shape and binding only (the right target, a deal or mandate it can apply
    /// to, one currency); nothing is signed, rebound or sent. The approval window shows it, the
    /// owner may change it, and the privileged command re-checks everything when it is signed.
    pub(crate) fn open_approval(
        &mut self,
        label: &str,
        args: ApprovalOpenArgs,
    ) -> Result<(), CommandError> {
        let target = args.target.or(if args.pairing.is_some() {
            Some(ApprovalTarget::Pairing)
        } else if args.deal_id.is_some() {
            Some(ApprovalTarget::Deal)
        } else {
            None
        });
        let shape = match target {
            Some(ApprovalTarget::Deal) => args.deal_id.is_some() && args.pairing.is_none(),
            Some(ApprovalTarget::Pairing) => args.pairing.is_some() && args.deal_id.is_none(),
            _ => args.deal_id.is_none() && args.pairing.is_none(),
        };
        if !shape {
            return Err(invalid());
        }
        if let Some(draft) = &args.draft {
            // Drafts are typed in Main's pages; the Tumbler only routes.
            if label != "main" {
                return Err(permission());
            }
            self.check_draft(target, args.deal_id, draft)?;
        }
        if let Some(id) = args.pairing {
            if label != "main"
                || !self
                    .pending
                    .get(&id)
                    .is_some_and(|p| p.peer.identity.expires > self.clock.now())
            {
                return Err(if label != "main" {
                    permission()
                } else {
                    invalid()
                });
            }
            self.selected_pairing = Some(id);
            self.selected = None;
        } else {
            if let Some(id) = args.deal_id {
                app(self.pipeline.wallet.ledger.get_deal(id))?;
            }
            self.selected = args.deal_id;
            self.selected_pairing = None;
        }
        self.approval_target = target;
        self.approval_draft = args.draft;
        Ok(())
    }
    fn check_draft(
        &self,
        target: Option<ApprovalTarget>,
        deal_id: Option<DealId>,
        draft: &ApprovalDraft,
    ) -> Result<(), CommandError> {
        let band_covering = |m: &OpenMandate, item: &ItemRef| {
            m.payload.clauses.iter().find_map(|c| match c {
                Clause::Band {
                    item_refs,
                    floor,
                    ceiling,
                    ..
                } if item_refs.contains(item) => Some((*floor, *ceiling)),
                _ => None,
            })
        };
        match draft {
            ApprovalDraft::Band { floor, ceiling } => {
                let id = deal_id
                    .filter(|_| target == Some(ApprovalTarget::Deal))
                    .ok_or_else(invalid)?;
                let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
                let currency = deal.terms.currency;
                // The same window band_set accepts: before settlement, a band naming the item.
                let movable = matches!(
                    deal.state,
                    DealState::Pairing
                        | DealState::Listed
                        | DealState::Negotiating
                        | DealState::Agreed
                ) && deal.paypal.order.is_none();
                let m = app(self.pipeline.wallet.ledger.active_mandate(
                    deal.mandate_id,
                    deal.mandate_version,
                    &self.owner()?.verifying_key(),
                ))?;
                if !movable
                    || band_covering(&m, &deal.terms.item_ref).is_none()
                    || (floor.is_none() && ceiling.is_none())
                    || [floor, ceiling]
                        .into_iter()
                        .flatten()
                        .any(|v| v.currency() != currency || v.minor() <= 0)
                    || matches!((floor, ceiling), (Some(f), Some(c)) if f.minor() > c.minor())
                {
                    return Err(invalid());
                }
            }
            ApprovalDraft::Floor {
                mandate_id,
                item_ref,
                floor,
            } => {
                if target != Some(ApprovalTarget::Mandate) || floor.minor() <= 0 {
                    return Err(invalid());
                }
                let m = app(self
                    .pipeline
                    .wallet
                    .ledger
                    .list_mandates(&self.owner()?.verifying_key()))?
                .into_iter()
                .find(|m| m.mandate.payload.id == *mandate_id && m.refusal.is_none())
                .map(|m| m.mandate)
                .ok_or_else(invalid)?;
                let (_, ceiling) = band_covering(&m, item_ref).ok_or_else(invalid)?;
                let currency = m
                    .payload
                    .clauses
                    .iter()
                    .find_map(|c| match c {
                        Clause::PerDeal { max_amount, .. } => Some(max_amount.currency()),
                        _ => None,
                    })
                    .ok_or_else(invalid)?;
                if floor.currency() != currency
                    || ceiling.is_some_and(|c| c.minor() < floor.minor())
                {
                    return Err(invalid());
                }
            }
            ApprovalDraft::Lever { .. } => {
                let id = deal_id
                    .filter(|_| target == Some(ApprovalTarget::Deal))
                    .ok_or_else(invalid)?;
                if app(self.pipeline.wallet.ledger.get_deal(id))?.kind != DealKind::Rescue {
                    return Err(invalid());
                }
            }
        }
        Ok(())
    }
    pub(crate) fn mandate_list(&self) -> Result<Vec<MandateListEntry>, CommandError> {
        let keys = [
            AgentSlot::Negotiator,
            AgentSlot::Shopper,
            AgentSlot::Assistant,
        ]
        .into_iter()
        .map(|slot| {
            existing_signing_key(self.vault.as_ref(), slot.key_name())
                .map(|key| (slot, key.verifying_key().to_bytes()))
                .map_err(|_| unavailable("Agent key unavailable"))
        })
        .collect::<Result<Vec<_>, _>>()?;
        app(self
            .pipeline
            .wallet
            .ledger
            .list_mandates(&self.owner()?.verifying_key()))?
        .into_iter()
        .map(|listed| {
            let agent = keys
                .iter()
                .find(|(_, key)| *key == listed.mandate.payload.agent_key)
                .map(|(slot, _)| *slot)
                .ok_or_else(permission)?;
            Ok(MandateListEntry {
                mandate: listed.mandate,
                agent,
                refusal: listed.refusal,
            })
        })
        .collect()
    }
    pub(crate) fn credentials(&mut self, args: CredentialEntry) -> Result<(), CommandError> {
        let valid = |s: &str| !s.is_empty() && s.len() <= 1024 && !s.chars().any(char::is_control);
        let (name, bytes) = match &args {
            CredentialEntry::PaypalSandbox {
                client_id,
                client_secret,
            } if valid(client_id) && valid(client_secret) => (
                "paypal.sandbox",
                Zeroizing::new(
                    serde_json::to_vec(&(client_id.as_str(), client_secret.as_str()))
                        .map_err(|_| invalid())?,
                ),
            ),
            CredentialEntry::Channel3 { key } if valid(key) => {
                ("channel3", Zeroizing::new(key.as_bytes().to_vec()))
            }
            _ => return Err(invalid()),
        };
        self.vault
            .write(name, &bytes)
            .map_err(|_| unavailable("OS secret store write failed"))?;
        // Only the date is kept beside it, as a plain preference: never the secret or its length.
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference(&format!("credential.{name}.stored_at"), &self.clock.now()))?;
        Ok(())
    }
    /// Read-only owner facts (Settings, Book). No secret, key or permission crosses.
    pub(crate) fn owner_facts(&mut self) -> Result<OwnerFacts, CommandError> {
        let now = self.clock.now();
        let locked = self.pipeline.approval.locked(now);
        let lock_in = self.pipeline.approval.lock_in(now);
        let settings = self.settings()?;
        let credentials = [
            (
                CredentialArgs::PaypalSandbox,
                "paypal.sandbox",
                settings.payment_executor_configured,
            ),
            (
                CredentialArgs::Channel3,
                "channel3",
                settings.channel3_configured,
            ),
        ]
        .into_iter()
        .map(|(kind, name, stored)| {
            Ok(CredentialFact {
                kind,
                stored,
                stored_at: if stored {
                    app(self
                        .pipeline
                        .wallet
                        .ledger
                        .preference::<i64>(&format!("credential.{name}.stored_at")))?
                } else {
                    None
                },
            })
        })
        .collect::<Result<Vec<_>, CommandError>>()?;
        let engines = self
            .engine_info()?
            .into_iter()
            .map(|info| EngineProbe {
                probed_at: self
                    .engine_probed_at
                    .iter()
                    .rev()
                    .find(|(id, _)| *id == info.id)
                    .map(|(_, at)| *at),
                id: info.id,
                available: info.available,
                version: info.version,
                detail: info.reason,
            })
            .collect();
        let mandates = self.mandate_list()?;
        let mut running = std::collections::BTreeMap::<&str, u32>::new();
        for run in self.runs.values() {
            let Ok(deal) = self.pipeline.wallet.ledger.get_deal(run.scope.deal_id) else {
                continue;
            };
            if let Some(m) = mandates.iter().find(|m| {
                m.mandate.payload.id == deal.mandate_id
                    && m.mandate.payload.version == deal.mandate_version
            }) {
                *running.entry(m.agent.key_name()).or_default() += 1;
            }
        }
        let agents = [
            (
                AgentSlot::Negotiator,
                "Haggles at your tables inside a signed band. Signs offers; never pays.",
            ),
            (
                AgentSlot::Shopper,
                "Proposes purchases inside your spend mandate. Money moves only when you decide.",
            ),
            (
                AgentSlot::Assistant,
                "Reads the book and drafts shop and rescue work. No money tool.",
            ),
        ]
        .into_iter()
        .map(|(slot, does)| AgentRosterEntry {
            slot,
            engine: self.engine,
            does: does.into(),
            mandates: mandates
                .iter()
                .filter(|m| m.agent == slot)
                .map(|m| m.mandate.payload.id)
                .collect(),
            running: running.get(slot.key_name()).copied().unwrap_or(0),
        })
        .collect();
        Ok(OwnerFacts {
            locked,
            lock_in,
            last_reporting_poll: app(self.pipeline.wallet.ledger.last_reporting_poll())?
                .map(|(at, status)| ReportingPoll { at, status }),
            engines,
            credentials,
            agents,
            market_watch: self.market_watch_facts()?,
            owner_key_id: table_proto::key_id(&self.pipeline.wallet.owner_public_key())
                .map_err(|_| unavailable("Owner key unavailable"))?,
        })
    }
    /// The audit chain for Book, newest first, projected to closed facts.
    pub(crate) fn audit_page(&self, args: AuditPageArgs) -> Result<AuditPage, CommandError> {
        if !(1..=200).contains(&args.limit) {
            return Err(invalid());
        }
        let (records, more) = app(self
            .pipeline
            .wallet
            .ledger
            .audit_page(args.before, args.limit))?;
        let next_before = if more {
            records.last().map(|r| r.seq)
        } else {
            None
        };
        let rows = records
            .into_iter()
            .map(|r| {
                let field = |k: &str| r.detail.get(k).cloned();
                // The owner-accept row records the literal "owner"; every other decision row
                // carries a typed DecidedBy.
                let decided_by = match field("decided_by") {
                    Some(serde_json::Value::String(s)) if s == "owner" => {
                        Some(DecidedBy::Human { at: r.at })
                    }
                    Some(v) => serde_json::from_value(v).ok(),
                    None => None,
                };
                AuditRow {
                    seq: r.seq,
                    at: r.at,
                    decided_by,
                    from: field("from").and_then(|v| serde_json::from_value(v).ok()),
                    to: field("to").and_then(|v| serde_json::from_value(v).ok()),
                    actor: r.actor,
                    action: r.action,
                    deal_id: r.deal_id,
                }
            })
            .collect();
        Ok(AuditPage { rows, next_before })
    }

    /// The unsigned payload `mandate_sign` would sign for these args; `mandate_simulate` replays
    /// the very same payload.
    pub(crate) fn draft_payload(
        &self,
        args: MandateSignArgs,
    ) -> Result<MandatePayload, CommandError> {
        let id = args.id.unwrap_or_else(|| MandateId(ulid::Ulid::new()));
        Ok(MandatePayload {
            id,
            version: app(self.pipeline.wallet.ledger.next_mandate_version(id))?,
            agent_key: existing_signing_key(self.vault.as_ref(), args.agent.key_name())
                .map_err(|_| unavailable("Agent key unavailable"))?
                .verifying_key()
                .to_bytes(),
            clauses: args.clauses,
            not_before: args.not_before,
            expires: args.expires,
        })
    }

    pub(crate) fn sign_mandate(
        &mut self,
        args: MandateSignArgs,
    ) -> Result<OpenMandate, CommandError> {
        let payload = self.draft_payload(args)?;
        // A policy rule's refusal is an answer for the owner, not a ledger fault: it travels as
        // REFUSED with its reason. verify_mandate_signature stays the fail-closed backstop.
        payload.validate().map_err(table_app::Error::from)?;
        let signer = AgentSigner::from_key(self.owner()?);
        let mandate = OpenMandate {
            owner_sig: signer
                .sign_payload(&payload)
                .map_err(table_app::Error::from)?,
            payload,
        };
        app(self.pipeline.wallet.ledger.insert_mandate(
            &mandate,
            &signer.public_key(),
            self.clock.now(),
        ))?;
        Ok(mandate)
    }

    pub(crate) fn band(&mut self, args: BandArgs) -> Result<OpenMandate, CommandError> {
        if self.selected != Some(args.deal_id) {
            return Err(permission());
        }
        let deal = app(self.pipeline.wallet.ledger.get_deal(args.deal_id))?;
        if !matches!(
            deal.state,
            DealState::Pairing | DealState::Listed | DealState::Negotiating | DealState::Agreed
        ) || deal.paypal.order.is_some()
        {
            return Err(invalid());
        }
        let mut mandate = app(self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ))?;
        let mut changed = false;
        for clause in &mut mandate.payload.clauses {
            if let Clause::Band {
                item_refs,
                floor,
                ceiling,
                ..
            } = clause
                && item_refs.contains(&deal.terms.item_ref)
            {
                *floor = args.floor;
                *ceiling = args.ceiling;
                changed = true;
            }
        }
        if !changed {
            return Err(invalid());
        }
        mandate.payload.version = app(self
            .pipeline
            .wallet
            .ledger
            .next_mandate_version(deal.mandate_id))?;
        // Clearing the only bound the roles use is refused here, as REFUSED, before anything
        // is signed, inserted or rebound.
        mandate.payload.validate().map_err(table_app::Error::from)?;
        let signer = AgentSigner::from_key(self.owner()?);
        mandate.owner_sig = signer
            .sign_payload(&mandate.payload)
            .map_err(table_app::Error::from)?;
        app(self.pipeline.wallet.ledger.insert_mandate(
            &mandate,
            &signer.public_key(),
            self.clock.now(),
        ))?;
        app(self.pipeline.wallet.ledger.rebind_mandate(
            deal.id,
            mandate.payload.version,
            self.clock.now(),
        ))?;
        Ok(mandate)
    }
}
