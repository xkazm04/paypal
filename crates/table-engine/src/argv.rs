use crate::{EngineId, Error, Profile};
use url::Url;
#[derive(Debug, Clone)]
pub struct LaunchOptions {
    pub profile: Profile,
    pub mcp_file: String,
    pub system_prompt_file: String,
    pub schema_file: String,
    pub session: String,
    pub mcp_url: String,
    pub model: Option<String>,
}
pub fn argv(engine: EngineId, o: &LaunchOptions) -> Result<Vec<String>, Error> {
    // The assistant has its own fixed argv (`assistant_argv`); the branches below would treat
    // it as an agent.
    if o.profile == Profile::Assistant {
        return Err(Error::Invalid);
    }
    let mut args = match engine {
        EngineId::ClaudeCode => vec![
            "-p",
            "--output-format",
            "stream-json",
            "--verbose",
            "--tools",
            "",
            "--strict-mcp-config",
            "--mcp-config",
            if o.profile == Profile::Toolless {
                "{\"mcpServers\":{}}"
            } else {
                &o.mcp_file
            },
            if o.profile == Profile::Toolless {
                "--disallowedTools"
            } else {
                "--allowedTools"
            },
            if o.profile == Profile::Toolless {
                "mcp__*"
            } else {
                "mcp__wallet__*"
            },
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>(),
        EngineId::CodexCli => {
            // --ignore-user-config / --ignore-rules confirmed by 0.160.0 exec --help.
            // UNVERIFIED: MCP approval mode remains a live conformance spike.
            let mut a = vec![
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
            ]
            .into_iter()
            .map(str::to_owned)
            .collect::<Vec<_>>();
            if o.profile == Profile::Agent {
                let url = Url::parse(&o.mcp_url).map_err(|_| Error::Invalid)?;
                if url.scheme() != "http"
                    || url.host_str() != Some("127.0.0.1")
                    || !url.username().is_empty()
                    || url.password().is_some()
                    || url.query().is_some()
                    || url.fragment().is_some()
                {
                    return Err(Error::Invalid);
                }
                for c in [
                    format!(
                        "mcp_servers.wallet.url={}",
                        serde_json::to_string(&o.mcp_url).map_err(|_| Error::Invalid)?
                    ),
                    "mcp_servers.wallet.bearer_token_env_var=\"WALLET_MCP_TOKEN\"".into(),
                    // UNVERIFIED: env_http_headers config on the installed version; spike 1.
                    "mcp_servers.wallet.env_http_headers={\"X-Wallet-Secret\"=\"WALLET_MCP_SECRET\"}".into(),
                    "mcp_servers.wallet.required=true".into(),
                    "mcp_servers.wallet.default_tools_approval_mode=\"approve\"".into(),
                ] {
                    a.extend(["-c".into(), c]);
                }
            } else {
                a.extend(["--output-schema".into(), o.schema_file.clone()]);
            }
            a
        }
        EngineId::Scripted | EngineId::Outside => return Err(Error::Invalid),
    };
    if engine == EngineId::ClaudeCode {
        if o.profile == Profile::Agent {
            args.extend(["--disallowedTools", "WebFetch", "WebSearch", "Bash"].map(str::to_owned));
        }
        args.extend(
            [
                "--permission-mode",
                "dontAsk",
                "--permission-prompts",
                "none",
                "--setting-sources",
                "project",
                "--system-prompt-file",
                &o.system_prompt_file,
                "--max-turns",
                if o.profile == Profile::Toolless {
                    "1"
                } else {
                    "12"
                },
            ]
            .map(str::to_owned),
        );
        if o.profile == Profile::Agent {
            args.extend([
                "--max-budget-usd".into(),
                "0.50".into(),
                "--session-id".into(),
                o.session.clone(),
            ]);
        }
    }
    if let Some(model) = &o.model {
        if model.is_empty() || model.contains(['\n', '\r']) {
            return Err(Error::Invalid);
        }
        args.extend(["--model".into(), model.clone()]);
    }
    Ok(args)
}
/// The per-call spend cap of one assistant turn, in US dollars (the CLI's own budget flag).
pub const ASSISTANT_BUDGET_USD: &str = "0.25";
/// The largest reply schema handed to the CLI inline (it travels in argv).
pub const ASSISTANT_SCHEMA_MAX: usize = 16 * 1024;
/// One board-assistant turn (`Profile::Assistant`): headless, the NDJSON prompt on stdin, no
/// tools, an empty MCP config with every MCP tool refused, no settings sources (no project or
/// user instructions, hooks or memory files), no session persistence, no slash commands, low
/// effort, a per-call budget and one turn. The reply arrives as the result's `structured_output`
/// against `schema` (inline JSON). Mirrors the dev bridge (apps/desktop/client/scripts/
/// assistantBridge.ts), with stream output so the strict parser sees the inventory.
/// Only `claude-code` has a checked flag set; any other engine is refused.
pub fn assistant_argv(
    engine: EngineId,
    system_prompt_file: &str,
    schema: &str,
) -> Result<Vec<String>, Error> {
    if engine != EngineId::ClaudeCode {
        return Err(Error::Unsupported);
    }
    let compact = serde_json::from_str::<serde_json::Value>(schema)
        .ok()
        .filter(serde_json::Value::is_object)
        .map(|v| v.to_string())
        .ok_or(Error::Invalid)?;
    if compact.len() > ASSISTANT_SCHEMA_MAX || system_prompt_file.is_empty() {
        return Err(Error::Invalid);
    }
    let mut args: Vec<String> = [
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
        ASSISTANT_BUDGET_USD,
        "--max-turns",
        "1",
        "--system-prompt-file",
    ]
    .map(str::to_owned)
    .into();
    args.extend([
        system_prompt_file.to_owned(),
        "--json-schema".into(),
        compact,
    ]);
    Ok(args)
}
pub const STRIP_ENV: &[&str] = &[
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "OPENAI_API_KEY",
    "CODEX_API_KEY",
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_EXECPATH",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_EFFORT",
];
