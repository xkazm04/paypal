# Reusable patterns from the owner's prior desktop agent app

Generic engineering patterns, distilled on 2026-10-02 from the owner's earlier Tauri 2 desktop app (React + Rust) for the PayPal Agentic Wallet design team. This note keeps only what is reusable. It names no source paths, modules, environment variables, ports or file locations of that app, and the code shapes below are illustrative sketches, not quotations. Anything marked **[inferred]** is a recommendation and not an observed fact.

The note is ordered by build stage: the engine (§1), tools and MCP (§2), approvals (§3), secrets and audit (§4), the UI shell (§5), webhooks (§6), a headless router (§7), and what not to borrow (§8). §9 is a suggested order. Section numbers match the earlier version, which other documents cite.

---

## 1. Running a CLI agent headless (the "engine")

### 1.1 Two argv shapes for Claude Code

**A. One-shot run.** The prompt goes in on stdin and the process exits after one turn.
```text
claude -p - --output-format stream-json --verbose [--model m] [--max-turns n] [--allowedTools a,b]
```
- Pin the effort level explicitly. A CLI default can drift between versions.
- On resume, re-resolve every flag, effort included. A flag dropped on resume can silently downgrade a run.

**B. Long-lived multi-turn session.** stdin stays open, so later turns skip process start and a cold prompt cache.
```text
claude --print --verbose --input-format stream-json --output-format stream-json --session-id <uuid you mint>
```
- Write each user turn to stdin as one JSON line: `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`.
- Mint the session id yourself, so it is known before the init event arrives. Init may only appear after the first user line is written.
- If the caller can pass extra flags, drop duplicates of the base flags: the CLI takes the last occurrence of a repeated flag.
- If the host app dies, stdin closes and the process exits after the in-flight turn. Headless sessions then never outlive the app as invisible orphans.
- A warm process per conversation roughly halves time to first text. Keep the system prompt a byte-stable prefix so caching keeps working, and put per-turn context in the user message.
- Pass the system prompt as a temporary file, not inline, to stay under the Windows command-line length limit.
- Check how a "bare" mode affects OAuth or keychain login before relying on it.

### 1.2 Environment hygiene on every spawn
- Strip API-key and base-URL variables so the CLI uses the user's subscription login and never silently bills an API key. Apply this strip last, after any caller overrides, so nothing can add a key back.
- Strip the variables the CLI uses to mark that it is running nested, when the host itself runs under the same CLI.
- Turn off non-essential traffic, auto-update, terminal-title changes and bundled extras. This gives a smaller surface and a faster start.
- Set the inner API timeout a few seconds below the outer kill timeout, so the inner one fires first.

