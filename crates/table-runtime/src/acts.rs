//! Safe acts (docs/design/conversational-home-safe-acts.md): the reversible owner actions the
//! main window may run, and the one door (`assistant_act`) that runs an act an assistant proposal
//! led to and records its provenance in the audit chain. Nothing here moves, approves, signs,
//! captures, voids or releases money:
//!
//! | act            | does                                          | undo           |
//! |----------------|-----------------------------------------------|----------------|
//! | pause all      | every run cancelled, nothing starts           | resume all     |
//! | let lapse      | `lapse.<deal>` set: hidden until the deadline  | lapse undo     |
//! | pause agent    | `agent_paused.<slot>` set: that slot's runs    | resume agent   |
//! |                | cancelled, none starts for it                 |                |
//!
//! A one-agent pause covers that agent's runs (and the policy re-arm, which starts runs through
//! `start_agent`). The wallet's own background passes (the market watch, the rescue watch, the
//! seller's PayPal order step) follow the pause-all switch only.
use crate::{Runtime, app, invalid, unavailable};
use table_client::*;
use table_core::*;

pub(crate) const AGENT_PAUSED: &str = "This agent is paused. Resume it to start one.";

fn slot_key(slot: AgentSlot) -> String {
    format!("agent_paused.{}", slot.key_name())
}

impl Runtime {
    /// `pause_all_agents`.
    pub(crate) fn pause_all(&mut self) -> Result<(), CommandError> {
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference("agents_paused", &true))?;
        self.paused = true;
        self.cancel_runs()
    }
    /// `resume_all_agents`: read before the write, so a report that cannot be read leaves the
    /// pause in place. Resume starts nothing; each restart stays the owner's own agent_start.
    pub(crate) fn resume_all(&mut self) -> Result<ResumeReport, CommandError> {
        let waiting = self.waiting_on_agent(self.clock.now())?;
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference("agents_paused", &false))?;
        self.paused = false;
        Ok(ResumeReport { waiting })
    }
    /// `deal_let_lapse`: the same gate the card offered (a Hold or an Authorized deal has none).
    pub(crate) fn let_lapse(&mut self, id: DealId) -> Result<(), CommandError> {
        if !self.card_item(id)?.is_some_and(|i| {
            i.kind == table_attention::AttnKind::Gate
                && i.actions
                    .contains(&table_attention::TumblerAction::LetLapse)
        }) {
            return Err(invalid());
        }
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference(&format!("lapse.{id}"), &true))
    }
    /// `deal_lapse_undo`: clears the mark `let_lapse` set, on this wallet's own deal, before the
    /// deal ended. The deal is back on the owner's list; its agent is not restarted.
    pub(crate) fn lapse_undo(&mut self, id: DealId) -> Result<(), CommandError> {
        let ledger = &mut self.pipeline.wallet.ledger;
        let deal = app(ledger.get_deal(id))?;
        if deal.state.terminal()
            || !app(ledger.preference::<bool>(&format!("lapse.{id}")))?.unwrap_or(false)
        {
            return Err(invalid());
        }
        app(ledger.set_preference(&format!("lapse.{id}"), &false))
    }
    /// Agents paused one by one, in slot order.
    pub(crate) fn paused_agents(&self) -> Result<Vec<AgentSlot>, CommandError> {
        let mut out = Vec::new();
        for slot in AgentSlot::ALL {
            if app(self
                .pipeline
                .wallet
                .ledger
                .preference::<bool>(&slot_key(slot)))?
            .unwrap_or(false)
            {
                out.push(slot);
            }
        }
        Ok(out)
    }
    /// The agent slot whose signed mandate a deal runs under, if one is in force.
    fn slot_of(&self, id: DealId) -> Result<Option<AgentSlot>, CommandError> {
        let deal = app(self.pipeline.wallet.ledger.get_deal(id))?;
        Ok(self
            .mandate_list()?
            .into_iter()
            .find(|m| {
                m.mandate.payload.id == deal.mandate_id
                    && m.mandate.payload.version == deal.mandate_version
            })
            .map(|m| m.agent))
    }
    /// Whether the agent a deal runs under is paused on its own. Free when none is paused.
    pub(crate) fn agent_paused_for(&self, id: DealId) -> Result<bool, CommandError> {
        let paused = self.paused_agents()?;
        if paused.is_empty() {
            return Ok(false);
        }
        Ok(self.slot_of(id)?.is_some_and(|s| paused.contains(&s)))
    }
    /// `agent_pause`: sticky like the pause-all switch; that agent's live runs are cancelled.
    pub(crate) fn pause_agent(&mut self, slot: AgentSlot) -> Result<(), CommandError> {
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference(&slot_key(slot), &true))?;
        let mut failure = None;
        for (run, deal) in self
            .runs
            .iter()
            .map(|(run, r)| (*run, r.scope.deal_id))
            .collect::<Vec<_>>()
        {
            if self.slot_of(deal).ok().flatten() == Some(slot)
                && let Err(error) = self.finish_run(run, RunState::Cancelled)
            {
                failure = Some(error);
            }
        }
        failure.map_or(Ok(()), Err)
    }
    /// `agent_resume`: clears one agent's pause; starts nothing.
    pub(crate) fn resume_agent(&mut self, slot: AgentSlot) -> Result<(), CommandError> {
        app(self
            .pipeline
            .wallet
            .ledger
            .set_preference(&slot_key(slot), &false))
    }
    /// `assistant_act`: the consent words must be plain and bounded (refused, never trimmed); the
    /// act runs; then one `assistant.act` row records what ran and what the owner was shown. If
    /// the act is refused nothing is recorded. If the record cannot be written after the act ran,
    /// the error is returned: the act stands (each one is reversible) and the owner sees the
    /// failure rather than a success the chain cannot show.
    pub(crate) fn assistant_act(&mut self, args: AssistantActArgs) -> Result<(), CommandError> {
        if !args.consent.is_plain() {
            return Err(invalid());
        }
        let act = args.act;
        match act {
            AssistantAct::PauseAll {} => self.pause_all()?,
            AssistantAct::ResumeAll {} => self.resume_all().map(|_| ())?,
            AssistantAct::LetLapse { deal_id } => self.let_lapse(deal_id)?,
            AssistantAct::LapseUndo { deal_id } => self.lapse_undo(deal_id)?,
            AssistantAct::PauseAgent { agent } => self.pause_agent(agent)?,
            AssistantAct::ResumeAgent { agent } => self.resume_agent(agent)?,
        }
        let consent_hash = H256::digest(args.consent.words.as_bytes()).hex();
        app(self
            .pipeline
            .wallet
            .ledger
            .append_audit(&table_ledger::AuditEntry {
                at: self.clock.now(),
                actor: "owner".into(),
                action: "assistant.act".into(),
                deal_id: act.deal(),
                detail: serde_json::json!({
                    "source": "assistant_proposal",
                    "act": act.name(),
                    "agent": act.agent().map(AgentSlot::key_name),
                    "consent": args.consent.words,
                    "consent_hash": consent_hash,
                    "fingerprint": args.consent.fingerprint,
                }),
            }))
        .map(|_| ())
        .map_err(|_| unavailable("The act ran, but its record could not be written"))
    }
}
