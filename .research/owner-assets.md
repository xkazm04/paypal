# Owner assets: what to borrow from Personas Desktop

Read-only study of the owner's Tauri 2 app `personas` (React + Rust; about 430k lines of Rust across a 5-crate workspace), done 2026-10-02, for the PayPal Agentic Wallet design team. The wallet repo can't see Personas, so this note quotes the important parts. Paths are relative to `personas/` unless they say otherwise. Anything marked **[inferred]** is my reading or recommendation and isn't stated in the code.

The note is ordered by build stage. Stage 1 is the engine (§1), stage 2 is tools and MCP (§2), stage 3 is approvals (§3), stage 4 is secrets and audit (§4), and stage 5 is the UI shell and triggers (§5–6). §8 lists what not to borrow.

---

## 1. Running Claude Code / Codex headless (the "engine")

### 1.1 Claude: the two argv shapes in use

**A. One-shot run.** The prompt goes in on stdin and the process exits after one turn. Source: `src-tauri/engine/src/prompt/cli_args.rs::build_cli_args_inner`.
```rust
args.extend(["-p","-","--output-format","stream-json","--verbose",
             "--dangerously-skip-permissions",
             "--exclude-dynamic-system-prompt-sections"]);   // strips git status/cwd -> better prompt caching
args.push("--effort"); args.push(resolve_effort(profile)); // pinned "medium": CLI default drifted to "high"
// optional: --model <m>, --max-budget-usd <usd>, --max-turns <n>, --allowedTools a,b,c
```
Resume uses the same flags, prefixed with `--resume <claude_session_id>`: `build_resume_cli_args_inner`. Effort is re-resolved on resume. A past bug silently downgraded effort on resume.

**B. Long-lived multi-turn session.** stdin stays open, so later turns skip process start and a cold prompt cache. Source: `src-tauri/src/commands/fleet/headless.rs::headless_argv`.
```rust
["--print","--verbose","--input-format","stream-json","--output-format","stream-json",
 "--dangerously-skip-permissions","--session-id", <uuid we mint>]   // + "--mcp-config", <path>
```
- Each user turn is written to stdin as one JSON line (`fleet/registry.rs::headless_user_message`):
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":…}]}}\n`
- The session id is minted by the app and passed with `--session-id`. The app therefore knows the id before the `system/init` event arrives; `companion/session/launch.rs` notes that init only comes after the first user line is written.
- The base flags win. A duplicate `--session-id` or similar flag passed by a caller is dropped, because "claude takes the LAST occurrence of a repeated flag".
- If the app dies, stdin closes, and `claude -p` exits after the in-flight turn ("headless sessions never outlive the app as invisible orphans").
- `companion/session/warm.rs` keeps one warm process per conversation. The measured time to first text was about 2 s warm versus 3.4–5 s cold. The system prompt file holds only a byte-stable prefix, so caching keeps working. Per-turn context goes in the user message under a header.
- The system prompt is passed as a temp file via `--system-prompt-file`. Passing it inline breaks on Windows' ~32k command-line limit. Personas avoids `--bare` because "it disables OAuth/keychain auth".

### 1.2 Environment hygiene on every spawn (worth copying exactly)
From `engine/src/cli_process.rs` and `prompt/cli_args.rs`:
```rust
// strip, so the CLI uses the user's SUBSCRIPTION login, never an API key ("Credit balance is too low")
CLI_SUBSCRIPTION_RESERVED_ENV = ["ANTHROPIC_API_KEY","ANTHROPIC_AUTH_TOKEN","ANTHROPIC_BASE_URL"];
// strip nesting markers when the app itself runs under Claude Code
CLAUDE_NESTING_ENV = ["CLAUDECODE","CLAUDE_CODE_CHILD_SESSION","CLAUDE_CODE_SESSION_ID",
                      "CLAUDE_CODE_ENTRYPOINT","CLAUDE_CODE_EXECPATH","CLAUDE_CODE_SSE_PORT","CLAUDE_EFFORT"];
// set
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1   // no auto-title Haiku call
CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1
DISABLE_UPDATES=1                            // no mid-run auto-update
CLAUDE_CODE_HIDE_CWD=1
CLAUDE_CODE_DISABLE_BUNDLED_SKILLS=1         // smaller tool/skill surface, faster -p start on Windows
API_TIMEOUT_MS=<outer timeout - 5s>          // inner API timeout fires before the outer kill
```
`force_subscription_auth(cmd)` runs after any env overrides, so nothing can add an API key back in.

