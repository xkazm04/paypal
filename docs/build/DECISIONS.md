# Decisions

The project's decision record, newest first. Each section gives the date, who decided, the
constraint that forced the choice, the decision, the alternatives that lost, the consequences and
the evidence. Records 4-7 were written from `git show` of the named commits; the council and scan
reports they cite are not in the repository (`.claude/council` and `.claude/scan-history` hold
configuration and ledgers only), so what they said is taken from the commit messages and is marked
where unconfirmed. "Decided, implementation in flight" means no commit exists yet.

## 1. Submission cut: waves 1-3 merge before the video

- **Date:** 2026-10-07
- **Decided by:** the operator
- **Constraint:** the owner's 2026-10-06 themes total about 102.5 focused days against about 37
  working days to the 2026-11-12 deadline (`docs/concepts/moonshot-backlog.md` §1a), so not
  everything chosen can land. The videos are recorded Nov 6-9 from whatever has merged.
- **Decision:** waves 1-3 of the 2026-10-06 sequencing (moonshot-backlog §1a) merge before the
  Nov 6-9 video. Two builders run continuously. Wave 2 (T6, T7, T11, T12) merges by Oct 28 and
  wave 3 (T8, T9, T14, T15) by Nov 4. Verification is compressed into Nov 4-6. Wave 4 (T13, T16,
  T17, T18, T19) is post-submission. T3 is not scheduled by the cut; it stays gated as its `any`
  row says (a passing spike 2 and the owner's confirmation of the "no deal data before the
  inventory" rule).
- **Lost:** wave 1 only, which leaves T7 alone to carry the demo; waves 1-2 with wave 3 after
  submission. (The reasons these lost are not written down beyond the choice itself: not confirmed.)
- **Consequences:** wave 4 items (selective disclosure, verified projection, protocol spec, sealed
  relay, OS payment sheet) are not in the submission. The gate for every merge is still the full
  check; the compressed Nov 4-6 window is the only slack for verification.
- **Evidence:** decided, implementation in flight. The schedule is recorded in
  `docs/concepts/moonshot-backlog.md` §1a ("Submission cut (owner, 2026-10-07)").

## 2. The typed plain-English Book question is nice to have

- **Date:** 2026-10-07
- **Decided by:** the operator
- **Constraint:** the Book's typed question needs an engine path that turns text into a query the
  Rust side checks. None exists: STATUS records "typed Book questions stay preset-only (no engine
  turns text into a BookQuery)" (`docs/build/STATUS.md:124`) and the `book_query` row (STATUS row 6,
  `docs/build/STATUS.md:56`) runs only the closed `BookQuery` lenses in Rust.
- **Decision:** the typed question is built only if builder time remains after waves 1-3. The seven
  preset lenses are the submission scope, and the week lens date-range fix is still planned. A
  council judges the presets and treats the typed question as a queued goal, not a defect.
- **Lost:** build it now (a new engine path: a `BookQuery` schema checked by Rust); remove the Ask
  box now. (Their rejection reasons beyond the above are not confirmed.)
- **Consequences:** the Ask box stays as it is until the question is built or the operator says
  otherwise; the Book's honesty rests on the presets. STATUS is unchanged by this record.
- **Evidence:** council-lite ops-ledger-query round 1, must-address 1 (report not in the repo;
  cited from the task). Decided, implementation in flight for the week-lens fix.

## 3. Purchase authority: the owner decides every purchase

- **Date:** 2026-10-07
- **Decided by:** the App Master, under the operator's delegation
- **Constraint:** council-lite agent-gated-spend must-address 1: there was no path from a pending
  purchase to a PayPal order. The design's rule is that every purchase is AUTHORIZE, then human
  approval, then countersigned capture, with no unattended spending
  (`docs/design/the-table.extract.txt:222`).
- **Decision:** a buyer purchase that passes the mandate check clears from PAIRING to AGREED
  through a new `DealEvent::PurchaseCleared`. Creating, authorizing and capturing a purchase each
  need the owner's decision in the approval window. The clause-6 policy countersign does not apply
  to purchases, and the scheduler no longer creates purchase orders.
- **Lost:**
  - Policy creates the order at or under clause 6: it lets policy start a purchase order, which
    the design forbids.
  - The owner confirms while the deal is still PAIRING: it needs a new client gate and an
    attention change, which the worktree gate cannot check.
  - Purchases post-submission: it drops the product's central claim from the demo.
- **Consequences:** a purchase can never be started by a rule or by the scheduler; silence on a
  purchase moves no money. The three owner decisions per purchase add clicks to the demo path.
- **Evidence:** decided, implementation in flight in a separate run; no commit cited.

## 4. A deal's place in the daily budget is fixed when it agrees

- **Date:** 2026-10-07 (scan C-4)
- **Decided by:** the App Master under the operator's delegation (inferred from the commit being
  merged to `main`; the decision-maker is not stated in the commit)
- **Constraint:** `Ledger::usage_for` counted deals by creation time, so two deals that agree out
  of creation order could both pass `max_deals_day`. Run 1c7f5d10 showed it (the run itself is not
  in the repository: cited from the task).
- **Decision:** a deal counts against another when it agreed earlier on the same UTC day as the
  other deal's own agreement. The place is the first `deal.transition` audit row whose `to` is
  AGREED, ordered by audit `seq` (which orders two agreements in the same second). Open tables
  never count. A deal that has not agreed is counted as if it agreed now, after everyone agreed so
  far. Fail closed: a deal past agreement with no readable agreement row counts against every
  other deal.
- **Lost:**
  - The scan's own fix, which counted only earlier-created agreed deals: run 1c7f5d10 showed
    out-of-order agreement defeats it.
  - A migration-0008 `agreed_seq` column: not needed, because every state write goes through
    `apply_decided`, which writes the transition row, so the audit log already carries the order.
- **Consequences:** budget order follows agreement order, not creation order; the check depends on
  the audit log's transition rows, which are append-only. Unreadable history makes the budget
  stricter, never looser.
- **Evidence:** commit 8a7e101 (`crates/table-ledger/src/repositories.rs`, `usage_for`; tests
  `c4_*` in `crates/table-ledger/src/tests.rs`).

## 5. A mandate band fails closed at signing

- **Date:** 2026-10-07
- **Decided by:** not stated in the commit; merged to `main` (decision-maker not confirmed)
- **Constraint:** a mandate whose roles cannot act on its per-deal kind, or whose band lacks the
  bound the acting roles use, could be signed yet never allow an intent: the owner signs something
  that silently refuses everything.
- **Decision:** `MandatePayload::validate()` and the client mirror refuse, at signing:
  - a roles clause where no role can act on the per-deal kind (refusal on clause 1), for example
    Sell on a purchase, Buy on a shop order or rescue;
  - a band that lacks the side the acting roles use (refusal on clause 4): a buyer needs a
    ceiling, a seller or shop needs a floor; a band with both roles needs only one side.
  `check()` and `validate()` now read one pairing table, `role_acts`.
- **Lost:** leaving the mismatch to be refused at intent time. (Not stated in the commit beyond
  "could be signed yet never allow an intent"; other alternatives not confirmed.)
