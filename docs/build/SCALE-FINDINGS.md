# Scale findings: the current app on a small and a large business

Sample data throughout (browser mock, nothing is paid). The two worlds are `?scale=small` and
`?scale=large` (`apps/desktop/client/src/mock/scale.ts`; the numbers are in its header and in the
`SCALE.md` that `scripts/export-scale-fixtures.mjs` writes). Looked at on 2026-10-13 in Edge
headless at 1280 x 860 (approval window 744 x 660, Tumbler 460 x 600), against `pnpm dev`.

## What was covered

Home, the six modules and every detail page (`#m=<module>&v=<view>`), ten different deals (a $48,000.00
hold, the 40-round haggle, a mismatch, a scam-check pause, a payment being checked with PayPal, a
failed renewal, a blocked payment, a paid one), the Set up page (five steps), the three sheets, the
Tumbler (rest, ticker, card, stack), the approval window for the same deals and for the owner setup,
and nine interactions (Show all, the audit trail and its "Older", a ledger filter, Find, typing in
Find, the Rewind, the safety record). 53 pages small, 65 pages large, in the browser's own console.

Result: **no crash, no blank screen, no page-level horizontal scroll and no console error** in either
world, except one duplicate-key warning in the audit trail (fixed). Every list is already bounded or
ellipsised somewhere: Find shows 40 results, the Tumbler card pages through its items, rows cut long
names with an ellipsis. What the large world does show is below.

## How slow, in numbers

| | small | large before | large after |
|---|---|---|---|
| first paint of the page | 0.40 to 0.43 s | 0.42 to 0.47 s | 0.43 to 0.47 s |
| pages that do not need a deal's own display (Book summary, Shield, Set up, sheets, most of Rescue) | about 1.0 s | about 1.0 to 1.3 s | about 1.0 to 1.3 s |
| pages that do (Tables, Spend rule check, Counter orders, Book outlook, any deal) until their real content shows | about 1.0 s | **3.7 to 3.9 s** | **1.3 to 1.7 s** (an ended deal opened by its label: 3.7 s) |
| main-thread script on the Home page load | 0.08 to 0.10 s | 0.5 to 0.6 s | 0.5 to 0.7 s |
| DOM nodes, Home / largest page | 711 / 1,112 | 2,895 / 5,334 | same |
| click Show all, open the audit trail, Find, the Rewind | n/a | under 0.1 s each (the harness adds a fixed 0.4 s wait to what it prints), typing 7 keys in Find 0.10 s | same |

About 1.0 s is the floor in every world: the browser mock waits 40 ms per call to keep the UI honest
about IPC being asynchronous. That also exaggerates anything that makes many calls: the real shell's
cost per `deal_display` / `deal_evidence` read is UNVERIFIED. Other dev servers were running on the
machine, so single timings move by a few hundred milliseconds; the before and after figures above are
from runs a few minutes apart and the gap (2 s and more) is far outside that noise.

## Findings

Severity: high = a wrong or misleading statement about money or a deal, or a blocked task; medium =
hard to read or use at this size; low = cosmetic or only in the preview.

