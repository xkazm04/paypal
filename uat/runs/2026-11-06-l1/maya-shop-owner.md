# Maya (owner of Second Screen): L1 report, 2026-11-06

Level: L1 (theoretical, code-grounded, no browser). Nothing here was executed live. Every claim cites file:line under `apps/desktop/client/src` unless a full path is given. Findings: `maya-shop-owner.findings.json` (19 rows: 13 gaps/defects/observations, 6 strengths).

## Scorecard

| Journey | Verdict | Time saved if it all worked (assumption, not measured) | Confidence |
| --- | --- | --- | --- |
| first-run-onboarding | L1-pass | about 20 min (vs. wiring keys, rules and a test purchase by hand across PayPal and an agent config) | low |
| sign-rules | L1-conditional | about 10 min per rule change (what-if replaces re-reading last week's orders) | medium |
| gated-spend-approval | L1-pass | about 5 min per gated purchase (one decision card instead of chasing the agent) | medium |
| haggle-and-watch | L1-pass | about 15 min per haggle she would have run herself | low |
| attention-tumbler | L1-pass (native focus behaviour unverifiable here) | about 10 min a day of "checking if anything needs me" | low |
| book-and-proof | L1-conditional | about 30 min per week of reconciliation, if her totals reproduce | low |
| subscription-rescue | L1-conditional | about 10 min per failed renewal, for the one lever that is built | medium |
| counter-shop-and-wallet | L1-conditional | about 10 min per week on floors and market lookups | low |

The character file gives no hours figure ("the hours saved are an assumption to be measured"), so every number above is my estimate of the upside and is marked low or medium confidence. It is not a claim.

Grounding score: not applicable (env.md: the client has no in-product LLM prompt surface; the board's assistant only proposes, and the scripted engine reads only the digest it is given, `lib/assistant/scripted.ts:1-6`).

Wiring audit (unit: field declarations in the wire types vs. fields with at least one non-test reader in `windows/ shared/ lib/words* lib/display lib/format`): 34 of 36 wired. The two orphans are `RescueView.failed_payments` and `ExposureView.signed_at` (MAYA-L1-06). `AttentionItem.urgency` is read in exactly one place (`windows/main/console/Centre.tsx:176`).

## Reachable surface set (computed first)

- Windows: `index.html` (main), `tumbler.html`, `approval.html`. Also `director.html`, `arena.html`, `proof.html` exist but the character does not reach HOUSE or the judge path; in the preview the top-bar "Try / Proof / Director" places are present (`windows/main/console/Console.tsx:84-90`, filtered by `placeAvailable`, `windows/main/logic.ts:356`) and I treated them as out of her set.
- Main window has two views sharing one set of providers (`windows/main/App.tsx:19-23`): the board (`switchboard/`, default) and the console. The view is chosen by address, a console deep link, the remembered choice, then the board (`switchboard/view.ts:46-48`). Console: decision centre, six module tabs (Tables, Spend, Counter, Book, Shield, Rescue; `shared/modules.tsx:14-21`), the waiting list, Rewind, Set up (Charter), and the places Rules, Connections, Settings, Safety (`console/layers.registry.ts:21-24`).
- Approval window (the only place to sign, approve, pay, release, open PayPal): `windows/approval/` (`OwnerConfig` for keys, rules, limits; `DealReview` for a deal).
- Tumbler: forms rest, tab, ticker, card, stack, handoff, welcome (`windows/tumbler/logic.ts:19-26`).
- Gating: none of auth, plan or flags applies in the preview (mock backend, `mock/backend.ts:654`). The one reachability constraint that matters is `locked` (idle lock): privileged actions need Windows Hello, which the mock simulates (`backend.ts:1078`). Native placement, tray notification and focus behaviour are not reachable by a browser and are tagged unreachable.
- Fixtures: the sample world has 114 `D-0xxx` mentions in `mock/fixtures.ts`; D-0205 is the recorded house haggle with the only signable proof (`backend.ts:666-673`).

## Per-journey walk

**first-run-onboarding: L1-pass.** A new wallet opens on the Charter (console) or a setup panel (board) (`Switchboard.tsx:97-100`). Five numbered lines: keys, rules, practice, agent, unlock. Privileged lines only hand off to the approval window (`Charter.tsx:23-28`); practice stays in Main as the pairing desk; the agent line is a radio picker with "keep the practice agent" as a legitimate choice (`Charter.tsx:236-248`). There is one gold per line and a "what this means" box with the safety promise. I can say what the agent may do after line II. Minor: the Charter counts the idle lock as an undone fifth line (MAYA-L1-13); first-run copy names `claude-code` / `codex-cli` (allowed by AGENTS.md:46, MAYA-L1-12); the default home is the board while the guide describes the console (MAYA-L1-11).

**sign-rules: L1-conditional.** Say it (typed or spoken, word list not AI) gives chips and a draft, the approval window shows the diff and the what-if, Sign is a separate sheet (`SignSheet.tsx:75-141`), wallet limits sit above every rule (`lib/words/rules.ts:36,93`). Two real gaps against my bar: the effect "in dollars" is a count of deals, not dollars (MAYA-L1-02), and clause numbers are printed on every rule row (MAYA-L1-01). Deal labels and a key hash are visible on the face (MAYA-L1-03).

**gated-spend-approval: L1-pass.** The centre shows one decision: sentence with amount, who, "If you do nothing" with a countdown, one gold button that only opens the approval window, Later, Open the deal, Why? (`Centre.tsx:152-222`). In the approval window money buttons are hold-to-confirm and keyboard-operable by holding Space; Enter never releases money and a toast says why (`DealReview.tsx:288-297`, `HoldGesture.tsx:132-135`). One known deviation: the Spend purchase pane can say "on hold at PayPal" for a payment whose PayPal outcome is unchecked (MAYA-L1-09, already in UX-GUIDE:91 as an open item, not in `accepted-gaps.md`).

**haggle-and-watch: L1-pass.** The Watch view replays the signed transcript as a corridor with a "Wallet refused" beat in her words and only her own band (`corridor.ts:77-98`, `lib/words/tables.ts:353-357`). "Both sides end with the same receipt" is shown through the proof checker, not the replay; "her floor never leaks to the counterparty" is a Rust property I did not audit (uncertain).

**attention-tumbler: L1-pass.** Ladder values come from the shared `LADDER` (`tumbler/logic.ts:31-39`). Snooze is only for a gate with more than 45 minutes left, lasts 30, and the card returns inside 15 (`mock/backend.ts:478-479,1053-1061`); holds cannot be snoozed. "Noticed within seconds without stealing focus" depends on native window behaviour (accepted-gaps: native shell unverified), so it is not credited here.

**book-and-proof: L1-conditional.** The Book answers questions with the wallet's own reading (no AI), lists deals, and the checker runs in the page with tamper buttons (`shared/proofcheck/ProofChecker.tsx:3`, `book/Proof.tsx:18-24`). In the preview only D-0205 exports a signed proof (MAYA-L1-10, by design). I did not trace "totals reproduce from deal pages" end to end (see Not covered).

**subscription-rescue: L1-conditional.** The case card is honest and strict: only a PayPal-shown paid invoice with a saved receipt counts (`lib/words/rescue.ts:155-175`), a replay never counts, "doing nothing is always safe". But only the discount lever is sendable (MAYA-L1-04) and there is no monthly figure (MAYA-L1-05).

**counter-shop-and-wallet: L1-conditional.** Floors are edited as a draft and signed in the approval window ("Review & sign" is a hand-off, `Prices.tsx:1-5,140-160`). Stock and list price are permanently "catalog not connected yet" (MAYA-L1-07); market shows its age but not its source (MAYA-L1-08). "Buyer agents never read the floor" is a Rust property, not audited.

## UX-GUIDE checks (executed by grep)

- Machinery names in user-facing strings: words files clean (only comments match the guide's regex). Leaks are in the approval window's inline strings: clause numerals, deal labels, key hash (MAYA-L1-01, -03).
- Two gold buttons in one view: none found. All `kind="gold"` sites in `windows/main` (8) are exclusive per view; approval gates exclusive by construction (MAYA-L1-14).
- Unknown shown as zero or green: counts use a dash (`lib/data/counts.ts:14-19`); one real unknown-as-known (MAYA-L1-09).
- Vendor names: only the two engine ids, which AGENTS.md:46 allows.
- Strings outside words files: the approval window (`OwnerConfig`, `MandateEditor`, `SignSheet`, `WhatIf`) is mostly inline, so the words guard does not protect it; that is why the leaks live there.

## Findings by impact (frequency x reachability x trust_erosion)

1. MAYA-L1-09 (deviation, major): Spend pane says "on hold at PayPal" for an unchecked payment. Low frequency, high trust cost.
2. MAYA-L1-01 (major): clause numbers on every rule row. High x high x med.
3. MAYA-L1-02 (major): what-if has no dollars. High x high x med.
4. MAYA-L1-04 (major): one of four rescue levers built. High x high x med.
5. MAYA-L1-08 (minor): market source never shown. Med x high x med.
6. MAYA-L1-03, -05, -06, -07, -10, -11, -12, -13: minor.

## What passed (protect these)

One gold per surface and "If you do nothing" with a clock (MAYA-L1-14); hold-to-confirm with Space and an Enter guard (MAYA-L1-15); snooze that cannot hide a deadline (MAYA-L1-16); signing in one place with a plain "nothing is signed" line (MAYA-L1-17); the refusal beat in the replay (MAYA-L1-18); clean words files and dashed unknowns (MAYA-L1-19).

## In my own words (Maya, over the designed experience)

I would try it, and the thing I liked first is that it never lets me think a button will move money when it will not. The big gold button on the card says "Review" and opens a separate window; I have to hold the real one down for a moment. At first I thought that was fussy, then I remembered it is my money. "If you do nothing: nothing moves, 3 h 20 left" is exactly what I want to read before my coffee goes cold.

Where it lost me: when I change "ask me above" the page tells me "would have refused 1, asked me about 2, allowed 6". I do not think in deals, I think in dollars: how much would have needed me last week? And every rule has a little number beside it like a contract schedule. I never asked for clause 6, I asked for "ask me above $250". The deal codes (D-0190) belong on the proof page, not in my sentence.

Rescue is the other letdown. I read the card, it is clear and honest, but it offers me one lever, a discount, and says the other three are "not available yet". I appreciate not being lied to; I would still like pause. My shop's catalog is also "not connected yet" on every item, which reads like a nag. If I only judged the safe-money feeling, I would tell a peer to try it. For running the shop week to week it is not there yet.

## Not covered (honest ceilings)

- No live rendering, latency, feel, or CSS (a number may be hidden by styles; MAYA-L1-01 needs L2).
- Native shell behaviour: Tumbler placement, tray notification, focus theft, Windows Hello (accepted-gaps).
- Rust-side claims: floor never reaching a counterparty, both sides getting an identical receipt, snooze enforcement in `table-attention`.
- Not traced: Book Ask lens answers against deal totals ("totals reproduce from deal pages"), the Say-it word-list coverage, Shield, Connections and the Rewind future ticks (read only by name).
- Time-saved figures are estimates of upside, not measurements.
