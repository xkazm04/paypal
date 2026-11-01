# Conversational home: migration project

Status: in build on branch `worktree-spark-conversational-home` (not merged). Owner: spark `conversational-home`.
Chosen design: contest `conversational-home-r2`, variant "The Switchboard" (matrix of six modules by four fates, an instrument strip of money gauges, a chat rail). Prototype source: `.contest/arena/conversational-home-r2/judging/entries/A/variant-1/` (gitignored; the builders read it, nothing imports it).
Companion note on MCP: `conversational-home.md` (same folder).

## What ships

A second view of the main window, "the board", beside the existing console. One page, full window:

1. **Instrument strip.** Room left today against the signed daily cap, deals today against the cap, held (at PayPal and before PayPal), PayPal-confirmed totals, records state.
2. **The switchboard.** Rows are the six modules (module colour token and engraved glyph, never reused for anything else). Columns are what is happening to the money: needs you, moving by itself, stopped, paid. Every deal is one key in its cell, with the shape-and-word status, amount and time left. A per-row week mark.
3. **The chat rail with an answer area.** The owner asks; the assistant answers in panels from a closed vocabulary and may light up or dim parts of the board. The board never disappears.
4. **Day one.** A brand-new wallet shows the four setup steps as the answer panel, with the board empty and honest about it.
5. **Decisions.** Clicking a key opens the decision behind it in the answer area. The gold button is a hand-off to the approval window (`approval_open`). Nothing is approved on this page.

## The assistant: two engines behind one door

| Engine | Where it runs | Status |
|---|---|---|
| `scripted` | in the client, canned intents over the digest | always available, the fallback |
| `claude-code` | the `claude` CLI, headless, no tools, one turn | dev bridge in the Vite dev server (browser on the mock world) in this project; the in-app path is designed, not built (`conversational-home-engine-path.md`) |

Every reply, from either engine, passes `validateReply` (`lib/assistant/validate.ts`) before the board sees it. Replies are proposals: rendering never executes. The model is given a digest with no counterparty free text and no tools.

## Safety invariants (tests enforce them)

- The board and assistant code never name a command of the decision or owner tier; `windows/main/console/guard.test.ts` style check extended to `windows/main/switchboard` and `lib/assistant`.
- Actions are an allowlist (`open_decision`, `open_setup`, `open_console`), resolved host-side; the consent surface shows the resolved action. No action moves money or signs.
- A damaged reply is repaired and DISCLOSED ("2 parts could not be shown"), never silently trimmed; if nothing survives the board shows the plain `say` text.
- The scripted engine is labelled "Scripted preview, not a live model"; the claude-code engine is labelled `claude-code`. No other model or vendor name appears (PayPal and engine ids only).
- Colour meaning is fixed: module colour identifies a module only; gold = needs you (one gold button per view); status is also a word and a shape.
- Silence never moves money: every needs-you key states what happens if the owner does nothing.
- A client test that renders mock-world time pins the clock (repo law).

## Work packages

| WP | Scope (exclusive file ownership) | Depends on |
|---|---|---|
| D0 (Director) | this doc; `lib/assistant/contract.ts` + stubs; `lib/words/{board,assistant}.ts` stubs and their re-exports; `switchboard/Switchboard.tsx` stub | none (committed first) |
| WP1 board UI | `windows/main/switchboard/**`, `lib/words/board.ts`, `windows/main/App.tsx`, one entry button in `console/Console.tsx` top bar | D0 stubs |
| WP2 assistant core | `lib/assistant/**` (except `contract.ts`), `lib/words/assistant.ts` | D0 stubs |
| WP3 claude-code bridge | `scripts/assistantBridge.ts`, `vite.config.ts` (registration only), `docs/design/conversational-home-engine-path.md` | D0 stubs, WP2 prompt (imports `systemPrompt`, `replyJsonSchema`) |
| Integration (Director) | live smoke through the real CLI, screenshots, feature doc `docs/features/conversational-home.md`, context-map / registry notes | WP1-3 |

## Gates

always: `pnpm --dir apps/desktop/client typecheck` and `test`. When the board mounts: `build`. Baseline at fork (93a5f6e4): typecheck clean, 241 files / 2516 tests green.

## Not in this project (decisions for the owner)

- Making the board the default view. It ships opt-in (`?view=board`, a remembered choice, a button in the console top bar).
- The in-app (Tauri) claude-code path: needs a new `read`-tier `assistant_ask` command with an authority-table row and `PINNED_MANIFEST` update, the engine isolation conformance spike (claude-code is `available: false` today), key handling in Rust and a budget meter. Designed in the engine-path note.
- Safe acts from chat (withdraw, let lapse, pause agents): v1 has none; they would be consent-gated `act`-tier actions.
- Merging to `main`.