### 1.3 Windows binary resolution
`engine/src/cli_process.rs::resolve_claude_exe_windows`. The app runs the real `claude.exe` directly. It never goes through `cmd /C claude.cmd`, because a stale shim earlier on PATH could shadow the real one, or the shim could vanish after an npm/nvm change. The lookup order is:
1. `%USERPROFILE%\.local\bin\claude.exe` (native installer, checked first)
2. `%APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
3. each PATH directory: `<dir>\claude.exe`, then `<dir>\node_modules\@anthropic-ai\claude-code\bin\claude.exe`
4. last resort: `cmd /C claude.cmd`

**Codex** (`fleet/headless.rs::resolve_codex_launch`). The `PERSONAS_CODEX_EXE` environment variable overrides everything. Otherwise the app finds `codex.cmd` on PATH and runs what the shim would: `<dir>\node.exe <dir>\node_modules\@openai\codex\bin\codex.js`. The reason given is that `Command::new` can't run a `.cmd` file directly.

Every spawn also sets `creation_flags(0x08000000)` (CREATE_NO_WINDOW), which stops a console window flashing up.

### 1.4 Codex argv and isolation
```rust
// fleet/headless.rs::codex_exec_argv + codex_isolation_args
["exec","--json","--skip-git-repo-check","--dangerously-bypass-approvals-and-sandbox",
 "-C",cwd,"-m",model,  "--ephemeral","--ignore-user-config","--ignore-rules",
 "-c","model_reasoning_effort=\"<e>\""]      // prompt = whole stdin, then EOF (no positional prompt)
```
`normalize_codex_event` maps Codex JSONL events onto Claude's stream-json shape, so one parser and one state machine serve both engines:
`thread.started→system/init`, `item.completed(agent_message)→assistant text`, `item.started(command_execution)→assistant tool_use`, `turn.completed→result/success`, `turn.failed→result/error`.
Codex reports usage on `turn.completed`, so read cost and usage from the **raw** event before normalizing it.

**Claude isolation, as used for benchmark "contest seats"** (`fleet/contest_seat.rs::claude_seat_args`):
`--setting-sources project,local --strict-mcp-config` with no `--mcp-config` file. That leaves the session with no MCP servers and ignores the user's own `~/.claude` settings. The skill version adds `--no-session-persistence`.

### 1.5 Parsing stream-json, cost and usage, and the end-of-turn result
`engine/src/parser.rs` (2.7k lines). Its approach:
- Non-JSON lines are dropped silently. With `--verbose`, the CLI prints plain-text copies of events as well as the JSON.
- `system/init` carries `model`, `session_id` and `plugin_errors[]`, which can be strings or `{name,reason}` objects.
- `result` carries `total_cost_usd`, `duration_ms`, `usage.{input,output,cache_read_input_tokens,cache_creation_input_tokens}`. Fall back to top-level fields, then to `usage.cache_creation.ephemeral_{5m,1h}_input_tokens`.
- **Use a three-way end-of-turn verdict, not a boolean:**
```rust
enum TerminalVerdict { Clean, ErrorReported{subtype,text}, MissingTerminalFact }
// errors often arrive as subtype:"success", is_error:true, reason in `result`
// ("You've hit your limit · resets 7pm"); subtype only trustworthy if it starts "error_"
```
  If no `result` line arrived, the run is *incomplete*: the exit code alone can't prove the turn finished.
- Each line is capped at 64 KB (`MAX_LINE_BYTES`), and a read watchdog aborts reads that never end, so a single huge line can't exhaust memory.
- Spend is recorded per `result` line into an `llm_spend` table (`fleet/headless.rs::observe_dev_runner_spend` → `db::repos::llm_spend::observe_line`).

### 1.6 Cancellation and cleanup
- `CliProcessDriver` (`cli_process.rs`) uses `tokio::process::Command` with `.kill_on_drop(true)`. The comment explains why: when an outer `tokio::time::timeout` drops the future, the CLI would otherwise "keep streaming — and billing — until the app restarts".
- **stderr is either `Stdio::null()` or drained.** Otherwise the ~4 KB Windows pipe buffer fills and the child hangs for good.
- Temp working directories are removed in `Drop`. A leak had left 421 of them in %TEMP%.
- On Windows the process tree is killed with `taskkill /F /T /PID <pid>` (`src/engine/execution.rs::kill_process`). The fleet lane kills only the PID through `sysinfo`. **[inferred]** For the wallet, kill the whole tree so the CLI's MCP child processes die with it.
- A cancel flag (`Arc<AtomicBool>`) plus a map from PIDs to run keys lets the UI cancel a specific run.

---

## 2. Giving the CLI tools (MCP) and restricting them

Personas uses **two MCP patterns**. Both fit the wallet.

### 2.1 In-app HTTP MCP endpoint (recommended pattern for the wallet)
`src-tauri/src/companion/orchestration/mcp/{mod,handlers,pending}.rs`
- An axum server runs inside the Tauri process, bound to `127.0.0.1` (`src/local_http/mod.rs` picks the first free port from a preferred one). It serves `POST /mcp/rpc` as plain JSON-RPC 2.0 with **no SSE**. The comment says request/response alone "is enough" under the streamable-HTTP spec.
- The handler supports `initialize` (protocolVersion `2024-11-05`, `capabilities:{tools:{}}`), `notifications/initialized` (no response), `tools/list` and `tools/call`. It also answers `server/discover` for the newer stateless MCP clients.
- **Each session gets its own token.** At spawn the app mints a token, writes a temporary `mcp.json`, and passes it with `--mcp-config`:
```rust
// fleet/pty.rs::build_mcp_spawn  (uses core/src/mcp_config.rs typed builder)
mcp_config_json([("athena", McpServer::http(format!("http://127.0.0.1:{port}/mcp/rpc"))
    .with_header("X-Athena-Session", token)                 // WHICH session is calling
    .with_header("x-personas-local-token", local_token()))]) // entitled to reach the server at all
