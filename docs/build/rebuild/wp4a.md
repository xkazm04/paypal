# WP4a - Console polish: no dead bands, nested views in the URL, two-step lists, dead code, perf, a11y, resilience

Scope: `apps/desktop/client/src/windows/main/**`, `src/lib/words/**`. No Rust, `bindings/`, `crates/`,
`src-tauri/`, authority, capability or mock change: `git diff --stat 859fa04 -- crates bindings
apps/desktop/src-tauri` is empty. No dependency added. Nothing committed. WP4b's files
(`windows/approval/**`, `windows/tumbler/**`, `design/**`, `shared/ui/**`) were not touched.

## 1. Director decisions, as built

**1. No dead band: the "Latest" strip** (`console/Latest.tsx`, CSS `.lt*` in `console/framework.css`).
`ModuleLayer` and `PlaceFrame` take a `latest` prop (PlaceFrame also an array). The strip sits under
the cards (modules) or under the place's own content (places), is quiet (small muted heading, no gold,
no second gold action - asserted), and shows the first N rows of the area's most relevant list drawn by
the area's own row part, each opening its deal, plus "See all · N more ›" into the full view (focus
comes back to "See all"). N = room left on the sheet / measured row height, clamped 3..8
(`rowsThatFit`, ResizeObserver on the sheet's scroller; jsdom measures 0 and draws 3). Areas with no
list show their state as read-only facts (one per line on tall windows, max 56rem wide). It steps
aside while a card view is open.

| Layer | Strip |
|---|---|
| Tables | open tables (waiting first, `TableRow`), then ended (`DealRow`); See all -> Open tables |
| Spend | waiting purchases, then the newest (`row(l)`); See all -> Needs you / This week |
| Counter | live orders, then earlier (`orderRow`); See all -> Open orders |
| Book | the week's payments newest first (`LedgerRow` with `statement={false}`: drawing the row reads nothing; the book test's 0 `deal_evidence` on the summary still holds); See all -> Recent payments |
| Shield | paused, stopped, let-through, then the rest checked (`ShieldRow`); See all -> Paused / Stopped / ... |
| Rescue | renewals that need a fix (asking first), fixes on their way, settled (`FailedRow`/`ProgressRow`) + the watched subscriptions as facts |
| Waiting | a list of 8 or fewer takes its own height; "decided lately, and who decided" (`DealRow` + `decidedBy`) fills the room |
| Deal (no view open) | its latest moments (signed messages + ledger moments, newest first, from the transcript already read; a moment opens What happened) with "where it stands" facts; then "other deals with <them>" (`DealRow`, opens that deal). No new read (#17 test unchanged) |
| Wallet limits | facts: Paid out today (collected by PayPal), Budget used today, signed limits, money coming in |
| Settings | facts: money mode, PayPal key, agent app, house seller, rule sets signed, agents at work |
| Safety | facts: records, chain, deals checked, histories verified, refused deals, money steps |
| Connect a wallet | the wallets you deal with, newest first (`PersonRow`); See all -> Connections |

Measured band under the content (px; `scratchpad/wp4a_measure.py`, Playwright, dark, closed
disclosures excluded) - columns: small 1280x800 / small 1920x1080 / large 1280x800 / large 1920x1080:

| Layer | Before (WP3) | After |
|---|---|---|
| Tables | 133 / 352 / 119 / 288 | 12 / 80 / 12 / 74 |
| Spend | 127 / 352 / 133 / 352 | 0 / 60 / 0 / 60 |
| Counter | 101 / 352 / 101 / 352 | 0 / 90 / 0 / 74 |
| Book | 97 / 316 / 97 / 299 | 12 / 83 / 12 / 67 |
| Shield | 91 / 310 / 91 / 310 | 12 / 83 / 12 / 83 |
| Rescue | 71 / 289 / 71 / 289 | 0 / 96 / 0 / 0 |
| Waiting | 30 / 275 / 0 / 0 | 0 / 54 / 0 / 0 |
| Wallet limits | 151 / 317 / 151 / 317 | 8 / 40 / 8 / 40 |
| Connect a wallet | 133 / 383 / 133 / 383 | 0 / 71 / 0 / 71 |
| Settings | (scrolled) | 0 / 0 / 0 / 0 |
| Safety | 195 / 389 / 195 / 389 | 3 / 24 / 3 / 24 |
| A live deal | 52 / 275 / - / - | 0 / 0 / 0 / 0 |
| An ended deal | 308 / 525 / - / - | 53 / 94 / 0 / 0 |
| Centre, Rewind, Rules, Connections | 0-20 | 0-20 |

"Before" was measured with the first version of the script, which counted the text inside a closed
disclosure as content, so the before figures for pages with an explanation are *lower* than the real
band (the Director's ~250 / ~450 px). Worst after: 96 px (small rescue at 1920: its three rescues
and two watched subscriptions are all shown). At 1280x800 the modules now scroll a little (three rows
minimum): the first view (answer, Your call, cards) stays in sight. jsdom guard:
`console/latest.test.tsx` (every module on both scales has a strip after its cards with 1..8 rows and
no gold; the short places have their facts/rows; a row opens its deal; See all opens the view and
Escape returns focus to it; the waiting list's short/long behaviour; a deal moment opens the story).

**2. Nested views in the URL.** `Route` deal/place gained `view?`. Hash: places `#p=<place>[&m=..]&v=<view>`
(the Director's form). Deals: **`#d=<id>[&m=..[&v=..]]&dv=<view>`** - constraint: `v=` after `&m=` already
means the module view the deal was opened from (WP2.5, every older link), so the deal's own view is
`dv`; `#d=<id>&v=<view>` with no `&m=` is also read as the deal's view (the Director's short form).
`stepBack` closes the view first; `route.ts`: `MAX_DEPTH` 5, `routeKey` per view (`d:<id>/<view>`),
`mountKey` (the sheet without its view: opening/closing a view keeps the sheet mounted and its
entrance), an unknown view key is stepped over (`ChainCtx.knownSheetView`). Each layer registers its
view keys and crumb labels in `LayerDef.views` (deal: story, rules, who, proof; settings: approving,
agents, look, notify; connections: paypal, engine, house; safety: records, refused). `LayerHost`
provides `useSheetView()`; `PlaceFrame` follows it (falls back to its own state outside a layer).
Opening a second card replaces the open view's entry (one Back closes it). Focus: a view that opens
(card, reload, Forward) scrolls into sight and its heading takes focus; a view that closes (Escape,
Back, crumbs, browser Back) gives focus to its card. `memory.ts`: going deeper, a layer that already
put focus inside itself keeps it. Tests: `console/sheetViews.test.tsx` (hash, crumb, same sheet
element, Escape + focus, top-bar Back twice, reload `#p=settings&v=look`, unknown view, `&dv=who` with
browser Back and Forward, card replace), `route.test.ts` (round trips, back-compat, depth 5).

**3. Two steps in lists.** `ListEngine`: a click (or Space) PICKS when the list has a pane (`onPick`
for the area's own pane, or `detail`), Enter OPENS (`onOpen`, the deal); a list without a pane opens
on click too. Arrows/PageUp/Down/Home/End move; Escape clears the search/filter, then goes back. A
two-step list carries a screen-reader hint (`LIST_TWO_STEP`, `aria-describedby`). Callers moved from
`onOpen={pick}` to `onPick` + `onOpen={deal}`: Tables (need/open lists), Spend (lists, rule check),
Counter (orders; items pick only), Shop around (pick only), Agent rules (pick only). Already two-step
through `detail`: Book ledger, Shield paused, Rescue failed/in progress, Shield checks. One-step
(click opens): Rewind tape, Outlook, Record, Ask, Recovered, ended lists, People.

**4. Dead code** (grep after deletion, `src/**`: 0 importers each): `console/legacy.tsx` (the
Charter layer moved to `console/areas/setup/SetupLayer.tsx`, unchanged), `console/examples/ModuleExample.tsx`
(and its `EXAMPLE` words), `windows/main/Modules.tsx`, `modules/common.tsx` (only Modules reached it),
`windows/main/evidence.ts` + `evidence.test.ts` and `world.useAllEvidence` (callerless; the guard still
owed - at most READ_CONCURRENCY evidence reads, in order, a failure frees its place - is now
`console/areas/book/evidence.test.ts` on the live path `gate()`), `windows/main/art.ts` (only the lock
glyph was live: moved into `ui.tsx`), dead `ui.tsx` parts (StateChip, ShieldChip, ReplayChip,
ReceiptChip, RecChip, Silence, Clause, Svg, HeaderArt, DealAmount, DealRow, Confirm), the interim place
rules in `framework.css`, dead `legacy.css` rules (.btn* .btns .kv .sect .mhead .grid2 .bigamt .sil-tag
.unavail .tablecard .confirm-layer; no main-window user - the file is only loaded by the main window),
`.bandcard` in `charts.css`. `NoteChip` moved to `console/areas/shared/NoteChip.tsx` (Deal Who view,
Shield parts and checks updated; its inline strings are `NOTE_CHIP` words now, byte-identical).
`windows/main/home/*`: every file still has importers (`home/model.ts` 20+, `useAway`/`away` the
centre) - nothing deleted there; a rename of the folder would touch 25 imports and was not asked.

**5. Footer figure.** The footer keeps the Book's "paid out today" (unchanged). Wallet limits' daily
meter is now named **"Budget used today"** with a note under it ("Every payment your agents agreed to
today counts here, paid or not. "Paid out today" at the bottom of the window counts only money PayPal
collected."), the facts strip shows both figures side by side, and the Agent rules "Wallet limits"
card note says "budget used today · not the same as "Paid out today"". `LIMIT_WORDS` (shared with the
approval window) is unchanged; the main window overrides the label for its meter.

**6. Narrow windows.** A list with a `detail` keeps its pick below `wideAt`: the detail sits under the
list (`.le.stack`, the list capped at 50vh, the picked detail scrolled into sight), so a click still
reaches the fix picker / the paused decision and Enter opens the deal. The selection lives in the list
(no route state needed: it is never lost to the width). Counter-proposal to "pass the selection
through the route": not needed for this; say if a reload should keep the pick too.

## 2. Perf (busy merchant, mock at 40 ms per call)

Browser (`scratchpad/wp4a_perf.py`, Playwright, 1280x800, median of 3, cold = fresh page; "ready" =
heading drawn, no skeleton, and for a module its cards):

| | small | large | budget | old (SCALE-FINDINGS) |
|---|---|---|---|---|
| time to the centre | 533 ms | 600 ms | < 1.5 s | 1.0 - 3.8 s |
| module summary, cold load (6 modules) | 633 - 645 ms | 686 - 706 ms | < 1.2 s | 1.0 - 3.9 s |
| module summary, tab from the centre | 37 - 69 ms | 37 - 70 ms | - | - |

jsdom counters (`console/perf.test.tsx`, large world, printed with `--silent=false`): DOM nodes per
layer centre 247, tables 143, spend 132, counter 163, book 135, shield 134, rescue 125, book ledger
435, waiting 221, rewind 590, rules 175, connections 254, settings 166, safety 74 (budget 1,500,
asserted; browser max 579). Reads on a cold load ~507 per layer (500 are the World's `deal_display`,
once each - the World's design, inside the existing budget). A burst of 20 `deal:changed`: the ledger
read 2 times (coalesced), 6-8 reads in all, 2-4 React commits (asserted <= 2 ledger reads, <= 60
reads). No regression found, so nothing was re-memoised. The harness gained `fire(event)` and a
Profiler commit counter (test-only).

## 3. Accessibility

`console/a11y.test.tsx` (no new dependency): on 18 layers + a deal with its view open - unique ids,
every button/tab/switch named, fields labelled, aria-controls/labelledby/describedby resolve, list
items inside lists, labelled pictures, exactly one h1 per layer, exactly one tab stop in the module
tabs (the checks are self-tested on a bad fixture). Plus one keyboard session: tab stop on the tabs ->
ArrowRight -> Spend -> a card -> the view -> arrows in the list -> Enter opens the deal -> Escape back
to the view with focus on the row -> Escape to the summary with focus on the card -> Escape to the centre.
Fixed: **the module tabs were unreachable by Tab on the centre and the places** (roving tabindex with
no lit tab gave every tab -1): `Console.useTabStop` keeps one stop (the lit tab, else the first).
Semantics picked: **tablist** - each tab `aria-controls="cs-panel"`, the sheet's layer is
`role="tabpanel"` labelled by the lit tab while a module (or its deal) is lit. The stale banner now
speaks through a live region that is always mounted (`.cs-stale-live`, polite); toasts were already
a polite live region. Reduced motion: the strip has no motion; views scroll with `isCalm()`.
Contrast: the token test (unchanged, green).

## 4. Resilience

`scratchpad/wp4a_resil.py`: 19 layers/views x `?degrade=1`, `?records=broken`, `?forecast=off`,
`?groups=none`, `?limits=none`, `?scale=large&degrade=1` = 114 pages: every one has its heading and
calm text, no page error, no code / command name / raw error text on screen; the stale banner shows
on every degraded page. `console/resilience.test.tsx`: a layer that throws (the safety record,
mocked) shows its calm `role=alert` fallback under the whole chrome, no error text, and Back returns
to Settings.

## 5. Words / guards

The UX checklist grep (`Rust|P3|clause \d|UNAVAILABLE|_list|_query` and vendor names) over
`windows/main/**` and `lib/words/**`: no user-facing hit (only command names in code, comments, and
`code === 'UNAVAILABLE'` comparisons). Inline UI strings moved to words: `NOTICE_WHAT` (WalletNotice
"what" in Settings, Connections, Rules, Limits, Safety, Deal, Centre, Set up, Charter, Quit),
`LOADING_WHAT`, `QUIT_SHEET`, `SHORTCUTS_TRIAL`, `NOTE_CHIP` (all byte-identical). New words: `LATEST`,
`LATEST_OF`, `LIST_TWO_STEP`, `LIMITS_PLACE.budget*/fact*`, `RULES_CARD.limitsBudgetNote`,
`SETTINGS_FACTS`. Left inline (older parts not touched here): `modules/book/MoneyWent.tsx`,
`AskReading.tsx`, `AskChips.tsx`, `modules/{rescue,shield}/Panels.tsx`, `setup/common.tsx` chips.

## 6. Screenshots (scratchpad `wp4a-shots/`, read)

`final/`: 17 layers/views x {small dark 1280, small light 1920, large light 1280, large dark 1920} +
a deal and a deal view on each = 76; automated check on all: no text under 12 px (the centre's 1.9 px
hits are SVG seal-ring numerals, decoration), no horizontal overflow, no raw id/enum, no console error.
Read: tables (large dark 1920, small dark 1280), counter, shield, rescue, book, deal, limits, safety,
pairing, settings, waiting; `narrow/` at 1100 px. Fixed from them: Wallet limits' "of $1,000 a day" in
the facts (now "$1,000 a day"); facts lines too wide on tall windows (capped); a giant hourglass in
Rescue's fix panel once it sat under the list (`.rs-sil .hg` unsized); crumbs running into each other
on a narrow bar (each crumb now ellipsises).

## 7. Gates

`pnpm typecheck` clean. `pnpm exec vitest run --reporter=dot`: **143 files, 1488 tests, all passed**
(this includes WP4b's in-flight tests). Rust diff vs 859fa04 empty.

## 8. Open questions

1. `#d=..&dv=` instead of `#d=..&v=` for a deal's own view (constraint above). Keep?
2. The strip makes the six modules scroll slightly at 1280x800 (three rows minimum). Lower the minimum
   to 2 at short windows, or keep 3?
3. Rescue on the small shop at 1920 still leaves 96 px (everything it has is shown). Fine?
4. `shared/ui` `ModuleTab` sets `tabIndex` from `active` only; the console fixes the tab stop from
   outside. A `tabbable` prop in `ModuleTab` (WP4b's file) would be cleaner.
5. The deal page's Details popover shows the engine id (`claude-code`) next to the run badge (WP3c,
   unchanged); allowed as an engine reference, but it is a Details-level internal.
6. Narrow pick (decision 6) is kept in the list, not the route: a reload loses it. Want `&k=`?

## 9. Files

New: `console/{Latest.tsx, latest.test.tsx, sheetViews.test.tsx, a11y.test.tsx, perf.test.tsx,
resilience.test.tsx}`, `console/areas/setup/SetupLayer.tsx`, `console/areas/shared/NoteChip.tsx`,
`console/areas/book/evidence.test.ts`, this note.
Changed: `logic.ts` (route views, `sheetViewOf`, `withoutView`), `console/{route.ts, route.test.ts,
layers.tsx, Console.tsx, memory.ts, ListEngine.tsx, ListEngine.test.tsx, ModuleLayer.tsx, Waiting.tsx,
StaleBanner.tsx, Centre.tsx, framework.css, console.css}`, `console/layers/{setup,deal,settings,
connections,safety,core}.ts(x)`, `console/testing/scaleSmoke.tsx`, `console/areas/settings/frame.tsx`,
the area layers (Tables, Spend, Gate, Shop, Counter, Book, Ledger, Shield, Checks, shield parts,
Rescue, Rules, Safety, Settings, Connections, Deal page, Deal layer, Who view) and `rescue.css`,
`rules.css`, `ui.tsx`, `world.tsx`, `legacy.css`, `main.css`, `charts.css`, `QuitSheet.tsx`,
`Shortcuts.tsx`, `setup/{common,Charter}.tsx`, `lib/words/{framework,rules,settings}.ts`.
Deleted: `console/legacy.tsx`, `console/examples/ModuleExample.tsx`, `Modules.tsx`,
`modules/common.tsx`, `modules/shield/NoteChip.tsx`, `evidence.ts`, `evidence.test.ts`, `art.ts`.
