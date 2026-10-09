# Onboarding: the getting-started steps and the tour

A new owner opens The Table to a wallet that has no PayPal keys, no signed rules, nobody connected
and the practice agent selected. Onboarding has two parts. The **getting-started steps** are four
facts the wallet checks, the same in every window. The **tour** is a few coach marks per window
that point at those steps and at the safety promise, then go away. Neither part can move money.
The steps only open the place where each thing happens, and the tour only points.

## What the owner sees

**The four steps.** "Your first safe deal in 4 steps" (the count follows the steps):

1. **Add your PayPal sandbox keys.** Done when the sandbox keys are saved (they are not checked against PayPal).
2. **Sign your agents' rules.** Done when a signed set of rules is in force.
3. **Try a practice deal with the house seller.** Done when the house seller is connected.
4. **Choose your agent app.** Done when the agents run in `claude-code` or `codex-cli`, or when the
   owner has kept the practice agent on purpose ("Keep the practice agent for now" in Settings,
   which calls `engine_select('scripted')` and sets `settings.engine_chosen`). The practice agent a
   new wallet starts on, with no choice made, never counts, and in The Table the step also stays
   to do while the chosen app is reported as not installed or not ready. An owner with no agent
   app can therefore finish all four steps; the row then reads "Practice agent kept. Add your own
   agent app any time." and never says an AI agent is connected. The Tumbler and the approval
   window do not yet pass `engine_chosen`, so there that step still reads to do.

The next step to do carries the view's one gold button. A done step is ticked. A step a window
cannot check is numbered with a dashed ring ("not checked from here"), never ticked.

| Window | Where the steps are | What a step's click does |
|---|---|---|
| The Table (`main`), Home | the hub (goal, progress, safety promise, the next step in gold, "Take the tour"), the left column (all four steps) | PayPal keys and rules open the approval window there; the practice deal opens Connections on the house seller; the agent app opens Settings, where it is chosen |
| The Table, Settings ("Getting started") | the checklist, the four steps first | the same; the agent app step's "Choose agent app…" opens the agent app picker |
| The Tumbler (first-run welcome, 440 x 228) | four one-line steps, the next one in gold beside "Later" | keys and rules open the approval window; the practice deal and the agent app open The Table |
| The approval window (owner configuration) | the answer bar (goal and promise, the next step in gold), progress, "Take the tour", the steps two by two | keys and rules happen here (a secure dialog, the rules editor); the practice deal and the agent app say "in The Table" |

**The tour.** On first run each window walks its own stops, one coach mark at a time, beside the
part it explains, with a quiet ring around that part:

| Window | Stops |
|---|---|
| The Table | Start here (the hub) · Your money stays put (the promise) · One click to each step (the list) · Your agent app (the fourth step) · Approvals have their own window (the lock button) |
| The Tumbler | Your mini window (the welcome) · It shows what needs you (the steps) · Agent app: in The Table · If you do nothing (the promise) |
| The approval window | Money decisions happen here (the answer bar) · The same steps as The Table · Agent app: in The Table · Your wallet setup (the Wallet section) |

Each mark shows "Tour · n of N", the stop's title and one or two sentences, Back, Next (Finish on
the last stop) and Skip tour. Esc skips; the arrow keys move between stops. A skipped or finished
tour does not come back by itself; "Take the tour" (Home's hub, the approval window's progress
line) walks it again from the first stop. The agent app stop drops out once an app is chosen.

## How it works

- **Facts, not clicks.** `gettingStarted(facts)` (`apps/desktop/client/src/lib/firstRun.ts`)
  turns what a window can read into steps: `settings.payment_executor_configured`, the rules in
  force (`mandate_list`, with `first_run` as the fallback), the house seller in
  `counterparty_list`, and `settings.selected_engine`. The Table also reads `engine_status`, so a
  chosen app it reports unavailable is not done. The Tumbler reads settings only, so it cannot
  tell the practice step.
- **Why the agent app is last.** The practice deal runs on the practice agent, so nothing before
  it waits on an app. It is also the one step that needs something installed outside the wallet.
- **The tour is data.** `lib/tour.ts` lists every stop (id, window, `data-tour` anchor, words from
  `TOUR_STOP` in `lib/words.ts`). `tourView` picks the stop to show from the window's stops, the
  saved progress, whether the getting-started path is showing, and which anchors are on screen. A
  stop whose anchor is missing (or inside a hidden part of the page) is passed over.
- **Progress** is saved per window in `localStorage` under `table-tour`. The `?first_run=1`
  preview uses `table-tour:first-run` (`lib/preview.ts`, the same world keys as the mock). Storage
  that is missing or throws falls back to memory, so the tour still works for the session.
- **On screen.** `shared/tour.tsx` places the mark with `getBoundingClientRect` and React's style
  prop (the CSP allows CSSOM, not inline style strings). It re-places it on resize and scroll and
  keeps it inside the viewport. It is a labelled, non-modal dialog. Focus moves into it only while
  the window already has focus, so the Tumbler never takes the keyboard from another app, and goes
  back afterwards. The mark waits while a sheet, popover or confirm is open, and in The Table until
  the dial's intro has settled.