- **Consequences:** previously signable mandates of these shapes no longer validate; a mandate
  with no band clause is unaffected by the band rule.
- **Evidence:** commit 22c35af (`crates/table-core/src/mandate.rs`; client mirror in
  `apps/desktop/client/src/windows/approval/mandateDraft.ts`).

## 6. Relay capacity: only pre-capture routes hold it

- **Date:** 2026-10-07 (scan C-3)
- **Decided by:** not stated in the commit; merged to `main` (decision-maker not confirmed)
- **Constraint:** the relay holds at most 64 routes. Counting every non-terminal deal kept
  Captured and Receipted deals in the cap, and a HOUSE request that failed midway could hold a
  request slot or leave an orphan Pairing deal with no deadline.
- **Decision:** only pre-capture routes count toward the 64-route cap; Captured and Receipted
  routes release theirs. A route with nothing owed stops being polled once its deal is finished,
  but a Receipted route stays polled: a relay restart is noticed only by polling, and both wallets
  must then resend the signed history. HOUSE `Seller::table` sets the silence deadline right
  after `create_deal`, binds the relay and lists, and reserves the request slot last.
- **Lost:** not stated in the commit (alternatives not confirmed). The commit's own text names the
  reason Receipted routes stay polled rather than going quiet.
- **Consequences:** a failed HOUSE request leaves a Pairing deal that lapses on its deadline and
  holds no request slot; the retry makes a fresh deal. Receipted routes cost polling but no
  capacity.
- **Evidence:** commit 5d93b43 (`crates/table-ledger/src/relay.rs`,
  `services/house-seller/src/hosted.rs`, tests in `crates/table-ledger/src/tests.rs` and
  `crates/table-runtime/src/house_tests.rs`).

## 7. Attention faults are visible, claims are released, LetLapse follows the card

- **Date:** 2026-10-07 (council attention-escalation must-address 1-3)
- **Decided by:** not stated in the commits; merged to `main` (decision-maker not confirmed). The
  council report is not in the repository.
- **Constraint:** the 1 s tick swallowed a failed `attention()` read, so the Tumbler could go stale
  without a sign; a notification rung was claimed before the toast showed, so a failed toast spent
  the rung; `LetLapse` accepted any non-terminal deal with a deadline, including a Hold or an
  Authorized deal whose card offers no Let lapse.
- **Decision:**
  - MA-1: a failed attention read is one visible `Fault` per failure streak, and it clears the
    cached snapshot so the first good read after it is published even if it equals the stack held
    before the failure (`attention_event` in `crates/table-runtime/src/actor.rs`).
  - MA-2: the notification claim is released when no toast was shown (`notify_once`, a new
    tumbler-only `ReleaseNotification` action, and `AttentionLadder::release`). Releasing can never
    make money move.
  - MA-3: `LetLapse` requires a Gate item whose card offers `LetLapse` in the current attention
    snapshot, the same gate the card offered.
  - Test seam: `Runtime.fail_attention` (`crates/table-runtime/src/service.rs:78-80`, read at
    `crates/table-runtime/src/dispatcher.rs:106-111`) is `#[cfg(test)]` only. It makes
    `attention()` fail so a test can prove the actor surfaces the fault. The commit says only "Test-only"; the reason it is not
    compiled into shipped builds (no switch that can make the attention read fail) is inferred, not
    stated.
- **Lost:** not stated in the commits (alternatives not confirmed). The commits show the fixes
  without recording rejected options.
- **Consequences:** an attention outage is shown to the owner once, not repeated each second; a
  toast that fails can be retried inside the same rung; a lapse can only be chosen where the owner
  was shown it.
- **Evidence:** commits a83458f (MA-1), 3ac0b38 (MA-2), c734558 (MA-3).

## 8. A purchase without a band gets a 24-hour decision window

- **Date:** 2026-10-07
- **Decided by:** the App Master under the operator's delegation.
- **Constraint:** open point 1 (med) of the agent-gated-spend full council, round 1. `service.rs`
  set a purchase's deadline only from a Band clause, and `mandate.rs` requires a Band only for
  Haggle and ShopOrder. So an AGREED purchase under a mandate without a Band waited for the owner
  indefinitely and kept its place in the daily budget (section 4). AGENTS.md requires that every
  deadline has a default.
- **Decision:** a purchase created under a mandate with no Band gets a 24-hour window from
  creation. At the deadline the default applies: it lapses to WITHDRAWN and no money moves. A Band
  deadline still wins.
- **Lost:**
  - Leaving it to wait: it breaks the invariant.
  - Setting the deadline at PurchaseCleared inside `propose_purchase`: a PAIRING purchase would
    still have none, and the ledger would own a timing policy.
  - 72 h like the authorization hold, or 6 h like order creation: 72 h is too long for a proposal
    whose price can move, and 6 h is too short for an owner who checks once a day.
- **Consequences:** an unattended proposal lapses within a day, and the agent must propose again.
  Deals created before this commit keep no deadline; there is no backfill, because this is
  prototype data.
- **Evidence:** commits 4810a30 (deadline), cf3f14c (one audit row), f3b86b6 (copy), faf57e9
  (forecast test); tests
  `table-runtime::tests::a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins`
  and `table-attention::forecast::tests::buyer_purchase_agreed_with_a_deadline_lapses_there_and_moves_no_money`.

## 9. The shield after H5: money in needs no click

- **Date:** 2026-10-07
- **Decided by:** the operator (ask c9f99185); the new-counterparty threshold by the App Master.
- **Constraint:** acceptance H5: the seller wallet takes money in with no click. The shield gate
  stopped ASK for every authority except a human, so a buyer-approved order waited for the owner.
- **Decision:** one shield gate, `shield_allows` in `crates/table-app/src/pipeline.rs`.
  - HOLD and BLOCK stop every step under every authority.
  - ASK passes Human and HouseMandate. It passes SellerMandate on authorize and capture only, on an
    order the buyer already approved on PayPal.
  - Create, purchases and Policy keep the old gate, so the seller's create keeps asking (the
    operator, 2026-10-07).
  - A released HOLD lifts only the hold it released; BLOCK is never lifted.
  - A stale market price can hold a deal but never clear it.
  - A new counterparty stays ASK above 100.00 in any currency for the submission; per-currency
    thresholds come after it. The council fixtures that showed HOLD were drift.
  - A capture ends in Receipted, because capture records the receipt in the same call.
- **Lost:** keeping ASK blocking for the seller wallet (money in would need a click); letting a
  fresh market price clear a hold (not confirmed beyond the commit messages).
- **Consequences:** receiving money needs no click, and no new path lets an agent send money
  without the owner or a signed rule.
- **Evidence:** commits 92988cd, 495eac2, 4a95c05, 238d1ef, 675da5a, eaaeca1; test
  `a_stale_market_can_hold_a_deal_but_never_clear_it`; the H5 section of `docs/build/STATUS.md`.

## 10. BandAdjust warns but does not disable Sign

