# Plumbing brief - native activation and deferred backend (P1-P5)

Owner's instruction (2026-10-02): "Lets do the plumbing first so codex can run again. We will then
follow with the client implementation polishing concept winning the UI contest."

B0-B8 are committed (see `docs/build/STATUS.md`). The shell compiles and exposes a typed client
contract, but payment, safe and configuration commands return `UNAVAILABLE` because nothing
native is attached. This brief turns the shell into a **working wallet backend** so the client
session can wire real buttons. Still no React/UI work: the placeholder pages stay placeholders.

Read `AGENTS.md` (the money-authority rule), `docs/build/STATUS.md` (especially "Unverified and
deferred work", "Client handoff", "Exact resume point"), then this file. The design sources and
`.research/` remain the authority for behaviour.

## Order of work (priority = what the client needs first; stop only at a boundary)

### P1 - Activate the shell (highest priority)

- **Secrets and keys**: `keyring`-backed vault for PayPal sandbox client id/secret, Channel3 key,
  the owner signing key and per-agent keys (generated on first run, never leave Rust, never
  logged). A `Vault` trait with an in-memory test implementation.
- **OS re-auth**: Windows Hello via `UserConsentVerifier` (windows crate) behind an `OsReauth`
  trait; `unlock` becomes real; the 15-minute idle lock stays authoritative. Non-Windows returns
  a typed "unsupported" so the client can show it. Never a fake unlock.
- **Wallet actor**: one serialized actor in the desktop process owning ledger, pipeline, signer,
  PayPal client and scheduler; Tauri commands send typed messages to it. Attach the tested
  `table-app` pipeline. Activate `deal_withdraw`, `deal_let_lapse`, and the privileged commands
  (`deal_countersign`, `deal_capture`, `deal_void`, `shield_release`, `rescue_approve`,
  `open_paypal_in_browser`) with the existing label + token + unlocked checks.
  `open_paypal_in_browser` opens the core-verified approve link with the system browser (opener /
  shell open), never a webview, never a URL from the client.
- **Deadline scheduler + order poller** inside the actor: defaults (withdraw / expire / void, never
  capture), polling `GET` order after hand-off, emitting `deal:changed`, `receipt:created`,
  `attention:changed` with real producers.
- **Configuration commands the client needs** (register, gate, generate bindings): credential
  entry (`set_credentials`, privileged, write-only - never returns secrets), engine selection and
  status, mandate sign / version / revoke (privileged, owner key), band set for a deal in focus,
  pairing (create code, join code, confirm words), settings read/write for Tumbler preferences
  (pin, remembered position, quiet/DND, notification on/off), first-run state.
- **Native window behaviour** from `docs/design/window-duality.md`: `SW_SHOWNOACTIVATE` on arrival,
  persisted puck position and form preferences, drag + snap classification wired to the tested
  placement code, one OS notification at the <= 15 min rung (notification plugin; click focuses
  the Tumbler card), DND respected, confirmed Quit-with-pending-gates, Pause all agents.
- Regenerate `bindings/`; update the STATUS "Client handoff" table so every command shows its real
  availability.

### P2 - Native engines

- `claude-code` and `codex-cli` subprocess adapters behind the existing `EngineAdapter`: binary
  resolution on Windows (real `.exe`, follow npm shims to `node` + script), `CREATE_NO_WINDOW`,
  stdin prompt, stdout stream parsing with the existing parsers, stderr drained, watchdog,
  process-tree cancel, env stripping, app-owned empty cwd, temp MCP config with a per-session
  token, `system/init` tool-set check before any input is acted on. Wire the local MCP server
  (`table-mcp`) into the actor so an agent run can actually negotiate.
- You may run `claude --help`, `claude --version`, `codex --help`, `codex exec --help` and
  `codex --version` on this machine to resolve the `UNVERIFIED` flags in `argv.rs`; record the
  versions and what you confirmed. **Do not start real model runs** (they cost the owner's quota);
  live isolation checks stay in the spike runbook (P5).

### P3 - Remaining agent tools and secondary PayPal endpoints

- MCP tools: `market_reference` (cached Channel3 band), `shop_search` / `shop_quote` /
  `shop_checkout` (local catalog, floors from the shop mandate), `book_query` (closed BookQuery
  schema compiled to read-only SQLite - a write attempt must raise).
- PayPal: Invoicing v2 (create, send, get), Subscriptions (get, suspend, activate, revise,
  capture `OUTSTANDING_BALANCE`), Transaction Search (HTTP + pagination within the implemented
  bounds), Disputes (list/get). Wiremock tests for each; `UNVERIFIED` where the research is [R].
- Rescue: failure detection (polled events or REPLAY fixtures), the lever set, recovered-revenue
  accounting that never counts REPLAY-only rows (acceptance R1-R3).

### P4 - Two machines

- Relay-backed outbox/inbox in the actor (rendezvous client, long-poll, retries), buyer-side
  SELLER_ATTESTED receipt acceptance and reconciliation chips, the hosted house seller with a
  release-pinned key and mandate (keys from env on the server, never in the repo).

### P5 - Spike runbook

- `docs/build/SPIKES.md`: for each of the eight day-1 spikes, the exact command or `#[ignore]` test,
  the env vars it needs (names only), the expected evidence, and where the result is recorded.
  Make every spike runnable by the owner with one command once credentials exist.

## Rules (unchanged)

Everything in `AGENTS.md`. Tests never use the network; `cargo fmt`, `cargo clippy --workspace
--all-targets -- -D warnings`, `cargo test --workspace` pass at every boundary; nothing outside
`paypal/` changes; `docs/design/`, `prototype/`, `.research/` are read-only; no git state changes.
Keep `docs/build/STATUS.md` current after each phase, with an exact resume point.
