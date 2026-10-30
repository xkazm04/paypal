# Sequencing proposal: The Table, 2026-10-29 to the Devpost close

For the owner to decide. **Decisions recorded 2026-10-30 (standup): D1, D2, D7 decided; D3-D6, D8, D9 still open.** It proposes an order and one cut line. It changes no
STATUS, DECISIONS or backlog entry; the open decisions in the last section are yours. Evidence is read from
git at `300773a` (main tip). The last commit that is not a registry-map chore is `e36e104` (2026-10-24).

## Executive summary

1. Waves 1-3 of the submission cut are merged, rescue's one lever included (DECISIONS §1; commits below). What is left is mostly verification, publication and the film, not features.
2. The film is recorded at the end of the project, date set by the owner (D2), from what is merged; the film freeze (D7) moves with it.
3. Before the film, which comes at the end of the project (D2): re-cut the film's haggle prices to the ones the engine signs (`614ed59` shows the film's current offers fail). It's a builder S, and it waits on your yes.
4. Before recording: one native UAT smoke on your Windows desktop (STATUS:2561, still open). The README sends judges to `cargo run -p table-desktop`, which has never been run interactively.
5. Recommended live evidence: spike 3 only (seller authorize and capture, USD 1.00 sandbox). You run it with your own keys (DECISIONS §44).
6. Publication: you decide the P-1 history question (DECISIONS §42 item 3), then make the repo public by Nov 4. After that, a clean-machine README dry run from the public clone.
7. Submit on **Nov 11**, a day ahead of the 2026-11-12 14:00 PT close.
8. **Below the line (post-submission):** HOUSE deploy on Render, spikes 1, 2, 4, 5, 7 and 8, the claude-code and codex-cli engines (T3), wave 4, the council and tiger residuals, the scan-sweep hand-offs, and M2 completeness.
9. The film and the judge path run on the browser mock (DECISIONS §42 item 1; `film/hero/README.md`). Nothing above the line needs a deployed HOUSE or a real engine.
10. Of the 9 decisions (D1-D9, at the end), D1, D2 and D7 were taken on 2026-10-30; D3 is undecided and D4-D6, D8 and D9 are open.

## Recommendation

**The cut line:** ship R1-R11 (spike 3 included). Everything from R12 down is post-submission.

Reasoning:
- Devpost needs a public repo, a video under 3:00 and setup instructions. R1-R11 are exactly what those three need.
- The film is cut from the director on the mock (`film/hero/README.md`, 2:49 silent draft at `7f1d378`). So no HOUSE, engine or live spike changes what the video can show.
- The HOUSE deploy is L-sized and operator-only. It touches the money path, its Render cost is unverified (STATUS:948) and it needs new code (§42 item 2 OPEN). The README already says honestly that it is not deployed (README:71).
- The engines need spikes 1 and 2, the §21 conditions and an 8-day T3 (backlog §1a row 3). That doesn't fit in 13 days.
- Native UAT is the one large unknown on the judge path. It goes first, so any fixes it finds land before the film freeze.
- Spike 3 is a small piece of your time and the only live proof of the core claim, "settled by PayPal". The other spikes only add rows.
- The residuals are real, but none is on what the film shows. C5 and C6 touch intake and countersign, and that is money-path work that shouldn't go in 7 days before a freeze.

## What is already done (not inventoried)

| Item | Evidence |
| --- | --- |
| Wave 1 (T1, T2, T4, T5, T10) | STATUS:2544-2547; T1 v2 `24b9f84` |
| Wave 2 (T6, T7, T11, T12) | T6 `3e75215`, T7 `aaec457` (met under §42 item 1), T11 `cdf60f2`, T12 `d496eb1` (STATUS:2556-2557) |
| Wave 3 (T8, T9, T14, T15) | T8 `f8653eb`/`0c04af2`, T9 `d041ca9`/`62c7d01`, T14 `cac2633`/`ceefb45`, T15 `5221f8f..97da5a2` (STATUS:1610) |
| Rescue lever DISCOUNT_THIS_CYCLE, offline | `406872e..24fca28` (STATUS:1593); the live spike 8 is still owed |
| Submission cut and post-submission themes | DECISIONS §1; STATUS:2548, 2558 |
| P-1 cut at the tip | `38d4b8d`, `15f5d08` (DECISIONS §42 item 3). History is not done: R9 |
| Relay exhaustion fix, deploy file fix, no-relay words | `ad2ef32`, `4909d48`, `dd6f363` (§42 item 2) |
| Spike 6 (version only) | SPIKE-RESULTS.md rows of 2026-10-02 |
| Acceptance rows verified offline | H1, H4, C1, S1, U1, U2, U3, W4, W7 (STATUS acceptance map; reconcile rounds STATUS:2636-2679) |
| Latest publication scan | `3716744`: 0 open blockers over `7be5f85..3229271` |

