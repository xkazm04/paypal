# Backend build brief - non-UI phases (B0-B8)

Owner's instruction (2026-10-02): run a codex-cli agent "to execute non-UI phases of the project -
scaffolding professional code structure, preparing interfaces, tests, backend parts per your
design. We will later take over with [another] session and start building the client and
advanced features where higher creativity and intelligence will be needed."

So: build the **Rust backend, contracts and tests** so that a later session can build the React
client (The Dial main window, the Tumbler, the approval window) against stable, typed interfaces.
Read `AGENTS.md` first, then the design (`docs/design/the-table.html` sections 6-10 and 13,
`docs/design/window-duality.md`), then `.research/`.

## Out of scope (leave for the client session)

- Any React/TypeScript UI, styling, animation, the Dial or Tumbler visuals. The Tauri app gets a
  placeholder `ui/` page only so it builds.
- Prompt engineering for negotiator/shopper agents beyond a minimal, clearly marked stub
  `prompts/*.md`.
- Live PayPal / Channel3 calls in tests; real credentials anywhere.

## Target layout

```
Cargo.toml                    # workspace; shared lints; [workspace.dependencies]
rust-toolchain.toml           # stable, pinned to the installed 1.97 line
deny.toml  rustfmt.toml  clippy.toml
.github/workflows/ci.yml      # fmt, clippy -D warnings, test (windows-latest + ubuntu-latest)
crates/
  table-core/       # pure domain: Money/Currency/decimal parsing, Mandate + clauses (JCS canonical
                    # JSON + sha256 commitment), clause checks, Deal + DealKind + state machine
                    # (report §6.3 - the states/transitions are in the HTML's <script> data),
                    # Terms + terms_hash, rescue levers, market band, ids (ULID), clock trait
  table-proto/      # envelopes: closed-enum bodies, compact JWS (Ed25519), aud/nonce/exp/seq/prev,
                    # verification, transcript hash chain, pairing code -> mailbox hash + words
  table-ledger/     # rusqlite: migrations/0001_table.sql exactly per report §8 DDL (+ indexes),
                    # append-only triggers, audit hash chain (sha256(prev || JCS(row))), repositories,
                    # paypal_calls log with redaction, nonce store
  table-paypal/     # trait PayPalApi + reqwest impl: OAuth client-credentials + token cache,
                    # PayPal-Request-Id, invoice_id = {deal ULID}-{attempt}; Orders v2 (create
                    # AUTHORIZE, get, authorize), Payments v2 (capture, void, get), Invoicing v2
                    # (create, send, get), Subscriptions (get, suspend, activate, revise, capture
                    # OUTSTANDING_BALANCE), Transaction Search (31-day window, page_size<=500),
                    # Disputes (list/get only). No update-pricing-schemes anywhere (test R3).
                    # Order poller (truth = GET order, never the redirect). Approve-link host allowlist.
  table-market/     # Channel3 client behind a trait (comparables, start-tracking, price history), cache
  table-shield/     # deterministic shield rules (payee mismatch, F&F request, >1.4x median, new
                    # counterparty over threshold, no market reference) + verdict combiner where an
                    # engine verdict can only add caution
  table-engine/     # EngineAdapter trait exactly as report §8 (+ EngineId, EngineInfo, AgentJob,
                    # McpGrant, EngineEvent, TerminalVerdict, Schema); adapters claude-code, codex-cli,
                    # scripted (replays recorded tool calls); argv builders exactly as report §8 for
                    # the agent profile and cap 7 for the tool-less profile; Windows binary resolution
                    # (.exe not .cmd; follow npm shims); env stripping; stream-json parser; codex JSONL
                    # normalized to the same events; system/init tool-set check; process-tree cancel
  table-mcp/        # axum JSON-RPC MCP server on 127.0.0.1: initialize, tools/list (filtered by the
                    # session token's role), tools/call; per-session token, Host allowlist, local
                    # secret, JSON preflight; tools exactly the report's table (table_view,
                    # market_reference, send_offer, accept_offer, withdraw_offer, propose_purchase,
                    # shop_search/quote/checkout, book_query) wired through table-core checks; no tool
                    # reaches PayPal
  table-attention/  # window-duality §3 and §5: AttnKind, Urgency, TumblerAction, AttentionItem,
                    # AttentionSnapshot builder from deals, the ladder (calm/soon/now, one notification
                    # at <=15 min, DND), Tumbler FORMS size table, placement/snap arithmetic (anchor,
                    # side/valign flip, work-area clamp, logical px) with unit tests at 100/125/150%
  table-app/        # application services: the pipeline intent -> mandate -> shield -> countersign
                    # -> PayPal -> signed evidence (report §8), deadline scheduler (defaults never move
                    # money; 72 h auto-void), idle lock (15 min), privileged-command authorization,
                    # haggle orchestration over a Mailbox trait. Depends on the crates above via traits.
services/
  rendezvous/       # axum service for Render: mailbox API exactly as report §8 (PUT/POST/GET long-poll/
                    # DELETE, TTL 24 h, JWS <= 16 KB, no body parsing beyond shape), /healthz,
                    # POST /v1/house/tables; in-memory store behind a trait; Dockerfile + render.yaml
  house-seller/     # scripted seller (no LLM) skeleton: negotiation policy table + settlement via the
                    # same table-app pipeline; PayPal calls behind the trait
apps/desktop/
  src-tauri/        # Tauri 2 shell, NO real UI: runtime-built windows main/tumbler/approval with the
                    # flags in window-duality §1-2; capabilities/{main,tumbler,approval}.json per
                    # window-duality §5 (release commands ONLY in approval.json - test W3); build.rs
                    # AppManifest; command tiers (public / privileged = IPC token AND approval label AND
                    # not idle-locked); emit_to helpers (never broadcast); tray with dot; close-to-tray;
                    # single-instance; global summon hotkey; commands call table-app
  ui/               # placeholder index.html for main, tumbler.html, approval.html ("client pending")
bindings/           # TypeScript types generated from Rust (ts-rs or specta) for every command
                    # payload, event payload, AttentionSnapshot, Deal projection - the client contract
prompts/            # stub system prompts for the negotiator/shopper profiles, marked as stubs
docs/build/STATUS.md
```

