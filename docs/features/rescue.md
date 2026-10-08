# Rescue (failed renewals)

Rescue is for the owner's own subscriptions: when a subscriber's renewal payment fails, the wallet
suggests one fix for that one subscriber, inside rules the owner signed, and asks the owner. The
only fix built today is a one-time discount on the missed cycle, sent as one PayPal invoice. Doing
nothing is always safe: PayPal retries the payment by itself, and nothing is sent without the
owner. Money counts as "recovered" only when PayPal shows the invoice paid for a renewal PayPal
itself reported failed. Maya uses this page to keep a struggling subscriber without changing the
plan price for everyone.

## What the owner sees

**Main window, Rescue page** (`apps/desktop/client/src/windows/main/modules/rescue.tsx`):

- Header "Rescue" with "Failed renewals · pick one fix for one subscriber, or do nothing", then a
  first-visit explainer: "A renewal failed", "Pick one fix", "Doing nothing is safe".
- A money strip (`modules/rescue/Panels.tsx`): at risk (the missed cycle, `atRiskOf()`), in
  progress, and recovered ("really paid only · replays never count").
- One decision card per failed renewal (state "Renewal failed"). "Do nothing: nothing is sent.
  The default." is picked at the start; beside it the discount card shows the wallet's offer (for
  example "20% off: $9.60 instead of $12.00") and the real invoice wording ("What the subscriber
  sees"). One gold "Review discount ↗" (or "Review & approve ↗") opens the approval window, "the
  only place a fix can be approved"; nothing is sent yet. Fixes switched off by the rules fold
  into one line with a Why? ("Not offered for this renewal: …"). "Pause for a while", "Retry later"
  and "Smaller plan" read "Not available yet".
- "Never a price change for everyone": "Changing the plan price would change it for every
  subscriber, not just the one who is struggling. No fix, agent or approval can do that from here,
  by design."
- "Fixes in progress" ("Sending invoice", "Waiting for subscriber", "Fix failed") and "Recovered
  money", each line marked Counts / Doesn't count with the reason (`RESCUE_COUNTED`,
  `RESCUE_REPLAY_NOT_COUNTED`, `RESCUE_SENT_NOT_COUNTED` in `lib/words.ts`). A source chip says
  "Reported by PayPal" or "Replayed failure".
- "Watching N subscriptions" with "N of 100 checks today" and "Manage ↗" / "Watch a
  subscription ↗", and "Replay a renewal ↗"; both open the approval window.
- **Detailed** view: the lever matrix with the Inspector following the focused cell.

**Approval window**:

- The rescue review: diff rows (fix vs rule, invoice vs signed amount, recipient, rules line,
  source), a strip Checking → Ready → Invoice sent → Subscriber paid, and one gold hold-to-confirm
  button to approve the discount. Before holding, `RESCUE_APPROVE_DOES` says what happens: "PayPal
  makes one invoice for this cycle at the discounted price and emails it to your subscriber.
  Nothing is charged: they pay it on PayPal's page, or it expires."
- The replay sheet (`windows/approval/owner/RescueReplay.tsx`): "PayPal can't make a test renewal
  fail, so you can replay one…"; the failure is marked as a replay and never counted.