// file: %TEMP%/fleet-mcp-<session>/mcp.json ; path passed with forward slashes
```
  `tools/call` resolves the token to a session id and returns error `-32001` if the token is missing or revoked. Tokens are released when the session exits.
- The typed builder for `mcpServers` entries lives in `core/src/mcp_config.rs`. The HTTP transport must be written as `"type":"http"`, not `streamable-http`, because that's what Claude Code accepts today. Stdio entries take `alwaysLoad: true` on CLI ≥ 2.1.121.
- Tool results use the standard MCP shape: `{"content":[{"type":"text","text":…}],"isError":bool}`.

### 2.2 Stdio sidecar binary
A `[[bin]] personas-mcp` target (`src/mcp_bin.rs`) is a separate executable that speaks JSON-RPC over stdio.
- `engine/src/cli_mcp_config.rs` writes `exec_dir/.claude/personas-mcp-config.json`, which the CLI receives via `--mcp-config`.
- The binary is found next to `current_exe()`, falling back to the cargo `target/` directory in dev.
- Auth uses a `pk_` capability token passed through the config's `env` block.
- **Gotchas the code documents:**
  - Claude Code *ignores* `mcpServers` in `.claude/settings.json`. Only `--mcp-config` or `.mcp.json` work.
  - The config file holds secrets in plaintext, so it is **scrubbed on every exit path**, and stale copies are swept before each new write.
- **[inferred]** For the wallet, prefer pattern 2.1. Tools run inside the process that already holds the policy engine and the approval UI, so there's no second binary to sign or bundle and no secrets in a config file beyond a short-lived per-session token.

### 2.3 Restricting tools and permission mode
- Personas runs almost every session with `--dangerously-skip-permissions`. Its safety comes from the working directory (`validate_fleet_cwd`, registered projects only) and from what the MCP server exposes.
- **The sandboxed case to copy** is the research leg in `companion/session/launch.rs`. It omits `--dangerously-skip-permissions` and passes `--allowedTools WebSearch,WebFetch --max-turns N`. The code says: "in `-p` mode a tool outside `--allowedTools` is refused rather than prompted for, which is the sandbox this leg wants."
- Personas can also limit a session to a list of allowed tools (`--allowedTools a,b,c` from `resolve_allowed_tools`). Sessions without a declared list get the full default set.
- **[inferred] Suggested wallet argv:**
  `claude --print --input-format stream-json --output-format stream-json --verbose --session-id <uuid> --strict-mcp-config --mcp-config <tmp> --setting-sources project --allowedTools "mcp__wallet__*" --max-turns N --system-prompt-file <tmp>`
  - Leave out `--dangerously-skip-permissions`, and run in an empty app-owned working directory so the model has no Bash, Edit or Read access to anything that matters.
  - Check `--disallowedTools` / `--tools ""` against the installed CLI version.
  - For Codex, keep its sandbox on rather than copying the bypass flag Personas uses.
- Personas does **not** use `--permission-prompt-tool`. **[inferred]** That's worth evaluating as a second layer, but the MCP-side gate in §3.1 already works without it.
- Claude Code **hooks** are a passive signal source. `fleet/hook_install.rs` writes `http://127.0.0.1:<port>/fleet/hooks/<event>` entries, tagged `_fleet:true` so they can be uninstalled cleanly, into `~/.claude/settings.json` for SessionStart, Notification, Stop, PreToolUse and SessionEnd. **[inferred]** Personas uses them only for status, but a PreToolUse hook could also act as a second policy checkpoint.

