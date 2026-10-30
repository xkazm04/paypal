//! The outside agent's engine slot. The wallet starts it like any engine (`agent_start`, or a
//! policy re-arm when the other side moves) and hands it the run's MCP grant; it launches no
//! process and runs no model. It only holds the grant for the front, which carries the outside
//! agent's calls to the wallet's own loopback MCP server under it, until the run ends.
use async_trait::async_trait;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use table_core::RunId;
use table_engine::{
    AgentJob, EngineAdapter, EngineEvent, EngineId, EngineInfo, Error, McpGrant, Schema,
    TerminalVerdict,
};
use tokio::sync::{Notify, mpsc::Sender};

/// The slot the outside agent takes: its own engine id, so the wallet's record names it
/// (`run.start` rows say `outside`) and no window can select it.
pub const SLOT: EngineId = EngineId::Outside;
/// A run ends itself before the wallet's grant horizon (`table_mcp::SESSION_SECS`), so the
/// front renews it between calls instead of an agent meeting an expired session.
pub const RUN_SECS: u64 = 100;

/// The live run's grant, as the wallet issued it. Never printed, logged or served.
pub struct Live {
    pub run: RunId,
    pub url: String,
    pub token: String,
    pub secret: String,
    pub started: Instant,
    end: Arc<Notify>,
}
impl std::fmt::Debug for Live {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Live")
            .field("run", &self.run)
            .finish_non_exhaustive()
    }
}
impl Live {
    pub fn fresh(&self) -> bool {
        self.started.elapsed() < Duration::from_secs(RUN_SECS.saturating_sub(5))
    }
}
/// Where the engine leaves each run's grant for the front.
#[derive(Debug, Default)]
pub struct Slot {
    live: Mutex<Option<Arc<Live>>>,
    changed: Notify,
}
impl Slot {
    pub fn live(&self) -> Option<Arc<Live>> {
        self.live.lock().ok().and_then(|live| live.clone())
    }
    /// Waits until the slot holds a run other than `not`, or `within` passes.
    pub async fn next(&self, not: Option<RunId>, within: Duration) -> Option<Arc<Live>> {
        tokio::time::timeout(within, async {
            loop {
                let changed = self.changed.notified();
                if let Some(live) = self.live().filter(|live| Some(live.run) != not) {
                    return live;
                }
                changed.await;
            }
        })
        .await
        .ok()
    }
    /// Asks the live run to end now (the engine returns clean; the wallet records the run's end).
    pub fn end(&self, run: RunId) {
        if let Some(live) = self.live().filter(|live| live.run == run) {
            live.end.notify_one();
        }
    }
    fn clear(&self, run: RunId) {
        if let Ok(mut live) = self.live.lock()
            && live.as_ref().is_some_and(|held| held.run == run)
        {
            *live = None;
        }
        self.changed.notify_waiters();
    }
}
/// Clears the slot however the run's future ends: returned, or aborted by the wallet.
struct Seat(Arc<Slot>, RunId);
impl Drop for Seat {
    fn drop(&mut self) {
        self.0.clear(self.1);
    }
}

#[derive(Debug, Clone)]
pub struct OutsideAgent(pub Arc<Slot>);
impl OutsideAgent {
    pub fn info() -> EngineInfo {
        EngineInfo {
            id: SLOT,
            available: true,
            version: Some("1".into()),
            reason: Some(
                "Outside agent: your own agent app, connected over the wallet's MCP server".into(),
            ),
        }
    }
}
#[async_trait]
impl EngineAdapter for OutsideAgent {
    fn id(&self) -> EngineId {
        SLOT
    }
    async fn probe(&self) -> Result<EngineInfo, Error> {
        Ok(Self::info())
    }
    async fn run(
        &self,
        job: AgentJob,
        mcp: McpGrant,
        tx: Sender<EngineEvent>,
    ) -> Result<TerminalVerdict, Error> {
        // Init is what makes the wallet enable this run's grant.
        tx.send(EngineEvent::Init { engine: SLOT })
            .await
            .map_err(|_| Error::Closed)?;
        let end = Arc::new(Notify::new());
        let live = Arc::new(Live {
            run: job.run,
            url: mcp.url.clone(),
            token: mcp.token.clone(),
            secret: mcp.secret.clone(),
            started: Instant::now(),
            end: end.clone(),
        });
        let _seat = Seat(self.0.clone(), job.run);
        if let Ok(mut slot) = self.0.live.lock() {
            *slot = Some(live);
        }
        self.0.changed.notify_waiters();
        tokio::select! {
            () = end.notified() => {}
            () = tokio::time::sleep(Duration::from_secs(RUN_SECS)) => {}
        }
        Ok(TerminalVerdict::Clean)
    }
    async fn structured(&self, _: &str, _: &Schema) -> Result<Value, Error> {
        Err(Error::Invalid)
    }
    fn cancel(&self, run: RunId) {
        self.0.end(run);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]
    use super::*;

    fn job() -> (AgentJob, McpGrant) {
        (
            AgentJob {
                run: RunId(ulid::Ulid::new()),
                prompt: String::new(),
                playbook: None,
            },
            McpGrant {
                url: "http://127.0.0.1:9/mcp".into(),
                token: "token".into(),
                secret: "secret".into(),
            },
        )
    }

    #[tokio::test]
    async fn the_slot_holds_the_live_grant_until_the_run_is_ended() {
        let slot = Arc::new(Slot::default());
        let engine = OutsideAgent(slot.clone());
        let (job, grant) = job();
        let run = job.run;
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        let task = tokio::spawn(async move { engine.run(job, grant, tx).await });
        assert!(matches!(
            rx.recv().await,
            Some(EngineEvent::Init {
                engine: EngineId::Outside
            })
        ));
        let live = slot.next(None, Duration::from_secs(2)).await.unwrap();
        assert_eq!(live.run, run);
        assert!(live.fresh());
        slot.end(run);
        assert!(matches!(task.await.unwrap(), Ok(TerminalVerdict::Clean)));
        assert!(slot.live().is_none());
    }

    #[tokio::test]
    async fn an_aborted_run_leaves_no_grant_behind() {
        let slot = Arc::new(Slot::default());
        let engine = OutsideAgent(slot.clone());
        let (job, grant) = job();
        let (tx, mut rx) = tokio::sync::mpsc::channel(4);
        let task = tokio::spawn(async move { engine.run(job, grant, tx).await });
        let _ = rx.recv().await;
        let live = slot.next(None, Duration::from_secs(2)).await.unwrap();
        // The wallet aborts a run's task when it drops the run (pause, quit, replacement).
        task.abort();
        let _ = task.await;
        assert!(slot.live().is_none());
        // Waiting for a run other than the aborted one times out instead of returning it.
        assert!(
            slot.next(Some(live.run), Duration::from_millis(50))
                .await
                .is_none()
        );
    }
}
