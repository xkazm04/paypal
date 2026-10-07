---
product: The Table (PayPal agentic wallet)
vault: .personas/council/vault
vault_subdir: ""
runs_dir: .personas/council/runs
state_file: .personas/council/state.json
decisions_dir: .personas/council/decisions
web_lookups: false
market_brief_days: 30
---

# Council overlay: The Table

Overlay for the /council method. Docs and config only; no product code is described here.

## Gates

Run in this order. Never run two cargo invocations at once. Tests never touch the network, and
`#[ignore]` sandbox tests stay ignored.

Always:

1. `cargo fmt --all --check`
2. `cargo clippy --workspace --all-targets -- -D warnings`
3. `cargo test --workspace`

Only when `apps/desktop/client/` is in the span AND `apps/desktop/client/node_modules` exists:

4. `pnpm --dir apps/desktop/client typecheck`
5. `pnpm --dir apps/desktop/client test`

Otherwise record the client gate as "not run: no node_modules exists in a worktree". Never install.

Calibration (base c9401ea, worktree): fmt exit 0, clippy exit 0, test exit 0 (217 passed, 0 failed).
All three Rust gates were green at that base, so the robustness gate stays the full gate set.
Re-calibrate if a later base differs; a gate seen failing is never declared green.

## Span

`context-map.json` at the repo root holds hand-partitioned contexts with no feature links. The
reviewer derives a feature's span by hand from the feature description plus the contexts it names,
and says so in the review.

## Characters

Personas live in `uat/characters/`: `maya-shop-owner.md`, `dan-counterparty-reseller.md`,
`hackathon-judge.md`. Maya, Dan and Second Screen are invented for illustration; unsourced claims
in them are marked assumption.

## Live app

none. Never start the Tauri app. The value member records L1 (reviewed from code and docs only).

## Repo law

`AGENTS.md` is the authority. Short form:

- The LLM never moves money; only the Rust pipeline (`table-app`) makes money-moving PayPal calls,
  on a recorded authority (owner decision in the `approval` window, a rule the owner signed, or a
  safe default).
- Every agent intent passes the mandate check before any network call; refused intents leave zero
  `paypal_calls` rows.
- `audit_log` is append-only and hash-chained; no UPDATE/DELETE path.
- Secrets live in the OS keychain (`keyring`), never in files, logs, the webview or fixtures.
- Counterparty and merchant free text is untrusted: never agent instructions, never in the Tumbler.
- Silence never moves money.
- Engines are `claude-code` and `codex-cli`; no vendor product name in user-facing strings.
- Money is integer minor units plus ISO currency; no `unwrap`/`expect` outside tests and `main`.

## Hard failures

- `credential_outside_vault`: a secret anywhere but the OS keychain through `keyring`
  (see `crates/table-runtime/src/vault.rs`).
- `write_outside_door`: a money-moving PayPal call outside the `table-app` pipeline
  (`crates/table-app/src/pipeline.rs`, calls in `crates/table-paypal/src/client.rs`) on a recorded
  authority, or any UPDATE or DELETE path on `audit_log` (`crates/table-ledger/src/audit.rs`).
- `unbounded_foreign_decode`: relay, HOUSE, PayPal or counterparty input parsed or buffered with
  no size cap, timeout or error path (relay in `crates/table-relay/src/lib.rs`, HOUSE in
  `services/house-seller/src/hosted.rs`).
- Any other code: not_applicable (AGENTS.md declares none; never inferred).

## Skill improvement log

(empty)
