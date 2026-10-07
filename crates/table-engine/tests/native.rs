#![allow(clippy::unwrap_used, clippy::expect_used)]
use std::{path::PathBuf, sync::Arc, time::Duration};
use table_core::RunId;
use table_engine::*;
fn root() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.build/engine-tests")
        .join(ulid::Ulid::new().to_string());
    std::fs::create_dir_all(&root).unwrap();
    root.canonicalize().unwrap()
}
fn fixture(mode: &str, root: &std::path::Path, total: u64) -> NativeEngine {
    NativeEngine::new(
        EngineId::ClaudeCode,
        Executable {
            program: PathBuf::from(env!("CARGO_BIN_EXE_engine-fixture")),
            prefix: vec![mode.into(), root.join("input").to_str().unwrap().into()],
        },
        root.join("runs"),
        RunLimits {
            // 500 ms was too tight: with the seven tests spawning the fixture in parallel
            // on Windows, first output took longer (measured 2 to 3 of 7 tests failing with
            // Timeout per run). Total budgets below still bound every run.
            init: Duration::from_millis(total.min(4000)),
            total: Duration::from_millis(total),
        },
    )
    .unwrap()
}
fn grant() -> McpGrant {
    McpGrant {
        url: "http://127.0.0.1:8765/mcp".into(),
        token: ulid::Ulid::new().to_string(),
        secret: ulid::Ulid::new().to_string(),
    }
}
fn job() -> AgentJob {
    AgentJob {
        run: RunId(ulid::Ulid::new()),
        prompt: "TRUSTED input $(evil) `literal` \" ; &".into(),
    }
}
#[test]
fn direct_and_npm_resolution_never_executes_shim_text() {
    let root = root();
    std::fs::write(root.join("codex.cmd"), "erase C:\\ ; evil %*").unwrap();
    assert!(resolve_command(EngineId::CodexCli, std::slice::from_ref(&root)).is_err());
    let script = root.join("node_modules/@openai/codex/bin/codex.js");
    std::fs::create_dir_all(script.parent().unwrap()).unwrap();
    std::fs::write(&script, "// fixture").unwrap();
    std::fs::write(root.join("node.exe"), "fixture").unwrap();
    let exe = resolve_command(EngineId::CodexCli, std::slice::from_ref(&root)).unwrap();
    assert_eq!(exe.program, root.join("node.exe"));
    assert_eq!(exe.prefix.len(), 1);
    assert_eq!(
        PathBuf::from(&exe.prefix[0]).canonicalize().unwrap(),
        script
    );
    assert!(!exe.prefix[0].starts_with(r"\\?\"));
    std::fs::write(root.join("codex.exe"), "fixture").unwrap();
    assert!(
        resolve_command(EngineId::CodexCli, &[root])
            .unwrap()
            .prefix
            .is_empty()
    );
}
#[cfg(windows)]
#[tokio::test]
async fn inherited_canary_environment_is_stripped_before_child_launch() {
    let root = root();
    let canary = ulid::Ulid::new().to_string();
    let mut host = tokio::process::Command::new(env!("CARGO_BIN_EXE_engine-fixture"));
    host.args(["env-host", root.join("input").to_str().unwrap()])
        .kill_on_drop(true)
        .creation_flags(0x08000000)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    for key in [
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "NODE_OPTIONS",
        "CLAUDECODE",
    ] {
        host.env(key, &canary);
    }
    let status = tokio::time::timeout(Duration::from_secs(10), host.status())
        .await
        .unwrap()
        .unwrap();
    assert!(status.success()); // The host first asserts all four canaries exist.
    assert!(
        std::fs::read_to_string(root.join("input.env"))
            .unwrap()
            .is_empty()
    );
    assert!(
        !std::fs::read_to_string(root.join("input"))
            .unwrap()
            .contains(&canary)
    );
}
#[cfg(windows)]
#[tokio::test]
async fn version_probe_is_bounded_silent_and_does_not_establish_inventory() {
    let root = root();
    let engine = NativeEngine::new(
        EngineId::ClaudeCode,
        Executable::direct(std::path::Path::new(env!("CARGO_BIN_EXE_engine-fixture"))).unwrap(),
        root.join("versions"),
        RunLimits::default(),
    )
    .unwrap();
    let info = engine.probe().await.unwrap();
    assert_eq!(info.version.as_deref(), Some("0.0.1"));
    assert!(!info.available);
    assert!(info.reason.is_some());
    let engine = fixture("large", &root, 2000);
    assert!(engine.probe().await.is_err());
    assert!(!root.join("input").exists());
}
#[cfg(windows)]
#[tokio::test]
async fn native_stdin_stderr_terminal_and_temp_cleanup() {
    for (mode, clean) in [
        ("agent", true),
        ("bad-result", false),
        ("no-terminal", false),
        ("env", true),
    ] {
        let root = root();
        let engine = fixture(mode, &root, 5000);
        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let j = job();
        let input = j.prompt.clone();
        let verdict = engine.run(j, grant(), tx).await.unwrap();
        assert_eq!(verdict == TerminalVerdict::Clean, clean);
        assert!(matches!(rx.recv().await, Some(EngineEvent::Init { .. })));
        let written: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("input")).unwrap()).unwrap();
        assert_eq!(written["message"]["content"], input);
        tokio::time::timeout(Duration::from_secs(2), async {
            while std::fs::read_dir(root.join("runs")).unwrap().count() != 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        if mode == "env" {
            assert!(
                std::fs::read_to_string(root.join("input.env"))
                    .unwrap()
                    .is_empty()
            );
        }
    }
}
#[cfg(windows)]
#[tokio::test]
async fn native_preinput_failures_and_watchdog_never_send_prompt() {
    for mode in ["missing", "decoy", "large", "stall"] {
        let root = root();
        let engine = fixture(mode, &root, 1500);
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        assert!(engine.run(job(), grant(), tx).await.is_err());
        assert!(!root.join("input").exists());
        assert_eq!(std::fs::read_dir(root.join("runs")).unwrap().count(), 0);
    }
}
#[cfg(windows)]
#[tokio::test]
async fn native_toolless_schema_is_validated() {
    let root = root();
    let engine = fixture("toolless", &root, 5000);
    assert_eq!(
        engine
            .structured("untrusted data", &Schema::Shield)
            .await
            .unwrap(),
        serde_json::json!({"verdict":"ASK"})
    );
}
#[cfg(windows)]
#[tokio::test]
async fn cancellation_kills_descendants_and_dropped_runs_remove_registration() {
    for abort in [false, true] {
        let root = root();
        let engine = Arc::new(fixture("tree", &root, 5000));
        let j = job();
        let run = j.run;
        let (tx, mut rx) = tokio::sync::mpsc::channel(16);
        let copy = engine.clone();
        let task = tokio::spawn(async move { copy.run(j, grant(), tx).await });
        assert!(matches!(rx.recv().await, Some(EngineEvent::Init { .. })));
        tokio::time::timeout(Duration::from_secs(3), async {
            while !root.join("input.pid").exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let pid: u32 = std::fs::read_to_string(root.join("input.pid"))
            .unwrap()
            .parse()
            .unwrap();
        if abort {
            task.abort();
            assert!(task.await.is_err());
        } else {
            engine.cancel(run);
            assert!(matches!(task.await.unwrap(), Err(Error::Cancelled)));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        let output = std::process::Command::new("tasklist.exe")
            .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
            .output()
            .unwrap();
        assert!(
            !String::from_utf8(output.stdout)
                .unwrap()
                .contains(&format!("\"{pid}\""))
        );
        tokio::time::timeout(Duration::from_secs(2), async {
            while std::fs::read_dir(root.join("runs")).unwrap().count() != 0 {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        // An aborted registration must not reserve this run forever.
        let (tx, _rx) = tokio::sync::mpsc::channel(16);
        let result = engine
            .run(
                AgentJob {
                    run,
                    prompt: "again".into(),
                },
                grant(),
                tx,
            )
            .await;
        assert!(!matches!(result, Err(Error::Invalid)));
    }
}
