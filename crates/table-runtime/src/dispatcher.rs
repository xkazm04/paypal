//! Typed command dispatch, including origin, capability and selected-deal checks.
use crate::{Action, Caller, Runtime, app, invalid, permission, unavailable};
use serde::Serialize;
use table_client::*;
use table_core::*;
fn json<T: Serialize>(value: T) -> Result<serde_json::Value, CommandError> {
    serde_json::to_value(value).map_err(|_| invalid())
}
fn allowed(label: &str, labels: &[&str]) -> Result<(), CommandError> {
    if labels.contains(&label) {
        Ok(())
    } else {
        Err(permission())
    }
}
impl Runtime {
    fn needs_owner_accept(&self, deal: &Deal) -> Result<bool, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        if deal.side != Side::Buyer
            || deal.kind != DealKind::Haggle
            || deal.state != DealState::Negotiating
            || !ledger
                .last_proposal(deal.id)
                .is_ok_and(|(_, _, dir, counter)| {
                    dir == table_ledger::Direction::Inbound && counter
                })
            || app(ledger.negotiation_status(deal.id))?.is_none_or(|s| s.own_accept)
        {
            return Ok(false);
        }
        Ok(self.human_present_clause(deal)?.is_some())
    }
    /// Clause 6 of the deal's active mandate when its amount is over the human-present threshold.
    fn human_present_clause(
        &self,
        deal: &Deal,
    ) -> Result<Option<table_attention::ClauseRef>, CommandError> {
        let Ok(m) = self.pipeline.wallet.ledger.active_mandate(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ) else {
            return Ok(None);
        };
        let amount = deal.terms.amount().map_err(table_app::Error::from)?;
        let over = m.payload.clauses.iter().any(|c| {
            matches!(c,Clause::HumanPresentOver {amount: threshold}
            if threshold.currency() == amount.currency() && amount.minor() > threshold.minor())
        });
        Ok(over.then_some(table_attention::ClauseRef {
            mandate_id: deal.mandate_id,
            number: 6,
        }))
    }
    fn deal_display(&self, id: DealId) -> Result<DealDisplay, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let deal = app(ledger.get_deal(id))?;
        let number = app(ledger.display_number(id))?;
        let deadline = app(ledger.deadline(id))?.map(|(due, _)| due);
        let m = app(ledger.mandate_evidence(
            deal.mandate_id,
            deal.mandate_version,
            &self.owner()?.verifying_key(),
        ))?;
        let band = m
            .payload
            .clauses
            .iter()
            .find_map(|c| {
                if let Clause::Band {
                    floor,
                    ceiling,
                    max_rounds,
                    ..
                } = c
                {
                    Some(table_core::DisplayBand {
                        floor: *floor,
                        ceiling: *ceiling,
                        max_rounds: *max_rounds,
                        rounds_used: 0,
                    })
                } else {
                    None
                }
            })
            .map(|mut b| {
                b.rounds_used = ledger.negotiation_rounds(id)?;
                Ok::<_, table_ledger::LedgerError>(b)
            })
            .transpose()
            .map_err(table_app::Error::from)?;
        let item = table_attention::AttentionSource::from_deal(&deal, number, None, None, deadline)
            .map_err(table_app::Error::from)?
            .item(self.clock.now());
        Ok(DealDisplay {
            deal_id: id,
            label: item.label,
            title: deal.terms.item_ref.to_string(),
            deadline,
            on_silence: deadline.map(|_| item.on_silence),
            band,
        })
    }
    pub fn attention(&mut self) -> Result<table_attention::AttentionSnapshot, CommandError> {
        #[cfg(test)]
        if self
            .fail_attention
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(unavailable("Attention unavailable"));
        }
        let now = self.clock.now();
        let mut sources = Vec::new();
        let deals = app(self.pipeline.wallet.ledger.list_deals())?;
        // Owner-entered pairing labels only; the projection already withholds URL-shaped text.
        let names: std::collections::HashMap<_, _> =
            app(self.pipeline.wallet.ledger.counterparty_list())?
                .into_iter()
                .map(|c| (c.key_id, c.display_name))
                .collect();
        for deal in &deals {
            if app(self
                .pipeline
                .wallet
                .ledger
                .preference::<bool>(&format!("lapse.{}", deal.id)))?
            .unwrap_or(false)
            {
                continue;
            }
            let mut source = table_attention::AttentionSource::from_deal(
                deal,
                app(self.pipeline.wallet.ledger.display_number(deal.id))?,
                names.get(&deal.counterparty).cloned(),
                None,
                app(self.pipeline.wallet.ledger.deadline(deal.id))?.map(|d| d.0),
            )
            .map_err(table_app::Error::from)?;
            source.needs_owner_accept = self.needs_owner_accept(deal)?;
            // A gate names the clause that sent it to the owner; holds come from the shield.
            if source.item(now).kind == table_attention::AttnKind::Gate {
                source.clause = self.human_present_clause(deal)?;
            }
            let item = source.item(now);
            if item.kind == table_attention::AttnKind::Gate
                && item
                    .deadline
                    .is_some_and(|due| due.saturating_sub(now) > 900)
                && app(self
                    .pipeline
                    .wallet
                    .ledger
                    .preference::<i64>(&format!("snooze.{}", deal.id)))?
                .is_some_and(|until| until > now)
            {
                continue;
            }
            sources.push(source);
        }
        let mut snapshot =
            table_attention::snapshot(&sources, now, 0, 0.0, self.pipeline.approval.locked(now));
        snapshot.wallet_spend_today_currency = deals
            .first()
            .map(|d| d.terms.currency)
            .filter(|currency| deals.iter().all(|d| d.terms.currency == *currency));
        // A failed read hides the forecast; it never fails the attention snapshot.
        snapshot.forecast = self.forecast(now).ok();
        // Each card's silence line follows the forecast beside it (DECISIONS 15).
        table_attention::word_silence(&mut snapshot, &sources);
        Ok(snapshot)
    }
    pub(crate) async fn execute(
        &mut self,
        caller: Caller,
        action: Action,
    ) -> Result<serde_json::Value, CommandError> {
        let label = caller.label.as_str();
        let token = caller.token.as_deref();
        allowed(label, &["main", "tumbler", "approval"])?;
        match action {
            Action::HouseOffer(args) => {
                allowed(label, &["main"])?;
                json(self.house_offer(args)?)
            }
            Action::HousePair(response) => {
                allowed(label, &["main"])?;
                json(self.house_pair(response)?)
            }
            Action::HouseStatus(state) => {
                allowed(label, &["main"])?;
                self.house_state = state;
                json(())
            }
            Action::MarketPrepare(id) => {
                self.guard(label, token)?;
                json(self.prepare_market(id)?)
            }
            Action::MarketStore(binding, reference) => {
                self.guard(label, token)?;
                json(self.store_market(binding, reference)?)
            }
            Action::ClaimNotification { deal_id, deadline } => {
                allowed(label, &["tumbler"])?;
                let now = self.clock.now();
                if !self.attention()?.items.iter().any(|i| {
                    i.deal_id == deal_id
                        && i.kind == table_attention::AttnKind::Gate
                        && i.deadline == Some(deadline)
                        && deadline > now
                        && deadline.saturating_sub(now) <= 900
                }) {
                    return json(false);
                }
                let key = format!("notification.{deal_id}.{deadline}");
                if app(self.pipeline.wallet.ledger.preference::<bool>(&key))?.unwrap_or(false) {
                    return json(false);
                }
                app(self.pipeline.wallet.ledger.set_preference(&key, &true))?;
                json(true)
            }
            Action::ReleaseNotification { deal_id, deadline } => {
                // Only after a toast failed to show: the rung was not used, so a later tick may
                // claim it again. Releasing can never make money move.
                allowed(label, &["tumbler"])?;
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference(&format!("notification.{deal_id}.{deadline}"), &false))?;
                json(())
            }
            Action::CheckPrivilege => {
                self.guard(label, token)?;
                json(())
            }
            Action::Settings => json(self.settings()?),
            Action::ApprovalSelection => {
                allowed(label, &["approval"])?;
                json(self.selected)
            }
            Action::Display(id) => {
                if label == "approval" && self.selected != Some(id) {
                    return Err(permission());
                }
                json(self.deal_display(id)?)
            }
            Action::Transcript(id) => {
                allowed(label, &["main", "approval"])?;
                if label == "approval" && self.selected != Some(id) {
                    return Err(permission());
                }
                json(app(self.pipeline.wallet.ledger.deal_transcript(id))?)
            }
            Action::Counterparties => {
                allowed(label, &["main", "approval"])?;
                json(app(self.pipeline.wallet.ledger.counterparty_list())?)
            }
            Action::CounterpartyNote(id) => {
                // Untrusted words: the main window only, behind "note ›" and the quarantine box.
                // Never the Tumbler; the approval window has no read of it.
                allowed(label, &["main"])?;
                json(app(self.pipeline.wallet.ledger.latest_note(id))?)
            }
            Action::ListDeals => {
                allowed(label, &["main"])?;
                json(app(self.pipeline.wallet.ledger.list_deals())?)
            }
            Action::Deal(id) => {
                allowed(label, &["main"])?;
                json(app(self.pipeline.wallet.ledger.get_deal(id))?)
            }
            Action::Evidence(id) => {
                allowed(label, &["main"])?;
                json(app(self.pipeline.wallet.ledger.deal_evidence(id))?)
            }
            Action::ExportProof(id) => {
                // Read-only evidence; the owner saves it from the main or approval window.
                allowed(label, &["main", "approval"])?;
                json(self.export_proof(id)?)
            }
            Action::Reconcile(args) => {
                allowed(label, &["main"])?;
                let api = self
                    .secondary
                    .clone()
                    .ok_or_else(|| unavailable("Reporting executor is unavailable"))?;
                if !self.settings()?.payment_executor_configured {
                    return Err(unavailable("Enter PayPal sandbox credentials"));
                }
                self.pipeline
                    .reconcile(
                        args.deal_id,
                        api.as_ref(),
                        table_paypal::ReportingWindow {
                            from: args.start,
                            to: args.end,
                            page: 1,
                            page_size: 500,
                        },
                        self.clock.now(),
                    )
                    .await?;
                json(app(self
                    .pipeline
                    .wallet
                    .ledger
                    .deal_evidence(args.deal_id))?)
            }
            Action::Attention => {
                let mut snapshot = self.attention()?;
                if label == "approval" {
                    snapshot.items.retain(|i| Some(i.deal_id) == self.selected);
                }
                json(snapshot)
            }
            Action::Summary(id) => {
                allowed(label, &["approval"])?;
                if self.selected != Some(id) {
                    return Err(permission());
                }
                json(self.summary(id)?)
            }
            Action::Token => json(self.pipeline.approval.token(label)?),
            Action::Select(id) => {
                allowed(label, &["main", "tumbler"])?;
                if let Some(id) = id {
                    app(self.pipeline.wallet.ledger.get_deal(id))?;
                }
                self.selected = id;
                self.selected_pairing = None;
                self.approval_target = id.map(|_| ApprovalTarget::Deal);
                self.approval_draft = None;
                json(())
            }
            Action::OpenApproval(args) => {
                allowed(label, &["main", "tumbler"])?;
                self.open_approval(label, args)?;
                json(())
            }
            Action::OwnerFacts => {
                allowed(label, &["main", "approval"])?;
                json(self.owner_facts()?)
            }
            Action::BookQuery(args) => {
                // Main's Book only. The closed schema and its rules are checked in Rust; a
                // rejection comes back verbatim as INVALID, before any connection is opened.
                allowed(label, &["main"])?;
                let rejected = |reason: String| CommandError {
                    code: ErrorCode::Invalid,
                    message: format!("BookQuery rejected: {reason}"),
                };
                let query: BookQuery =
                    serde_json::from_value(args.query).map_err(|e| rejected(e.to_string()))?;
                if let Some(reason) = table_ledger::book_query_rejection(&query) {
                    return Err(rejected(reason.into()));
                }
                let answer = app(self.pipeline.wallet.ledger.book_query(&query))?;
                let rows = answer
                    .get("rows")
                    .and_then(serde_json::Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                json(BookAnswer { query, rows })
            }
            Action::AuditPage(args) => {
                allowed(label, &["main"])?;
                json(self.audit_page(args)?)
            }
            Action::DealHistory(args) => {
                // Main's Rewind and deal page only: a read of the verified chain, no unlock.
                allowed(label, &["main"])?;
                json(self.deal_history(args)?)
            }
            Action::ApprovalHandoff => {
                allowed(label, &["approval"])?;
                json(ApprovalHandoff {
                    target: self.approval_target,
                    deal_id: self.selected,
                    draft: self.approval_draft.clone(),
                })
            }
            Action::SelectPairing(id) => {
                allowed(label, &["main"])?;
                if !self
                    .pending
                    .get(&id)
                    .is_some_and(|p| p.peer.identity.expires > self.clock.now())
                {
                    return Err(invalid());
                }
                self.selected_pairing = Some(id);
                self.selected = None;
                self.approval_target = Some(ApprovalTarget::Pairing);
                self.approval_draft = None;
                json(())
            }
            Action::ApprovalPairing => {
                allowed(label, &["approval"])?;
                let pending = self
                    .selected_pairing
                    .and_then(|id| self.pending.get(&id))
                    .filter(|p| p.peer.identity.expires > self.clock.now())
                    .map(|p| PendingPairing {
                        pairing_id: p.words.pairing_id,
                        words: p.words.words.clone(),
                        house: p.house,
                        expires: p.peer.identity.expires,
                        display_context: if p.house {
                            "House seller"
                        } else if p.peer.identity.side == Side::Seller {
                            "Pair with a seller"
                        } else {
                            "Pair with a buyer"
                        }
                        .into(),
                    });
                json(pending)
            }
            Action::Credentials(args) => {
                self.guard(label, token)?;
                self.credentials(args)?;
                self.pipeline.credentials_changed().await;
                json(())
            }
            Action::Engine(engine) => {
                allowed(label, &["main"])?;
                if !self
                    .engine_info()?
                    .iter()
                    .any(|i| i.id == engine && i.available)
                {
                    return Err(unavailable("Engine isolation conformance not established"));
                }
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference("engine", &engine))?;
                self.engine = engine;
                json(())
            }
            Action::Engines => {
                allowed(label, &["main"])?;
                json(self.engine_info()?)
            }
            Action::Start(id) => {
                allowed(label, &["main"])?;
                json(self.start_agent(id)?)
            }
            Action::Runs => {
                allowed(label, &["main"])?;
                json(self.run_snapshots())
            }
            Action::Resume => {
                allowed(label, &["main"])?;
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference("agents_paused", &false))?;
                self.paused = false;
                json(())
            }
            Action::Mandates => {
                allowed(label, &["main", "approval"])?;
                json(self.mandate_list()?)
            }
            Action::Sign(args) => {
                self.guard(label, token)?;
                json(self.sign_mandate(args)?)
            }
            Action::Revoke(args) => {
                self.guard(label, token)?;
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .revoke_mandate(args.id, self.clock.now()))?;
                json(())
            }
            Action::Band(args) => {
                self.guard(label, token)?;
                json(self.band(args)?)
            }
            Action::PairCreate(args) => {
                allowed(label, &["main"])?;
                json(self.pairing_create(args)?)
            }
            Action::PairJoin(args) => {
                allowed(label, &["main"])?;
                json(self.pairing_join(args)?)
            }
            Action::PairPoll(_) | Action::HouseWake => Err(invalid()),
            Action::PairOffer(args) => {
                allowed(label, &["main"])?;
                json(self.pairing_offer(args)?)
            }
            Action::PairWire(bundle) => {
                allowed(label, &["main"])?;
                json(self.pairing_wire(bundle)?)
            }
            Action::PairConfirm(args) => {
                self.guard(label, token)?;
                let pairing_id = args.pairing_id;
                let house = self.pending.get(&pairing_id).is_some_and(|p| p.house);
                let key_id = self.pairing_confirm(args)?;
                // Main learns the pin happened; it never pins anything itself.
                self.emitted.push(crate::WalletEvent::Pinned(PairingPinned {
                    pairing_id,
                    key_id: key_id.clone(),
                    house,
                }));
                json(key_id)
            }
            Action::PairAbort(args) => {
                // Aborting restricts (nothing is pinned, nothing is sent), so either window may
                // do it without the capability. The approval window may end only the pairing it
                // was opened for.
                allowed(label, &["main", "approval"])?;
                if label == "approval"
                    && (args.code.is_some() || args.pairing_id != self.selected_pairing)
                {
                    return Err(permission());
                }
                self.pairing_abort(&args)?;
                json(())
            }
            Action::Preferences(preferences) => {
                allowed(label, &["main", "tumbler"])?;
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference("tumbler", &preferences))?;
                self.preferences = preferences;
                json(())
            }
            Action::Withdraw(id) => {
                if label == "approval" && self.selected != Some(id) {
                    return Err(permission());
                }
                self.select_signer(id)?;
                self.pipeline.wallet.withdraw(
                    id,
                    table_proto::ReasonCode::Other,
                    self.clock.now(),
                )?;
                json(())
            }
            Action::LetLapse(id) => {
                allowed(label, &["main", "tumbler"])?;
                // The same gate the card offered: a Hold or an Authorized deal has no Let lapse.
                if !self.attention()?.items.iter().any(|i| {
                    i.deal_id == id
                        && i.kind == table_attention::AttnKind::Gate
                        && i.actions
                            .contains(&table_attention::TumblerAction::LetLapse)
                }) {
                    return Err(invalid());
                }
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference(&format!("lapse.{id}"), &true))?;
                json(())
            }
            Action::Snooze(id) => {
                allowed(label, &["tumbler"])?;
                let now = self.clock.now();
                if !self.attention()?.items.iter().any(|i| {
                    i.deal_id == id
                        && i.kind == table_attention::AttnKind::Gate
                        && i.deadline.is_some_and(|d| d.saturating_sub(now) > 2700)
                }) {
                    return Err(invalid());
                }
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference(&format!("snooze.{id}"), &now.saturating_add(1800)))?;
                json(())
            }
            Action::Decision(args, decision) => self.decide(label, token, args, decision).await,
            Action::Create(args) => {
                self.guard(label, token)?;
                json(self.create_deal(args)?)
            }
            Action::Join(args) => {
                self.guard(label, token)?;
                if args.create.side != Side::Buyer || args.create.kind != DealKind::Haggle {
                    return Err(invalid());
                }
                json(self.create_deal_id(args.create, args.deal_id)?)
            }
            Action::Pause => {
                allowed(label, &["main", "tumbler"])?;
                app(self
                    .pipeline
                    .wallet
                    .ledger
                    .set_preference("agents_paused", &true))?;
                self.paused = true;
                self.cancel_runs()?;
                json(())
            }
            Action::QuitSummary => {
                allowed(label, &["main", "tumbler"])?;
                json(self.quit_summary()?)
            }
            Action::QuitConfirm(args) => {
                allowed(label, &["main", "tumbler"])?;
                if self.quit_summary()?.confirmation_id != args.confirmation_id {
                    return Err(invalid());
                }
                self.cancel_runs()?;
                json(())
            }
            Action::Handoff(id) => {
                allowed(label, &["approval"])?;
                if self.selected != Some(id) {
                    return Err(permission());
                }
                self.pipeline
                    .approval_link(id, app(self.pipeline.wallet.ledger.settled_attempt(id))?)?;
                let approve_until = app(self.pipeline.wallet.ledger.deadline(id))?
                    .map(|(d, _)| d)
                    .filter(|d| *d > self.clock.now())
                    .ok_or_else(invalid)?;
                app(self.pipeline.wallet.ledger.handoff(id))?;
                json(TumblerHandoff {
                    deal_id: id,
                    approve_until,
                })
            }
            Action::Simulate(args) => {
                // The mandate editor lives in the approval window. Read-only and moves nothing,
                // so no token or unlock is asked for.
                allowed(label, &["approval"])?;
                json(self.mandate_simulate(args)?)
            }
        }
    }
    fn quit_summary(&mut self) -> Result<QuitSummary, CommandError> {
        let pending_deals = app(self.pipeline.wallet.ledger.list_deals())?
            .into_iter()
            .filter(|d| {
                matches!(
                    d.state,
                    DealState::Agreed
                        | DealState::AwaitingApproval
                        | DealState::Approved
                        | DealState::Authorized
                        | DealState::Mismatch
                ) || (d.shield.is_some_and(|v| v >= ShieldVerdict::Hold)
                    // A refused or withdrawn deal is no pending decision, whatever its verdict.
                    && !d.state.terminal())
            })
            .collect::<Vec<_>>();
        let pending = pending_deals.iter().map(|d| d.id).collect::<Vec<_>>();
        // Quitting stops the scheduler, so every money step the forecast holds will not happen
        // while the wallet is off. An unreadable forecast leaves only the general sentence.
        let lines = match self.forecast(self.clock.now()) {
            Ok(forecast) => {
                let mut sources = Vec::with_capacity(pending_deals.len());
                for deal in &pending_deals {
                    sources.push(table_attention::QuitSource {
                        deal_id: deal.id,
                        display_number: app(self.pipeline.wallet.ledger.display_number(deal.id))?,
                        state: deal.state,
                        side: deal.side,
                        amount: deal.terms.amount().map_err(table_app::Error::from)?,
                    });
                }
                Some(table_attention::quit_lines(&sources, &forecast))
            }
            Err(_) => None,
        };
        let on_quit = table_attention::quit::ON_QUIT.to_owned();
        let (while_off, at_paypal) = match lines {
            Some(l) => (Some(l.while_off), Some(l.at_paypal)),
            None => (None, None),
        };
        // The confirmation binds everything the confirm shows, not only the deals.
        let bytes = canonical_bytes(&(&pending_deals, &while_off, &at_paypal, &on_quit))
            .map_err(|_| invalid())?;
        Ok(QuitSummary {
            confirmation_id: H256::digest(&bytes),
            pending,
            on_quit,
            while_off,
            at_paypal,
        })
    }
}