### 1.3 Windows binary resolution
- Run the real executable directly. Do not go through a `cmd /C` shim: a stale shim earlier on PATH can shadow the real binary, or can vanish after a package-manager change.
- Suggested lookup order: the native installer location, then the global npm install, then each PATH entry, and only last the shim.
- For Codex, if only a `.cmd` shim exists, run what the shim would run (node plus the package's script), because a `.cmd` file cannot be spawned directly. Allow an explicit override for the executable path.
- Spawn with the no-window creation flag so a console does not flash up.

### 1.4 Codex argv and isolation
```text
codex exec --json --skip-git-repo-check -C <cwd> -m <model> --ephemeral --ignore-user-config --ignore-rules -c model_reasoning_effort="<e>"
```
- The prompt is all of stdin, then EOF.
- **[inferred]** For a money app, keep the Codex sandbox on. Do not copy a flag that bypasses approvals and sandboxing.
- Normalise Codex JSONL events onto the Claude stream-json shape so one parser and one state machine serve both engines. Sketch: thread start becomes system/init, an agent message becomes assistant text, a command start becomes a tool_use, turn completed becomes result/success, and turn failed becomes result/error.
- Codex reports usage on turn completion, so read cost and usage from the raw event before normalising.

**Claude isolation** (for benchmark or contest runs): restrict setting sources to project and local, and pass strict MCP config with no MCP config file. The session then has no MCP servers and ignores the user's own CLI settings. Add a no-session-persistence flag for one-off runs.

### 1.5 Parsing stream-json, cost, and the end-of-turn verdict
- Drop non-JSON lines silently. With verbose output the CLI also prints plain-text copies of events.
- The init event carries the model, the session id and any plugin errors, which may be strings or `{name, reason}` objects.
- The result event carries total cost, duration and token usage (input, output, cache read, cache creation). Fall back to top-level fields, then to the nested cache-creation breakdown.
- **Use a three-way end-of-turn verdict, not a boolean:**
```rust
enum TerminalVerdict { Clean, ErrorReported { subtype: String, text: String }, MissingTerminalFact }
```
  Errors often arrive with a success subtype and an error flag, with the reason in the result text (for example a usage-limit message). Trust the subtype only when it starts with `error_`. If no result line arrived, the run is incomplete: the exit code alone cannot prove the turn finished.
- Cap each line at a fixed size and run a read watchdog, so one huge line or a stalled read cannot exhaust memory or hang.
- Record spend per result line in a spend table.

### 1.6 Cancellation and cleanup
- Spawn with kill-on-drop. When an outer timeout drops the future, the CLI would otherwise keep streaming, and billing, until the app restarts.
- **stderr must be nulled or drained.** Otherwise the small Windows pipe buffer fills and the child hangs for good.
- Remove temporary working directories in a destructor. A missing cleanup can leak hundreds of them.
- **[inferred]** On Windows, kill the whole process tree, so the CLI's MCP children die with it.
- Keep a cancel flag and a map from process ids to run keys, so the UI can cancel one specific run.

---

## 2. Giving the CLI tools (MCP) and restricting them

Two patterns work. The first fits the wallet.

### 2.1 In-app HTTP MCP endpoint (recommended)
- Run an HTTP server inside the desktop process, bound to loopback only. Choose the first free port from a preferred one.
- Serve plain JSON-RPC 2.0 over POST with no SSE. Request and response alone is enough under the streamable-HTTP spec.
- Support `initialize`, the initialized notification (no response), `tools/list` and `tools/call`. Consider answering the discovery call that newer stateless clients send.
- **Give each session its own token.** At spawn, mint a token, write a temporary MCP config file that carries it in a header, and pass the file with `--mcp-config`. Add a second header with a local shared secret, which proves the caller may reach the server at all.
- `tools/call` resolves the token to a session and returns an error if the token is missing or revoked. Release tokens when the session exits.
- Write the HTTP transport as `"type":"http"`, which is what Claude Code accepts. Check stdio-entry options against the installed CLI version.
- Return tool results in the standard MCP shape: a `content` array of text items plus an `isError` flag.

### 2.2 Stdio sidecar binary (not recommended)
A separate executable speaking JSON-RPC over stdio, handed to the CLI with `--mcp-config`.
- Claude Code ignores `mcpServers` in its settings file. Only `--mcp-config` or a project-level MCP file works.
- The config file would hold secrets in plaintext, so it must be scrubbed on every exit path, with stale copies swept before each new write.
- **[inferred]** Prefer 2.1. Tools then run in the process that already holds the policy engine and the approval UI, so there is no second binary to sign or bundle, and no secret in a file beyond a short-lived per-session token.

### 2.3 Restricting tools and permission mode
- Many apps run sessions with permission checks off and rely on a confined working directory. That does not fit a money app.
- **The sandboxed case to copy:** omit the permission-bypass flag and pass an allow-list plus a turn cap. In print mode a tool outside the allow-list is refused rather than prompted for, which is exactly the sandbox wanted.
- **[inferred] Suggested wallet argv:**
  `claude --print --input-format stream-json --output-format stream-json --verbose --session-id <uuid> --strict-mcp-config --mcp-config <tmp> --setting-sources project --allowedTools "mcp__wallet__*" --max-turns N --system-prompt-file <tmp>`
  - Leave out the permission-bypass flag, and run in an empty app-owned working directory so the model has no shell, edit or read access to anything that matters.
  - Check the disallow-tools options against the installed CLI version.
  - For Codex, keep its sandbox on.
- A permission-prompt tool is worth evaluating as a second layer, but the MCP-side gate in §3.1 already works without it.
- CLI hooks are a passive signal source: an app can register hook entries (tagged so they can be uninstalled cleanly) for session start, notification, stop, pre-tool-use and session end. **[inferred]** A pre-tool-use hook could also act as a second policy checkpoint.

---

## 3. Approvals: the human in the loop

The wallet needs both of these ideas.

### 3.1 Blocking MCP approval (an agent asks mid-turn)
Expose an approval tool that **blocks**. Sketch:
```rust
let (request_id, rx) = pending::submit(session_id, Kind::Approval);   // oneshot sender kept in a hub
ui.emit("approval-request", Notice { request_id, session_id, action, rationale });
match timeout(REQUEST_TTL, rx).await {
    Ok(Ok(resp)) => tool_result(if resp.approved { "APPROVED" } else { "DENIED" }, is_error = !resp.approved),
    Err(_)       => { pending::resolve(&request_id, Err("expired")); Err(expired_error()) }
    _            => Err(internal_error()),
}
```
- The CLI's HTTP request simply waits until the user decides. That wait is how the agent's turn pauses.
- The frontend answers through one command carrying the request id and `{approved, note}`.
- Cancel all pending requests of a session when it exits, so waiters fail fast instead of waiting out the TTL. Sweep expired requests on each new submit. Expose an "is still pending" check for watchdogs.
- **Fail closed:** a missing `approved` field counts as false. If the UI event cannot be emitted, resolve the request as an error at once. Unattended modes never auto-approve cost-bearing actions; they record an explicit denial with a note.
- On the frontend, a small store holds the pending requests, de-duplicates by request id (so a reload snapshot and the live listener can both feed it), and renders one card per request, separate from chat state.

### 3.2 Approval queue in SQLite (the agent proposes, a human or policy decides)
Illustrative table:
```sql
CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, kind TEXT,
  payload TEXT,  -- action, params, rationale, decided_by, decided_at, decision_note, result
  status TEXT DEFAULT 'pending', created_at TEXT, resolved_at TEXT);
```
- **States:** `pending → running → approved | approved_failed`, or `pending → rejected`. `approved_failed` means the executor failed after a human had approved.
- **Claim a row by compare-and-swap.** Every decision path (UI click, operator API, headless bridge, standing policy) goes through one claim:
```sql
UPDATE approval SET status = 'running' WHERE id = ? AND status = 'pending'   -- 0 rows: someone else decided
```
- **Consent freshness:** a pending row older than a set window (say 24 hours) is hidden, and acting on it is refused.
- **Record who decided** (`decided_by`: a user, or a named policy), when, and the note. Write them after the claim and before the executor runs, so a row that crashes partway through still names who decided.
- **Standing-policy auto-approval** goes through the same claim and executor path as a click. It is not a second decision path. **[inferred]** This is the right model for the wallet's "auto-approve under $X to known payees" rule.
- The only capability boundary is an allow-list of actions. The model cannot create an approval for an action that has no executor.
- An approval outcome can carry a client action (navigate, open a URL, reconnect a credential), so the UI does the next step and the backend runs no further code.

---

## 4. Secrets, encryption, audit, redaction

- **Master key in the OS keychain.** Store a 32-byte key (base64) through a cross-platform keyring crate.
  - **Fail closed.** If the keychain is unavailable, refuse to store credentials. Any CI-only fallback must be an explicit, loudly named opt-in.
  - Never silently import a legacy key file: that is a way to plant a known key.
  - Cache only a successfully loaded key. Caching a transient failure breaks the vault until restart.
- **Encryption at rest:** AES-256-GCM, with ciphertext and nonce stored separately. Keep the key in a zeroising wrapper with its memory locked so it is not paged to disk. Use a secret-string type that zeroises on drop and redacts itself in Debug and Display. Keep in-memory OAuth tokens sealed until the moment of use.
- **IPC authorisation:** three tiers (public, privileged, cloud).
  - At startup create a random session token and inject it into the webview so every invoke call carries it as a header.
  - Wrap the invoke handler so privileged commands without the token are rejected before they run. Have privileged commands also check authorisation themselves.
  - **[inferred]** Mark "approve payment" and "change policy" as privileged.
- **Local HTTP admission control:**
  - One middleware layer over the whole router, so a route added later is protected automatically.
  - A **Host-header allowlist** blocks DNS rebinding.
  - A shared-secret header stops other OS users and sandboxed processes from calling the server.
  - Mutating routes take a JSON body, which forces a CORS preflight that the server rejects.
- **Audit:** log credential operations and tool executions (name, status, duration, error kind).
  - A failed audit write should not block the action, but it should bump a counter that the UI shows as a trust badge.
  - The reference app has **no hash chain and no append-only enforcement**. **[inferred]** The wallet should add both: a `prev_hash` column and triggers that block UPDATE and DELETE.
- **Redaction:**
  - Redact **when output is stored, not while it streams.** The live view shows raw output; stored and exported copies are scrubbed.
  - Combine high-confidence patterns (cloud keys, API-key prefixes, source-host tokens, chat tokens, JWTs, PEM blocks, `Bearer` values) with an entropy sweep (about 4.5 bits per byte or more, a minimum length, mixed character classes, never pure hex, so UUIDs and commit hashes survive). Make it on by default with a settings toggle.
  - Scrub personal data from log lines: shorten identifiers, and cut URLs to scheme and host with userinfo removed.
  - **[inferred]** For the wallet, add patterns for PayPal access tokens, client secrets and card or account numbers.
- Run a staged-file secret scan (such as gitleaks) in a pre-commit hook.

---

## 5. UI shell

- **Stack:** React 19 with the React Compiler, Vite, TypeScript, Tailwind 4.
- **State:** Zustand with immer, one store per feature. No router library: a single "current section" value selects the screen. **[inferred]** That is enough for a tray-first wallet app.
- **Rust-to-TS types:** generate TypeScript bindings from Rust types, and keep event names in one registry checked for parity on both sides.
- **Tauri plugins:** notification, dialog, deep-link, and (behind features) window-state, updater, single-instance, global-shortcut. Keep the capability file minimal, and set a strict CSP (`default-src 'self'`).
- **Tray:** a left-click shows and focuses the main window, and the menu is rebuilt when state changes. **[inferred]** The wallet could show "N approvals pending" there.
- **Native notifications** through the notification plugin.
- **Quality tooling:** ESLint with typescript-eslint and react-hooks, Vitest with Testing Library, Playwright for a smoke test, `cargo clippy -D warnings`, rustfmt, cargo-deny, and a dependency-update bot. Hooks must never stash or rewrite the working tree.
- **Rust dependencies worth reusing:** axum and tower-http for the local server, rusqlite (bundled) with a pool, reqwest (rustls only), tokio, tracing, thiserror, uuid, chrono, hmac, sha2, zeroize, a keyring crate, aes-gcm.

---

## 6. Webhooks and scheduling

- Verify HMAC signatures in constant time, even when the hex is malformed (compare against a dummy value and AND in a validity flag). Write the event and the trigger's "fired" mark in one transaction, and log every request. **[inferred]** PayPal webhooks use certificate-based verification through its verification API, but the logging and transaction pattern carries over.
- To receive webhooks on a desktop app without a public host, subscribe to a relay channel over SSE and feed payloads into the local event bus, with exponential backoff, a capped buffer and a minimum uptime before the backoff resets. **[inferred]** For a hackathon this is the quickest way to receive PayPal sandbox webhooks locally.
- Admit concurrent CLI sessions by machine load and by plan or spend units, not a raw count. **[inferred]** That idea maps well to a wallet spend budget.

---

## 7. Running the app's router headless
The same router the desktop shell starts in its setup step can also be built as a second binary target that runs it without a window, bound to loopback only. This is useful for tests and demos. It is not a bundled sidecar.

---

## 8. What NOT to borrow (for a 6-week build)
- **An interactive terminal lane** (pseudo-terminal, screen rebuilding, keystroke-driving menus, hibernate and wake). The wallet needs only the headless stream-json lane (§1.1 B).
- **Permission-bypass flags as the default.** Confining the working directory does not fit a money app. Use an allow-list restricted to wallet MCP tools with strict MCP config (§2.3).
- **"Autonomous mode fires everything"** and auto-approval without a human. Money actions need either a human click or an explicit, bounded standing policy recorded as the decider.
- **Multi-engine sprawl:** extra engine lanes, model-tier routing, failover, evaluation and benchmarking harnesses. One engine trait with Claude and Codex adapters is enough.
- **A many-crate workspace split, a dozen parity-check scripts, i18n coverage gates.** These pay off at very large scale; at hackathon scale they cost time. Keep tsc, ESLint, clippy, Vitest and one Playwright smoke test.
- **The stdio sidecar** with plaintext-secret config scrubbing. Prefer the in-process HTTP MCP endpoint (§2.1).
- **A background daemon, peer-to-peer networking, cloud sync, local vector memory, OCR, voice.** None of these are on the wallet's critical path.
- **Domain-specific approval executors.** Reuse the queue mechanics (§3.2), not a large set of domain executors.

---

## 9. Suggested borrow order **[inferred]**
1. **Week 1:** a spawner (binary resolver, environment strips, no-window flag, kill-on-drop, stderr drain, tree kill) and the stream-json parser with the three-way verdict and cost capture. Add a normaliser for Codex events.
2. **Week 2:** an in-process MCP endpoint (`initialize`, `tools/list`, `tools/call`), a per-session token in a temporary MCP config, a Host allowlist, a local secret, and a restricted argv.
3. **Week 3:** the blocking approval tool backed by a oneshot hub with a TTL and cancel-on-exit, plus an SQLite approval table with the compare-and-swap claim, a freshness window and a recorded decider. The policy engine decides auto-approve, ask or deny *before* submitting.
4. **Week 4:** a keychain master key with an AES-GCM vault for the PayPal client secret and refresh token, a hash-chained audit table, redaction at storage time, and IPC tokens for privileged commands.
5. **Weeks 5–6:** tray badge and notifications for pending approvals, webhook intake through a relay in sandbox (plus a scheduler for recurring payments if needed), and polish.