- **Date:** 2026-10-07
- **Decided by:** the App Master.
- **Constraint:** the mandate-authoring rework (c664f70) needed a rule for the BandAdjust warning.
  Section 5 already makes a bad band fail closed at signing.
- **Decision:** BandAdjust shows a warning and leaves Sign enabled.
- **Lost:** disabling Sign on the warning (not confirmed; the reasons are not written down beyond
  the choice).
- **Consequences:** the owner can sign past the warning; the signing check in section 5 still
  refuses a band that is invalid.
- **Evidence:** commit c664f70 (STATUS entry for the rework). Not confirmed beyond that commit.

## 11. Proof files are checked in the app and saved with a warning

- **Date:** 2026-10-07
- **Decided by:** the operator (ask c866d3ed) for in-app checking; the App Master for the warning.
- **Constraint:** the proof file carries the deal's rules (price limits, payees, caps and the other
  side's notes), and a non-technical merchant should not need a command-line tool to check one
  (`docs/ux/UX-GUIDE.md`).
- **Decision:**
  - A proof file is checked inside the desktop app with the same verifier code, and the screen
    stops naming the command-line tool.
  - Saving a proof first warns that the file carries those rules; nothing is withheld.
  - Withholding parts of a mandate is T13, which is post-submission.
- **Lost:** withholding parts of the mandate now (T13, post-submission); keeping the command-line
  tool as the only check (not confirmed).
- **Consequences:** the owner is told what a shared file reveals; the file itself is unchanged.
- **Evidence:** commits 22fdf4a (Check a proof file, in the Book) and 5608341 (the warning before
  save), on main at a95b80a.

## 12. The HOUSE health check follows each deal step

- **Date:** 2026-10-07
- **Decided by:** the App Master.
- **Constraint:** scan C-8 (2ab2b4d) writes the heartbeat only at the start of a timer tick, so a
  tick that awaits PayPal can hold `/healthz` at 503 for more than 30 s. `render.yaml`'s health
  check could then restart the HOUSE in the middle of a money step. Found in the house-seller-demo
  council-lite r1 review.
- **Decision:** write the heartbeat around each awaited deal step, and raise the threshold above
  the longest single PayPal await. Also decided: the scan's optional skip of identical polls in
  `record_paypal_call` is not done; after C-5's backoff it would save about 1.7% of poll rows and
  it would touch the audit path.
- **Lost:** loosening the threshold alone.
- **Consequences:** a slow PayPal call no longer reads as a dead actor. Until it is built, the
  window above stays open.
- **Evidence:** built in 5915462, with the tests `house_health_stays_up_through_a_slow_tick_of_several_deals`
  and `healthz_follows_the_heartbeat`. Commits 2ab2b4d (C-8) and 5f1e5e0 (C-5); the STATUS
  "Security fixes" section. The full council found two things: the const assert at
  `services/house-seller/src/hosted.rs:110` compares the constant with itself, so it cannot catch a
  change in table-paypal; and Render's health-check interval, failure threshold and restart rule are
  UNVERIFIED.

## 13. Subscription rescue: one lever, built end to end

- **Date:** 2026-10-07
- **Decided by:** the operator (ask a3706d60)
- **Constraint:** the submission cut (section 1) leaves limited time, and the live sandbox invoice
  check (spike 8) is an external PayPal call.
- **Decision:** build one lever, DISCOUNT_THIS_CYCLE, end to end in wave 3 for the submission, and
  ask the operator before spike 8. Its first slice counts only receipted, verified captures as
  recovered money.
- **Lost:** a preview label now with the build after the submission; hiding rescue; nice to have.
- **Consequences:** one lever is real and the rest are out of scope; no live call happens without
  the operator's ask.
- **Evidence:** decided, implementation in flight. Recorded in `docs/concepts/moonshot-backlog.md`
  §1a ("Submission cut").

## 14. The hosted HOUSE reads its secrets from named host environment variables

- **Date:** 2026-10-07
- **Decided by:** the operator (ask 98427ca9, 'Allow it, write it into AGENTS.md')
- **Constraint:** the HOUSE runs on Render, which has no OS keychain. AGENTS.md put every secret in
  the keychain, and the council's credential_outside_vault counted any other place as a hard
  failure. The house-seller-demo council-lite r1 (run 29854007) asked for the exception to be
  confirmed before the feature's full council.
- **Decision:** the sentence written into AGENTS.md in the secrets bullet: the hosted HOUSE
  (`services/house-seller`) reads its signing seeds, its signed mandate and its PayPal sandbox
  credentials only from named host environment variables, never from files, and they never appear
  in logs, responses or fixtures.
- **Lost:** allowing it in DECISIONS.md only, with AGENTS.md unchanged; holding the HOUSE's full
  council until later.
- **Consequences:** the full council does not score the named variables as credential_outside_vault.
  A HOUSE secret in a file, a log, a response or a fixture still fails. The desktop wallet's rule is
  unchanged.
- **Evidence:** `services/house-seller/src/environment.rs`, the envVars in `render.yaml`, and this
  run's AGENTS.md and council config commits (e340c78, 855e8c6).

## 15. A card's 'if you do nothing' line comes from that deal's forecast

- **Date:** 2026-10-07
- **Decided by:** the App Master
- **Constraint:** attention-escalation council-lite r2 (run 75df7849, ready 0.70) found that a seller
  card, and its toast, still say 'no money moves' while the same attention snapshot forecasts a
  capture. Since H5 (section 9), a seller wallet takes in a payment the buyer already approved,
  under its signed mandate, with no click. `docs/ux/UX-GUIDE.md` question 3 still reads 'always: no
  money moves, or a hold is released'.
- **Decision:** the card's silence line and its toast are worded from that deal's walk-away
  forecast. A deal whose forecast shows money coming in says so. Every other card keeps 'no money
  moves' or 'a hold is released'. Money never leaves on silence. UX-GUIDE question 3 changes in the
  same branch as the code.
- **Lost:** one fixed, reworded line for every seller card. It would be wrong for seller deals whose
  forecast shows no money step, and it would be a second source that drifts from the forecast.
- **Consequences:** the forecast is the one source for what silence does.
- **Evidence:** commits d7d74cf, a3d4908 and 83f70dc. Tests:
  - table-attention `silence::tests`, a card per forecast ending;
  - `card_and_forecast_agree_over_every_input`: no 'no money moves' where the forecast has a money-in
    step, no money-in claim without one, executor on and off;
  - `forecast::tests::without_a_payment_executor_no_authorize_or_capture_is_forecast`;
  - desktop `native::events::fault_tests::each_failure_streak_is_shown_once`.

  The client was not typechecked.

## 16. The public servers get their limits from tower-http and hyper-util, already in the lock

- **Date:** 2026-10-09
- **Decided by:** the App Master
- **Constraint:** security scan 2026-10-07 finding C-6 (Medium, denial of service). The HOUSE and the
  standalone relay both served through plain `axum::serve`: no header-read timeout, no body or
  request timeout, no connection limit, and no limit on concurrent long-polls. A few hundred idle
  sockets could starve a 512 MB instance. Whether Render's edge proxy enforces any of these is
  unverified, and nothing in the research says it does.