## Inventory

Key. **Unlocks**: what it gives the submission: public repo / video / setup instructions / STATUS rows to verified / none. **Size**: S = under half a day, M = 1-2 days, L = 3 days or more. **Risk**: four flags. Money = touches the money path. Live = a live PayPal call. UAT = needs the native shell. Op = needs the owner's hands or approval. **Owner**: builder / the owner / either.

| # | Item and state (cite) | Unlocks | Size (grounds) | Money | Live | UAT | Op | Depends on | Cut? What is lost | Owner |
|---|---|---|---|---|---|---|---|---|---|---|
| R1 | **Film row: sits at the end of the sequence (D2).** **Re-cut the film's haggle numbers to what the engine signs** (agent-negotiation-run C4, waits on operator: `docs/build/tiger/2026-10-24-agent-negotiation-run.md` C4 row). `614ed59` pins the engine at $300/$306/$312/$318/$324 with a refusal at $329. The film's $290/$305/$314/$321/$327 fail it (STATUS:2687). The prices live in `director/beats.ts`. | video | S. Client-only fixture and caption edit plus one test that fails on an unsigned caption amount. | no | no | no | yes (approval to build) | D2 | Yes, but the film would show prices the app's agent would never sign. A judge who runs it sees different numbers. | builder |
| R2 | **Native UAT checklist** (no UAT record exists: STATUS:2561). A script in the runbook style for W1, W2, W5, W8, W9, W11, F4, U4 and the README launch path. | STATUS rows to verified (enables R3) | S. Docs only. The rows and their pending parts are already listed in the acceptance map. | no | no | no | no | none | Yes, but R3 then runs without a script, and its results are harder to record as row evidence. | builder |
| R3 | **Native UAT on the Windows shell** (open: STATUS:2561; B8 row STATUS:30, "native behavior still needs interactive verification"; README:76-80). | setup instructions; STATUS rows to verified | M. A smoke of launch, three windows, tray, hotkey and Hello is about half a day. The full W1-W11 pass, plus any fixes it finds, is 1-2 days. The size of the fixes is unknown. | no (practice agent, no keys) | no | yes | yes (his desktop, his Windows Hello) | R2 | Not recommended. The README's Windows path would ship untested; a broken first launch is what a judge sees first. | the owner (fixes: builder) |
| R4 | **Move acceptance rows to verified** from R3 and R5 (partly: STATUS:2564). Record the results in STATUS and SPIKE-RESULTS. | STATUS rows to verified | S. Recording only, after each run. Fixes are counted in R3. | no | no | no | no | R3, R5 | Yes. The rows stay "verified offline", which is honest but weaker. | builder |
| R5 | **PARKED: D3 undecided, no live spike runs.** **Spike 3**: seller AUTHORIZE order approved by a second sandbox account, then authorize and capture USD 1.00 (approved, owner-run: DECISIONS §44; SPIKE-RUNBOOK spike 3; unrun: SPIKE-RESULTS.md). | STATUS rows to verified (H3 and F2 sandbox parts) | S if the sandbox seller and buyer accounts exist. If not, account setup time is unknown (runbook open question 3). | yes (sandbox) | yes | no | yes (his keys, his browser) | D3 | Yes. The submission then says "offline-tested only" for the core settlement (README:66-68). | the owner |
| R6 | **Delta publication scan** of the commits after `3229271` (`ddbaef7`..`e36e104` and anything merged by the freeze). The last scan, `3716744`, stops at `3229271`. | public repo | S. Same recipe as `3716744`: gitleaks, cargo deny, pnpm audit. | no | no | no | no | none | No. Publishing unscanned commits risks a leak. | builder |
| R7 | **Decided D1 = (a): run by the Director in a mirror clone, not by a builder.** **P-1 git-history rewrite** (not done on purpose: DECISIONS §42 item 3; STATUS:2567). | public repo | S of work, but irreversible. A path filter rewrites every commit hash after the file appeared, so STATUS and DECISIONS commit citations go stale. Option (b) of D1 has the same effect. | no | no | no | yes (history rewrite and force-push are his alone) | D1, R6 | No, unless D1 = (c). Otherwise the original P-1 text is public in history. | the owner |
| R8 | **Make the repo public** (STATUS:2567: "whether the repo is public is not shown by git"). The remote is `github.com/xkazm04/paypal`. Its visibility is unknown. | public repo | S. A settings switch, plus a check that CI runs green in public (README:9-13). | no | no | no | yes | R6, R7 | No. Devpost needs the repo link. | the owner |
| R9 | **README clean-machine dry run** (partly: STATUS:2568). The Tauri prerequisites are "not verified here" (README:87-88). Node and pnpm versions are not pinned (README:61). | setup instructions | S-M. One fresh Windows machine following "Watch it work" (README:48-61) and "Run The Table on Windows" (README:74-102), plus README fixes. | no | no | yes (the second half) | yes (needs a clean machine; builders cannot make a second tree) | R8 (from the public clone), R3 | Not recommended. The setup instructions would be unproven, and they are a judged item. | the owner runs; builder fixes |
| R10 | **Film row: sits at the end of the sequence (D2).** **Video**: narrate, add music, capture, check and render under 3:00 (open: STATUS:2569). Silent draft is 2:49 (`7f1d378`). ElevenLabs public use is confirmed (`e010505`). Merged features only. | video | M. Capture, check and render are commands (`film/hero/README.md`, Run). Narration and music are a paid step. Review and a re-take take about a day. | no | no | no | yes (ElevenLabs spend; approval of the final cut) | R1, the freeze (D7), D8 | No. It is a required item. | builder renders; the owner approves |
| R11 | **Devpost submission** (open: STATUS:2570). | all three, packaged | S. Form, links, text, upload. | no | no | no | yes (his account) | R8, R9, R10 | No. | the owner |
| R12 | **HOUSE deploy on Render plus the cold-start measure** (open: STATUS:2563; DEPLOY.md, "No deployment ... was performed"). The rate, health-check interval and wake time are UNVERIFIED (STATUS:948-953). Plan `0.5c-512mb` is in render.yaml:8. | none required (it adds live judge pairing and the `/house` scoreboard) | L. Key and mandate provisioning offline (DEPLOY.md steps 1-4), a release build with the pin, the Blueprint, the cold-start measure, and R13. | yes (HOUSE captures sandbox money) | yes | yes (pairing from the desktop) | yes (keys, Render account, spend) | R13, D4 | Yes. Judges can't pair with the HOUSE, as README:132-139 already says. | the owner plus builder |
| R13 | **Release relay address, yes/no switch, no contact until needed** (OPEN: DECISIONS §42 item 2). | none (only with R12) | M. Rust build-time origin check, an approval-window switch and the client words. | no | no | yes | yes (approval) | R12 | Yes, together with R12. The copy stays relay-less (current state). | builder |
| R14 | **PARKED: D3 undecided, no live spike runs.** **Spikes 1, 2, 4, 5, 7 and 8** (approved, owner-run: DECISIONS §44; unrun: SPIKE-RESULTS.md). 1 and 2 are the engines, 4 owner-app capture and void, 5 return URLs, 7 Channel3, 8 invoice paid. | STATUS rows to verified (S3, E1, F5, R2, C2, S1 live parts) | S each for his time. Spike 7 needs a Channel3 key and the demo product id (runbook open question 6). Spike 8 needs a sandbox recipient login. | yes (3, 4, 5, 8) | yes (4, 5, 8) | no | yes | D3 | Yes. The rows stay offline-only. Spike 8's loss is that rescue has no live receipt (backlog §1a, rescue piece 6). | the owner |
| R15 | **claude-code and codex-cli engines** (gated: README:115-119; DECISIONS §21; T3 not scheduled by §1). The §21 run-naming condition is met by `7c6ae49`. Its robustness-2 and robustness-3 conditions are **unknown** (no commit found). | none for the film (it runs the practice agent) | L. Spikes 1 and 2 first, then T3 at about 8 days (backlog §1a row 3). | no | no | yes | yes (spikes; the "no deal data before the inventory" rule) | R14 (spikes 1, 2), D5 | Yes. The headline "your own claude-code" (README:7) stays a design claim. The practice agent carries the demo. | builder after the owner |
| R16 | **agent-negotiation-run residuals** C5, C6, S1-S4, L1-L3 and F2 (waits on operator: tiger record, Scope and "Waits on the operator"). C5 and C6 decide whether a real haggle can finish above the limit. F2: practice-agent warm-up reads count as "out of turn" in the safety record (STATUS:2689). | none | M for C5 plus C6 (intake and countersign). S for F2 (an audit choice). | yes (C5, C6) | no | no | yes | D6 | Yes. A seller's counter above the ceiling still ends the haggle. F2 shows odd counts if the film shows the safety record (unknown). | builder after the owner |
| R17 | **"Rivalry is unmeasured"**. Found for deal-to-settlement full r1 (STATUS:2168, 2180) and earlier councils (STATUS:254, 269, 371, 1345). **Unknown** for agent-negotiation-run: no such line is in its record or STATUS:2681-2693. | none | S-M. A council measurement, not a build. | no | no | no | yes (the App Master excluded it on purpose: STATUS:2168) | none | Yes. Nothing in the submission changes. | either |
| R18 | **agent-gated-spend: record the mandate version (and hash) at clearing** (parked, waits on operator: `docs/build/tiger/2026-10-24-agent-gated-spend.md`, round 3 "Waits on the operator"). | none | S-M. A Rust audit-row or deal field change. The audit allowlist is in `audit_detail.rs` (STATUS:28). | yes (audit evidence) | no | no | yes | D6 | Yes. A purchase rebound after clearing may name the wrong rule version. The client already says "not checked against these" when the versions differ (`07763cd`). | builder after the owner |
| R19 | **Other open council and tiger Approvals**: deal-to-settlement full r1 (STATUS:2174-2179); economics §36 (STATUS:2141), §35 and §37 (STATUS:2159); owner-approval-decision S1, S2, L1, L2, F2 (STATUS:2718-2724); rescue W1-W5 (STATUS:2738-2743); agent-gated-spend S1-S3, L1, L2 (tiger record, "Waits on the operator"). Which of these are "full-ready approvals waiting on the owner" in Personas is **unknown** from git. | none (a words item could touch a filmed screen; which ones do is unknown) | S each for words items; M for the Rust reads (L1, L2) and the parked-read bounds. | some (§35, §37, robustness-2) | no | no | yes | D6 | Yes. They stay as recorded residuals. | builder after the owner |
| R20 | **Scan-sweep hand-offs owed**: 19 Lane C cards (`2dbafc4`; `.claude/scan-history/open-backlogs.jsonl`, optimize-2026-10-22, status open) and 6 from stabilize-2026-10-23 (open). | none | S to hand off. Each card is its own build. | some (e.g. "a partly paid rescue invoice expires uncounted") | no | no | yes | Personas running | Yes. | either |
| R21 | **M2 completeness**: feature scan, every feature lite-ready, major features full council (partly: STATUS:2551-2553). | none | S-M. Docs: one list of features and their council state. | no | no | no | no | none | Yes. Only the internal plan goal is lost. | builder |
| R22 | **Wave 4**: T13, T16, T17, T18, T19. Post-submission by DECISIONS §1. No commit for any of them is found in `git log`. | none | L (about 34 days in total: backlog §1a). | some | no | some (T18) | yes | none | Yes, already decided (§1). | builder |

