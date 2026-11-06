# The home: status first, an assistant to go further

Status: the main window's default view since spark `abstract-first-home` (2026-11-06; design and the five prototype rounds in [`docs/design/abstract-first-home.md`](../design/abstract-first-home.md)). It replaced the counts board of [`the-proof-table.md`](../design/the-proof-table.md). Earlier design: [`conversational-home-migration.md`](../design/conversational-home-migration.md); in-app engine path: [`conversational-home-engine-path.md`](../design/conversational-home-engine-path.md).

## What the owner sees

The main window opens on the home (stored view name `board`, `table-home-view`; `?view=board` and `?view=console` still work, and the console's **Home** button comes back). It starts abstract and lets her go further by clicking or asking.

- **Top bar.** Brand, mode badge, sample-data badge, and **Everything**, which opens the console.
- **The opening.** The conversation's first turn is composed locally from the standing answers, never by the model. It has:
  - one status line;
  - while she was away, one line of what happened, with "n more";
  - the first need as one card: its amount, deadline, what silence does, Review (the approval window), Details, and "All n needs".

  Chips under it ask the next obvious questions.
- **The side list.** One list with a switcher (All + the six modules) and a title filter. Each item is one row, in its module's own columns:

  | Module | Columns |
  |---|---|
  | Tables | Offer · Your limit · Time |
  | Spend | Amount · Verdict |
  | Counter | Price · vs usual · Now |
  | Book | Amount · Where |
  | Shield | Amount · Verdict · Why |
  | Rescue | At risk · Next |

  It opens on the module holding the first need.
- **Item pages.** A row (click or Enter) slides the conversation away and main becomes the item's page:
  - a crumb "Today › Module › title";
  - the facts, the story and the actions;
  - the ask box, scoped to the item.

  Esc or the crumb puts the conversation back exactly as it was.
- **Replies stay in the conversation.** A reply's panels render inline in its turn. A reply about one deal offers "Open <title>". Filter and focus only scope the side list and ring a row, and one Undo puts the list back. Main moves only when she clicks. After an act or the approval window, main comes back to the conversation with one line saying what happened.
- **First run: the guide.** While the wallet is in setup, the conversation leads it one step per turn, with one component in each turn:
  1. PayPal sandbox keys.
  2. Rules, proposed in plain words with the practice shop as payee. She can change them by saying so.
  3. Practice: the agent app, then the practice shop's four words.

  Then "You're set" with three pointers. After each step, at most one spotlight shows where the result lives. A question at any time is answered in place, and the step is offered again under it. "Skip for now" pauses, and a reload resumes from the wallet's own facts.
- **Secure steps never leave the window.**
  - In a browser on the sample world, keys, rules and pairing open as a focused sheet over the dimmed app. The sheet holds the approval side's one-form surface (`approval.html?bare=keys|rules|pairing`), with the same session token and gates; keys never pass through an app page.
  - In the desktop app the step is the approval window itself, opened as a sheet: one form, frameless, docked over the home, which dims until the shell says it closed (`approval:sheet`; [`desktop-secure-sheet.md`](../design/desktop-secure-sheet.md)).
- **Motion.** framer-motion, with durations and curves from `design/motion.ts` (`DUR`, `EASE`).

## How the assistant works

Two engines sit behind one door.

| Engine | What it is |
|---|---|
| Scripted | Canned intents with keyword matching over what the board shows. Always available; labelled "Scripted preview, not a live model". |
| `claude-code` | The `claude` CLI, headless, one turn, no tools, run in an empty directory with no project settings, memory or MCP, and with API keys removed from its environment. In the desktop app the shell runs it (`assistant_ask`, a main-window read; see the engine-path note), behind a start-up check that it lists no tool. In the browser dev build on the sample world, a bridge in the Vite dev server runs it. |

The engine is told what the board shows (a digest with no counterparty text) and answers with one JSON reply: a short `say` plus up to eight ops from a closed set. `validateReply` (`lib/assistant/validate.ts`) is the only door: it salvages valid ops, drops the rest, counts what it dropped (shown to the owner as "n parts could not be shown") and never throws. If the live engine fails, the board falls back to the scripted one and says so.

Ops: `show` a panel (rendered inline in the reply's turn), `focus` a module / fate / deal (scopes the side list and rings a row), `filter` the side list, `propose` a button. Panels: needs, decision, deal, money, rules, rescue, safety, book, week, setup. During setup the guide owns the steps: setup panels and setup proposals from replies are not shown, and the guide offers its current step under the answer. The wire did not change for the home: no new op, no version bump.

## Who decides each money step

Nobody on this page does. A proposal button resolves host-side to `approval_open` (open a decision), to a setup step in the conversation, or to a console route, and the confirmation is rendered from the resolved action, not from the proposal's own words. The decision and owner tiers stay in the approval window; `windows/main/console/guard.test.ts` scans the whole main window, and a second check there proves the home, the board model and `lib/assistant` name no decision, owner or session command, and that their only mutations are `approval_open`, `assistant_act` and the guide's act-tier steps (`engine_select`, `pairing_join`, `house_wake`). Keys, signatures and the practice shop's words are saved only by the approval context (the secure sheet's frame or the approval window).

## Safe acts from chat

Design and the full candidate table: [`docs/design/conversational-home-safe-acts.md`](../design/conversational-home-safe-acts.md).

Three acts may be proposed, each of which can only make the wallet do less:

| Act | Runs (act tier) | Undo (host only) |
|---|---|---|
| **Pause all agents** (`pause_agents`) | `pause_all_agents` | `resume_all_agents` |
| **Pause one agent** (`pause_agent`: negotiator, shopper or assistant) | `agent_pause` | `agent_resume` |
| **Let one ask lapse** (`let_lapse`: a deal on the board) | `deal_let_lapse` | `deal_lapse_undo`, until the deadline |

- The board sends every act and every undo through one wallet command, `assistant_act` (act tier, main only). The wallet runs the act from its own closed list and writes one `assistant.act` row to the audit chain with the consent words she was shown, their hash and the fingerprint. A refused act records nothing.
- The proposal is drawn as a "Needs your OK" box whose title, effect lines and button come from fixed words and the wallet's own facts (paused or not, how many agents are working, which agents are paused, the deal's own label). The assistant's reason sits above it as "The board says: …", never inside it.
- It is disarmed, with the reason, when there is nothing to do (already paused), when the deal is gone or its card does not offer a lapse (a hold, a closed mismatch), or when the facts are not known.
- One press sends the act once, after re-checking that what was shown still holds. The result line appears only after the wallet answers; Undo is offered while the wallet still shows something to undo. The assistant cannot propose an undo.
- An act proposal carrying any extra key, an unknown agent or an unknown deal is dropped and counted, never trimmed. A reply the validator repaired says so under the answer.
- A one-agent pause stops that agent's runs; the wallet's background passes (market watch, rescue watch, seller order step) follow pause-all only.