- The watch sheet (`windows/approval/owner/RescueWatch.tsx`): the watch list with state chips
  (not checked yet, renewals paid, fix suggested, failed · no fix, can't check now) and Stop
  watching; a form for the subscription, the subscriber's email the owner enters, and the plan.
- The rules editor shows "Most off one missed renewal" (amount slider and percent box) once the
  rescue role is allowed.

**Book**: failing renewals appear under "Needs attention" with the amount at risk, and
`recovered_sum` reads the same counted predicate.

## How it works

1. **Rules.** Rescue needs rules of their own: the rescue role, the subscribers counterparty rule
   (`CpRule::Subscribers`, never a paired wallet) and the fixes clause, clause 8
   (`Clause::Lever { levers, max_discount_bp, max_discount }`, `crates/table-core/src/mandate.rs`).
   A discount is at most the lower of the percent and the money cap. Without such rules, replay
   and watch-add answer "Sign rules for fixing failed renewals first." and write nothing.
2. **A failure arrives**, two ways:
   - **Watched subscription** (`Pipeline::rescue_watch_read`, `crates/table-app/src/rescue.rs`;
     run by `tick_rescue_watch`, `crates/table-runtime/src/rescue.rs`). The rules and agent key are
     checked first, then the read is reserved against the day's budget with one
     `rescue.watch_read` audit row, then one GET of the subscription. `watch_verdict`
     (`crates/table-core/src/rescue.rs`) opens a fix only for exactly one failed payment with an
     amount owed on a live subscription, once per run of failures. Guards: at most 20 watches,
     100 reads a UTC day, 2 reads a tick, every 6 h per watch, retry from 300 s doubling to 6 h.
     The pass skips while agents are paused or no PayPal connection is set. A read never writes at
     PayPal.
   - **Replay** (`rescue_replay`, approval window, privileged): the owner enters a subscription,
     the subscriber's email, the plan and the cycle price. The deal is labelled REPLAY.
3. **The fix is opened** (`Pipeline::rescue_open`): `propose_discount` computes the discount from
   the signed clause, `check_offer` and the mandate check run on the exact deal before it is
   written, and the deal opens at AGREED ("Renewal failed") with a deadline at PayPal's next retry,
   or 5 days by default (`RESCUE_RETRY_DEFAULT_SECS`). No PayPal call.
4. **The owner approves** in the approval window (`rescue_approve`, privileged, bound to the
   checklist hash; the checklist comes from `compose_rescue` in `crates/table-app/src/checks.rs`).
   `Pipeline::rescue_approve` refuses any authority but the owner's for a rescue, rechecks the
   rules and the scam check, then creates the invoice for this cycle's discounted amount and sends
   it. Each step is a reserved money operation with its own request id (`invoice-create`,
   `invoice-send`). The invoice text is fixed (`invoice_text`): "Your last renewal payment did not
   go through. This invoice covers this cycle at 20% off: … The discount is for this cycle only;
   your plan and its price stay the same." It is filled only with the offer's numbers.
5. **Paid.** While the invoice is open the wallet reads it every 60 s (`RESCUE_POLL_SECS`) for up
   to 30 days (`RESCUE_INVOICE_OPEN_SECS`). PAID records a receipt.
6. **Counted.** One SQL predicate (`COUNTED` in `crates/table-ledger/src/rescue.rs`), shared by
   `rescue_recovered`, `RescueView.counted` and the Book's `recovered_sum`: a sandbox rescue in
   RECEIPTED or RECONCILED with PayPal-verified receipt evidence, a PayPal-reported source, a
   verified receipt for the invoice and a confirmed `invoice-send`. A replay or a merely sent
   invoice never counts.
7. **Lost answers.** A lost create is found by the deal's deterministic invoice number
   (`rescue_invoice_number(deal, 1)`) and never made twice; if PayPal cannot find it, the step
   parks and the fix lapses. A lost send is read back and re-sent only under its own request id
   after a fresh owner decision; past the deadline or the 6 h request-id window it closes as not
   done and the subscription is free for a later fix.
8. **Silence.** An unapproved fix lapses (PayPal retries by itself); an unsent draft expires; a
   sent invoice expires unpaid. Nothing is collected by default. The scheduler only reads back and
   applies deadlines; it never starts a create or a send.

## Safety properties

- **Only the owner sends an invoice.** `Pipeline::authority` refuses every non-owner authority on a
  rescue deal; no agent tool touches invoices; no signed rule, seller or house mandate or safe
  default sends one. The proof verifier treats invoice create and send as money steps that must
  be owner-decided on a rescue deal.
- **Bounded fix.** The discount never raises the amount and stays inside the signed clause; the
  plan price for everyone is never offered.
- **Detection never writes.** Watch reads are GETs, audited before they are made, inside a daily
  budget; the subscriber email is never audited and recorded reads are allowlist-redacted.
- **One fix per failure.** `rescue_watch_handled` derives from the write-once `rescue_cases`, so a
  crash never opens a second fix; a watch is stopped, never deleted (migration
  `0014_rescue_watch.sql` trigger).
- **One request id per invoice step**, never a second create (migration `0011_rescue.sql` admits
  the invoice operations into `operations`).
- **Recovered means paid**, for a PayPal-reported failure only.
- **A revoked rescue mandate** still lets an unsent fix expire and never signs a PAID receipt.

## Where it lives

| Layer | Path | Key items |
|---|---|---|
| Domain | `crates/table-core/src/rescue.rs` | `RescueLever`, `propose_discount`, `check_offer`, `discounted`, `invoice_text`, `watch_verdict`, watch guards |
| Pipeline | `crates/table-app/src/rescue.rs` | `rescue_open`, `rescue_watch_read`, `rescue_detect`, `rescue_approve`, `rescue_poll`, `rescue_deadline`, `resolve_invoice_create`, `resolve_invoice_send` |
| Pipeline | `crates/table-app/src/checks.rs` | `compose_rescue` (the rescue checklist) |
| Runtime | `crates/table-runtime/src/rescue.rs` | `rescue_replay`, `rescue_book`, `rescue_watch_add`, `tick_rescue_watch`, `tick_rescue`, plain-word refusals |
| Ledger | `crates/table-ledger/src/rescue.rs`, `rescue_watch.rs` | `RescueCase`, `Recipient` (masked), `COUNTED`, `rescue_recovered`, watch list and read budget |
| Migrations | `crates/table-ledger/migrations/0011_rescue.sql`, `0014_rescue_watch.sql` | `rescue_cases`, invoice operations, `rescue_watches` |
| PayPal | `crates/table-paypal/src/secondary.rs` | Invoicing v2 create / send / search, subscription read |
| Client | `apps/desktop/client/src/windows/main/modules/rescue.tsx`, `rescue/` | page, `model.ts` (`atRiskOf`, `splitFixes`), `preview.ts` |
| Client | `apps/desktop/client/src/windows/approval/owner/` | `RescueReplay.tsx`, `replay.ts`, `RescueWatch.tsx`, `watch.ts` |

IPC commands (rows in `crates/table-client/src/authority_table.rs`):

| Command | Windows | Tier | Token + unlock | Selected deal |
|---|---|---|---|---|
| `rescue_book` | main, approval | read | no | any |
| `rescue_replay` | approval | owner | yes | any |
| `rescue_watch_add`, `rescue_watch_stop` | approval | owner | yes | any |
| `rescue_approve` | approval | decision | yes | required |
| `approval_open` | main, tumbler | ui | no | any |

## Tests that pin it

- `the_invoice_text_is_fixed_and_filled_only_with_the_offer_numbers`,
  `discount_property_style_never_increases_amount`,
  `a_watch_opens_one_fix_per_run_of_failures_and_only_for_one_cycle_owed`
  (`crates/table-core/src/rescue.rs`)
- `only_a_paid_receipted_invoice_on_a_paypal_reported_failure_counts_as_recovered`,
  `the_owners_watch_list_is_bounded_audited_without_the_email_and_stopped_not_deleted`
  (`crates/table-ledger/src/rescue_tests.rs`)
- `every_refusal_comes_before_any_paypal_call`, `a_lost_create_is_found_by_its_number_and_never_made_twice`,
  `a_replayed_failure_is_invoiced_on_the_owners_decision_but_never_counts`,
  `silence_lets_a_fix_lapse_and_an_unpaid_invoice_expire_and_nothing_is_collected`,
  `a_watched_subscription_opens_exactly_one_fix_per_failure_and_never_writes_at_paypal`,
  `a_lost_send_still_draft_at_the_deadline_closes_and_frees_the_subscription`
  (`crates/table-app/tests/rescue.rs`)
- `a_watched_failed_renewal_opens_one_fix_that_counts_only_once_the_owner_approves_and_it_is_paid`,
  `the_watch_pass_reads_a_few_a_tick_never_while_paused_and_never_writes`,
  `a_fix_whose_send_ended_is_refused_in_plain_words_and_writes_nothing`,
  `a_revoked_rescue_mandate_still_lets_an_unsent_fix_expire_and_never_signs_paid`
  (`crates/table-runtime/src/rescue_tests.rs`)
- Client: `windows/main/modules/rescue/model.test.ts`, `rescue/preview.test.ts`,
  `windows/approval/owner/replay.test.ts`, `windows/approval/owner/watch.test.ts`

## Known gaps and UNVERIFIED

- Only the discount is built. Pause, Retry after fix and Smaller plan are in the lever enum and
  the matrix but read "Not available yet".
- After the subscriber pays the fix's invoice, PayPal's subscription may still show the failure
  and retry the full price by itself; detection will not open a second fix, but stopping PayPal's
  retry is outside this slice. A still-open replay of the same subscription makes detection show
  "failed · no fix" until it ends.
- The fix's deadline does not yet read PayPal's next retry time from a watch (5-day default); no
  webhook path; watch-list changes refresh the main window on focus only.
- The watch pass does not run while agents are paused; a watch stopped and re-added keeps its run
  of failures (can miss a fix, never doubles one). Reads that open nothing are only in the audit
  log (`paypal_calls` rows need a deal).
- After the request-id window, approving a closed DRAFT send is refused with a ledger conflict
  rather than plain words. `Pipeline::rescue_detect` is called only by tests (the watch read shares
  its helpers).
- Spike 8 (invoice create, send, paid in the sandbox) is asked of the owner and **not run**.
- UNVERIFIED (marked in `crates/table-paypal/src/secondary.rs` and `crates/table-app/src/rescue.rs`):
  `detail.invoice_number`, its length cap and `detail.note` on Invoicing v2 create; the
  search-invoices body field `invoice_number` and the response `items`;
  `billing_info.outstanding_balance` and that after one failure it equals that cycle's price;
  `billing_info.last_failed_payment.next_payment_retry_time` and the `fields=last_failed_payment`
  query. PayPal documents no way to fail a sandbox renewal, so detection has never seen a live
  failure. The 20 / 100 a day / 6 h guards are the wallet's own limits, not PayPal's.
- The "Client handoff" table in STATUS still lists `rescue_approve` as UNAVAILABLE; the code
  implements it.

## Related

- [book.md](./book.md), [shield.md](./shield.md), [spend-purchases.md](./spend-purchases.md)
- [approval-window.md](./approval-window.md), [money-pipeline.md](./money-pipeline.md),
  [mandates-and-rules.md](./mandates-and-rules.md), [proof-and-verification.md](./proof-and-verification.md)
- Design: [capability 8](../design/the-table.html#cap-8), [Rescue module](../design/the-table.html#m-8)
- Build log: [STATUS.md](../build/STATUS.md) ("Subscription rescue" sections, "Liveness fixes"),
  [DECISIONS.md](../build/DECISIONS.md) §13, [SPIKES.md](../build/SPIKES.md) §8
