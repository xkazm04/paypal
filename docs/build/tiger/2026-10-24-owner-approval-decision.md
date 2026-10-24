# Tiger deepening: owner-approval-decision (2026-10-24)

A /tiger value pass on the approval window's decision. This is the gold moment a Devpost judge
watches Maya sign: Dan's counter at $329.00, held, not clicked. It covers the deal review ("The
Diff"), its sentence, Why? and note, the checklist, and what the window says after the hold
(`apps/desktop/client/src/windows/approval/`). Goal lens: make the owner's decision markedly more
legible and trustworthy for a non-technical merchant owner and for a judge watching a 3-minute
video, without weakening any fence.

Headless run. The operator's 2026-10-24 standup approval covers building up to three items that
meet all five criteria:
- offline-verifiable, with a test that fails under the old behaviour;
- inside the declared paths;
- no new or changed IPC command and nothing on the money path;
- no live PayPal call;
- every AGENTS.md invariant holds.

Everything else waits on the operator.

## Thesis

At the moment Maya decides, every number and every reason on the window says exactly what the
wallet checks, and after the hold the window says what her decision was bound to:

- each rule is set beside the number the wallet compares it with;
- the ask-me rule is stated as the wallet applies it;
- the checklist she saw is named as the one her decision was bound to, never confused with the
  list as it reads later.

No fence changes. Every change is display-only.

## Seats

`single-family`. This pass convened no council. A council's seats run in a shared detached worktree
that `tiger.mjs convene` creates, and this builder's brief forbids creating or removing a worktree.
The judge (Claude Opus 5.5) proposed alone, from the code. It checked each premise at its anchor
before scoring and kept the five criteria as the build gate. There are no peer ratings, no per-seat
ledger and no cost to report. A later council round on this area would be its first.

Not written, because each is outside the declared paths:
- the skill's `tiger/` vault (hunts, seats, backlog);
- the registry consult and run-log lines, which belong in the main checkout.

This file is the record.

## Scope

Ordered by dependency. Each premise was verified in code at `ec84451`.

### Core

| Item | What changes for Maya and the judge | Premise (verified) | Status |
|---|---|---|---|
| C1 Like with like at the accept | On a table of more than one item, the accept twin and sentence set the price per item beside the price range. Before, 2 × $300 read "Dan asks $600.00" beside "Most you'll pay $340.00", marked as covered, and "Dan offers $600.00, inside your $340.00 limit". Now it reads "Dan asks per item $300.00", "$300.00 each", "2 × $300.00 = $600.00 · their latest", and "inside your limit of $340.00 per item". One item reads as before. | `crates/table-core/src/mandate.rs:503`: "Band refers to the signed unit price, per-deal/velocity to the full total". The table sheet lets the owner list up to 1000 items (`tableDraft.ts:80`). | **Built** 677e73e |
| C2 The ask-me rule as the wallet applies it | "Why am I being asked?" and the accept note's "What this does" said "Your rules leave this price to you, not to the agent", even at or under the ask-me limit, where the rules let the agent accept too. They now give one reason (`acceptReason`): above the limit (unchanged), "isn't above your $250.00 ask-me limit, so your rules don't require you to decide it; you can still accept it here", or "can't see your ask-me limit". The Who decides row no longer calls an offer equal to the limit, or one it can't compare, "below that". | `mandate.rs:561`: `Ask` only when `amount > threshold`. Clause 6 is required at signing (`mandate.rs:300`), so the limit is unseen only when this window can't read the rules. | **Built** dfa9acb |
| C3 Name the checklist a decision was bound to | After a successful hold the window says: "Before it went ahead, the wallet checked again that these are the checks you saw (4 of 6 passed · 2 checked later), and recorded them with your decision". A release and the read of a lost hold get no line. Before, once the deal moved on, the fold read "Your checks before you decided · …" over the wallet's current list, even on a deal that expired with no decision. It now reads "The wallet's checks now · …", and Details titles that section "What your wallet checks now". | `crates/table-runtime/src/service.rs` `decide`: recomputes the checklist and refuses a different hash before the ticket, then `record_decision` appends `owner.decision` with that hash. Void skips both. | **Built** 1dee2c5 |

### Supporting

| Item | What changes | Why not built | Status |
|---|---|---|---|
| S1 The bound line for the hand-off | "Open PayPal in your browser ↗" is also bound and recorded (`service.rs` `Decision::OpenBrowser` calls `record`). The window could say so after the hand-off. | Third-item limit. It also needs care so the line doesn't read as the approval itself, which happens on PayPal's page. | Waits on the operator |
| S2 "Hold to accept", not "Hold to approve" | The accept's gold button reads "Hold to approve $329.00" while its heading reads "Accept the offer from Dan". On video, "approve $329" reads as paying. A label like "Hold to accept $329.00" would match the heading and the note ("agrees the price only"). | `docs/features/approval-window.md` names "Approve $329.00", and the film's captions may quote it. Both are outside this pass's paths, and the wording is the operator's call. | Waits on the operator |

