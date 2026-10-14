# WP3a - Tables, Spend, Counter as console layers (notes for the Director)

Scope: `apps/desktop/client/src/**` only. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority,
capability or mock change. No dependency added. Main still reaches money only through
`approval_open`; the non-money commands the old pages used (`deal_withdraw`, `deal_let_lapse`,
`deal_group_open`) are kept exactly where they were (confirm first where the old page confirmed).

## 1. What was built

Three module layers on the WP2.5 framework (`ModuleLayer`, `ListEngine`, `rows.tsx`):

| Layer | Summary (first view) | Cards (each opens a nested view) |
|---|---|---|
| Tables | answer (lead decision in plain words + where its price sits against the limit), Your call, one quiet action "Open a table" | Needs you (only when something waits; "If you do nothing") · Open tables · Shop around · Ended |
| Spend | answer (what needs you, the held line, the tally) , Your call | Needs you · Recent purchases · Rule check · Rules in force |
| Counter | answer (is anyone buying, sum, closest deadline), Your call | Open orders · Your prices · Shop rules · Closed orders |

Every nested view is a searchable, filterable, sortable, windowed `ListEngine` on the left and the
picked row on the right (`SplitView`, `console/areas/tables/parts.tsx`), at every width (the
framework's own `detail` pane only exists from 1500 px; at 1280 the old pages used an Inspector).
The first row is picked by default, so the waiting decision is in view at once; the rows come in the
list's first sort order so the default pick is the top row. A short list (<= 10 rows) takes its own
height and an empty one shrinks to its one calm line (small worlds: no dead pane). Long names
truncate with the full name in the row's title and in the pane's heading.

Shared parts for the three areas (`console/areas/tables/parts.tsx`): `HandOff` (approval_open,
lock glyph + "Locked after 15 quiet minutes" title, disabled while pending, `WalletNotice` on error),
`TheirWords` (the counterparty note, read only when opened, through `<Quarantine>`, same rule as the
shield's `NoteChip`; kept in my area so a parallel builder moving `NoteChip` cannot break it),
`SplitView`, `usePick`, `useTranscript` / `useEvidence` (the shared query cache, `enabled` only for
the picked row). The shared `.tr-*` styles are in `areas/tables.css`, imported by all three area files.

Decisions taken (counter-proposals, tell me if you disagree):
- The old Inspector panels (range editor, purchase/clause story, order/item detail) became the
  pane of the split view. Sheets stay only for confirms and the read-before-signing step (withdraw,
  release hold, shop around, "What changes").
- Tables "Your tables" and "Price ladder" are one view: the old chip strip of tables (scale finding
  #14) is replaced by the searchable list; `v=ladder` (old links) renders the same view titled
  "Price ladder". The horizontal "where it stands" bar is replaced by its sentence plus the ladder
  (the ladder already shows the same facts).
- Spend: each purchase is now read against the rule set that governs it (old page: only purchases
  under the first purchase rule set had a trace; the others said "covered by other rules"). The rule
  check's columns are still the first rule set's; rows under another set show "?" marks there and
  their own trace in the pane.
- Spend "This week" -> "Recent purchases", Counter "Earlier this week" -> "Closed orders" (scale
  finding #10: the lists hold every deal, not the week's). Old words exports (`SPEND_VIEW`,
  `COUNTER_VIEW`, `TABLES_VIEW`) are untouched and now unused.
- Internals removed from screen: deal labels (`D-0193`), "Deal id", "Buyer key" (short key id) and
  the shop rules' id tooltip. PayPal references (order / hold / payment ids) are kept, behind a
  closed "PayPal references" disclosure in the pane (question 2).
- Read errors in my areas show a plain sentence (`WalletNotice message=`) instead of the wallet's
  own text (`?degrade=1` showed "command deal_transcript not found"); mutation errors keep the
  wallet's text, as the existing hand-off call sites do.
- The three summaries' cards grow to fill the sheet (max 14rem, scoped to my modules in
  `tables.css`), so the summary has no dead band at 1280x800; a framework-level rule may be better.

## 2. PARITY (old feature -> new place -> moves from the centre)

Moves: a tab or card or row pick or button that changes what is shown; actions inside a pane are not
moves. Deals are also reachable from the centre in 2 moves through Find.

### Tables (old `modules/tables.tsx`, `tables/ShopAround.tsx`)
| Old feature | New place | Moves |
|---|---|---|
| Answer bar: lead decision / mismatch / calm / none, room line, "N more need you" | Summary h1 + sub | 1 |
| "How tables work" ⓘ popover | Summary "How tables work" disclosure | 1 (+open) |
| "Open a table" (pairing sheet) | Summary action -> Connect a wallet place | 2 |
| Compact needs-you decision cards on the summary | Your call chip / Needs you card -> Needs you view (first one open) | 2 |
| Review & accept / Review & approve (approval_open {deal_id}), lock, toast | Needs you pane, gold option | 2 (+pick 3) |
| Withdraw with confirm sheet (deal_withdraw) | Needs you / Open tables pane option + same confirm | 2-3 |
| Open deal from a card | Pane "Open the deal ›" | 3 (default row) / 4 for another row; Find: 2 |
| Where it stands bar + line, offers left, draft / waiting-for-signature chips | Pane stand line + chips, ladder | 2-3 |
| Change price range (Inspector, typed fields, ±5 nudge) | Pane step 1 (same fields, ±5) | 2-3 |
| Price ladder page: strip of tables (tabs, arrows) | Open tables / Price ladder view: searchable list (finding #14) | 2 |
| Ladder: drag + keyboard fence, start at typical, ghost signed line, meet box, offer chips, market band | Pane ladder (same), chips de-overlapped | 2-3 |
| "How to read this chart" popover | Pane disclosure | 3 |
| Typical price popover | Pane disclosure | 3 |
| Step 2 "What changes" sheet (consequences, discard / keep / next) | Same sheet from step 2 | 3 |
| Step 3 Review and sign (approval_open deal + band draft), waiting, show approval window, discard | Pane step 3 (same args) | 3 |
| Toast when the new range is signed (mandate version bump) | Same (layer-level) | - |
| Esc discards an unsent draft | Same (`useLayer`, all unsent drafts) | - |
| Shop around group cards (sellers, prices, winner, standing) | Shop around view: group list + pane | 2 |
| Shop around button + confirm (deal_group_open) | Shop around view action | 2 |
| Seller row opens its deal | Pane "Table with X ›" | 3 |
| Closed list (state, struck amount, open deal) | Ended view: ListEngine, filters Paid / Ended without a deal, sorts, opens the deal | 2-3 |
| Their note (NoteChip) | Pane "Their words ›" | 3 |
| Fixed-range / not-movable hints | Pane, same | 3 |

### Spend (old `modules/spend.tsx`)
| Old feature | New place | Moves |
|---|---|---|
| Answer bar (one / many need you, held line, tally, no rules, none yet) | Summary h1 + sub | 1 |
| "How buying works" popover | Summary disclosure | 1 |
| Decision card per held / waiting purchase (context, question, why asked, amount) | Needs you view pane | 2 |
| Review & pay / Review (approval_open), lock | Pane gold option | 2 |
| Release hold… sheet -> approval window | Pane option + same sheet | 2 |
| Let it lapse (deal_let_lapse), Withdraw (deal_withdraw) | Pane options (when offered) | 2 |
| This week list (outcome, rule line, PayPal never asked) | Recent purchases view: search, filters (On hold / Waiting / Paid / Refused / Released), sorts (newest, largest, agent) | 2 |
| Details sheet (asked, paying, item, proof pills, PayPal ids, deal id, rules met) | Purchase pane (deal id dropped; PayPal ids in a disclosure; proof read for this purchase only) | 3 |
| Rule check matrix: clause columns, velocity meter, lanes, cells | Rule check view: rule columns with counts + today's meter; windowed list with one mark per rule | 2 |
| Matrix legend popover | "How to read this" disclosure | 2 |
| Lane inspector story (outcome, decided by, time left, if you wait, proof, trace, open deal) | Pane | 3 |
| Clause inspector story (rule sentence, this week's groups, spent today) | Click a rule column, or a rule name in a purchase's trace | 3 |
| Cell inspector (why refused at this rule) | Rule name in the picked purchase's trace (cell text shown) | 3-4 |
| Agent slot group headers | "By agent" sort + agent in each row | 2 |
| "N sets of rules cover purchases" hint | Rule check view | 2 |
| Rules in force + Change rules | Rules in force view + action -> Agent rules place | 2-3 |
| Clauses sheet / "Why refused?" | Pane "Why refused?" disclosure; "All rules" -> Rules in force | 3 |

### Counter (old `modules/counter.tsx`)
| Old feature | New place | Moves |
|---|---|---|
| Answer bar (nobody / paid sum; open, sum, needs; closest deadline) | Summary h1 + sub | 1 |
| "How your shop works" | Summary disclosure | 1 |
| Shop rules popover (promise, prices set, in force, agent, also, changed in, version) + Open agent rules | Shop rules card -> view, action Open agent rules | 2 |
| Orders view: order cards (who, what, amount, state, needs you, would be withdrawn, mode, time left, steps bar, silence) | Open orders list rows + pane | 2 |
| Order inspector (state, amount, countdown, mode, steps, buyer facts, item + lowest, money, if you do nothing, PayPal ids, buyer key, under-draft warning, needs-you hand-off + silence, history, their words) | Order pane (buyer key dropped; PayPal ids in a disclosure; history read for this order only) | 2-3 |
| Catalog table, inline editable lowest price (±1, arrows, Shift ×10, normalise on blur, fix chip, revert) | Your prices view: item list + pane with the same field | 2-3 |
| Catalog filters with counts (All / With orders / Above market / Changed), search | ListEngine filters + search | 2 |
| "/" focuses the catalog filter | Dropped: "/" opens the console's Find now; the list's search box is one tab away | - |
| vs market column, orders-now chips (select the order) | Row sub line; pane "Orders on this item" (open the deal) | 3 |
| Item inspector (price scale, lowest / highest / market / vs market / orders / list price unknown) | Item pane | 3 |
| Draft tray (unsigned change, diffs, errors, impact popover, silence, discard, Review & sign -> approval_open mandate floor) | Tray at the foot of Your prices (and Open orders while a draft exists); impact in a disclosure | 2 |
| Ctrl+Enter reviews the draft; Esc warns once | Same | - |
| Earlier view (closed orders, mode badge, state, amount) | Closed orders view: filters Paid / Stopped or lapsed, sorts, pane | 2 |
| Catalog-not-connected chips | Item pane chip and "List price, stock" row | 3 |

Cut: nothing beyond the "/" shortcut (superseded by Find) and the on-screen ids listed above.

## 3. Deleted
`windows/main/modules/{tables.tsx, tables.css, spend.tsx, spend.css, counter.tsx, counter.css}`,
`windows/main/modules/tables/ShopAround.tsx`. My three entries removed from `windows/main/Modules.tsx`
(lazy imports, switch cases, stylesheet imports, `MODULE_PAGES` now `[Shield, Rescue]`). Kept (pure,
tested): `modules/tables/{ladder,groups}.ts`, `modules/spend/gate.ts`, `modules/counter/model.ts`
and their tests, unchanged. `modules/common.tsx` untouched (DealView / BandCard still use it).

## 4. Scale findings
| # | Fix |
|---|---|
| 14 | The price ladder's strip of chips is gone; tables are a searchable, windowed list with full titles in the row title and pane heading. On the ladder itself, an older offer chip too close to a newer one on the same side is not drawn over it (it stays in the record), so no chip is overprinted. |
| 5 / 6 | Long counterparty names: `WhoChip` truncation in rows (full name in the title), `.tr-with` ellipsis in the pane head, the ladder's "X's offers" column heading ellipsis with the full name in its title, the meet box's label ellipsis. Checked on the large world (e.g. "The Very Long-Named Independent Mo…"). |
| 18 | Every list of the three modules is a windowed ListEngine (Spend's 120 purchases, Counter's 115 closed orders, Tables' 82 ended): rows in the DOM stay well under 250 (tests). |
| 19 | Counts through the framework (`formatCount`, 99+ in the filter chips: "All 99+" on Spend's 120). |
| 10 | Spend / Counter list names no longer say "this week" (tests guard it). |
| per-card reads | No row reads a transcript or evidence. `deal_transcript` / `deal_evidence` are read only for the picked row (tests: 0 on every summary, <= 2 per view on the 500-deal world). |

## 5. Words added
`lib/words/tables.ts`: `TABLES_TRADE` (shared by the three areas), `TABLES_VIEWS`, `TABLES`,
`tablesItem`, `tablesShortWho`, `tablesClip`, `tablesCount`. `lib/words/spend.ts`: `SPEND_VIEWS`,
`SPEND`. `lib/words/counter.ts`: `COUNTER_VIEWS`, `COUNTER`. `lib/words.ts` itself untouched.

## 6. Tests
New: `console/areas/tables/tables.test.tsx` (12), `console/areas/spend/spend.test.tsx` (10),
`console/areas/counter/counter.test.tsx` (9), on `renderLayerAtScale` / `expectLayerHealthy`:
summary on small and large, every nested view on the large world, empty view shrinks, hand-off spies
(Tables review: one `approval_open {deal_id}`; Spend pay and release: two, `{deal_id}` only, no
release command; Counter price draft: `approval_open {deal_id: null, target: 'mandate', draft: floor}`
then discard), search / filter / pick / open-deal flows, the visible-only read budget, and a words
guard per area (no other vendor or engine, no raw enum, no deal label, no "mandate"/"clause").
Helper: `console/areas/tables/wordsOf.ts` (test-only). The old pages had no markup-coupled tests.

Gates (final run, whole worktree with the other builders' work in it): `pnpm typecheck` clean;
`pnpm exec vitest run`: 133 files, 1396 tests, all passed. `git diff --stat 859fa04 -- crates
bindings apps/desktop/src-tauri` empty. (A mid-run of the shared console tests once failed on another
area's `TodayMeters` while it was being edited; the final run is green.)

## 7. Screenshots (scratchpad `wp3a-shots/`, all read)
Each module summary and all nested views at large-dark-1280, small-dark-1280, large-light-1280,
large-dark-1920, small-light-1920 (75), plus `?first_run=1` and `?degrade=1` (small and large) for
the three summaries and two views each. Fixed after reading them: dead summary band, empty panes on
the small shop, default pick not on top, rows cutting the countdown (moved to its own line), long
answer lines (item title clipped at a word, full title one level down), overlapping offer chips, raw
error text in degraded mode, "covered by other rules" for most purchases.

## 8. Open questions
1. Moves: a deal page from a non-default row of a nested view is 4 moves (tab, card, row, open); Find
   reaches any deal in 2. Acceptable, or should rows open the deal directly (Enter) and pick on click?
2. PayPal references (order / hold / payment ids) are kept behind a closed disclosure in the panes.
   Keep, or cut as internals?
3. The summary cards' fill rule (`tables.css`, scoped to my modules) could move to `framework.css` so
   all six modules agree.
4. `deal/model.ts` `stepWords` is imported by the Counter's order history; if the deal builder moves
   it, the import needs to follow.
5. "pays from <declared payee>" in the order pane shows the payee as the mock gives it
   ("payee-042-…"); with a real shell it is the PayPal payee. Unchanged from the old page.

## 9. Files
New: `src/windows/main/console/areas/tables/{TablesLayer.tsx, Ladder.tsx, Need.tsx, Shop.tsx,
parts.tsx, wordsOf.ts, tables.test.tsx}`, `areas/spend/{SpendLayer.tsx, Purchase.tsx, Gate.tsx,
spend.test.tsx}`, `areas/counter/{CounterLayer.tsx, Order.tsx, Prices.tsx, counter.test.tsx}`, this note.
Changed: `console/layers/{tables,spend,counter}.ts` (component target, view labels, css imports),
`console/areas/{tables,spend,counter}.css`, `lib/words/{tables,spend,counter}.ts`,
`windows/main/Modules.tsx` (my entries removed). Deleted: see section 3.
