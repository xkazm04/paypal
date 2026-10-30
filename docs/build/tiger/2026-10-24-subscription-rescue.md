# Tiger deepening: subscription-rescue (2026-10-24)

A /tiger value pass on the Rescue surfaces: the Rescue page in the main window (summary, failed
renewals with their fixes, comparison, fixes in progress, recovered money, watching), and the
approval window's watch and replay sheets. The pass covers
`apps/desktop/client/src/windows/main/console/areas/rescue/`, `modules/rescue/`, `lib/words/rescue.ts`,
`mock/rescue.ts`, `windows/approval/owner/RescueWatch.tsx`, `RescueReplay.tsx` and
`rescueWatch.test.tsx`. Rescue answers Maya's question "a subscriber's renewal failed: what happens
if I do nothing, and what can I offer them?" Goal lens: every sentence the page says about a
rescue (its deadline, its lever, its offer, a watch's hold or stop, a replay) is true for a
non-technical merchant owner and for a judge watching a 3-minute video, without weakening any fence.

Headless run, the same shape as the agent-gated-spend pass
([2026-10-24-agent-gated-spend.md](2026-10-24-agent-gated-spend.md)). The App Master's brief covers
building items that meet all five criteria:
- offline-verifiable, with a Vitest test that fails on the old code;
- inside the declared paths;
- no new or changed IPC command, no change to `crates/` or `bindings/`, nothing on the money path or
  the rescue executor;
- no live PayPal call;
- every AGENTS.md invariant holds.

Anything that needs Rust, the executor or a path outside the brief waits on the operator.

## Thesis

What the Rescue page says will happen is what the wallet will do:

- "PayPal retries" is said only on PayPal's own retry time. The fix's deadline is named as the time
  the fix closes, which is what Rust does at it.
- A replayed failure, which has no failed payment at PayPal, promises no PayPal retry.
- "Checked with PayPal every few hours" is said only while the wallet is checking.
- Stopping a watch says it leaves the fix it already suggested open.

No fence changes. Every change is display only.

## Seats

`single-family`. This pass convened no council, for the same reason as the agent-gated-spend pass:
a council's seats run in a shared detached worktree that `tiger.mjs convene` creates, and this
builder's brief forbids creating or removing a worktree. The judge (Claude Opus 5.5) proposed alone,
from the code, checked each premise at its Rust anchor before building, and kept the five criteria
as the build gate. There are no peer ratings, no per-seat ledger and no cost to report.

Not written, because each is outside the declared paths: the skill's `tiger/` vault, the registry
consult and run-log lines. This file is the record.

## Scope

Ordered by value for the video. Each premise was verified in code at `0102401`. Rust was read only.

### Core

| Item | What changes for Maya and the judge | Premise (verified) | Status |
|---|---|---|---|
| C1 "PayPal retries" only on PayPal's time; say when the fix closes | Every failed renewal's "Do nothing" card read "PayPal retries in 4 days". The same claim appeared in its detail ("PayPal retries the payment by itself in 4 days (Tue 14:00)"), its subscriber preview ("PayPal retries Tue 10 Nov"), its Why? and the comparison row ("retry in 4 days"). Each time came from the fix's deadline. Without a time, the page said "No retry is set" / "This month stays unpaid", which claims PayPal won't retry. Now only PayPal's own retry time (`RescueView.next_retry_at`) is shown as PayPal's. Without it the page says "PayPal retries on its own; your wallet hasn't been told when". A new line names the deadline: "This fix is open until Tue 14:00 (4 days left). If you haven't approved it by then, it closes and nothing is sent." The "retry within a day" switch-off reads PayPal's time, and an unknown time is drawn as unknown, not passed. | `crates/table-app/src/rescue.rs:224-227`: the deadline is `next_retry_at` when known, else `now + RESCUE_RETRY_DEFAULT_SECS` (5 days, `:39`). Every Rust path opens with `next_retry_at: None` (`rescue.rs:410` detection, `table-runtime/src/rescue.rs:64` replay; STATUS "Left: read PayPal's next retry time into the fix's deadline"). At the deadline an AGREED fix lapses to WITHDRAWN (`table-core/src/deal.rs:393`, `rescue/deadline.rs:96-99`). `check_lever` keys "retry within a day" on `context.next_retry`, and an unknown time passes (`table-core/src/rescue.rs:42-49`). `RescueView.next_retry_at` is "PayPal's own next retry, when known" (`bindings/RescueView.ts`), and the client never read it. | **Built** b7fb420 |
| C2 A replay promises no PayPal retry | The sample world's showcase renewal (D-0188) is a replay. Its summary read "If you do nothing, PayPal retries the payment by itself.", its card "PayPal retries in 4 days", and its "If you do nothing" line "nothing is sent · PayPal retries the payment by itself". For a replay these now read: "It's a replay: if you do nothing, nothing is sent and PayPal has nothing to retry." and "A replay: PayPal has nothing to retry". The preview, Why? lines, comparison row and not-offered Why? say the same. | A replay is recorded because PayPal can't fail a test renewal (`RESCUE_REPLAY_ABOUT`; STATUS "Subscription rescue" item 1). Rust records no retry for it (`table-runtime/src/rescue.rs:64`). The mock gives D-0188 a retry date (`mock/fixtures.ts:515`), which Rust never would; `paypalRetry` ignores it for a replay. | **Built** bede514 |
| C3 The Watching view says when nothing is being checked | The Rescue page's Watching view said "Checked with PayPal every few hours for a failed renewal", and its card "3 of 100 checks today", even while the wallet had stopped. Now a hold shows its own sentence, e.g. "Not checking while your agents are paused.". When the day's checks are used up, it reads "Today's checks are used up, so nothing is being checked. Your wallet checks again from Sun 01:00" (the next UTC midnight in local time). | `table-runtime/src/rescue.rs:129-144`: `rescue_watch_hold` (paused, not connected, no rules, no key) is the one reason the pass stops, and it is put on every `RescueWatchView` (`:149`, `:170`). `:253`: past `RESCUE_WATCH_READS_DAY` in the UTC day nothing is read. Only the approval window's sheet showed `held` (`RescueWatch.tsx:82`). | **Built** fd12048 |
| C4 Stopping a watch keeps its fix | "Stop watching" said nothing about a fix the watch had already suggested. The button's title now says so, and so does a note in the sheet when a watched subscription has one: "Stopping only ends the checks. A fix this subscription already has stays open for you to approve, or it closes on its own with nothing sent." | `table-ledger/src/rescue_watch.rs:145-147`: "A rescue it already opened is not touched"; `bindings/RescueWatchStopArgs.ts`: "A fix it already opened is unchanged". | **Built** 16f2abe |

### Waits on the operator

| Item | What changes | Why not built | Status |
|---|---|---|---|
| W1 The wallet's "if you do nothing" line for a replay | The attention line for an AGREED rescue is "nothing is sent · PayPal retries the payment by itself" for every rescue, a replay included (`table-attention/src/lib.rs:48`, `:244`; `RESCUE_SILENCE` in `lib/words.ts`). C2 shows the panel's own line for a replay; the Rust line should say it too, so every surface (Home, Tumbler, approval) agrees. | Rust wording change (`crates/`). | Waits on the operator |
| W2 Read PayPal's next retry into the fix | The fix's deadline is PayPal's retry only when the failure carries one, and none does today. Detection could read `next_payment_retry_time` and fill `next_retry_at`. C1's "PayPal retries in …" then shows a real date, and the fix closes at PayPal's retry. | Rust plus a live check. The field path is UNVERIFIED (STATUS "watching the owner's subscriptions": `billing_info.last_failed_payment.next_payment_retry_time`). | Waits on the operator |
| W3 Mock parity for the retry and the hold | `mock/fixtures.ts:515` gives the D-0188 replay a retry date, and `mock/scale.ts:457` gives AGREED rescues a retry unrelated to their deadline. Rust sets neither: a replay has no retry, and a known retry *is* the deadline. The mock's `rescue_book` never sets `held` (`mock/backend.ts:1388`), so C3's hold can't be seen in the browser preview. | Outside the declared paths (`mock/fixtures.ts`, `mock/scale.ts`, `mock/backend.ts`). | Waits on the operator |
| W4 "not checked yet" while held | The chip's explanation for a waiting watch is "Your wallet checks it with PayPal within a few minutes." (`RESCUE_WATCH_STATE.waiting.means`, `lib/words.ts`). That is untrue while a hold stops the pass. The row's own line already shows the hold. | Outside the declared paths (`lib/words.ts`). | Waits on the operator |
| W5 The feature doc lags the page | `docs/features/rescue.md` says "Doing nothing is always safe: PayPal retries the payment by itself" (line 6, untrue for a replay). It lists the Watching row as "N of 100 checks today" (line 33), and Stop watching with no word on the open fix (line 47). | Outside the declared paths. There is no `docs/build/rescue` wording note. | Waits on the operator |

### Left out

- **Pause, Retry after fix and Downgrade.** They read "Not available yet" and are not built in Rust.
  That is honest, and building them is executor work.
- **The approval window's rescue gate and hold button** (`windows/approval/review/…`). They are
  outside this pass's paths, and the owner-approval-decision pass covered the review.
- **The "What PayPal is asked to do" disclosure** lists PayPal API paths (`POST /v2/invoicing/…`).
  They are true, and they sit one level down behind a disclosure. Whether they count as an internal
  is a UX call, not a truth defect.
- **The replay refusal mapper** (`RescueReplay.tsx` `replayRefusal`) matches `/clause 5|day/`
  loosely. It was not re-checked against every Rust refusal string, and nothing here shows a wrong
  sentence.
- **Any change to what Rust detects, offers, invoices, counts or lapses.** It is out of the lens.

## What was built

All four are display or test changes inside the declared rescue paths. None adds or changes an IPC
command, touches `crates/` or `bindings/`, or calls PayPal. The hand-off (`approval_open`, with or
without the lever draft), the replay and the watch add/stop commands are unchanged, so no button
became more permissive.

- **b7fb420** `fix(rescue)`: `paypalRetry` in `modules/rescue/model.ts`. `cellState`, `splitFixes`
  and `rulesFor` take PayPal's retry, not the deadline. `parts.tsx` reads it for every retry claim
  and adds the `.rs-close` line. In `preview.ts` and `lib/words/rescue.ts`, the "no retry set"
  wording becomes "hasn't been told when". A new word: `RESCUE.closes`.
  - Test: `areas/rescue/deadline.test.tsx`. "without PayPal's retry time, shows no PayPal retry
    date, only when the fix closes" and "with PayPal's retry time, the retry is PayPal's and the
    deadline stays the fix's" both fail on the old code. The old card read "PayPal retries in 5 days".
  - Tests: `model.test.ts` "reads PayPal's retry from the wallet's rescue read only, never from the
    fix's deadline" and "an unknown PayPal retry is not checked as more than a day away". Two pins in
    `preview.test.ts` asserted the untrue "No retry is set" / "PayPal has no retry set, so this month
    stays unpaid" and are replaced, as is the `cellState` pin "cycle unpaid". All five fail on the old
    code.
- **bede514** `fix(rescue)`: `isReplay` in `model.ts`, and `paypalRetry` returns none for a replay.
  The replay words are `RESCUE.answer.replay`, `replayNoRetry`, `replaySilence`, `nothingSafeReplay`
  and `nothingDoes.replay`. `answerOf` (`RescueLayer.tsx`) is now exported for its test.
  - Tests: `deadline.test.tsx`, block "a replayed failure": "promises no PayPal retry on its panel",
    "says on the summary that doing nothing sends nothing, not that PayPal retries" and "its preview
    and Why? name no PayPal retry". All three fail on the C1 code with only the `export` added.
- **fd12048** `fix(rescue)`: `watchStatus` in `model.ts` (hold, then the day's budget, then
  checking). `watchLines` in `RescueLayer.tsx` words it for the Watching view and its card. New words:
  `RESCUE.watch.spent` and `.spentNote`.
  - Test: `areas/rescue/watching.test.ts`. "a hold says why nothing is checked" and "with today's
    checks used up …" fail on the old logic (extracted unchanged as `watchLines`). "while checking,
    says so with today's count (unchanged)" is a regression guard and passes either way.
- **16f2abe** `fix(rescue)`: `STOP_KEEPS_FIX` in `owner/RescueWatch.tsx`, as the Stop button's title
  and as a note when a watched subscription has a fix suggested.
  - Test: `rescueWatch.test.tsx` "says stopping keeps a fix the watch already suggested open" fails
    on the old sheet, with only the constant added. "shows no such note when no watched subscription
    has a fix" is its guard.

## Gates

At the end of the run, in this worktree, the client ran after `pnpm install --frozen-lockfile` in
`apps/desktop/client`, which made a real `node_modules` there, not a link:
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npx vitest run`: 211 files / 2022 tests passed, at 16f2abe. The agent-gated-spend pass recorded 209 / 2010; this pass adds 2 files (`deadline.test.tsx`, `watching.test.ts`) and 12 tests.
- `gitleaks git --log-opts="main..HEAD"`: 4 commits scanned, no leaks found.

No crate and no Rust test was touched, so cargo fmt, clippy and test were not run for this pass. The
merge gate runs `cargo test --workspace`. It doesn't run tsc or vitest.