---

## 3. Approvals: the human in the loop

Personas has two approval mechanisms. The wallet needs both ideas.

### 3.1 Blocking MCP approval (an agent asks mid-turn)
This is the most directly reusable piece. `athena.request_approval` is a **blocking** MCP tool, implemented in `orchestration/mcp/handlers.rs::request_approval` and `pending.rs`.
```rust
let (request_id, rx) = pending::submit(session_id, RequestKind::Approval); // oneshot::Sender stored in a global hub
app.emit("athena://mcp/approval-request", RequestNotice{request_id, fleet_session_id, kind, payload:{action,rationale,details}});
match tokio::time::timeout(REQUEST_TTL /*10 min*/, rx).await {
  Ok(Ok(Ok(resp))) => { let approved = resp["approved"].as_bool().unwrap_or(false);
                        json!({"content":[{"type":"text","text": if approved {"APPROVED"} else {"DENIED"} /* + ": note" */}],
                               "isError": !approved}) }
  Err(_) => { pending::resolve(&id, Err("request expired")); Err(internal_error("approval request expired …")) }
  …
}
```
- The CLI's HTTP request to the MCP server simply waits until the user decides. That wait is how the agent's turn pauses.
- The frontend answers through the Tauri command `companion_mcp_resolve_request(requestId, {approved, note})`.
- `pending::cancel_for_session(id)` runs when a session exits, so waiters fail fast instead of sitting until the TTL. `sweep_expired` runs on each new submit. `is_pending(id)` lets watchdogs check whether a request is still open.
- **Fail-closed rules:** a missing `approved` field counts as `false`. If the event can't be emitted, the request is resolved as an error immediately. Unattended "night shift" mode *never* auto-approves cost-bearing actions; it records an explicit DENIED with a note instead.
- The frontend side is a small Zustand store, `src/features/companions/athena/mcp/mcpRequestStore.ts`. It holds `pendingRequests[]`, dedupes by `requestId` so a reload snapshot and the live listener can both feed it, and renders one card per request, separate from chat state.

### 3.2 Approval queue stored in SQLite (the agent proposes, a human or policy decides)
`src-tauri/src/commands/companion/approvals/` (15k lines; split per executor domain). Table (`db/src/lib.rs`):
```sql
CREATE TABLE companion_approval (id TEXT PK, session_id TEXT, kind TEXT, payload TEXT /*{action,params,rationale,decidedBy,decidedAt,decisionNote,result}*/,
  status TEXT DEFAULT 'pending', human_review_id TEXT, created_at TEXT DEFAULT (datetime('now')), resolved_at TEXT);
```
- **States:** `pending → running → approved | approved_failed`, or `pending → rejected`. `approved_failed` means the executor failed after a human had approved.
- **Claiming a row is a compare-and-swap.** Every decision path goes through `claim_pending` (`approval_lifecycle.rs`): the UI click, the operator API, the headless bridge and standing policy.
```sql
UPDATE companion_approval SET status='running' WHERE id=?2 AND status='pending'   -- 0 rows => someone else decided
```
- **Consent freshness:** a pending row older than `-24 hours` is hidden and refused when someone tries to act on it (`ClaimError::Expired`).
- **Every decision records who made it** in the payload: `decidedBy` (a user, or for example `"policy:kp.gig_persona_policy"`), `decidedAt` and `decisionNote`. These are written *after the claim and before the executor runs*, so a row that crashes partway through still names who decided.
- **Standing-policy auto-approval** is in `approval_policy.rs`. The user writes a limit once in Settings, and a request entirely inside it is approved through *the same claim and executor path* as a click. It is "not a second decision path". **[inferred]** This is the right model for the wallet's "auto-approve under $X to known payees" rule.
- The only capability boundary is an allowlist of actions (`ALLOWED_ACTIONS` in the dispatcher). The model can't create an approval for an action that has no executor. `approval_autopilot.rs` documents the operator's choice to let autonomous mode auto-fire *everything*. **Don't copy that for money** (see §8).
- `ApprovalOutcome.client_action` lets an approval tell the UI what to do next (navigate, open a URL, reconnect a credential) instead of running more code in the backend.

