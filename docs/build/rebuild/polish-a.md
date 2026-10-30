# Polish wave, builder A: open items and the staggered reveal (notes for the Director)

Scope: `windows/main/console/**` (not the footer), `shared/tour*`, `lib/words/**` (appended),
`windows/approval/OwnerConfig.tsx` (one copy fix), `director/**`. No Rust, `bindings/`, `crates/`,
authority, capability or mock change by me. No dependency added. Nothing committed.
`git diff --stat c4bbe5b -- crates bindings apps/desktop/src-tauri` is NOT empty, but the one file
there is `apps/desktop/src-tauri/icons/icon.ico`, builder C's logo work, not mine.

## 1. Open items

| Item | What I did |
|---|---|
| "Your first safe deal in 4 steps" (approval) against five charter lines | New `APPROVAL_FIRST_RUN` (`lib/words/approval.ts`): "Your wallet’s charter: the lines to your first safe deal" (plus its hidden heading). It uses the charter's own title and no number, because the page shows four steps plus its lock card, so any count would be wrong. `FIRST_RUN_TITLE` is unchanged: the Tumbler still uses it with its own four-step list, and it is not a Rust copy. `OwnerConfig.tsx` uses the new words. `takes.ts` now expects them in the approval frame. Test: `lib/words/approval.test.ts`. |
| The tour's coach mark covered the "Preview · sample data" badge at 1280x800 | `placeMark` in `shared/tour.tsx` takes boxes to keep clear: `KEEP_CLEAR` = `.badge, .ui-btn.gold, .ui-btn.primary, [data-tour-clear]`, read by `keepClearBoxes`, skipping the mark itself. It tries below, above, right, left, then the four corners, takes the first spot that covers nothing, else the spot that covers least. With no boxes the old behaviour is kept exactly, so the old tests pass unchanged. Browser check, `?first_run=1`, dark and light, at 1280x800, 1920x1080 and 1100x760, every stop: the mark covers no badge and no gold or primary button. Bounding-box test in `shared/tour.test.tsx` using the boxes measured at 1280x800. |
| Deal crumbs cut at 1280 px | New `console/CrumbTrail.tsx` replaces the shared `Crumbs` in `Console.tsx` only. Fold levels: everything, then first + "…" + last two, then "…" + last two, then "…" + last. It folds until nothing is cut; from level 2 on, only the current crumb has to stay whole. "…" carries the whole path in its title (`CRUMBS_MORE`), and a click opens a small menu (Popover) of the folded layers. Escape closes the menu first. The current crumb never shrinks and has a 36ch cap. Measured (Spend > Needs you > deal > Who): 1280 px gives "… › Wide-format printer A… › Who you deal with"; 1100 px gives "… › Who you deal with"; 1920 px gives first + "…" + last two. Back is always visible. Test: `console/crumbTrail.test.tsx`. This also fixes wp3c open item 8 (the first-run Connections crumbs). |
| No Rewind or module-summary beat in Maya's week | `silence-tables` (78 s, `#m=tables`, "The Tables summary: what is open and what has ended.") and `end-rewind` (155 s, `#r=rewind`). Both fit gaps the reading-time rule already allowed: 24 beats, still 182 s, no other beat changed. Deliberate test changes: `stories.test.ts` re-pinned to 24 beats / 182 s (comment says why); `beats.test.ts` route pattern widened to accept `#r=rewind`; `takes.ts` gets EXPECT entries (card labels; the kicker and the tape title are upper-cased on screen, so they cannot be matched as text). `takes --check`: all 24 beats pass; `--story first-run`: all 15 pass. |
| Small defects | The cards' fill rule now lives once in `framework.css` (`.ml:not(.ml-view) .ml-cards`), with the copies removed from book/rescue/shield/tables css (wp3a item 3). The director's approval frame bar now reads `APPROVAL_FRAME.strip` ("the one place money is approved") instead of "only here can money be agreed" (wp4c item 5). |
| Native-only, checked statically | The main window's mutations are the same as before (no new `useMutation`). The docked hand-off and the lock still go through `approval_open` only; `console/guard.test.ts` passes. |

