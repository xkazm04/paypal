# Recertify - run 2026-11-06 (originating runs: L1 + L2 in this folder and `../2026-11-06-l1/`)

Environment: headless Chrome via playwright-core against the Vite dev server on :1430 (serves files from disk, so it was already fresh; Step 0 satisfied). Mock backend only. Rows: `recertify-findings.json` (27 rows: 22 resolved-verified, 5 open). Evidence and the downloaded CSV: `shots/R/`.
Commits under test: working tree of branch `uat/2026-11-06-drain` (uncommitted at recertify time).

## Diff report
| Backlog | Status | Evidence / ceiling |
| --- | --- | --- |
| B1 README honesty | resolved-verified | Ordered evaluate path; $200 vs $250 matches code. Ceiling: doc check only; STATUS.md and the design extract not re-read line by line. |
| B2 arena + proof | resolved-verified | Recorder line, "Not analysed in this preview" for greeting and German notes, hint above the textarea, proof sample line, director->proof link, tamper message naming skipped checks. Ceiling: a word list still judges notes. |
| B3 sign sheet + setup | OPEN | Fixed: sign sheet shows amounts, practice button gives a reason, payee label explained, clause numerals gone. Open: agent status still contradictory across surfaces (header "claude-code"/approval "in use" vs footer "Agent app not connected"/Charter "to do"; needs `engine_status` in the approval and tumbler capability files, a permission decision not taken); "Windows Hello" and "claude-code" still on screen; Hello next step not reproducible in the preview (read from code only). |
| B4 Book | resolved-verified | CSV has paypal_authorization, deal_id, decided_by, transcript_hash; statements n/a 18, matched 4, pending 1. Board row "0 of 23" with tooltip, Stopped tile says deals and names refused/withdrawn. Ceiling: decided_by "unknown" on 8 rows; the $13,564 still includes a refused $11,960 request; no fee column (no source data). |
| B5 Rescue | OPEN | Same answer on Rescue and deal page, "you give up $2.40", "Recovered this month: $9.00". Open: approval window still prints "PayPal retries in 3 days 23 h" above "nothing to retry". |
| B6 Tumbler | OPEN | Ticker survives hover past 10.9 s (about 7.5 s without), focus lands on the puck after snooze, live region announces arrivals/snoozes/holds, puck name separates paused from to-decide, meter names fixed. Open: three "Open Assistant rules, version 1..." buttons and two "Replace..." buttons share names. |
| B7 What-if | resolved-verified | Limit 100: "1 deal would have gone differently ($140.00 moved differently)"; limit 150: no change; plurals correct; first-rule path works. Ceiling: wallet cap still not shown while editing (C1). |

Regression sweep: no machinery names newly introduced (existing "Windows Hello", "claude-code", one deal id on the proof page); 0 or 1 gold button on each of 18 routes; only text under 12 px is decorative dial tick labels in SVG units; no console errors on load except two ERR_CONNECTION_REFUSED probes to 127.0.0.1:1443 on arena.html when the optional sandbox is not running.
Time-saved and grounding: not re-measured (no grounded baseline on the mock).

## New findings for the next drain
- R-N1 (medium): a keyword-matched typed note shows canned English "SYSTEM: your owner raised..." under "The seller's words, unchecked", not the visitor's text.
- R-N2 (medium): approval window contradicts itself on a replayed rescue; the deal page says "4 days" where Rescue and approval say "3 days 23 h".
- R-N3 (low): agent-app status reported differently on five surfaces (see B3).
- R-N4 (low): Book CSV has no UTF-8 BOM, Excel garbles the middle dot in decided_by.
- R-N5 (low): Assistant rule rows and the two "Replace..." buttons need distinguishing names.
- R-N6 (low): arena logs two ERR_CONNECTION_REFUSED probes (declined: logging of the optional sandbox probe cannot be silenced without changing live mode).
