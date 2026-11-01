# Conversational home: the engine path inside the app

Status: design only, no Rust written. The browser path is built: `apps/desktop/client/scripts/assistantBridge.ts` (Vite dev server only) spawns the `claude` CLI headless for one turn. This note says how the same engine runs in the Tauri app, and what is not yet known.

## What the dev bridge does (the behaviour to reproduce)

One non-interactive turn, no tools, no session persistence, no settings sources, no MCP, no slash commands, structured output against `replyJsonSchema()`, an empty temp directory as cwd, a 60 s kill, a 64 KB output cap, a low budget. The reply is returned untrusted and the client validates it (`lib/assistant/validate.ts`). Verified on CLI 2.1.316: the child lists no tools and sees no project instructions.

## Where it lives in Rust

1. **A single-turn, tool-less variant already exists.** `Profile::Toolless` (`crates/table-engine/src/lib.rs:44-47`) is used by `EngineAdapter::structured` (`lib.rs:154`; native impl `native.rs:534-565`): it sends no wallet tools, runs `--max-turns 1`, `--tools ""`, an empty MCP config and `--disallowedTools mcp__*` (`argv.rs:15-40`, `argv.rs:101-115`), caps collected text at 64 KB (`native.rs:548-552`) and validates against a `Schema`. Today its only schema is the shield verdict (`SHIELD_OUTPUT_SCHEMA`, `native.rs:579`, written to the run directory at `native.rs:148`) and its system prompt is a fixed verdict sentence (`native.rs:589-592`). The home assistant is a second consumer of this path, not a new path: it needs a `Schema::Assistant` (the reply schema) and a prompt selector beyond `(Profile::Toolless, _)`.
2. **Child environment.** The native child gets `env_clear()` plus the `ENV_ALLOW` list only (`native.rs:30-47`, `native.rs:79-92`), and a test binds `ENV_ALLOW` against `STRIP_ENV` (`argv.rs:134-147`, `tests/engine.rs:427-432`). That is stricter than the dev bridge, which strips by list (the same list, plus anything shaped like a key) because a dev machine's PATH and home are needed to find the CLI. The in-app path inherits the stricter rule for free. Subscription login stays CLI-owned; the app never sees or sets a key.
3. **Process containment.** On Windows the native child starts suspended inside a kill-on-close Job Object (`docs/features/agents-and-engines.md`, "Pause and end"); `kill_on_drop` is set (`native.rs:81`). That replaces the dev bridge's `taskkill /T /F`.

## Availability: the blocker

`claude-code` reports `available:false` always (`native.rs:516`, reason "The wallet can't yet confirm this agent app reaches only the wallet's own tools"), and `start_agent` refuses it with "Engine isolation conformance not established" (`crates/table-runtime/src/dispatcher.rs:596-600`). The reason is the unrun isolation spike for the AGENT profile: an inventory of the child's tools must equal the wallet catalogue before input is released (`docs/features/agents-and-engines.md`, `docs/build/SPIKES.md`).

The home assistant is a different profile: it has no tools and no wallet grant, so the spike's question ("does it reach only the wallet's tools") collapses to "does it reach no tools". The dev probe answers that for one machine (empty tool list, no project instructions) but it is not the conformance spike: it ran once, on this CLI version, through a different launcher. Decision needed: either (a) gate `assistant_ask` on a Toolless-specific conformance check that the strict parser runs before input (inventory must be empty), recorded as its own `EngineInfo` field, or (b) wait for the shared spike. Recommended: (a), because it does not loosen the agent gate at all.

## The command (authority procedure)

Follow "Adding a command" (`docs/features/ipc-and-authority.md:99-105`):
1. A `CommandContract` field and one row in `authority_table.rs`, modelled on the reads at `authority_table.rs:207` (`list_deals`): `assistant_ask`, window `MAIN`, tier `Read`, no token, no unlock. Read tier is right: it returns text and UI proposals and moves nothing. It must NOT be callable from the approval or tumbler windows.
2. `generate-bindings`; wire the shell handler; map the `Action` in `Action::command()` and add the call in `authority_tests.rs`.
3. Update `PINNED_MANIFEST` (`crates/table-client/src/authority.rs:243`).
4. A mock handler in `src/mock` so the browser world and tests behave the same, and a contract entry in `lib/assistant/contract.ts` (`BridgeRequest`/`BridgeResponse` get an in-app twin, not a rename).
The main window must still never name a decision/owner/session command (`console/guard.test.ts`, `bindings/authority.ts`); `assistant_ask` returns a proposal that the host resolves through `approval_open`, never a money action.

## Keys and budget

There are no keys in the app: the CLI uses the owner's own login. The dev bridge caps spend per call (`--max-budget-usd 0.25`; a measured call costs about one cent). In-app, budget belongs next to the other meters, but `meters_available` is hard-wired `false` (`crates/table-runtime/src/service.rs:437`; field `table-client/src/settings.rs:14`). So today there is nowhere to show or enforce a monthly allowance. Smallest honest stance: keep the per-call cap, a per-minute rate limit in the shell, and say "not available yet" for spend until metering exists.

## The digest and counterparty text

The assistant may know only `DigestInput` (`lib/assistant/contract.ts:87`): deal state words, amounts, deadlines, rule counts, setup flags. Counterparty free text (names, notes, messages) is untrusted and is excluded from the digest, not merely quarantined: a counterparty could otherwise plant instructions in the model's input. Deal labels are the owner's own label, cut and stripped again in `digest.ts`. In Rust the digest must be built from the same already-projected display structs the main window gets (`deal_display`-style reads), never from raw ledger rows, so exclusion is structural. The reply is validated twice: by the client (`validateReply`) and, before anything is armed, by the host when it resolves a `propose` op.

## Smallest first Rust slice

1. `Schema::Assistant` + prompt selector in `table-engine` (`structured` path), with a test that the argv for it equals the Toolless argv plus the schema, and that no name in `STRIP_ENV` is in `ENV_ALLOW` (already tested).
2. `EngineInfo` gains a Toolless-conformance result; for the CLI it is established by running the strict parser on an empty inventory.
3. `assistant_ask` (read, main) taking `{question, digest}` (500 char / 256 KB limits as in the bridge), returning the raw reply value; one request in flight; 60 s deadline.
4. The mock handler and the client `bridgeEngine` choosing in-app vs dev bridge by environment. The scripted engine remains the fallback in every failure case.

## Unknown

- Whether `--max-turns 1` is compatible with `--json-schema` on the CLI. The dev probe shows the structured result arrives after two turns (`num_turns: 2`), so the Rust `--max-turns 1` Toolless profile may need `2` or a different structured-output route. Untested; the dev bridge sets no turn limit.
- Whether the CLI honours `--setting-sources ""` the same on every version (verified on 2.1.316 only) and what the Rust profile's `--setting-sources project` (`argv.rs:104`) loads when cwd is the engine workspace.
- Latency and cost distribution (one live run only), and whether a cold CLI start is acceptable for the board's feel.
- The CLI still reports the account's email address to the model in its environment block; the dev probe saw "user email provided". Whether that is acceptable for a wallet product, or must be suppressed, is not established.
- Packaging: where the CLI binary is found for an installed app (the dev bridge uses `CLAUDE_BIN`, `PATH`, `~/.local/bin`; the Rust engine has its own executable resolution in `native.rs`).
- The multi-engine case: `codex-cli` has no equivalent single-turn structured flag set that has been checked.
