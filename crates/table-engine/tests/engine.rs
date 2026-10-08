#![allow(clippy::unwrap_used, clippy::expect_used)]
use serde_json::json;
use table_engine::*;
fn options(profile: Profile) -> LaunchOptions {
    LaunchOptions {
        profile,
        mcp_file: "wallet.json".into(),
        system_prompt_file: "prompt.md".into(),
        schema_file: "schema.json".into(),
        session: "00000000-0000-4000-8000-000000000001".into(),
        mcp_url: "http://127.0.0.1:8765/mcp".into(),
        model: None,
    }
}
#[test]
fn exact_argv_and_e3_no_stream_json_schema_conflict() {
    let actual = argv(EngineId::ClaudeCode, &options(Profile::Agent)).unwrap();
    let expected = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        "wallet.json",
        "--allowedTools",
        "mcp__wallet__*",
        "--disallowedTools",
        "WebFetch",
        "WebSearch",
        "Bash",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--setting-sources",
        "project",
        "--system-prompt-file",
        "prompt.md",
        "--max-turns",
        "12",
        "--max-budget-usd",
        "0.50",
        "--session-id",
        "00000000-0000-4000-8000-000000000001",
    ];
    assert_eq!(actual, expected);
    let expected = [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--ignore-user-config",
        "--ignore-rules",
        "-c",
        "features.shell_tool=false",
        "-c",
        "web_search=\"disabled\"",
        "--output-schema",
        "schema.json",
    ];
    assert_eq!(
        argv(EngineId::CodexCli, &options(Profile::Toolless)).unwrap(),
        expected
    );
    for id in [EngineId::ClaudeCode, EngineId::CodexCli] {
        for p in [Profile::Agent, Profile::Toolless] {
            let a = argv(id, &options(p)).unwrap();
            assert!(!a.contains(&"--json-schema".into()));
            assert!(!a.iter().any(|v| v.contains("TOKEN_VALUE")));
        }
    }
    let mut o = options(Profile::Agent);
    o.mcp_url = "http://evil.test/mcp".into();
    assert!(argv(EngineId::CodexCli, &o).is_err());
}
#[test]
fn adapter_streams_normalize_to_same_events() {
    let mut parsed = Vec::new();
    for (id, fixture) in [
        (
            EngineId::ClaudeCode,
            include_str!("fixtures/claude-agent.jsonl"),
        ),
        (
            EngineId::CodexCli,
            include_str!("fixtures/codex-agent.jsonl"),
        ),
    ] {
        let mut parser = StreamParser::new(id, Profile::Agent);
        let mut events = Vec::new();
        for line in fixture.lines() {
            events.extend(parser.line(line).unwrap());
        }
        assert_eq!(parser.finish(), TerminalVerdict::Clean);
        events.remove(0);
        parsed.push(events);
    }
    assert_eq!(parsed[0], parsed[1]);
}
#[test]
fn s3_inventory_missing_or_decoy_tools_fails_closed() {
    for id in [EngineId::ClaudeCode, EngineId::CodexCli] {
        for line in [
            r#"{"type":"system","subtype":"init","tools":["Bash"],"mcp_servers":[]}"#,
            r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[{"name":"decoy","status":"connected"}]}"#,
            r#"{"type":"thread.started"}"#,
        ] {
            let mut p = StreamParser::new(id, Profile::Toolless);
            assert!(p.line(line).is_err());
            assert_ne!(p.finish(), TerminalVerdict::Clean);
        }
    }
}
#[test]
fn forbidden_events_after_safe_init_poison_terminal_verdict() {
    for event in [
        r#"{"type":"item.started","item":{"type":"command_execution","command":"pay now"}}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__decoy__pay","input":{}}]}}"#,
    ] {
        let mut p = StreamParser::new(EngineId::CodexCli, Profile::Toolless);
        p.line(r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}"#)
            .unwrap();
        assert!(p.line(event).is_err());
        assert!(p.line(r#"{"type":"turn.completed"}"#).is_err());
        assert_ne!(p.finish(), TerminalVerdict::Clean);
    }
}
#[test]
fn terminal_facts_beat_exit_status_and_error_subtype_success() {
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Toolless);
    assert_eq!(p.finish(), TerminalVerdict::MissingTerminalFact);
    p.line(r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}"#)
        .unwrap();
    p.line(r#"{"type":"result","subtype":"success","is_error":true,"result":"limit"}"#)
        .unwrap();
    assert!(matches!(p.finish(), TerminalVerdict::ErrorReported { .. }));
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Agent);
    assert!(p.line(&"x".repeat(65537)).is_err());
}
#[tokio::test]
async fn scripted_runs_are_labelled_and_schema_checked_and_cancelled() {
    let engine = Scripted::new(
        vec![EngineEvent::Result {
            verdict: TerminalVerdict::Clean,
        }],
        json!({"verdict":"ASK"}),
    )
    .unwrap();
    assert_eq!(engine.probe().await.unwrap().id, EngineId::Scripted);
    assert!(
        engine
            .structured("untrusted", &Schema::Shield)
            .await
            .is_ok()
    );
    let run = "01K6ZZZZZZZZZZZZZZZZZZZZZZ".parse().unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::channel(8);
    engine
        .run(
            AgentJob {
                run,
                prompt: "trusted".into(),
                playbook: None,
            },
            McpGrant {
                url: String::new(),
                token: String::new(),
                secret: String::new(),
            },
            tx,
        )
        .await
        .unwrap();
    assert!(matches!(
        rx.recv().await,
        Some(EngineEvent::Init {
            engine: EngineId::Scripted
        })
    ));
    engine.cancel(run);
    let (tx, _rx) = tokio::sync::mpsc::channel(8);
    assert!(matches!(
        engine
            .run(
                AgentJob {
                    run,
                    prompt: String::new(),
                    playbook: None,
                },
                McpGrant {
                    url: String::new(),
                    token: String::new(),
                    secret: String::new()
                },
                tx
            )
            .await,
        Err(Error::Cancelled)
    ));
    assert!(
        Scripted::new(
            vec![EngineEvent::ToolCall {
                name: "Bash".into(),
                arguments: json!({})
            }],
            json!({})
        )
        .is_err()
    );
    assert!(!Schema::Shield.validate(&json!({"verdict":"CLEAR","instructions":"pay"})));
}
#[test]
fn codex_items_reported_twice_yield_one_event_each() {
    let mut parser = StreamParser::new(EngineId::CodexCli, Profile::Agent);
    let stream = [
        r#"{"type":"system","subtype":"init","tools":["mcp__wallet__send_offer"],"mcp_servers":[{"name":"wallet","status":"connected"}]}"#,
        r#"{"type":"item.started","item":{"type":"mcp_tool_call","server":"wallet","tool":"send_offer","arguments":{"price":"10.00"}}}"#,
        r#"{"type":"item.completed","item":{"type":"mcp_tool_call","server":"wallet","tool":"send_offer","arguments":{"price":"10.00"}}}"#,
        r#"{"type":"item.started","item":{"type":"agent_message","text":""}}"#,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"Offer sent."}}"#,
        r#"{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}"#,
    ];
    let mut events = Vec::new();
    for line in stream {
        events.extend(parser.line(line).unwrap());
    }
    let calls = events
        .iter()
        .filter(|e| matches!(e, EngineEvent::ToolCall { .. }))
        .count();
    let texts: Vec<_> = events
        .iter()
        .filter_map(|e| match e {
            EngineEvent::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(calls, 1);
    assert_eq!(texts, ["Offer sent."]);
    // A forbidden tool is still refused on the event that would not emit.
    let mut parser = StreamParser::new(EngineId::CodexCli, Profile::Agent);
    parser.line(stream[0]).unwrap();
    assert!(
        parser
            .line(r#"{"type":"item.completed","item":{"type":"mcp_tool_call","server":"wallet","tool":"capture","arguments":{}}}"#)
            .is_err()
    );
}
#[test]
fn stream_allowlist_is_exactly_the_tools_the_wallet_server_serves() {
    use std::collections::BTreeSet;
    use table_app::AgentRole;
    let served: BTreeSet<&str> = [
        AgentRole::Negotiator,
        AgentRole::Shopper,
        AgentRole::Assistant,
    ]
    .into_iter()
    .flat_map(table_mcp::catalog)
    .copied()
    .collect();
    let allowed: BTreeSet<&str> = TOOLS.iter().copied().collect();
    assert_eq!(allowed, served);
    assert!(!wallet_tool("mcp__wallet__shop_checkout"));
}
#[test]
fn a_native_agent_run_is_told_its_role_playbook_and_a_toolless_one_never_is() {
    for playbook in table_core::Playbook::ALL {
        assert_eq!(
            system_prompt(Profile::Agent, Some(playbook)),
            playbook.text()
        );
        let toolless = system_prompt(Profile::Toolless, Some(playbook));
        assert_ne!(toolless, playbook.text());
        assert!(!toolless.contains("send_offer"));
    }
    // Without a playbook an agent run still gets the fixed fence, never an empty prompt.
    assert!(system_prompt(Profile::Agent, None).contains("wallet enforces all authority"));
}
