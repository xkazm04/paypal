#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Safe acts (acts.rs): the lapse undo, the one-agent pause and resume, and the assistant door
//! that records provenance. None of them reaches PayPal or changes a deal's state.
use super::*;

fn consent(words: &str) -> ConsentShown {
    ConsentShown {
        words: words.into(),
        fingerprint: "test|fingerprint".into(),
    }
}
fn assistant(act: AssistantAct, words: &str) -> Action {
    Action::AssistantAct(AssistantActArgs {
        act,
        consent: consent(words),
    })
}
fn lapsed(r: &Runtime, id: DealId) -> bool {
    r.pipeline
        .wallet
        .ledger
        .preference::<bool>(&format!("lapse.{id}"))
        .unwrap()
        .unwrap_or(false)
}
/// The newest audit rows' actions, newest first.
fn recent_actions(r: &Runtime, n: u16) -> Vec<table_ledger::AuditRecord> {
    r.pipeline.wallet.ledger.audit_page(None, n).unwrap().0
}

#[tokio::test]
async fn a_lapse_can_be_undone_before_the_deadline_and_the_ask_is_back() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let state = r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state;
    // Nothing to undo yet.
    assert!(
        r.execute(caller("main", None), Action::LapseUndo(deal.id))
            .await
            .is_err()
    );
    r.execute(caller("main", None), Action::LetLapse(deal.id))
        .await
        .unwrap();
    assert!(lapsed(&r, deal.id));
    assert!(
        r.attention()
            .unwrap()
            .items
            .iter()
            .all(|i| i.deal_id != deal.id)
    );
    // Main only: the Tumbler and the approval window may not undo it.
    for label in ["tumbler", "approval"] {
        assert!(
            r.execute(caller(label, None), Action::LapseUndo(deal.id))
                .await
                .is_err()
        );
    }
    r.execute(caller("main", None), Action::LapseUndo(deal.id))
        .await
        .unwrap();
    assert!(!lapsed(&r, deal.id));
    assert!(
        r.attention()
            .unwrap()
            .items
            .iter()
            .any(|i| i.deal_id == deal.id)
    );
    // The deal itself never moved, and no money step ran.
    assert_eq!(
        r.pipeline.wallet.ledger.get_deal(deal.id).unwrap().state,
        state
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
    // A second undo has nothing to clear.
    assert!(
        r.execute(caller("main", None), Action::LapseUndo(deal.id))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn a_lapse_on_a_deal_that_already_ended_cannot_be_undone() {
    let (mut r, _, _, clock, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    r.execute(caller("main", None), Action::LetLapse(deal.id))
        .await
        .unwrap();
    clock.0.store(900_001, Ordering::SeqCst);
    r.tick().await.unwrap();
    r.tick().await.unwrap();
    assert!(
        r.pipeline
            .wallet
            .ledger
            .get_deal(deal.id)
            .unwrap()
            .state
            .terminal()
    );
    assert!(
        r.execute(caller("main", None), Action::LapseUndo(deal.id))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn pausing_one_agent_refuses_its_runs_only_and_resume_clears_it() {
    let (mut r, _, http, _, _) = runtime(true);
    // `setup` signs its mandate for the negotiator.
    let (deal, _) = setup(&mut r, Side::Buyer);
    r.execute(caller("main", None), Action::AgentPause(AgentSlot::Shopper))
        .await
        .unwrap();
    assert_eq!(
        r.settings().unwrap().paused_agents,
        Some(vec![AgentSlot::Shopper])
    );
    assert!(!r.settings().unwrap().agents_paused);
    // The negotiator's deal is not held by the shopper's pause.
    let other = r.start_agent(deal.id).err().map(|e| e.message);
    assert_ne!(other.as_deref(), Some(crate::acts::AGENT_PAUSED));
    r.cancel_runs().unwrap();
    r.execute(
        caller("main", None),
        Action::AgentPause(AgentSlot::Negotiator),
    )
    .await
    .unwrap();
    assert_eq!(
        r.settings().unwrap().paused_agents,
        Some(vec![AgentSlot::Negotiator, AgentSlot::Shopper])
    );
    let held = r.start_agent(deal.id).unwrap_err();
    assert_eq!(held.message, crate::acts::AGENT_PAUSED);
    // Main only.
    for label in ["tumbler", "approval"] {
        assert!(
            r.execute(
                caller(label, None),
                Action::AgentResume(AgentSlot::Negotiator)
            )
            .await
            .is_err()
        );
    }
    r.execute(
        caller("main", None),
        Action::AgentResume(AgentSlot::Negotiator),
    )
    .await
    .unwrap();
    assert_eq!(
        r.settings().unwrap().paused_agents,
        Some(vec![AgentSlot::Shopper])
    );
    assert_ne!(
        r.start_agent(deal.id).err().map(|e| e.message).as_deref(),
        Some(crate::acts::AGENT_PAUSED)
    );
    assert!(http.0.lock().unwrap().paths.is_empty());
}

#[tokio::test]
async fn the_assistant_door_runs_the_act_and_records_what_she_was_shown() {
    let (mut r, _, http, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let words = "Needs your OK. Let D-0001 lapse. Nothing is paid. You can undo this here.";
    r.execute(
        caller("main", None),
        assistant(AssistantAct::LetLapse { deal_id: deal.id }, words),
    )
    .await
    .unwrap();
    assert!(lapsed(&r, deal.id));
    let row = &recent_actions(&r, 1)[0];
    assert_eq!(row.action, "assistant.act");
    assert_eq!(row.actor, "owner");
    assert_eq!(row.deal_id, Some(deal.id));
    assert_eq!(row.detail["source"], "assistant_proposal");
    assert_eq!(row.detail["act"], "let_lapse");
    assert_eq!(row.detail["consent"], words);
    assert_eq!(
        row.detail["consent_hash"],
        H256::digest(words.as_bytes()).hex()
    );
    assert_eq!(row.detail["fingerprint"], "test|fingerprint");
    // The undo is recorded the same way.
    r.execute(
        caller("main", None),
        assistant(AssistantAct::LapseUndo { deal_id: deal.id }, "Undo."),
    )
    .await
    .unwrap();
    assert!(!lapsed(&r, deal.id));
    assert_eq!(recent_actions(&r, 1)[0].detail["act"], "lapse_undo");
    // One agent, and every agent.
    for (act, name) in [
        (
            AssistantAct::PauseAgent {
                agent: AgentSlot::Shopper,
            },
            "pause_agent",
        ),
        (
            AssistantAct::ResumeAgent {
                agent: AgentSlot::Shopper,
            },
            "resume_agent",
        ),
        (AssistantAct::PauseAll {}, "pause_all"),
        (AssistantAct::ResumeAll {}, "resume_all"),
    ] {
        r.execute(caller("main", None), assistant(act, "Pause it."))
            .await
            .unwrap();
        let row = &recent_actions(&r, 1)[0];
        assert_eq!(row.detail["act"], name);
        assert_eq!(
            row.detail["agent"],
            act.agent()
                .map_or(serde_json::Value::Null, |a| a.key_name().into())
        );
    }
    assert!(!r.settings().unwrap().agents_paused);
    assert!(http.0.lock().unwrap().paths.is_empty());
    r.pipeline.wallet.ledger.verify_audit().unwrap();
}

#[tokio::test]
async fn the_assistant_door_refuses_bad_words_and_records_nothing_for_a_refused_act() {
    let (mut r, _, _, _, _) = runtime(true);
    let (deal, peer) = setup(&mut r, Side::Seller);
    agree(&mut r, &deal, &peer);
    let before = r.pipeline.wallet.ledger.audit_count().unwrap();
    for words in ["", "   ", "two\nlines", &"x".repeat(CONSENT_WORDS_MAX + 1)] {
        assert!(
            r.execute(
                caller("main", None),
                assistant(AssistantAct::LetLapse { deal_id: deal.id }, words)
            )
            .await
            .is_err(),
            "{words:?}"
        );
    }
    assert!(!lapsed(&r, deal.id));
    // A refused act (nothing lapsed, so nothing to undo) writes no provenance row.
    assert!(
        r.execute(
            caller("main", None),
            assistant(AssistantAct::LapseUndo { deal_id: deal.id }, "Undo.")
        )
        .await
        .is_err()
    );
    // Only main may use the door.
    for label in ["tumbler", "approval"] {
        assert!(
            r.execute(
                caller(label, None),
                assistant(AssistantAct::PauseAll {}, "Pause.")
            )
            .await
            .is_err()
        );
    }
    assert!(!r.settings().unwrap().agents_paused);
    let rows = recent_actions(&r, 20);
    let after = r.pipeline.wallet.ledger.audit_count().unwrap();
    assert!(
        rows.iter()
            .take(usize::try_from(after - before).unwrap())
            .all(|row| row.action != "assistant.act")
    );
}
