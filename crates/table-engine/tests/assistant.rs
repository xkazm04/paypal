//! The board assistant (`Profile::Assistant`, `AssistantDoor`): argv, the strict stream rules,
//! the door's limits and conformance, and (Windows) the contained process with the offline
//! fixture. No test runs a real CLI.
#![allow(clippy::unwrap_used, clippy::expect_used)]
#![cfg_attr(not(windows), allow(dead_code, unused_imports))]
use async_trait::async_trait;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use table_engine::*;

fn spec() -> AssistantSpec {
    AssistantSpec::new(
        "Reply with one JSON object.",
        &json!({"type":"object","required":["v","say","ops"]}),
    )
    .unwrap()
}
const INIT: &str =
    r#"{"type":"system","subtype":"init","tools":["StructuredOutput"],"mcp_servers":[]}"#;
const REPLY: &str = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t","name":"StructuredOutput","input":{"say":"hi"}}]}}"#;
const ACK: &str = r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"t","type":"tool_result","content":"ok"}]}}"#;
const DONE: &str = r#"{"type":"result","subtype":"success","is_error":false,"result":"x","structured_output":{"v":1,"say":"hi","ops":[]}}"#;

#[test]
fn assistant_argv_is_exact_tool_less_and_claude_code_only() {
    let schema = r#"{ "type": "object" }"#;
    let a = assistant_argv(EngineId::ClaudeCode, "system.md", schema).unwrap();
    let expected = [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--input-format",
        "stream-json",
        "--tools",
        "",
        "--strict-mcp-config",
        "--mcp-config",
        "{\"mcpServers\":{}}",
        "--disallowedTools",
        "mcp__*",
        "--permission-mode",
        "dontAsk",
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--effort",
        "low",
        "--max-budget-usd",
        "0.25",
        "--max-turns",
        "1",
        "--system-prompt-file",
        "system.md",
        "--json-schema",
        "{\"type\":\"object\"}",
    ];
    assert_eq!(a, expected);
    // Nothing that grants a tool, resumes a session or names a model.
    for banned in [
        "--allowedTools",
        "--session-id",
        "--resume",
        "--model",
        "--add-dir",
    ] {
        assert!(!a.iter().any(|v| v == banned), "{banned}");
    }
    assert!(matches!(
        assistant_argv(EngineId::CodexCli, "system.md", schema),
        Err(Error::Unsupported)
    ));
    for bad in ["[]", "not json", ""] {
        assert!(assistant_argv(EngineId::ClaudeCode, "system.md", bad).is_err());
    }
    let huge = json!({"type":"object","description":"x".repeat(ASSISTANT_SCHEMA_MAX)}).to_string();
    assert!(assistant_argv(EngineId::ClaudeCode, "system.md", &huge).is_err());
    // The agent argv refuses the assistant profile rather than treating it as an agent.
    let o = LaunchOptions {
        profile: Profile::Assistant,
        mcp_file: "m".into(),
        system_prompt_file: "s".into(),
        schema_file: "x".into(),
        session: "00000000-0000-4000-8000-000000000001".into(),
        mcp_url: "http://127.0.0.1:1/mcp".into(),
        model: None,
    };
    assert!(argv(EngineId::ClaudeCode, &o).is_err());
}

#[test]
fn the_assistant_stream_takes_its_reply_from_a_clean_result_only() {
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Assistant);
    for line in [
        INIT,
        REPLY,
        ACK,
        r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}"#,
        DONE,
    ] {
        p.line(line).unwrap();
    }
    assert_eq!(p.finish(), TerminalVerdict::Clean);
    assert_eq!(
        p.structured_output(),
        Some(&json!({"v":1,"say":"hi","ops":[]}))
    );
    // An empty inventory is also accepted (no structured-output carrier listed).
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Assistant);
    p.line(r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}"#)
        .unwrap();
    // An error result carries no reply, even with structured output.
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Assistant);
    p.line(INIT).unwrap();
    p.line(r#"{"type":"result","subtype":"error_max_budget_usd","is_error":true,"result":"x","structured_output":{"say":"x"}}"#).unwrap();
    assert!(p.structured_output().is_none());
}

