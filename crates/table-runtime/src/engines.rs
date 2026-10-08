//! Run lifecycle and actor-owned intent bridge. Jobs never own the payment API.
use crate::*;
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc};
use table_app::{AgentRequest, AgentRole, AgentScope, AgentService};
use table_client::*;
use table_core::*;
use table_engine::*;
use table_ledger::AuditEntry;

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
}
impl Runtime {
    /// Native startup probes only versions. Runtime tests never call this or bind sockets.
    pub async fn attach_native_engines(&mut self, root: PathBuf) -> Result<(), CommandError> {
        self.attach_scripted()?;
        for id in [EngineId::ClaudeCode, EngineId::CodexCli] {
            if let Ok(executable) = resolve_command(id, &search_paths()) {
                let engine = Arc::new(
                    NativeEngine::new(id, executable, root.clone(), RunLimits::default())
                        .map_err(|_| unavailable("Engine workspace unavailable"))?,
                );
                let info = engine.probe().await.unwrap_or(EngineInfo {
                    id,
                    available: false,
                    version: None,
                    reason: Some("Engine version probe failed".into()),
                });
                self.engine_probed_at.push((id, self.clock.now()));
                self.engines.push((engine, info));
            }
        }
        Ok(())
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
                            reason: Some("Executable not resolved".into()),
                        })
                })
                .collect(),
        )
    }
    pub(crate) fn start_agent(&mut self, id: DealId) -> Result<RunSnapshot, CommandError> {
        if self.paused || self.runs.len() >= 4 || self.runs.values().any(|r| r.scope.deal_id == id)
        {
            return Err(unavailable("Agents paused or run limit reached"));
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
            return Err(unavailable("Scripted fixture supports table-view only"));
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
        let expires = self.clock.now().checked_add(120).ok_or_else(invalid)?;
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
        let Some(mut active) = self.runs.remove(&run) else {
            return Ok(None);
        };
        active.snapshot.state = state;
        let snapshot = active.snapshot.clone();
        app(self.pipeline.wallet.ledger.append_audit(&AuditEntry {
            at: self.clock.now(),
            actor: "runtime".into(),
            action: "run.finish".into(),
            deal_id: Some(snapshot.deal_id),
            detail: serde_json::json!(&snapshot),
        }))?;
        self.run_history.push(snapshot.clone());
        if self.run_history.len() > 64 {
            self.run_history.remove(0);
        }
        Ok(Some(snapshot))
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