- **Decision:** `tower-http` (feature `timeout` only) and `hyper-util` (server, graceful shutdown,
  service) and `hyper` become direct workspace dependencies of `rendezvous`. All three were already
  in `Cargo.lock` as transitive dependencies: the lock gains no package and no version change, only
  dependency edges inside existing entries (`rendezvous` gains three, `tower-http` gains `tokio`).
  `rendezvous::serve` replaces `axum::serve` in both binaries; the HOUSE still drains its actor
  after serve returns. Limits, each a named constant with its reason in `serve.rs` and `lib.rs`:
  - 512 open connections (a semaphore permit taken before accept; at the limit clients wait in the
    backlog, the listener stays open);
  - 10 s to read a request head;
  - 10 s for each body chunk to arrive;
  - 30 s for a whole request, above the 25 s long-poll cap and the HOUSE's 20 s actor reply timeout;
  - 128 concurrent long-polls across both poll routes; past that a poll answers at once as if
    `wait=0`, never with an error. The wallet polls once per tick (wait 0, then 2 s), so an
    immediate empty answer is not a hot loop.
- **Lost:**
  - Hand-rolled timeouts only (tokio timers around every handler and a hand-made accept loop): more
    code to get wrong, and tower-http's layers are the tested form of the same thing.
  - Relying on Render's edge: unverified, not under our control, and absent when the relay runs
    anywhere else.
- **Consequences:** the supply chain is unchanged. A client that stalls costs one socket for at most
  the timeouts above. The timeouts are applied once to the finished router inside `serve`, so the
  HOUSE's own routes are covered without touching `hosted.rs`.
- **Evidence:** `services/rendezvous/src/serve.rs`, `services/rendezvous/tests/serve.rs`; commits on
  branch autopilot/codebase-security-scan-a7e8fc6e.

## 17. The onboarding tour is data and one coach mark per window, with no library

- **Date:** 2026-10-09
- **Decided by:** the App Master, on the operator's weekend goal 1 (2026-10-09)
- **Constraint:** a new owner needs a short walk through the wallet's first steps, in three windows
  (`main`, `tumbler`, `approval`) that share no page and no process. The CSP is `default-src 'self'`,
  the repo keeps new dependencies to a minimum (AGENTS.md), and the tour must not be able to move
  money: the approval window stays the only place that countersigns, and no IPC command was to
  change for the tour.
- **Decision:**
  - **No tour library.** The tour is data: `lib/tour.ts` lists 13 stops (5 in The Table, 4 in the
    Tumbler, 4 in the approval window), each with a `data-tour` anchor on an existing element.
    `shared/tour.tsx` places the mark with `getBoundingClientRect` and React's style prop.
  - **One coach mark per window, not one tour across windows.** Each window keeps its own progress
    in `localStorage` (`table-tour`, and `table-tour:first-run` for the `?first_run=1` preview),
    guarded with an in-memory fallback. The tour starts by itself only on first run. Skip or finish
    keeps it closed until 'Take the tour'. A stop whose anchor is missing is passed over. The agent
    app stop drops out once an app is chosen.
  - **The Tumbler never takes the keyboard.** Focus moves into the mark only while its window
    already has focus.
  - **The director points a framed window's tour by writing to storage**, `{ do: 'tour', win, at }`,
    with no click. That is not a world action, and nothing in the tour approves, signs, pays,
    captures or locks.
  - **'Choose your agent app' is the fourth step**: done on `claude-code` or `codex-cli`, to do on
    the practice agent. The Tumbler's step opens The Table's Home, not Settings, because `main_open`
    takes only a deal id.
  - **The rehearsal rig uses a Playwright installed outside the repo**, pointed at through the
    `PLAYWRIGHT` environment variable. Playwright is never a dependency.
- **Lost:**
  - A tour library (a step-by-step overlay package): it needs inline styles or injected CSS the CSP
    refuses, and it is a new dependency for 13 sentences.
  - One tour across the three windows, with shared progress: the windows share no page, so it would
    need a new IPC command or a cross-window channel, and a tour that moves focus between windows
    would take the keyboard.
  - The Tumbler's step opening Settings directly: it needs a new `main_open` target, an IPC change.
  - Driving the tour in the director by clicking Next: a click is a world action the director does
    not make. A storage write needs none.
  - Playwright as a dev dependency: a browser download and a lock change for a rehearsal that only
    the builder runs.
