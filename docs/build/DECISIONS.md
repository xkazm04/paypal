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
- **Evidence:** commit 059c821 (`crates/table-ledger/src/repositories.rs`, `usage_for`; tests
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
- **Evidence:** commit c819b4b (`crates/table-core/src/mandate.rs`; client mirror in
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
  must then resend the signed history (bounded to a recovery window by section 46). HOUSE `Seller::table` sets the silence deadline right
  after `create_deal`, binds the relay and lists, and reserves the request slot last.
- **Lost:** not stated in the commit (alternatives not confirmed). The commit's own text names the
  reason Receipted routes stay polled rather than going quiet.
- **Consequences:** a failed HOUSE request leaves a Pairing deal that lapses on its deadline and
  holds no request slot; the retry makes a fresh deal. Receipted routes cost polling but no
  capacity.
- **Evidence:** commit 3aeaafa (`crates/table-ledger/src/relay.rs`,
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
- **Evidence:** commits efbfa2d (MA-1), e3bab1d (MA-2), 7d6ef8f (MA-3).

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
- **Evidence:** commits 48d3672 (deadline), 8ee630e (one audit row), 98599df (copy), 068e8fb
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
- **Evidence:** commits 4833d60, 74eab1f, eadf117, d71f387, 758e3da, d7798ae; test
  `a_stale_market_can_hold_a_deal_but_never_clear_it`; the H5 section of `docs/build/STATUS.md`.

## 10. BandAdjust warns but does not disable Sign

- **Date:** 2026-10-07
- **Decided by:** the App Master.
- **Constraint:** the mandate-authoring rework (64f66c0) needed a rule for the BandAdjust warning.
  Section 5 already makes a bad band fail closed at signing.
- **Decision:** BandAdjust shows a warning and leaves Sign enabled.
- **Lost:** disabling Sign on the warning (not confirmed; the reasons are not written down beyond
  the choice).
- **Consequences:** the owner can sign past the warning; the signing check in section 5 still
  refuses a band that is invalid.
- **Evidence:** commit 64f66c0 (STATUS entry for the rework). Not confirmed beyond that commit.

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
- **Evidence:** commits e5948e3 (Check a proof file, in the Book) and 5608341 (the warning before
  save), on main at 2528044.

## 12. The HOUSE health check follows each deal step

- **Date:** 2026-10-07
- **Decided by:** the App Master.
- **Constraint:** scan C-8 (a23cab6) writes the heartbeat only at the start of a timer tick, so a
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
  and `healthz_follows_the_heartbeat`. Commits a23cab6 (C-8) and 60444b0 (C-5); the STATUS
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
  run's AGENTS.md and council config commits (e1a7019, 1145b8d).

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
- **Evidence:** commits 4ab3d22, 74411c8 and 8bb267d. Tests:
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
- **Evidence:** commits b1bc8aa (the fourth step), 87d95ab (tour model), 38f871f (coach mark),
  c65480a (the director's tour action), 6219d1c (rehearsal), bef21fd (Tumbler frame in the light
  theme) and 8c0370e (played in the rig, both stories pass); tests `lib/tour.test.ts`,
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
- **Evidence:** acb904c (relabels the step to 'Add your PayPal sandbox keys' / 'PayPal sandbox keys
  saved') and 1a88e15 (words, `docs/features/onboarding.md`, STATUS entry). The test acb904c adds is
  'step 1 says the fact: the keys are saved, never connected, checked or verified' in
  `apps/desktop/client/src/lib/firstRun.test.ts`.

## 19. At the deadline a parked money step is read back once, and PayPal's answer decides

- **Date:** 2026-10-09
- **Decided by:** the App Master, on deal-to-settlement lite r1 robustness-1 and robustness-2 (the
  review report is not in the repository; taken from the commit message of 47d2d42)
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
- **Evidence:** 47d2d42 (the fix) and 3330b7f (docs and STATUS). Tests 47d2d42 adds, in
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
    `engine_chosen` at d8d9be0.
- **Consequences:** `SettingsSnapshot` gained a field (binding, mock, fixtures). Whether the
  permissions fingerprint changed is not confirmed here.
- **Evidence:** d8d9be0 (the field, the choice, the words) and e40ab04 (`settingsFacts`). Tests: the
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
  the repository: what it said is taken from the commit message of 9b00cc4 and the task brief)
- **Constraint:** a buyer haggle or shop order reaches RECEIPTED only through `accept_seller_receipt`,
  which records `receipt_evidence='seller_attested'`. It becomes `paypal_verified` (and RECONCILED)
  only when the reporting reconcile matches. So a buyer's RECEIPTED deal is the seller's word, not
  PayPal's.
- **Decision:** that round changed the words, not the ledger. `stateWord` gained a buyer exception
  (`SELLER_SAYS_PAID`, gold tone, `apps/desktop/client/src/lib/words.ts`), and every surface that
  shows a deal state passes side and kind. 9b00cc4's message lists them: `beadKind`, `chipClass`,
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
  - **Amended 2026-10-10.** The rework merged (deal-to-settlement run 1edb842c, at 38150a7).
    - The decision is carried by e360785: `crates/table-ledger/src/book.rs:31` keys a RECEIPTED deal
      with `receipt_evidence` `seller_attested` as `RECEIPTED:buyer`. Test:
      `seller_receipt_before_buyer_approval_never_reads_as_paid`
      (`crates/table-ledger/src/tests.rs:1448`).
    - And by a243d7f, with the client tests it adds: the Book's `stateKey` and `serverStateLabel`
      (`modules/book/model.ts`), the Paid and Stopped chips (`modules/book/understand.ts`), the
      Tumbler's `receiptTicker` (`windows/tumbler/logic.ts`), and the main window's `receiptToast`
      (`apps/desktop/client/src/windows/main/App.tsx`, function in `windows/main/logic.ts`). The
      council had not listed the toast; it read a seller-attested receipt as 'Paid, receipt saved' in
      the ok tone.
    - The Decision bullet's 'Rust is unchanged' no longer holds: e360785 changes `book.rs`, and
      965f2a1 and a7d38eb change the ledger further (sections 27 and 28).
    - The UNVERIFIED notes, from a243d7f's diff: the Tumbler site (`windows/tumbler/logic.ts` around
      :373-400) was `receiptTicker`, which gave every RECEIPTED state the `receipt` kind (green) and
      the verb from `RECEIPT_VERB`; confirmed faulty and fixed. For `book.tsx` around :688 the diff
      only swaps `stateGroupLabel(v.replace(':buyer',''), side)` for `serverStateLabel(v)`, so it
      moved the label into the Book model; whether the old line misread the seller's word is
      UNVERIFIED (not run against the old code).
- **Evidence:** 9b00cc4, with the tests it adds in `apps/desktop/client/src/lib/words.test.ts`:
  'a buyer RECEIPTED deal reads "Seller says paid" with a waiting tone and the one shared sentence',
  'a buyer RECONCILED deal is paid, on PayPal's statement', 'a seller RECEIPTED deal still reads paid
  to you', 'only a buyer haggle or shop order depends on the seller's receipt'; and in
  `windows/main/deal/story.test.ts`: 'is not closed as paid: D-0187 reads the seller's word and stays
  calm, not done', 'a buyer deal PayPal's statement matched is closed as paid'. Then d3711fd (docs)
  and 87dc1db (fmt). The Rust test
  `seller_receipt_is_atomic_bound_attestation_and_never_a_paypal_call`
  (`crates/table-ledger/src/tests.rs:1303`) pins `seller_attested` on a buyer deal after a seller
  receipt. The client tests were not run for this entry. Amendment evidence: e360785 and a243d7f;
  client tsc exit 0 and vitest 895 of 895 passed (82 files) on main at 38150a7, run by the App
  Master on 2026-10-10 (reported to the builder; not re-run here).

## 24. The SETTLE approve link must open its own order (C-10)

- **Date:** 2026-10-10 (0b244e6 is dated 2026-10-10 in git)
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
- **Amended 2026-10-10 (deal-to-settlement lite r3 craft-2, 0c5ca2b):** `table_proto::order_approval_url`
  (`crates/table-proto/src/settlement.rs:42`) is now the one binding rule. It is called by `validate_settle`
  and by the seller's `created_link` (create and its resolver), so the seller no longer signs a SETTLE its
  buyer would refuse: a PayPal-host link to another order, or with an extra query pair, signs no SETTLE and
  records no outbound envelope. This closes the first follow-up above (craft-2). The link shape stays
  UNVERIFIED.
- **Evidence:** 0b244e6 (`crates/table-proto/src/settlement.rs` and `crates/table-proto/tests/protocol.rs`;
  the cases are added to `h4_settle_rejects_amount_intent_invoice_attempt_and_host_mismatch`) and
  435eb0d (binds the approve link in the cases of
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
- **Evidence:** 7a1dbc9 (`crates/table-runtime/src/configuration.rs`), f5827e3 (same file, plus tests
  in `crates/table-runtime/src/tests.rs`: `credential_values_that_fail_validation_write_nothing`,
  `credential_values_are_stored_trimmed`, `a_failed_vault_write_reports_the_error_and_writes_no_date`,
  `a_failed_date_write_after_a_vault_success_still_saves_the_keys`) and 26970c9 (tests in
  `apps/desktop/client/src/shared/start.test.tsx`: 'a done practice step keeps one quiet click to
  start a practice deal; a done keys step keeps none', 'where the click cannot happen, a done practice
  step says where the practice deal starts'); and b302f63 (docs and STATUS). The client tests were not
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
- **Consequences:** fixed in 0315f21 (2026-10-10). N = `CALLER_ALLOWANCE` = 128 live mailboxes per caller: a wallet holds at most 64 live relay routes (`bind_relay` in table-ledger), one mailbox each, and two wallets behind one home NAT address (the two-desktop demo) share a key, so 2 x 64. R = `HOUSE_RESERVE` = 64: HTTP creates are refused at 192 live HTTP-created mailboxes (amended below); the HOUSE ledger holds at most 64 live routes, so its in-process create (`RelayApi::create`, which bypasses the allowance) always has room, and a wallet's later create of a HOUSE deal's mailbox finds it already made and costs nothing. Caller key: the TCP peer; with `RELAY_TRUSTED_PROXY_HOPS=n` set, the nth `X-Forwarded-For` entry from the right (the proxy-appended one, never a client-written one); IPv6 keyed on its /64; with n >= 1 a missing or unparsable entry is refused (400), never answered with the TCP peer (amended below); an unparsable setting (or above 8) fails startup, because falling back to 0 would key everyone on the proxy and quietly lock all callers out after one fills 128, and falling back to the header would let clients choose their key. UNVERIFIED: the root render.yaml sets the hop count to 1, assuming Render runs exactly one proxy that appends the client address as the rightmost entry; .research does not document it. Residual: two IPv4 addresses (or two /64s) can still fill the 192-slot HTTP share for 24 h; HOUSE deals survive through the reserve, wallet-to-wallet pairing does not. Authenticated PUT stays with relay-and-rendezvous-1. Whether the submitted build carries a relay address is still open with the operator.
- **Amended 2026-10-10 (26051dc, fix(relay-exhaustion-2)):** The caller key is the nth X-Forwarded-For entry from the right, n being RELAY_TRUSTED_PROXY_HOPS. It is taken from the raw bytes of all X-Forwarded-For lines in order, and only that entry is decoded, so a byte outside visible ASCII elsewhere in the list no longer voids it. With n >= 1, a create whose nth entry is missing or unparsable is refused with 400 (Error::Invalid): the request is malformed for this deployment, and falling back to the peer would give the client a second allowance on the shared proxy address. With n = 0 the key is the TCP peer. The HTTP share, MAX_MAILBOXES - HOUSE_RESERVE, counts only HTTP-created mailboxes (creator is some). HOUSE mailboxes count only against the 256 store cap, so 192 HTTP and 64 HOUSE mailboxes fit exactly, and a busy HOUSE no longer denies wallet pairings. CALLER_ALLOWANCE and HOUSE_RESERVE are unchanged. A wallet sees the 400 as Error::Refused(Refusal::Other) (crates/table-relay/src/lib.rs, answer_error), not as Full and not as Unavailable; how the client words it is UNVERIFIED. This closes both robustness lines of hosted-relay-service lite r2. Still open: the allowance sizes (CALLER_ALLOWANCE, HOUSE_RESERVE) and the create handler's branch with no Connection.
- **Evidence:** 0315f21: services/rendezvous/tests/relay.rs (`one_caller_uses_up_its_allowance_and_a_second_caller_and_the_house_still_create`, `many_callers_filling_the_http_share_leave_the_house_reserve`, `re_creating_a_mailbox_costs_nothing_and_expiry_releases_the_allowance`, `an_ipv6_caller_is_its_slash_64_and_an_ipv4_mapped_one_is_its_ipv4`, `the_proxy_hop_setting_is_a_small_whole_number_or_startup_fails`) and services/rendezvous/tests/serve.rs, over a real socket through serve_with (`with_no_trusted_proxy_a_forged_forwarded_for_does_not_change_the_caller`, `behind_one_proxy_the_rightmost_forwarded_for_entry_is_the_caller`, `two_ipv6_addresses_in_one_slash_64_share_a_caller`, `over_a_socket_one_caller_is_refused_past_its_allowance_and_forging_does_not_help`). 681de8b deletes services/rendezvous/Dockerfile and services/rendezvous/render.yaml (security scan P-4). 26051dc adds `a_full_house_does_not_take_the_http_share_from_wallets` (services/rendezvous/tests/relay.rs), `a_byte_outside_ascii_to_the_left_does_not_void_the_proxy_entry` and `behind_one_proxy_a_forged_byte_cannot_move_the_key_to_the_proxy_or_pass_a_bad_entry` (services/rendezvous/tests/serve.rs), and changes `behind_one_proxy_the_rightmost_forwarded_for_entry_is_the_caller` from the peer fallback to a 400.

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
- **Evidence:** a7d38eb; `seller_receipt_without_handoff_is_refused_once_and_changes_nothing`
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
- **Delivered 2026-10-10 (rework A: baef161, 41dae4c, 652dd7c, 2bb46bb, f8895f2, 463f547):**
  - The 72 h lapse stays time-only: `Ledger::lapse_corroboration` (`crates/table-ledger/src/receipt.rs`) adds
    no PayPal call and no wait. It records `statement_unmatched` in the `receipt.unconfirmed` row: true when
    the deal has a `receipt.reporting_unmatched` row, else false; no migration, no column.
    `Ledger::statement_unmatched` reads it back (None for other deals and for rows written before the
    fact, which then get the unknown wording); `DealEvidence.statement_unmatched` carries it
    (`bindings/DealEvidence.ts`). The statement check is offered on an UNCONFIRMED deal (41dae4c). The
    runtime reconcile already admitted UNCONFIRMED; nothing was rebuilt there (baef161 only drops an unused
    import).
  - (a) `counterparty_list` counts UNCONFIRMED in `deals_closed` (652dd7c). (b) `ForecastSource.receipt_at`
    and `ForecastAction::Unconfirm`: a seller-attested buyer deal in RECEIPTED forecasts ending UNCONFIRMED at
    receipt + `CORROBORATION_SECS`, NextTick when overdue (2bb46bb); the no-money-out property test is
    unchanged. (c) the Book gets an 'unconfirmed' bucket, 'Not confirmed', as an end (f8895f2). (d) 'While you
    were away' lists an UNCONFIRMED end, worded by read status (463f547).
  - Tests: `a_lapse_with_no_statement_read_never_claims_one`, `a_lapse_after_an_unmatched_statement_read_says_so`
    (`crates/table-ledger/src/tests.rs`); `the_unconfirmed_reason_claims_a_statement_read_only_when_one_was_made`,
    `an_owner_reconcile_through_the_runtime_on_an_unconfirmed_deal_ends_reconciled`
    (`crates/table-runtime/src/tests.rs`); the display, forecast, Book and away tests.
  - Five decisions the builder put to the App Master, **accepted by the App Master 2026-10-10:**
    1. 'While you were away': a summary with an UNCONFIRMED line no longer says 'No money moved.', because a
       buyer's UNCONFIRMED deal may have been paid at PayPal; the line itself says 'this wallet moved nothing'.
    2. The Book's four Totals tiles are unchanged (no fifth tile): UNCONFIRMED money shows in the grid's own
       'Not confirmed' column and its filter. 'Where the money went' no longer counts UNCONFIRMED deals as
       still in progress.
    3. The History step 'unconfirmed' carries no read fact, so Rewind keeps the unknown wording; carrying
       `statement_unmatched` on the history step needs a binding and a runtime change, left for the council.
    4. Home's bead words were left to the council as asked; `Home.tsx` was not touched.
    5. The mock backend approximates the receipt time for the forecast with the deal's `updated_at`, so a
       browser preview is not exact.
- **Evidence:** 965f2a1 and a243d7f;
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

  The call arrived with the initial import 1fb97f6, so its original reason is not in this repository.
- **Decision:** keep the call for the submission. The message text maps Username to the client id and
  Password to the secret (:28). The caption reads 'API credentials' (:41).
- **Lost:**
  - `CredUIPromptForWindowsCredentialsW` with `CredUnPackAuthenticationBufferW`. The council called it
    Microsoft's advice for Vista and later; that is UNVERIFIED (its general knowledge, not looked
    up). It costs more unsafe code and a packed buffer to unpack;
  - an in-webview form, which the invariant forbids.
- **Consequences:** the dialog's fields read Username and Password. Revisit after the submission.
- **Evidence:** `crates/table-os/src/credential_prompt.rs:28`, :41 and :52-68 as above; no commit
  changes it (1fb97f6 is the import).

## 30. The Tumbler learns that the house seller is connected from a boolean in the settings snapshot

- **Date:** 2026-10-10
- **Decided by:** the builder of first-run-onboarding full r2 (the report is not in the repository),
  merged with the polish; the text is the builder's, copied here
- **Constraint:** the Tumbler's first-run step 3 (the practice deal) needs to know the house seller is
  connected. `counterparty_list` is granted to `main` and `approval` only, because counterparty names are
  untrusted words that must never reach the Tumbler.
- **Decision:** `SettingsSnapshot` already serves every window, so it carries a boolean `house_connected`.
  `Runtime::settings` computes it from the same ledger read and `HousePinned` flag as `counterparty_list`
  (`crates/table-runtime/src/service.rs:346`). A boolean cannot carry a counterparty word. No
  authority-table row changed. `settings:changed` reaches the Tumbler on a pin because the actor diffs the
  serialized snapshot each tick, which now includes the field; `pairing:pinned` goes to `main` only and is
  not needed.
- **Lost:** granting `counterparty_list` to the Tumbler, which would put counterparty names in a window that
  must never show them.
- **Consequences:** re-running `pairing_join` HOUSE for an already pinned house still asks for the same four
  words, so the desk now says 'You check its four words once more'. Whether that re-check is redundant on a
  pinned house is the operator's call (the builder gathered no evidence and kept it as it was).
- **Evidence:** b3603e6 (`SettingsSnapshot.house_connected`, `crates/table-client/src/lib.rs`, `bindings/SettingsSnapshot.ts`,
  the mock and the Tumbler); 9f6e983 (names the mock check for what it asserts);
  `settings_tell_whether_the_house_is_connected_without_the_counterparty_list`
  (`crates/table-runtime/src/tests.rs`). The client tests were written without `node_modules`; see STATUS.md.

## 31. A seller's hold found at the deadline, and the end of an authorize PayPal never shows readably (deal-to-settlement lite r3)

- **Date:** 2026-10-10
- **Decided by:** item 1 by the App Master on 2026-10-10, and it changes no money behaviour. Item 3's end was
  chosen by the builder within the App Master's limits and accepted by the App Master on 2026-10-10. The
  council report (lite r3) is not in the repository; the item numbers follow the task brief.
- **1. Constraint and decision (robustness-3).** At the deadline, a seller's authorize that PayPal shows as a
  CREATED authorization is recorded (`money.resolved` confirmed) and the deadline is re-armed to the first
  attempt + 72 h (`confirm_authorization`, `crates/table-app/src/pipeline/resolve.rs`). When delivery is
  `DigitalNow` the next scheduler tick captures it under `Authority::SellerMandate`, and that capture
  stands: the authorize went out before the deadline under authority 2, for an order the buyer approved at
  PayPal, and the deadline read-back only learns that it went through. Any other delivery is never captured
  by the scheduler, and the re-armed deadline auto-voids it on the safe default. No new void, no new capture
  path, `scheduler.rs` unchanged. The code already did this; the commit only adds the test.
  - **Evidence:** 4a81385, `a_sellers_hold_found_at_the_deadline_is_collected_only_when_delivered_at_once`
    (`crates/table-runtime/src/resolve_tests.rs`).
- **3. Decision, the end the builder chose (robustness-4).** A parked authorize whose deadline read still
  shows a record no check accepts (an order or authorization that is not the untouched APPROVED order and not
  one verified CREATED authorization of the deal's amount) ends at `op.started_at + UNREAD_AUTHORIZE_SECS`
  = 72 h, the honor period `confirm_authorization` re-arms a hold to. At that read the deal, which must
  still be APPROVED and past its deadline, takes `DealEvent::Deadline` to EXPIRED with `decided_by`
  `SafeDefault { deadline: the deal's deadline }` (`Ledger::end_unread_authorize`,
  `crates/table-ledger/src/resolution.rs`). That read's GET calls are kept. Nothing is sent: no void, because
  no authorization id was verified, and no capture. No schema change: no new resolution outcome, and the
  operation stays parked (`needs_owner`), so `money_check` keeps showing it. The attention card on the ended
  deal has no clock, its headline is 'Look at <amount> in PayPal', and its silence line is
  `MONEY_CHECK_ENDED_SILENCE`. The deal page answers with `MONEY_CHECK_ENDED`. The ledger refuses the end
  before the bound, before the deadline, off APPROVED, or for an op that is not a parked authorize;
  `apply_deadline_default` is not changed.
- **Lost:**
  - a void (needs a verified authorization id);
  - a new outcome such as `given_up` (needs a migration);
  - ending the unreadable (deferred) case too, which still waits, as robustness-2 decided.
- **Consequences:**
  - an EXPIRED deal can carry a parked authorize forever, and its Tumbler card cannot be dismissed;
  - EXPIRED's state words say 'No money moved', which this deal cannot promise; the deal page answer
    overrides them there.
- **Evidence:** 973aec3, `a_parked_authorize_paypal_never_shows_readably_ends_at_its_bound_and_sends_nothing`
  (`crates/table-app/tests/pipeline.rs`) and `a_deal_that_ended_with_its_money_step_unsettled_says_to_look_in_paypal_with_no_clock`
  (`crates/table-attention/src/lib.rs`).
- **Also in this delivery (words and binding, no decision):** 1f7365f rewrote the parked money-check words
  (value-2: what PayPal shows decides; a payment PayPal already took stays paid). 0c5ca2b made the approve-link
  binding one rule (see the amendment to section 24). 53b09f8 made the Book's statement chip, grid, row detail
  and 'PayPal agrees' card state-aware, so an UNCONFIRMED deal reads 'no match' with `unconfirmedMeans(read)`,
  never 'Paid' and never a delay. It stays in `agreementGaps` as its own kind `unconfirmed`, sorted after
  mismatch and before unknown and pending_reporting, because money may have left (exposure counts it as spent,
  section 28) and the statement check can still match it to RECONCILED.

## 32. An ended money-check card shows Rust's line, without the If you do nothing frame

- **Date:** 2026-10-10
- **Decided by:** the App Master, wake 55 (2026-10-10), after the Tumbler rework (734186c) left main red.
- **Constraint.** A deal can end with a parked money step (section 31, item 3). Its Tumbler card then has no
  clock and nothing waits on the owner: the deal has already ended, so there is no silence to describe.
- **Decision.** On the Tumbler card of an ended deal, the second 'Why?' sentence is `MONEY_CHECK_ENDED_SILENCE`,
  the line Rust sends, capitalised and ending with a full stop: 'The deal has ended and the wallet sends nothing
  more: look at this payment in PayPal.' The first sentence stays `MONEY_CHECK_ENDED`.
- **Lost:**
  - the hand-written 'The deal has ended and the wallet sends nothing more.' of 734186c. It dropped the line
    Rust sends ('look at this payment in PayPal') and drifted from it;
  - the 'If you do nothing,' frame. The deal has already ended, and nothing waits on the owner's silence.
- **Evidence:** a59f881, `cardWhy` in `apps/desktop/client/src/windows/tumbler/logic.ts`, and the test 'the card
  says the wallet stopped and what to do, with the line Rust sends' in
  `apps/desktop/client/src/lib/moneyCheck.test.ts`.

## 33. Relay generation resets: one per ten minutes per deal, counted from the last reset (scan C-9a, C-9a2)

- **Date:** 2026-10-10
- **Decided by:** the App Master, wake 57 (C-9a) and wake 59 (C-9a2).
- **Constraint.**
  - The relay is untrusted.
  - Scan C-9: a hostile relay that answers every poll with a fresh generation and 256 junk messages grows
    `relay_inbox` and the audit log for every live deal.
  - A legitimate relay resets a deal only on a restart or a 24-hour mailbox expiry.
  - A HOUSE pair table has a 300 s silence deadline, so a fresh table must recover from one lost mailbox at once.
- **Decision.**
  - A `Conflict` from `stage_relay_batch` stops only that deal's delivery (`relay_finished` in
    `crates/table-runtime/src/relay.rs`); the round, the other deals and the inbox pass go on.
  - A change of generation away from a non-empty generation is a reset. A deal takes at most one reset per
    `RESET_WINDOW_SECS` (600 s), counted from its last accepted reset. A reset inside the window returns `Conflict`
    and writes nothing. A clock that went backwards counts as inside the window.
  - The first adoption from the empty generation is not a reset and starts no window. `generation_at` 0 means
    never reset, which includes every route migrated from version 14.
  - An accepted change of generation prunes that deal's applied and rejected `relay_inbox` rows of other
    generations; pending rows stay.
  - 1024 inbox rows per deal (`INBOX_CAP`) is a backstop that returns `Conflict`.
  - Migration 0015 runs only when `relay_routes` has no `generation_at` column (`crates/table-ledger/src/lib.rs`),
    because the older-schema tests step `user_version` back without dropping the column.
- **Lost:**
  - the window starting at the first adoption (0aa46df as first built). A fresh deal could not take its first
    real reset for 600 s, so a HOUSE pair table caught by a restart in its first minutes lapsed instead of
    replaying. 582c384 kept two tests green only by moving their clocks 600 s on, and c3c4be4 restored both;
  - having no window and no cap, as before C-9a.
- **Cost kept:** a deal that was reset waits 600 s before its next reset, so a second mailbox loss inside that
  window only delays that deal. Silence deadlines are unaffected.
- **Migration note:** `0015_relay_reset.sql` says `generation_at` is '0 until the first adoption'. Since 698e037 it
  is 0 until the first reset. A shipped migration is not edited, so this section is the correction.
- **Amendment, 2026-10-10 (C-9b):** the wallet now writes one `envelope.rejected` audit row per batch of one deal
  and one generation (3c6e4bc, c93ac9d).
  - `Ledger::reject_inbox` (`crates/table-ledger/src/relay.rs`) takes at most 256 messages, all of the first
    message's deal and generation, and otherwise returns `Conflict` and writes nothing. In one Immediate
    transaction it turns each message's pending row into `rejected` (any UPDATE that does not change exactly one row
    is a `Conflict`) and appends one row: actor `relay`, action `envelope.rejected`, the deal, and a detail of
    `generation`, `count`, `raw_hashes` (digests in slice order) and `reason`. No raw text reaches the audit log.
  - `finish_inbox(false)` is a batch of one.
  - `consume_inbox` (`crates/table-runtime/src/relay.rs`) collects a pass's refused messages and rejects them one
    batch per deal and generation. A pass that returns early leaves its collected rows pending, and the next pass
    writes their row then.
  - **Closed: C-9c (2026-10-15, challenge-2026-10-15).** The wallet and the HOUSE run one inbox pass,
    `table_app::drain_inbox` (`crates/table-app/src/relay.rs`). It applies an exact duplicate without the caller's
    policy, leaves a message whose policy returns `InboxOutcome::Retry` (a ledger SQL or integrity fault) pending and
    continues, and rejects the refused messages one batch per deal and generation after the loop, also when a
    message was retried. The caller supplies only its per-message policy: the wallet's `classify_inbound`
    (`crates/table-runtime/src/relay.rs`), the HOUSE's `Seller::receive`. A HOUSE ledger fault is now the tick's
    recorded failure, not an early return, so negotiation and reporting still run. Evidence:
    `crates/table-app/tests/inbox.rs`; `house_junk_batch_is_one_audit_row_per_deal_and_generation` and
    `house_five_junk_messages_are_five_rejected_rows_and_one_audit_row` in `crates/table-runtime/src/house_tests.rs`.
  - Evidence: in `crates/table-ledger/src/tests.rs` `c9b_a_rejected_batch_writes_one_audit_row`,
    `c9b_a_batch_that_is_not_one_deal_one_generation_all_pending_writes_nothing` and
    `c9b_finish_inbox_rejection_is_a_batch_of_one`; in `crates/table-runtime/src/groups_tests.rs`
    `a_hostile_relay_batch_is_rejected_with_one_audit_row` and
    `a_hostile_relay_batch_for_two_deals_is_two_audit_rows`.
- **Evidence:** commits 0aa46df, 582c384, 698e037 and c3c4be4; in `crates/table-ledger/src/tests.rs`:
  `c9a_first_adoption_starts_no_window_and_a_reset_inside_it_is_refused`,
  `c9a_an_accepted_reset_prunes_settled_rows_of_this_deal_only`,
  `c9a_a_deal_past_the_inbox_cap_is_refused_and_writes_nothing` and
  `c9a_a_version_14_ledger_migrates_and_reads_generation_at_zero`;
  `a_refused_relay_batch_stops_one_delivery_and_not_the_round` (`crates/table-runtime/src/groups_tests.rs`);
  `house_reopens_durable_pair_table_and_outbox_and_replays_after_mailbox_loss` (`house_tests.rs`);
  `two_wallet_actors_negotiate_and_settle_through_in_process_relay_without_buyer_api_access` (`relay_tests.rs`).

## 34. A payment being checked with PayPal is not on hold, and an ending while it was being checked never says no money moved

- **Date:** 2026-10-10
- **Decided by:** the App Master, wakes 58, 60 and 63.
- **Constraint.**
  - When PayPal's answer about a money step is lost, the wallet does not know whether money moved (AGENTS.md's
    UNVERIFIED rule).
  - Home and the Book disagreed about such a deal.
- **Decision.**
  - `heldAtPayPal` (`apps/desktop/client/src/windows/main/home/model.ts`) leaves a payment being checked out of On
    hold. Its second argument is the set of deal ids whose attention item carries a `money_check`. The Book's
    `sums(deals, checking)` (`modules/book/model.ts`) does the same, and puts such a deal in no other bucket
    either: PayPal may already have collected it, so it is not money on hold, and it is not paid.
  - The pill is `moneyCheckPill(check, isTerminal(deal))` (`lib/words.ts`): 'Checking with PayPal' while the deal
    lives, 'Not shown by PayPal' once it ended. The Money line is `moneyCheckNow(ended)`: 'not confirmed yet ·
    PayPal is being asked', or 'PayPal never showed what happened · look at this payment in PayPal'. Home's bead
    tip, hub label and Needs-you details, the deal page, the Book's grid row, status pill and detail, and the
    Counter panel's Money and Outcome lines use them.
  - A deal that ended at its deadline with a step still open never says no money moved. The steps tell this
    through `endedBeforePayPalShowed` (`windows/main/logic.ts`): an `expired` or `lapsed` step with a
    `checking_with_paypal` step or an `unknown` money call before it that no later `ok` or `failed` call closed.
    The Rewind narration, Who decided, What you were shown and the away card word it from that.
  - When the steps a surface holds cannot tell (the away card reads from the owner's last look and the Rewind reads
    one week, so a check that began earlier is out of sight), the deal's own record does: `useEndedUnshown`
    (`windows/main/unshown.ts`) reads `deal_evidence` for each such ending, and a `money_check` there means the
    deal ended with a step open. A failed read leaves its deal out, so that deal keeps today's words. The away card
    waits for the reads. Read-only.
    - **Amended 2026-10-10 (section 36).** A failed read no longer keeps today's words. An ending whose record could
      not be read is 'not available yet'. The sentence above stands as the record of the decision at the time.
  - In the Book, an UNCONFIRMED end is keyed `unconfirmed` (`statementKey`), not `pending_reporting`. It has a 'No
    match' statement filter and a dashed 'no match' chip in the lens table. The CSV keeps its values.
- **Lost:**
  - counting a checked AUTHORIZED payment as on hold;
  - showing 'Checking with PayPal' after the deal ended.
- **Cost kept:**
  - A checked deal's Book row keeps its amount in its bucket column while the totals leave it out, and the bucket
    filter still lists it under its bucket.
  - An ended deal with an open check also leaves the Not confirmed and Stopped totals.
  - The tone of the Book's week answer still counts every AUTHORIZED deal (`holds` in `WeekAnswer`).
- **Open:**
  - The Rewind's bead tip (dashboard lite r2 robustness-1) was fixed at 220da92 and 6d06cfe (2026-10-10; STATUS
    'Rewind bead tip rework'). It was not part of this section.
  - Part 2's builder named other surfaces that may still word a checked payment as on hold. Checked against main on
    2026-10-10:
    - `modules/book/understand.ts:70`: the 'On hold' chip ('Held at PayPal, not paid yet', states AUTHORIZED);
    - `modules/rescue.tsx:468`: `deskLine` ends in `moneyNow(d)`, which says 'on hold at PayPal' for AUTHORIZED
      (whether a rescue deal can be AUTHORIZED was not checked);
    - `modules/spend.tsx:163`, `:184` and `:200`, and `modules/spend/gate.ts:116` ('On hold');
    - `windows/main/logic.ts` `moneyNow` (its AUTHORIZED line) and the dial: `moneyNow` is still what Home's bead
      tip shows for a deal without a check item; the dial itself was not read;
    - `windows/tumbler/logic.ts:383` (the receipt verb 'On hold').
  - Not as described: `windows/approval/DealReview.tsx:785` is the clock label 'Hold releases in', not a line
    that says the money is on hold. In the Rust `book_query` answer (`crates/table-ledger/src/book.rs`) no
    hold wording was found; it was not read in full.
