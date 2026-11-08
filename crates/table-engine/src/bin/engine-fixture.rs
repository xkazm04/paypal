//! Offline test child. No CLI, HTTP, credentials, or model implementation.
use std::{
    io::{self, Read, Write},
    path::PathBuf,
    time::Duration,
};
#[allow(clippy::unwrap_used)] // Offline fixture binary edge, never linked into the wallet.
fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_default();
    let evidence = PathBuf::from(args.next().unwrap_or_default());
    match mode.as_str() {
        "--version" => println!("0.0.1 (offline fixture)"),
        "env-host" => {
            // A separate host process lets the test seed inherited environment
            // without mutating the parallel Rust test runner's global state.
            for key in [
                "OPENAI_API_KEY",
                "ANTHROPIC_API_KEY",
                "NODE_OPTIONS",
                "CLAUDECODE",
            ] {
                assert!(std::env::var_os(key).is_some());
            }
            let executable = std::env::current_exe().unwrap();
            tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap()
                .block_on(async {
                    use table_engine::{
                        AgentJob, EngineAdapter, EngineId, Executable, McpGrant, NativeEngine,
                        RunLimits, TerminalVerdict,
                    };
                    let engine = NativeEngine::new(
                        EngineId::ClaudeCode,
                        Executable {
                            program: executable,
                            prefix: vec!["env".into(), evidence.to_str().unwrap().into()],
                        },
                        evidence.parent().unwrap().join("runs"),
                        RunLimits::default(),
                    )
                    .unwrap();
                    let (tx, _rx) = tokio::sync::mpsc::channel(16);
                    let result = engine
                        .run(
                            AgentJob {
                                run: table_core::RunId(ulid::Ulid::new()),
                                prompt: "Offline environment check".into(),
                                playbook: None,
                            },
                            McpGrant {
                                url: "http://127.0.0.1:8765/mcp".into(),
                                token: ulid::Ulid::new().to_string(),
                                secret: ulid::Ulid::new().to_string(),
                            },
                            tx,
                        )
                        .await
                        .unwrap();
                    assert_eq!(result, TerminalVerdict::Clean);
                });
        }
        "missing" => {
            println!("{{\"type\":\"thread.started\"}}");
            io::stdout().flush().unwrap();
            std::thread::sleep(Duration::from_secs(30));
        }
        "stall" => std::thread::sleep(Duration::from_secs(30)),
        "large" => {
            println!("{}", "x".repeat(65537));
        }
        "decoy" => {
            println!(r#"{{"type":"system","subtype":"init","tools":["Bash"],"mcp_servers":[]}}"#)
        }
        "descendant" => {
            std::fs::write(evidence, std::process::id().to_string()).unwrap();
            std::thread::sleep(Duration::from_secs(30));
        }
        // The board assistant (Profile::Assistant). Like the measured CLI, the inventory comes
        // only after stdin is read. Labelled fixture output, never proof of a real CLI.
        "assistant" | "assistant-decoy" | "assistant-tool" | "assistant-noreply"
        | "assistant-big" | "assistant-error" => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input).unwrap();
            std::fs::write(&evidence, &input).unwrap();
            let argv: Vec<String> = args.collect();
            std::fs::write(
                evidence.with_extension("args"),
                serde_json::to_string(&argv).unwrap(),
            )
            .unwrap();
            let cwd = std::env::current_dir().unwrap();
            std::fs::write(
                evidence.with_extension("cwd"),
                std::fs::read_dir(&cwd).unwrap().count().to_string(),
            )
            .unwrap();
            let keys = std::env::vars()
                .map(|(k, _)| k)
                .filter(|k| {
                    [
                        "OPENAI_API_KEY",
                        "ANTHROPIC_API_KEY",
                        "NODE_OPTIONS",
                        "CLAUDECODE",
                    ]
                    .contains(&k.as_str())
                })
                .collect::<Vec<_>>();
            std::fs::write(evidence.with_extension("env"), keys.join(",")).unwrap();
            let tools = if mode == "assistant-decoy" {
                r#"["Bash","StructuredOutput"]"#
            } else {
                r#"["StructuredOutput"]"#
            };
            println!(
                r#"{{"type":"system","subtype":"init","tools":{tools},"mcp_servers":[],"permissionMode":"dontAsk"}}"#
            );
            io::stdout().flush().unwrap();
            if mode == "assistant-decoy" {
                // Would go on to act; the host must kill it on the inventory alone.
                std::thread::sleep(Duration::from_secs(30));
                return;
            }
            io::stderr().write_all(&vec![b'x'; 128 * 1024]).unwrap();
            let tool = if mode == "assistant-tool" {
                "Bash"
            } else {
                "StructuredOutput"
            };
            println!(
                r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","id":"t1","name":"{tool}","input":{{"v":1,"say":"Two need you.","ops":[]}}}}]}}}}"#
            );
            println!(
                r#"{{"type":"user","message":{{"role":"user","content":[{{"tool_use_id":"t1","type":"tool_result","content":"Structured output provided successfully"}}]}}}}"#
            );
            println!(r#"{{"type":"rate_limit_event","rate_limit_info":{{"status":"allowed"}}}}"#);
            if mode == "assistant-big" {
                for _ in 0..80 {
                    println!(
                        r#"{{"type":"rate_limit_event","pad":"{}"}}"#,
                        "x".repeat(1024)
                    );
                }
            }
            match mode.as_str() {
                "assistant-noreply" => println!(
                    r#"{{"type":"result","subtype":"success","is_error":false,"result":"fixture"}}"#
                ),
                "assistant-error" => println!(
                    r#"{{"type":"result","subtype":"error_max_budget_usd","is_error":true,"result":"fixture"}}"#
                ),
                _ => println!(
                    r#"{{"type":"result","subtype":"success","is_error":false,"result":"fixture","structured_output":{{"v":1,"say":"Two need you.","ops":[]}}}}"#
                ),
            }
        }
        "agent" | "exit2" | "toolless" | "tree" | "bad-result" | "no-terminal" | "env" => {
            // Fake inventory is labelled by this binary; never proof of a real CLI.
            let inventory = if mode == "toolless" {
                r#"{"type":"system","subtype":"init","tools":[],"mcp_servers":[]}"#
            } else {
                r#"{"type":"system","subtype":"init","tools":["mcp__wallet__table_view"],"mcp_servers":[{"name":"wallet","status":"connected"}]}"#
            };
            println!("{inventory}");
            io::stdout().flush().unwrap();
            let mut input = String::new();
            io::stdin().read_to_string(&mut input).unwrap();
            std::fs::write(&evidence, &input).unwrap();
            // stderr pipe exceeds capacity; the host must drain it while reading stdout.
            io::stderr().write_all(&vec![b'x'; 128 * 1024]).unwrap();
            if mode == "tree" {
                let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                    .arg("descendant")
                    .arg(evidence.with_extension("pid"))
                    .spawn()
                    .unwrap();
                std::fs::write(evidence.with_extension("child"), child.id().to_string()).unwrap();
                std::thread::sleep(Duration::from_secs(30));
                let _ = child.wait();
                return;
            }
            if mode == "env" {
                let cwd = std::env::current_dir().unwrap();
                for name in ["mcp.json", "system.md", "schema.json"] {
                    let contents =
                        std::fs::read_to_string(cwd.parent().unwrap().join(name)).unwrap();
                    for key in ["WALLET_MCP_TOKEN", "WALLET_MCP_SECRET"] {
                        let token = std::env::var(key).unwrap();
                        assert!(!token.is_empty() && !contents.contains(&token));
                    }
                }
                let keys = std::env::vars()
                    .filter(|(k, _)| {
                        [
                            "OPENAI_API_KEY",
                            "ANTHROPIC_API_KEY",
                            "NODE_OPTIONS",
                            "CLAUDECODE",
                        ]
                        .contains(&k.as_str())
                    })
                    .map(|(k, _)| k)
                    .collect::<Vec<_>>();
                std::fs::write(evidence.with_extension("env"), keys.join(",")).unwrap();
            }
            if mode == "no-terminal" {
                return;
            }
            if mode == "toolless" {
                println!(
                    r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{{\"verdict\":\"ASK\"}}"}}]}}}}"#
                );
            }
            println!(
                "{{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":{},\"result\":\"fixture\"}}",
                mode == "bad-result"
            );
            if mode == "exit2" {
                std::process::exit(2);
            }
        }
        _ => std::process::exit(2),
    }
}