---

## 4. Secrets, encryption, audit, redaction

- **Master key in the OS keychain** (`core/src/crypto.rs::get_master_key`). It uses `keyring = { version = "3", features = ["apple-native","windows-native","sync-secret-service"] }` with `Entry::new("personas-desktop","credential-master-key")` and stores a 32-byte key in base64.
  - **Fails closed.** If the keychain is unavailable, credential storage is refused unless `PERSONAS_ALLOW_FALLBACK_KEY=1` is set, which is meant for CI.
  - Legacy key files are never imported silently, because that was a way to plant a known key.
  - Only a successfully loaded key is cached. A transient failure used to be cached, which broke the vault until restart.
- **Encryption at rest:** AES-256-GCM via `aes-gcm 0.10`, with ciphertext and nonce stored separately (`encrypt_for_db` / `decrypt_from_db`). The key stays in a `Zeroizing<[u8;32]>` and its memory is locked with `VirtualLock`/`mlock` so it isn't paged to disk. `SecureString` zeroizes on drop and redacts itself in Debug/Display. OAuth tokens held in memory are sealed with AES-GCM until the moment they're used.
- **IPC authorization** (`src-tauri/src/ipc_auth.rs`) has three tiers: Public, Privileged and Cloud.
  - At startup the app creates a random session token and injects it with an init script that patches `__TAURI_INTERNALS__.invoke` to add an `x-ipc-token` header.
  - A wrapper around the invoke handler rejects privileged commands that lack the token before they run.
  - Commands also call `ipc_auth::require_auth(&state)` themselves, for example `companion_approve_action`.
  - **[inferred]** For the wallet, mark "approve payment" and "change policy" as Privileged.
- **Local HTTP admission control** (`src/local_http/auth.rs`):
  - One tower layer covers the whole router, so a route added later is protected automatically.
  - A **Host-header allowlist** blocks DNS rebinding.
  - A shared-secret header `x-personas-local-token` stops other OS users and sandboxed processes. The secret is stored in a handshake file in the user's home directory.
  - Mutating routes take `Json<T>`, which forces a CORS preflight that the server rejects.
- **Audit tables:** `credential_audit_log(credential_id, operation, persona_id, detail, created_at)` and `tool_execution_audit_log(tool_name, result_status, duration_ms, error_message, error_kind, …)` in `db/src/migrations/schema.rs` and `e02_credentials_and_audit_trails.rs`.
  - An audit write that fails never blocks the action, but it increments a counter (`record_credential_audit_write_failure`) shown in the UI as a "vault trust" badge.
  - There's **no hash chain or append-only enforcement**. **[inferred]** The wallet should add both: a `prev_hash` column and triggers that block UPDATE and DELETE.
- **Redaction:**
  - `core/src/redact.rs` redacts **when output is stored, not while it streams**. The live view shows raw output; stored and exported copies are scrubbed. It uses high-confidence patterns (`AKIA…`, `sk-ant-…`, `sk-…`, `gh[pousr]_…`, `xox…`, JWT, PEM, `Bearer …`) plus a Shannon-entropy sweep (≥4.5 bits/byte, length ≥20, mixed character classes, never pure hex, so UUIDs and SHAs survive). It's on by default with a settings toggle.
  - `src/main.rs::scrub` removes personal data from log lines: UUIDs become `[id:abcdef]` and URLs are cut to scheme and host, with userinfo removed.
  - **[inferred]** For the wallet, add patterns for PayPal access tokens, client secrets and card or account numbers.