## What onboarding never does

- It never clicks, signs, saves or pays. No new or changed IPC command: the privileged steps open
  the approval window through `approval_open` exactly as before, and the owner decides there.
- It never shows a step as done that a window could not check, and the practice agent never counts
  as a chosen agent app.
- It never names internals or a vendor's product on screen (tested). It carries no gold button of
  its own, so a view keeps exactly one.
- It never starts again by itself once skipped or finished.

## Watch it

The director plays the onboarding with no install: `pnpm --dir apps/desktop/client dev`, then
open `/director.html?story=first-run` ("First run", 94 s, five chapters). Its three frames, and the
page's own mock core, open in the `?first_run=1` world, so the sample week stays as it was:

1. **Day one.** Home on a brand-new wallet: the four steps, PayPal next, the agent app to do on
   the practice agent.
2. **The Table.** The mark walks Home's five stops: the hub, the promise, the step list, the agent
   app step, the way to the approval window.
3. **The Tumbler.** Its first-run welcome opens and the mark walks its four stops.
4. **The approval window.** It opens on the owner's setup and the mark walks its four stops.
5. **Ready for a first deal.** Each window's tour is put away; Home shows the four steps.

The director never clicks inside a window and never presses Next, Back or Skip. A beat's
`{ do: 'tour', win, at }` writes that window's saved progress under `table-tour:first-run`, and
the framed window's coach mark follows the write (`storage` event, `shared/tour.tsx`). No beat
signs, saves, pays or locks (`src/director/firstRunStory.test.ts`). The rehearsal checks each
beat's end state, including the stop each window's mark shows:
`pnpm --dir apps/desktop/client takes --check --story first-run` (Playwright needed; see
`src/director/README.md`). Maya's week (`/director.html`) is unchanged.

## Where it lives

| Part | Path |
|---|---|
| Steps model and words | `apps/desktop/client/src/lib/firstRun.ts`, `lib/words.ts` (`START_STEP`, `FIRST_RUN_TITLE`, `SAFETY_PROMISE`) |
| Tour model and words | `lib/tour.ts`, `lib/preview.ts`, `lib/words.ts` (`TOUR_STOP`, `TOUR`, `tourCount`) |
| Steps list and progress | `shared/start.tsx`, `shared/start.css` |
| Coach mark, "Take the tour" | `shared/tour.tsx`, `shared/tour.css` |
| The Table | `windows/main/home/Start.tsx`, `windows/main/Home.tsx`, `windows/main/setup/CircuitView.tsx` |
| The Tumbler | `windows/tumbler/forms.tsx` (`FirstRunWelcome`), `windows/tumbler/Tumbler.tsx` |
| The approval window | `windows/approval/OwnerConfig.tsx` |
| Preview world | `mock/firstRun.ts` (`?first_run=1`, `selected_engine: 'scripted'`) |
| Director story | `director/firstRunStory.ts`, `director/stories.ts`, `director/actions.ts` (`tour`, `owner`), `director/takes.ts` (`FIRST_RUN_EXPECT`) |

## Tests

- `lib/firstRun.test.ts`: the fresh-wallet order (four steps, PayPal next, the agent app last); the
  agent app done on `claude-code` / `codex-cli`, to do on the practice agent or when reported
  unavailable, unknown while settings are unread; per-window facts; the `?first_run=1` world (four
  steps, the agent app to do on the practice agent); the words.
- `shared/start.test.tsx`: the list ticks, marks next and offers one quiet click; "in The Table"
  instead of a button; the agent app step to do, done and unknown.
- `lib/tour.test.ts`: the stop order per window; the start on a fresh wallet; Next, Back, Finish;
  skip and finish persist; reopening; storage that throws; a missing anchor is passed over; no
  tour string names internals or a vendor.
- `shared/tour.test.tsx`: a stop shows as a labelled dialog with no gold button; Next, Back and
  the arrow keys move; Finish and Skip (and Esc) end it for good; focus returns; "Take the tour"
  reopens; an absent or hidden anchor is never shown; it waits under a layer and does not take the
  keyboard from an unfocused window; placement stays inside the viewport; contrast in both themes;
  a `storage` write to the window's own key moves the mark, any other key does not.
- `director/firstRunStory.test.ts`, `director/stories.test.ts`, `director/takes.test.ts`: the
  story's stops are each window's, in order, all walked; no world, money or lock action; only the
  first-run tour key is written; the beat file's timing and words; every beat's end state.

## Known gaps

- The director's First run story has been played: STATUS "Played (slice 3, 2026-10-09)", First run 15 of 15.
- Not seen in the running app: the coach mark over the Tumbler's transparent, always-on-top window
  (whether clicks reach it outside the welcome form) and its look at 440 x 228 were checked only
  by the placement tests, never by eye.
- The Tumbler's agent app step opens The Table's Home, not Settings directly: `main_open` takes a
  deal id only (no IPC change in this slice), so Home's gold button takes the last step from there.
