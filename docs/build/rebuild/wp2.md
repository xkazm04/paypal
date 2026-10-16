# WP2 - Console shell, decision centre, approval hand-off, Charter (notes for the Director)

Scope: `apps/desktop/client/src/windows/main/**` (new `console/`, `setup/Charter.tsx`), `lib/words.ts`
(append only). No Rust, `bindings/`, `crates/`, `src-tauri/`, authority, capability or mock change:
`git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri` is empty. No dependency added.
The six module pages, `DealView`, the Sheet (Settings / Connections / Agent rules), the Safety sheet
and the Quit sheet are the old code, mounted inside the new frame and restyled by tokens only.

## Route table (`logic.ts` parseHash / formatHash; every older form still parses, tested)

| Hash | Layer | Depth | Parent |
|---|---|---|---|
| `` (none) or `#c=centre` | decision centre (or the Charter on a brand-new wallet) | 1 | - |
| `#w=waiting[&f=<module>]` | everything waiting (optionally one module) | 2 | centre |
| `#r=rewind` | Rewind | 2 | centre |
| `#s=setup&step=<keys\|rules\|practice\|agent\|unlock>` | Charter as a layer | 2 | centre |
| `#m=<module>` | module summary | 2 | centre |
| `#m=<module>&v=<view>` | module detail view (unknown view = summary) | 3 | the module |
| `#d=<id or label>` | deal | 3 | the deal's module (centre if unknown) |
| `#d=<id>&m=<module>[&v=<view>]` | deal opened from a module page | 3 / 4 | that module page |
| `&s=settings\|pairing\|mandates` | the Sheet over any layer | - | (an overlay) |
| `&p=safety` | the Safety sheet over any layer | - | (an overlay) |

`main:route` (Tumbler) opens the deal or the centre; the Tumbler's `table.setup-intent` note is taken
after `SETUP_INTENT_SETTLE_MS` (250 ms, the old behaviour, now named) and opens `#s=setup&step=`.

## Layer / depth chain and keys (`console/route.ts`, `console/Console.tsx`)
- Chain, depth (1-4), parent, direction and the lit module tab are derived from the route only.
- Esc: Find > any sheet / popover (the shared layer stack closes them in the capture phase) > one
  layer up. At the centre Esc does nothing (never leaves the app). A filled input keeps its Esc.
