# Chen (payments-platform PM) - L1 walk, 2026-11-06

Method: code-grounded, no browser. Surfaces: README.md, director.html, arena.html, proof.html, console `#m=tables&v=watch`, docs/build/{DEPLOY,SPIKE-RESULTS,STATUS}.md. Brief leads were treated as hypotheses; the ones that held are findings below.

## Verdicts

| Journey | Verdict | Est. time saved (vs ~2 h of calls) | Confidence |
|---|---|---|---|
| haggle-and-watch | **L1-pass** | ~25 min of the assessment (the replay answers "where did the wallet refuse" faster than a call) | medium |
| evaluate-in-20-minutes | **L1-conditional** | ~70 min if the doc contradictions are fixed (2 h minus ~20 min eval, ~10 min install, ~20 min reconciling stale docs) | medium-low |

Scored criteria: (1) value in 3 min: pass, the director runs 214 s (director/README.md:10-11) under a standing sample banner. (2) real-vs-mock stated: pass on director, partial on arena and proof. (3) proof checker works in-browser: pass on paper (proof/entry.tsx, ProofPage.tsx); L2 to confirm. (4) no claim contradicts docs: **fail** (CHEN-L1-01, 02). (5) next step obvious: **fail** (CHEN-L1-03, 04).

## The 20-minute walk

1. README opens with a status wall (README.md:15-48). Honest ("hackathon entry, offline-tested"), but the first runnable thing is at line 55 (needs `cargo run`) and the no-install path at line 102. Nothing says "start here, 20 min".
2. README.md:102 is headed "Watch it work without installing anything" and then says `pnpm install` and run a dev server (README.md:104-106, 126). No hosted URL (README.md:227 "nothing is deployed"); `dist/` ships only index, tumbler, approval (director/arena/proof need `build:director`, vite.config.ts:24,51). I am a PM and now need Node and pnpm.
3. director.html: banner "Browser preview with sample data - not the wallet. No PayPal page is ever shown." (Director.tsx:639) plus stage aria-label. Strong. Caption prices come from haggle.json (director/recorded.ts:1-35). The hard-coded "$250" and "$340, six offers" in beats.ts:83,98 agree with haggle.json rules (ask_above 25000, ceiling 34000, max_offers 6) and are pinned by haggle.test.ts:19-25 and film.test.ts:93,102, so README.md:121-124 holds.
4. arena.html: tag "Preview - recorded answers" (BreakTheTable.tsx:220, arena.ts:347); "the preview's sample week" only in the footer (BreakTheTable.tsx:294, arena.ts:14). "No money, no PayPal page" is only in the meta description (arena.html:6). The $0.00 and PayPal-asked-0 counters carry the point visually.
5. proof.html: no "sample / preview / not real money" text. Lede says only "nothing is installed and the file is not sent anywhere" (proofcheck.ts:116). Sample copy: "A real signed file the wallet exported from a recorded run" (proofcheck.ts:11); a buyer can read "real" as production evidence. The sample story does say "no money has moved in this file" (proofcheck.ts:131).
6. Console Watch the haggle: footer badge "Preview - sample data" (Footer.tsx:39, honesty.tsx:25-29); small but standing.
7. Docs: DEPLOY.md:3-4 and README.md:162-171 agree (not deployed). SPIKE-RESULTS.md is 17 lines; only a version-only spike passed.

## Feedback in my voice

"I would keep going, but I'd flag three things to my lead. The director is the best three minutes I've had from an entrant: a banner says it's sample data, and the caption numbers are checked against a recording of the real engine, which is exactly what I ask for and rarely get. But I can't tell from the README alone what is built versus tested versus live. It is dated 8 October yet describes features from 31 October, and it lists subscription rescue as built while your own status table says rescue execution is deferred. When two documents disagree about the money-adjacent feature, I stop trusting both. And the page that carries the safety claim, the proof checker, never says it is a practice deal on a recording. I'd tell a peer: 'Credible, unusually candid about not being deployed, not yet something I can try without a toolchain.' I still don't know who to contact or what to do next."

## Findings, ranked by impact

1. CHEN-L1-01 major: README lists rescue as built; STATUS says deferred (README.md:30-31 vs STATUS.md:15,37).
2. CHEN-L1-02 major: stale and inconsistent status dates (README.md:15 vs 33-43; STATUS.md:3 vs 2907,2946).
3. CHEN-L1-03 major: "without installing anything" needs Node, pnpm, dev server; no hosted or prebuilt path.
4. CHEN-L1-04 major: no ordered evaluator path or contact/next step.
5. CHEN-L1-05 minor: proof.html has no preview/sample disclosure; "real signed file" wording.
6. CHEN-L1-06 minor: arena disclosure footer-only.
7. CHEN-L1-07 minor: $200 (README sandbox) vs $250 (director) human-present line unreconciled.
8. CHEN-L1-08 minor: SPIKE-RESULTS thin; README omits passed spike 6.
9. CHEN-L1-09 polish: "Windows Hello" in user-facing strings vs AGENTS.md:46.
10. CHEN-L1-10 polish: director has no link to proof.html or real-vs-mocked section.

Strengths to protect: S1 director banner and caption-to-recording coupling; S2 README real-vs-mocked section, honest about not deployed; S3 watch replay driven by the engine recording.

Accepted gaps, not findings: no live sandbox spikes, HOUSE undeployed, native shell unverified (uat/accepted-gaps.md).

## L2 handoff
Preflight: dev server on :1430 (env.md); director/arena/proof are served only in dev or the `build:director` build. Verify live: director banner visible; proof tamper flow; arena footer above the fold at 1280x720; Watch view footer badge.