Row numbers follow the cut: R1-R11 are above the line, R12-R22 below.

## Dated sequence

The film rows (R1, R10) and the film freeze (D7) sit at the end, after every non-film row and immediately before R11, because Devpost requires the video. Their date is "end of project, date set by the owner".

| When | Builder | the owner | Gate |
|---|---|---|---|
| Thu Oct 29 - Fri Oct 30 | R2 UAT checklist. R6 delta scan. | D1, D2, D7 decided at the 2026-10-30 standup. D3 undecided; D8 if possible. | |
| Sat Oct 31 - Mon Nov 2 | R4 records results. Fixes from R3, small and offline-gated. | **R3 native UAT.** R5 is parked (D3 undecided, no live spike runs). | UAT fixes merged by Nov 4. |
| Tue Nov 3 - Wed Nov 4 | R6 again over anything new. README fixes. | R7 history: decided D1 = (a), run by the Director in a mirror clone, not by a builder (last today, 2026-10-30). Then **R8 public by Nov 4**. | Repo public and CI green. |
| Wed Nov 4 - Thu Nov 5 | Fixes from R9. Compressed verification (DECISIONS §1: Nov 4-6). | **R9 clean-machine dry run** from the public clone. | |
| **End of project, date set by the owner** | R1 re-cut of the film's haggle numbers, then R10 capture, narrate, music, check, render (under 3:00). | Approves the cut. | **Film freeze (D7, moves with D2)**. A film of merged features only. |
| Tue Nov 10 | Final STATUS and README. No feature merges. | Devpost draft. | |
| **Wed Nov 11** | | **R11 submit.** | A day of buffer before 11-12 14:00 PT. |
| Nov 12 onward | Everything below the line: R12-R22. | | |