| # | surface | scale | what happens | severity | fixed? | rebuild (2026-10-14) |
|---|---|---|---|---|---|---|
| 1 | Every window that reads deals (Main) | large | `deal_display` is read for every deal on opening (500 reads, 8 at a time) and nothing was shown until the last one landed, so every label, band and title stayed on its fallback for about 2.7 s | high | **Yes.** `windows/main/displays.ts`: reads go out in batches of 100, live deals first, each batch is shown when it lands. Pages that need the display now show their content in 1.3 to 1.7 s instead of 3.8 s. Cost: the page re-renders 5 times, so total main-thread script on list pages rises by about 0.2 s | Fixed (kept). Same batch-of-100, live-first rules, now one pass runner over the shared query cache, at most 8 in flight (WP1b `displays.ts`) |
| 2 | Tables (Needs you, Your tables, Price ladder) | large | While the displays were missing, a table that does have a signed price range read "No price range yet" and "You haven't set a limit yet, so your agent can't make offers": a wrong statement for the first seconds | high | **Yes**, by fix 1 (the real band arrives in the first batch for live deals) | Fixed (kept), by 1 |
| 3 | A deep link `#d=<label>` (the director, a typed address) | large | Showed "This deal isn't here any more" until every label had been read, because a label is only known from its display | high | **Yes.** `App.tsx`: shows "Loading the deal" until the labels are in (`displaysReady`). An ended deal opened by its label still waits for the last batch (3.7 s); a link by id is instant | Fixed (kept). A degraded `#d=<label>` says the names did not load, not "isn't here any more" (WP3c) |
| 4 | Book > Ledger > Audit trail | both | The sheet's first read can run twice, so the first page listed twice and React warned about duplicate keys (5,000-row world: 50 rows doubled) | low | **Yes.** `book.tsx`: a row already listed is not added again | Fixed. The record view keys rows by step and reads 200 per page (WP3b) |
| 5 | Tables cards, Needs you cards | large | A long counterparty name pushed the "where it stands" label and the card's time left outside the card; the name's label was cut at the window edge | medium | **Yes.** `tables.tsx` / `tables.css`: the name gives way with an ellipsis (full name on hover), the price and the time stay | Fixed. `WhoChip` and the panes truncate with the full name in the title (WP3a) |
| 6 | Tables > Price ladder | large | A long counterparty name ran over the "Typical price" column heading | medium | **Yes.** `tables.css`: the heading ends with an ellipsis, full name on hover | Fixed. The ladder heading and the meet box ellipsise (WP3a) |
| 7 | Book > Ledger, the Deal column | large | At 1280 px every column is already at its minimum width, so the Deal cell is 74 px and reads "D-141...", "D-142...": the label cannot be told apart | medium | **Partly.** The full "label, title, counterparty" is now the cell's hover text; the layout is unchanged (a wider cell makes the table scroll sideways) | Fixed. The ledger is a windowed list whose rows name the deal by title; deal labels are no longer shown (WP3a, WP3b) |
| 8 | Book > Outlook | large | "7 holds to decide $1,250.00 6 h 30 min left" shows the count of 7 next to the soonest hold's amount; the 7 holds are $59,247.90. Reads as a total | high | No (a wording and design decision) | Fixed. Each Outlook line's amount is the total of exactly the deals it counts; the soonest one is said apart (WP3b, `areas/book/model.test.ts`) |
| 9 | Header meter "paid out today" | large | Reads $64,214.60 "paid out today, of $250,000 a day". The figure counts money on hold and committed (the $48,000.00 hold is in it) while Book shows $3,407.63 paid out this week. Same number in the Tumbler | high | No (wording of a money figure; it follows the exposure fold) | Fixed. Footer "Paid out today" = money PayPal collected (the Book's set); Wallet limits' meter is "Budget used today" (WP3b, WP4a) |
| 10 | Spend "This week", Counter "Earlier this week", Rescue and Shield lists | large | The pages are titled by the week but list every deal of the module over 90 days (Counter goes back to 15 Sept, Spend lists 120 purchases) | medium | No | Fixed. "Recent purchases", "Closed orders"; the Book and Shield weeks are the week, "Everything" one switch away (WP3a, WP3b) |
| 11 | Home dial | large | The 111 deals of the week draw as overlapping beads: smears on the track, the individual states cannot be read. The badges (20, 10, 7, 6, 1) are fine | medium | No | Fixed. The Dial home is gone; the small Dial is a bead strip (8 per module + n, 24 px targets) beside the decision (WP2, WP2.5) |
| 12 | Rescue > Needs a fix / Recovered money | large | 20 full cards make a page 9,854 px tall (recovered money 8,839 px); no filter, sort or paging | medium | No | Fixed. Rescue lists are windowed ListEngines with filters and sorts (WP3b) |
| 13 | Shield > This week | large | The evidence matrix adds one 150 px column per paused or blocked payee (17 columns, 3,527 px) and scrolls sideways inside its pane; the row labels stay | medium | No | Fixed. One row per payment, 7 fixed columns, no sideways scroll (WP3b) |
| 14 | Tables > Price ladder, the strip of tables | large | 12 tables as chips cut to "Ne...", "Re..." that cannot be told apart; the strip scrolls sideways | medium | No | Fixed. The chip strip is a searchable windowed list (WP3a) |
| 15 | Settings > Agent rules | large | "3 agents, 8 rule sets": the three Shopper cards (and the two Negotiator, two Assistant ones) have no name beyond the slot, so they cannot be told apart. 12 agent keys exist; the screen knows three slots | medium | No | Fixed. Each rule set says its agent, purpose, two telling limits, version and state (WP3c) |
| 16 | Book > Audit trail | large | 5,000 rows are read 50 at a time with "Older"; no date jump or filter; the DOM keeps growing (6,500 nodes after 315 rows). Reaching the oldest row is 100 clicks | medium | No | Fixed. Windowed record, 200 per page, "Go to a day", search and filters (WP3b) |
| 17 | Book > Ledger evidence | large | `deal_evidence` is read for every deal on the first Book open (500 reads, 8 at a time); the PayPal statement chips show "..." meanwhile, and the ledger settles in 2.0 to 2.4 s against 1.0 s | medium | No. Needs one batched read (a new IPC command); `evidence.ts` already names this | Fixed in the client. Evidence through the shared query cache, read only for rows in view, 8 in flight (Book); the deal page reads per view (WP3b, WP3c). Open: still many small reads without a batched IPC command (IPC frozen) |
| 18 | Home, the lists | large | Nothing is virtualised: about 3,000 nodes and 0.5 to 0.7 s of script on load (0.1 s small). Fine today, the next 10x is not | low | No | Fixed. Every long list is windowed (`ListEngine` / `useWindowedRows`); DOM per layer under 600 nodes at 500 deals (WP4a `perf.test.tsx`) |
| 19 | Counts and badges | large | The largest waiting count is 44 (Tumbler puck, Home list). No count has a "99+" treatment anywhere in the code, so a count past 99 is untested; a 3-digit Book count (500) fits | low | No (99+ cannot be reached by waiting items in this world; the lists that pass 99 are deals, rescue cases, counterparties and ledger rows) | Fixed. `formatCount` shows 99+ on every badge and filter chip (WP1b, WP2.5) |
| 20 | Director (`director.html?scale=`) | both | The three framed windows load the chosen world, but the story's beats are written for Maya's deals: the first beat throws `no deal D-0193` and the film stays on "Setting the table..." | low | No (`src/director` is outside the windows) | Fixed. Maya's week drops `?scale=` from the director page and its frames (WP3c, `stories.test.ts`) |
| 21 | Tumbler preview stage | both | Its preview controls name Maya's `D-0193`, which the scale worlds do not have | low | No (not exercised at scale) | Fixed. The Tumbler preview controls act on D-0193 when present, else the world's first decision (WP3c) |
| 22 | Small world, every page | small | Nothing wrong: Tables is empty and says so with an "Open a table" action, badges read 0, 1, 6, 12, 1, 1; the Set up page shows "3 of 5 done" | none | n/a | n/a |
| 23 | Approval window, the Tumbler's four forms, Set up page, the sheets | large | Nothing wrong at this size, including the $48,000.00 hold's button text, a 40-round haggle, a mismatch, a scam-check pause | none | n/a | n/a (the approval window and Tumbler were restyled in WP4b, not re-measured at scale) |

## The console rebuild (2026-10-14)

The last column records where the console rebuild (branch `worktree-spark-table-console-rebuild`, packages WP1a to WP4c, notes in `docs/build/rebuild/`) left each finding. The "fixed?" column is the 2026-10-13 state of the old window. Measured after the rebuild (WP4a, mock at 40 ms per call, 1280 x 800): the centre in 533 ms (small) / 600 ms (large), a module summary on a cold load in 633 to 706 ms, a module from the centre in 37 to 70 ms. Open after the rebuild: the per-deal read count without a batched IPC command (17), and about 300 displays re-read after any ledger change at scale (WP1b open item 1; needs a Rust change).

Not looked at (2026-10-13): dark vs light theme (dark only), widths other than 1280, a real keyboard session, the
native shell (nothing here was run in it), more than 500 deals.

## What changed in the code

Only `src/windows/main/**` (fixes 1 to 7), plus the mock and the preview switch:

- `displays.ts`, `world.tsx`, `App.tsx`: progressive display reads, `displaysReady`, the deep-link wait (`displays.hook.test.tsx` pins it).
- `modules/book.tsx`: no duplicate audit rows; hover text on the ledger's Deal cell.
- `modules/tables.tsx`, `modules/tables.css`: long names inside their card, the stand bar and the ladder heading.
- `src/lib/preview.ts`, `src/mock/{scale,firstRun,backend}.ts`, `src/shared/honesty.tsx`, `src/director/stories.ts`: `?scale=small|large`.

No money action, authority row or IPC command was touched.

## 5,000 deals: the wallet's reads (2026-11-09, sponsor round 2, WP3)

The wallet side of "1000+ rows". Measured on this machine (Windows 11, unoptimised test profile with
`CARGO_PROFILE_DEV_OPT_LEVEL=3`, so debug assertions stay on; a release build cannot be made here without
`TABLE_HOUSE_RELEASE_JSON`), in-memory SQLite, one call at a time. Other work was running, so a figure moves by tens of
percent between runs (two runs are given where they were taken); the ratios are the finding. Probes (ignored, not
gates): `cargo test -p table-ledger --lib -- --ignored --nocapture list_deals_timing_probe` and
`cargo test -p table-runtime --lib -- --ignored --nocapture tick_read_timing_probe`.

### The 1 s tick (publish pass and attention)

The reads at 500 and 5,000 deals. The ledger probe's deals cycle through every state (48% live); the runtime probe's are
90% ended, the realistic book:

| read | 500 deals | 5,000 deals |
|---|---|---|
| `list_deals` (the whole book; what the tick read every second) | 3.3 to 5.3 ms | 37 to 63 ms |
| `list_live_deals`, 48% live (ledger probe) | 1.9 to 2.2 ms | 18 to 23 ms |
| `list_live_deals`, 10% live (runtime probe) | 0.6 to 0.7 ms | 7 to 8 ms |
| attention built over every deal (before) | 36 to 73 ms | 584 to 653 ms |
| attention as it is built now | 35 to 38 ms | 390 to 417 ms |
| of which `forecast` (per live deal, about 0.8 ms each) | 41 ms | 388 ms |
| whole publish pass with nothing written (after) | 31 to 46 ms | 490 to 502 ms |

Before, a tick at 5,000 deals read the whole book twice (the publish diff, and the attention fold, which also makes five
queries per deal): about 710 ms of reads and folds in the 90%-ended book. Now a quiet tick reads only the live deals
(about 400 ms, nearly all of it the forecast). **What is still slow and not changed here:** `forecast` walks every live
deal with several queries each, so the tick is O(live deals), about 0.8 ms per live deal; at 500 live deals that is 0.4 s
of a 1 s tick. It needs its own change (cache by write count, or fold in SQL) and is the next cost to take.

What changed (table-ledger and table-runtime only; no wire shape, no money path):

- `publish` (actor.rs) reads the whole book only when something was written since the last whole read
  (`Ledger::change_stamp` = this connection's `total_changes` plus SQLite `data_version`, the same signal as the existing
  `write_count` gate); otherwise `list_live_deals`. No write means no row of an ended deal can differ, so what the client
  is told is the same.
- `attention` (dispatcher.rs) reads `list_attention_deals` (below) and `uniform_deal_currency` instead of every deal.
- The read-schedule prune in scheduler.rs reads `terminal_deal_ids` (ids only, no row decoded) instead of the whole book.

Guarantees that depend on ended deals, traced, and how each is kept:

1. The client is told of changes to an ended deal (a refund, a dispute, reporting matching its capture and a receipt
   evidence update all land on ended deals). Kept: any write since the last whole read makes the next pass read the whole
   book; a write by another connection is caught by `data_version`.
2. The attention snapshot counts REFUSED deals as stopped and lists MISMATCH, shield-held and "being checked with PayPal"
   deals whatever state they ended in. Kept: `list_attention_deals` returns every non-ended deal, REFUSED and MISMATCH,
   every deal with a shield verdict and every deal with an open money operation. The rest (ended, no hold, no open step)
   read as receipts, which the snapshot neither lists nor counts. The attention crate's test
   `an_ended_deal_with_no_hold_and_no_check_is_a_receipt_unless_refused_or_mismatched` pins that for every state, and
   `the_narrow_reads_agree_with_the_whole_book_read` pins the set (hold and open step included).
3. The snapshot's wallet currency is the one every deal shares (an ended deal in another currency makes it none). Kept:
   `uniform_deal_currency` is a `SELECT DISTINCT currency` over all deals.
4. The tick's prune of the read schedule drops entries of deals that ended outside its walk. Kept: `terminal_deal_ids`.
5. Not touched, because they are not on the tick and need the whole book: the client's `list_deals`, `rescue_book`,
   `quit_summary`, the mandate what-if (`simulate`) and the tests that list every deal.

### The Record (`audit_page`)

| | 500 deals (2,507 rows) | 5,000 deals (25,007 rows) |
|---|---|---|
| before: one page of 200, which verified the whole chain first | 21 to 26 ms | 254 to 289 ms |
| of which the chain walk (`verify_audit` alone) | 25 to 27 ms | 252 to 352 ms |
| after: first page once something was written (walks the chain) | 35 ms | 396 ms |
| after: a page with nothing written since (walk skipped), no filter, newest | 0.9 ms | 6.9 ms |
| after: the same, oldest first | 1.9 ms | 8.9 ms |
| after: filter `owner` (6,674 matching of 25,007) | 3.3 ms | 36 ms |
| after: a filter that matches nothing (full scan) | 4.7 ms | 79 ms |

Every "after" figure includes `total_matching`, a second statement over the same filter.

The page costs the chain walk, not the 200 rows. Integrity: `Ledger::audit_search` remembers the (`total_changes`,
`data_version`) stamp at which the whole chain last verified and walks it again only when that stamp has moved, that is
after any write to the database by anyone (an audit append, a raw edit with the triggers dropped, a change by another
process). Nothing is skipped on a guess: while nothing is written the chain is the same bytes. A failed check is never
cached (test `a_row_altered_after_a_good_read_fails_the_next_read_and_is_never_cached`). **The cost that remains, a
recorded limit:** while the wallet is writing (a live deal moving), each page after a write walks the chain again, 250 to
400 ms at 25,000 rows. An incremental verify (walk only the rows after a remembered head) would cut that but would not
notice an old row edited in place until the next full check; the append rule already accepts that trade at every 500th
row (owner decision, 2026-10-06), but the Record's "verified" claim is not mine to loosen, so it is left for the owner.
`history_rows` and the ledger's own `audit_page(before, limit)` are unchanged and still verify on every call.

Filter and sort run in SQL (`audit_search`), so a filtered or reversed list is about every row, with the true count. The
filter is one substring, ASCII case-insensitive, `_` read as a space, over the action, the actor, the status change
(`from`, `to`), the decision (`decided_by`) and the deal's stored item (`deals.item_ref`). The owner's words for these
(the Record shows "Paid" for a row that says `CAPTURED`) belong to the client and Rust does not know them, and a deal's
title is read from the market and never stored, so it cannot be searched here. The grid package maps typed words to the
stored vocabulary, or searches the rows it holds for those.

### The xl mock (`?scale=xl`)

`buildScaleState('xl')` is the large world (same first 500 deals and ids) plus 4,500 copies of its settled deals, each
with its own id, label, PayPal references, history steps, audit rows, category and rescue view, 2 to 89 days older than
the original: 5,000 deals, 42,680 audit rows, 36,717 history steps, about 25 MB of JSON, built in 86 ms
(`mock/scaleXl.ts`, `scaleXl.test.ts`). It holds nothing waiting for the owner beyond the large world's own 44 items. Its
state is larger than the browser's localStorage quota, so a second window does not see the first one's changes (each
builds its own xl); the first window works as usual.

## The 1 s tick stops scaling with the book (2026-11-09, A1)

The forecast, "the next cost to take" above, is now cached. Same machine and method as the section above: the same two
probes (`tick_read_timing_probe`, `list_deals_timing_probe`), unoptimised test profile with
`CARGO_PROFILE_DEV_OPT_LEVEL=3`, in-memory SQLite, the runtime probe's book 90% ended. The runtime probe gained three
lines (the forecast after a write, and the publish pass after a write). So the "before" column was **measured again**
with the extended probe on an export of the commit before this change (`git archive HEAD`), not copied from the table
above. Two runs each, a few minutes apart. Other builds were running on the machine.

| read | 500 deals before | 500 deals after | 5,000 deals before | 5,000 deals after |
|---|---|---|---|---|
| whole publish pass with nothing written (the quiet 1 s tick) | 38 to 50 ms | 1.9 to 2.4 ms | 398 to 406 ms | **10.6 to 13.6 ms** |
| attention as the tick builds it | 32 to 36 ms | 1.1 to 1.8 ms | 345 to 451 ms | 9 to 12 ms |
| forecast, nothing written since the last read | 32 to 36 ms | 0.33 ms | 349 to 446 ms | 0.36 to 0.40 ms |
| forecast, first read after a write | 37 ms | 11 to 14 ms | 341 to 437 ms | 147 to 160 ms |
| publish pass after one small write | 38 to 39 ms | 17 to 21 ms | 442 to 467 ms | 216 to 235 ms |
| `list_deals` (ledger probe, 48% live) | 3.6 to 4.7 ms | 2.2 to 4.4 ms | 53 to 56 ms | 58 to 59 ms |
| `list_live_deals` (ledger probe) | 2.4 to 3.2 ms | 2.2 to 2.5 ms | 27 to 28 ms | 28 to 29 ms |

The target was a quiet pass under 50 ms at 5,000 deals: it is 11 to 14 ms. `list_deals` did not move. Its SQL is built
at run time, so it was left alone.

What changed (table-runtime and table-ledger; no public type, command, event or wire shape):

- **The forecast keeps its ledger reads** (`table-runtime/src/forecast.rs`, `ForecastCache` on `Runtime`). It keeps
  each open deal's row, deadline, "let it lapse", whether its mandate still stands, label number, amount and
  seller-attested receipt time, keyed by the ledger's change stamp (`Ledger::change_stamp`, the same signal the
  publish pass uses) and the owner key. Any write by anyone drops it. It never keeps anything the clock moves. The
  pipeline's gates (the create gate and the seller-mandate window, which age with the market reference and the mandate)
  are judged at `now` on every read, with the signer selected first as the scheduler does. The walk-away fold
  (`table_attention::forecast`, unchanged) places every deadline against `now` on every read. So a deadline that passes
  between two ticks with no write changes the next tick's lines exactly as an uncached read would. The tests
  `a_cached_forecast_is_never_served_across_a_deadline` (an offer that lapses, an order waiting on the buyer that
  expires, with an unchanged change stamp between the reads) and `a_write_between_two_forecast_reads_is_seen_by_the_second`
  pin this. The signer is now selected only for the seller states that have a gate (Agreed, AwaitingApproval,
  Approved, Authorized): the other states never used it.