### Leaps

| Item | What changes | Why not built | Status |
|---|---|---|---|
| L1 Then and now | On reopening a decided deal, the window reads the deal's `owner.decision` row and shows the checklist reference the decision carried beside today's: "the list you decided on" against "the list now". This closes the gap the feature doc already names ("no Proof drawer shows an `owner.decision` row"). | Needs a read of the audit row through the proof export or a new read. That is a larger surface than three display items and touches proof wording. | Waits on the operator |
| L2 "After this" at the decision | "Your agents will have $X of $Y out today after this", under the gold button. | `ApprovalSummary` carries no meters, and the shell reports `meters_available: false` (`service.rs`), so it needs a Rust read: an IPC change. | Waits on the operator |

### Left out

- **An approved-payees row in the accept Diff.** The wallet's own checklist already carries a payee
  line (`crates/table-app/src/checks.rs` `payee`). A second, client-side reading of the same
  question would only add a way to disagree with it.
- **Re-proposing anything parked by the agent-negotiation-run pass:** S4 (the C2 below-listing row
  in the approval Diff), C4-C6, S1-S3, L1-L3 and F2. Also value-2 and security G-1/G-2/E-1. None
  is touched here.

## What was built

All three are display or test changes inside `apps/desktop/client/src/windows/approval/`. None adds
or changes an IPC command, changes what Rust signs, authorizes, captures or voids, or calls PayPal.
Gating (`gating.ts`) is untouched, so no button became more permissive.

- **677e73e** `fix(approval)`: `buildDiff` accept case (`review/diff.ts`) and the accept sentence
  (`review/says.ts`).
  - Test: `review/perItem.test.ts`. On the old code, 2 of its 4 tests fail: the twin and the
    sentence. The other two (the total stays on the ask-me line, one item unchanged) are
    regression guards and pass either way.
- **dfa9acb** `fix(approval)`: `acceptReason` in `review/why.ts`, used by `answerWhy` and the accept
  note in `DealReview.tsx`, and the Who decides row in `review/diff.ts`.
  - Tests: `review/askMe.test.ts` and `review/why.test.ts` "at or under the ask-me limit". On the
    old code, 3 tests fail across those two files.
  - The old `why.test.ts` pin asserted the untrue sentence and is replaced.
- **1dee2c5** `feat(approval)`: `boundLine` and `checksNowLabel` in `review/Checks.tsx`; the bound
  line, the fold label and the Details heading in `DealReview.tsx` and `review/Details.tsx`; one
  CSS rule.
  - Test: `bound.render.test.tsx`. It renders `DealReview` and holds "Approve $329.00" on a
    NEGOTIATING haggle whose checklist then changes. The line names the list she saw (4 of 6
    passed · 2 checked later), not the new one (5 of 6 passed · 1 checked later). It also renders
    an EXPIRED deal, which shows no bound line and no "before you decided".
  - Both render tests fail on the old `DealReview.tsx` and `Details.tsx`.

## Found while building (not items)

- **F1. An unreachable branch.** `answerWhy`'s `release` case (`review/why.ts`) says "The wallet
  doesn't say which check paused it" even when `shield_rule` is known. It can't be reached:
  `derivePhase` returns `hold` before `ready` or `locked` whenever the shield holds a live deal, and
  the `hold` branch already names the rule. It is left as it is; removing it is a tidy-up, not value.
- **F2. The feature doc lags this pass.** `docs/features/approval-window.md` doesn't describe the
  bound line, the "The wallet's checks now" fold, or the per-item and ask-me wording. That file is
  outside this pass's paths.

## Waits on the operator

S1, S2, L1 and L2 above, plus F2. In order of value for the video:
1. S2: the gold button's word at the accept.
2. L1: then and now, the decision's own proof in the window.
3. S1.
4. L2, which needs a Rust read.

## Gates

At the end of the run, in this worktree, the client ran after `pnpm install --frozen-lockfile` in
`apps/desktop/client`, which made a real `node_modules` there, not a link:
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run`: 207 files / 2002 tests passed. The agent-negotiation-run pass recorded 204 / 1970; this pass adds 3 files and 14 tests, and main has moved since.

No crate and no Rust test was touched, so cargo fmt, clippy and test were not run for this pass. The
merge gate runs `cargo test --workspace`. It doesn't run tsc or vitest.
