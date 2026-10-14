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

| # | surface | scale | what happens | severity | fixed? |
|---|---|---|---|---|---|
| 1 | Every window that reads deals (Main) | large | `deal_display` is read for every deal on opening (500 reads, 8 at a time) and nothing was shown until the last one landed, so every label, band and title stayed on its fallback for about 2.7 s | high | **Yes.** `windows/main/displays.ts`: reads go out in batches of 100, live deals first, each batch is shown when it lands. Pages that need the display now show their content in 1.3 to 1.7 s instead of 3.8 s. Cost: the page re-renders 5 times, so total main-thread script on list pages rises by about 0.2 s |
| 2 | Tables (Needs you, Your tables, Price ladder) | large | While the displays were missing, a table that does have a signed price range read "No price range yet" and "You haven't set a limit yet, so your agent can't make offers": a wrong statement for the first seconds | high | **Yes**, by fix 1 (the real band arrives in the first batch for live deals) |
| 3 | A deep link `#d=<label>` (the director, a typed address) | large | Showed "This deal isn't here any more" until every label had been read, because a label is only known from its display | high | **Yes.** `App.tsx`: shows "Loading the deal" until the labels are in (`displaysReady`). An ended deal opened by its label still waits for the last batch (3.7 s); a link by id is instant |
| 4 | Book > Ledger > Audit trail | both | The sheet's first read can run twice, so the first page listed twice and React warned about duplicate keys (5,000-row world: 50 rows doubled) | low | **Yes.** `book.tsx`: a row already listed is not added again |
| 5 | Tables cards, Needs you cards | large | A long counterparty name pushed the "where it stands" label and the card's time left outside the card; the name's label was cut at the window edge | medium | **Yes.** `tables.tsx` / `tables.css`: the name gives way with an ellipsis (full name on hover), the price and the time stay |
| 6 | Tables > Price ladder | large | A long counterparty name ran over the "Typical price" column heading | medium | **Yes.** `tables.css`: the heading ends with an ellipsis, full name on hover |
| 7 | Book > Ledger, the Deal column | large | At 1280 px every column is already at its minimum width, so the Deal cell is 74 px and reads "D-141...", "D-142...": the label cannot be told apart | medium | **Partly.** The full "label, title, counterparty" is now the cell's hover text; the layout is unchanged (a wider cell makes the table scroll sideways) |
| 8 | Book > Outlook | large | "7 holds to decide $1,250.00 6 h 30 min left" shows the count of 7 next to the soonest hold's amount; the 7 holds are $59,247.90. Reads as a total | high | No (a wording and design decision) |
| 9 | Header meter "paid out today" | large | Reads $64,214.60 "paid out today, of $250,000 a day". The figure counts money on hold and committed (the $48,000.00 hold is in it) while Book shows $3,407.63 paid out this week. Same number in the Tumbler | high | No (wording of a money figure; it follows the exposure fold) |
| 10 | Spend "This week", Counter "Earlier this week", Rescue and Shield lists | large | The pages are titled by the week but list every deal of the module over 90 days (Counter goes back to 15 Sept, Spend lists 120 purchases) | medium | No |
| 11 | Home dial | large | The 111 deals of the week draw as overlapping beads: smears on the track, the individual states cannot be read. The badges (20, 10, 7, 6, 1) are fine | medium | No |
| 12 | Rescue > Needs a fix / Recovered money | large | 20 full cards make a page 9,854 px tall (recovered money 8,839 px); no filter, sort or paging | medium | No |
| 13 | Shield > This week | large | The evidence matrix adds one 150 px column per paused or blocked payee (17 columns, 3,527 px) and scrolls sideways inside its pane; the row labels stay | medium | No |
| 14 | Tables > Price ladder, the strip of tables | large | 12 tables as chips cut to "Ne...", "Re..." that cannot be told apart; the strip scrolls sideways | medium | No |
| 15 | Settings > Agent rules | large | "3 agents, 8 rule sets": the three Shopper cards (and the two Negotiator, two Assistant ones) have no name beyond the slot, so they cannot be told apart. 12 agent keys exist; the screen knows three slots | medium | No |
| 16 | Book > Audit trail | large | 5,000 rows are read 50 at a time with "Older"; no date jump or filter; the DOM keeps growing (6,500 nodes after 315 rows). Reaching the oldest row is 100 clicks | medium | No |
| 17 | Book > Ledger evidence | large | `deal_evidence` is read for every deal on the first Book open (500 reads, 8 at a time); the PayPal statement chips show "..." meanwhile, and the ledger settles in 2.0 to 2.4 s against 1.0 s | medium | No. Needs one batched read (a new IPC command); `evidence.ts` already names this |
| 18 | Home, the lists | large | Nothing is virtualised: about 3,000 nodes and 0.5 to 0.7 s of script on load (0.1 s small). Fine today, the next 10x is not | low | No |
| 19 | Counts and badges | large | The largest waiting count is 44 (Tumbler puck, Home list). No count has a "99+" treatment anywhere in the code, so a count past 99 is untested; a 3-digit Book count (500) fits | low | No (99+ cannot be reached by waiting items in this world; the lists that pass 99 are deals, rescue cases, counterparties and ledger rows) |
| 20 | Director (`director.html?scale=`) | both | The three framed windows load the chosen world, but the story's beats are written for Maya's deals: the first beat throws `no deal D-0193` and the film stays on "Setting the table..." | low | No (`src/director` is outside the windows) |
| 21 | Tumbler preview stage | both | Its preview controls name Maya's `D-0193`, which the scale worlds do not have | low | No (not exercised at scale) |
| 22 | Small world, every page | small | Nothing wrong: Tables is empty and says so with an "Open a table" action, badges read 0, 1, 6, 12, 1, 1; the Set up page shows "3 of 5 done" | none | n/a |
| 23 | Approval window, the Tumbler's four forms, Set up page, the sheets | large | Nothing wrong at this size, including the $48,000.00 hold's button text, a 40-round haggle, a mismatch, a scam-check pause | none | n/a |

Not looked at: dark vs light theme (dark only), widths other than 1280, a real keyboard session, the
native shell (nothing here was run in it), more than 500 deals.

## What changed in the code

Only `src/windows/main/**` (fixes 1 to 7), plus the mock and the preview switch:

- `displays.ts`, `world.tsx`, `App.tsx`: progressive display reads, `displaysReady`, the deep-link wait (`displays.hook.test.tsx` pins it).
- `modules/book.tsx`: no duplicate audit rows; hover text on the ledger's Deal cell.
- `modules/tables.tsx`, `modules/tables.css`: long names inside their card, the stand bar and the ladder heading.
- `src/lib/preview.ts`, `src/mock/{scale,firstRun,backend}.ts`, `src/shared/honesty.tsx`, `src/director/stories.ts`: `?scale=small|large`.

No money action, authority row or IPC command was touched.
