# Conversational home: the engine path inside the app

Status: built. The desktop app asks the installed `claude-code` CLI through two new main-window reads, `assistant_ask` and `assistant_status`, answered by the shell. The browser dev server keeps its own bridge (`apps/desktop/client/scripts/assistantBridge.ts`); production browser builds have neither. Verified live once on CLI 2.1.316 through the Rust path (spike 7, below); not yet run inside a real Tauri webview.

## What runs

One question is one bounded, tool-less turn of the CLI:

- **The page** (`src/lib/assistant/tauriEngine.ts`) joins the question and the board digest exactly as the dev bridge writes them to the CLI (`question + "\n\n" + buildDigest(input) + "\n"`; the digest carries no counterparty text) and sends that one text as `assistant_ask { text }`. It parses the returned string and hands it to `validateReply` like every other reply. Every failure becomes a reason word and the board answers from the scripted engine, saying so.
- **The shell** (`apps/desktop/src-tauri/src/native/commands.rs`) checks its own authority row (`label(&window, "assistant_ask")`) and passes the text to `AssistantDoor::ask`. Nothing reaches the wallet actor: the door holds no wallet handle, so a 60 s turn never blocks wallet commands.
- **The door** (`crates/table-engine/src/assistant.rs`) enforces: text non-empty and at most 128 KB; one turn in flight (`busy`, released on any ending, including a dropped future); 6 questions per rolling minute; a conformance turn before the first owner text of a session (below); a reply that is a JSON object of at most 64 KB. It returns compact JSON text.
- **The child** (`NativeEngine::assistant_turn`, `crates/table-engine/src/native.rs`) is the same contained process as an agent run, not a parallel spawn path: `resolve_command` (no shell, no shim text), `env_clear()` plus `ENV_ALLOW` only (so every `STRIP_ENV` name is gone; test-bound), a kill-on-close Job Object on Windows, an empty `cwd` inside a locked run directory under `<app data>/assistant`, stderr drained and dropped, 64 KB per line, 64 KB in all, inventory within 15 s, whole turn within 60 s.
- **The argv** (`assistant_argv`, `crates/table-engine/src/argv.rs`): `-p`, stream-json in and out, `--tools ""`, `--strict-mcp-config` with an empty config, `--disallowedTools mcp__*`, `--permission-mode dontAsk`, `--setting-sources ""` (no project or user instructions, hooks or memory), `--no-session-persistence`, `--disable-slash-commands`, `--effort low`, `--max-budget-usd 0.25`, `--max-turns 1`, `--system-prompt-file`, `--json-schema <inline>`. Only `claude-code` has this flag set; `codex-cli` is refused (`Unsupported`).
- **The stream** (`StreamParser`, `Profile::Assistant`): the first line must be the `system/init` inventory, listing no tool except `StructuredOutput` (the CLI's own carrier for `--json-schema`) and no MCP server; any other tool, server, MCP error, or any line before the inventory is `Isolation`. After it, only: assistant text, thinking, a `tool_use` of `StructuredOutput`; a `user` message made only of tool results (the CLI's acknowledgement of that call); `rate_limit_event`; `system/api_retry`; one terminal `result`. The reply is that result's `structured_output`, taken only from a clean result of a fully accepted stream.

## The prompt and schema are the shell's

The page sends text only (`AssistantAskArgs` has `deny_unknown_fields`). The system prompt and reply schema are a pinned copy of `lib/assistant/prompt.ts` and `vocabulary.ts`: `crates/table-client/src/assistant_contract.json`, embedded by `table_client::assistant::assistant_spec()`. `tauriEngine.test.ts` fails when the copy drifts from the client's source; `UPDATE_ASSISTANT_CONTRACT=1 pnpm test tauriEngine` rewrites it (then rebuild the shell). A change to the vocabulary therefore needs that regeneration in the same change.

## Isolation: what is checked, and the deviation from the agent gate

