# Tiger deepening: agent-gated-spend (2026-10-24)

A /tiger value pass on the Spend page. It answers Maya's question "did my agents buy anything I
need to look at?" and shows, per purchase, which signed rule let it through or stopped it. The pass
covers the page, the purchase pane with its decision card, the rule check ("the gate") and their words
(`apps/desktop/client/src/windows/main/console/areas/spend/`, `modules/spend/gate.ts`,
`lib/words/spend.ts`). This is the wallet's central promise to a judge: an agent can only propose,
and the owner pays. Goal lens: make what Maya sees on the Spend page markedly more legible and
trustworthy, for a non-technical merchant owner and for a judge watching a 3-minute video, without
weakening any fence.

Headless run. The App Master's brief covers building up to three items that meet all five criteria:
- offline-verifiable, with a Vitest test that fails on the old code;
- inside the declared paths;
- no new or changed IPC command, no change to `crates/`, nothing on the money path;
- no live PayPal call;
- every AGENTS.md invariant holds.

Everything else waits on the operator.

## Thesis

Every sentence on the Spend page says what the wallet actually decided, and why:

- a purchase is called "over the limit" only when its amount is over it;
- the purchase that waits for Maya reads as having passed her rules, because the wallet only lets
  a purchase wait after its rules passed;
- the card says it waits because no rule can ever pay for a purchase, not because the rules chose
  to leave it to her.

No fence changes. Every change is display-only, and no "not known" cell is drawn as passed: the one
cell that turns from unknown to passed does so on a Rust fact, cited below.

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

Ordered by value for the video. Each premise was verified in code at `3716744` (Rust is read-only
for this pass).

### Core

| Item | What changes for Maya and the judge | Premise (verified) | Status |
|---|---|---|---|
| C1 "Over the limit" only when it is | A purchase the wallet refused at the per-deal rule read "Over the per-deal limit ($200)" on its row, whatever the amount. A $50 purchase in a category the rule doesn't allow was called over $200. The row now says "Over the per-deal limit" only when the amounts say so, and otherwise "Stopped by your “Limit per deal” rule". The cell reads "$50.00 is within the $200.00 limit, so this rule refused it for what was bought, not its price", or "it is priced in EUR and the limit is in USD". | `crates/table-core/src/mandate.rs:447-470`: the per-deal clause refuses on the kind (`:452`), then the currency (`:455`), then `over \|\| bad_category` (`:458-459`). `Deal` carries no category (`bindings/Deal.ts`), so a within-limit refusal of the right kind and currency is the category. The old verdict was `gate.ts` `ruleLine`, which keyed on the clause type alone. | **Built** ddbaef7 |
| C2 The purchase that waits for you passed your rules | A purchase an agent asked for that waits for Maya (Agreed) showed every rule as "?" ("not checked yet"), and its row said "Not every rule could be shown here". That is the purchase she most needs to look at. Its lane now passes every rule, and the row reads "Passed your rules". The ask-me rule shows "◆" only when the total is above its amount ("$270.00 is above $250.00, so this rule leaves it to you"), never at it. Under the purchase, the checklist reads "Every rule passed. PayPal hasn’t been asked yet: that waits for you." Before, it said "before PayPal was asked". | `crates/table-core/src/deal.rs:373`: a purchase reaches Agreed only by `(Pairing, PurchaseCleared)`. `crates/table-app/src/agent.rs:695-699`: `propose_purchase` runs only on `Ok(_)` from `mandate_check`, which covers both Allow and Ask. `mandate.rs:557-563`: `Ask` only when `amount > threshold`. The cells are marked `computed`. A haggle at Agreed stays unknown. | **Built** f9f0d1e |
| C3 Why it waits: no rule can pay | A waiting purchase with no ask-me clause behind it said "Your rules leave this decision to you." That implies a rule could have paid it. The card now says "Every purchase waits for you. Your agent can only ask; nothing is paid until you confirm it in the approval window." The first-visit explainer says the agent "can only ask: it never pays". Its third step says "You pay. Each step at PayPal waits for you in the approval window; if you do nothing, nothing is paid." | `crates/table-app/src/pipeline.rs:408-412`: `Authority::Policy` is refused for every purchase step, whatever the amount. `crates/table-runtime/src/dispatcher.rs:118-138, 222-225`: a gate's attention clause is set only to 6, and only above the threshold. So under it the card took the no-clause branch (`Purchase.tsx` `whyAsked`). Silence lapses a cleared purchase (`crates/table-runtime/src/service.rs:18-22`, 24 h). | **Built** 2610405 |

### Supporting

| Item | What changes | Why not built | Status |
|---|---|---|---|
| S1 A per-deal rule for another kind refuses | The rule check draws a per-deal rule for another kind as "does not apply" ("only for haggle deals", `gate.ts:119`). Rust refuses a purchase there ("deal kind not allowed", `mandate.rs:452`). A mandate holds at most one per-deal clause (duplicates refused, `mandate.rs:197-202`), so under such a mandate every purchase is refused at that rule. The cell should be a refusal, not "does not apply". | Third-item limit. It also replaces a pinned test, `marks per-deal clauses for another kind as not applicable`, whose CAPTURED purchase Rust could never produce. The Spend page reads lanes under `mandatesGoverning(…, 'purchase')` first (`logic.ts:544`), so this is reached only for a purchase listed under another rule set. | Waits on the operator |
| S2 The daily limit names its money | In the purchase pane's checklist, the Daily limit row reads "12 a day" (`columnValue`, `gate.ts:55`). That drops the money cap ($900 a day), which `mandate.rs:540-553` checks against the full total, and which is the figure Maya set. The row could read "12 a day · $900". | Third-item limit. The rule check's column already shows the money meter, so the gap is the pane only. | Waits on the operator |
| S3 "You decided" on a paid purchase above the ask-me limit | A purchase that reached PayPal reads "passed" at Ask me, even above its amount (`gate.ts` reached branch). That is true, since the check returned Ok, but it loses the story: the owner decided. A "you decided" cell kind would tell it. | It is a new cell kind and legend line, and a wording call ("passed" against "you decided"). C2 deliberately limited the ◆ to the waiting purchase so a paid one never reads as still pending. | Waits on the operator |

