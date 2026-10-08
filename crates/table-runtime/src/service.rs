use crate::{
    app, invalid, permission,
    reauth::OsReauth,
    unavailable,
    vault::{Vault, existing_signing_key, signing_key},
};
use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};
use table_app::{Authority, Pipeline};
use table_client::*;
use table_core::*;
use table_proto::AgentSigner;

/// How long a purchase with no Band clause waits for the owner before it lapses with no money
/// moved (DECISIONS section 8).
const PURCHASE_DECISION_WINDOW_SECS: i64 = 24 * 3600;

#[derive(Debug, Clone, Copy)]
pub enum Decision {
    OwnerAccept,
    Countersign,
    Capture,
    Void,
    ReleaseHold,
    Rescue,
    OpenBrowser,
}
impl Decision {
    /// The decision's name in its audit row (the command that carried it).
    pub fn name(self) -> &'static str {
        match self {
            Self::OwnerAccept => "deal_owner_accept",
            Self::Countersign => "deal_countersign",
            Self::Capture => "deal_capture",
            Self::Void => "deal_void",
            Self::ReleaseHold => "shield_release",
            Self::Rescue => "rescue_approve",
            Self::OpenBrowser => "open_paypal_in_browser",
        }
    }
}
/// The plain-words refusal when the checklist changed between the owner's read and the click.
pub const SUMMARY_CHANGED: &str = "The summary changed. Review it again.";
/// The plain-words refusal of a money decision while a check on the deal fails.
pub const CHECK_FAILED: &str = "A check on this deal failed, so nothing was done.";
fn summary_changed() -> CommandError {
    CommandError {
        code: ErrorCode::Invalid,
        message: SUMMARY_CHANGED.into(),
    }
}
fn check_failed() -> CommandError {
    CommandError {
        code: ErrorCode::Invalid,
        message: CHECK_FAILED.into(),
    }
}
pub(crate) struct PendingPair {
    pub(crate) house: bool,
    pub(crate) peer: SignedPairingIdentity,
    pub(crate) words: PairingWords,
}
impl std::fmt::Debug for PendingPair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("PendingPair")
    }
}
pub struct Runtime {
    pub(crate) house_release: Option<table_proto::HouseRelease>,
    pub(crate) house_state: HouseState,
    pub(crate) pipeline: Pipeline,
    pub(crate) vault: Arc<dyn Vault>,
    pub(crate) reauth: Arc<dyn OsReauth>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) selected: Option<DealId>,
    pub(crate) selected_pairing: Option<H256>,
    /// What the approval window was last opened for, and Main's draft for it (pre-fill only).
    pub(crate) approval_target: Option<ApprovalTarget>,
    pub(crate) approval_draft: Option<ApprovalDraft>,
    pub(crate) preferences: TumblerPreferences,
    pub(crate) paused: bool,
    pub(crate) engine: table_engine::EngineId,
    pub(crate) pending: HashMap<H256, PendingPair>,
    pub(crate) pairing_offers: HashMap<H256, PairingOffer>,
    pub(crate) last_poll: BTreeMap<DealId, i64>,
    pub(crate) engines: Vec<(
        Arc<dyn table_engine::EngineAdapter>,
        table_engine::EngineInfo,
    )>,
    pub(crate) runs: BTreeMap<RunId, crate::engines::ActiveRun>,
    pub(crate) run_history: Vec<table_client::RunSnapshot>,
    pub(crate) mcp: Option<(Arc<table_mcp::Server>, String)>,
    pub(crate) actor_sender: Option<tokio::sync::mpsc::WeakSender<crate::actor::Message>>,
    pub(crate) market: Option<Arc<dyn table_market::MarketApi>>,
    pub(crate) relay: Option<Arc<dyn table_relay::RelayApi>>,
    pub(crate) relay_busy: bool,
    pub(crate) relay_retry_at: i64,
    pub(crate) relay_failures: u8,
    pub(crate) relay_offset: usize,
    pub(crate) secondary: Option<Arc<dyn table_paypal::SecondaryApi>>,
    /// Targeted events a command produced, sent by the actor loop after the command returns.
    pub(crate) emitted: Vec<crate::WalletEvent>,
    /// When each engine executable was probed this session.
    pub(crate) engine_probed_at: Vec<(table_engine::EngineId, i64)>,
    /// The transcript head each deal's last policy run was armed for: one run per peer message.
    pub(crate) armed: BTreeMap<DealId, H256>,
    /// The house's signed record kept beside HOUSE receipts (T9).
    pub(crate) witness: crate::witness::Witness,
    /// Deals whose market-watch price check is in flight (T15): never two at once for a deal.
    pub(crate) market_watch_busy: std::collections::BTreeSet<DealId>,
    /// When a deal whose price check failed may be checked again.
    pub(crate) market_watch_retry: BTreeMap<DealId, i64>,
    /// Rules (mandate, version, allowance) whose price checks are used up, until the day ends.
    pub(crate) market_watch_used_up: BTreeMap<(MandateId, u32, u16), i64>,
    /// Rungs already in the audit log (deal, deadline, rung), so the 1 s attention read asks the
    /// ledger once per rung; the ledger's own check keeps them unique across restarts.
    pub(crate) rungs_recorded: std::collections::BTreeSet<(DealId, i64, LadderRung)>,
    /// Test-only: makes every rung write fail, to prove a default never waits on one.
    #[cfg(test)]
    pub(crate) fail_rungs: bool,
    /// Test-only: overrides the signed band in the brief, to prove the mandate still refuses.
    #[cfg(test)]
    pub(crate) brief_tamper: Option<(Option<Money>, Option<Money>)>,
    /// Test-only: makes `attention()` fail, to prove the actor surfaces the fault.
    #[cfg(test)]
    pub(crate) fail_attention: Arc<std::sync::atomic::AtomicBool>,
    /// Test-only: makes the walk-away forecast read fail, to prove attention still answers.
    #[cfg(test)]
    pub(crate) fail_forecast: bool,
}
impl std::fmt::Debug for Runtime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Runtime")
            .field("pipeline", &self.pipeline)
            .finish_non_exhaustive()
    }
}
impl Runtime {
    pub fn new(
        ledger: table_ledger::Ledger,
        vault: Arc<dyn Vault>,
        reauth: Arc<dyn OsReauth>,
        api: Arc<dyn table_paypal::PayPalApi>,
        clock: Arc<dyn Clock>,
    ) -> Result<Self, CommandError> {
        // The owner identity is minted only for a fresh wallet. Once the ledger holds anything,
        // a missing owner key fails closed rather than re-keying the wallet's signed history.
        let owner = if app(ledger.is_fresh())? {
            signing_key(vault.as_ref(), "owner")
        } else {
            existing_signing_key(vault.as_ref(), "owner")
        }
        .map_err(|_| unavailable("Owner key provisioning failed"))?;
        for slot in [
            AgentSlot::Negotiator,
            AgentSlot::Shopper,
            AgentSlot::Assistant,
        ] {
            signing_key(vault.as_ref(), slot.key_name())
                .map_err(|_| unavailable("Agent key provisioning failed"))?;
        }
        let signer = AgentSigner::from_key(
            signing_key(vault.as_ref(), AgentSlot::Negotiator.key_name())
                .map_err(|_| unavailable("Agent key unavailable"))?,
        );
        let preferences = app(ledger.preference("tumbler"))?.unwrap_or_default();
        let engine = app(ledger.preference("engine"))?.unwrap_or(table_engine::EngineId::Scripted);
        let paused = app(ledger.preference("agents_paused"))?.unwrap_or(false);
        let pipeline = Pipeline::new(
            table_app::Wallet::new(ledger, signer, owner.verifying_key()),
            api,
            clock.now(),
        )?;
        Ok(Self {
            house_release: table_proto::HouseRelease::compiled().ok(),
            house_state: if table_proto::HouseRelease::compiled().is_ok() {
                HouseState::Idle
            } else {
                HouseState::Unavailable
            },
            pipeline,
            vault,
            reauth,
            clock,
            selected: None,
            selected_pairing: None,
            approval_target: None,
            approval_draft: None,
            preferences,
            paused,
            engine,
            pending: HashMap::new(),
            pairing_offers: HashMap::new(),
            last_poll: BTreeMap::new(),
            engines: vec![],
            runs: BTreeMap::new(),
            run_history: vec![],
            mcp: None,
            actor_sender: None,
            market: None,
            relay: None,
            relay_busy: false,
            relay_retry_at: 0,
            relay_failures: 0,
            relay_offset: 0,
            secondary: None,
            emitted: Vec::new(),
            engine_probed_at: Vec::new(),
            armed: BTreeMap::new(),
            witness: crate::witness::Witness::default(),
            market_watch_busy: std::collections::BTreeSet::new(),
            market_watch_retry: BTreeMap::new(),
            market_watch_used_up: BTreeMap::new(),
            rungs_recorded: std::collections::BTreeSet::new(),
            #[cfg(test)]
            fail_rungs: false,
            #[cfg(test)]
            brief_tamper: None,
            #[cfg(test)]
            fail_attention: Arc::default(),
            #[cfg(test)]
            fail_forecast: false,
        })
    }
    pub(crate) fn owner(&self) -> Result<ed25519_dalek::SigningKey, CommandError> {
        existing_signing_key(self.vault.as_ref(), "owner")
            .map_err(|_| unavailable("Owner key unavailable"))
    }
    /// True when the deal's mandate version is no longer active (revoked, superseded, expired).
    /// It grants nothing, so the deal is left to its deadline default.
    pub(crate) fn mandate_retired(&self, deal: &Deal) -> Result<bool, CommandError> {
        match self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ) {
            Ok(_) => Ok(false),
            Err(table_ledger::LedgerError::NotFound) => Ok(true),
            Err(e) => app(Err(e)),
        }
    }
    pub(crate) fn select_signer(&mut self, id: DealId) -> Result<(), CommandError> {
        let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
        let m = app(self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ))?;
        self.select_agent(m.payload.agent_key)
    }
    /// Select the agent signer whose public key a mandate pins; refused when no slot holds it.
    pub(crate) fn select_agent(&mut self, agent_key: [u8; 32]) -> Result<(), CommandError> {
        for slot in [
            AgentSlot::Negotiator,
            AgentSlot::Shopper,
            AgentSlot::Assistant,
        ] {
            let key = existing_signing_key(self.vault.as_ref(), slot.key_name())
                .map_err(|_| unavailable("Agent key unavailable"))?;
            if key.verifying_key().to_bytes() == agent_key {
                self.pipeline
                    .wallet
                    .select_signer(AgentSigner::from_key(key));
                return Ok(());
            }
        }
        Err(permission())
    }
    pub(crate) fn guard(&mut self, label: &str, token: Option<&str>) -> Result<(), CommandError> {
        self.pipeline
            .approval
            .check(label, token.ok_or_else(permission)?, self.clock.now())?;
        Ok(())
    }
    pub fn settings(&mut self) -> Result<SettingsSnapshot, CommandError> {
        Ok(SettingsSnapshot {
            house: self.house_state,
            mode: Mode::Sandbox,
            locked: self.pipeline.approval.locked(self.clock.now()),
            native_reauth_available: self.reauth.supported(),
            payment_executor_configured: self
                .vault
                .read("paypal.sandbox")
                .map_err(|_| unavailable("OS secret store unavailable"))?
                .is_some(),
            channel3_configured: self
                .vault
                .read("channel3")
                .map_err(|_| unavailable("OS secret store unavailable"))?
                .is_some(),
            first_run: app(self
                .pipeline
                .wallet
                .ledger
                .list_mandates(&self.owner()?.verifying_key()))?
            .is_empty(),
            agents_paused: self.paused,
            selected_engine: self.engine,
            preferences: self.preferences.clone(),
            meters_available: false,
            client_pending: false,
            relay_available: self.relay.is_some(),
            authority_manifest: table_client::authority::manifest_hex()
                .ok_or_else(invalid)?
                .to_owned(),
        })
    }
    pub fn summary(&mut self, id: DealId) -> Result<ApprovalSummary, CommandError> {
        let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
        let configured = self.settings()?.payment_executor_configured;
        let locked = self.pipeline.approval.locked(self.clock.now());
        // A rescue fix is the owner's to approve whatever the failure's mode: its invoice is real
        // and a replayed failure is never counted (table-app rescue.rs).
        let rescue = deal.kind == DealKind::Rescue;
        let supported = if rescue {
            self.secondary.is_some() && self.rescue_releasable(&deal)?
        } else {
            (deal.side == Side::Seller || deal.kind == DealKind::Purchase)
                && deal.kind != DealKind::Invoice
                && deal.mode != Mode::Replay
        };
        let counter_hash = self
            .pipeline
            .wallet
            .ledger
            .last_proposal(id)
            .ok()
            .filter(|(_, _, dir, counter)| *dir == table_ledger::Direction::Inbound && *counter)
            .map(|(_, hash, _, _)| hash);
        let can_owner_accept = !locked
            && counter_hash.is_some_and(|hash| {
                self.select_signer(id).is_ok()
                    && self
                        .pipeline
                        .wallet
                        .ledger
                        .deal_category(id)
                        .is_ok_and(|category| {
                            self.pipeline
                                .check_owner_accept(id, hash, category, self.clock.now())
                                .is_ok()
                        })
            });
        let (checks, checks_hash) = self.approval_checks(id)?;
        Ok(ApprovalSummary {
            checks,
            checks_hash,
            evidence: app(self.pipeline.wallet.ledger.deal_evidence(id))?,
            attempt: app(self.pipeline.wallet.ledger.settled_attempt(id))?.max(1),
            terms_hash: deal.terms.hash().map_err(table_app::Error::from)?,
            counter_hash,
            can_owner_accept,
            can_open_paypal: !locked
                && deal.mode == Mode::Sandbox
                && deal.state == DealState::AwaitingApproval
                && app(self.pipeline.wallet.ledger.deadline(id))?
                    .is_some_and(|(due, _)| due > self.clock.now())
                && self
                    .pipeline
                    .wallet
                    .ledger
                    .active_mandate(
                        deal.mandate_id,
                        deal.mandate_version,
                        &self.owner()?.verifying_key(),
                    )
                    .is_ok_and(|m| m.payload.expires > self.clock.now())
                && self
                    .pipeline
                    .approval_link(id, app(self.pipeline.wallet.ledger.settled_attempt(id))?)
                    .is_ok(),
            can_release: configured
                && !locked
                && supported
                && !deal.state.terminal()
                && deal.state != DealState::Mismatch
                && deal.shield != Some(ShieldVerdict::Block),
            unavailable_reason: if deal.side == Side::Buyer
                && matches!(deal.kind, DealKind::Haggle | DealKind::ShopOrder)
                && deal.mode == Mode::Sandbox
            {
                Some(
                    "Seller-owned order: approve on PayPal; the seller authorizes and captures"
                        .into(),
                )
            } else if rescue && self.secondary.is_none() {
                Some("Invoicing executor is unavailable".into())
            } else if rescue && !supported {
                None
            } else if !supported {
                Some("This executor is deferred or replay-only".into())
            } else if !configured {
                Some("Enter PayPal sandbox credentials".into())
            } else {
                None
            },
            rescue: self.rescue_view(id)?,
            deal,
            locked,
        })
    }

    /// The approval checklist for `id` now, and its hash. The deal's agent signer is selected
    /// first, as every money step does; a retired mandate fails that and reads as a failed line.
    pub(crate) fn approval_checks(
        &mut self,
        id: DealId,
    ) -> Result<(Vec<ApprovalCheck>, H256), CommandError> {
        // Ignored on purpose: without the right signer the mandate line fails closed.
        let _ = self.select_signer(id);
        let checks = self.pipeline.approval_checks(id, self.clock.now())?;
        let hash = checks_hash(&checks).map_err(|_| invalid())?;
        Ok((checks, hash))
    }

    fn record(
        &mut self,
        id: DealId,
        decision: Decision,
        args: &DecisionArgs,
        checks: Option<H256>,
        now: Timestamp,
    ) -> Result<(), CommandError> {
        checks.map_or(Ok(()), |hash| {
            self.record_decision(id, decision, args, hash, now)
        })
    }
    /// Appends the owner's decision row: what was decided, `decided_by` and the hash of the
    /// checklist the owner saw. Written just before the step it starts; the money rows that
    /// follow carry the same `decided_by` (human at the same second).
    fn record_decision(
        &mut self,
        id: DealId,
        decision: Decision,
        args: &DecisionArgs,
        checks: H256,
        now: Timestamp,
    ) -> Result<(), CommandError> {
        app(self
            .pipeline
            .wallet
            .ledger
            .append_audit(&table_ledger::AuditEntry {
                at: now,
                actor: "owner".into(),
                action: "owner.decision".into(),
                deal_id: Some(id),
                detail: serde_json::json!({
                    "decision": decision.name(),
                    "decided_by": DecidedBy::Human { at: now },
                    "checks_hash": checks,
                    "terms_hash": args.terms_hash,
                    "attempt": args.attempt,
                }),
            }))?;
        Ok(())
    }

    pub(crate) async fn decide(
        &mut self,
        label: &str,
        token: Option<&str>,
        args: DecisionArgs,
        decision: Decision,
    ) -> Result<serde_json::Value, CommandError> {
        self.guard(label, token)?;
        if self.selected != Some(args.deal_id) {
            return Err(permission());
        }
        let deal = app(self.pipeline.wallet.ledger.get_deal(args.deal_id))?;
        if args.terms_hash != deal.terms.hash().map_err(table_app::Error::from)?
            || args.attempt != app(self.pipeline.wallet.ledger.settled_attempt(deal.id))?.max(1)
            || deal.state == DealState::Mismatch
            || deal.shield == Some(ShieldVerdict::Block)
        {
            return Err(invalid());
        }
        // Every money decision is bound to the checklist the owner saw: recomputed now, before
        // the ticket, any PayPal call or any write. Void is the safe direction and needs none.
        let checks = if matches!(decision, Decision::Void) {
            None
        } else {
            let (checks, hash) = self.approval_checks(deal.id)?;
            if args.checks_hash != Some(hash) {
                return Err(summary_changed());
            }
            // Releasing a hold is the decision about the shield line, so only that line may fail.
            let exempt =
                matches!(decision, Decision::ReleaseHold).then_some(ApprovalCheckId::Shield);
            if checks
                .iter()
                .any(|c| c.status == ApprovalCheckStatus::Fail && Some(c.id) != exempt)
            {
                return Err(check_failed());
            }
            Some(hash)
        };
        let now = self.clock.now();
        let ticket = self.pipeline.approval.ticket(
            label,
            token.ok_or_else(permission)?,
            deal.id,
            args.terms_hash,
            args.attempt,
            now,
        )?;
        match decision {
            Decision::OwnerAccept => {
                self.select_signer(deal.id)?;
                let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
                self.record(deal.id, decision, &args, checks, now)?;
                self.pipeline.owner_accept(
                    deal.id,
                    args.counter_hash.ok_or_else(invalid)?,
                    category,
                    ticket,
                    &self.owner()?,
                    now,
                )?;
                // Shop around: if this accept agreed a grouped table, its siblings are withdrawn
                // now (the next tick retries and reports a failure).
                let _ = self.close_groups();
            }
            Decision::Void => {
                self.pipeline
                    .owner_void(deal.id, args.attempt, ticket, now)
                    .await?
            }
            Decision::ReleaseHold => {
                self.record(deal.id, decision, &args, checks, now)?;
                self.pipeline
                    .owner_release_hold(deal.id, args.attempt, ticket, now)?
            }
            Decision::Rescue => {
                // The owner's decision on the one fix: the pipeline creates and sends the invoice
                // under this ticket (table-app rescue.rs). Never an agent tool.
                if deal.kind != DealKind::Rescue {
                    return Err(invalid());
                }
                // A fix whose one send already ended is never sent again: refused before the
                // owner's decision row or anything else is written.
                if self.pipeline.rescue_send_ended(deal.id)? {
                    return Err(CommandError {
                        code: ErrorCode::Permission,
                        message: crate::rescue::RESCUE_ENDED.into(),
                    });
                }
                if !self.settings()?.payment_executor_configured || self.secondary.is_none() {
                    return Err(unavailable("Enter PayPal sandbox credentials"));
                }
                self.select_signer(deal.id)?;
                self.record(deal.id, decision, &args, checks, now)?;
                self.pipeline.rescue_approve(deal.id, ticket, now).await?;
            }
            Decision::OpenBrowser => {
                self.select_signer(deal.id)?;
                let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
                self.pipeline.wallet.check_mandate(deal.id, category, now)?;
                let url = self.pipeline.approval_link(deal.id, args.attempt)?;
                self.record(deal.id, decision, &args, checks, now)?;
                return serde_json::to_value(url).map_err(|_| invalid());
            }
            Decision::Countersign | Decision::Capture => {
                if deal.side == Side::Buyer && deal.kind != DealKind::Purchase {
                    return Err(permission());
                }
                self.select_signer(deal.id)?;
                let category = app(self.pipeline.wallet.ledger.deal_category(deal.id))?;
                if !self.settings()?.payment_executor_configured {
                    return Err(unavailable("Enter PayPal sandbox credentials"));
                }
                match (decision, deal.state) {
                    (Decision::Countersign, DealState::Agreed) => {
                        self.record(deal.id, decision, &args, checks, now)?;
                        self.pipeline
                            .create(
                                deal.id,
                                args.attempt,
                                category,
                                Authority::Owner(ticket),
                                now,
                            )
                            .await?;
                    }
                    (Decision::Countersign, DealState::Approved) => {
                        self.record(deal.id, decision, &args, checks, now)?;
                        self.pipeline
                            .authorize(
                                deal.id,
                                args.attempt,
                                category,
                                Authority::Owner(ticket),
                                now,
                            )
                            .await?
                    }
                    (Decision::Capture, DealState::Authorized) => {
                        self.record(deal.id, decision, &args, checks, now)?;
                        self.pipeline
                            .capture(
                                deal.id,
                                args.attempt,
                                category,
                                Authority::Owner(ticket),
                                now,
                            )
                            .await?;
                    }
                    _ => return Err(invalid()),
                }
            }
        }
        serde_json::to_value(app(self.pipeline.wallet.ledger.get_deal(deal.id))?)
            .map_err(|_| invalid())
    }
    pub(crate) fn create_deal(&mut self, args: DealCreateArgs) -> Result<Deal, CommandError> {
        self.create_deal_id(args, DealId(ulid::Ulid::new()))
    }
    pub(crate) fn create_deal_id(
        &mut self,
        args: DealCreateArgs,
        id: DealId,
    ) -> Result<Deal, CommandError> {
        let mandate = app(self.pipeline.wallet.ledger.active_mandate(
            args.mandate_id,
            args.mandate_version,
            &self.owner()?.verifying_key(),
        ))?;
        let deal = Deal {
            created_at: self.clock.now(),
            updated_at: self.clock.now(),
            id,
            kind: args.kind,
            side: args.side,
            counterparty: args.counterparty,
            mandate_id: args.mandate_id,
            mandate_version: args.mandate_version,
            terms: args.terms,
            state: DealState::Pairing,
            transcript_head: H256::ZERO,
            paypal: PaypalRefs::default(),
            mode: Mode::Sandbox,
            market: None,
            shield: None,
            decided_by: None,
            shield_rule: None,
            shield_release: None,
        };
        let (paired, house, mut payee) = app(self
            .pipeline
            .wallet
            .ledger
            .counterparty_policy(&deal.counterparty))?;
        let house_table = if house {
            let table: table_proto::HouseTable = app(self
                .pipeline
                .wallet
                .ledger
                .preference(&format!("house.table.{}", id)))?
            .ok_or_else(invalid)?;
            if table.deal_id != id
                || table.terms != deal.terms
                || table.category != args.category
                || table.negotiation_deadline <= self.clock.now()
            {
                return Err(invalid());
            }
            Some(table)
        } else {
            None
        };
        if deal.side == Side::Seller {
            let payees = mandate
                .payload
                .clauses
                .iter()
                .find_map(|c| {
                    if let Clause::Payees { payees } = c {
                        Some(payees)
                    } else {
                        None
                    }
                })
                .ok_or_else(invalid)?;
            let [own_payee] = payees.as_slice() else {
                return Err(invalid());
            };
            payee = own_payee.clone();
        }
        let usage = app(self
            .pipeline
            .wallet
            .ledger
            .usage_for(&deal, self.clock.now()))?;
        let role = if deal.side == Side::Buyer {
            Role::Buy
        } else if deal.kind == DealKind::ShopOrder {
            Role::Shop
        } else {
            Role::Sell
        };
        mandate
            .payload
            .check(
                &Intent {
                    kind: deal.kind,
                    side: deal.side,
                    role,
                    category: args.category,
                    terms: &deal.terms,
                    counterparty: &deal.counterparty,
                    paired,
                    house,
                    payee: &payee,
                    rounds_used: 0,
                },
                usage,
                self.clock.now(),
            )
            .map_err(table_app::Error::from)?;
        app(self
            .pipeline
            .wallet
            .ledger
            .create_deal(&deal, self.clock.now()))?;
        app(self
            .pipeline
            .wallet
            .ledger
            .set_deal_category(deal.id, args.category))?;
        // The deadline lands before anything that can still fail, so a deal whose relay binding
        // or listing errors below still lapses on silence instead of lingering with no default.
        let band_due = mandate.payload.clauses.iter().find_map(|c| {
            if let Clause::Band { deadline, .. } = c {
                Some(*deadline)
            } else {
                None
            }
        });
        // A purchase under a mandate with no Band still gets a default (DECISIONS section 8).
        let due = match band_due {
            Some(due) => Some(
                house_table
                    .as_ref()
                    .map_or(due, |table| due.min(table.negotiation_deadline)),
            ),
            None if deal.kind == DealKind::Purchase => {
                Some(self.clock.now() + PURCHASE_DECISION_WINDOW_SECS)
            }
            None => None,
        };
        if let Some(due) = due {
            app(self
                .pipeline
                .wallet
                .ledger
                .set_deadline(deal.id, due, None, self.clock.now()))?;
        }
        if app(self
            .pipeline
            .wallet
            .ledger
            .bind_paired_relay(deal.id, self.clock.now()))?
            && deal.side == Side::Seller
        {
            self.select_signer(deal.id)?;
            self.pipeline.wallet.list(deal.id, self.clock.now())?;
        }
        app(self.pipeline.wallet.ledger.get_deal(deal.id))
    }
}
