# Working on PayPal Agentic Wallet (The Table)

A Tauri 2 desktop wallet for AI agents that touch money, for PayPal's "Build What's Next with
PayPal and AI" hackathon (submissions close 2026-11-12 14:00 PT). This folder will become its own
public repository; treat `paypal/` as the repository root.

## Sources of truth (read before changing behaviour)

- `docs/design/the-table.html` - the design report: spine (Deal + Mandate), money mechanics per
  capability (§7), architecture, DDL and interfaces (§8), trust model (§9), surfaces (§10), build
  plan and acceptance criteria (§13). `docs/design/the-table.extract.txt` is a plain-text extract
  for grepping; the HTML wins on any difference.
- `docs/design/window-duality.md` - the three windows (`main`, `tumbler`, `approval`), forms,
  attention ladder, capability split, acceptance W1-W11.
- `docs/ux/UX-GUIDE.md` - who the UI is for (a non-technical PayPal merchant), the vocabulary,
  visual language and a checklist for every user-facing string or surface. Terms come from
  `apps/desktop/client/src/lib/words.ts`; never name internals (Rust, commands, clause numbers,
  ids) on screen. `docs/ux/UX-AUDIT.md` records what was found and fixed.
- `.research/*.md` - the facts the design stands on (PayPal APIs and gotchas, CLI engines, Tauri).
  `[S]` sourced, `[R]` recalled/unverified. Do not invent PayPal endpoints, fields, limits or CLI
  flags; if the research does not say it, mark it `// UNVERIFIED:` in code and list it in
  `docs/build/STATUS.md`.
- `docs/build/STATUS.md` - what is built, deviations, open spikes. Update it when you finish work.

## Invariants (enforced in code, never in a prompt)

- **The LLM never moves money**: it has no tool that creates, approves, authorizes, captures,
  voids or refunds at PayPal. Money-moving PayPal calls are made only by the Rust pipeline
  (`table-app`), and only on one of these authorities, each recorded in `decided_by` and the
  audit log (clarified 2026-10-02; supersedes the stricter wording B0-B3 worked from):
  1. **Owner decision in the `approval` window** - the only UI surface whose commands can
     countersign, release a hold, approve a rescue lever or open PayPal approval for money going
     out. Privileged = IPC token AND `approval` label AND not idle-locked.
  2. **A rule the owner signed in a mandate** - clause 6 policy countersign under the
     human-present threshold (report §8 step 4); the seller wallet authorizing and capturing an
     order the *buyer* already approved on PayPal (report §6.5, acceptance H5 - receiving money
     needs no click); the house seller, whose release-pinned mandate is its owner's signature.
  3. **A safe default** - void or let expire on deadline; never capture.
- Every agent intent passes the mandate check before any network call; refused intents leave
  zero rows in `paypal_calls`.
- `audit_log` is append-only and hash-chained; never add an UPDATE/DELETE path.
- Secrets live in the OS keychain (`keyring`); never in files, logs, the webview, or test fixtures. The one exception is the hosted HOUSE (`services/house-seller`), which runs where there is no keychain: it reads its signing seeds, its signed mandate and its PayPal sandbox credentials only from named host environment variables, never from files, and they never appear in logs, responses or fixtures (the operator, 2026-10-07; docs/build/DECISIONS.md section 14).
- Counterparty / merchant free text is untrusted: never fed to an agent as instructions, never
  rendered in the Tumbler.
- Silence never moves money: every deadline's default is "no money moves" (or a void).
- Engines are referred to as `claude-code` and `codex-cli`; never put a vendor product name in
  user-facing strings or product/feature names.

## Engineering conventions

- Rust stable (see `rust-toolchain.toml`), Cargo workspace, edition 2024 where supported.
- `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test --workspace` must pass before work is called done.
- Domain crates are pure (no IO) and carry most of the tests. IO crates sit behind traits so
  tests use in-memory or mock implementations. **Tests never touch the network**; live PayPal
  sandbox checks are `#[ignore]` tests gated on env vars and documented in STATUS.md.
- Money is integer minor units plus an ISO currency; decimals are parsed from strings, never
  floats.
- No `unwrap()`/`expect()` outside tests and `main`; errors via `thiserror` in libraries,
  `anyhow` only at binary edges.
- Licence: **Apache-2.0** (`LICENSE`; `license = "Apache-2.0"` in `[workspace.package]`, crates
  inherit it). Dependencies must stay compatible (see `deny.toml`).
- Keep dependencies few and mainstream; justify any new one in STATUS.md.
- Adding or changing an IPC command (theme T11): who may call it lives in ONE row of
  `crates/table-client/src/authority_table.rs` (window labels, token, unlock, selected deal, tier,
  runtime or shell enforcer); never hand-edit `COMMANDS`, `RELEASE_COMMANDS`, `build.rs`,
  `capabilities/*.json` or the mock's gates. Add the `CommandContract` field and the row, then
  `cargo run -p table-client --bin generate-bindings` (bindings, `bindings/authority.ts`, the
  capability files). Wire the shell handler (`generate_handler!` stays hand-written and is
  tested against the table); a runtime command maps its `Action` in `Action::command()`
  (`table-runtime/src/actor.rs`) and gets a call in `authority_tests.rs`, a shell-only one calls
  `label(&window, "<command>")`. The row changes the permissions fingerprint: update
  `PINNED_MANIFEST` in `table-client/src/authority.rs` in the same change, deliberately.
- Git: do not commit, push, stash, reset or switch branches unless the human asks; the kiro
  monorepo holds unrelated work.
