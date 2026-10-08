# Book (all payments)

The Book is the owner's ledger of every deal and payment the agents made or planned, read-only.
It answers "where is my money this week?" with totals kept apart by direction and currency, lists
what needs attention, checks each paid deal against PayPal's own statement, answers questions
typed in plain words (read by the wallet itself, with no AI), shows the hash-chained audit trail,
and checks a signed proof file someone sent. The Book owns no deals and moves no money: every
command it uses is a read.

## What the owner sees

**Main window, Book page** (`apps/desktop/client/src/windows/main/modules/book.tsx`):

- An answer bar, then a first-visit explainer: "Every payment, one list", "A hold isn't a
  payment", "Checked against PayPal".
- **Totals, kept apart**: Paid out, Paid in, On hold, Stopped. Each currency is its own line and
  is never added to another; a hold is never added to a payment; stopped money is its own figure
  (`modules/book/where.ts`). The held line reads, for example, "$64.00 going out and $118.00
  coming in are on hold at PayPal, not paid yet." (`heldWords()`).
- **Needs attention**: holds to decide, payment links open, renewals failing (with the amount at
  risk), and payments checking with PayPal, each with its first deal, deadline and "If you do
  nothing" line ("Counted from your deals. Not a forecast.").
- **Ask the book**: a box ("For example: how much was paid this week, by shop?"), quick views
  ("This week vs market", "Does PayPal agree yet?", "My rules vs me", "Day by day", "What was
  stopped", "Amounts that didn't match"), and for a typed question an "I read this as:" line of
  chips the owner can remove or change, with the note "Understood by your wallet · no AI involved".
  A question it cannot read says which words it did not understand and offers three phrasings that
  work. Enter asks, Esc clears.
- **Recent payments**: one row each (when, who, what, amount, status, PayPal statement), and
  "Where the money went" bars with a "PayPal agrees" meter (`book/MoneyWent.tsx`). Statement words:
  "On statement", "Not on statement yet" ("PayPal's statement can lag up to 3 hours"), "Statement
  differs", or dashed "Unknown".
- **Detailed** view: the week's ledger grid whose four money columns carry their own totals, a
  statement filter, the answer's rows highlighted (others dimmed), "Export CSV" ("Save the deals
  you see as a spreadsheet file"), the **Audit trail** ("Read-only. Each entry is linked to the one
  before it, so a change to an earlier entry shows."), and **Check a proof file**.
- If the audit chain fails verification, a sheet explains it in plain words (keep the files,
  check PayPal, keep saved proof files) and offers "Check again" (`AUDIT_BROKEN`).

**Deal page, PayPal records sheet** (`windows/main/deal/Evidence.tsx`): receipt and statement chips
with their reasons, "Check my PayPal statement" ("Looks this payment up on your own PayPal
statement. Read-only."), and saving the signed proof file. Their notes never show in the Book;
the deal page shows them in quarantine.

## How it works

1. **Rows.** The page reads `list_deals` and each deal's `deal_evidence` (receipt evidence:
   none, seller-attested or PayPal-verified; reconciliation: not applicable, pending, matched,
   mismatch; any "checking with PayPal" money check). Totals are computed in the client per
   currency and direction, in integer minor units (`book/model.ts`, `book/where.ts`).
2. **A closed query.** Quick views and typed questions both become a `BookQuery`
   (`crates/table-core/src/book.rs`): a view (deals, paypal_calls, receipts, subscriptions,
   reconciliation), 1 to 4 metrics (count, sum_amount, avg_vs_market_pct, recovered_sum), up to 6
   filters, up to 2 groupings (kind, counterparty, state, day, decided_by), an optional time range
   and a limit of 1 to 500. `book_query` checks it (`book_query_rejection`, answered INVALID
   "BookQuery rejected: <reason>" verbatim) and runs it on a read-only ledger connection
   (`Ledger::book_query`, `crates/table-ledger/src/book.rs`). `recovered_sum` uses the rescue
   module's one `COUNTED` predicate, so a replay or a merely sent invoice never counts.
3. **"Ask in your own words."** `understand()` in `book/understand.ts` is a pure reader with a
   fixed word list: no LLM, no network, no IO. It reads time ranges (today, this/last week with
   Monday weeks, this/last month, last N days, "since <weekday>", month names, all time; sent as
   an RFC 3339 range from the owner's UTC offset), metrics, statuses, kinds, groupings and the
   reconciliation view. A counterparty matches only a name the wallet knows from
   `counterparty_list`; an unpaired counterparty is never matched. Every word must be read or be
   filler, otherwise the answer is "unsure" (never a guess). The question is capped at 200
   characters (`MAX_ASK`). `book/rules.ts` mirrors `BookQuery::rejection` with Rust's exact words as
   a guard and test oracle; Rust still checks every query. A late answer to an older question is
   ignored.
4. **Reconciliation with PayPal, on the owner's click** (`deal_reconcile`, main window). For a
   sandbox deal in RECEIPTED, `Pipeline::reconcile` (`crates/table-app/src/reconciliation.rs`)
   writes a `receipt.reporting_checked` audit row, then reads the owner's own Transaction Search
   (`GET /v1/reporting/transactions`) for the last three days, at most 20 pages of 500, recording
   every call in `paypal_calls`. A row matches on the capture id, status `S` and the exact amount
   and currency (a buyer's row is a negative debit). One match moves the deal to RECONCILED
   (`Ledger::confirm_reporting`); none leaves it "not on statement yet"; more than one, a partial
   page set or a failed status is refused.
5. **Audit trail.** `audit_page` pages the hash-chained `audit_log` newest first (1 to 200 rows),
   verifying the chain before it answers; a broken chain is an error, never a partial list.
6. **Proof file check** (`proof_check`, main window, answered by the shell). A native file dialog
   picks a `.tableproof`; the webview never sees the path or the bytes, only the report. The file is
   capped at 8 MiB (`PROOF_FILE_LIMIT`) and checked by `table_client::check_proof_file` with the
   `table-verify` checks: plain-words lines per check, "not checked" where a check has nothing to
   check ("Not every check could be made"), the owner key in full ("Matches your wallet" or "A
   different wallet") and the permissions fingerprint ("Made by the same version" or a different
   one). See [proof-and-verification.md](./proof-and-verification.md).
7. **Agents may read, never write.** The shop-assistant role (`prompts/shop-assistant.md`) has one
   MCP tool, `book_query`, with the same closed query; counterparties appear only as identifiers.

## Safety properties

- **Read-only.** Every Book command is tier `read`; `book_query` runs on a connection that refuses
  mutation; reconciliation only adds evidence (a matched statement) and an audit row.
- **Never added across currencies or directions**; a hold is never counted as paid; stopped money
  stays separate; an unknown statement is never counted as "on statement".
- **No AI reads the owner's question**; it never leaves the machine and is never guessed.
- **Rejections never echo a value**: the fixed reason names the rule only.
- **Their words never appear** in the Book; counterparty text stays in the deal page's quarantine.
- **The audit chain is verified on every read**; there is no UPDATE or DELETE path on `audit_log`.
- **A proof file is read by Rust, not the webview**, and size-capped.

## Where it lives

| Layer | Path | Key items |
|---|---|---|
| Domain | `crates/table-core/src/book.rs` | `BookQuery`, `BookView`, `BookMetric`, `BookGroup`, `BookRange`, `rejection` |
| Ledger | `crates/table-ledger/src/book.rs`, `audit.rs`, `receipt.rs` | `book_query`, `book_query_rejection`, `audit_page`, `confirm_reporting` |
| Pipeline | `crates/table-app/src/reconciliation.rs` | `Pipeline::reconcile` |
| PayPal | `crates/table-paypal/src/secondary.rs` | Transaction Search reads, `ReportingWindow` |
| Proof | `crates/table-client/src/lib.rs`, `crates/table-verify/` | `check_proof_file`, `PROOF_FILE_LIMIT`, `verify_bundle` |
| Shell | `apps/desktop/src-tauri/src/native/commands.rs` | `proof_check` (file dialog) |
| Agent tool | `crates/table-mcp/src/lib.rs`, `prompts/shop-assistant.md` | `book_query` |
| Client | `apps/desktop/client/src/windows/main/modules/book.tsx`, `book/` | `understand.ts`, `rules.ts`, `AskReading.tsx`, `AskChips.tsx`, `model.ts` (`LENSES`), `where.ts`, `MoneyWent.tsx`, `ProofCheck.tsx` |
| Client | `apps/desktop/client/src/windows/main/deal/Evidence.tsx` | "Check my PayPal statement", save proof |

IPC commands (rows in `crates/table-client/src/authority_table.rs`; all tier `read`, no token or
unlock):

| Command | Windows | Selected deal | Enforcer |
|---|---|---|---|
| `list_deals`, `deal_evidence` | main | any | runtime |
| `book_query` | main | any | runtime |
| `audit_page` | main | any | runtime |
| `deal_reconcile` | main | any | runtime |
| `proof_check` | main | any | shell |
| `deal_export_proof` | main, approval | any | runtime |
| `rescue_book`, `counterparty_list`, `owner_facts` | main, approval | any | runtime |

## Tests that pin it

- `file_book_connection_reads_committed_data_and_rejects_mutation`,
  `query_bounds_and_recovered_metric_exclude_replay`,
  `rejections_name_the_rule_in_fixed_words_and_never_echo_a_value` (`crates/table-ledger/src/book.rs`)
- `owner_book_query_is_closed_main_only_and_rejections_are_verbatim_invalid`,
  `owner_facts_and_audit_pages_are_read_only_closed_and_label_scoped`
  (`crates/table-runtime/src/client_tests.rs`)
- `own_account_reporting_requires_success_exact_capture_amount_currency_direction_and_complete_pages`
  (`crates/table-app/tests/pipeline.rs`)
- `reporting_paginate_and_reject_overbounds_partial_or_bad_pages` (`crates/table-paypal/tests/client.rs`)
- `cached_market_and_closed_book_are_role_bound_and_cannot_write` (`crates/table-mcp/tests/server.rs`)
- `a_file_that_is_not_a_bundle_or_too_large_is_refused_in_plain_words` (`crates/table-client/src/lib.rs`)
- `only_a_paid_receipted_invoice_on_a_paypal_reported_failure_counts_as_recovered`
  (`crates/table-ledger/src/rescue_tests.rs`)
- Client: `windows/main/modules/book/understand.test.ts` (47 phrasings to exact queries),
  `book/AskReading.test.tsx`, `book/where.test.ts`, `book/model.test.ts`, `book/proofV2.test.tsx`

## Known gaps and UNVERIFIED

- Reconciliation runs only when the owner clicks "Check my PayPal statement" on a deal; there is no
  background statement check and no Book-wide "check all".
- Book totals still count a capture whose PayPal answer was lost and parked under "On hold".
- Book metrics are not yet read from the wallet-limits exposure fold; the page's local recovered
  estimate could read `rescue_book` instead.
- Typed questions: spending and receiving both read as "Paid" (direction is not a `BookQuery`
  field; the answer keeps out and in on their own lines); grouped by day, the window uses local
  days while Rust answers in UTC days; amount, date and vs-market comparisons ("over $100") stay
  "unsure"; no suggestions while typing; the slip shows the original text after chip edits.
- Proof files: a deal decided by the owner before the approval checklist existed has no
  `owner.decision` row, so its v2 file fails "owner saw"; no test exports from a corrupt chain or
  with a missing key.
- UNVERIFIED (marked in `reconciliation.rs`): buyer-account reporting shows a negative debit and
  the seller's capture id as `transaction_id`; reporting permissions and lag live (spike 3). The
  "up to 3 hours" statement lag is from the research, not measured here.

## Related

- [rescue.md](./rescue.md), [spend-purchases.md](./spend-purchases.md), [counter-shop.md](./counter-shop.md),
  [shield.md](./shield.md), [tables-haggling.md](./tables-haggling.md)
- [proof-and-verification.md](./proof-and-verification.md), [home-and-rewind.md](./home-and-rewind.md),
  [money-pipeline.md](./money-pipeline.md), [agents-and-engines.md](./agents-and-engines.md)
- Design: [capability 5](../design/the-table.html#cap-5), [Book module](../design/the-table.html#m-5)
- Build log: [STATUS.md](../build/STATUS.md) ("Book: Ask in your own words", "Proof bundle v2",
  "Client handoff"), [DECISIONS.md](../build/DECISIONS.md) §2, §11