- **Evidence:**
  - the commits: 5f67c8f, 8a2f53f, 621ed9e and 3698520 (the rework); 444cde1, 0670480, 1b7d36c and 1881489 (the
    unshown read); 2004f19, 90ddad1, 3d8754b and 885962f (the Book, rework C part 2);
  - the tests, by file: in `windows/main/deal/Decision.test.tsx` the describe 'Summary while a money check is
    open'; in `windows/main/home/model.test.ts` 'does not count a payment being checked with PayPal as on hold';
    in `windows/main/home/away.test.ts` 'does not open with No money moved while a payment is still being checked
    with PayPal', 'tells a deal that ended at its deadline while PayPal was being asked as one line, never as no
    money moved' and 'tells an ending as unshown when the deal’s own record says a check was open, though no check
    step is passed'; in `windows/main/rewind.test.ts` 'endedBeforePayPalShowed: a check still open at a deadline
    ending'; in `windows/main/deal/shown.test.ts` 'when PayPal never showed what happened to the payment, ends with
    that and not no money moved'; the describes 'endingsToRead' and 'useEndedUnshown' in
    `windows/main/unshown.test.ts`; in `modules/book/model.test.ts` the describes 'a deal that ended UNCONFIRMED is
    counted as an end, not as a wait' and 'a payment being checked with PayPal is not on hold'; in
    `lib/polish3.test.ts` the describe 'Home and Book agree on a payment being checked with PayPal'.