**Must land before the film (no date):** R3 and its fixes, R4 for what ran, and R1, the re-cut of the haggle numbers. R8 should land by Nov 4, so the film's end card can show the public repo; that is optional if D1 slips.
**Can follow the film:** R9 fixes to the README, R4 entries, R6 re-run, R11. Any code merged after the film freeze is not in the film.

## Cut line

```
ABOVE (ships): R2 UAT checklist - R3 native UAT - R4 rows to verified - R5 spike 3 (parked, D3 undecided)
               R6 publication scan - R7 P-1 history (D1 = (a), Director) - R8 public repo - R9 README dry run
               R1 film numbers - R10 video (end of project, date set by the owner; film freeze D7 before them)
               R11 Devpost submission
------------------------------------------------------------------------------------------------
BELOW (post-submission): R12 HOUSE deploy - R13 relay address/switch - R14 spikes 1,2,4,5,7,8 (parked)
               R15 native engines (T3) - R16-R19 council/tiger residuals - R20 scan-sweep hand-offs
               R21 M2 completeness - R22 wave 4
```

## Decisions taken (2026-10-30)

Recorded at the owner's standup of 2026-10-30.

- **D1 = (a) rewrite history.** The DIRECTOR runs this personally, LAST today, in a mirror clone.
- **D2 = re-film at the END of the project** ("we are far from over"). The film rows move to the end of the sequence.
- **D3 = undecided; keep it as it is.** No live spike runs.
- **D7 (film freeze) moves with D2.**
- **Film date confirmed:** the re-film (R1, R10) and the film freeze (D7) land before R11 (Nov 11), confirmed by the owner 2026-10-30.