Dropped, and why: withdrawing an offer cannot be undone and the other side sees it; snoozing is tumbler-only; there is no command to dismiss a notice; starting agents or opening tables makes the wallet do more.

## Where it lives

- `src/windows/main/home/` the home: `Home.tsx`, the side list (`Side.tsx`, `rows/`), item pages (`ItemStage.tsx`), navigation (`nav.ts`), the opening (`greeting.ts`), the setup guide (`guide/`), the secure sheet (`secure/`). `App.tsx` holds the view switch.
- `src/windows/main/switchboard/` the board model, standing answers, panels (`Answer.tsx`), proposals and their resolver, the assistant hook, the view store.
- `src/windows/approval/bare/` the one-form secure surfaces.
- `src/lib/assistant/` the vocabulary registry, validator, digest, prompt, scripted engine, bridge client, in-app client `tauriEngine.ts` (`contract.ts` is the wire contract).
- `scripts/assistantBridge.ts` the dev-server bridge to the CLI (not in production builds; the client side is folded away by `import.meta.env.DEV`).
- In the desktop app: `assistant_ask` / `assistant_status` (`crates/table-client/src/assistant.rs`, the shell handlers in `apps/desktop/src-tauri/src/native/commands.rs`), the door and the contained turn in `crates/table-engine/src/assistant.rs` and `native.rs`. The prompt and schema the shell sends are a pinned copy, `crates/table-client/src/assistant_contract.json` (regenerate with `UPDATE_ASSISTANT_CONTRACT=1 pnpm test tauriEngine` when the vocabulary changes).
- Words: `lib/words/board.ts`, `lib/words/assistant.ts`.