## 35. A parked capture or void that PayPal does not settle waits at the deadline without an error, and is read back at most once an hour (deal-to-settlement rework C part 1)

- **Date:** 2026-10-10
- **Decided by:** the App Master, 2026-10-10 (rework C part 1).
- **Constraint.**
  - An AUTHORIZED deal cannot auto-void while its capture may have happened.
  - The deadline answered `Unavailable` on every tick.
- **Decision.**
  - In `deadline_default`'s AUTHORIZED branch (`crates/table-app/src/pipeline.rs`), when every open operation is a
    parked (`needs_owner`) capture or void (`only_parked_money_open`) and `auto_void` answers `Unavailable`, it
    returns `Ok(false)`: the deal stays AUTHORIZED, nothing is sent, and the owner's money-check card already says
    to look in PayPal. Any other open operation keeps `Unavailable`.
  - `PARKED_READ_SECS` = 3600 (`crates/table-app/src/pipeline/resolve.rs`). `resolve_deal` reads a parked capture
    or void back at most once per `PARKED_READ_SECS`, by request id. The time is kept in memory
    (`Pipeline::parked_read`) and recorded before the read, so a failing read is throttled too, and a restart reads
    at once. Authorize is not throttled: a parked authorize is still read on every tick.
- **Lost:** `Unavailable` on every tick, and a read on every tick.
- **Open:**
  - **Amended 2026-10-10** (deadline-safe-default full r1, 2026-10-10; the first bullet used to say that nobody had
    yet read the scheduler, `hosted.rs` or `rescue.rs` for other per-tick reads of a parked step). Answered:
    - `rescue.rs` reads a parked send at most once per `PARKED_READ_SECS` (section 37). It polls a sent invoice past
      its deadline once per `RESCUE_POLL_SECS`.
    - A parked authorize at the deadline is still read on every tick, for up to 72 h (section 31 item 3).
    - An unknown step that is not parked is read on every tick while PayPal fails (`scheduler.rs:84-89` →
      `deadline_default` → `resolve_deal`), and `paypal_calls` rows are written at that rate. This is full r1's
      economics-1, which waits on the operator.
    - Per-tick queries scale with the lifetime ledger (`list_deals`, `open_operations`). This is full r1's
      economics-2, which waits on the operator.
    - `services/house-seller/src/hosted.rs` was read only at :835-935.
  - The Tumbler's ended card cannot be dismissed. That is rework C part 3, which needs a design in
    `crates/table-attention`.
- **Evidence:** 0436a4f and 6896f78; in `crates/table-app/tests/pipeline.rs`:
  `a_parked_capture_paypal_shows_unreadably_waits_at_its_deadline_and_sends_nothing`,
  `a_parked_capture_whose_read_fails_at_its_deadline_waits_then_settles`,
  `a_parked_void_paypal_shows_unreadably_waits_at_its_deadline` and `a_restart_reads_a_parked_capture_at_once`.

## 36. An ending whose record could not be read is 'not available yet', never 'no money moved'

- **Date:** 2026-10-10
- **Decided by:** the App Master at wake 67 (2026-10-10), reversing its own earlier call. It reverses one line of
  section 34, which recorded that call as 'A failed read leaves its deal out, so that deal keeps today's words.'
  The council reports are not in the repository; they are cited as wallet-deal-dashboard full r1 (2026-10-10) and
  full r2 (2026-10-10).
- **Constraint.**
  - wallet-deal-dashboard full r1 failed: robustness was 0.45, under its 0.50 floor (overall 0.31, coverage 0.25).
    A failed `deal_evidence` read left the deal out of `useEndedUnshown`'s set, and the deal then read 'no money
    moved' (in `unshown.ts`, the Rewind tip, the narration and the away card). That is the claim the read exists to
    stop.
  - Its economics line: `world.tsx` read `deal_display` for every lifetime deal, and the away card read
    `deal_evidence` for every UNCONFIRMED deal.
- **Decision.** What each commit does (client only; every read is read-only):
  - 637aae1: `readEach` (`apps/desktop/client/src/lib/readEach.ts`) reads the ids at most `READ_CONCURRENCY` = 8 at
    once, rejects a read still out after `READ_TIMEOUT_MS` = 10 000 ms, and settles each read in the order of the
    ids. The per-deal fan-outs go through it. An invoke cannot be cancelled, so a read that timed out is only no
    longer waited on.
  - a65c36d: the third outcome, unread. `useEndedUnshown` returns `unshown`, `unread` and `pending`. A read that was
    rejected or timed out, and any ending past `ENDING_READS_MAX` (500, mirroring `HISTORY_STEPS`), is unread. The
    words are `ENDING_UNREAD_PILL` = 'Not available yet' and `ENDING_UNREAD_NOW` = 'not available yet · this deal’s
    record could not be read' (`lib/words.ts`); the Rewind narrates `endingUnreadSentence`, the away card words it
    with `endingUnreadLine`. A read that never answers no longer holds the Rewind on 'reading the week' or hides the
    away card.
  - 22b4886: the away card reads statements (`deal_evidence`) only for the unconfirmed endings it words
    (`statementReadIds`), capped at `ENDING_READS_MAX`, through `readEach`, and only once the history read is in
    without an error.
  - 66391b6: `deal_display` is read again only for live deals and for deals whose row changed
    (`windows/main/displays.ts`, `useDisplays`; the token is the state and `updated_at`). CAPTURED and RECEIPTED
    count as live (`CHECKED_AFTER_END`), because a capture read-back on a paid deal closes its money check without
    moving `updated_at`. `useAllEvidence` is unchanged.
  - 2aad736: a payment whose outcome is not known is a dashed bead (`BeadKind` 'unknown', which `beadKind` never
    returns), never on hold (the Dial legend that said "not known yet" went with the Dial). `beadLook.ts`
    (`liveLook`, `pastLook`) holds the mapping.
  - 842c6f7: the Rewind says when a busy week shows only its latest steps: `REWIND_TRUNCATED`, shown when
    `deal_history` sets `truncated`.
  - 810eeef: the test fix, real timers back before `waitFor` in the never-answering read test (`unshown.test.ts`).
  - The Rewind bead tip itself was fixed before, at 220da92 (`checkOpenThrough`) and 6d06cfe (`rewindCheckTip`).
- **Lost:** a failed read keeping today's words.
- **Open.** Checked against main on 2026-10-10. From wallet-deal-dashboard full r2 (ready, overall 0.55, coverage
  0.80, robustness 0.68, economics 0.10; the judges are uncalibrated):
  - Places outside the rework that may still say 'no money moved' or 'on hold' for an ending the code cannot place:
    - `amountNote` (`windows/main/logic.ts:205`): 'on hold at PayPal' for AUTHORIZED and 'no money moved' for
      WITHDRAWN and EXPIRED, with no check of `money_check`. Used at `windows/main/ui.tsx:84` and
      `windows/main/modules/spend.tsx:458` and `:539`. The deal page (`deal/Decision.tsx:34`) uses the check's words
      instead when there is one.
    - `liveLook` (`beadLook.ts`) and `moneyNow` (`logic.ts:173`) when attention has no item for the deal: the bead
      falls back to the deal state's words. The same holds for `summarize().held` (`logic.ts:259`) and Home's
      `heldAtPayPal(..., checkingIds(w.needs))` (`Home.tsx:390` and `:475`) when `attention_list` fails or lags.
    - The Shield: `windows/main/modules/shield/matrix.ts:149-150` (`moneyNow(d)` on an order made) and
      `windows/main/modules/shield.tsx:556` ('Money right now: ...').
    - While the endings reads are pending, the Rewind's dial beads do not wait for them (`Home.tsx` ~:223-233), so an
      ending the code cannot yet place shows 'nothing moved' for up to 10 s per read (full r2 robustness-3).
  - Waiting on the operator's Approval (full r2 `must_address`):
    - economics-1: `displays.ts` `CHECKED_AFTER_END` re-reads every CAPTURED and RECEIPTED deal on each refetch,
      because `record_resolution` does not move `deals.updated_at` when it records the outcome
      (`crates/table-app/src/pipeline/resolve.rs:518`, `:528` and `:531`). The fix the council names is in Rust:
      `record_resolution` moves `updated_at`, then `CHECKED_AFTER_END` is deleted. deadline-safe-default full r1
      (2026-10-10) found nothing on a deadline path that reads `deals.updated_at`, so moving it cannot alter a
      deadline.
    - economics-2: a dropped `deal_display` batch keeps reading, and batches can overlap without limit.
    - economics-3: `useAllEvidence` (`world.tsx:71`, used at `modules/book.tsx:93`) reads `deal_evidence` for every
      lifetime deal at once.
- **Evidence:** the commits above; the tests, by file:
  - `lib/readEach.test.ts`: the describe 'readEach' ('never has more than `concurrency` reads out at once',
    'rejects a read that never settles once its time limit has passed');
  - `windows/main/unshown.test.ts`: 'counts a read that never answers as unread once its time limit has passed'
    in the describe 'useEndedUnshown', and the real-timers fix of 810eeef;
  - `windows/main/rewind.test.ts`: the describes 'checkOpenThrough: a money step open by the steps up to one',
    'rewindCheckTip: the Rewind’s bead tip while a money step is open' and 'an ending whose own record could not be
    read';
  - `windows/main/home/away.test.ts`: 'tells an ending whose own record could not be read as not available yet,
    never as no money moved' and the describe 'statementReadIds: the deals whose line uses a statement read';
  - `windows/main/displays.test.ts`: the describes 'displayToken' and 'displaysToRead' ('reads a paid deal whose
    money check can close without its row changing');
  - `windows/main/beadLook.test.ts`: the describes 'liveLook: a bead as the deal stands now' and 'pastLook: a bead
    on the Rewind';
  - 842c6f7 has no test of its own.

## 37. A rescue deal's deadline: a draft ends, a sent invoice is read first, a parked send is read hourly (deadline-safe-default rework after lite r1)

- **Date:** 2026-10-10
- **Decided by:** the App Master, wakes 69 to 71 (2026-10-10). Run 2be0bddf built it. The council reports are not in
  the repository; they are cited as deadline-safe-default lite r1 (2026-10-10) and full r1 (2026-10-10).
- **Constraint.**
  - lite r1's must-address, verbatim: 'robustness: A rescue deal with a parked invoice send is never read or ended
    at its deadline'.
  - Without an invoicing client, `rescue_tick` returned early, so a draft create never closed.
  - `rescue_deadline` could expire a sent invoice unread, and `unwrap_or(false)` counted a failed read as unpaid.
- **Decision.** `rescue_deadline`'s doc comment (`crates/table-app/src/rescue.rs`, :674-679) is the rule:

  > A rescue deal's deadline: nothing is sent and nothing is collected. An unapproved fix
  > lapses (PayPal retries by itself); a draft never sent expires; a sent invoice is read
  > once more, then expires if it is not paid. A send whose answer is still unknown keeps the
  > deal open: that invoice may be with the subscriber. A sent invoice ends at its deadline
  > only after a read shows it unpaid, and without the invoicing client or the deal's agent
  > key it waits until they come back.

  - c047749 (R1): `rescue_resolve` reads a parked send (`needs_owner`, no owner ticket) once either the deal's
    deadline or `REQUEST_ID_KEPT_SECS` (6 h from the step's start) has passed. It reads at most once per
    `PARKED_READ_SECS`, keyed by request id, and records the time before the read, so a failing read is throttled
    too. `resolve_invoice_send` then closes a DRAFT as not done, and at the deadline the deal takes
    `apply_deadline_default`.
  - 6904055 (R2 and R3): with no invoicing client, a create still closes at its deadline (that needs no read) and a
    sent invoice waits. A failed deadline read waits and retries at `RESCUE_POLL_SECS` (60 s). `Error::Unavailable`
    answers `Ok(false)`, and every other error propagates.
  - de1e878 (R4): the forecast test, a deal with an open operation is left out of the forecast.
- **Lost:**
  - expiring a sent invoice unread;
  - counting a failed read as unpaid;
  - a draft create that never closes without a client.
- **Open.** From deadline-safe-default full r1 (ready, overall 0.585, coverage 0.80, robustness 0.72, economics
  0.10, no hard failures; the judges are uncalibrated), checked in code on 2026-10-10. All wait on the operator's
  Approval:
  - robustness-1 (`rescue.rs:902-910`, `pipeline/resolve.rs:206-208`, `rescue.rs:697-719`): a parked send whose
    invoice reads neither DRAFT nor SENT (CANCELLED, other, or not matching) never ends after its deadline.
    `resolve_invoice_send` parks it as 'other' (`rescue.rs:903` and `:909`), `park` returns at once for a step
    already waiting for the owner, and `rescue_deadline` answers `Ok(false)` for any open operation but a SETTLING
    invoice-create. The council's closing test parks a send, cancels the invoice, ticks past the deadline and asserts
    Expired with one send.
  - the rework's edge: an AwaitingApproval rescue deal whose deadline poll fails with an error other than
    `Unavailable` returns that error once per `RESCUE_POLL_SECS` and stays open. The council judged it reachable
    only through a corrupt row or a ledger fault, and no test covers it.
  - a sent invoice past its deadline whose read keeps failing waits at the 60 s cadence with no ceiling. With no
    client or no key, the deal waits with no ceiling, by design.
- **Evidence:** in `crates/table-app/tests/rescue.rs`:
  - `a_parked_send_is_read_and_ended_at_the_deadline`;
  - `a_parked_send_past_the_request_id_window_closes_not_done`;
  - `a_parked_send_whose_read_fails_is_read_once_an_hour`;
  - `without_a_client_a_create_open_at_the_deadline_closes_and_the_deal_expires`;
  - `without_a_client_a_sent_invoice_waits_and_is_read_once_it_is_back`;
  - `a_failed_read_at_the_deadline_waits_and_retries_on_the_poll_cadence`;

  and in `crates/table-runtime/src/forecast_tests.rs`: `a_deal_with_an_open_operation_is_left_out_of_the_forecast`.

## 38. The Book leaves a mixed Amount out in the client, keeps its evidence reads in the feature, and caches them past the Book (ops-ledger-query full r1 to r3)

- **Date:** 2026-10-11
- **Decided by:** the App Master, through two reworks. After full r1: 02474e2 (the wallet's table shows an Amount only
  when each line holds one money state), 65f748b (read deal evidence only for deals whose evidence can have changed) and
  5009e77 (the playbook names direction and state). After full r2: 4fee9d2 (`readEach` takes an AbortSignal) and 7294b91
  (an evidence cache that outlives the Book, one abortable pass at a time, narrower re-read rules), with f5c6a98 and
  6d8f676 for the docs. The council reports are not in the repository; they are cited as ops-ledger-query full r1
  (2026-10-10), full r2 (2026-10-11) and full r3 (2026-10-11). `readEach` itself came in section 36 (637aae1).
- **Constraint.**
  - From full r1's must-address: value-1 (with no state filter, the wallet's table added paid, held, in-progress and
    stopped money into one Amount) and economics-1 (opening the Book sent one `deal_evidence` read per deal, and sent
    them all again on every deal-list refetch).
  - From full r2's: economics-1 (every Book open still read every deal's evidence and every refetch re-read most paid
    deals) and economics-6 (a superseded pass kept reading, because `dead` only dropped its results).
- **Decision.** Three choices, all in the client. No Rust changed, so there is no new command, no authority-table row
  and no `PINNED_MANIFEST` change (theme T11).
  1. **The Amount is suppressed in the client, not split by a Rust state bucket (02474e2,
     `modules/book/model.ts` and `modules/book.tsx`).** `WalletAnswer` shows the Amount column only when
     `walletSumsApart(answer.query)` is true: the query groups by state, or filters state (`eq` or `in`) to values that
     share one `bucketOf` bucket, judged on a plain deal. Otherwise one hint says amounts are left out. The reason given
     at the time (STATUS): the bucket rule lives in the client, and a Rust copy would be another hand-kept copy of it.
  2. **The evidence fan-out is fixed inside this feature (65f748b, 4fee9d2; `lib/readEach.ts`,
     `windows/main/evidence.ts`).** `lib/readEach.ts` is the shared helper for width (`READ_CONCURRENCY`, 8), timeout
     (`READ_TIMEOUT_MS`, 10 s) and abort. `evidence.ts` keeps its own re-read rule (`evidenceToRead`), its own pass and its
     own cache. The reason given at the time (STATUS): the Book is the only caller of `useAllEvidence`.
  3. **A module-level client cache outlives the Book, instead of a batched IPC command (7294b91, `evidence.ts`).**
     Answers are kept at module scope and written as they land; one pass runs at a time and a newer list or the Book
     closing aborts it. No new command, no Rust, no authority-table row and no `PINNED_MANIFEST` change. STATUS: the
     council named a cache that outlives the Book as one way to close economics-1.