#[test]
fn the_assistant_stream_fails_closed_on_any_tool_server_or_unknown_line() {
    for init in [
        r#"{"type":"system","subtype":"init","tools":["Bash"],"mcp_servers":[]}"#,
        r#"{"type":"system","subtype":"init","tools":["StructuredOutput","WebFetch"],"mcp_servers":[]}"#,
        r#"{"type":"system","subtype":"init","tools":["mcp__wallet__table_view"],"mcp_servers":[]}"#,
        r#"{"type":"system","subtype":"init","tools":["StructuredOutput"],"mcp_servers":[{"name":"wallet","status":"connected"}]}"#,
        r#"{"type":"system","subtype":"init","tools":["StructuredOutput"],"mcp_servers":[],"mcp_server_errors":["x"]}"#,
        r#"{"type":"system","subtype":"init","mcp_servers":[]}"#,
        // Anything before the inventory.
        DONE,
        ACK,
    ] {
        let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Assistant);
        assert!(matches!(p.line(init), Err(Error::Isolation)), "{init}");
        assert!(p.structured_output().is_none());
    }
    for after in [
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}"#,
        r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"mcp__wallet__send_offer","input":{}}]}}"#,
        r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"pay now"}]}}"#,
        r#"{"type":"system","subtype":"hook_response"}"#,
        r#"{"type":"stream_event"}"#,
        INIT,
    ] {
        let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Assistant);
        p.line(INIT).unwrap();
        assert!(p.line(after).is_err(), "{after}");
        assert!(p.line(DONE).is_err());
        assert!(p.structured_output().is_none(), "{after}");
        assert_ne!(p.finish(), TerminalVerdict::Clean);
    }
    // The assistant's allowances never leak into the other profiles.
    for profile in [Profile::Agent, Profile::Toolless] {
        let mut p = StreamParser::new(EngineId::ClaudeCode, profile);
        assert!(p.line(INIT).is_err(), "{profile:?}");
    }
    let mut p = StreamParser::new(EngineId::ClaudeCode, Profile::Toolless);
    p.line(r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}"#)
        .unwrap();
    assert!(p.line(ACK).is_err());
}

#[test]
fn the_spec_is_bounded() {
    assert!(AssistantSpec::new("", &json!({"type":"object"})).is_err());
    assert!(AssistantSpec::new("x", &json!([1])).is_err());
    assert!(AssistantSpec::new(&"x".repeat(ASSISTANT_PROMPT_MAX + 1), &json!({})).is_err());
    assert_eq!(
        spec().schema(),
        r#"{"required":["v","say","ops"],"type":"object"}"#
    );
}

/// A fake turn: answers from a script and counts and records its inputs.
#[derive(Debug)]
struct Fake {
    answers: Mutex<Vec<Result<Value, Error>>>,
    inputs: Mutex<Vec<String>>,
    calls: AtomicUsize,
    delay: Duration,
}
impl Fake {
    fn new(answers: Vec<Result<Value, Error>>) -> Arc<Self> {
        Arc::new(Self {
            answers: Mutex::new(answers),
            inputs: Mutex::new(Vec::new()),
            calls: AtomicUsize::new(0),
            delay: Duration::ZERO,
        })
    }
}
#[async_trait]
impl AssistantTurn for Fake {
    async fn turn(&self, input: &str, _spec: &AssistantSpec) -> Result<Value, Error> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inputs.lock().unwrap().push(input.into());
        tokio::time::sleep(self.delay).await;
        let mut a = self.answers.lock().unwrap();
        if a.is_empty() {
            Ok(json!({"v":1,"say":"ok","ops":[]}))
        } else {
            a.remove(0)
        }
    }
}
fn door(fake: &Arc<Fake>) -> AssistantDoor {
    AssistantDoor::new(Some(fake.clone() as Arc<dyn AssistantTurn>), spec())
}

#[tokio::test]
async fn the_door_runs_a_canned_conformance_turn_before_any_owner_text() {
    let fake = Fake::new(vec![]);
    let d = door(&fake);
    let reply = d.ask("Who needs me?\n\n<board>{}</board>").await.unwrap();
    assert_eq!(serde_json::from_str::<Value>(&reply).unwrap()["say"], "ok");
    let inputs = fake.inputs.lock().unwrap().clone();
    assert_eq!(inputs[0], ASSISTANT_CONFORMANCE_INPUT);
    assert!(!inputs[0].contains("Who needs me"));
    assert_eq!(inputs[1], "Who needs me?\n\n<board>{}</board>");
    // Once per session.
    d.ask("Again?").await.unwrap();
    assert_eq!(fake.calls.load(Ordering::SeqCst), 3);
}

