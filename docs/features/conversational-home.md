# The board: one-page home with an assistant

Status: built on branch `worktree-spark-conversational-home`, opt-in, not merged. Project and decisions: [`docs/design/conversational-home-migration.md`](../design/conversational-home-migration.md). MCP question: [`conversational-home.md`](../design/conversational-home.md). In-app engine path: [`conversational-home-engine-path.md`](../design/conversational-home-engine-path.md).

## What the owner sees

A second view of the main window, beside the console. Open it with `?view=board`, the **Board** button in the console's top bar, or by remembering the choice (`table-home-view`). The console stays the default.

- **Instrument strip.** Room left today against the signed cap, deals today against the cap, held (at PayPal and before PayPal), confirmed by PayPal, and whether the records are intact. A figure the wallet cannot know shows dashed "not available yet", never 0.
- **The switchboard.** One row per module, in the module's colour and glyph. Four columns: needs you, moving by itself, stopped, paid. Every deal is one key with a shape and a word for its status, its amount and its time left; a key that needs the owner also says what happens if she does nothing. A small week mark ends each row.
- **Chat rail and answer area.** She asks in her own words; the answer arrives as one of ten panels and may light up or dim parts of the board. The board never leaves the page.
- **Day one.** On a brand-new wallet the first answer is the four setup steps and the board is honestly empty.
- **Decisions.** Clicking a key opens the decision behind it. Its gold button hands off to the approval window; nothing is approved on this page.

## How the assistant works

Two engines sit behind one door.

| Engine | What it is |
|---|---|
| Scripted | Canned intents with keyword matching over what the board shows. Always available; labelled "Scripted preview, not a live model". |
| `claude-code` | The `claude` CLI, headless, one turn, no tools, run in an empty directory with no project settings, memory or MCP, and with API keys removed from its environment. In the desktop app the shell runs it (`assistant_ask`, a main-window read; see the engine-path note), behind a start-up check that it lists no tool. In the browser dev build on the sample world, a bridge in the Vite dev server runs it. |

The engine is told what the board shows (a digest with no counterparty text) and answers with one JSON reply: a short `say` plus up to eight ops from a closed set. `validateReply` (`lib/assistant/validate.ts`) is the only door: it salvages valid ops, drops the rest, counts what it dropped (shown to the owner as "n parts could not be shown") and never throws. If the live engine fails, the board falls back to the scripted one and says so.

Ops: `show` a panel, `focus` a module / fate / deal, `filter` the board, `propose` a button. Panels: needs, decision, deal, money, rules, rescue, safety, book, week, setup.

## Who decides each money step

Nobody on this page does. A proposal button resolves host-side to `approval_open` (open a decision, open a setup step) or to a console route, and the confirmation is rendered from the resolved action, not from the proposal's own words. The decision and owner tiers stay in the approval window; `windows/main/console/guard.test.ts` scans the whole main window, the board included.

## Where it lives

- `src/windows/main/switchboard/` the view, model, panels, chat rail; `App.tsx` the view switch.
- `src/lib/assistant/` the vocabulary registry, validator, digest, prompt, scripted engine, bridge client, in-app client `tauriEngine.ts` (`contract.ts` is the wire contract).
- `scripts/assistantBridge.ts` the dev-server bridge to the CLI (not in production builds; the client side is folded away by `import.meta.env.DEV`).
- In the desktop app: `assistant_ask` / `assistant_status` (`crates/table-client/src/assistant.rs`, the shell handlers in `apps/desktop/src-tauri/src/native/commands.rs`), the door and the contained turn in `crates/table-engine/src/assistant.rs` and `native.rs`. The prompt and schema the shell sends are a pinned copy, `crates/table-client/src/assistant_contract.json` (regenerate with `UPDATE_ASSISTANT_CONTRACT=1 pnpm test tauriEngine` when the vocabulary changes).
- Words: `lib/words/board.ts`, `lib/words/assistant.ts`.

## Tests that pin it

`switchboard/*.test.*` (fate mapping over the mock world, per-cell counts, first-run, decision hand-off sends only `approval_open`, op execution with a fake engine, keyboard, engine choice between the shell, the dev bridge and the scripted preview), `lib/assistant/*.test.ts` (registry parity, hostile replies, digest injection, scripted intents, the in-app client and the pinned prompt and schema), `lib/assistant/bridge/*.test.ts` (fake-CLI hardening cases; the live test runs only with `ASSISTANT_LIVE=1`). Rust: `crates/table-engine/tests/assistant.rs` (exact argv, the strict stream, the door's limits and conformance, the contained child with an offline fixture), `table-client` `assistant` and `authority` tests, `src-tauri/tests/capabilities.rs`; the live run is spike 7 (`TABLE_LIVE_ENGINES=1`).

## Known gaps

- UNVERIFIED in a real Tauri webview: the in-app `claude-code` path (`assistant_ask`) is tested in Rust and in the client and ran live through the Rust path once (CLI 2.1.316), but has not been called from the desktop window itself; nor has the one CSS container query the board uses.
- In-app isolation is checked on the CLI's first output line, not before input: the CLI only lists its tools after reading its input, so the shell sends a canned question with no owner data first each session, and shuts the assistant for the session on any wrong inventory (engine-path note, "Isolation").
- Cancelling or re-asking in the app stops the page waiting, but the shell's turn runs to its own end (at most 60 s); a question meanwhile is answered by the scripted engine.
- Spend has a per-call cap and a per-minute count, but no monthly meter and nothing shown to the owner (`meters_available` is still false).
- The week mark is derived from each deal's last update, not from the history read.
