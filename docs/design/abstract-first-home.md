# Abstract-first home

Status: promotion plan, 2026-11-06 (spark `abstract-first-home`, five prototype rounds, owner verdicts recorded in the spark note). It replaces the counts board ([the-proof-table.md](the-proof-table.md)) as the main window's default home. The engine path, reply contract (`{v, say, ops}`, Rust-pinned until after 2026-11-12) and safe acts ([conversational-home-safe-acts.md](conversational-home-safe-acts.md)) are unchanged.

The home always starts abstract: one status line and the first need. Everything else is one click or one question away: the module lists on the side, an item's page in the main column, the console behind them. On a new wallet the conversation leads setup one step at a time, and the secure steps never leave the window.

## What the owner chose (rounds 1-5)

| Round | Built | Owner's pick |
|---|---|---|
| 1 | zoom, greet, brief | **greet**: the conversation greets with status + first need; "the side panel is the weakest part" |
| 2 | focus, thread, stage (module lists, one row per item, own columns) | **stage**: a row turns main into the item's page; replies stay in the conversation; framer-motion |
| 3 | first-project sims: guide, tour, story | **tour**, but "too much content"; "use the AI interface to lead one component per step" |
| 4 | AI-led setup + secure step presenters: inline, sheet, popup | **sheet**; "fold agent app into practice step" |
| 5 | three turns: keys, rules, practice (agent app first, then the practice shop) | promote |

## The promoted design

**Home (default view `board`; the stored value and `?view=board` keep working).**
- Top bar: brand, mode and sample badges, Console.
- Main column: the conversation. Its first turn is composed locally from the standing answers: one status line, the away summary when she was away, and the first need as one card (review, details, all needs). Chips under it ask the next obvious questions.
- Side: one module list with a switcher (All + six modules), a title filter, and one row per item in the module's own columns (`rows/moduleLists.ts`). A row opens the item's page in main; Esc or the crumb puts the conversation back exactly as it was.
- Replies stay in the conversation (`nav.ts routeReply`): their panels render inline, a reply about one deal offers "Open <title>", filter and focus only scope the side list, one Undo puts it back.
- Motion: framer-motion with durations and curves from `design/motion.ts` only.

**First run (the guide).** While the wallet has not finished setup, the home's conversation leads it. There is one turn per step and one component per turn, with a tiny "n of 3":
1. **PayPal keys**: the secure sheet.
2. **Rules**: a plain-words proposal (per deal, per day, ask me above, the practice shop as payee). "Looks right" opens the secure sheet to sign. "Change something" reads her words with the wallet's own reader.
3. **Practice**: the agent app (one row of choices, folds to a done line), then the practice shop (join, then the four words in the secure sheet).

Then "You're set" with three pointers. After each step, at most one spotlight shows where the result now lives. A question at any time is answered in the conversation and the step is offered again under it. "Skip for now" pauses; a reload resumes from the wallet's own facts (`useStart`).

**Secure step.**
- In the browser preview, a focused sheet over the dimmed app hosts the approval side's bare surface (`approval.html?bare=keys|rules|pairing`): same session token, same gates, keys never pass through an app page.
- In the desktop app frames are blocked, so the step opens the approval window and the card waits.

## Promotion work (this change)

1. **Promote and prune.**
   - Move `front/stage` to `windows/main/home/`: `Home.tsx`, `ItemStage`, `Side`, `nav`, `greeting`, `fx`, `words`, `home.css`. Also move `front/rows` to `home/rows`, `sim/tour` to `home/guide`, and `sim/secure` to `home/secure`.
   - `App.tsx` renders `<Home/>` for the board view.
   - Delete the losing variants (zoom, greet, brief, focus, thread, guide, story), the `?home=`, `?sim=` and `?secure=` switches, the inline and popup presenters, and the secure harness.
2. **The guide is the real first run.** The home mounts the guide whenever the wallet is in setup, not only behind `?sim=`.
   - Remove the sim badge, "Leave simulation", "Try a first project" and the sample-world exit.
   - A setup proposal or setup panel from a reply re-offers the guide's current step.
   - The old setup cards in the conversation go.
3. **Retire the counts board.** Delete `Switchboard.tsx` and the parts only it used. The board's model, assistant, standing answers, panels, proposals and resolver stay; the home uses them.
   - Port the board's root-level guarantees to the home's tests: default home and view switch, no decision/owner/session command named on the page, and acts only through the consent path.
   - The page guard (`console/guard.test.ts`) must cover `home/`.
4. **Cleanups found in the rounds.**
   - `EASE` moves into `design/motion.ts`; `fx.ts` imports it.
   - `AgentStep` is exported from `setup/Charter.tsx` and reused by the guide.
   - The preview-only URL flags go (`fs_pick`, `fs_query`, `fs_ask`).
5. **Docs.** `docs/features/conversational-home.md` describes the home as it now is; `docs/build/STATUS.md` gets one entry.

Gates: client typecheck, the full client test suite (new tests pin the clock and pass under a faked Friday 19:30 and Sunday 00:30), and the client build. The director films pin `view=console` and are unaffected.

## Not in this change (follow-ups)

- **Desktop bare mode.** The desktop app keeps the approval window for secure steps; a framed bare surface there needs a Rust/CSP change.
- **Decision review in the sample-data demo.** `openDemoApproval` still replaces the tab, so the conversation is rebuilt on return. Setup steps no longer go there.
- **Other getting-started surfaces.** The console's setup and the Tumbler still follow `START_ORDER` (paypal, rules, practice, engine). Rules on a new wallet need a payee, which the guide supplies via its draft but those surfaces do not.
- **Module lists.** Book repeats other modules' deals; Counter's "Now" column mixes counts and words; badge counts use board needs, not row fates.
- **Landing on main.** The main checkout carries uncommitted work; the merge waits for the operator.