- **Consequences:** a stop is a row of data and a words entry, so adding one needs no component. A
  window whose anchor is not on screen skips that stop rather than pointing at nothing. The Tumbler's
  agent app step takes two clicks (The Table's Home, then its gold button). The rehearsal runs only
  where Playwright is installed (`docs/features/onboarding.md`, `src/director/README.md`). No IPC
  command, Rust, binding, capability or dependency changed, so the permissions fingerprint is
  unchanged.
- **Evidence:** commits be501cc (the fourth step), 94cf308 (tour model), 2e0df6e (coach mark),
  2ef9204 (the director's tour action), a2bc9a6 (rehearsal), 2c9dc41 (Tumbler frame in the light
  theme) and 6c15500 (played in the rig, both stories pass); tests `lib/tour.test.ts`,
  `shared/tour.test.tsx`, `director/firstRunStory.test.ts` (writes only to `table-tour:first-run`,
  no world, money or lock action).

## 18. Step 1 says the keys are saved, not connected

- **Date:** 2026-10-09
- **Decided by:** the App Master, on first-run-onboarding lite r1 value-1 (the review report is not
  in the repository: what it said is taken from the commit messages)
- **Constraint:** the first-run step ticks when a keychain entry exists, and the keys are never
  checked against PayPal. No live PayPal call is made without an operator ask (AGENTS.md).
- **Decision:** the words state the fact (the keys are saved), and a test pins them. There is no
  live key check at first run.
- **Lost:** a live key check against the sandbox at step 1. That is a live PayPal call that needs the
  operator's ask, and a network dependency in first run.
- **Consequences:** step 1 can be done with keys PayPal would refuse. The owner finds that out on the
  first real call, not at step 1. Not confirmed: whether any later surface reports a bad key early.
- **Evidence:** c40a9a1 (relabels the step to 'Add your PayPal sandbox keys' / 'PayPal sandbox keys
  saved') and 8b1aed7 (words, `docs/features/onboarding.md`, STATUS entry). The test c40a9a1 adds is
  'step 1 says the fact: the keys are saved, never connected, checked or verified' in
  `apps/desktop/client/src/lib/firstRun.test.ts`.

## 19. At the deadline a parked money step is read back once, and PayPal's answer decides

- **Date:** 2026-10-09
- **Decided by:** the App Master, on deal-to-settlement lite r1 robustness-1 and robustness-2 (the
  review report is not in the repository; taken from the commit message of 5bea1b1)
- **Constraint:** silence never moves money (AGENTS.md). `resolve_deal` skipped parked steps, so a
  parked capture or void left `auto_void` refusing forever (the deal sat On hold with PayPal's hold in
  place), and `deadline_default` dropped `resolve_deal`'s answer and expired a deal whose authorize
  was still parked or younger than `SETTLE_SECS`.
- **Decision:**
  - A parked authorize, capture or void is read back under `Resolve::Deadline` once the deal's
    deadline has passed. A read grants nothing, and what PayPal shows decides.
  - A hold is voided once, by the safe default. At the deadline a void goes once more under its own
    request id whoever decided it, so an owner's parked void completes without a ticket.
  - 'No authorization' is recorded as absent and the deal lapses.
  - A committed capture is recorded as PayPal's truth, with no void.
  - An unreadable read leaves the hold for the next tick.
  - `deadline_default` returns `Unavailable` while an authorize is open (its `Ok(true)`/`Ok(false)`
    contract is unchanged). `apply_deadline_default` in table-ledger refuses with `Conflict` while the
    deal has an authorize with no confirmed or absent resolution, so no caller can bypass the check.
- **Lost:**
  - (a) Expiring at the deadline without a read-back: it can leave a hold in place, or record a lapse
    over a committed capture.
  - (b) Capturing at the deadline: it would let silence move money, which is forbidden.
- **Consequences:** a deal whose PayPal read keeps failing stays open past its deadline until a read
  succeeds. What the lite r1 left open is listed in STATUS.md.
- **Evidence:** 5bea1b1 (the fix) and 9c3ed7e (docs and STATUS). Tests 5bea1b1 adds, in
  `crates/table-app/tests/pipeline.rs`: `parked_capture_at_the_deadline_settles_to_what_paypal_shows`,
  `parked_authorize_at_the_deadline_lapses_or_is_voided_by_what_paypal_shows`,
  `parked_void_at_the_deadline_goes_once_more_under_its_own_request_id`,
  `deadline_waits_for_an_unsettled_authorize_before_expiring`; and in
  `crates/table-ledger/src/tests.rs`: `deadline_default_refuses_while_an_authorize_is_open`.

## 20. Step 4 is finished only by an explicit owner choice, and every window reads it through one helper

- **Date:** 2026-10-09
- **Decided by:** the App Master, on first-run-onboarding full council r1 value-1: 'A judge with no
  engine CLI can never finish step 4, so Home stays in onboarding and hides the practice deal it
  promised' (the council report is not in the repository; the quotation is as given in the task and
  not checked against the report)
- **Constraint:** `claude-code` and `codex-cli` stay gated, so a judge without them could never
  finish step 4. But the default `scripted` engine must not count as a choice, or the step means
  nothing.
- **Decision:**
  - `SettingsSnapshot.engine_chosen` (the ledger preference 'engine' exists) is the fact.
  - 'Keep the practice agent for now' sets it. The default never counts.
  - `settingsFacts` in `lib/firstRun.ts` is the one mapping that Home, the Tumbler and the approval
    window use, so no window can drop a settings fact.
- **Lost:**
  - (a) Counting the default engine as chosen.
  - (b) Making step 4 optional.
  - (c) Each window building its own facts, which is what let the Tumbler and OwnerConfig drop
    `engine_chosen` at 9d2bae2.
- **Consequences:** `SettingsSnapshot` gained a field (binding, mock, fixtures). Whether the
  permissions fingerprint changed is not confirmed here.
- **Evidence:** 9d2bae2 (the field, the choice, the words) and 398f683 (`settingsFacts`). Tests: the
  Rust `keeping_the_practice_agent_is_a_recorded_choice_not_the_default` in
  `crates/table-runtime/src/tests.rs`, and in `apps/desktop/client/src/lib/firstRun.test.ts` the
  group 'settingsFacts: one mapping for Home, the Tumbler and the approval window' plus 'an owner
  with neither app who keeps the practice agent finishes step 4; the default alone never does'.

## 21. Native agent apps stay gated until the deal page names the run that actually acted

- **Date:** 2026-10-09
- **Decided by:** the App Master, on agent-negotiation-run lite r1 value-3 (ready at 0.62 with no
  must-address; the report is not in the repository)
- **Constraint:** the deal's Details read the first run listed for the deal
  (`apps/desktop/client/src/windows/main/DealView.tsx:91`, `.find((r) => r.deal_id === deal.id)`).
  With more than one run, the page can name a run that did not act. A native engine is exactly where
  the owner most needs to know which agent acted. Whether that list is ordered oldest first is not
  confirmed.
- **Decision:** `claude-code` and `codex-cli` stay probed but gated. The practice (policy) agent is
  the only engine that runs a deal until value-3 is fixed.
- **Lost:** ungating the native engines now for the demo.
- **Consequences:** the demo runs on the practice agent. Ungating also waits for robustness-2 (runs
  are not reaped at 120 s) and robustness-3 (a cancelled deal is not answered after Pause and
  Resume).
- **Evidence:** decided, implementation in flight; no commit.

## 22. For the submission, a wallet seller's practice agent accepts a first offer at or above its floor

- **Date:** 2026-10-09
- **Decided by:** the App Master, on agent-negotiation-run lite r1 value-4 (the report is not in the
  repository)
- **Constraint:** the submission cut (section 1) and the 2026-11-12 deadline. A seller policy that
  holds out is new negotiation behaviour, outside wave 1.
- **Decision:** the behaviour stays as it is for the submission. A scheduled seller policy that holds
  out above the floor is post-submission.
- **Lost:** building a seller counter policy before the video.
- **Consequences:** a seller wallet in the demo can agree to the first acceptable offer, so the video
  must not claim that the seller haggles up. The HOUSE seller is different: it has its own rule,
  `decide_on_schedule`, which does not accept at its public floor until the last round.
- **Evidence:** decided, with no commit. The wallet seller's path is `decide` in
  `crates/table-engine/src/policy.rs:62` (the `Side::Seller` arm, lines 68-82, calls
  `Policy::decide`), which accepts at `offer >= floor` in `crates/table-core/src/negotiation.rs:40-42`;
  the test assertion is at `crates/table-engine/src/policy.rs:367`.

## 23. A buyer's deal reads 'Seller says paid' until PayPal's statement matches

- **Date:** 2026-10-10
- **Decided by:** the App Master, on deal-to-settlement lite r1 value-1 (the review report is not in
  the repository: what it said is taken from the commit message of 8288cba and the task brief)
- **Constraint:** a buyer haggle or shop order reaches RECEIPTED only through `accept_seller_receipt`,
  which records `receipt_evidence='seller_attested'`. It becomes `paypal_verified` (and RECONCILED)
  only when the reporting reconcile matches. So a buyer's RECEIPTED deal is the seller's word, not
  PayPal's.
- **Decision:** that round changed the words, not the ledger. `stateWord` gained a buyer exception
  (`SELLER_SAYS_PAID`, gold tone, `apps/desktop/client/src/lib/words.ts`), and every surface that
  shows a deal state passes side and kind. 8288cba's message lists them: `beadKind`, `chipClass`,
  `isSettled`, the amount tone and note, the Book bucket and group, the ledger sums and the deal
  answer no longer treat such a deal as settled; the approval window's `outcomeText` moved into
  `windows/approval/model.ts` unchanged so it can be tested. Rust is unchanged.
- **Lost:**
  - reading RECEIPTED as paid on both sides, which claims money PayPal has not confirmed;
  - hiding the seller's receipt until PayPal matches, so the owner would not see that the seller says
    it collected.
- **Consequences:** the decision is NOT yet fully carried. Lite r2 (2026-10-10, ready 0.6657; its
  report is not in the repository, taken from the task brief) found:
  - the Book's 'Paid' chip (`apps/desktop/client/src/windows/main/modules/book/understand.ts`, `PAID`
    at :57 and the chip at :69), the Book state groups (`modules/book.tsx`, around :688) and the
    Tumbler receipt ticker (`windows/tumbler/logic.ts`, around :373) still read such a deal as paid.
    UNVERIFIED: :57 and :69 are confirmed to hold the `PAID` list and the chip; book.tsx :688 already
    passes a side to `stateGroupLabel` and logic.ts :373 is a state-label map, so those two were not
    confirmed as the faulty lines;
  - no Rust test pins the closing condition (UNVERIFIED: not searched exhaustively);
  - `accept_seller_receipt` (`crates/table-ledger/src/receipt.rs:115`) moves a buyer deal to RECEIPTED
    even when the owner never opened the PayPal link. `browser_handoff` is recorded
    (`crates/table-ledger/src/repositories.rs:654`, read at :666) but receipt.rs does not mention it.
  - **Amended 2026-10-10.** The rework merged (deal-to-settlement run 1edb842c, at 2ff7ea1).
    - The decision is carried by 186578d: `crates/table-ledger/src/book.rs:31` keys a RECEIPTED deal
      with `receipt_evidence` `seller_attested` as `RECEIPTED:buyer`. Test:
      `seller_receipt_before_buyer_approval_never_reads_as_paid`
      (`crates/table-ledger/src/tests.rs:1448`).
    - And by d9621b4, with the client tests it adds: the Book's `stateKey` and `serverStateLabel`
      (`modules/book/model.ts`), the Paid and Stopped chips (`modules/book/understand.ts`), the
      Tumbler's `receiptTicker` (`windows/tumbler/logic.ts`), and the main window's `receiptToast`
      (`apps/desktop/client/src/windows/main/App.tsx`, function in `windows/main/logic.ts`). The
      council had not listed the toast; it read a seller-attested receipt as 'Paid, receipt saved' in
      the ok tone.
    - The Decision bullet's 'Rust is unchanged' no longer holds: 186578d changes `book.rs`, and
      e2290a0 and ccc548e change the ledger further (sections 27 and 28).
    - The UNVERIFIED notes, from d9621b4's diff: the Tumbler site (`windows/tumbler/logic.ts` around
      :373-400) was `receiptTicker`, which gave every RECEIPTED state the `receipt` kind (green) and
      the verb from `RECEIPT_VERB`; confirmed faulty and fixed. For `book.tsx` around :688 the diff
      only swaps `stateGroupLabel(v.replace(':buyer',''), side)` for `serverStateLabel(v)`, so it
      moved the label into the Book model; whether the old line misread the seller's word is
      UNVERIFIED (not run against the old code).