## Tests that pin it

`home/**/*.test.*` (the default view and the switch; each opening; row pages and Esc; the routing rule; the approval return; the guide's turns over the first-run world; the secure sheet and the desktop fallback; navigation, rows and motion), `switchboard/*.test.*` (the board model, standing answers, resolver, the assistant hook, engine choice between the shell, the dev bridge and the scripted preview), `console/guard.test.ts` (the home, the board model and `lib/assistant` name no decision, owner or session command), `lib/assistant/*.test.ts` (registry parity, hostile replies, digest injection, scripted intents, the in-app client and the pinned prompt and schema), `lib/assistant/bridge/*.test.ts` (fake-CLI hardening cases; the live test runs only with `ASSISTANT_LIVE=1`), `lib/assistant/eval/*` (the view-choice evaluation: 40 labelled owner questions, a third of them negatives, scored through the real validator; the scripted arm runs in `pnpm test`, the live arm is `pnpm eval:board`; figures in its README). Rust: `crates/table-engine/tests/assistant.rs` (exact argv, the strict stream, the door's limits and conformance, the contained child with an offline fixture), `table-client` `assistant` and `authority` tests, `src-tauri/tests/capabilities.rs`; the live run is spike 7 (`TABLE_LIVE_ENGINES=1`).

## Known gaps

- The prompt does not teach that shows compose yet: `OPS.show` in `vocabulary.ts` still tells the model a show "replaces the current one", because the shell sends a pinned copy of the prompt (`assistant_contract.json`) that changes only with a shell rebuild. The home renders every show of a reply inline in that reply's turn, so the wording only affects how many panels the model sends. Proposed wording for after 2026-11-12: `OPS.show.about` = "Add an answer panel to the answer area. Up to 3 stay on screen; showing one that is already there just points to it; panels she pinned stay." and a prompt line "Shows add up: show only what this question needs; do not re-show what is already there."
- The board cannot answer in a sentence alone. The prompt's "Start with a show op" and "show the nearest panel" rules give a panel to every question, including the ones whose honest answer is a sentence: the first live view-choice run (2026-11-03, 40 cases) passed 70%, and all 8 of its false triggers were sentence-shaped questions that got a panel; all 4 two-panel questions got one panel (the wording above). Both rules are in the pinned prompt; relax them after 2026-11-12 and re-run `pnpm eval:board`.

- UNVERIFIED in a real Tauri webview: the in-app `claude-code` path (`assistant_ask`) is tested in Rust and in the client and ran live through the Rust path once (CLI 2.1.316), but has not been called from the desktop window itself; nor has the one CSS container query the board uses.
- In-app isolation is checked on the CLI's first output line, not before input: the CLI only lists its tools after reading its input, so the shell sends a canned question with no owner data first each session, and shuts the assistant for the session on any wrong inventory (engine-path note, "Isolation").
- Cancelling or re-asking in the app stops the page waiting, but the shell's turn runs to its own end (at most 60 s); a question meanwhile is answered by the scripted engine.
- Spend has a per-call cap and a per-minute count, but no monthly meter and nothing shown to the owner (`meters_available` is still false).
- The week mark is derived from each deal's last update, not from the history read.
- The provenance row records the consent box, not the reply that proposed it.
- The scripted engine does not propose the safe acts yet; only a live engine (or a test engine) can.
- The console has no buttons of its own for the one-agent pause or the lapse undo yet.
