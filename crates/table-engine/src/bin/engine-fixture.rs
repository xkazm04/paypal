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
        "agent" | "toolless" | "tree" | "bad-result" | "no-terminal" | "env" => {
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
        }
        _ => std::process::exit(2),
    }
}