- **Evidence:** 8288cba, with the tests it adds in `apps/desktop/client/src/lib/words.test.ts`:
  'a buyer RECEIPTED deal reads "Seller says paid" with a waiting tone and the one shared sentence',
  'a buyer RECONCILED deal is paid, on PayPal's statement', 'a seller RECEIPTED deal still reads paid
  to you', 'only a buyer haggle or shop order depends on the seller's receipt'; and in
  `windows/main/deal/story.test.ts`: 'is not closed as paid: D-0187 reads the seller's word and stays
  calm, not done', 'a buyer deal PayPal's statement matched is closed as paid'. Then 3b3a712 (docs)
  and acb0dab (fmt). The Rust test
  `seller_receipt_is_atomic_bound_attestation_and_never_a_paypal_call`
  (`crates/table-ledger/src/tests.rs:1303`) pins `seller_attested` on a buyer deal after a seller
  receipt. The client tests were not run for this entry. Amendment evidence: 186578d and d9621b4;
  client tsc exit 0 and vitest 895 of 895 passed (82 files) on main at 2ff7ea1, run by the App
  Master on 2026-10-10 (reported to the builder; not re-run here).

## 24. The SETTLE approve link must open its own order (C-10)

- **Date:** 2026-10-10 (95d7b37 is dated 2026-10-10 in git)
- **Decided by:** the App Master, on security scan finding C-10 (scan of 2026-10-07, per STATUS.md)
- **Constraint:** the buyer opened whatever approve link the seller's SETTLE carried, and checked only
  its host.
- **Decision:** `validate_settle` requires the path `/checkoutnow` and exactly one query pair
  `token=<order id>`, percent-decoded and matched exactly. Anything else is refused as
  `SettlementError::Order`, so the check fails closed.
- **Lost:** the host-only check, under which a seller could send a link to another order on PayPal's
  host.
- **Consequences:**
  - The link shape is UNVERIFIED: it is recalled, not sourced (STATUS.md, the C-10 entry around
    :1331). If a real Orders v2 approve link differs, legitimate links are refused until a sandbox
    spike in milestone 4 confirms the shape.
  - Lite r2 found two follow-ups (report not in the repository; from the task brief). The seller
    wallet signs a SETTLE whose link it checked for the host only (craft-2). No `checks.rs` line
    states the order binding (craft-6). Neither was checked here.
- **Evidence:** 95d7b37 (`crates/table-proto/src/settlement.rs` and `crates/table-proto/tests/protocol.rs`;
  the cases are added to `h4_settle_rejects_amount_intent_invoice_attempt_and_host_mismatch`) and
  5635a68 (binds the approve link in the cases of
  `signed_buyer_settlement_truth_mismatch_holds_and_has_no_browser_link_or_money_calls`,
  `crates/table-ledger/src/tests.rs`).

## 25. Saving the PayPal keys: the keychain write decides, and a finished practice step still leads into a deal

- **Date:** 2026-10-10
- **Decided by:** the App Master, on first-run-onboarding full r1 (run e04a5556) robustness-3,
  craft-7 and value-2 (the reports are not in the repository; taken from the task brief and the
  commit messages)
- **Decision:**
  - (a) Once the vault write succeeds, the keys ARE saved. The `credential.<name>.stored_at` date is
    best-effort, and a failing date write returns Ok. `owner_facts` reads a missing date as stored,
    with `stored_at` None.
  - (b) Pasted values are trimmed before they are validated and stored. A value empty after trimming
    is refused.
  - (c) Step 3 stays done when the house seller connects, and Rust is unchanged. A done practice step
    keeps one click that starts a practice deal on Home, and the approval window says where that deal
    starts. The Tumbler is unchanged: it reads `houseConnected` as null, so step 3 is never shown done
    there, and as the next step it keeps its click that opens The Table.