## Decisions for the owner

Each one has its options, with the recommendation marked.

- **D1. P-1 in git history** (DECISIONS §42 item 3). **DECIDED (a), 2026-10-30.** (a) Rewrite history to drop the original owner-assets text, then force-push. Every hash cited in STATUS and DECISIONS goes stale. (b) Publish a fresh repo from the tip as one squashed commit; the citations go stale the same way and the build history is lost. (c) Publish as-is, with the original in history. **Recommend (a)**: it keeps the commit narrative. Pick (c) only if you judge the original text harmless to publish. Needed by Oct 31.
- **D2. The film's haggle numbers** (C4). **DECIDED 2026-10-30: re-film at the end of the project.** (a) Re-cut the film to the engine-signed prices, R1. (b) Keep the film and caption the haggle as illustrative. (c) Drop the haggle chapter. **Recommend (a).** Needed by Oct 31.
- **D3. Live spikes before submission** (DECISIONS §44: approved for you to run). **UNDECIDED (2026-10-30); no live spike runs.** (a) Spike 3 only. (b) Spikes 3 and 8. (c) All seven. (d) None. **Recommend (a).** Every one is a live sandbox call under your keys. Needed by Oct 31.
- **D4. HOUSE deploy.** (a) Not before submission. (b) Deploy by Nov 3 with R13; this is L-sized, has a live PayPal path and an unknown Render cost. (c) Deploy after the film for the judging window only. **Recommend (a).**
- **D5. claude-code and codex-cli.** (a) Stay gated; the practice agent carries the demo (current state, §21). (b) Run spikes 1 and 2 now and try T3. **Recommend (a).**
- **D6. Residuals R16-R19 before the freeze.** (a) None. (b) At most three words-only items, and only ones on a filmed screen (e.g. owner-approval S2, the "approve"/"accept" button), by Nov 3. (c) C5 and C6. **Recommend (a)**, or (b) if you know a filmed screen carries one. C5 and C6 are money-path work.
- **D7. Film freeze.** **DECIDED 2026-10-30: moves with D2.** (a) Nov 5 EOD. (b) Nov 6 morning. (c) Per chapter, as each is captured. **Recommend (a).**
- **D8. Narration and music spend** (ElevenLabs; plan confirmed for public use, `e010505`). (a) Approve narration and music. (b) Narration only. (c) A silent film with captions. **Recommend (a).** The daily cap and the amount are unknown here.
- **D9. Who runs the clean-machine dry run.** (a) You, on a second Windows machine or a fresh user account. (b) A builder, if a clean VM exists (unknown). **Recommend (a).**