- `lefthook` runs a staged-file **gitleaks** scan before each commit (`scripts/secret-scan.mjs`).

---

## 5. Frontend stack, plugins, tray, tooling

- **UI:**
  - React 19.2 with the React Compiler (`babel-plugin-react-compiler`), Vite 8 and TypeScript 6 (plus a native TS 7 type-check gate).
  - Tailwind 4 via `@tailwindcss/vite`.
  - State is **Zustand 5 + immer**, with one store per feature, e.g. `src/stores/systemStore.ts`.
  - **No router library:** a `sidebarSection` value in the system store selects the screen. **[inferred]** That's enough for a tray-first wallet app.
  - Other libraries: zod 4, framer-motion, lucide-react, recharts, @tanstack/react-virtual, react-markdown with remark-gfm, DOMPurify, Sentry for React.
- **Rust-to-TS types:** `ts-rs` generates TypeScript bindings into `bindings/`, and a check script keeps them in sync. Event names are listed in both `src/lib/eventRegistry.ts` and `engine/event_registry.rs`, with a parity check (`check:contracts`).
- **Tauri plugins:** notification, dialog, deep-link (scheme `personas://`), and, behind optional features, window-state, updater, single-instance (with deep-link), global-shortcut and drag. The `tray-icon` and `protocol-asset` features are on.
  - Capabilities in `capabilities/default.json` are minimal: `core:*` defaults, notification allow-notify and request-permission, `dialog:default`, `deep-link:default`, and window minimize, maximize and close.
  - The CSP in `tauri.conf.json` is strict: `default-src 'self'`, with `img-src` allowing `http://127.0.0.1:*`.
- **Tray** (`src-tauri/src/tray.rs`): `TrayIconBuilder::with_id("main")`. A left-click shows, unminimizes and focuses the main window. `refresh_tray(app)` rebuilds the menu when state changes. **[inferred]** The wallet could show "N approvals pending" there.
- **Native notifications** (`src-tauri/src/notifications.rs`): `app.notification().builder().title(..).body(..).show()`.
- **Quality tooling:**
  - ESLint 10 with typescript-eslint and react-hooks, plus custom rules in `eslint-rules/`.
  - knip finds dead code.
  - Vitest 4 with jsdom and Testing Library; Playwright for E2E.
  - On the Rust side, `cargo clippy -D warnings` across the workspace, `rustfmt` on staged files, `deny.toml` (cargo-deny) and `renovate.json`.
  - lefthook pre-commit (cached ESLint on staged files, gitleaks, rustfmt) and pre-push (heavier checks). The hooks never stash or rewrite the working tree.
- Rust dependencies worth reusing: `axum 0.8` and `tower-http` for the local server, `rusqlite 0.38` (bundled) with `r2d2`, `reqwest` (rustls only), `tokio`, `tracing`, `thiserror`, `uuid`, `chrono`, `hmac`, `sha2`, `zeroize`, `keyring`, `aes-gcm`.

---

## 6. Webhooks, inbound events, schedulers and triggers

- **Webhook server** (`src-tauri/src/engine/webhook.rs`): axum on port **9420**, overridable, with a body limit and rate limiter. It accepts the `x-hub-signature-256`, `x-signature-256` or `x-webhook-signature` headers. HMAC verification is constant-time even when the hex is malformed:
```rust
let (expected, hex_valid) = match hex::decode(sig.strip_prefix("sha256=").unwrap_or(sig)) {
    Ok(b) => (b, true), Err(_) => ([0u8;32].to_vec(), false) };
mac.update(body); mac.verify_slice(&expected).is_ok() && hex_valid
```
  The event and its trigger's "fired" mark are written in one SQLite transaction, and each request is logged to `webhook_log`. **[inferred]** PayPal webhooks use certificate-based signature verification instead (`verify-webhook-signature` API), but the logging and transaction pattern carries over.