Names are a proposal; keep them unless a strong reason appears, and record any change.

## Phases (do them in order; keep `docs/build/STATUS.md` current after each)

- **B0 Scaffold** - workspace, toolchain, lints, CI, empty crates compiling, STATUS.md.
- **B1 Core** - table-core and table-attention, pure, with property-style tests for money parsing,
  JCS hashing, clause checks, state transitions, ladder and placement.
- **B2 Protocol** - table-proto with round-trip and rejection tests (reused nonce, wrong aud, past
  exp, seq gap, bad signature, unknown field -> rejected; acceptance H2).
- **B3 Ledger** - migrations, append-only triggers (tests prove UPDATE/DELETE abort), audit chain
  verification, repositories, redaction.
- **B4 PayPal + market clients** - traits, reqwest impls, wiremock tests for every call incl.
  Request-Id reuse on retry, token refresh, error mapping with debug_id; `#[ignore]` live-sandbox
  tests reading `PAYPAL_SANDBOX_CLIENT_ID/SECRET` (never committed) for the report's day-1 spikes.
- **B5 Engines** - adapters, argv builders (snapshot tests of exact argv), parsers against
  recorded fixture streams in `crates/table-engine/tests/fixtures/`, init tool-set check (E1-E3),
  scripted engine.
- **B6 MCP server** - JSON-RPC, auth layers, role-filtered tools, handlers through table-app;
  tests for H1, F1 (0 paypal_calls rows on refusal), M3, and "no tool reaches PayPal".
- **B7 App services + rendezvous + house seller** - pipeline, scheduler, idle lock (F4), haggle
  over an in-memory mailbox end-to-end with two wallets in one test (H3, H4 offline with the
  PayPal trait mocked), rendezvous service tests, house seller skeleton.
- **B8 Desktop shell** - Tauri 2 (pin 2.x as the report says), windows, capabilities, commands,
  events, tray, single-instance; `cargo check -p <desktop crate>` must pass; a test parses the
  three capability files and asserts the release set appears only in approval.json (W3);
  generate `bindings/`.

Map every acceptance criterion from report §13 and window-duality §7 to a test name or to an
explicit "needs sandbox / needs UI" entry in STATUS.md - a table with one row per criterion.

## Done means

- `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings` and
  `cargo test --workspace` pass (the desktop crate at least `cargo check`s on Windows).
- `docs/build/STATUS.md` has: what is built per phase, the acceptance-criteria table, every
  `UNVERIFIED` assumption, deviations from the design with reasons, the day-1 spikes still owed,
  and a **Client handoff** section: commands (tier, args, returns), events (target label,
  payload), where the generated TS types are, and what the client session must build.
- Nothing outside `paypal/` was modified; no git state was changed.
