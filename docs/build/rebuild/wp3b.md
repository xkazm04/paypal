# WP3b - Book, Shield, Rescue as console layers (notes for the Director)

Scope: `apps/desktop/client/src/**` only. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority,
capability or mock change (`git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri` is
empty). No dependency added. Main still reaches money only through `approval_open` (guard test green).

## 1. What was built

Three layers on the WP2.5 framework (ModuleLayer, ListEngine, rows), each registered by its area
file (`console/layers/{book,shield,rescue}.ts`, views declared there with `defineModuleViews`).

**Book** (`console/areas/book/`). Summary: the one answer ("This week: $X paid out, $Y paid in."),
held money and payments being checked said apart under it, "Your safety record", four cards (This
week's money, with "Today $X" = the footer's figure; Outlook, with its "If you do nothing"; The
record; Ask your book) and "How your book works" behind a disclosure. Views:
- `ledger` (and `recent`, the same list newest first): the four totals kept apart (each with Why?),
  "Where the money went, and does PayPal agree?" one disclosure down (reads the week's paid deals'
  statements only once opened), then every deal of the week in one windowed list (search, filters
  Paid / On hold / In progress / Not confirmed / Stopped / Checking with PayPal, sort newest / oldest
  / largest). This week / Everything on record is a switch. Each row's PayPal statement chip is read
  only while the row is drawn. On a window >= 1200 px the picked row's money and PayPal proof sit
  beside the list; below, a row opens its deal. Actions: Check a proof file, Export CSV.
- `outlook`: four lines (holds to decide, payment links open, renewals failing, payments being
  checked), each: how many, the money of exactly those, the soonest one apart with its time left,
  and its "If you do nothing"; then those deals in one windowed list with a filter per line.
- `record`: the audit chain in one windowed list, 200 steps per `audit_page`, read on as the list
  scrolls near its end or on "Read older steps"; "Go to a day" (a date field) reads on page by page
  until that day is on record and shows the list from it; search; filters Money steps / Decisions /
  Yours; actor and action said in words; a step naming a deal opens it. LEDGER_TRUST shows
  AUDIT_BROKEN (what it means, what to do, Check again).
