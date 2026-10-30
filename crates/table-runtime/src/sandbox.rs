//! Headless sandbox assembly (feature `sandbox`, built for `table-sandbox` only).
//!
//! The owner's setup steps a desktop takes in the approval window (pin the HOUSE, confirm its
//! pairing words, sign a rule, join its table) taken here by Rust before the actor starts, through
//! the same functions the dispatcher calls. Nothing here is an IPC command, and nothing here moves
//! money: every agent intent still passes the run gate, the signed mandate and the MCP server.
use crate::*;
use std::sync::Arc;
use table_client::*;
use table_core::*;

impl Runtime {
    /// Pins the release of an in-process house, as a build pins its HOUSE with
    /// `HouseRelease::compiled`. A table is joined only after its response verifies against it.
    pub fn sandbox_pin_house(&mut self, release: table_proto::HouseRelease) {
        self.house_release = Some(release);
        self.house_state = HouseState::Idle;
    }
    /// The buyer's request for a table at the pinned house (the `house_offer` step).
    pub fn sandbox_house_request(
        &mut self,
        payee: PayeeRef,
    ) -> Result<table_proto::HouseRequest, CommandError> {
        let offer = self.house_offer(PairingCreateArgs {
            side: Side::Buyer,
            payee,
        })?;
        Ok(table_proto::HouseRequest {
            buyer: offer.bundle,
        })
    }
    /// Verifies the house's answer against the pin, confirms its pairing words, signs the
    /// owner's negotiator rule and joins the house's table under its deal id.
    pub fn sandbox_join_house_table(
        &mut self,
        response: table_proto::HouseResponse,
        clauses: Vec<Clause>,
        expires: Timestamp,
    ) -> Result<Deal, CommandError> {
        let words = self.house_pair(response)?;
        let table = words.house_table.clone().ok_or_else(invalid)?;
        let counterparty = self.pairing_confirm(PairingConfirmArgs {
            pairing_id: words.pairing_id,
            words: words.words.clone(),
            display_name: "House seller".into(),
        })?;
        let mandate = self.sign_mandate(MandateSignArgs {
            id: None,
            agent: AgentSlot::Negotiator,
            clauses,
            not_before: self.clock.now(),
            expires,
        })?;
        self.join_deal(
            DealCreateArgs {
                kind: DealKind::Haggle,
                side: Side::Buyer,
                counterparty,
                mandate_id: mandate.payload.id,
                mandate_version: mandate.payload.version,
                terms: table.terms,
                category: table.category,
            },
            table.deal_id,
        )
    }
    /// Seats `adapter` in the engine slot `info.id` names, replacing whatever held it, and selects
    /// it. It is started like any engine: `agent_start` (or a policy re-arm) mints its run's grant.
    pub fn sandbox_engine(
        &mut self,
        adapter: Arc<dyn table_engine::EngineAdapter>,
        info: table_engine::EngineInfo,
    ) {
        self.engines.retain(|(_, held)| held.id != info.id);
        self.engine_probed_at.push((info.id, self.clock.now()));
        self.engine = info.id;
        self.engines.push((adapter, info));
    }
}