Left open (product decisions, or files I don't own): wp4a 1-6, wp3a 1/2/4/5, wp3b 2-4, wp3c 1-6.
`lib/lazy.ts`'s comment naming `./modules/book` (wp3b 5) is in `lib/`, outside my words-only scope.
A `tabbable` prop on `ModuleTab` (wp4a 4) would be in `shared/ui`, also not mine.

## 2. The staggered reveal

`console/stagger.tsx`:
- `<Stagger>` gives each layer one scheduler. `LayerHost` mounts it inside the layer's Suspense, keyed by sheet.
- `<Reveal wave priority skeleton sizeKey>`, `useRevealed(wave)`, `Skeleton`, and `StaggerProvider` (in `Console.tsx`, outside the keyed sheet). The provider cancels an older layer's pending waves when a new layer starts.
- Waves:
  - 0: frame, answer, Your call and its action
  - 1: cards, or an open view's body
  - 2: Latest strip, list shell, picked-row pane
  - 3: explanation, key art, Rewind hub, evidence parts
- Scheduling:
  - The first slot waits a whole frame, so wave 0 paints alone.
  - Each wave gets its own `requestAnimationFrame`. Wave 3 uses `requestIdleCallback` with a timeout; where there is none, a timer.
  - The gap between waves is `DUR.instant`.
  - A slot does at most `SLOT_MS` = 12 ms of reveals, each one a `flushSync` of that Reveal alone. A longer wave carries on in the next frame.
- A later-wave part that mounts within `OPENING_MS` (1.2 s, so a cold read is covered) still waits its turn. After that, a newly mounted part shows at once.
- Cancel on unmount: nothing shows and no state is set afterwards.
- Calm (OS reduced motion or the in-app switch) and the test switch `staggerOff()` mount every wave in the first frame with no fade. Calm switched on mid-sequence shows the rest at once.
- Dev builds only: `performance.mark('layer:wave0..3')`.
- `staggerOff` is the default under vitest (`import.meta.env.MODE === 'test'`), so existing tests behave as before. `perf`, `a11y` and `resilience` tests also call it explicitly in `beforeAll`.

Wrappers are `display: contents`, so flex gaps and grids are unchanged. Two CSS selectors that used `>` were adjusted (`.cs-waiting .lt`, the cards fill rule). `Latest`'s room measurement now sees through the wrappers (`heightAfter`).

Skeletons take the part's own layout class (`ml-cards` with `ui-sumcard` blocks, `pf-cards`, `lt`, `ml-explain`, `ml-art`, `tr-pane`, `rw-host`). The fill is `--line2`, with shimmer only when motion is allowed. Each part's height is remembered per window size by a ResizeObserver, which forces no layout. The next skeleton takes exactly that room, and the Latest skeleton draws as many rows as last time. Areas can pass a `rowGuess` (Spend 80, Counter 78; the default is 60).

Where it applies:
- ModuleLayer: summary and views, so all six modules and the Book views.
- PlaceFrame: Rules, Wallet limits, Connections, Pairing, Settings, Safety, Rewind, the deal page.
- ListEngine's detail pane and `SplitView`'s pane (Rescue, Shield, Tables, Spend, Counter, Book ledger).
- Centre: the stack row at wave 1, the bead strip at wave 2. The decision and the seal stay at wave 0.
- Waiting: the waiting list is wave 0, "decided lately" wave 2.
- Rewind: hub and scrubber at wave 3. The Scrubber chunk loads only then.
- Deal page: "What you were shown" is wave 3, together with its `deal_history` read. The deal's sheets are wave 0.

Reads (`stagger.test.tsx`):
- An ended deal reads no `deal_history` in waves 0-2, then reads it once. This is a later-wave read deferred.
- The six module summaries issue exactly the same reads at wave 0 as after the whole reveal. Each read they make feeds their answer or their cards, so there is no later-wave read to defer and the count is not lower. Getting fewer reads at wave 0-1 would mean splitting the areas' top-level reads into parts. I did not do that; tell me if you want it.

Stagger tests (`console/stagger.test.tsx`, 23):
- wave order and priority
- the first frame paints wave 0 alone
- slot splitting
- unmount cancel, with no console error
- a new layer cancelling an old one
- calm, reduced motion, calm switched on mid-sequence
- the test switch
- opening window versus settled
- for each of the 6 modules on both scales (12 cases): Your call, every gold button and the action are present in wave 0 and unchanged after the reveal, and the cards wait for wave 1. The Book is exempt from the "needs card ⇒ Your call" check, because it never had a Your call (its waiting card is an outlook).
- the deal read above

Test-only helper: `console/testing/manualClock.ts`.

## 3. Measurements

Browser, `?scale=large`, mock at 40 ms per call, 1280x800, headless Chromium on the vite dev server. Each layer is switched to by hash from a warm centre, median of 5 runs. Script: `scratchpad/pa_perf.py`.
- Before = HEAD 84cfa96, served from a `git archive` copy on its own port.
- After = this tree.
- Answer = the first frame in which the new layer's heading has text.
- Full = the last DOM change in the stage before 700 ms of quiet. Before the change the layer was one render, so its "full" includes late reads; after, full includes the reveal.
- Long = tasks over 50 ms (PerformanceObserver).
- Nodes@0 = DOM nodes in the layer at the answer frame.

| Layer | answer before / after (ms) | full before / after | long tasks (max ms) before / after | nodes@0 before / after |
|---|---|---|---|---|
| Tables | 90 / 69 | 143 / 332 | 1 (91) / 1 (71) | 143 / 33 |
| Spend | 66 / 60 | 65 / 396 | 2 (77) / 3 (127) | 132 / 32 |
| Counter | 90 / 68 | 86 / 333 | 2 (86) / 1 (68) | 163 / 32 |
| Book | 54 / 46 | 54 / 286 | 1 (54) / 1 (52) | 135 / 30 |
| Shield | 83 / 61 | 83 / 371 | 1 (83) / 2 (64) | 134 / 36 |
| Rescue | 48 / 41 | 107 / 331 | 0 / 0 | 125 / 36 |
| Book ledger | 117 / 45 | 112 / 214 | 2 (112) / 1 (86) | 288 / 14 |
| Waiting | 62 / 50 | 62 / 50 | 2 (95) / 2 (84) | 181 / 181 (the list is wave 0) |
| Rewind | 48 / 39 | 694 / 798 | 4 (268) / 4 (159) | 30 / 16 |
| Rules | 91 / 60 | 91 / 429 | 1 (91) / 3 (115) | 175 / 20 |
| Connections | 123 / 59 | 82 / 189 | 2 (82) / 1 (59) | 206 / 17 |
| Settings | 67 / 53 | 146 / 337 | 2 (68) / 1 (99) | 188 / 35 |
| Safety | 28 / 29 | 91 / 210 | 0 / 0 | 9 / 9 |
| A deal | 97 / 89 | 309 / 258 | 1 (97) / 1 (101) | 134 / 90 |

What the table shows:
- Every layer's answer is now under 100 ms, against 30-123 ms before.
- The full reveal finishes in 189-429 ms. Wave-3 marks come at 181-455 ms.
- The exception is the Rewind (about 800 ms). It is bound by its data: before, it was 694 ms with a 268 ms task. Its cards wait for the week's record.
- The longest task fell on 9 of 14 layers.
- The machine was shared with two other builders running vitest. Runs scatter by ±30-60 ms, and one earlier run had spend at 153 ms, before I removed a forced layout from the skeletons.

A Chrome trace of a warm Spend switch shows the longest task drop from 57-75 ms to 41 ms. Total main-thread work stays about the same (130 vs 150 ms), because every wave pays its own style recalculation.

Layout shift (Layout Instability API, `scratchpad/pa_shift.py`): CLS and largest move are identical to before on every layer (0.0008-0.004; 12 px, a move the baseline also has). The Rewind improved from 0.04 / 697 px before to 0.0056 / 39 px on a second visit; its first visit is 0.15, as it was before.

Skeleton against final part height:
- On a revisit (remembered sizes), within 1-3 px for cards, strips, explanations and art, and 5-7 px for the Rewind hub and the ledger. The Rules list is 29 px off.
- On the first visit: cards within 12-40 px (they flex-grow), the Latest strip within 11-16 px. Content blocks are only estimated (6rem against 180-736 px).

## 4. Screenshots read

These are in `scratchpad/`:
- Mid-reveal at 60/150/300 ms and final, for Spend (`pa-shots1/`) and for Book, Settings, Rewind and Waiting (`pa-shots2/`).
- Tour stops at 1280 (`pa-tour-1280-*.png`).
- Crumbs at 1280, 1100 and 1920, plus the "…" menu (`pa-crumbs-*.png`), and the bar on the charter, a module view, pairing and the centre (`pa-bar-*.png`).
- Takes stills, dark and light (`pa-stills/`, among them `10-silence-tables` and `21-end-rewind`), and First run dark (`pa-stills-fr/`, among them `01-table-hub` and `10-approval-only`).

Fixed after reading them:
- Skeleton blocks were nearly invisible on dark: now 55 % `--line2`.
- A single crumb was cut by a percentage `max-width`.
- The Latest skeleton's row height was too small for Spend and Counter (`rowGuess`).

## 5. Gates

- `pnpm typecheck`: clean.
- `pnpm exec vitest run --reporter=dot`: 148 files, 1,560 tests, all passed. The output is in `scratchpad/pa-full2.txt`; the count includes the other builders' in-flight tests.
- The perf test's burst bound (≤ 5 ledger reads) failed once in a loaded run (rewind 7, rules 6) and passed alone, as wp4c already noted for that test.
- A "flushSync was called from inside a lifecycle method" warning from the virtualizer shows in ListEngine tests during full runs. The base copy shows it too (13 times), so it is not new.
- `pnpm build`: built.
- `takes --check`: 24 of 24; `takes --check --story first-run`: 15 of 15.

## 6. Questions

1. Module summaries cannot read less in waves 0-1 without splitting each area's top-level reads into parts (Spend's rules, Tables' groups, Book's rescue book). Want that, or is the lazy mount enough?
2. Is `OPENING_MS` = 1.2 s right? A part that mounts later than that shows at once with no stagger.
3. A first-visit skeleton for a list or content block is a 6rem estimate. Pre-seed sizes per area, or is "exact from the second visit on" enough?
4. Builder B moved the footer to `Footer.tsx` while I was editing `Console.tsx` (crumbs, `StaggerProvider`). Both sets of changes are in the file now; please look at it once when you merge.

## 7. Files

New:
- `console/stagger.tsx`, `console/stagger.test.tsx`
- `console/CrumbTrail.tsx`, `console/crumbTrail.test.tsx`
- `console/testing/manualClock.ts`
- `lib/words/approval.test.ts`
- this note

Changed:
- `console/Console.tsx` (crumbs, provider), `layers.tsx`, `ModuleLayer.tsx`, `Latest.tsx`, `ListEngine.tsx`, `Centre.tsx`, `Waiting.tsx`
- `console/framework.css`, `console/console.css`
- `console/perf.test.tsx`, `console/a11y.test.tsx`, `console/resilience.test.tsx` (`staggerOff`)
- `areas/settings/frame.tsx`, `areas/deal/DealPage.tsx`, `areas/rewind/RewindLayer.tsx`, `areas/tables/parts.tsx`, `areas/spend/SpendLayer.tsx`, `areas/counter/CounterLayer.tsx`
- `areas/{book,rescue,shield,tables}.css`
- `shared/tour.tsx`, `shared/tour.test.tsx`
- `lib/words/{approval,framework}.ts`
- `windows/approval/OwnerConfig.tsx`
- `director/{beats.ts, takes.ts, Director.tsx, beats.test.ts, stories.test.ts}`