- Back button and crumbs walk the same chain; the crumb just above is identical to Back.
- Browser Back/forward: every move is a history entry with the console's index in `history.state`;
  Back (Esc / button) calls `history.back()` when the previous entry is the parent, so the browser's
  own Back/forward walk the same chain; `popstate`/`hashchange` settle the route (links that set the
  hash, e.g. the Sheet's "Your wallet's charter", are absorbed as one entry).
- Focus: going deeper focuses the new layer's heading (`[data-layer-title]`, else its h1); going up
  restores the control that opened the child (`data-card`, `data-fk`, or id) and the layer's scroll
  (`console/memory.ts`, retries up to 20 frames for a lazy page). Runs as a passive effect so a
  closing Find has returned its focus first.
- Keys: `/` and Ctrl K Find, `?` shortcuts, 1-6 modules, Left/Right walk the centre's queue
  (ignored while typing, inside the tab strip, or with any layer open).
- Motion: `data-dir` into/out/swap keyframes on `--dur-sheet/--dur-slow/--dur-med`; reduced motion and
  the in-app calm switch (footer, `localStorage['table-calm']`, `console/calm.ts`) crossfade only.

## What was built
- `console/Console.tsx`: the frame. Top bar (Mark + "The Table" -> centre, Back, crumbs with depth
  bars, gold "N need you" pill -> waiting, Rewind, Rules, Connections, Settings, Find `/`, the lock
  button that only calls `approval_open {deal_id:null}` when locked, `data-tour="approval-way"`), the
  stale banner, the `Stack` with the six `ModuleTab`s on its top edge (counts via `formatCount`, 99+,
  gold waiting badges with screen-reader words) and the presence line, a corner `Seal` on every layer
  below the centre, the inspector column modules portal into, and the footer (mode badge and preview
  badge exactly as `ModeBadge`/`MockBadge` render them, engine/agents chips, today's two meters, the
  safe-default line "Waiting never pays · nothing moves without you", mini-window state, calm motion,
  theme, `?`, clock). Per-layer `ErrorBoundary` keyed by the route. Toasts on `receipt:created` as before.
- `console/Centre.tsx` + `centreModel.ts`: one decision at a time in Rust's order (`sortItems` from the
  Tumbler's logic, reused, not reimplemented), "Later" moves to the back of a local order only, Left/Right
  and pagers cycle. Kicker, display sentence with the amount (`splitHeadline`), who and what, the
  "If you do nothing" line (the World's `silenceWords`; an ended money check has no frame, DECISIONS 32),
  ONE gold action (`reviewVerb`; it calls only `useMutation('approval_open')` with `{deal_id}`, lock
  glyph and the locked title from `useLocked()`, disabled while pending, `WalletNotice` on error; an
  item without `review` opens the deal instead), Later, Open the deal, Why? (the old Details facts as a
  disclosure). Facts strip (amount and with whom, money now, why it asks you + time left; 2-line clamp).
  Seal state from the facts (`presenceOf`: quiet / watching / needs / holding / paid / stopped; paid only
  after a `receipt:created` that PayPal confirmed, for one toast's time) with the deadline arc when the
  deal's start is known. `BeadStrip`: the small Dial as presence (liveLook tones, needs first, 8 per
  module + n), each bead opens its deal. "Next in the stack" shows 2/4/6 cards by width; free slots
  show "While you were away" lines (`home/useAway.ts`, its `deal_evidence` cap kept) then "Watching"
  cards (live deals that ask nothing). Empty centre: one calm line plus what the wallet watches.
- `console/Waiting.tsx`: windowed list (`useWindowedRows`, fixed 76 px rows), module filter chips with
  counts, each row's "If you do nothing" head; a row opens that decision in the centre.
- `console/Find.tsx` + `findIndex.ts`: index built once per change of needs/deals/names (memoised),
  one substring pass per keystroke, the old palette's order (needs first, then modules, deals, places),
  cap 40, `paletteCopy.noMatch` kept; `role=dialog`, combobox + listbox with `aria-activedescendant`,
  Tab trapped, the console is `inert` while Find is open.
- `console/RewindLayer.tsx`: hosts the existing Rewind clock/scrubber/narration (`#r=rewind`, opens at a
  moment from an away line). `rewind.css` re-scoped from `.home` to `.rw-host` (it defines the `--d-*`
  materials home.css used to set).
- `console/StaleBanner.tsx`: `useStaleBanner()`; "Try again" refetches the failed World reads and any
  errored query (deal names), nothing else.
- `setup/Charter.tsx` (replaces SetupPage): five numbered lines (I-V) with state, the current line's
  explanation and one action; keys/rules/unlock hand off via `Handoff` with the same targets
  (`credentials`/`mandate`/`unlock`); waiting, "Not finished yet" + Reopen on focus return
  (`FOCUS_RECHECK_MS` 600, the old value, now named); practice = `PairingDesk`, agent = `engine_select`
  picker, both still in Main; moves on by itself when its line turns done. On a brand-new wallet it is
  the first layer (with the tour and its `data-tour` anchors); "Skip: open the sample wallet" only in
  the browser preview; reachable from Find and from Settings ("Your wallet's charter" in the Sheet head).
- `setup/start.ts`: `useStart`, `setupHash`, `useSetupIntent` (moved from home/Start.tsx).

## Deleted
`Home.tsx`, `Dial.tsx`, `home.css`, `Shell.tsx`, `shell.css` (its lock, meter and shortcuts rules moved
to `console/console.css`), `Palette.tsx` (`palette.css` moved to `console/find.css`), `home/Start.tsx`
(+ test), `home/AwayCard.tsx` (+ test; the hook is `home/useAway.ts`), `setup/SetupPage.tsx` (+ test,
`setup-page.css`); the Dial's bezel/rotor/hub markup in `art.ts` (medallions and lock glyph kept).
Kept: `logic.ts` Dial geometry and its tests (pure, still tested), `home/model.ts`, `home/away.ts`,
`beadLook.ts`, `Status.tsx`, `Rewind*.tsx`.

## Words added (`lib/words.ts`, append only)
CENTRE_TITLE, WAITING_TITLE, REWIND_TITLE, PLACE, PLACE_TITLE, BRAND_NAME, BRAND_TITLE, BACK_TITLE,
CRUMBS_LABEL, PLACES_LABEL, TABS_LABEL, needPill, needPillLabel, SAFE_DEFAULT_LINE, tabWaiting,
tabTitle, DECISION_OF, decisionOfLabel, PREV_DECISION, NEXT_DECISION, NO_DEADLINE, NO_COUNTERPARTY,
IF_NOTHING, LATER, LATER_TITLE, LATER_TOAST, LATER_ALONE, OPEN_THE_DEAL, WHY, APPROVAL_OPEN_TITLE,
APPROVAL_LOCKED_TITLE, FACT, factWith, yourRule, NEXT_IN_STACK, NOTHING_ELSE_WAITS, allWaiting,
AWAY_KICKER, watchingKicker, SEE_REWIND, CENTRE_EMPTY, watchingLine, OPEN_BOOK, CENTRE_READING,
SEAL_WORD, SEAL_LINE, sealLabel, SEAL_RING, stripLabel, WAITING_KICKER, waitingTitle, WAITING_EMPTY,
WAITING_FILTER, EVERY_MODULE, waitingShown, FIND_*, DEAL_CRUMB, DEAL_UNREAD, DEAL_GONE, LOCK,
MINI_WINDOW, METERS, CALM, SHORTCUTS_LABEL, CHARTER_* (TITLE, NUMERAL, charterLine, IN_APPROVAL,
SEALED, MEANS_TITLE, charterDone, MEANS_APPROVAL, SKIP, SKIP_TITLE, OPEN, STATE). Lock, mini-window,
meter and deal-gone strings are the old inline strings, moved, byte-identical.

## Tests (all behavioural)
- `console/route.test.ts` (old links, new forms round-trip, depth 1-4, parents, direction, lit tab).
- `console/centreModel.test.ts` (queue order and Later, seal from facts per need kind, deadline arc,
  facts in plain words for every need in the default, small and large worlds, slots).
- `console/findIndex.test.ts` (rank order, hidden label, cap, prebuilt text).
- `console/guard.test.ts` (source-level: no release command called or, when it has an underscore,
  named anywhere under windows/main, list from `@bindings/authority`; the centre's only mutation is
  `approval_open`).
- `console/calm.test.ts`.
- `console/console.test.tsx` (App on the mock): every decision's silence line in all three worlds;
  the gold action calls only `approval_open {deal_id}` and nothing non-read, the centre claims no
  outcome; no command outside Main's rows and no release command while used; locked lock + title +
  disabled while pending; stale banner words and Try again; no raw enum/id text on centre and waiting at
  scale; 500-deal read budget (world reads once, displays <= 500, <= 8 in flight); Escape up + focus
  back to the opener; Find closes first, `inert`, `aria-activedescendant`; Back button and browser
  Back; Find opens a deal one layer below the module it was found from; `#m=`, `#d=`, `#s=setup`;
  `main:route`; first run shows the Charter; the stack row's fill cards.
- `setup/Charter.test.tsx` (five lines, hand-off targets, waiting / not finished / Reopen, auto-advance,
  signed-on-arrival offers Done).
- `Shortcuts.test.tsx` kept (keys list updated). `viewNav.test.tsx`, `logic.test.ts` kept unchanged.

Gates: `pnpm typecheck` clean; `pnpm exec vitest run`: 121 files, 1271 tests passed (start of WP2:
117 / 1227; 3 markup tests removed with their views, 7 files added).

## Screenshots (scratchpad `wp2-shots/`, all read)
Centre small/large x dark/light x 1280x800/1920x1080; waiting (large, dark 1280, light 1920); Find
(dark, light); Charter first run (dark 1280, light 1920) and as a layer (light); Escape back (focus on
"All N waiting"); modules Spend, Book (large, light), Tables (1920); a deal; a module detail view;
locked (dark, light); degraded; Rewind (dark, light); Settings sheet. No console errors in any run.
Fixed during review: frame rows collapsing without the stale banner, amounts shrunk by the legacy
`.amt` rule, fill cards' nested bold, the Rewind narration squeezed to one word wide and its scrubber
pushed out, "Watching" cards picking up the legacy `.st` chip, a countdown wrapping, dead space at
1920x1080 (the centre and Charter grow their type on tall wide windows).

## Left for WP3 / open questions
1. Module pages, deal page, Rewind, Settings/Connections/Agent rules are the old views inside the new
   frame. Detail pages still draw their own "‹ Back" beside the header's Back (double back), and the
   module summary pages leave the lower sheet empty at 1280x800 (their layout).
2. Rules, Connections and Settings open the existing Sheet over the current layer (`#s=`), not layers
   of their own; WP3 decides whether they become layers (the route model has room: add a level).
3. The Dial home's left column ("This week" ledger summary, today's wallet-limit meters with bars) is
   gone from the first screen; Book carries the ledger, the footer carries the two meters (hidden under
   1500 px wide). Confirm that is enough, or WP3 adds a ledger card to the centre's fill.
4. The Charter at 1920x1080 is centred with ~220 px above and below (the tour mark sits under it);
   acceptable to me, flagging it against the "dead band > 120 px" rule.
5. Bead buttons are pointer-only (tabIndex -1, 6 px): the same deals are one keyboard path away
   (modules, waiting list, Find); WCAG 2.5.8's equivalent-control exception. DialStrip (WP1a) stays
   non-interactive by contract, so BeadStrip reuses its look and `stripBeads` instead.
6. Degraded world: a deal whose `deal_display` read failed shows the fallback title (the raw
   `item_ref`, e.g. "monitor-27-4k") - existing WP1b/`lib/display` behaviour, not changed here.
7. The `wallet:error` toast still shows the event's own message (unchanged behaviour).
8. Director/takes selectors (Home/Dial/Shell classes) are WP4's; they are now stale.

## Files
New: `src/windows/main/console/{Console.tsx, Centre.tsx, centreModel.ts, BeadStrip.tsx, Waiting.tsx,
Find.tsx, findIndex.ts, RewindLayer.tsx, StaleBanner.tsx, route.ts, memory.ts, calm.ts, ledger.ts,
console.css, find.css, route.test.ts, centreModel.test.ts, findIndex.test.ts, guard.test.ts,
calm.test.ts, console.test.tsx}`, `src/windows/main/setup/{Charter.tsx, Charter.test.tsx, charter.css,
start.ts}`, `src/windows/main/home/useAway.ts`, this note.
Changed: `src/lib/words.ts` (append), `src/windows/main/{App.tsx, entry.tsx, logic.ts, Sheet.tsx,
Shortcuts.tsx, art.ts, rewind.css}`, `src/windows/main/setup/CircuitView.tsx` (import path).
Deleted: listed above.