### Leaps

| Item | What changes | Why not built | Status |
|---|---|---|---|
| L1 The wallet's own reason per refusal | Each refused purchase shows the reason the wallet recorded: "category travel not allowed", "max_deals_day reached". Today the client reads the clause from `decided_by` and computes the amount only (`gate.ts` header). The reason exists in Rust (`Refusal::new(3, …)`, `mandate.rs:463-470`) and the `intent.refused` audit row, but no command returns it. | Needs a Rust read of the refusal reason: a new or changed IPC command, and a Layer-1 wording of Rust's strings. | Waits on the operator |
| L2 Today's meter on the rule check | The Daily limit column's meter reads "today: not counted" in the native build, because the shell reports `meters_available: false` (`service.rs:437`). | Needs a Rust read and an IPC change. The approval-window "after this" line is the owner-approval-decision pass's parked L2 and is not re-proposed here. | Waits on the operator |

### Left out

- **The approved-payees "asks you" branch.** `whyAsked` has a payees reason (`Purchase.tsx:42`), and
  `gate.test.ts:144` pins "Your “Approved payees” rule asks you". In Rust the payees rule only refuses
  (`mandate.rs:565`), and an attention clause is only ever 6 (`dispatcher.rs:135-138`). No mock world
  sets clause 7 (`mock/fixtures.ts:290`, `mock/scale.ts:730`), so Maya never sees it. Removing it is
  a tidy-up, not value.
- **Any change to what Rust checks, signs, authorizes, captures or voids.** Out of the lens.
- **Re-proposing anything parked:** value-2, security G-1/G-2/E-1, the agent-negotiation-run pass's
  C4-C6, S1-S4, L1-L3 and F2, and the owner-approval-decision pass's S1, S2, L1 and L2. None is
  touched here.

## What was built

All three are display or test changes inside the declared spend paths. None adds or changes an IPC
command, touches `crates/`, or calls PayPal. The decision card's options and their commands
(`approval_open`, `deal_let_lapse`, `deal_withdraw`) are unchanged, so no button became more
permissive.

- **ddbaef7** `fix(spend)`: `perDealRefusal` and `Cell.over` in `modules/spend/gate.ts`, used by
  `laneCells` and `ruleLine`.
  - Test: `gate.test.ts` "never says “over the limit” for an ask the per-deal rule refused within its
    limit". It fails on the old code: the cell read "this rule refused it" and the row "Over the
    per-deal limit ($200)".
- **f9f0d1e** `feat(spend)`: `laneCells` passes a cleared purchase (`gate.ts:105`, `:132-137`), with
  the ask-me rule computed. `Trace` takes `waiting`, and `PurchasePane` passes `!reachedPaypal(d)`. One
  word, `SPEND.allPassedWaiting`, is added.
  - Tests: `gate.test.ts` "passes every rule for a purchase the wallet cleared and that waits for you"
    and "marks the ask-me rule on a cleared purchase only above its limit, as the wallet applies it".
    Both fail on the old code.
  - Test: `areas/spend/trace.test.tsx` "a cleared purchase that waits for you passed every rule, and
    PayPal has not been asked". It fails on the old code; its partner test is a regression guard.
  - Two old pins read an Agreed purchase as unknown. They now use Pairing, where nothing was checked
    yet, and a haggle at Agreed is pinned as still unknown.
- **2610405** `fix(spend)`: `whyAsked` in `Purchase.tsx` (now exported for its test), plus
  `SPEND.whyPurchase` and the explainer `SPEND.why`.
  - Test: `areas/spend/why.test.ts`. "says every purchase waits for you, not that your rules left it to
    you" and "the first-visit explainer says the agent can only ask and only you pay" fail on the old
    code; with only the `export` added, the card returned "Your rules leave this decision to you.".
    The ask-me and hold test is a regression guard and passes either way.

## Found while building (not items)

- **F1. The feature doc lagged the page.** `docs/features/spend-purchases.md` quoted the explainer
  as "Agents ask to buy", "Your rules check it", "You pay or release", which the page no longer says.
  It now quotes the current steps and this pass's wording.

## Waits on the operator

S1, S2, S3, L1 and L2 above. In order of value for the video:
1. L1: the wallet's own reason per refusal (the strongest trust gain, but it needs a Rust read).
2. S1: a per-deal rule for another kind drawn as a refusal.
3. S2: the daily limit's money in the pane.
4. S3: "you decided" on a paid purchase.
5. L2, which needs a Rust read.

## Gates

At the end of the run, in this worktree, the client ran after `pnpm install --frozen-lockfile` in
`apps/desktop/client`, which made a real `node_modules` there, not a link:
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run`: 209 files / 2010 tests passed, at 2610405. The owner-approval-decision pass recorded 207 / 2002; this pass adds 2 files (`trace.test.tsx`, `why.test.ts`) and 8 tests.

No crate and no Rust test was touched, so cargo fmt, clippy and test were not run for this pass. The
merge gate runs `cargo test --workspace`. It doesn't run tsc or vitest.
