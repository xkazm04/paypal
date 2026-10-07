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
- **Evidence:** decided, not built yet. Commits 2ab2b4d (C-8) and 5f1e5e0 (C-5); the STATUS
  "Security fixes" section.

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
- **Evidence:** decided, not built yet; the attention-escalation rework carries it.
