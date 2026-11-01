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
| `claude-code` | The `claude` CLI, headless, one turn, no tools, run in an empty directory with no project settings, memory or MCP, and with API keys removed from its environment. Reached through a bridge in the Vite dev server, so it exists only in the browser dev build on the sample world. |

The engine is told what the board shows (a digest with no counterparty text) and answers with one JSON reply: a short `say` plus up to eight ops from a closed set. `validateReply` (`lib/assistant/validate.ts`) is the only door: it salvages valid ops, drops the rest, counts what it dropped (shown to the owner as "n parts could not be shown") and never throws. If the live engine fails, the board falls back to the scripted one and says so.

Ops: `show` a panel, `focus` a module / fate / deal, `filter` the board, `propose` a button. Panels: needs, decision, deal, money, rules, rescue, safety, book, week, setup.

## Who decides each money step

Nobody on this page does. A proposal button resolves host-side to `approval_open` (open a decision, open a setup step) or to a console route, and the confirmation is rendered from the resolved action, not from the proposal's own words. The decision and owner tiers stay in the approval window; `windows/main/console/guard.test.ts` scans the whole main window, the board included, and a second check there proves the board and `lib/assistant` name no decision, owner or session command and call only `approval_open` and the safe acts' act-tier commands.

## Safe acts from chat

Design and the full candidate table: [`docs/design/conversational-home-safe-acts.md`](../design/conversational-home-safe-acts.md).

One act may be proposed: **pause all agents** (`pause_agents`, which runs `pause_all_agents`, act tier). It can only make the wallet do less: agent work stops, nothing new starts, nothing is paid, approved or cancelled, and deadlines keep running with no money moving.

- The proposal is drawn as a "Needs your OK" box whose title, effect lines and button come from fixed words and the wallet's own facts (paused or not, how many agents are working). The assistant's reason sits above it as "The board says: ...", never inside it.
- It is disarmed, with the reason, when agents are already paused or when that is not known.
- One press runs the command once, after re-checking that what was shown still holds. The result line appears only after the wallet answers.
- Undo is the host's own button and runs `resume_all_agents`; the assistant cannot propose resuming. Resume is also in Settings, Your agents.
- An act proposal carrying any extra key is dropped and counted, never trimmed. A reply the validator repaired says so under the answer.

Dropped, and why: letting an ask lapse and withdrawing an offer cannot be undone; snoozing is tumbler-only; there is no command to dismiss a notice; starting agents or opening tables makes the wallet do more.

## Where it lives

- `src/windows/main/switchboard/` the view, model, panels, chat rail; `App.tsx` the view switch.
- `src/lib/assistant/` the vocabulary registry, validator, digest, prompt, scripted engine, bridge client (`contract.ts` is the wire contract).
- `scripts/assistantBridge.ts` the dev-server bridge to the CLI (not in production builds; the client side is folded away by `import.meta.env.DEV`).
- Words: `lib/words/board.ts`, `lib/words/assistant.ts`.

## Tests that pin it

`switchboard/*.test.*` (fate mapping over the mock world, per-cell counts, first-run, decision hand-off sends only `approval_open`, op execution with a fake engine, keyboard), `lib/assistant/*.test.ts` (registry parity, hostile replies, digest injection, scripted intents), `lib/assistant/bridge/*.test.ts` (fake-CLI hardening cases; the live test runs only with `ASSISTANT_LIVE=1`).

## Known gaps

- The in-app (Tauri) desktop app has only the scripted engine; the CLI path there needs a new `read`-tier command, an authority-table row and the isolation conformance check (see the engine-path note). UNVERIFIED: how the Tauri webview treats the one CSS container query the board uses.
- The week mark is derived from each deal's last update, not from the history read.
- Answers from the live engine are wordy; the prompt has not been tuned for length.
- A safe act is not recorded as "proposed by the assistant" anywhere the wallet keeps; the pause itself is in the wallet's settings. Recording the proposal and the words shown needs a wallet-side change.
- The scripted engine does not propose the pause yet; only a live engine (or a test engine) can.