- **How full r3 judged each choice** (its 'Shape choices' section):
  1. Supported for the Book: the hint tells the owner why and what to pick. Not supported for the assistant path
     (value-shape-1): `book_query` still hands the model a `sum_amount` over every state, guarded only by a playbook
     sentence, and neither guards against the `paypal_calls` multiplication. Checked on main: the `sum_amount` metric is
     `SUM({AMOUNT}) AS sum_amount` (`crates/table-ledger/src/book.rs:96`); the `paypal_calls` view joins `deals` to
     `paypal_calls`, one row per PayPal call (`book.rs:113-115`); the playbook's guard is
     `prompts/shop-assistant.md:17-19` ("`sum_amount` adds every state unless the query filters on state or groups by
     state"). Still so.
  2. Supported for the shared helper and a per-feature re-read rule. Not supported for per-feature pump and cache
     machinery, since the other `deal_evidence` readers neither join nor reuse the Book's cache. Not needed for
     correctness.
  3. Supported by economics-1's count: later opens and refetches drop to the live set, which a per-open batched command
     would not achieve unless paged. The residue is the first open after each wallet start: N IPC round-trips and N
     actor messages, each of which reloads the whole ledger.
- **Lost:**
  - a Rust-side state bucket in `book_query`: full r1's closes-when for value-1 offered "the state bucket becomes an
    always-on split like direction" as one of two ways to close it; full r3 shape choice 1 says it would protect both
    the Book and the assistant path;
  - one store shared by every `deal_evidence` reader (`displayToken` in `lib/` plus one store factory): craft's
    suggested convergence in full r3 shape choice 2;
  - a batched or paged `deal_evidence` command: full r2's closes-when for economics-1 ("a batched or paged read
    limited to the deals the Book shows") and full r3 shape choice 3;
  - the cheapest shape in full r3, from economics (shape choice 3): the cache plus one batched cold fill, which would
    remove the N round-trips and N whole-ledger reloads per wallet start.
- **Open.** Waiting on the operator's decision, the two highs in full r3's must-address:
  - economics-9 (`readEach.ts`:13-21, :52, :60 and `evidence.ts`:157): a timed-out evidence read frees its slot while
    its IPC call is still out, so the 8-read bound holds per slot, not per call. Closes when: 'the number of unsettled
    `deal_evidence` invokes can never exceed READ_CONCURRENCY, timeouts included, and a test pins it: with an invoke
    that never settles, 50 (or 10,000) ids, fake timers advanced past several timeouts, and 5 refetches, the fake invoke
    is called at most 8 times.'
  - value-6 (`book.tsx`:225, :154-159, :636): in the Simple view, an answer reaches deals outside the week list and the
    slip does not say so. Closes when: 'an answer in the Simple view that reaches deals outside the week list says so on
    the slip (the count of older deals, or "everything on record"), pinned by a client test over a ledger with an older
    deal.'
  - Docs lag, recorded and not fixed here: `evidence.ts` ~:15-16 and `docs/features/book.md` Known gaps ("At most 8
    reads are in flight") hold per slot, not per IPC call (craft-h, economics-9).
- **Evidence:**
  - `modules/book/walletAmount.test.ts`: 'the week lens over paid, held and stopped money' ('the window keeps the three
    states apart', 'the wallet shows no combined Amount for it') and 'walletSumsApart' ('is false when the lines span
    money states', 'is true when each line holds one money state').
  - `windows/main/evidence.test.ts`: 'a ledger of 10,000 ended deals' ('with nothing changed names no read, and a
    reopened Book or a refetch makes none', 'adds only a changed deal, a live deal and a deal with an open money check');
    'one pass at a time' ('keeps 5 refetches during a pass to 8 reads in flight and 50 plus the changed deals reads',
    'stops reading when the Book closes and keeps the reads that finished').
  - `lib/readEach.test.ts`: 'never has more than `concurrency` reads out at once', 'starts no further read once the
    signal is aborted, and keeps the reads that finished'. No test pins the `deal_evidence` call count under timeouts
    (economics-9).
  - STATUS sections 'Book wallet amounts and evidence reads (ops-ledger-query full r1 must-address 1 and 2)' and
    'Book evidence reads bounded (ops-ledger-query full r2 must-address 1 and 2)'.

## 39. A step that may have reached PayPal is told apart in Rust and worded in the client, an open earlier step has its own refusal, and every notice shows plain words (owner-approval-decision full r1 to r3)

- **Date:** 2026-10-11
- **Decided by:** the App Master, through reworks after each full round. After full r1 (head 0ec4d5a): c4485bd and 901bfd3
  (the runtime tells a reserved or sent step from a refusal; a void whose answer is lost has its own sentence), dc6a616 (a
  step that reached PayPal never reads as Not paid or nothing was done), 0a33512 (the first-read, token and unlock notices
  say plain words) and 6c3d0d0 (docs). Then 0f6d02e (the void sentence in the window) and f147620 (docs, STATUS second pass),
  which is the head of full r2. After full r2: 375d8fa (a second step on a deal with an open PayPal step says it is not
  confirmed yet), ad97fb1 (its own heading and sentence, mirrored in `words.ts`) and 90e633e (docs, third pass, the head of
  full r3). After full r3, outside the council: 8548ee1 (the token and pairing-read notices show plain words, with a wiring
  test; craft-24) and c837bad (docs), with 1bfafdc (the test's `found[0]` narrowed for client tsc). The council reports are
  not in the repository; they are cited as owner-approval-decision full r1, full r2 and full r3 (all 2026-10-11), with the
  lite r1 (2026-10-09) as background.
- **Constraint.**
  - From full r1's must-address, lines 1-2 (one defect seen by robustness and craft): a capture or authorize that reached
    PayPal and then failed was shown to the owner as "Not paid ... nothing was done". Line 3: three footer notices (token,
    unlock, first read) showed the wallet's raw text.
  - From full r2's, lines 1-2 (one defect seen by robustness and craft): a second hold while the first step was still open
    read "Not paid ... nothing was done". Line 3 (craft-17): `LockCard` and `PairingConfirm` still showed the wallet's unlock
    and pairing text.
  - From full r3's: craft-24 (high), the token notice still showed the wallet's raw text in two of its three places
    (`OwnerConfig.tsx`, the pairing-focus view and wallet setup).
- **Decision.** Three choices. No new IPC command, no authority-table row and no `PINNED_MANIFEST` change.
  1. **"May have reached PayPal" is decided in Rust by an operation reserved during the call, and reaches the window as text,
     not as a new code or field.** `decide()` compares the deal's reserved-operation count before and after the call
     (`after_paypal_with`, `crates/table-runtime/src/service.rs`). If it grew, the answer is code UNAVAILABLE with an exact
     sentence (`REACHED_PAYPAL`, or `VOID_REACHED_PAYPAL` for an owner's void). The client recognises the sentence by its
     exact text (`windows/approval/model.ts`, :295 and :300). The sentences are copied by hand into `lib/words.ts`; the only
     guard is the Rust test `the_wallet_sentences_match_the_client_words_byte_for_byte` (`reached_paypal_tests.rs`, :425-437),
     which reads `words.ts` with `include_str!`.
  2. **The open-operation remap (option B of full r2's closes-when).** When the call reserved nothing, the pipeline said
     PERMISSION, and `has_open_operation` is `Ok(true)`, `after_paypal_with` returns UNAVAILABLE with `STEP_NOT_CONFIRMED`
     (`service.rs`, :725-731). The client gives it its own heading, "Not sent: an earlier step isn’t confirmed yet". Option
     (A), not chosen: `approval_summary` sets `can_release` false while an operation is open, so Collect is disabled across a
     remount.
  3. **Every notice in the window shows plain words through `footerNoticeText(kind, error)`.** The kinds are `token`, `unlock`,
     `pairing` and `pairing_read` (and `read` for the first read). Users: `DealReview` (read :306, token :496, unlock :497),
     `OwnerConfig` (token :169 and :248), `LockCard` (`ui.tsx:95`, unlock) and `PairingConfirm` (pairing read :121, unlock
     :206, pairing :207). It is pinned by `notices.test.ts`, a source-reading wiring test, not by rendered components.
- **How the council judged it** (full r3, 'r2's must_address, condition by condition', and its med lines):
  1. Closed for r1's lines 1-2: every answer after a decision or refusal that the tests reach is now true about money. The
     text-matching shape itself was not endorsed: craft's lead craft-22 (deciding the case by an operation-count delta) stays
     in its verdict.
  2. Closed in behaviour as option (B). The remount gap (option A) stays at med (craft-26, value-6, robustness-14); it is not
     must-address. The new sentences have their own truth gaps (craft-25, med). Low L3: when `has_open_operation` returns Err,
     the result falls back to PERMISSION's "nothing was done" (the `Ok(_) => refusal` arm). That is the one non-conservative
     arm.
  3. Meets the test condition only at the helper and source level: `model.test.ts` checks `footerNoticeText`, and nothing
     renders `DealReview`, `LockCard` or `PairingConfirm` (robustness-3, med). craft-24 was closed after r3 by 8548ee1, which
     the council did not re-judge.
- **Checked on main (1bfafdc).** `resolve_create` is in `crates/table-app/src/pipeline/resolve.rs` (:307; the lost-create park
  at :331-336), not in table-engine. r3 cites `after_paypal_with` at `service.rs:722-735`; main has the function at :715-735,
  with the open-operation arm at :725-731. `can_release` is at `service.rs:436-441`; the gates read it at `gating.ts:139` (the
  money gate) and :173 (void); the capture gate is :171, as r3 says. The rest of what this section cites matches r3.
- **Lost:**
  - option (A), the open step visible in `approval_summary` with the money buttons disabled across a remount;
  - a dedicated error code or a `reached` field instead of text matching (craft's lead craft-22 in r3's Leads): the Rust
    sentence and the client words can drift, and one Rust test is the only guard;
  - rendered tests for `DealReview`, `LockCard` and `PairingConfirm`.
- **Open.** With the operator, because no fourth round exists (r3's Report and Approval):
  - craft-25: (i) after a lost owner create, `resolve_create` parks the step with no PayPal call, yet `REACHED_PAYPAL` says
    "the wallet asks PayPal what happened"; (ii) for a parked capture, authorize or void, `STEP_NOT_CONFIRMED`'s "asks PayPal
    what happened first" is false in time, and "first" suggests the refused step can follow, which it cannot. Closes when
    `decide()` tells the parked case apart (by `needs_owner`) and its sentence ends as `MONEY_CHECK_PARKED` does, a lost owner
    create gets a variant without the read-back claim, and one runtime test and one model test pin it;
  - craft-26 / value-6: after a remount the window shows no open step, the strip reads "On hold" and Collect stays live. A
    hold there is refused with `STEP_NOT_CONFIRMED` and moves no money. Value adds the parked owner capture: every later hold
    is refused until the deadline releases the hold, and the owner has no next step;
  - craft-27: the pairing INVALID sentence (`model.ts`, :248-249) says "lapsed" for an unusable name too (`ShortText` →
    `Error::Protocol` → INVALID); value disagrees on reachability;
  - robustness-3 (no render test), robustness-4 (errors raised after the money step finished bypass `after_paypal`) and
    craft-12 (UNAVAILABLE reads "couldn’t be reached, try again" on the lost-agent-key and missing-credentials paths).
  - Docs lag, recorded and not fixed here: STATUS.md's first-pass section (~:2240-2243) still quotes "won't send it again; the
    deal shows where it stands" without a superseded mark, and its truth-table rows for a lost create say "read-back, parked,
    as (a)".
- **Evidence:**
  - `crates/table-runtime/src/reached_paypal_tests.rs`: `a_capture_whose_answer_is_lost_reads_as_reached_paypal`,
    `a_capture_answer_that_does_not_verify_reads_as_reached_paypal`,
    `a_confirmed_operation_with_the_deal_moved_reads_as_reached_paypal`,
    `an_authorize_whose_answer_is_lost_reads_as_reached_paypal`, `a_capture_refused_before_any_call_keeps_its_own_error`,
    `a_void_whose_answer_is_lost_reads_as_reached_paypal`, `a_void_refused_before_any_call_keeps_its_own_error`,
    `a_second_capture_while_the_first_is_open_is_not_confirmed_yet`, `a_void_while_the_capture_is_open_is_not_confirmed_yet`,
    `a_second_countersign_while_the_authorize_is_open_is_not_confirmed_yet`,
    `a_permission_refusal_with_no_open_operation_stays_permission`,
    `the_wallet_sentences_match_the_client_words_byte_for_byte`.
  - `windows/approval/model.test.ts`: 'what the window says when a step reached PayPal and is not confirmed' (including 'is the
    same bytes as the wallet’s sentence (service.rs REACHED_PAYPAL)', 'recognises it only by its exact text' and 'the second
    answer on capture, countersign and void is headed for the open step, not “Not paid”') and 'the footer notices say plain
    words, never the wallet’s own text' (including 'the lock card, the pairing unlock notice and the pairing refusal never carry
    the wallet’s message or the word cancel').
  - `windows/approval/notices.test.ts`: 'the approval window’s notices never show the wallet’s own text' ('every token notice
    carries footerNoticeText(token)', 'every unlock notice carries footerNoticeText(unlock)', 'the pairing read notice carries
    a message').
  - Not run for this entry (docs only). The gate results are the reports': r3 records fmt, clippy and `cargo test --workspace`
    at 90e633e and client tsc plus vitest 1065 of 1065 from the dispatcher's run.

## 40. The console rebuild: one window, one theme, the approval window stays separate

- **Date:** 2026-10-14 (the calm-nested-ui decisions: 2026-10-13, recorded here for the first time)
- **Decided by:** the owner, through two spark rounds (`.spark/Spark/ideas/calm-nested-ui.md`,
  `.spark/Spark/ideas/table-console-rebuild.md`, waves 1 and 2, eight questions), and the Director on
  convention points the owner was not asked (marked below). Built in packages WP0 to WP4c on branch
  `worktree-spark-table-console-rebuild` (commits 9037a89 to 3857b00 and the WP4c working tree; notes
  in `docs/build/rebuild/`).
- **Constraint.** The owner picked contest variant B/2 "Calibre" (the "Seal" console refined with a
  cool instrument theme) as the next main window: "not a simple port, rather rebuilding the app into
  upgraded format in terms of design, code quality, feature performance and resilience" (2026-10-14).
  The round-2 review asked that the UI hold a small and a large business, the centre get most of the
  space, and no dead space. AGENTS.md is unchanged: the LLM never moves money, the `approval` window
  is the only surface that can approve, silence never moves money. Submissions close 2026-11-12.
- **Decision.**
  1. **Set up is an in-app page, and onboarding is hosted by the docked approval window over Main**
     (calm-nested-ui, owner). The Set up page (`#s=setup&step=...`) replaces the Start card and
     Settings' "Getting started"; it shows one step at a time and moves on by the step's own state,
     never by a click. Privileged steps (keys, rules, unlock) hand off with `approval_open`; the
     approval window opens as Main's child, centred over it, when Main is visible. Rejected: an
     embedded webview (authority is keyed on the window label), a final-click-only flow. In the
     rebuild the Set up page is the **Charter** (five lines, I to V) with the same targets.
  2. **Modules are a summary plus nested detail views** (calm-nested-ui, owner): the first view is the
     answer line, the decision and three or four cards; the rest is one level down. Rejected: more
     sheets, tabs.
  3. **Baseline branch.** The uncommitted tree was committed as `baseline/pre-rebuild` (c4bbe5b)
     after its gates passed; the rebuild forks from it and nothing lands on `main` until the merge.
     The owner's answer authorised that one commit only. Rejected: build in the main checkout; the
     owner commits first.
  4. **Replace in place, on a branch.** `windows/main` is rewritten directly inside the rebuild
     branch; the old window stays shippable on `main`. The safety net is branch isolation and the
     2026-11-03 merge-ready date (abandon on 2026-10-30 if at risk), not a runtime flag. Rejected: a
     parallel `windows/console` tree behind a flag; a big bang on `main`.
  5. **Scope.** Main plus the shared kit are rebuilt; the approval window and the Tumbler are
     restyled only (tokens, type, decoration; no layout, authority or copy change).
  6. **IPC is frozen.** No Rust, authority-table, bindings or `PINNED_MANIFEST` change; performance
     comes from the client data layer. Rejected: batched read commands. Known limit: per-deal reads
     at 500+ deals stay many small reads, bounded by visible-only reads, a read budget and coalescing.
  7. **TanStack Query and TanStack Virtual** for the query cache and windowed lists (owner chose "add
     a query library and a virtual-list library"; the Director picked these MIT packages); the unused
     `zustand` is dropped. `Backend` / `CommandContract` and event-driven invalidation stay: events
     only mark reads stale, through one map (`lib/data/invalidation.ts`).
  8. **Bundled fonts.** One open-licensed UI face and one numeric face are bundled with their
     licences (Archivo 2.001 and Sofia Sans 4.101, SIL OFL 1.1, 235 KB), system stacks as fallback.
  9. **The small Dial is kept** as the presence (owner, wave 2): a bead strip beside the seal whose
     beads open their deal. The home is the decision centre, not the Dial. Rejected: retire the Dial.
  10. **One window, one theme, and the approval window stays separate** (Director, convention). Every
      owner place (Rules, Wallet limits, Connections, pairing, Settings, the safety record, Rewind,
      Set up) is a layer of the one main window; the Quit confirm and the shortcuts help stay sheets.
      The approval window stays the separate docked `approval` window (capability, token and label
      gates unchanged); it now reads as a front sheet of the console and follows the stored theme and
      calm choice, live (before: always dark). The console's gold action only calls `approval_open`;
      nothing renders "Approved" without a Rust event.
  11. **Hold is Space only** (Director, keeping the shipped rule): a held Space or pointer for
      1200 ms; Enter never releases money. The WP1a brief's "Space or Enter" was not adopted.
  12. **Latest strips instead of dead bands** (Director): a module summary and a short place end in a
      quiet "Latest" strip, the first rows of the area's most relevant list (3 to 8, as many as fit),
      no gold, plus "See all".
  13. **Nested views are in the URL** (Director, after WP3c asked): places take `&v=<view>`, a deal
      takes **`&dv=<view>`**, because `&v=` after `&m=` already means the module view the deal was
      opened from (every older link). `#d=<id>&v=<view>` with no `&m=` is read as the deal's view.
  14. **A stricter footer figure** (Director, after WP3b asked): the footer's "Paid out today" counts
      only money PayPal collected (no hold, agreed payment, payment being checked, refund or
      unconfirmed one), the same set as the Book's "Today". The day's budget against the limit is
      "Budget used today" in Wallet limits, shown beside it. Rust's `paid_today` / `out_today` are
      unchanged.
- **Consequences.** Every older hash deep link still parses (`#m=`, `#v=`, `#d=`, `#s=`,
  `#p=safety`, tested). Cuts recorded in the package notes: the Circuit picture, the Book's
  statement filter, "Rule numbers" and the deal's "Rules id", the Rewind ticks as keyboard stops.
  The Wallet limits hand-off opens the owner page (no limits target exists). The director's rig
  follows the console (WP4c).
- **Tests that hold it.** `windows/main/console/guard.test.ts` (no release command named under
  `windows/main`; the centre's only mutation is `approval_open`), `console/console.test.tsx`,
  `console/route.test.ts` and `logic.test.ts` (old links, `&v=`, `&dv=`), `console/sheetViews.test.tsx`,
  `console/latest.test.tsx` (strip after the cards, 1 to 8 rows, no gold), `console/areas/book/model.test.ts`
  and `book.test.tsx` (paid today = the Book's set, not `out_today`), `shared/ui/holdGesture.test.tsx`
  and `hold.test.tsx` (Space only, 1200 ms, Enter never completes), `windows/approval/frame.test.tsx`
  (Back to The Table calls no command), `design/tokens.test.ts` and `lib/contrast.test.ts` (fonts,
  licences, AA in both themes), the authority matrices and `windows/approval/notices.test.ts`
  (unchanged).

## 41. The IPC freeze of §40 item 6 is lifted (challenge run challenge-2026-10-15)

- **Date:** 2026-10-15
- **Decided by:** the owner, on the challenge deck of scan-sweep run `challenge-2026-10-15`, answering
  "Lifted - rebuild merged": the console rebuild has merged to `main`, so the freeze that kept it
  shippable no longer has a reason.
- **Decision.** §40 item 6 ("IPC is frozen") no longer binds. Rust, authority-table, bindings and
  `PINNED_MANIFEST` changes are allowed again where a change needs them, through the usual gates
  (the authority matrices, the capabilities pin test, the bindings freshness test). AGENTS.md is
  unchanged: the LLM never moves money, only the `approval` window approves, silence never moves money.
- **What used it (on `main`, 872605e..b7756a5):** event audiences are rows of the authority table and
  every window event goes through one table-driven emit (3710b96, e05aded, 8599423); the tray menu
  (e587136); generated `bindings/dealStates.ts` (5fed587); the `envelope_simulate` command
  (a9dab70); `resume_all_agents` reports the tables waiting on the agent (9e3b14f).
  `PINNED_MANIFEST` moved twice, ed57f9ce to 83ffaf42 (event audiences) and 83ffaf42 to b2f04fe9
  (`envelope_simulate`).
- **Consequences.** §40's "Rejected: batched read commands" stands as a rebuild-time choice, not a
  rule; a batched read may be proposed again on its merits.

## 42. Operator answers of 2026-10-13

- **Date:** 2026-10-13 (recorded 2026-10-16)
- **Decided by:** the operator, on four approval asks. The commits below were checked with `git show`
  and are ancestors of this branch. Where the answer is carried out, the item names the commits;
  where it is not, it says so.

### 1. T7 no-install judge path: "Local preview is enough" (ask cebdf5dd)

- **Constraint:** the plan's T7 goal is a judge path that needs no install. The director
  (`director.html`, "Maya's week") runs on the browser mock, but a judge still has to run `pnpm`
  to see it; a public link would remove that and needs hosting and a decision about the relay.
- **Decision:** T7 counts as met by the README's instructions, `pnpm --dir apps/desktop/client install
  && ... dev` and the static `dist` build served from any folder ("Watch it work without installing
  anything"). That is the narrower measure: no install of the wallet, not no install at all.
- **Lost:** hosting the static build on GitHub Pages; deciding T7 together with the relay ask (ask
  1e8569bf, item 2), which would have tied a hosted preview to the relay deploy.
- **Evidence:** 3671609 (one shared clock and a `MockWorld` on the mock) and 979de41 (repeatable
  takes, stills and a rehearsal check of Maya's week); the director itself is 47732f4. The
  README section is in `README.md`. STATUS's T7 "Left" line (host the static build at a public
  link) is therefore not a T7 requirement.

### 2. Hosted relay scope: "Built in once deployed" (ask 1e8569bf)

- **Constraint:** the HOUSE and the relay are not deployed (milestone 4). Today's build has no relay
  address, so it cannot meet another wallet or the House.
- **Decision:** today's build stays relay-less. After the HOUSE deploy is approved in milestone 4,
  the release build carries the relay address, checked at build time. A bad override starts the
  wallet without a relay. The owner gets a yes/no switch in the approval window. Nothing contacts
  the relay until a pairing or a house deal. craft-5 stays post-submission with T19 (sealed relay).
  Until then the words must say that this copy is not set up to meet other wallets and that the House
  is not available in this copy.
- **Lost:** "Setup only" and "craft-5 first".
- **Done:** the mailbox exhaustion fix, a per-caller create allowance and a HOUSE reserve (0315f21),
  and removal of the relay-named deploy files that would have deployed a second HOUSE (681de8b).
- **Done (words):** 13fe2c0 (a copy with no relay says it is not set up, not Offline).
  `apps/desktop/client/src/lib/words/connections.ts` now says "This copy is not set up to meet other
  wallets, and the House is not available in it", and the retry hint is replaced when the client
  already knows the relay is absent.
- **OPEN:** the build-time relay address, the yes/no switch and the no-contact-until-needed rule;
  they wait for the deploy approval.

### 3. Security P-1: "Cut it to generic patterns" (ask 9e986aef)

- **Constraint:** scan-2026-10-07 finding P-1: a research document (owner-assets) carried Personas
  internals that do not belong in a public repository.
- **Decision:** cut the document to generic patterns.
- **Done at the tip:** 26e6d11 (cut owner-assets to generic patterns, no Personas internals) and
  c73f61b (the scan finding marked fixed).
- **History, 2026-10-30 (D1 = a, owner's decision):** history was rewritten in a mirror clone so
  every past version of `.research/owner-assets.md` carries the generic text; the owner's first name
  was also replaced in docs/concepts/sequencing-2026-10-29.md and one commit message. Every commit
  hash changed; the citations in the Markdown docs were re-pointed in the same pass. The owner ran
  the force-push. GitHub's read-only pull-request refs still reach the old commits until GitHub
  removes them.

### 4. ops-ledger-query economics-9 and value-6: "Fix both now" (ask d8ee6135)

- **Constraint:** the two open highs of §38: an unbounded read slot after a timeout (economics-9) and
  an Ask answer that reaches past the week without saying so (value-6).
- **Decision:** fix both now, not after the submission.
- **Done:** 774d810 (a timed-out read keeps its slot until its invoke settles), d268943 (an answer
  that reaches past the week says so on its slip), dea0554 (the test picks the Ask question by its
  on-screen words) and 6db4ca3 (STATUS). STATUS's entry names fe9df3f, 2513e5d and 1198990; those
  are earlier copies of the same three changes and are not ancestors of this branch.
- **Known problems:** one test from 774d810, the `readEach.test.ts` slot test, was found not to
  terminate; 510ad61 fixed it (the held reads now sit on deferred promises that are settled after the
  bound is asserted). Client `vitest` and `tsc` on `main` still wait on
  the owner installing client dependencies (`@tanstack/react-query` and `@tanstack/react-virtual`
  are missing from `node_modules`), so neither has run against these changes.

## 43. The displays runner keeps one read-slot pool, so a stuck read counts across batches and passes

- **Constraint:** §42 item 4 and 774d810 keep a timed-out read's slot until its invoke settles. The
  slots belonged to one `readEach` call, so a `deal_display` read stuck past its batch, or in an
  aborted pass, was not counted by the next call, and in-flight invokes could pass `READ_CONCURRENCY`.
- **Decision:** `readEach` takes an optional shared `ReadPool`. The displays runner makes one pool and
  passes it to every batch, so `displays.ts` keeps at most `READ_CONCURRENCY` reads in flight across
  batches and passes, and a stuck read counts across them. A pass whose slots are all held ends once
  they settle; a wait for a slot stops when the signal is aborted.
- **Lost:** the per-batch limit, where each call counted only its own reads.
- **Evidence:** 43eb9d1 (`readEach.ts`, `displays.ts`, `readEach.test.ts`), an ancestor of `main`
  (checked with `git merge-base --is-ancestor`). Its tests: a read stuck in one batch stays counted in
  the next; a read stuck in an aborted pass stays counted in the next pass and the pass ends once it
  settles; a pass whose every slot is held ends once they settle; a slot wait stops on abort. Client
  `vitest` and `tsc` were not run (§42 item 4).

## 44. The live sandbox spikes are approved for the owner to run; the loop and builders prepare only

- **Constraint:** the no-live-call-without-operator boundary. No builder or loop run may call PayPal
  (or Channel3 or a model) or handle a credential without an operator ask, and spikes 1-5, 7 and 8
  are live calls under the owner's own sandbox accounts, keys and browser sessions.
- **Decision (operator, 2026-10-16):** spikes 1, 2, 3, 4, 5, 7 and 8 of `SPIKES.md` are approved to run,
  but only by the owner, with his own sandbox credentials, when he chooses. The loop and builders
  prepare only: they never call PayPal and never touch credentials. A later run records
  `SPIKE-RESULTS.md` and STATUS.md from the owner's output. Spike 6 (version only) already ran. The
  prepared script is `docs/build/SPIKE-RUNBOOK.md`; `scripts/spike.ps1` and `SPIKES.md` are unchanged.
- **Lost:** the loop running the spikes itself. It would put sandbox keys, the buyer's browser
  approval and the Channel3 key inside an unattended run, which the boundary forbids, and some
  steps (a second buyer account approving in a browser, reading an inbox) a loop cannot do.
- **Evidence:** docs only. No spike ran, no PayPal, Channel3 or model call was made, and no
  credential or `.env` file was read. The invariants are unchanged: a spike is a standalone
  conformance test that creates no wallet receipt and grants no UI authority (`SPIKES.md`).

## 45. The rescue read-back failure count stays in memory; the cap holds after a restart

- **Constraint:** the count of failed read-backs of a lost invoice step is kept in memory per request id
  (`rescue_read_backoff`, a `BTreeMap<String, (u32, Timestamp)>` on the pipeline), so it resets to zero
  when the app restarts.
- **Decision (operator's delegate, 2026-10-16 18:50Z):** accept this as a known limit for the submission.
  The cap still holds after a restart: at most `RESCUE_READ_ATTEMPTS` (8) failed reads happen per process
  lifetime before the step is parked, and the parking itself is persisted. `park` records an
  `Outcome::NeedsOwner` audit row in the ledger, and `rescue_resolve` skips an `op.needs_owner` step
  unless an owner ticket is given. So the ledger schema does not change now.
- **Lost:** persisting the attempt count in the ledger, which needs a schema change. Deferred until after
  submission.
- **Existing behaviour that stays:** a parked lost SEND (`invoice-send`) is read once an hour
  (`PARKED_READ_SECS`, 3600 s) after its window ends, that is, once the fix's deadline has passed or
  `REQUEST_ID_KEPT_SECS` (6 h) has passed since the step started, so a draft closes not done. The throttle
  (`parked_read`) is also in memory, so a restart reads once at once. This is not changed here.
- **Why the rework:** the full council run 135d9078 gave economics 0.10. Commit 5f95b64 answered it: a
  failed read-back waits a capped exponential backoff (`RESCUE_READ_BACKOFF_SECS` 5 s doubling to
  `RESCUE_READ_BACKOFF_CAP_SECS` 15 min, with jitter), and a sent invoice is polled on the decaying
  `RESCUE_POLL_STEPS` cadence instead of every `RESCUE_POLL_SECS` (60 s) for 30 days.
- **Evidence:** read-only check on 2026-10-16 of the constants and functions above. They are in
  `crates/table-app/src/rescue.rs` (`RESCUE_READ_ATTEMPTS`, `RESCUE_READ_BACKOFF_SECS`,
  `RESCUE_READ_BACKOFF_CAP_SECS`, `RESCUE_POLL_STEPS`, `RESCUE_POLL_SECS`, `read_failed`,
  `rescue_resolve`), `crates/table-app/src/pipeline.rs` (`rescue_read_backoff`, `parked_read`) and
  `crates/table-app/src/pipeline/resolve.rs` (`park`, `PARKED_READ_SECS`, `REQUEST_ID_KEPT_SECS`). Not
  `crates/table-core/src/rescue.rs`, which only has the `RESCUE_WATCH_*` constants; none of them are
  `RESCUE_READ_ATTEMPTS`. Run 135d9078 was not found in the repo, so the 0.10 is cited from the brief.
  Docs only: no code, test or gate run changed.

## 46. A settled deal is polled for a 72-hour recovery window on a decaying cadence, then retired from the relay scan

- **Date:** 2026-10-16 (signed-haggle full council r1, economics 0.10)
- **Decided by:** Athena as operator delegate 2026-10-16
- **Constraint:** section 6 kept a Receipted route polled so a relay restart is noticed and both
  wallets resend the signed history. With nothing owed it was polled at about 1 Hz and its mailbox
  re-created on every 24-hour expiry, for ever: an unbounded leak per settled deal. Section 6's
  recovery on a restart must stay for as long as it can matter.
- **Decision:** this AMENDS section 6; it does not void it. A Receipted deal with nothing owed stays in
  the relay scan for `RECOVERY_WINDOW_SECS` (72 h) after settlement. Inside the window it is polled
  on a decaying cadence: after a poll made `a` seconds after settlement the wait is
  `clamp(a, RECOVERY_POLL_BASE_SECS = 5, RECOVERY_POLL_CEILING_SECS = 3600)`, so polls fall at 0, 5, 10,
  20, 40 s and so on, doubling to one an hour (about 80 polls in the window instead of about 259,000).
  After the window `relay_work_at` no longer returns the route, so the runtime never creates,
  re-creates or polls its mailbox again. A generation reset inside the window still re-lists the
  signed history as owed, and an owed envelope bypasses the cadence, so the resend is exactly as
  before. A route that owes an envelope (a WITHDRAW, a RECEIPT) is delivered whatever the window.
  Settlement time is the `at` of the deal's first `deal.transition` audit row to RECEIPTED; no
  migration. A Receipted deal with no such row cannot be aged and is retired.
- **Why 72 h:** it is the buyer's corroboration window (section 28), the span in which a Receipted deal
  can still change state and a counterparty can still ask for the history; the 24-hour mailbox expiry
  is inside it three times over, so a restart or an expiry is noticed at least twice. The 1-hour
  ceiling is far below the 24-hour expiry.
- **Lost:** polling for ever (the leak), and retiring at settlement (a restart right after a receipt
  could never be recovered). After the window recovery is lost by design.
- **Consequences:** `Ledger::relay_work_at(now)` takes the time; `relay_work()` is kept and reads the
  system clock (the hosted HOUSE in `services/` still calls it, so it gets the window but not the
  decaying cadence until that service adopts `SettledPollClock`). The last-poll time per settled route is
  in memory (`SettledPollClock`), so a restart polls each settled route once at once. The 64-route
  cap, pre-capture routes and the pairing mailbox are unchanged.
- **Evidence:** `crates/table-ledger/src/relay.rs` and tests in `crates/table-ledger/src/tests.rs`
  (`settled_route_is_polled_on_a_decaying_cadence_then_retired`,
  `relay_generation_reset_inside_the_window_resends_the_history`,
  `receipted_route_that_owes_envelopes_is_delivered_after_the_window`,
  `receipted_route_is_polled_in_the_recovery_window_and_delivers_what_it_owes`); the runtime uses it
  in `crates/table-runtime/src/relay.rs`. Fake-clock tests, no network, no PayPal call.

## 47. Owner-to-owner pairing commits the initiator's identity before the joiner's key is seen

- **Date:** 2026-10-16 (signed-haggle council must-address; relay scan finding S-1)
- **Decided by:** Athena as operator delegate 2026-10-16
- **Constraint:** the council line, verbatim: "craft: The four-word check has no commitment step and
  only 24 bits, so it stops a relay that lacks the code but not one that has it". The words were
  the first 24 bits of SHA-256(buyer key || seller key || code), and the initiator published its full
  signed bundle first. A relay that also held the code could answer each owner with its own key and,
  once the joiner's reply fixed one side's words, grind the other key (about 2^24 tries, minutes on
  one core) until both owners read the same four words. The shape of `PairingIdentity` and
  `SignedPairingIdentity` could not change (the hosted HOUSE builds one as a struct literal), and
  HOUSE pairing, pinned by release identity, had to behave exactly as before.
- **Decision:** commit-then-reveal for the initiator, as in ZRTP and Bluetooth numeric comparison:
  1. The initiator publishes only a `PairingCommit`: `commit = SHA-256("table-pairing-commit-v1" ||
     canonical signed bundle || 32-byte nonce)`, with the code hash, side and expiry in the clear so
     the joiner can answer. The nonce comes from the CSPRNG and stays in the runtime.
  2. The joiner answers with its full signed bundle, `in_reply_to = commit`, and holds it as a join
     awaiting a reveal. It has no words.
  3. The initiator takes the reply (words for it as before), then publishes a `PairingReveal`
     (bundle and nonce). The runtime gives the reveal out only once a reply to that code is held.
  4. The joiner computes and shows the words only when the reveal opens the commit: the same hash,
     a bundle whose signatures verify, and the code hash, side and expiry the commit showed. A reveal
     that does not open it (another bundle, another nonce, or one beside the honest reveal) ends the
     pairing with the existing permission error; nothing is held, so nothing can be confirmed or
     pinned. With no reveal yet, the join answers "Pairing offer is not available yet" (it waits up
     to 8 s for the initiator's 3 s poll first) and a retry picks the reveal up.
  `PairingCommit` and `PairingReveal` are new types beside the unchanged identity types, on a
  `header.payload.tag` wire (the tag is a SHA-256 checksum, the three-part shape the relay already
  carries; the header's `typ` keeps them from parsing as a bundle or an envelope). A HOUSE offer has
  no commit and pairs by release identity exactly as before.
- **Why:** the relay must now fix the key it shows the joiner (M1) before it sees the joiner's key,
  and the key it shows the initiator (M2) before the initiator's key is revealed. Each attempt then
  matches with probability 2^-24, and a failed one shows up as differing words the owners abort on,
  instead of being searched for offline. It changes the "has the code" case in kind, for one extra
  relay round trip.
- **Lost:** six words at 36 bits: only raises the grind to about 2^36 (hours on a small cluster); it is
  still a search after the fact, not a commitment, and costs every owner two more words to read.
  No change: honest in the threat model, but the UI presents the four words as the check against a
  relay in the middle, and with a leaked code they would add nothing. A joiner taking a bare
  initiator bundle handed over offline (the `peer` field of `pairing_join`) is gone for the joiner;
  only the initiator still takes a reply that way.
- **Consequences:** the joiner's words arrive one initiator poll later (about 3 s). The client's join
  is one-shot, so a joiner whose initiator does not poll within the 8 s wait sees "not available yet"
  and joins again; no client change was made. The 64-pairing cap now also counts joins awaiting a
  reveal; expiry, the `in_reply_to` binding and the redacting `Debug` on `PendingPair` are kept, and
  the new held state redacts too. A relay can still drop the reveal (it can always deny service);
  that ends in expiry, never in a pin.
- **Evidence:** `crates/table-proto/src/pairing.rs` (`PairingCommit`, `PairingReveal`; tests
  `a_reveal_opens_its_commit_only_with_the_committed_bundle_and_nonce`,
  `a_relay_holding_the_code_cannot_pick_its_key_after_the_joiners_key`) and
  `crates/table-runtime/src/pairing.rs` (`pairing_answer`, `pairing_reveal_of`, `pairing_revealed`,
  `relay_pairing_join`, `relay_pairing_poll`); tests in
  `crates/table-runtime/src/pairing_runtime_tests.rs`
  (`both_pairing_sides_compute_identical_words_and_exchange_signed_replies`,
  `the_joiner_has_no_words_before_a_reveal_that_opens_the_commit`,
  `a_reveal_that_does_not_open_the_commit_ends_the_pairing_and_pins_nothing`,
  `a_relay_holding_the_code_must_fix_its_key_before_it_sees_the_joiners`) and the relay round trip in
  `crates/table-runtime/src/relay_tests.rs`. `house_tests.rs` passes unchanged. No network, no PayPal
  call.

## 48. Main hands a confirmed pairing to the approval window as a typed `ApprovalDraft::Table`; no new command

- **Date:** 2026-10-16 (signed-haggle full council value line "no screen opens or joins a table after
  pairing"; merged at 5c1143e, commits 6cd6966 and 36ac11f)
- **Decided by:** Athena as operator delegate 2026-10-16
- **Constraint:** after `pairing_confirm`, nothing carried the paired counterparty (and, for the house,
  its practice table) from Main to the approval window's table sheet, so no screen called `deal_create`
  or `deal_join`. Both are APPROVAL / Owner / PRIVILEGED rows (`authority_table.rs`), so only the
  approval window, with its token, may call them. The signed wire format in `table-proto` had to stay
  untouched, and no authority row could loosen: the LLM never moves money, and a draft moves nothing.
- **Decision:** one new variant `ApprovalDraft::Table { counterparty, house: Option<HouseTableDraft> }`
  (`crates/table-client/src/lib.rs`). `open_approval` takes it only from `main` (any draft from another
  window is a permission error) and, in `check_draft` (`crates/table-runtime/src/configuration.rs`),
  only when all of these hold; any other case is `invalid`:
  1. The open is owner configuration: no `target` (an explicit target, or a `pairing` argument that
     implies one, is refused) and no `deal_id`.
  2. `counterparty` is a paired key whose pairing is live now (`counterparty_policy_at(key, now)`
     returns paired and live).
  3. `house` is present exactly when that key is the house (`is_house == house.is_some()`).
  4. For a house draft, the `house.table.<deal_id>` preference Rust kept at `pairing_confirm` exists,
     its `deal_id`, `terms`, `category` and `negotiation_deadline` equal the draft's, and the deadline
     is still in the future.
  `HouseTableDraft` (deal id, terms, category, negotiation deadline) mirrors `table_proto::HouseTable`
  in the client crate instead of reusing it, so `table-proto` is untouched. The draft is never trusted:
  the approval window shows it, the owner picks their own haggle rules, and `deal_join` (buyer, haggle
  only) re-checks the table, terms, category and deadline against the same kept preference
  (`service.rs` `create_deal_id`). Without `house`, the sheet opens a seller table through
  `deal_create`.
- **No new command, no authority-row change:** `deal_create` and `deal_join` keep
  APPROVAL / Owner / PRIVILEGED. The draft only selects what the approval window opens on; nothing is
  signed, sent or paid by opening it.
- **Lost:**
  - *A new open-table command:* it would add an authority row and a second path to the same deal
    creation, and it would need its own copy of the checks `deal_join` and `deal_create` already make.
    STATUS.md ("Open or join a table after pairing") records that the existing two commands suffice.
  - *Reusing `table_proto::HouseTable` in the client crate:* it would couple the client bindings (TS
    types generated from `table-client`) to the signed wire crate, so a client convenience could
    change what is signed. A mirror costs four fields and is re-checked against the kept preference.
  - *Main calling `deal_join` directly:* the row is PRIVILEGED and approval-window only. Letting Main
    call it would move owner-confirmed creation out of the window where the owner picks the rules and
    confirms, and would need an authority row change.
- **Consequences:** the owner-to-owner buyer join stays open. A buyer has no way to learn a paired
  seller's listing (deal ULID, terms, category) before its own deal exists, because relay routes are
  per local deal (`crates/table-ledger/src/relay.rs` `relay_work_at`; the runtime polls only mailboxes
  of deals that already exist), and `relay_tests.rs` passes the seller's deal id to the buyer out of
  band. Closing it needs a read that surfaces a received signed LISTING, which is a new command or
  event and so a new authority row. That gap is with the operator. Only the house join and the seller
  table are reachable from the screens.
- **Evidence:** `crates/table-client/src/lib.rs` (`ApprovalDraft::Table`, `HouseTableDraft`),
  `crates/table-runtime/src/configuration.rs` (`check_draft`), test
  `house_table_draft_carries_only_the_table_rust_kept_at_pairing` in
  `crates/table-runtime/src/house_tests.rs`, `docs/build/STATUS.md` "Open or join a table after
  pairing". Docs only here: no code changed.

## 49. Owner-to-owner join goes through a pasted listing code; no new path

- **Date:** 2026-10-17 (merged at 513229b; commits af7a028 Rust, acd0c63 client, 513229b docs)
- **Decided by:** Athena as operator delegate 2026-10-17
- **Constraint:** a buyer who is another owner has to join the seller's table before the Devpost
  submission, with no new transport path. §48 left this open: a buyer cannot learn a paired seller's
  listing (deal ULID, terms, category) before its own deal exists, because relay mailboxes are polled
  only for deals that already exist locally. A read that surfaces a received LISTING would be a new
  command or event and so a new authority row. The LLM never moves money and silence never moves
  money; nothing here may loosen that.
- **Decision:** a listing code passed out of band, and the existing `deal_join`.
  1. The seller's table sheet shows, once `deal_create` returns, a `TBL1` code:
     `TBL1/<deal id>/<item>/<qty>/<minor>/<CUR>/now/<category>/<crc32>`
     (`windows/approval/listingCode.ts`). The CRC-32 (IEEE, 8 hex digits) covers every field before
     it, so the terms, quantity included. It catches a mistyped or cut-off code; it is not
     authentication and the code is not a secret. Delivery is digital-now only; any other delivery
     does not encode. A malformed, other-version, bad-checksum or unsupported code is refused in the
     buyer's sheet in plain words.
  2. The buyer's sheet decodes it locally, shows the terms, and calls `deal_join` with the seller's
     deal id and those terms (`tableDraft.ts` `codeJoinArgs`). No command and no authority row changed.
  3. For a non-house counterparty the code is not trusted. `Runtime::join_deal` (`service.rs`, called
     from the `deal_join` arm of `dispatcher.rs`) refuses, with the generic invalid error, when:
     - the counterparty is not paired with a live pin (`counterparty_policy_at(key, now)`): never
       seen, seen but words not confirmed, revoked, or expired; and
     - the deal id already exists locally (`get_deal` returns anything but `NotFound`).
     House joins keep the check against the table Rust kept, unchanged.
  4. The buyer deal then waits at `Pairing`. It leaves it only when the seller's signed LISTING
     arrives on the mailbox of that deal id and its item, ask and delivery equal the deal's terms
     (`receive_haggle`, as STATUS.md records). So a wrong ULID means the listing never arrives and
     the deal withdraws at its deadline on silence; altered terms mean the listing is refused. Neither
     reaches `Listed`, AUTHORIZE or PayPal. Money still moves only through the existing AUTHORIZE
     approval.
- **Tests** (`crates/table-runtime/src/listing_code_tests.rs`):
  - `a_matching_listing_code_lists_the_buyer_deal_and_the_haggle_closes`: both transcripts reach
    `Receipted` with the same head; the buyer made no PayPal call.
  - `a_listing_code_with_the_wrong_deal_id_never_hears_the_listing_and_lapses_on_silence`: the
    buyer deal stays `Pairing`, then `Withdrawn` at the deadline; no PayPal call.
  - `a_listing_code_with_altered_terms_is_refused_and_never_reaches_authorize`: an altered ask, item
    and delivery each leave the buyer at `Pairing`; no PayPal call.
  - `deal_join_refuses_an_unpaired_revoked_or_expired_counterparty_and_a_known_deal_id`: a stranger,
    an unconfirmed pin, a revoked pin and an expired pin are refused; a live pin joins once and the
    same deal id then joins no more; a refusal creates nothing.
  The altered-terms test changes ask, item and delivery. Quantity is covered by the code's checksum
  but is not one of the terms that test alters.
- **Lost:** *pair-mailbox ingest* (surfacing a received signed LISTING from a paired seller to the
  buyer with no code). It needs a new read command or event, so a new authority row and a new
  transport path, which this decision rules out before the submission, and it is more than the
  remaining time allows. Recorded as post-submission; it is not built.
- **Known limitation, accepted for the submission:** the mock beat of this join in the browser
  (no-install) path plays only with fixture wallets that have a declared payee, because the mock
  refuses an opening intent whose payee it cannot name. The delegate accepted this; a wallet without
  a declared payee does not get that beat. The real Rust path is not affected.
- **Verification state:** the four Rust tests above ran green in the merge gate (`cargo check` and
  `cargo test`, table-desktop excluded). The client tests, `listingCode.test.ts` and
  `mock/tables.test.ts`, have **not** been run: the worktree had no `node_modules`, so neither `tsc`
  nor `vitest` ran. Treat them as **unverified** until the operator's `npm install` and a run. The
  commit message of acd0c63 and STATUS.md say the same; STATUS.md notes the encode/decode logic was
  only exercised under node.
- **Evidence:** `crates/table-runtime/src/service.rs` (`join_deal`), `dispatcher.rs` (`deal_join`
  arm), `listing_code_tests.rs`; `apps/desktop/client/src/windows/approval/listingCode.ts`,
  `tableDraft.ts`, `mock/backend.ts` (`deal_join`); `docs/build/STATUS.md` "Open or join a table
  after pairing"; `docs/features/approval-window.md`. Docs only here: no code changed.

## 50. Join scan 2026-10-17: what was fixed and what stays known

- **Date:** 2026-10-17 (scan report `docs/security/scan-2026-10-17-join.md`; fixes 57c224b and 3887e78)
- **Decided by:** Athena as operator delegate 2026-10-17
- **Constraint:** the scan of the §49 join path found two things worth fixing now and five to leave.
  The two that touch the signed LISTING wire format, J-3 and J-4, cannot be fixed without changing a
  format the council has already reviewed, and that is not worth doing before the Devpost submission.
  The LLM never moves money and silence never moves money; none of the open items loosens that.
- **Decision:**
  1. **Fixed.** J-1: `join_deal` now applies the live-pin and new-deal-id checks to the house too
     (57c224b), so a revoked or expired house pin and a second join of a house deal id are ordinary
     `Invalid` refusals. J-2: a `deal_join` refused past the authority gate leaves the same bounded
     `command.refused` audit row a gate refusal leaves (3887e78). Each has a Rust test that fails on
     the base.
  2. **J-3, the `qty` missing from `Body::Listing`: open, known, accepted for the submission.** The
     code's quantity is protected only by its CRC. Revisit after submission.
  3. **J-4, the category not in the LISTING: accepted as is.** It only picks among the categories the
     buyer's own per-deal clause allows, and the owner is shown it before joining. Revisited together
     with J-3.
  4. **J-5 and J-7 are Info and post-submission.** J-5: an unknown key is a `LedgerTrust` error, not
     `NotFound`; it is still refused and, since J-2, recorded. J-7: a Rust join refusal shares
     `command.refused` with a gate refusal; a distinct action in `audit_detail.rs` if the trail must
     tell them apart.
  5. **J-6, a pasted code with no length cap.** The fix is one line at the top of `decodeListingCode`:
     refuse a text over 512 characters as `malformed`. It rides with the next client delivery and is
     not built on its own.
- **Lost:** *adding `qty` to `Body::Listing`, setting it in `list()` and comparing it in
  `receive_haggle`.* It closes J-3 and is the recommended fix, but it changes the signed LISTING wire
  format in `table-proto` and `table-app` after the council reviewed it. Recorded as post-submission;
  it is not built.
- **Why J-3 is safe to leave:** a mismatched quantity cannot close. ACCEPT carries the terms hash and
  both sides require it to equal the pending offer and their own terms
  (`table-ledger/src/repositories.rs:1156-1159`). So no money moves, and the deal lapses on silence at
  its Band deadline.
- **Caveat:** until J-3 is closed, the buyer's per-deal, velocity and human-present checks run on the
  code's quantity, not the seller's, so the buyer's owner and agent may negotiate a quantity the
  seller never offered.
- **Evidence:** `docs/security/scan-2026-10-17-join.md`; `crates/table-runtime/src/service.rs`
  (`join_deal`), `dispatcher.rs` (`deal_join` arm), `listing_code_tests.rs`; `crates/table-proto/src/envelope.rs:152-156`;
  `crates/table-app/src/agent.rs:285-295`. Docs only here: no code changed.


## 51. A sent invoice past its deadline is never expired unread; a failing read backs off and is then read hourly

- **Date:** 2026-10-17 (57d1a1a, `crates/table-app/src/rescue.rs`, `rescue_deadline`, the `AwaitingApproval` branch)
- **Decided by:** Athena as operator delegate 2026-10-17
- **Constraint:** once an invoice is sent, its real state at PayPal is unknown until it is read: it may
  already be paid. AGENTS.md forbids silence moving money, so a deadline passing with no answer cannot
  be taken as "unpaid, expire it". An invoice that cannot be read therefore stays open. The old branch
  honoured that but re-read every `RESCUE_POLL_SECS` (60 s) with no limit, so a PayPal outage cost one
  failed call a minute for as long as it lasted (43 200 over the 30-day window).
- **Decision:**
  1. **A failed read backs off.** `deadline_read_failed` records the failure count and the next
     allowed read per `deadline-read:{deal id}`. The wait is `rescue_read_backoff(fails, jitter)`: it
     doubles from `RESCUE_READ_BACKOFF_SECS` (5 s) up to `RESCUE_READ_BACKOFF_CAP_SECS` (15 min), then
     falls anywhere in the upper half of that value, chosen by a jitter seeded per request id. It is
     never shorter than `RESCUE_POLL_SECS` (60 s).
  2. **After `RESCUE_READ_ATTEMPTS` (8) failures in a row the invoice is parked.** It is read once per
     `PARKED_READ_SECS` (3600 s, `pipeline/resolve.rs`) from then on. A read that succeeds clears the
     count, and the invoice resolves as paid or expires as before.
  3. **Nothing else changes.** A failed read never expires, cancels, sends or counts anything; each
     failed read still keeps its PayPal call. With no client the invoice waits, as before.
- **Lost:**
  - *A fixed 60 s re-read with no cap (the old behaviour).* It hammered a PayPal that was already
    failing, one kept failed call a minute with no bound.
  - *Expiring after N failed reads.* It turns "could not read" into "unpaid" and lets silence end the
    deal. If the invoice was in fact paid, the money is taken and the deal is closed as expired. That
    is the case AGENTS.md rules out.
  - *Cancelling the invoice after N failures.* It writes at PayPal on the strength of a state we never
    saw, so a paid invoice could be acted on blind and the deal and PayPal could disagree. It is also
    an action nobody approved.
- **Open:**
  - **No operator-facing signal that an invoice is parked.** The failure count lives only in
    `rescue_read_backoff`, an in-memory map; nothing is audited or shown when the count reaches
    `RESCUE_READ_ATTEMPTS`. The only trace is the kept PayPal call of each failed read. A restart
    forgets the count, and the first read after it is immediate. Surfacing "parked, still unread" to
    the owner is not built.
- **Tests:** `crates/table-app/tests/rescue.rs`:
  `a_failed_read_at_the_deadline_waits_and_retries_on_the_poll_cadence` (the retry never comes
  before `RESCUE_POLL_SECS`; the invoice is not expired),
  `past_the_deadline_a_failing_read_is_bounded_and_the_gaps_grow` (gaps are at least the poll
  cadence and non-decreasing, reads are bounded by `RESCUE_READ_ATTEMPTS` plus one an hour, nothing
  is sent or counted), and
  `after_the_bound_the_deal_is_parked_for_the_owner_and_read_only_hourly` (exactly
  `RESCUE_READ_ATTEMPTS` reads, then none for an hour less a second, then one per hour; still
  `AwaitingApproval`).
- **Evidence:** `crates/table-app/src/rescue.rs` (`RESCUE_READ_*` constants, `rescue_read_backoff`,
  `deadline_read_failed`), `crates/table-app/src/pipeline/resolve.rs:33`. Docs only here: no code
  changed.

### 51a. Amendment (2026-10-17): the automatic reads stop after a fixed total window

- **Decided by:** Athena as operator delegate 2026-10-17, ruling on the full council round 2
  must-address "past-deadline reads of a sent invoice, and of a parked lost send, repeat hourly with
  no ceiling on total duration".
- **Constant:** `PARKED_READ_WINDOW_SECS` = 30 days (`crates/table-app/src/pipeline/resolve.rs`, next
  to `PARKED_READ_SECS`).
- **Decision:** both automatic paths stop once the window has passed: the read of a sent invoice past
  its deadline (`rescue_deadline`), measured from the deal's deadline due time, and the hourly read of
  a parked lost send (`rescue_resolve`), measured from the earlier of the deadline and the request
  id's window ending (`op.started_at` + `REQUEST_ID_KEPT_SECS`), which is what starts those reads. Both
  start times are durable ledger values, never the in-memory park state, so a restart does not reopen
  the window. After it the deal stays parked and needs the owner: nothing is expired, cancelled, sent
  or counted. A lost send is still read when the owner asks, through the existing `OwnerTicket` path
  (`rescue_approve` into `rescue_resolve` and `resolve_invoice`), once per ticket.
- **Why a total window:** one read an hour is cheap, but with no end a deal that is never resolved
  costs 24 PayPal calls a day for ever, and each failed one keeps a call on record. **Why 30 days:** it
  equals `RESCUE_INVOICE_OPEN_SECS`, the span a sent invoice is awaited for payment, so the wallet reads
  past the deadline for as long again as it waited before it; that is 720 hourly reads at most. The
  invoice itself stays readable at PayPal for as long as it exists, and a request id for 6 hours
  (`REQUEST_ID_KEPT_SECS`), so a read after the window loses no evidence, only the wallet's own
  initiative.
- **What the owner loses:** nothing that was reachable before. For a lost send the owner can still ask
  and get a read. For a sent invoice past its deadline there is no owner path today
  (`rescue_approve` refused a deal whose deadline has passed and which has no open step); none was
  added. That deal waits open and unread past the window.
- **The invariant holds:** a sent invoice is never expired unread. Past the window it is not read and
  not expired either; silence still moves no money.
- **Tests:** `crates/table-app/tests/rescue.rs`:
  `a_sent_invoice_is_read_only_inside_the_window_and_a_restart_does_not_reopen_it` and
  `a_parked_lost_send_is_read_only_inside_the_window_and_the_owner_can_still_ask` (fake clock; reads
  hourly inside the window and none after; still non-terminal with no write; a restart past the
  window reads nothing; an owner ticket reads exactly once).

### 51b. Amendment (2026-10-17): the owner's ticket drives one read of a sent invoice past its deadline

- **Decided by:** the operator delegate's answer YES to the builder's question from run a139b7ba (51a
  left such a deal open and unread for good, with no owner path).
- **Decision:** `Pipeline::rescue_approve` (the existing authority row, no new IPC command) no longer
  refuses a Rescue/Seller deal in AWAITING_APPROVAL whose deadline has passed. With a valid
  `OwnerTicket` for that deal it makes exactly one read of the invoice through `rescue_poll`
  (`rescue_owner_read`). That read ignores the wallet's own limits (`PARKED_READ_WINDOW_SECS`, the
  hourly parked cadence, the deadline-read backoff) and records what PayPal reports as an in-window
  read does: the same ledger transition for SENT, PAID or CANCELLED, the same kept call record when it
  fails. A failed read returns `Unavailable`; nothing is parked or expired. The ticket is spent whether
  or not the read succeeds (an in-memory set of deal, minted-at, session generation), so one ticket
  gives one read.
- **Authority:** the ticket is checked by `ApprovalSession::validate` (deal, terms hash, attempt, expiry,
  session generation). That check never looked at the deadline or the window, so `auth.rs` is
  unchanged. This path skips the mandate check and the shield verdict, since nothing is decided and
  nothing moves; create, send, countersign and every money step are unchanged and still refuse past
  the deadline.
- **Moves no money:** the only PayPal call is the GET of the invoice. It never creates, sends, cancels,
  captures, voids or countersigns, and it never expires the deal; the post-read handling is only
  `rescue_poll`'s ledger writes (receipt on PAID, fail on CANCELLED, mismatch on a foreign invoice).
  Without a ticket nothing changed: the wallet's automatic reads still end at the window.
- **Tests:** `crates/table-app/tests/rescue.rs`:
  `an_owner_ticket_reads_a_sent_invoice_past_the_window_and_records_paid`,
  `an_owner_read_that_finds_the_invoice_unpaid_changes_nothing_and_only_reads`,
  `an_owner_read_that_fails_is_unavailable_keeps_its_call_and_leaves_the_deal_open`,
  `one_ticket_gives_one_owner_read`, `a_bad_ticket_reads_nothing_past_the_deadline_or_the_window`; the
  window test `a_sent_invoice_is_read_only_inside_the_window_and_a_restart_does_not_reopen_it` now ends
  with the owner's read.

## 52. A lost authorize whose read-back fails backs off, is then read hourly, and is not read by the wallet after a fixed window

- **Date:** 2026-10-17 (`crates/table-app/src/pipeline/resolve.rs`, `resolve_deal` and
  `resolve_authorize`)
- **Decided by:** Athena as operator delegate 2026-10-17, ruling on the agent-gated-spend full council
  round 2 (run 2c1c2615) must-address "economics: a purchase AUTHORIZE whose read-back keeps failing is
  polled on every 1 s tick, with no total ceiling, past its deadline".
- **Constraint:** an authorize whose answer was lost may have placed a hold at PayPal. Until a read
  shows what PayPal holds, the deal cannot be expired (silence never moves money, and an EXPIRED deal
  would forget a hold). The old `resolve_authorize` sent a failed `get_order` to `defer`, which kept the
  failure and answered `Unavailable`, and the next 1 s tick read again, with no limit. The existing
  bound, `UNREAD_AUTHORIZE_SECS` (72 h, `crates/table-ledger/src/resolution.rs`) with
  `end_unread_authorize`, applies only after a read that succeeded and showed no record a check
  accepts. A read that keeps failing never reaches it, so a PayPal outage cost one failed call a second
  for as long as it lasted.
- **Decision:** the authorize read-back mirrors the rescue path of section 51 and 51a. No second
  schedule is introduced, and every constant is reused:
  1. **A failed read backs off.** `resolve_authorize` passes a failed `get_order` to the rescue path's
     `deadline_read_failed` (now `pub(crate)` in `crates/table-app/src/rescue.rs`), keyed by the
     authorize's request id in the same in-memory `rescue_read_backoff` map. The wait is
     `rescue_read_backoff(fails, jitter_of(seed, request id, fails))`: it doubles from
     `RESCUE_READ_BACKOFF_SECS` (5 s) toward `RESCUE_READ_BACKOFF_CAP_SECS` (15 min) and falls in the
     upper half of that value. It is never shorter than `RESCUE_POLL_SECS` (60 s), the floor. The gaps
     never shrink. `resolve_deal` passes over an authorize whose next read is not yet due, so
     `deadline_default` answers `Unavailable`, as it does for any open authorize. The count applies to
     every automatic read of the authorize, so a failing read before the deadline backs off too.
  2. **After `RESCUE_READ_ATTEMPTS` (8) failures in a row the authorize is parked for reads.** It is
     read once per `PARKED_READ_SECS` (3600 s) from then on. A read that succeeds clears the count. The
     existing logic then runs unchanged: `confirm_authorization`, the untouched/`Absent` deadline
     default, the park, and `end_unread_authorize` past `UNREAD_AUTHORIZE_SECS`. As in section 51, the
     park is in memory only. No resolution row is written for it.
  3. **The wallet's own reads end `PARKED_READ_WINDOW_SECS` (30 days) after the deal's deadline.** The
     window is measured from the deadline's due time in the ledger (`Ledger::deadline`), which is
     durable, and never from in-memory park state, so a restart does not reopen it. Past the window
     `resolve_deal` reads no authorize under `Resolve::Deadline`. The deal stays APPROVED with its step
     open (or parked), it needs the owner, and `deadline_default` keeps answering `Unavailable` without
     calling PayPal. The value is the window of 51a. It allows at most 8 + 720 failed reads per lost
     authorize, against 2.6 million at one a second. A separate value would only be a second limit to
     keep in step.
- **Invariant:** an authorize that was never read is never treated as captured, voided, failed or
  expired. A failed read sends nothing, ends nothing, voids nothing and counts nothing. It keeps only
  its PayPal call record (the `Deferred` resolution `defer` writes). The deal stays APPROVED. Only a read
  that succeeds can move it, and then only through the checks that already existed.
- **Owner read:** when this section was written, **no owner path reached this case**:
  `Pipeline::authorize` and `owner_void` refused a deal with an open operation (`has_open_operation`).
  Amendment 52a adds one: the owner's countersign on such a deal reads the order once per ticket.
- **Lost:**
  - *Reading on every tick (the old behaviour).* It hammered a PayPal that was already failing, one
    call a second, with no bound.
  - *Ending the deal after N failed reads (expire, or `end_unread_authorize`).* That turns "could not
    read" into "no hold". If PayPal did place the hold, the deal is closed while money is held, which
    is the case AGENTS.md rules out.
  - *Voiding after N failures.* No authorization id was ever verified, so there is nothing to void,
    and the void would write at PayPal on a state nobody saw.
  - *A durable failure count.* It would need a ledger column or table for a counter that section 45
    already decided to keep in memory. A restart costs at most 8 quick reads again, while the window
    stays durable.
- **Open:**
  - ~~**No owner path reads a lost authorize.**~~ Closed by 52a: past the window the owner's ticket
    reads it once, through the existing `deal_countersign` command; no new command row was needed.
  - ~~**A lost capture or void was still read on every tick, and a parked one hourly for ever.**~~
    Closed by 52b: the same backoff, hourly park and window apply to them, and the read maps are
    bounded.
  - **The park is not surfaced.** As in section 51, the failure count lives only in
    `rescue_read_backoff`. The money-check card shows a parked authorize only when the step was parked
    by a resolution row (a lost owner authorize, or one that read back a record no check accepts), not
    when the seller's own authorize simply fails to read.
  - **A read that succeeds but shows a record no check accepts is still made on every tick** until
    `UNREAD_AUTHORIZE_SECS` (72 h) after the first attempt, when `end_unread_authorize` ends the deal.
    That case is bounded and unchanged here. The test
    `a_parked_authorize_paypal_never_shows_readably_ends_at_its_bound_and_sends_nothing` pins it.
- **Tests:** `crates/table-app/tests/pipeline.rs`, each run for an authorize parked before the deadline
  and for the seller's own unparked one, against the offline `LossyApi` (no network) on a fake clock:
  - `past_the_deadline_a_failing_authorize_read_backs_off_then_is_read_hourly`: the first read is at the
    deadline. Gaps are at least `RESCUE_POLL_SECS` and never shrink. There are exactly
    `RESCUE_READ_ATTEMPTS` reads, then none for an hour less a second, then one, hourly.
  - `a_failing_authorize_is_read_only_inside_the_window_and_a_restart_does_not_reopen_it`: a restart
    inside the window reads at once (the control). The window's last second reads. Past it there is no
    read even though PayPal would answer, also after a restart, and the step stays open.
  - `a_read_that_succeeds_after_failures_clears_the_count_and_settles_as_before`: after 8 failures and
    the hourly read, a successful read clears the count, a new failure backs off from 60 s rather than
    an hour, and the authorization PayPal holds is confirmed. The deal is AUTHORIZED with the 72 h honor
    period.

  Throughout, every tick leaves the deal APPROVED with only `needs_owner`/`deferred` outcomes, and no
  POST, capture or void is sent or recorded. `deadline_waits_for_an_unsettled_authorize_before_expiring`
  now retries at `due + RESCUE_POLL_SECS` instead of `due + 2`.
- **Evidence:** `crates/table-app/src/pipeline/resolve.rs` (`resolve_deal`: the `window_closed` and
  backoff skip; `resolve_authorize`: the `get_order` branches; doc comments of `resolve_deal`,
  `PARKED_READ_SECS` and `PARKED_READ_WINDOW_SECS`), `crates/table-app/src/rescue.rs`
  (`deadline_read_failed`), and `crates/table-app/src/pipeline.rs` (doc comments of `deadline_default`
  and `rescue_read_backoff`).

### 52a. Amendment (2026-10-17): the owner's countersign drives one read of a lost authorize

- **Decided by:** the operator delegate's answer YES to the builder's question after 52 (52 left a
  lost authorize past the window open and unread, with no owner path), before agent-gated-spend full
  round 3.
- **Authority:** the existing `deal_countersign` row (`APPROVAL`, `Decision`, privileged, selected
  deal), as 51b reused `rescue_approve`. No new IPC command or authority row, so the permissions
  fingerprint, the bindings and `docs/features/ipc-and-authority.md` are unchanged. That command's
  pipeline method, `Pipeline::authorize`, was the one refusing on `has_open_operation`. It now turns
  `Authority::Owner(ticket)` on an APPROVED deal whose authorize is open into
  `owner_read_authorize` (`crates/table-app/src/pipeline/resolve.rs`). Every other authority is
  still refused there, as before.
- **Ticket rule:** the ticket is checked by `ApprovalSession::validate` (deal, terms hash, attempt,
  expiry, session generation; a locked session is refused). It is spent before the read, whether
  the read succeeds or fails, in an in-memory set of deal, minted-at and session generation
  (`Pipeline::authorize_owner_read`), so one ticket gives one read. A refusal before the read spends
  nothing.
- **Which step:** the open authorize of the deal's settled attempt, not a live call (a `pending`
  reservation that is not yet stale is not listed), and not within `SETTLE_SECS` of its start. It
  must also be a step the wallet no longer reads on its own initiative: one parked for the owner, or
  any once the deal's deadline has passed. Before the deadline the wallet still reads an unparked
  authorize itself, so the click is refused with "not confirmed yet", as before.
- **What it records:** one `get_order` GET, then `resolve_authorize`'s existing handling. A hold
  that PayPal shows and the checks accept is confirmed (`confirm_authorization`): the deal is
  AUTHORIZED, with the 72 h honor period counted from the first attempt. An untouched order (APPROVED,
  no authorization) past the deadline is recorded `absent`, as the wallet's read at the deadline
  records it; the deadline's safe default then follows on the wallet's own tick. A record that no
  check accepts is parked (one `needs_owner` row, none if the step is already parked). A failed read
  returns `Unavailable` and keeps only the `deferred` row that `defer` writes. The deal stays
  APPROVED with its step open. A read that succeeds clears the wallet's failure count, exactly as
  its own successful read would. A failed owner read is not counted toward the backoff, so the
  wallet's own schedule (backoff, hourly park, `PARKED_READ_WINDOW_SECS`) is neither reset nor
  extended. Past the window the wallet still reads nothing without a ticket.
- **What it never does:** no POST. It never re-sends the authorize, even where the wallet's own
  `Resolve::Advance` read would (an untouched order before the deadline is parked for the
  deadline's read instead). It never captures, voids, expires, countersigns or ends anything, and it
  never calls `end_unread_authorize`, even past `UNREAD_AUTHORIZE_SECS`. No mandate check or shield
  verdict is run, since nothing is decided and nothing moves.
- **Runtime:** `Runtime::decide` treats a countersign on an APPROVED deal with an open operation as
  this read. It is still bound to the checklist hash the owner saw, and it is recorded as the
  `deal_countersign` decision row. A failing line does not refuse it, though. The likely case is a
  mandate that expired during the 30-day window, which would otherwise block the read for good.
  The read also selects no agent key, since it signs nothing. Whatever the runtime lets through,
  `Pipeline::authorize` cannot send on a deal with an open operation.
- **Open:** a deal whose shield verdict is BLOCK, or which is in MISMATCH, is refused by
  `decide` before the pipeline, as for every decision. A lost authorize on such a deal still has no
  owner read. **No client change was made** (out of this change's scope). The approval window's
  countersign button (`apps/desktop/client/src/windows/approval/gating.ts`, `deriveGates`) is labelled
  as a money approval and is disabled when a checklist line fails or `can_release` is false. Rust
  accepts the click on such a deal, but the shipped window may not offer it. A plain "ask PayPal
  again" control, and its own sentence for a failed read (today the generic unavailable answer),
  are a client change left for the operator.
- **Tests:** `crates/table-app/tests/pipeline.rs`, each for an authorize parked before the deadline
  and for the seller's own unparked one, offline (`LossyApi`) on a fake clock, asserting on the
  fake's call log that no POST, capture or void is sent and none is recorded:
  `an_owner_ticket_reads_a_lost_authorize_past_the_window_and_confirms_the_hold`,
  `an_owner_read_that_finds_no_hold_records_what_the_wallet_would_and_ends_nothing`,
  `an_owner_read_of_an_authorize_that_fails_is_unavailable_and_leaves_the_deal_open`,
  `a_failed_owner_read_leaves_the_wallets_own_read_schedule_as_it_was`,
  `one_owner_ticket_gives_one_read_of_a_lost_authorize`,
  `a_bad_owner_ticket_reads_no_lost_authorize` and
  `before_the_deadline_the_owner_reads_only_a_parked_authorize`. In
  `crates/table-runtime/src/reached_paypal_tests.rs`,
  `a_countersign_on_a_lost_authorize_is_the_owners_one_read_and_only_in_the_window` tests the
  gate end to end through `execute`: refused locked, outside the approval window and without the
  token, then one read past the window with the mandate expired. The existing
  `a_second_countersign_while_the_authorize_is_open_is_not_confirmed_yet` is unchanged: a click
  within `SETTLE_SECS` reads nothing.

### 52b. Amendment (2026-10-17): a lost capture or void is read back on the same bounded schedule, and the read maps are bounded

- **Decided by:** the operator's delegate after agent-gated-spend full r3 (run 4ff3c2b0), which was
  full-ready at 0.56 with economics at 0.10. The delegate directed one rework with no further council
  round, on three must-address items: (1) a lost capture or void whose read-back keeps failing is
  re-read every 1 s, with no backoff and no ceiling past the deadline; (2) a parked capture or void
  past its deadline is read hourly with no total ceiling; (3) the in-memory maps never evict.
- **Constraint:** a capture or void whose answer was lost may have moved money at PayPal. Until a read
  shows the authorization, the wallet cannot tell a captured hold from a voided or untouched one, so
  silence cannot settle it (AGENTS.md: silence never moves money, and a safe default only voids). Before
  this change `resolve_payment` sent a failed `get_authorization` to `defer`, which kept the failure and
  answered `Unavailable`, and the next 1 s tick read again with no limit, before and after the deadline.
  A parked capture or void past its deadline was throttled to once per `PARKED_READ_SECS`, but with no
  end. `rescue_polled`, `parked_read` and `rescue_read_backoff` gained an entry per deal or request id
  and lost none.
- **Decision:**
  1. **The section 52 pattern, applied to capture and void, with the same helpers and constants.** No
     second schedule and no new timing constant. `resolve_payment` passes a failed `get_authorization`
     to `deadline_read_failed`, keyed by the op's request id in the same `rescue_read_backoff` map. The
     wait is `rescue_read_backoff(fails, jitter_of(seed, request id, fails))`, never shorter than
     `RESCUE_POLL_SECS` (60 s), and once per `PARKED_READ_SECS` (3600 s) after `RESCUE_READ_ATTEMPTS` (8)
     failures in a row. A read that succeeds clears the count. A capture PayPal shows CAPTURED is read
     once more through the order (`confirm_capture`). That read's failure is counted the same way and
     its success clears the count, so a failing order read cannot reset the backoff on every tick. The
     count applies to every automatic read, so a failing read before the deadline (`Resolve::Advance`)
     backs off too.
  2. **One gate in `resolve_deal` for authorize, capture and void** (`money_read_due`). A step whose
     backoff is not yet due is passed over, as an authorize was under section 52. A parked capture or
     void is also still held to `parked_read`'s hourly read.
  3. **The wallet's own reads end `PARKED_READ_WINDOW_SECS` (30 days) after the deal's deadline**,
     measured from `Ledger::deadline`, which is durable, and never from in-memory state, so a restart
     does not reopen the window. This closes item (2): a parked capture or void past its deadline is not
     read once the window has passed. The window check no longer also requires `Resolve::Deadline`. Past
     the window no automatic read is made in either mode. The scheduler only resolves in `Advance` before
     the deadline, so this changes nothing an authorize did under section 52.
  4. **Bounded maps** (`crates/table-app/src/pipeline/read_state.rs`). `prune_read_state` runs after
     `resolve_deal`, `deadline_default` and `rescue_tick`. All of a deal's entries are dropped once the
     deal is terminal. A step's entry is dropped once the step is no longer open. A sent invoice's
     `deadline-read:{deal id}` entry and its `rescue_polled` entry are dropped once the deal no longer
     awaits payment. An authorize, capture or void entry, and the deadline-read entry, are dropped once
     the deal is past its read window. Each map also has a hard cap, `READ_STATE_CAP` (4096 entries),
     enforced on insert (`note_parked_read`, `note_rescue_polled`, `note_read_backoff`), which drops the
     entry with the oldest time. The spent owner-ticket sets (`rescue_owner_read`,
     `authorize_owner_read`) drop an entry once its ticket can no longer validate (`TICKET_SECS`, 60 s,
     the lifetime `ApprovalSession::ticket` already gave) and drop a terminal deal's entries. Those sets
     therefore hold only the tickets minted in the last minute.
  5. **Eviction never brings a read forward.** The first three drops above remove entries that no
     longer govern any automatic read: the deal is terminal, the step is closed, or the durable window is
     shut. After a drop by the cap, every read whose schedule entry is missing waits until
     `RESCUE_POLL_SECS` after the drop (`read_floor_until`). The durable window still applies, and a new
     failure counts again from one, with the floor under it. A step whose entry was evicted while its
     deal is still open therefore falls back to the window and the 60 s floor, never to a 1 s tick. This
     is stated in the doc comments of `rescue_read_backoff` and of `read_state.rs`.
- **Invariant:** a capture or void that was never read is never treated as settled, captured, voided,
  failed or expired. A failed read sends nothing, voids nothing, captures nothing, ends nothing and
  counts nothing beyond its existing `Deferred` call record. Past the window the deal keeps its state
  (AUTHORIZED) with its step open or parked, and it needs the owner. The deadline default answers
  `Unavailable` (or `Ok(false)` when only a parked capture or void is open, as before) without calling
  PayPal. The safe-default void at the deadline of a step that was read and shows CREATED is unchanged.
  So is the once-more send of a lost void PayPal shows still held.
- **Lost:**
  - *Reading on every tick (the old behaviour).* It cost one failed call a second per lost capture or
    void for as long as PayPal failed, and one an hour for ever once parked.
  - *Voiding or ending the deal after N failed reads.* A capture that went through would then be voided
    blind or forgotten behind an end state. That is the case AGENTS.md rules out.
  - *A durable failure count or eviction log.* Either would need a ledger column or table, which section
    45 and this brief rule out. A restart costs at most 8 quick reads again, and the window stays durable.
  - *A per-key floor after a cap drop.* Without a durable per-key time, the floor is one timestamp for
    all keys. While the cap keeps dropping entries, reads with no entry are delayed, never hastened.
- **Open:**
  - **Over the cap, reads are fair only coarsely.** With more failing deals than `READ_STATE_CAP`, a deal
    whose entry keeps being dropped can wait behind the floor for long stretches. It is never read
    sooner, and since a read moves no money, the cost is only a later answer. 4096 open failing steps is
    far above what one wallet holds.
  - **A read that succeeds but cannot settle is still made on every tick**: a capture PayPal shows
    CAPTURED while the deal has no agent key (`signer_missing`), or one PayPal shows CREATED while a
    clause-6 re-send is held (`holds_resend`). These reads succeed, so they are not counted. They are
    bounded by the key coming back or the pause lifting, and they are unchanged here, as section 52 left
    the authorize case.
  - **No owner read of a lost capture or void.** `owner_void` still refuses a deal with an open
    operation. Past the window such a deal waits AUTHORIZED for the owner, who looks at the payment in
    PayPal; the money-check card shows a parked step. Adding an owner read like 52a's is not built.
  - **The runtime scheduler's `last_poll` map** (`crates/table-runtime/src/scheduler.rs`, one entry per
    polled deal) is outside this change's paths and is not bounded here.
  - Section 52's Open list is unchanged. The park is still not surfaced, and a capture or void parked
    only by the in-memory count has no resolution row either.
- **Tests:** offline against `LossyApi` (no network) on a fake clock. Each pins on the fake's call log
  that no POST, capture or void is sent or recorded on a failed read, and that the deal stays AUTHORIZED.
  Each runs for the seller's own capture, an owner capture parked before the deadline, the deadline's
  safe-default void, and an owner void parked before the deadline. In `crates/table-app/tests/pipeline.rs`:
  - `past_the_deadline_a_failing_capture_or_void_read_backs_off_then_is_read_hourly`: gaps are at least
    `RESCUE_POLL_SECS` and never shrink. An unparked step gets exactly `RESCUE_READ_ATTEMPTS` reads, then
    none for an hour less a second, then one, hourly. A parked one is read hourly from the deadline.
  - `before_the_deadline_a_failing_capture_read_backs_off_too`: under `Resolve::Advance`, exactly
    `RESCUE_READ_ATTEMPTS` reads in the first hour, and the capture is not sent again.
  - `a_failing_capture_or_void_is_read_only_inside_the_window_and_a_restart_does_not_reopen_it`: a
    restart inside the window reads at once (the control), and the window's last second reads. Past it
    there is no read even though PayPal would answer, also after a restart. The step stays open, and its
    schedule entries are gone.
  - `a_capture_or_void_read_that_succeeds_after_failures_clears_the_count_and_settles_as_before`: after
    the failures, a successful read clears the count, and a new failure backs off from 60 s, not an hour.
    The seller's capture is then confirmed RECEIPTED with no void. A parked capture still held is
    recorded absent and AUTO_VOIDED on the safe default. The lost safe-default void goes once more and
    the deal is AUTO_VOIDED. The parked owner void goes once more and the deal is VOIDED. One request id
    per operation throughout.
  - `a_settled_capture_or_void_leaves_no_read_state`: a deal that ends, or whose step closes, holds no
    entry.

  In `crates/table-app/tests/rescue.rs`:
  - `the_read_schedule_holds_its_cap_and_a_dropped_deal_is_not_read_sooner`: six sent invoices failing
    past their deadline with the cap at three. Every map stays at most three, and every deal's reads stay
    at least `RESCUE_POLL_SECS` apart. With the floor disabled, a dropped deal was read every second and
    this test failed. Nothing is expired, sent or written.
  - `a_rescue_deal_that_settles_leaves_no_read_state`: RECEIPTED and EXPIRED deals hold no entry.

  `failed_read_back_at_the_deadline_skips_the_void_and_retries_next_tick` now retries at
  `due + RESCUE_POLL_SECS` instead of `due + 2`, as section 52 did for the authorize test. Every other
  section 51, 52 and rescue test is unchanged. Before the commit, removing the `deadline_read_failed`
  call and the window check made four of the new pipeline tests fail.
- **Evidence:** `crates/table-app/src/pipeline/resolve.rs` (`resolve_deal`, `money_read_due`,
  `resolve_payment`, `confirm_capture`, doc comments of `PARKED_READ_SECS` and
  `PARKED_READ_WINDOW_SECS`), `crates/table-app/src/pipeline/read_state.rs` (`READ_STATE_CAP`,
  `prune_read_state`, `note_*`, `read_floor_holds`), `crates/table-app/src/pipeline.rs` (the map fields'
  doc comments, `deadline_default`), `crates/table-app/src/rescue.rs` (`rescue_tick`,
  `deadline_read_failed`, the floor in `rescue_deadline` and `rescue_resolve`) and
  `crates/table-app/src/auth.rs` (`TICKET_SECS`). Gates: `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test --workspace` were green.
- **Erratum (2026-10-17):** decision 5's "never sooner than its schedule" is, precisely, "never sooner than `RESCUE_POLL_SECS` after the drop, never past the window" (scan O-1, `docs/security/scan-2026-10-17-owner-read.md`).


## 53. Join scan items J-3, J-5 and J-6 closed after the submission freeze was lifted for them

- **Date:** 2026-10-18 (a scan-sweep round; commits `155d63c` J-6, `cdaa9ce` J-5, `a590b9a` J-3)
- **Decided by:** the round's brief (the operator's orchestrator), which asked for the open join-scan items to be closed where a test could prove each. Section 50 had deferred J-3 and J-6 past the submission; this supersedes it for those two and for J-5. Revert `a590b9a` alone to restore section 50's decision on J-3.
- **Decision:**
  1. **J-6.** `decodeListingCode` refuses a trimmed paste over 512 characters as `malformed` before any pattern runs. The longest real code is about 210 characters. It was also a freeze, not only an input-size nit: the separator pattern `\s*\/\s*` backtracks once per character of a whitespace run, and 20,000 spaces took 8.3 s in the approval window (50,000 took 49 s).
  2. **J-5.** `counterparty_policy`, `counterparty_first_seen`, `settled_attempt` and `pending_offer` answer `NotFound` for an absent row, as every sibling read already did. An unknown key in a join is `NOT_FOUND` to the owner; an accept with no offer is an `InvalidRequest` to an agent, not `Unavailable`.
  3. **J-3.** `Body::Listing` gains `qty: Option<u32>`, omitted from the wire when `None`. `list()` signs `Some(qty)`; `receive_haggle` refuses a listing whose `qty` differs from the buyer's deal. The wire change is one-way compatible: a new buyer accepts an old LISTING (no `qty` key, nothing bound, as before); an old buyer rejects a new one (`deny_unknown_fields`). Deploy the hosted house and the wallets from the same build: a new wallet joins an old house, an old wallet cannot join a new house.
- **Still open:** J-4 (category not in the LISTING, accepted) and J-7 (a distinct `join.refused` audit action; a product call, and the only caller of the shared 60-a-minute cap is the owner's own window).
- **Evidence:** `crates/table-runtime/src/listing_code_tests.rs` (`a_listing_code_with_altered_terms_is_refused_and_never_reaches_authorize` now has a quantity case; red with the compare removed), `crates/table-proto/tests/protocol.rs` (`a_signed_listing_carries_its_quantity_and_one_from_before_the_field_still_verifies`), `crates/table-ledger/src/tests.rs` (`reads_of_an_absent_counterparty_deal_or_offer_say_not_found`), `apps/desktop/client/src/windows/approval/listingCode.test.ts`.
- **2026-10-21 (delta scan D-3):** a new buyer now refuses a LISTING without `qty` (`6ac02ad`, follows J-3; confirmed by the operator 2026-10-21). Item 3's "a new buyer accepts an old LISTING" describes the build before it; the wire format is unchanged, so an old LISTING still parses and verifies, and only `receive_haggle` refuses it. Evidence: `crates/table-app/tests/listing_qty.rs`. Reverting that commit alone would restore item 3.

## 54. The system clock stays a local seven-line impl in each service

- **Decision (operator, 2026-10-21):** the three identical `SystemClock` impls of `table-core`'s `Clock` trait stay
  where they are. `table-core` is pure (time is supplied by callers), the hosted services do not depend on
  `table-runtime`, and `table-relay` is a transport; a crate for seven lines, or one service exporting its clock to
  another, would bend the layering more than the duplication costs.
- **Evidence:** the wave-3 belay lane that moved the clock into `table-core` was rejected on review for breaking
  `table-core`'s purity (`.belay/runs/paypal/3.review.md` in afterlife).