- **Lost:**
  - (a) failing the save when only the date fails, which showed a false 'not saved' while the keys
    were stored;
  - (b) storing the value as pasted, where surrounding spaces fail only later, at PayPal;
  - (c) ticking step 3 only after a practice deal, which needs a new Rust fact and a ledger read. The
    click gets the owner there without one.
- **Consequences:**
  - stored keys can show no saved date;
  - the Tumbler's step 3 can read not done while Home reads done;
  - the `credential_prompt.rs` error branches and a live `KeyringVault` test (r1 robustness-2 parts c
    and d) remain open.
- **Evidence:** 8bd8444 (`crates/table-runtime/src/configuration.rs`), 92115ee (same file, plus tests
  in `crates/table-runtime/src/tests.rs`: `credential_values_that_fail_validation_write_nothing`,
  `credential_values_are_stored_trimmed`, `a_failed_vault_write_reports_the_error_and_writes_no_date`,
  `a_failed_date_write_after_a_vault_success_still_saves_the_keys`) and 29e583b (tests in
  `apps/desktop/client/src/shared/start.test.tsx`: 'a done practice step keeps one quiet click to
  start a practice deal; a done keys step keeps none', 'where the click cannot happen, a done practice
  step says where the practice deal starts'); and 22de10e (docs and STATUS). The client tests were not
  run for this entry.

## 26. The hosted relay's mailbox exhaustion is fixed before submission, not accepted

- **Date:** 2026-10-09
- **Decided by:** the App Master, on hosted-relay-service lite r1 robustness-1 (the report is not in
  the repository; taken from the task brief). The operator was told and may overrule it.
- **Constraint:** one anonymous client can fill all 256 rendezvous mailboxes for 24 h
  (`services/rendezvous/src/lib.rs`: the 256 cap at :133, the 86400 s expiry at :144). Milestone 4
  deploys the relay inside the HOUSE, whatever the operator decides about a built-in relay address.
- **Decision:** a per-caller create allowance. It is proved by a test in which one caller exhausts its
  allowance, and a fresh pair mailbox and a create on the HOUSE path still succeed.
- **Lost:** accepting the risk for the judging window.
- **Consequences:** fixed in ad2ef32 (2026-10-10). N = `CALLER_ALLOWANCE` = 128 live mailboxes per caller: a wallet holds at most 64 live relay routes (`bind_relay` in table-ledger), one mailbox each, and two wallets behind one home NAT address (the two-desktop demo) share a key, so 2 x 64. R = `HOUSE_RESERVE` = 64: HTTP creates are refused at 192 live HTTP-created mailboxes (amended below); the HOUSE ledger holds at most 64 live routes, so its in-process create (`RelayApi::create`, which bypasses the allowance) always has room, and a wallet's later create of a HOUSE deal's mailbox finds it already made and costs nothing. Caller key: the TCP peer; with `RELAY_TRUSTED_PROXY_HOPS=n` set, the nth `X-Forwarded-For` entry from the right (the proxy-appended one, never a client-written one); IPv6 keyed on its /64; with n >= 1 a missing or unparsable entry is refused (400), never answered with the TCP peer (amended below); an unparsable setting (or above 8) fails startup, because falling back to 0 would key everyone on the proxy and quietly lock all callers out after one fills 128, and falling back to the header would let clients choose their key. UNVERIFIED: the root render.yaml sets the hop count to 1, assuming Render runs exactly one proxy that appends the client address as the rightmost entry; .research does not document it. Residual: two IPv4 addresses (or two /64s) can still fill the 192-slot HTTP share for 24 h; HOUSE deals survive through the reserve, wallet-to-wallet pairing does not. Authenticated PUT stays with relay-and-rendezvous-1. Whether the submitted build carries a relay address is still open with the operator.
- **Amended 2026-10-10 (1cfa5c0, fix(relay-exhaustion-2)):** The caller key is the nth X-Forwarded-For entry from the right, n being RELAY_TRUSTED_PROXY_HOPS. It is taken from the raw bytes of all X-Forwarded-For lines in order, and only that entry is decoded, so a byte outside visible ASCII elsewhere in the list no longer voids it. With n >= 1, a create whose nth entry is missing or unparsable is refused with 400 (Error::Invalid): the request is malformed for this deployment, and falling back to the peer would give the client a second allowance on the shared proxy address. With n = 0 the key is the TCP peer. The HTTP share, MAX_MAILBOXES - HOUSE_RESERVE, counts only HTTP-created mailboxes (creator is some). HOUSE mailboxes count only against the 256 store cap, so 192 HTTP and 64 HOUSE mailboxes fit exactly, and a busy HOUSE no longer denies wallet pairings. CALLER_ALLOWANCE and HOUSE_RESERVE are unchanged. A wallet sees the 400 as Error::Refused(Refusal::Other) (crates/table-relay/src/lib.rs, answer_error), not as Full and not as Unavailable; how the client words it is UNVERIFIED. This closes both robustness lines of hosted-relay-service lite r2. Still open: the allowance sizes (CALLER_ALLOWANCE, HOUSE_RESERVE) and the create handler's branch with no Connection.
- **Evidence:** ad2ef32: services/rendezvous/tests/relay.rs (`one_caller_uses_up_its_allowance_and_a_second_caller_and_the_house_still_create`, `many_callers_filling_the_http_share_leave_the_house_reserve`, `re_creating_a_mailbox_costs_nothing_and_expiry_releases_the_allowance`, `an_ipv6_caller_is_its_slash_64_and_an_ipv4_mapped_one_is_its_ipv4`, `the_proxy_hop_setting_is_a_small_whole_number_or_startup_fails`) and services/rendezvous/tests/serve.rs, over a real socket through serve_with (`with_no_trusted_proxy_a_forged_forwarded_for_does_not_change_the_caller`, `behind_one_proxy_the_rightmost_forwarded_for_entry_is_the_caller`, `two_ipv6_addresses_in_one_slash_64_share_a_caller`, `over_a_socket_one_caller_is_refused_past_its_allowance_and_forging_does_not_help`). 4909d48 deletes services/rendezvous/Dockerfile and services/rendezvous/render.yaml (security scan P-4). 1cfa5c0 adds `a_full_house_does_not_take_the_http_share_from_wallets` (services/rendezvous/tests/relay.rs), `a_byte_outside_ascii_to_the_left_does_not_void_the_proxy_entry` and `behind_one_proxy_a_forged_byte_cannot_move_the_key_to_the_proxy_or_pass_a_bad_entry` (services/rendezvous/tests/serve.rs), and changes `behind_one_proxy_the_rightmost_forwarded_for_entry_is_the_caller` from the peer fallback to a 400.

## 27. A seller's receipt on a buyer deal counts only after the owner opened the PayPal link

- **Date:** 2026-10-10
- **Decided by:** the App Master, on deal-to-settlement lite r2 robustness-1 (a) (the report is not in
  the repository; taken from the task brief)
- **Constraint:** `apps/desktop/src-tauri/src/native/routing.rs` (:131-137) opens the browser before
  `Action::Handoff` (`crates/table-runtime/src/dispatcher.rs:628`) records the handoff, and
  `Action::Handoff` can fail (the selected deal changed, or the deadline passed). `accept_seller_receipt`
  read no handoff.
- **Decision:** `Decision::OpenBrowser` (`crates/table-runtime/src/service.rs:563`) records
  `Ledger::handoff` together with the owner's decision, before the URL is returned. `Action::Handoff`
  records it again, which is harmless. `accept_seller_receipt` (`crates/table-ledger/src/receipt.rs`)
  refuses a buyer deal with no handoff: it appends one `receipt.refused` audit row per distinct raw
  hash (actor `peer:<iss>`, reason `no_handoff`; `receipt.rs:163-182`), then returns Conflict. Nothing
  else changes. The deal keeps its approval countdown and lapses by its own safe default.
- **Lost:**
  - holding the receipt in a new state the owner sees (a receipt that arrives before the link opened
    cannot be a payment, and it would add a state);
  - accepting the receipt as before.
- **Consequences:** the runtime test PayPal double gains `awaiting_payer`: order reads say
  PAYER_ACTION_REQUIRED until the owner's OpenBrowser decision, which is the real order of events.
  Production code has no bypass.
- **Evidence:** ccc548e; `seller_receipt_without_handoff_is_refused_once_and_changes_nothing`
  (`crates/table-ledger/src/tests.rs:1388`); `buyer_browser_availability_needs_unlock_but_no_local_paypal_credentials`
  (`crates/table-runtime/src/tests.rs:897`).

## 28. A buyer's deal PayPal never corroborates ends UNCONFIRMED after 72 hours

- **Date:** 2026-10-10
- **Decided by:** the App Master, on lite r2 robustness-1 (b) (the report is not in the repository;
  taken from the task brief)
- **Constraint:** a seller-attested RECEIPTED deal had no end. It was past the deadline's safe default
  (`crates/table-app/src/pipeline.rs:1340-1348`: only pre-capture states lapse), and a reporting read
  with no match recorded nothing (`crates/table-app/src/reconciliation.rs`).
- **Decision:** a terminal `DealState::Unconfirmed`, reached through `DealEvent::CorroborationLapsed`
  at `receipts.verified_at` + `CORROBORATION_SECS` (`crates/table-core/src/deal.rs:117`). 72 h is 24
  times PayPal's reporting lag of up to 3 h (`.research/paypal-platform.md:36` and :490, [S-spec]).
  - The scheduler tick runs `Ledger::lapse_corroboration`. It makes no PayPal call and moves no money.
  - A late `ReportingMatched` moves UNCONFIRMED to RECONCILED.
  - Exposure counts an UNCONFIRMED deal as spent, because money may have left.
  - A reconcile with no match appends `receipt.reporting_unmatched`
    (`crates/table-app/src/reconciliation.rs:93`).
  - `deals.decided_by` is left unchanged; the `receipt.unconfirmed` row carries the safe default. The
    App Master accepted this.
- **Lost:**
  - leaving the deal RECEIPTED forever;
  - moving it back to a pre-capture state (money may have left);
  - a shorter window.
- **Consequences:** UNCONFIRMED is a deviation from the design report's state list (section 6.3). The
  App Master answered the builder's questions as follows; each answer is decided and waits for one
  delivery:
  - `display.rs` counts UNCONFIRMED as a closed deal, never as paid;
  - the walk-away forecast gains a lapse line, and `ForecastSource` gains the receipt time for it;
  - the Book gives UNCONFIRMED a bucket of its own, as an end, not under 'In progress' (the words on
    Home's bead are left to the council);
  - 'While you were away' (`apps/desktop/client/src/windows/main/home/away.ts`) lists an UNCONFIRMED
    end.

  The HOUSE witness stays as it is.
- **Amended 2026-10-10 (deal-to-settlement lite r3 robustness-1; decided, waits for one delivery):** The council found, verbatim: 'UNCONFIRMED lapses on time alone: a buyer deal PayPal shows as paid ends Not confirmed by PayPal, and the in-app statement check that could still save it is gone' (the report is not in the repository; taken from the task brief). Decision: option (c), with split words. The 72 h time-only lapse stays. The lapse records whether a statement read for the deal came back unmatched (receipt.reporting_unmatched). With an unmatched read, the words may say that PayPal's statement did not show the payment. With no read, they say the wallet did not check with PayPal, never that PayPal's statement did not show it. The statement check is offered on an UNCONFIRMED deal, and a wallet without PayPal keys says what the check needs. A Rust test will prove that a lapse with no read never claims a read. Lost: (a) lapsing only after an unmatched read, because a buyer wallet without PayPal keys would never lapse, which reopens this section; (b) a statement read made by the scheduler before the lapse, because it is a new outbound PayPal call made without the owner, and the line closes without it. No money moves on this path. The council's anchors: receipt.rs:212, Evidence.tsx:102, words.ts:52, :66 and :364, logic.ts:192, actor.rs:492.
- **Evidence:** e2290a0 and d9621b4;
  `a_seller_attested_deal_ends_unconfirmed_after_72_hours_and_a_late_match_still_counts`
  (`crates/table-ledger/src/tests.rs:1570`);
  `a_reconciled_deal_a_seller_deal_and_an_unreceipted_deal_never_lapse_unconfirmed` (:1627);
  `a_scheduler_tick_past_the_corroboration_window_ends_a_seller_attested_deal_unconfirmed`
  (`crates/table-runtime/src/tests.rs:995`).

## 29. The PayPal keys dialog stays on CredUIPromptForCredentialsW for the submission

- **Date:** 2026-10-10
- **Decided by:** the App Master, on first-run-onboarding full r2 craft-1 (med; the report is not in
  the repository)
- **Constraint:**
  - the keys never cross the webview (`crates/table-runtime/src/credentials.rs:1`, AGENTS.md);
  - the prompt sits behind the `CredentialPrompt` trait (`crates/table-runtime/src/credentials.rs:6`);
  - `crates/table-os/src/credential_prompt.rs:57-69` calls `CredUIPromptForCredentialsW` with
    GENERIC_CREDENTIALS, ALWAYS_SHOW_UI, DO_NOT_PERSIST and EXCLUDE_CERTIFICATES, with `Zeroizing`
    buffers and a SAFETY note (:52);
  - the dialog's native UAT is a milestone-4 item that has not run, so a rewrite of the unsafe FFI
    could not be checked on a real desktop before the submission.

  The call arrived with the initial import c855696, so its original reason is not in this repository.
- **Decision:** keep the call for the submission. The message text maps Username to the client id and
  Password to the secret (:28). The caption reads 'API credentials' (:41).
- **Lost:**
  - `CredUIPromptForWindowsCredentialsW` with `CredUnPackAuthenticationBufferW`. The council called it
    Microsoft's advice for Vista and later; that is UNVERIFIED (its general knowledge, not looked
    up). It costs more unsafe code and a packed buffer to unpack;
  - an in-webview form, which the invariant forbids.
- **Consequences:** the dialog's fields read Username and Password. Revisit after the submission.
- **Evidence:** `crates/table-os/src/credential_prompt.rs:28`, :41 and :52-68 as above; no commit
  changes it (c855696 is the import).
