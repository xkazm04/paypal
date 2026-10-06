use crate::{EngineId, Error, Profile};
use std::path::{Path, PathBuf};
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
        EngineId::Scripted => return Err(Error::Invalid),
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
/// Resolve direct executables; `resolve_command` additionally follows recognized npm layouts.
pub fn resolve_executable(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|p| {
            p.is_file()
                && (cfg!(not(windows))
                    || p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
        })
        .cloned()
}
pub fn empty_cwd(path: &Path) -> std::io::Result<bool> {
    Ok(std::fs::read_dir(path)?.next().is_none())
}