- **Getting webhooks to a desktop app without a public host:** `engine/smee_relay.rs` subscribes to a smee.io channel over SSE and feeds received payloads into the local event bus. It has exponential backoff, a 1 MB SSE buffer cap, and a minimum connection uptime before the backoff resets. There's also `cloud_webhook_relay.rs`. **[inferred]** For a hackathon this is the quickest way to receive PayPal sandbox webhooks locally.
- **Triggers** (`core/src/models/trigger.rs::TriggerKind`): Manual, Schedule (cron), Polling, Webhook, Chain, EventListener, FileWatcher, Clipboard, AppFocus, Composite.
  - `engine/background/scheduler.rs::trigger_scheduler_tick` fetches due triggers, evaluates them and publishes events to an event bus.
  - The cron parser is in-house (`personas_core::cron::parse_cron_seeded`, `next_fire_time_local`) and seeds jitter from a hash of the trigger id.
  - Trigger config is encrypted at rest (`encrypt_trigger_config`).
  - Fleet admission (`fleet/budgets.rs`, `queue.rs`) limits concurrent CLI sessions by machine load and by plan or spend units rather than a raw count. **[inferred]** That idea maps well to a wallet spend budget.

---

## 7. Creator studio (Tauri + Next), in two lines
`kiro/creator-studio`: `next.config.ts` sets `output:"export"`, `images.unoptimized`, `trailingSlash:true` and pins `turbopack.root`. Tauri serves `frontendDist:"../out"` (dev URL `http://localhost:3001`, `beforeBuildCommand:"npm run build"`).
The "sidecar" is the same axum router started in Tauri's `setup()` (127.0.0.1 only, `POST /api/candidates` plus `POST /mcp` streamable-HTTP JSON-RPC), with a second `[[bin]] creator-studio-server` (`src-tauri/src/bin/server.rs`) to run it headless. It isn't an `externalBin`.

---

## 8. What NOT to borrow (for a 6-week build)
- **Fleet/PTY interactive lane** (`fleet/pty.rs`, ConPTY, vt100 screen rebuilding, keystroke-driving TUI menus, staleness tickers, hibernate/wake). The wallet needs only the headless stream-json lane (§1.1 B).
- **`--dangerously-skip-permissions` / `--dangerously-bypass-approvals-and-sandbox` as the default.** Personas relies on cwd confinement, which doesn't fit a money app. Use `--allowedTools` restricted to wallet MCP tools with `--strict-mcp-config` (§2.3).
- **"Autonomous mode fires everything"** (`approval_autopilot.rs`) and auto-approval without a human. Money actions should need either a human click or an explicit, bounded standing policy recorded via `decidedBy`.
- **Multi-engine sprawl:** the Grok lane, model tier routing, failover, evaluation and benchmarking harnesses (`athena-bench`, `memory-sim`), contest seats, deliberation/director/genome/evolution modules. One engine trait plus Claude and Codex adapters is enough.
- **Five-crate workspace split, `ts-rs` bindings plus a dozen `check:*` parity scripts, i18n coverage gates, census/corpus/evidence tooling.** These pay off at 430k lines of code; at hackathon scale they cost time. Keep tsc, ESLint, clippy, Vitest and one Playwright smoke test.
- **The stdio `personas-mcp` sidecar binary** with its plaintext-secret config scrubbing. Prefer the in-process HTTP MCP endpoint (§2.1).
- **The daemon, P2P (quinn/mdns), cloud sync, RSA-over-IPC session keys, fastembed/sqlite-vec memory, OCR, voice/STT.** None of these are on the wallet's critical path.
- **The `kp`/App Master/team-hiring approval executors.** Reuse the queue mechanics (§3.2), not its 15k lines of domain executors.

---

## 9. Suggested borrow order **[inferred]**
1. **Week 1:** `CliProcessDriver`-style spawner (resolver, environment strips, CREATE_NO_WINDOW, kill_on_drop, stderr drain, tree kill) and the stream-json parser with `TerminalVerdict` and cost capture. Add a normalizer for Codex events.
2. **Week 2:** in-process axum MCP endpoint (`initialize`/`tools/list`/`tools/call`), a per-session token in a temporary `--mcp-config`, Host allowlist, local token, and a restricted argv.
3. **Week 3:** blocking approval tool backed by a oneshot hub with a TTL and cancel-on-exit, plus an SQLite approval table with the CAS claim, freshness window and `decidedBy`. The policy engine decides auto-approve, ask, or deny *before* submitting.
4. **Week 4:** keychain master key with AES-GCM vault for the PayPal client secret and refresh token, a hash-chained audit table, redaction when output is stored, and IPC tokens for privileged commands.
5. **Weeks 5–6:** tray badge and notifications for pending approvals, webhook intake via smee in sandbox (plus a scheduler for recurring payments if needed), and polish.
