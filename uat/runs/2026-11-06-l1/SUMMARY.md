# UAT run 2026-11-06 - L1 summary (10 Characters, 10 journeys)

Run header: registry: declared, see `.ai/manifest.yaml`; mode: `update` (overlay existed with 3 Characters; 7 added).
Per-Character reports and findings sit beside this file; `findings.all.json` is their union (129 rows: 38 major, 52 minor, 34 strengths, 5 other).
L2 results: `uat/runs/2026-11-06-l2/` (merged into this summary at drain time).

## 1. Scorecard
23 Character x journey cells: **9 L1-pass, 13 L1-conditional, 1 L1-fail**.
The one fail is Dan on `counter-shop-and-wallet` (DAN-L1-07: the shop for other agents is not built). DAN-L1-01 is a major inside a conditional `haggle-and-watch`, not a second fail.
Passes: Maya (onboarding, gated spend, haggle, tumbler), Grace (gated spend), Chen (haggle), Dan (attack-the-table). Everything else is conditional.

## 2. Backlog, impact-ranked (frequency x reachability x trust erosion; uncertain findings halved; no recurrence data yet)
1. Reconcile README, STATUS and the design report: rescue is partial, deferred items listed, one status date, film pointer fixed. Docs only. (CHEN-01,-02,-07,-08; JUDGE-02,-03,-06)
2. Zero-install or ordered evaluator path with a next step. (JUDGE-01,-04,-05; CHEN-03,-04; OMAR-03)
3. Disclose recorded and simulated answers on the arena and proof pages; fix the "asks for nothing an agent could try" copy. (SAM-01,-02,-03; JUDGE-07; CHEN-05,-06)
4. Unblock first run for a non-technical owner: payee code, dead practice step, empty engine list, Windows Hello dead end. (OMAR-04,-02,-01,-05,-09)
5. CSV: add decider, hash, authorization id, deal ULID; statement column. PayPal fee gap (PRIYA-01) is blocked on live PayPal data. (PRIYA-02,-03,-05,-06)
6. Remove machinery names from user strings: clause numerals, deal labels, key hash, "Windows Hello". (six Characters; MAYA-01)
7. What-if in dollars: total plus the sign sheet. (MAYA-02, TOM-04, OMAR-08)
8. Show the wallet cap while editing a rule. (TOM-01; not reproducible on the mock)
Also carried: MAYA-09 Spend pane says "on hold at PayPal" unconditionally (trust); Rescue lever cost and monthly saved figure (LENA, MAYA-04/05); Tumbler announcements, ticker pause and 200% zoom (GRACE-01,-02,-03); wallet-seller never counters, physical-goods capture is manual (DAN-01,-06).

## 3. Reconciliation sweep (18 mismatches; 17 verified, 1 carried)
- Human-present threshold is a per-mandate clause, not a constant: sandbox $200 (`crates/table-sandbox/src/lib.rs:50`), recorded mandate $250, unexplained; the sample shopper set's $250 ask-above exceeds its own $200 per-purchase cap.
- Built vs deferred: README says B0-B8 built; STATUS defers rescue, catalog, crash-gap recovery.
- Dates: README 2026-10-08, STATUS header 2026-10-06, entries to 2026-11-03.
- "No-install" has three definitions; README points to `film/` with no tracked recording.
- UX-GUIDE contradicts AGENTS.md on "Windows Hello" and clause numbers.
- Onboarding: docs say four steps, Charter shows five lines. `words/setup.ts` is an empty stub with a header claiming all setup strings.
- Held-state vocabulary overlaps ("Holding", "On hold", "Held"); "On hold at PayPal" unconditional.
- Four money formatters; "this week" differs by surface.
- Counter-shop docs describe a shop the code does not have; guide says windowed lists, code pages at 20.
- Deal id format agrees across Rust, mock and docs (clean).

## 4. Value ledger (estimated, mostly assumption-based baselines)
Priya ~1.5-2 h of ~3 h; Lena ~1.5 h/month of ~3 promised; Tomasz ~3.5 h/week (sign-rules), ~1 h (counter); Omar ~0 today (3-4 h/week if the practice flow worked); Judge 60-90 min; Chen ~70 min if docs reconcile; Sam ~13 h of ~16 h; Grace ~3 min per decision. Confidence low to medium throughout.

## 5. Strengths to protect (constraints on any build)
Floor secrecy and the single clause-4 check on offer/accept/create/authorize/capture (Dan); no money-moving tool, zero PayPal calls on refusal, arena cards pinned to `arena.json` (Sam); one gold button per view, hold-to-confirm with Space, snooze cannot hide a deadline (Maya); 9 of 9 icon buttons named, focus styles on all `outline:none` rules (Grace); director sample-data banner and captions pinned to `haggle.json` (Chen); unknowns dashed not zero, Book totals equal deal-page sums (Priya).

## 6. Honest ceilings
Mock backend only: no real PayPal, no native shell, no screen-reader session; Rust-side behaviour (wallet cap, TOM-08) not reproducible in the preview; Character baselines are assumptions.

## 7. Panel verdict
"The safety story is real and provable; the first ten minutes and the paperwork around it are where a stranger gets lost or stops believing."

## 8. L2 plan
14 live checks ordered by impact (arena notes, disclosure pages, clause numerals, what-if, first-run, CSV, rescue, Tumbler, `?scale=large`, tamper); 12 groups not reproducible on the mock (TOM-01, TOM-08, OMAR-02/-05/-09, Dan items, screen-reader). Running as passes A and B.