- `ask`: the ask box (wallet's own reading, chips, unsure line), the question chips, the drafted /
  shown / unsure / blocked phases, "What this view asks" one disclosure down, the pivot, the wallet's
  own answer (`book_query`), Export CSV of the answer, and "The deals behind this answer" as a
  windowed list (their statements read for the answer's rows). Esc clears, Ctrl+Enter shows a draft.
- `proof`: Check a proof file (`proof_check`), the report (`ProofReportView`, unchanged).

**Shield** (`console/areas/shield/`). Summary: the story line (one paused / N paused / stopped for
your safety / all quiet), "Your call" with the count and the first paused payment's "If you do
nothing", ONE gold hand-off on the first paused payment (`approval_open {deal_id}`; lock glyph and
`APPROVAL_LOCKED_TITLE` when locked, disabled while pending, `WalletNotice` on error, the old toast),
four cards (Stopped, Let through, This week, Looked safe), "How the shield works" disclosure. Views:
`paused` (each paused payment a row; beside it the decision card: reasons with Why?, what is
normal vs this payment, the check lights, their note chip, the gold hand-off, Refuse… with its
confirm), `stopped` / `through` / `safe` (windowed lists), `week` (the checks side by side, below),
`how` (How the shield decides, was a sheet).

**Rescue** (`console/areas/rescue/`). Summary carries the decision (the owner's complaint): the
answer names the failed renewal (several: the total, and "Soonest: …"), "Your call" with the count
and "If you do nothing", ONE gold `approval_open` on the soonest one, four cards (Needs a fix with
its If you do nothing, Fixes in progress, Recovered money, Watching). Views: `failed` (the renewals
as a windowed list; beside it the fix panel: Do nothing picked at the start, the fixes as a radio
group with previews and Why?, the not-offered line, the gold hand-off carrying the picked fix as a
draft `{deal_id, target:'deal', draft:{type:'lever', lever}}`, "What X does" one disclosure down;
actions Replay a renewal ↗ and Compare every fix), `compare` (every fix of every renewal as short
cells per row, the same panel beside it, "never a price change for everyone"), `progress` (list +
detail with hand-off), `recovered` (the wallet's total, then every rescue with counts / doesn't
count and why, filters), `watch` (watched subscriptions, Manage ↗ = `approval_open {target:
'rescue_watch'}`, the rescue rules, Open agent rules).

## 2. Scale findings fixed

| # | Fix | Test |
|---|---|---|
| 8 | Outlook: every line's amount is the total of exactly the deals it counts; the soonest item is said apart ("Soonest: $1,250.00 · … · 6 h 30 min left"); holds read "on hold at PayPal in all, not paid". A payment being checked is only in "being checked". | `areas/book/model.test.ts` (outlook), `book.test.tsx` (holds line vs the world's AUTHORIZED deals) |
| 9 | Footer meter (`Console.tsx` TodayMeters, the one edit outside my files): "paid out today" is now `paidOutIn` over the wallet's day (paid buyer deals, never a hold, an agreed payment, a payment being checked, a refund or an unconfirmed one), the same function and set as the Book card's "Today $X". The tooltip says what it leaves out (held, agreed) and the day's budget against the limit. Large world: $64,214.60 (budget incl. a $48,000 hold) → $3,182.19. | `model.test.ts` (paid today: holds/agreed/refund/unconfirmed/checking left out, multi-currency), `book.test.tsx` (footer text = Book's set = card's Today; ≠ out_today) |
| 10 | "This week" is the week: the Book's week list, summary and totals use `dealsIn(weekSpan)` (started or changed this week; an older live hold is not "this week", it is in the outlook). Shield's This week uses the same scope as its week tiles; "Everything" is one switch away in both. | `model.test.ts` (90-day-old hold not in the week) |
| 12 | Rescue lists are windowed ListEngines (failed, compare, progress, recovered: <60 rows in the DOM at 150 cases); no page-long card dump. | `rescue.test.tsx` |
| 13 | Shield matrix: one row per payment, a fixed set of 7 columns (no column per payee); columns fold by the row's own width (container queries), the picked row's story keeps all checks; no horizontal page scroll at 1280 or 1920. | `shield.test.tsx` (7 cells per row, windowed) |
| 16 | Record: windowed, 200 per page, read on scroll / button, "Go to a day" reads up to 60 pages to reach a day, search and filters over what is read. DOM bounded (≤ 250 rows). | `book.test.tsx` |
| 17 | Book evidence goes through the shared query cache entry `['deal_evidence', id]` (same key the deal page reads, so opening a deal from the Book reads nothing again), gated to READ_CONCURRENCY (8) in flight (`areas/book/evidence.ts`). Only rows in view read; the summary reads none; "PayPal agrees" reads the week's paid deals only when opened. Large ledger: ≤ visible rows (was 500). | `book.test.tsx` |
| 18/19 | All lists windowed (ListEngine); counts through `formatCount` (99+). | scale smoke |

## 3. Parity (old feature → new place → moves from the centre)

Moves: 1 = the module tab, 2 = a card / summary control, 3 = inside that view.

| Old feature | New place | Moves |
|---|---|---|
| **Book** week answer (paid out/in, held, checking, stopped) | summary answer + line | 1 |
| Your safety record | summary action | 2 |
| How your book works (popover) | summary disclosure | 2 |
| This week's money card / ledger | card → `ledger` | 2 |
| Four totals with Why? | ledger head | 2 |
| Where the money went + PayPal agrees (bars, gaps, last checked) | ledger disclosure | 3 |
| Grid by kind with bucket columns; click a total to filter by bucket | list + bucket filters | 3 |
| Statement filter (on statement / not yet / differs / no payment / unknown) | **changed**: each row's statement chip; the "PayPal agrees" card lists what is not on the statement; Ask "Did PayPal record everything?" answers it. (A filter needs every row's evidence = the #17 cost.) | 3 |
| Grid help popover | totals' Why? + filter titles | 2-3 |
| Row → detail sheet (status, statement, mode, with, what, money, when, deadline, if nothing, decided by, receipt, market band, fair price, rules version) | pane beside the list (>= 1200 px); PayPal ids are on the deal page; below 1200 px a row opens the deal | 3 |
| Export CSV | ledger action (exports the scope's rows, not the filtered subset) | 3 |
| Audit trail sheet (Older ›, LEDGER_TRUST, Check again) | `record` view | 2 |
| Check a proof file sheet | `proof` view (from ledger and record) | 3 |
| Outlook view + per-item popover | `outlook` lines + list (row opens the deal) | 2 |
| Ask box, quick views / question chips, slip phases, reading chips, unsure line, pivot, wallet answer, CSV of the answer | `ask` view | 2-3 |
| "What this view asks" sheet | disclosure in the slip | 3 |
| Answer lights rows in the ledger (dims others, "Show all") | "The deals behind this answer" list in Ask | 3 |
| Recent payments (8 + show all) | `recent` = full windowed list newest first (ledger) | 2 |
| `/` focuses the ask box | the console's `/` is Find; the ask box takes focus when Ask opens | 2 |
| **Shield** answer | summary | 1 |
| Paused decision cards (reasons + Why?, compare, lights, Review & release / Review, Refuse… confirm, note chip, default + deadline) | first one: summary Your call + gold hand-off; all: `paused` list + decision beside it | 1-3 |
| Cards Stopped / Let through / This week / Looked safe | same cards, windowed lists | 2 |
| Matrix (payee columns; verdict, PayPal, decision, new payee, price rows; other-checks line; their note row) | `week` rows with 7 columns; their note in the row's story (read only when opened) | 2-3 |
| Everything / Outcome only (P) | Seg in `week` | 3 |
| Inspector per cell (payee, check, note, verdict + check list, PayPal ids, decision with hand-off) | the picked row's story pane | 3 |
| Keys arrows / Home / End / Enter / O / R / P in the matrix | list keys (arrows, Page, Home, End, Enter); R = the pane's gold button; P = the Seg | 3 |
| How it works legend popover / How the shield decides sheet | summary disclosure + `how` view | 2-3 |
| Refuse confirm sheet (`deal_withdraw`) | kept (a confirm) | 3 |
| **Rescue** answer | summary (+ soonest named) | 1 |
| How rescue works popover | summary disclosure | 2 |
| Needs a fix decision cards (picks, previews, Why?, not offered, hand-off with lever draft, source chip, recipient) | summary gold hand-off (first) + `failed` list with the fix panel beside it | 1-3 |
| Replay a renewal ↗ | `failed` action | 3 |
| Compare every fix (matrix, never column, per-row Review, inspector: what it does, PayPal calls, checks, what the subscriber sees) | `compare` view + the panel's "What X does" disclosure | 3 (disclosure 4) |
| Fixes in progress | `progress` list + detail with hand-off | 2-3 |
| Recovered money (counts / doesn't count, closed rescues) | `recovered` list with filters | 2 |
| Watching (count, checks today, Manage / Watch ↗) + Rescue rules popover (Open agent rules) | `watch` view | 2 |
| rescue_book read again on window focus | kept | - |

Cut (ask): the ledger's "exact query" JSON dump (an internal), the per-row "vs market" column (in
the pane), the `r2-book` experiment switch (the round-2 visuals are always on).

## 4. Deleted / moved / kept
- Deleted: `windows/main/modules/{book,shield,rescue}.tsx` and `.css`. `Modules.tsx`: their imports
  and cases removed (small edits; it now dispatches no page, `MODULE_PAGES = []`; `ModuleView` is
  only used by `legacy.tsx LegacyModuleLayer`, which no area points at any more: both are dead and
  can go with `legacy.tsx`).
- `modules/book/ProofCheck.tsx`: the sheet removed, `ProofReportView` kept (ownerKey/proof tests).
- Kept where they are (pure or small parts, imported by tests and by the new layers): `modules/book/
  {model,understand,where,rules,AskReading,AskChips,MoneyWent,ProofCheck}`, `modules/shield/{matrix,
  normal,NoteChip,Panels}` (NoteChip is the deal page's too), `modules/rescue/{model,preview,Panels}`.
  Their CSS rules moved into `console/areas/<area>.css`, scoped under `.ar-<area>`.
- `windows/main/evidence.ts` / `world.tsx useAllEvidence`: no caller left (the Book uses the query
  cache). Not deleted: `world.tsx` is shared and `evidence.test.ts` tests it. Director's call.

## 5. Words added
`lib/words/book.ts` (`BOOK_VIEWS_TITLE`, `BOOK_TODAY`, `BOOK`), `lib/words/shield.ts`
(`SHIELD_VIEWS_TITLE`, `SHIELD`), `lib/words/rescue.ts` (`RESCUE_VIEWS_TITLE`, `RESCUE`). The old
page names/subs (`SHIELD_VIEW_LABEL`, `RESCUE_VIEW_LABEL`, `SHIELD_*_SUB`…) are repeated as literals
there (an area words file may not import `lib/words.ts`, which re-exports it); `lib/words.ts` itself
untouched. Inline strings of the old pages moved into these files.

## 6. Tests
New: `areas/book/model.test.ts` (10: week window, holds apart, outlook sets, paid today = Book =
exposure, refunds/unconfirmed/checking out, currencies apart), `areas/book/book.test.tsx` (9),
`areas/shield/shield.test.tsx` (8: summary both scales, Your call + gold hand-off args, locked,
7 columns, note read only when opened, released never also stopped), `areas/rescue/rescue.test.tsx`
(10: both scales, gold hand-off args, four windowed lists, lever draft, replay/watch hand-offs,
recovered = wallet total). Kept unchanged: every `modules/{book,shield,rescue}/*.test.ts(x)`.

## 7. Gates
`pnpm typecheck` clean. `pnpm exec vitest run` (full, once): **136 files, 1421 tests, all passed**.
Area re-run after the last change: 7 files / 66 tests passed (my areas + scale smoke + guard + words).
Rust/bindings diff vs 859fa04 empty.

## 8. Screenshots (scratchpad `wp3b-shots/`, all read)
Each summary small/large, dark/light, 1280x800 and 1920x1080; Book ledger (large, small, picked row,
degraded), outlook, record, ask (answered); Shield This week large 1280 (story pane) and large 1920
light, small light; Shield paused (dark, light); Rescue Needs a fix list + panel (large dark, small
light), compare, recovered, watch; `?first_run=1` Book and Rescue; `?degrade=1` Book. No console
errors in any run. Fixed during review: the deal label (an id) in the ledger pane's kicker, the
matrix header out of line with its rows (labels now inside each cell), the verdict chip clipped,
"Looked safe: Nothing checked yet" beside "21 checked", a raw status list in "How this answer was
asked", short lists leaving a tall empty pane (they now take their own height), summary cards
matched to the other module layers' height.

## 9. Open questions
1. **Dead band on every module summary** (all six layers, not only mine): answer + cards leave
   ~250 px empty at 1280x800 and ~450 px at 1920x1080. "First view = answer + decision + cards,
   nothing else" and "no dead band > ~120 px" conflict at the ModuleLayer level; a framework answer
   (e.g. the sheet shrinking to content, or a calm presence strip) should be one decision for all.
2. Statement filter in the ledger (see parity): keep it cut, or read every week row's evidence
   (bounded to the week, ~130 reads at scale) to offer it again?
3. The fix picker and the paused decision sit beside the list from 1200 px; narrower (below the
   1280 target) a row opens the deal page, whose hand-off carries no lever draft.
4. Footer "paid out today" now follows the Book's honest set; Rust's `paid_today` also counts
   refunded, disputed and unconfirmed captures (as spend). The limit meters in Rules > Wallet limits
   still show the day's budget (`out_today`). Confirm that split.
5. `lib/lazy.ts` has a doc comment naming `./modules/book` (example only, not mine).

## 10. Files
New: `src/windows/main/console/areas/book/{BookLayer.tsx, Ledger.tsx, Outlook.tsx, Record.tsx,
Ask.tsx, Proof.tsx, parts.tsx, model.ts, today.ts, evidence.ts, model.test.ts, book.test.tsx}`,
`console/areas/shield/{ShieldLayer.tsx, Checks.tsx, parts.tsx, model.ts, shield.test.tsx}`,
`console/areas/rescue/{RescueLayer.tsx, parts.tsx, rescue.test.tsx}`, this note.
Changed: `console/layers/{book,shield,rescue}.ts`, `console/areas/{book,shield,rescue}.css`,
`lib/words/{book,shield,rescue}.ts`, `console/Console.tsx` (TodayMeters only),
`windows/main/Modules.tsx` (my three pages removed), `modules/book/ProofCheck.tsx` (sheet removed).
Deleted: `windows/main/modules/{book,shield,rescue}.{tsx,css}`.
