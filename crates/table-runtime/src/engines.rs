//! Run lifecycle and actor-owned intent bridge. Jobs never own the payment API.
use crate::*;
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc};
use table_app::{AgentRequest, AgentRole, AgentScope, AgentService};
use table_client::*;
use table_core::*;
use table_engine::*;
use table_ledger::AuditEntry;

/// AGENTS.md: engines are named claude-code and codex-cli, never by vendor product.
const SCRIPTED_ROLE_REFUSAL: &str = "The built-in negotiator only haggles at a table; shopping and assistant runs need the claude-code or codex-cli engine.";

/// agent_start's refusals, one per reason (shown to the owner as they are).
/// The most agent runs that may be live at once: `start_agent` refuses past it and `arm_policy_run` pre-checks it.
pub(crate) const MAX_RUNS: usize = 4;
pub(crate) const AGENTS_PAUSED: &str = "Agents are paused. Resume them to start one.";
pub(crate) const ALREADY_RUNNING: &str = "An agent is already working on this deal.";
pub(crate) const RUN_LIMIT: &str =
    "The most agents that can work at once are already running. Try again when one finishes.";

pub(crate) struct ActiveRun {
    pub(crate) scope: AgentScope,
    pub(crate) snapshot: RunSnapshot,
    adapter: Arc<dyn EngineAdapter>,
    task: tokio::task::JoinHandle<()>,
    grant: Option<table_mcp::Grant>,
    server: Option<Arc<table_mcp::Server>>,
    expires: i64,
}
impl Drop for ActiveRun {
    fn drop(&mut self) {
        if let (Some(server), Some(grant)) = (&self.server, &self.grant) {
            server.revoke(grant);
        }
        // Scripted jobs have no external resources: aborting their task cancels
        // them without accumulating pre-run cancellation tombstones.
        if self.snapshot.engine != EngineId::Scripted {
            self.adapter.cancel(self.snapshot.run);
        }
        self.task.abort();
    }
}
pub(crate) struct ActorBridge(pub(crate) tokio::sync::mpsc::WeakSender<crate::actor::Message>);
#[async_trait]
impl table_mcp::AsyncAgentService for ActorBridge {
    async fn invoke(
        &self,
        scope: &AgentScope,
        request: AgentRequest,
        _: i64,
        run: Option<RunId>,
    ) -> Result<serde_json::Value, table_app::Error> {
        let run = run.ok_or(table_app::Error::Permission)?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.0
            .upgrade()
            .ok_or(table_app::Error::Unavailable)?
            .send(crate::actor::Message::Agent(
                run,
                scope.clone(),
                request,
                tx,
            ))
            .await
            .map_err(|_| table_app::Error::Unavailable)?;
        rx.await.map_err(|_| table_app::Error::Unavailable)?
    }
    async fn record_refusal(
        &self,
        scope: &AgentScope,
        tool: &str,
        code: RefusalCode,
        _: i64,
    ) -> Result<(), table_app::Error> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.0
            .upgrade()
            .ok_or(table_app::Error::Unavailable)?
            .send(crate::actor::Message::AgentRefused(
                scope.clone(),
                tool.into(),
                code,
                tx,
            ))
            .await
            .map_err(|_| table_app::Error::Unavailable)?;
        rx.await.map_err(|_| table_app::Error::Unavailable)?
    }
    async fn record_mcp_outcome(
        &self,
        scope: &AgentScope,
        tool: &str,
        outcome: table_app::McpOutcome,
        _: i64,
    ) -> Result<(), table_app::Error> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.0
            .upgrade()
            .ok_or(table_app::Error::Unavailable)?
            .send(crate::actor::Message::AgentMcpOutcome(
                scope.clone(),
                tool.into(),
                outcome,
                tx,
            ))
            .await
            .map_err(|_| table_app::Error::Unavailable)?;
        rx.await.map_err(|_| table_app::Error::Unavailable)?
    }
}
impl Runtime {
    /// Native startup probes only versions. Runtime tests never call this or bind sockets.
    pub async fn attach_native_engines(&mut self, root: PathBuf) -> Result<(), CommandError> {
        self.attach_scripted()?;
        for id in [EngineId::ClaudeCode, EngineId::CodexCli] {
            if let Ok(executable) = resolve_command(id, &search_paths()) {
                self.attach_engine(id, executable, root.clone()).await;
            }
        }
        Ok(())
    }
    /// Attaches one native engine on its own: a workspace that cannot be made leaves that engine
    /// unavailable with the true reason and never stops the other engine being attached.
    pub(crate) async fn attach_engine(
        &mut self,
        id: EngineId,
        executable: Executable,
        root: PathBuf,
    ) {
        let Ok(engine) = NativeEngine::new(id, executable, root, RunLimits::default()) else {
            self.engine_workspace_failed.push(id);
            return;
        };
        let engine = Arc::new(engine);
        let info = engine.probe().await.unwrap_or(EngineInfo {
            id,
            available: false,
            version: None,
            reason: Some("Engine version probe failed".into()),
        });
        self.engine_probed_at.push((id, self.clock.now()));
        self.engines.push((engine, info));
    }
    pub(crate) fn attach_scripted(&mut self) -> Result<(), CommandError> {
        if self.engines.iter().any(|(_, i)| i.id == EngineId::Scripted) {
            return Ok(());
        }
        let engine = PolicyEngine::new(Arc::new(
            crate::policy::HttpMcp::new()
                .map_err(|_| unavailable("Local MCP client unavailable"))?,
        ));
        self.engine_probed_at
            .push((EngineId::Scripted, self.clock.now()));
        self.engines.push((
            Arc::new(engine),
            EngineInfo {
                id: EngineId::Scripted,
                available: true,
                version: Some("1".into()),
                reason: Some(
                    "Policy negotiator: fixed concession rules inside the signed limits".into(),
                ),
            },
        ));
        Ok(())
    }
    pub(crate) fn engine_info(&mut self) -> Result<Vec<EngineInfo>, CommandError> {
        self.attach_scripted()?;
        Ok(
            [EngineId::ClaudeCode, EngineId::CodexCli, EngineId::Scripted]
                .into_iter()
                .map(|id| {
                    self.engines
                        .iter()
                        .find(|(_, i)| i.id == id)
                        .map(|(_, i)| i.clone())
                        .unwrap_or(EngineInfo {
                            id,
                            available: false,
                            version: None,
                            reason: Some(
                                if self.engine_workspace_failed.contains(&id) {
                                    "Engine workspace unavailable"
                                } else {
                                    "Executable not resolved"
                                }
                                .into(),
                            ),
                        })
                })
                .collect(),
        )
    }
    pub(crate) fn start_agent(&mut self, id: DealId) -> Result<RunSnapshot, CommandError> {
        // Three different reasons, each told as itself: the owner acts on each differently.
        if self.paused {
            return Err(unavailable(AGENTS_PAUSED));
        }
        if self.runs.values().any(|r| r.scope.deal_id == id) {
            return Err(unavailable(ALREADY_RUNNING));
        }
        if self.runs.len() >= MAX_RUNS {
            return Err(unavailable(RUN_LIMIT));
        }
        self.attach_scripted()?;
        let (adapter, info) = self
            .engines
            .iter()
            .find(|(_, i)| i.id == self.engine)
            .ok_or_else(|| unavailable("Engine not attached"))?;
        if !info.available {
            return Err(unavailable("Engine isolation conformance not established"));
        }
        let adapter = adapter.clone();
        self.select_signer(id)?;
        let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
        if deal.state.terminal()
            || deal.mode == Mode::Replay
            || matches!(deal.kind, DealKind::Invoice | DealKind::Rescue)
        {
            return Err(invalid());
        }
        let category = app(self.pipeline.wallet.ledger.deal_category(id))?;
        self.pipeline
            .wallet
            .check_mandate(id, category, self.clock.now())?;
        let scope = AgentScope {
            deal_id: id,
            role: if self.pipeline.wallet.agent_public_key().to_bytes()
                == crate::vault::existing_signing_key(
                    self.vault.as_ref(),
                    AgentSlot::Assistant.key_name(),
                )
                .map_err(|_| unavailable("Assistant key unavailable"))?
                .verifying_key()
                .to_bytes()
            {
                AgentRole::Assistant
            } else if deal.kind == DealKind::Purchase {
                AgentRole::Shopper
            } else {
                AgentRole::Negotiator
            },
            category,
        };
        if self.engine == EngineId::Scripted && scope.role != AgentRole::Negotiator {
            return Err(unavailable(SCRIPTED_ROLE_REFUSAL));
        }
        // A native engine starts from the closed table projection (no NOTE, invoice memo or remote
        // prose can be represented in it) and its role's compiled-in playbook. The policy
        // negotiator gets its typed brief and reads the same projection through `table_view`.
        let (prompt, playbook) = if self.engine == EngineId::Scripted {
            (
                serde_json::to_string(&self.policy_brief(&deal)?).map_err(|_| invalid())?,
                None,
            )
        } else {
            let table = if scope.role == AgentRole::Negotiator {
                serde_json::to_value(self.pipeline.wallet.projection(&deal, self.clock.now())?)
                    .map_err(|_| invalid())?
            } else {
                // Shopper and assistant runs have no table to read: only the deal's closed ids.
                serde_json::json!({"deal_id": deal.id, "kind": deal.kind, "item_ref": deal.terms.item_ref})
            };
            (table.to_string(), Some(scope.role.playbook(deal.side)))
        };
        let run = RunId(ulid::Ulid::new());
        // The run's grant lasts as long as a native engine may run (the limit it is built with
        // in attach_native_engines), so the two cannot drift apart.
        let lasts = i64::try_from(RunLimits::default().total.as_secs()).map_err(|_| invalid())?;
        let expires = self.clock.now().checked_add(lasts).ok_or_else(invalid)?;
        let snapshot = RunSnapshot {
            run,
            deal_id: id,
            engine: self.engine,
            mode: if self.engine == EngineId::Scripted {
                Mode::ScriptedEngine
            } else {
                deal.mode
            },
            state: RunState::Starting,
            playbook,
        };
        let (server, url) = self
            .mcp
            .as_ref()
            .ok_or_else(|| unavailable("Local MCP not attached"))?;
        let grant = server.grant_for_run(scope.clone(), run)?;
        let mcp = McpGrant {
            url: url.clone(),
            token: grant.token.clone(),
            secret: grant.secret.clone(),
        };
        let (server, grant) = (Some(server.clone()), Some(grant));
        let sender = self
            .actor_sender
            .clone()
            .ok_or_else(|| unavailable("Actor not attached"))?;
        app(self.pipeline.wallet.ledger.append_audit(&AuditEntry {
            at: self.clock.now(),
            actor: "runtime".into(),
            action: "run.start".into(),
            deal_id: Some(id),
            detail: serde_json::json!({"run":run,"engine":self.engine,"mode":snapshot.mode,"playbook":playbook}),
        }))?;
        let engine = adapter.clone();
        let task = tokio::spawn(async move {
            let (tx, mut rx) = tokio::sync::mpsc::channel(16);
            let execution = engine.run(
                AgentJob {
                    run,
                    prompt,
                    playbook,
                },
                mcp,
                tx,
            );
            let events = async {
                while let Some(event) = rx.recv().await {
                    if let Some(sender) = sender.upgrade() {
                        if sender
                            .send(crate::actor::Message::Engine(run, event))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            };
            let (result, ()) = tokio::join!(execution, events);
            if let Some(sender) = sender.upgrade() {
                let _ = sender
                    .send(crate::actor::Message::EngineFinished(run, result))
                    .await;
            }
        });
        self.runs.insert(
            run,
            ActiveRun {
                scope,
                snapshot: snapshot.clone(),
                adapter,
                task,
                grant,
                server,
                expires,
            },
        );
        Ok(snapshot)
    }
    pub(crate) fn engine_event(
        &mut self,
        run: RunId,
        event: EngineEvent,
    ) -> Result<Option<RunSnapshot>, CommandError> {
        let Some(active) = self.runs.get_mut(&run) else {
            return Ok(None);
        };
        match event {
            EngineEvent::Init { engine } => {
                if active.snapshot.engine != engine || active.snapshot.state != RunState::Starting {
                    return Err(invalid());
                }
                if let (Some(server), Some(grant)) = (&active.server, &active.grant) {
                    server.enable(grant)?;
                }
                active.snapshot.state = RunState::Running;
                Ok(Some(active.snapshot.clone()))
            }
            // Only a grant-less scripted fixture streams calls for the host to run; the policy
            // negotiator and native engines already pass through MCP.
            EngineEvent::ToolCall { name, arguments }
                if active.snapshot.engine == EngineId::Scripted && active.server.is_none() =>
            {
                let scope = active.scope.clone();
                let request = AgentRequest::decode(
                    name.strip_prefix("mcp__wallet__").ok_or_else(invalid)?,
                    arguments,
                )?;
                self.agent_intent(run, &scope, request)?;
                Ok(None)
            }
            _ => Ok(None), // Native calls already pass through MCP; never execute streamed calls twice.
        }
    }
    pub(crate) fn agent_intent(
        &mut self,
        run: RunId,
        scope: &AgentScope,
        request: AgentRequest,
    ) -> Result<serde_json::Value, table_app::Error> {
        let tool = request.tool();
        // Refusals before the wallet are recorded here, once; the wallet records its own.
        if let Err(error) = self.agent_gate(run, scope) {
            self.pipeline.wallet.audit_refusal(
                scope.deal_id,
                "runtime",
                tool,
                &error,
                self.clock.now(),
            )?;
            return Err(error);
        }
        let answer = self
            .pipeline
            .wallet
            .invoke(scope, request, self.clock.now());
        // The agent's ACCEPT may have agreed a grouped table: withdraw its siblings now (the next
        // tick retries and reports a failure).
        if answer.is_ok() {
            let _ = self.close_groups();
        }
        answer
    }
    /// Whether `run` may still act for `scope` now: agents not paused, the run live and the same
    /// deal, role and category, the deal's signer selectable and its mandate still allowing it.
    fn agent_gate(&mut self, run: RunId, scope: &AgentScope) -> Result<(), table_app::Error> {
        if self.paused {
            return Err(table_app::Error::Agent(RefusalCode::Paused));
        }
        if !self.runs.get(&run).is_some_and(|r| {
            r.snapshot.state == RunState::Running
                && r.expires > self.clock.now()
                && r.scope.deal_id == scope.deal_id
                && r.scope.role == scope.role
                && r.scope.category == scope.category
        }) {
            return Err(table_app::Error::Agent(RefusalCode::RunEnded));
        }
        self.select_signer(scope.deal_id)
            .map_err(|_| table_app::Error::Permission)?;
        // Recheck even read/withdraw intents before delegating. Mandate revoke,
        // changed categories or keys cannot be bypassed by an old session.
        self.pipeline
            .wallet
            .check_mandate(scope.deal_id, scope.category, self.clock.now())?;
        Ok(())
    }
    pub(crate) fn finish_run(
        &mut self,
        run: RunId,
        state: RunState,
    ) -> Result<Option<RunSnapshot>, CommandError> {
        self.finish_run_because(run, state, None)
    }
    /// `finish_run` plus the engine's typed failure cause (`spawn`, `attach`, `pipe`,
    /// `exit:<code>`), written to the run-end audit row so a failed run reads differently from
    /// a missing executable. The cause never carries child output.
    pub(crate) fn finish_run_because(
        &mut self,
        run: RunId,
        state: RunState,
        cause: Option<String>,
    ) -> Result<Option<RunSnapshot>, CommandError> {
        let Some(mut active) = self.runs.remove(&run) else {
            return Ok(None);
        };
        active.snapshot.state = state;
        let snapshot = active.snapshot.clone();
        // The ended run is listed before its audit row is written: a failed write must not
        // leave it in neither list, still shown as running. The fault is still returned.
        self.run_history.push(snapshot.clone());
        if self.run_history.len() > 64 {
            self.run_history.remove(0);
        }
        #[cfg(test)]
        if self.fail_run_audit {
            return Err(table_app::Error::Unavailable.into());
        }
        app(self.pipeline.wallet.ledger.append_audit(&AuditEntry {
            at: self.clock.now(),
            actor: "runtime".into(),
            action: "run.finish".into(),
            deal_id: Some(snapshot.deal_id),
            detail: {
                let mut detail = serde_json::json!(&snapshot);
                if let (Some(cause), Some(map)) = (cause, detail.as_object_mut()) {
                    map.insert("cause".into(), cause.into());
                }
                detail
            },
        }))?;
        Ok(Some(snapshot))
    }
    /// The tables waiting on our agent at `now`, soonest deadline first: an open haggle with no
    /// run on it and no "let it lapse", under an active mandate, where the agent may send or
    /// accept an offer now. That is the projection's `allowed`, the predicate the wallet runs
    /// before every intent, so the list is ground truth whatever stopped the last run (pause,
    /// quit, a failed or expired run). It is read only: nothing here starts a run.
    pub(crate) fn waiting_on_agent(&self, now: i64) -> Result<Vec<WaitingTable>, CommandError> {
        let ledger = &self.pipeline.wallet.ledger;
        let mut waiting = Vec::new();
        for deal in app(ledger.list_live_deals())? {
            if deal.kind != DealKind::Haggle
                || deal.mode == Mode::Replay
                || deal.state.terminal()
                || self.runs.values().any(|r| r.scope.deal_id == deal.id)
                || app(ledger.preference::<bool>(&format!("lapse.{}", deal.id)))?.unwrap_or(false)
            {
                continue;
            }
            // A retired mandate (or one that cannot be read) projects nothing: not restartable.
            let Ok(view) = self.pipeline.wallet.projection(&deal, now) else {
                continue;
            };
            if view
                .allowed
                .iter()
                .any(|t| matches!(t, AgentTool::SendOffer | AgentTool::AcceptOffer))
            {
                waiting.push(WaitingTable {
                    deal_id: deal.id,
                    deadline: view.deadline,
                });
            }
        }
        waiting.sort_by_key(|w| (w.deadline, w.deal_id));
        Ok(waiting)
    }
    pub(crate) fn cancel_runs(&mut self) -> Result<(), CommandError> {
        let mut failure = None;
        for run in self.runs.keys().copied().collect::<Vec<_>>() {
            if let Err(error) = self.finish_run(run, RunState::Cancelled) {
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
    pub(crate) fn run_snapshots(&self) -> Vec<RunSnapshot> {
        self.run_history
            .iter()
            .cloned()
            .chain(self.runs.values().map(|r| r.snapshot.clone()))
            .collect()
    }
}

#[cfg(test)]
mod refusal_tests {
    use super::SCRIPTED_ROLE_REFUSAL;

    #[test]
    fn scripted_role_refusal_names_no_vendor_product() {
        assert!(!SCRIPTED_ROLE_REFUSAL.contains("Claude Code"));
        assert!(!SCRIPTED_ROLE_REFUSAL.contains(concat!("Codex", " CLI")));
        assert!(SCRIPTED_ROLE_REFUSAL.contains("claude-code or codex-cli"));
    }
}