- **The publish pass reads no deal when nothing was written** (`actor.rs`). It used to read the live deals and
  serialise each one twice to compare. With no write, no row can differ, so it now skips the read. After a write it
  reads the book once and encodes each deal once, comparing that JSON with the JSON kept from the last pass. The
  comparison is the same as before, so the same events go out:
  `publish_sends_the_same_deal_and_receipt_events_as_the_whole_comparison` runs the old whole-book comparison beside
  the pass for no change, a write that changes no deal, a deal added, a deal changed and a deal ended.
- **Cached statements** for the static per-deal reads on the tick (`prepare_cached`): deal by id, deadline, label
  number, preference, category, mandate (active check and row), open money operations, receipt evidence and first
  receipt, last proposal, negotiation status. SQL built at run time (`list_deals`, `list_live_deals`) is unchanged.

**What still costs, a recorded limit:** the first tick after a write still reads every open deal's facts again
(147 to 160 ms at 500 open deals) and the whole book for the diff (about 50 ms). So the tick right after a write costs
about 0.2 s at 5,000 deals; every quiet tick after it costs about 12 ms. A seller deal in a gated state also pays its
gate on every tick (one `step_allowed` for Agreed, about 20 for the seller-mandate window's binary search). The probe's
book has none of those, so that cost is not measured here. It grows with gated seller deals, not with the book. The
settings read (three keychain reads in the app, a memory vault here) still runs twice per tick: once for the forecast's
"payment executor configured" and once for the settings event.