The agent gate withholds input until the strict parser has accepted an inventory. **Measured on CLI 2.1.316: in stream-json input mode the CLI emits `system/init` only after it has read the first stdin message**, so that ordering cannot be met: an agent run times out waiting (this is spike 2's open question, answered). The assistant therefore writes its input first, and the inventory is checked as the first line, before any other line is accepted and before the model's first answer (init arrived about 0.5 s after input; the first answer 1.7 s later). A wrong inventory kills the process tree at once (`a_bad_inventory_kills_the_turn_at_once`: the decoy is gone in under 4 s while it would have slept 30).

To keep owner data away from an engine whose inventory has not been seen, the door runs a **conformance turn** first in each app session: a canned input with no owner data (`ASSISTANT_CONFORMANCE_INPUT`), the real prompt and schema, the same argv. It costs one model turn (about half a cent to one cent measured). Outcomes: inventory accepted, the door opens for the session; `Isolation`, the door closes until restart and no owner text is ever sent; any other failure (timeout, spawn), the check runs again on the next question. Every real turn checks the inventory again, and an `Isolation` there also closes the door. `--permission-mode dontAsk` denies any tool that was not pre-allowed (none is) as a second line, and `cwd` is an empty directory.

This is a deliberate, recorded deviation from "input only after inventory" for this profile only; the agent profile's gate is unchanged (`execute` refuses `Profile::Assistant`, `argv` refuses it, and the parser's assistant allowances apply to no other profile; tests bind all three). The data at stake is the owner's own board digest going to the owner's own CLI login, and no tool can run.

## The command (authority)

Two rows appended to `authority_table.rs`: `assistant_ask` and `assistant_status`, window `MAIN`, tier `Read`, no token, no unlock, no selection, enforcer `Shell`. Pinned by hand in `authority.rs` (`the_board_assistant_is_a_main_only_shell_read`), in `table-runtime/src/authority_tests.rs` (`SHELL_ONLY`) and in `src-tauri/tests/capabilities.rs` (precise label grants; every shell handler checks its own row). `PINNED_MANIFEST` moved to `c96731ae…a944`. The main window still names no release command (`console/guard.test.ts` green). The recorded proof files carry the manifest they were signed under, so the change re-recorded them (`node scripts/record.mjs`, after removing the arena and house-haggle files the keep rule would otherwise keep, since a manifest is masked as a hash), and `lib/proof/sampleId.ts` follows the house haggle's new deal id.

`assistant_status` runs no model: it says whether a question would be tried (an engine was found, this platform can contain it, and conformance has not failed this session). The page asks it once when the board mounts and only then shows `claude-code` as the engine. The browser mock answers `assistant_ask` with UNAVAILABLE and `assistant_status` with not available; demo mode in the desktop app uses the mock, so it stays scripted.

## Keys and budget

There are no keys in the app: the CLI uses the owner's own login, and `env_clear` removes any API key or parent-session variable from the child. Spend is bounded per call by the CLI's own `--max-budget-usd 0.25` and per minute by the door's count (so at most 6 turns, about 1.5 USD worst case, a minute; a measured question costs about one cent). There is still no monthly meter: `meters_available` is hard-wired false (`table-runtime/src/service.rs`), so spend is not shown to the owner.

## Measured (n = 1 each, 2026-11-01, CLI 2.1.316, one Windows machine)

- Probe of the stream with `--json-schema` in stream-json mode: inventory `["StructuredOutput"]`, `mcp_servers: []`; the reply as a `StructuredOutput` tool call, then a `user` tool-result line, a `rate_limit_event`, and a `result` with `structured_output`, `num_turns: 2`, `subtype: success` even with `--max-turns 1`. `--max-turns 0` is ignored (a model call still happens), so there is no free conformance probe.
- Spike 7 (`TABLE_LIVE_ENGINES=1 cargo test -p table-engine --test spikes spike_7 -- --ignored`): conformance turn plus one question, 8.6 s in all, a valid reply (show needs, focus the deal, propose open_decision, a two-sentence say that names what happens on silence).

## Still unknown or unverified

- **A real Tauri webview run.** The commands, handler and door are tested, and the Rust path ran live, but `assistant_ask` has not been called from the desktop window itself.
- Whether later CLI versions keep the same stream shape (`StructuredOutput`, the tool-result `user` line, `rate_limit_event`). Any change fails closed (scripted fallback); spike 7 is the re-check.
- Latency: one cold start per question (about 2 to 4 s measured for a turn, plus the one conformance turn per session). The board shows its busy state meanwhile.
- The CLI tells the model the account's email address in its environment block. Owner decision: acceptable, kept.
- An IPC call cannot be withdrawn: when the owner cancels or asks again, the page stops waiting at once, but the shell's turn runs to its own end (at most 60 s) and a question in that window is refused as busy and answered by the scripted engine. An `assistant_cancel` would fix it; not built.
- `codex-cli` has no checked single-turn structured flag set and is refused for this profile.
- The digest is built in the page, not in Rust from the display reads. The page could send any text the owner could type anyway; the reply is validated either way, and no tool exists to act on it.