#[tokio::test]
async fn an_isolation_failure_closes_the_door_for_the_session_and_never_sends_owner_text() {
    let fake = Fake::new(vec![Err(Error::Isolation)]);
    let d = door(&fake);
    assert_eq!(
        d.ask("Who needs me?").await,
        Err(AssistantRefusal::Isolation)
    );
    assert_eq!(
        d.ask("Who needs me?").await,
        Err(AssistantRefusal::Isolation)
    );
    assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
    assert!(
        !fake
            .inputs
            .lock()
            .unwrap()
            .iter()
            .any(|i| i.contains("Who"))
    );
    assert_eq!(
        d.status(),
        AssistantStatus {
            available: false,
            refusal: Some(if cfg!(windows) {
                AssistantRefusal::Isolation
            } else {
                AssistantRefusal::Unsupported
            }),
        }
    );
    // A later turn that shows a bad inventory also shuts it.
    let fake = Fake::new(vec![Ok(json!({})), Err(Error::Isolation)]);
    let d = door(&fake);
    assert_eq!(d.ask("one").await, Err(AssistantRefusal::Isolation));
    assert_eq!(d.ask("two").await, Err(AssistantRefusal::Isolation));
    assert_eq!(fake.calls.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn a_conformance_turn_that_merely_fails_is_tried_again_next_time() {
    let fake = Fake::new(vec![Err(Error::Timeout), Err(Error::Spawn)]);
    let d = door(&fake);
    assert_eq!(d.ask("one").await, Err(AssistantRefusal::Timeout));
    assert_eq!(d.ask("two").await, Err(AssistantRefusal::Unavailable));
    let reply = d.ask("three").await.unwrap();
    assert!(reply.starts_with('{'));
    let inputs = fake.inputs.lock().unwrap().clone();
    assert_eq!(
        inputs,
        [
            ASSISTANT_CONFORMANCE_INPUT,
            ASSISTANT_CONFORMANCE_INPUT,
            ASSISTANT_CONFORMANCE_INPUT,
            "three"
        ]
    );
}

#[tokio::test]
async fn the_door_bounds_size_concurrency_rate_and_output() {
    let none = AssistantDoor::new(None, spec());
    assert_eq!(none.ask("hi").await, Err(AssistantRefusal::Unavailable));
    assert!(!none.status().available);
    let fake = Fake::new(vec![]);
    let d = door(&fake);
    assert_eq!(d.ask("   ").await, Err(AssistantRefusal::Invalid));
    assert_eq!(
        d.ask(&"x".repeat(ASSISTANT_INPUT_MAX + 1)).await,
        Err(AssistantRefusal::Invalid)
    );
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);
    // A reply that is not an object, or too large, is bad output.
    let fake = Fake::new(vec![
        Ok(json!({})),
        Ok(json!("text")),
        Ok(json!({"say":"x".repeat(ASSISTANT_OUTPUT_MAX)})),
    ]);
    let d = door(&fake);
    assert_eq!(d.ask("a").await, Err(AssistantRefusal::BadOutput));
    assert_eq!(d.ask("b").await, Err(AssistantRefusal::BadOutput));
    // Rate: the window is full after ASSISTANT_PER_MINUTE asks (failed ones count too).
    for _ in 2..ASSISTANT_PER_MINUTE {
        d.ask("c").await.unwrap();
    }
    assert_eq!(d.ask("d").await, Err(AssistantRefusal::Limited));
}

#[tokio::test(start_paused = true)]
async fn one_question_at_a_time_and_the_minute_rolls() {
    let fake = Arc::new(Fake {
        answers: Mutex::new(Vec::new()),
        inputs: Mutex::new(Vec::new()),
        calls: AtomicUsize::new(0),
        delay: Duration::from_secs(5),
    });
    let d = Arc::new(door(&fake));
    let first = {
        let d = d.clone();
        tokio::spawn(async move { d.ask("first").await })
    };
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert_eq!(d.ask("second").await, Err(AssistantRefusal::Busy));
    assert!(first.await.unwrap().is_ok());
    // A dropped (cancelled) ask frees the slot.
    let dropped = {
        let d = d.clone();
        tokio::spawn(async move { d.ask("dropped").await })
    };
    tokio::time::sleep(Duration::from_millis(10)).await;
    dropped.abort();
    let _ = dropped.await;
    assert!(d.ask("after").await.is_ok());
    for _ in 3..ASSISTANT_PER_MINUTE {
        d.ask("more").await.unwrap();
    }
    assert_eq!(d.ask("full").await, Err(AssistantRefusal::Limited));
    tokio::time::sleep(Duration::from_secs(61)).await;
    assert!(d.ask("next minute").await.is_ok());
}

// The process half: the contained child, with the offline fixture (Windows only).
fn root() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.build/engine-tests")
        .join(ulid::Ulid::new().to_string());
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
}
fn fixture(mode: &str, root: &std::path::Path) -> NativeEngine {
    NativeEngine::new(
        EngineId::ClaudeCode,
        Executable {
            program: PathBuf::from(env!("CARGO_BIN_EXE_engine-fixture")),
            prefix: vec![mode.into(), root.join("input").to_str().unwrap().into()],
        },
        root.join("runs"),
        RunLimits {
            init: Duration::from_secs(4),
            total: Duration::from_secs(8),
        },
    )
    .unwrap()
}
async fn runs_cleaned(root: &std::path::Path) {
    tokio::time::timeout(Duration::from_secs(3), async {
        while std::fs::read_dir(root.join("runs")).unwrap().count() != 0 {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn a_contained_assistant_turn_returns_the_structured_reply() {
    let root = root();
    let engine = fixture("assistant", &root);
    let input = "Who needs me? $(evil) `x` \" ; &\n\n<board>{}</board>";
    let reply = engine.assistant_turn(input, &spec()).await.unwrap();
    assert_eq!(reply, json!({"v":1,"say":"Two need you.","ops":[]}));
    let written: Value =
        serde_json::from_str(&std::fs::read_to_string(root.join("input")).unwrap()).unwrap();
    assert_eq!(written["message"]["content"], input);
    let args: Vec<String> =
        serde_json::from_str(&std::fs::read_to_string(root.join("input.args")).unwrap()).unwrap();
    assert_eq!(
        args,
        assistant_argv(EngineId::ClaudeCode, &args[args.len() - 3], spec().schema()).unwrap()
    );
    // The system prompt file is the spec's, beside (not inside) the empty cwd.
    assert_eq!(
        std::fs::read_to_string(root.join("input.cwd")).unwrap(),
        "0"
    );
    runs_cleaned(&root).await;
}

#[cfg(windows)]
#[tokio::test]
async fn a_bad_inventory_kills_the_turn_at_once() {
    let root = root();
    let engine = fixture("assistant-decoy", &root);
    let started = std::time::Instant::now();
    let error = engine.assistant_turn("hi", &spec()).await.unwrap_err();
    assert!(matches!(error, Error::Isolation), "{error:?}");
    // The decoy sleeps 30 s after its inventory; the host did not wait for it.
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "{:?}",
        started.elapsed()
    );
    runs_cleaned(&root).await;
}

#[cfg(windows)]
#[tokio::test]
async fn forbidden_calls_missing_replies_and_oversized_output_fail() {
    for (mode, isolation) in [
        ("assistant-tool", true),
        ("assistant-noreply", false),
        ("assistant-error", false),
        ("assistant-big", false),
        ("stall", false),
    ] {
        let root = root();
        let engine = fixture(mode, &root);
        let error = engine.assistant_turn("hi", &spec()).await.unwrap_err();
        assert_eq!(
            matches!(error, Error::Isolation),
            isolation,
            "{mode} {error:?}"
        );
        runs_cleaned(&root).await;
    }
}

#[cfg(windows)]
#[tokio::test]
async fn the_child_inherits_no_stripped_variable() {
    let root = root();
    let engine = fixture("assistant", &root);
    engine.assistant_turn("hi", &spec()).await.unwrap();
    // The fixture lists whichever canaries it can see; the test runner may or may not have
    // them, and env_clear must leave none either way.
    assert_eq!(std::fs::read_to_string(root.join("input.env")).unwrap(), "");
}

#[cfg(windows)]
#[tokio::test]
async fn the_door_over_a_real_contained_child() {
    let good = root();
    let engine: Arc<dyn AssistantTurn> = Arc::new(fixture("assistant", &good));
    let d = AssistantDoor::new(Some(engine), spec());
    let reply = d.ask("Who needs me?").await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&reply).unwrap()["say"],
        "Two need you."
    );
    let root = root();
    let engine: Arc<dyn AssistantTurn> = Arc::new(fixture("assistant-decoy", &root));
    let d = AssistantDoor::new(Some(engine), spec());
    assert_eq!(
        d.ask("Who needs me?").await,
        Err(AssistantRefusal::Isolation)
    );
    // The only input the decoy ever saw is the canned check.
    assert_eq!(
        std::fs::read_to_string(root.join("input")).unwrap(),
        json!({"type":"user","message":{"role":"user","content":ASSISTANT_CONFORMANCE_INPUT}})
            .to_string()
            + "\n"
    );
    assert!(!d.status().available);
}
