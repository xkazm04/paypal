# Home (the Dial), While you were away, walk-away forecast and Rewind

Home is the first screen of the `main` window. It answers the owner's three questions (is my money
safe, does anything need me, what happens if I do nothing) for a non-technical PayPal merchant
whose agents buy, sell and haggle for them. Around it sit three read-only views of the wallet's own
record: "While you were away" (what happened since they last looked), the walk-away forecast (what
the wallet will do on its own if they do nothing, also shown in the Tumbler and when quitting) and
the Rewind (the week replayed, with who decided each money step). None of these surfaces can move
money: they read the ledger and hand off to the approval window.

## What the owner sees

**Home (`main`).**
- A title bar: the mode badge (Sandbox / Replay / Practice agent), Find (`Ctrl K`), the lock
  indicator ("Locked" / "Unlocked"; clicking it while locked opens the approval window to unlock),
  Settings and the light/dark switch.
- The Dial in the middle: a machined vault dial with six sectors (Tables, Spend, Counter, Book,
  Shield, Rescue). Every deal is a bead in its module's sector. A gold glow means something needs
  the owner. The hub shows the decision the index points at: module, time left, the "If you do
  nothing" line and "Open deal". Arrows turn the dial, up/down cycle decisions, Enter or `1`-`6`
  opens a module. For a screen reader the dial is one slider stop with a spoken value.
- Left column, "This week" (Monday to Sunday, local time): paid out and paid in per currency,
  "On hold" (PayPal holds only, one line per direction; it leaves out a payment being checked with
  PayPal, which shows under Needs you with the check's words, `heldAtPayPal` in `home/model.ts`),
  "In motion",
  "Stopped"; the "Today" meters (paid out today and on hold now against the owner's wallet limits,
  gold at four fifths; "No wallet limit" when none are signed); a legend for the beads.
- Right column, "Needs you": one three-line row per open decision (verb and amount, who and time
  left, then the default on silence). The header says "waiting never pays". This list holds the
  only gold on the screen.
- Footer: status chips, a "Rewind" chip, a quiet `?` chip (keyboard shortcuts sheet), the Tumbler
  pill ("Mini window · shown · 2 waiting") and the clock.
- First run: the Dial is drawn but does not turn; the hub and columns show "Your first safe deal
  in 4 steps" (connect PayPal sandbox, sign your agents' rules, try a practice deal with the house
  seller, choose your agent app), with the next step as the only gold button, and the tour walks
  them once ([Onboarding](onboarding.md)).

**While you were away (`main`, Home).** A compact card above "This week" when something needs the
owner, or the hub's content when nothing does. Lines are grouped by outcome (paid, collected,
invoice paid, on hold, released, checking with PayPal, ended before PayPal showed, refused, paused, mismatch, failed, renewal
failed, lapsed, refunded, disputed) and by who decided (you, your rules, the buyer's approval under
your shop rules, the safe default, a safety check, not recorded). It shows at most four lines,
then "and N more on the Rewind". The summary opens with "No money moved." only when nothing was
paid or collected and no line is not confirmed or being checked with PayPal. A deal that ended at
its deadline while a payment was still being checked is told from the deal's own record when the
steps in the window cannot say (`windows/main/unshown.ts`); the card waits for that read. A deal whose record could not be read is worded 'not available yet', not as no money moved. Each
line opens its deal or the Rewind at its first step; "See it on the Rewind" opens the Rewind at the
moment the owner last looked. The card never carries a gold control and can be dismissed.

**Walk-away forecast.** Shown in two places:
- The Tumbler's stack form: one "If you walk away" row (`$0.00 out`, `$X in` or `up to $X in` when
  a buyer still has to approve, `N holds released`); its ⓘ opens up to three lines with when, what,
  and on whose authority ("your rule", "safe default", "the buyer already approved"). With no
  forecast it reads "Can't forecast right now". See [the Tumbler page](./tumbler-and-attention.md).
- The quit sheet in `main` (`Ctrl K` → "Quit The Table") and the native tray Quit dialog: the
  wallet's own sentence about quitting, then "Won't happen while The Table is off" and "Still
  happens at PayPal, by itself". Buttons "Keep it running" / "Quit The Table" (neither is gold).

**Rewind (`main`, Home).** Opened with the footer chip or `R`; Esc or "Back to now" returns.
A Mon-Sun scrubber sits under the dial (day marks, hatched future, a gold playhead, ‹ › to page
weeks, Play/Pause plays a week in 16 seconds; with reduced motion it steps tick to tick). Beads
stand where their deals stood at the playhead. A lane of ticks marks one tick per money operation,
coloured by authority: you = gold, a rule you signed = teal, the buyer's approval under your shop
rules = green, the safe default = grey, a refusal = a red ×; an agent or nobody is dashed. Clicking
a tick opens the deal. The hub narrates the step in plain words, for example "Tue 14:02 · Your
rules refused 40 × GPU: over the per-deal limit. PayPal was never asked." The deal page carries the
same record as a compact "Who decided" list. An ending at the deadline while PayPal was still being
asked is narrated with `stepSentence`'s unshown sentence (`logic.ts`), also when the check began in
an earlier week (read from the deal's own record, `windows/main/unshown.ts`).

## How it works

1. **Home reads, never writes.** It renders `list_deals`, `attention_list` (the `AttentionSnapshot`
   with items, forecast and the wallet-limit exposure) and `get_settings` through the shared world
   (`windows/main/world.tsx`). Opening a decision routes to the deal page, which hands off to the
   approval window with `approval_open`. Every money step is decided elsewhere: by the owner in the
   approval window, by a rule the owner signed, or by a safe default.
2. **History is projected from the verified audit chain.** `deal_history(DealHistoryArgs { deal_id?,
   from?, to? })` (`crates/table-runtime/src/history.rs`) asks the ledger for rows
   (`Ledger::history_rows`, `crates/table-ledger/src/audit.rs`), which verifies the whole hash chain
   first: a broken chain is an integrity error, never a partial list. The window is `[from, to)` in
   Unix seconds; the answer keeps the newest 500 steps (`HISTORY_STEPS`) and sets `truncated`.
3. **Each step is typed.** The pure `project` reads only typed fields (action name, `decided_by`,
   target state, envelope type and direction, operation and outcome, an allowlisted path family).
   `HistoryStep { at, deal_id, seq, kind, state_after, authority, paypal, rungs? }`. `kind` is a
   closed `HistoryKind`; `authority` is a closed `HistoryAuthority` (owner, signed_rule{clause},
   seller_mandate, house_mandate, safe_default, agent_intent, group_rule, none); `paypal` is none or
   `{ method, outcome: ok|failed|unknown }`. Detail JSON, reasons, request ids, hashes and note text
   never cross. Bookkeeping rows (`deadline.set`, `market.checked`, `mandate.*`, `attention.rung`,
   `owner.decision` and others) are classified but are not steps.
4. **A money operation is one step.** `money.authorized` opens an operation; its transitions fold
   into one step. An unconfirmed call is `failed` when a 4xx was recorded and `unknown` otherwise; a
   parked operation is a "checking with PayPal" step, never "paid".
5. **The Rewind is a client clock over that record.** `useRewind` (`Rewind.tsx`) loads one week of
   steps and moves a playhead; `historyAt` (`logic.ts`) gives each deal's state at that moment;
   `tickTone` colours a tick from its `authority`. Nothing in the Rewind can change a deal.
6. **While you were away** is the pure `awaySummary` (`home/away.ts`) over `deal_history` steps
   since "last seen", the deals' own terms for amounts and the attention count. Totals are per
   currency in integer minor units, never summed across currencies. A later step on the same deal
   settles an earlier one. "Last seen" is per viewer in `localStorage` (`table-last-seen`, wrapped
   in try/catch; missing, garbage or future means the start of today). Home counts as seen after
   4 seconds on screen, every minute, on page close and when leaving Home. A quiet summary under 30
   minutes is hidden (`worthShowing`).
7. **The forecast mirrors the scheduler.** `Runtime::forecast` (`crates/table-runtime/src/forecast.rs`)
   builds a `ForecastSource` per open deal (lapse-chosen and snoozed deals included) and the pure
   `table_attention::forecast` lists what the scheduler would do in the next 72 hours. A money line
   appears only when the pipeline's own gate (`Pipeline::step_allowed`, the same `authority()` and
   shield checks) would pass at that step's time. Authorize and capture appear only when the payment
   executor is configured. The result rides in `AttentionSnapshot.forecast` (`None` when it could not
   be read).
8. **Quit.** `quit_summary` returns `QuitSummary` with `while_off` and `at_paypal` lines from the
   pure `quit_lines` (`crates/table-attention/src/quit.rs`): quitting stops the scheduler, so every
   create, authorize or capture becomes a "won't happen while The Table is off" line; an order
   awaiting approval or a hold also gets "still happens at PayPal by itself". `quit_confirm` carries a
   `confirmation_id` that hashes the pending deals and both line lists; if anything shown changed,
   the confirm is refused and the sheet reloads.

## Safety properties

- **Read-only surfaces.** `deal_history`, `list_deals`, `attention_list`, `quit_summary` are Read
  tier; no Home, Rewind or away code path calls a money command (`crates/table-client/src/authority_table.rs`).
- **Silence never moves money out.** `forecast_never_moves_money_out_over_every_input` is a property
  test over every input (`crates/table-attention/src/forecast.rs`). No quit line says money goes out
  (`every_pending_deal_is_shown_and_no_line_says_money_goes_out`, `quit.rs`).
- **A broken record is never shown as a partial truth.** `history_rows` refuses the whole read on a
  broken chain.
- **Counterparty text never reaches these views.** The projection carries closed facts only
  (`history_is_main_only_read_only_closed_and_never_carries_their_words`); the away summary reads
  amounts from signed terms and labels from the wallet's display.
- **Unknown is not paid.** A lost PayPal answer is "Checking with PayPal" in the Rewind and the away
  card, never paid.
- **Who decided is recorded, not inferred.** `authority` comes from the typed `decided_by` the chain
  recorded; text that is not canonical is "not recorded".

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Client, Home | `apps/desktop/client/src/windows/main/Home.tsx`, `Dial.tsx`, `art.ts`, `home/model.ts` | `Home`, `Hub`, `NeedsList`, `Ledger`, `TodayMeters`, `LockIndicator`, `dialValueText` |
| Client, first run | `windows/main/home/Start.tsx`, `src/lib/firstRun.ts`, `src/shared/start.tsx` | `gettingStarted`, `StartHub`, `StartSide` |
| Client, away | `windows/main/home/away.ts`, `home/AwayCard.tsx` | `awaySummary`, `worthShowing`, `readLastSeen`, `useAway`, `AwayCard`, `AwayHub` |
| Client, Rewind | `windows/main/Rewind.tsx`, `RewindParts.tsx`, `logic.ts`, `deal/WhoDecided.tsx` | `useRewind`, `RewindBar`, `RewindHub`, `historyAt`, `tickTone`, `TICK_WORD` |
| Client, quit | `windows/main/QuitSheet.tsx`, `windows/main/quit.ts` | `quitView` |
| Client, forecast row | `windows/tumbler/logic.ts`, `forms.tsx` | `walkAway`, `WALK_AWAY_HOURS` |
| Domain (pure) | `crates/table-attention/src/forecast.rs`, `quit.rs` | `forecast`, `ForecastLine`, `quit_lines`, `QuitEffect`, `ON_QUIT`, `quit_message` |
| Runtime | `crates/table-runtime/src/history.rs`, `forecast.rs` | `HISTORY_STEPS`, `project`, `Runtime::forecast`, `FORECAST_HORIZON_SECS` |
| Ledger | `crates/table-ledger/src/audit.rs` | `history_rows`, `paypal_statuses_at` |
| Bindings | `bindings/DealHistory.ts`, `HistoryStep.ts`, `HistoryKind.ts`, `HistoryAuthority.ts`, `ForecastLine.ts`, `QuitSummary.ts`, `QuitLine.ts` | |
| Migrations | none of its own | reads `audit_log`, `paypal_calls`, `deals` |

IPC commands (from `authority_table.rs`):

| Command | Windows | Tier | Token / unlock |
| --- | --- | --- | --- |
| `deal_history` | main | read | no / no |
| `list_deals`, `get_deal` | main | read | no / no |
| `attention_list` | main, tumbler, approval (approval sees its own deal) | read | no / no |
| `quit_summary` | main, tumbler | read | no / no |
| `quit_confirm` | main, tumbler | act | no / no |
| `approval_open` | main, tumbler | ui | no / no |

## Tests that pin it

- `crates/table-runtime/src/history.rs`: `every_audit_action_the_wallet_writes_is_classified_by_typed_fields_only`
  (scans ledger, app and runtime sources so a new audit action without a row fails),
  `a_money_operation_folds_its_transitions_and_an_unconfirmed_call_says_failed_or_unknown`.
- `crates/table-runtime/src/history_tests.rs`: `a_seller_capture_shows_the_rule_that_ordered_and_the_seller_mandate_that_collected`,
  `a_hold_left_alone_is_voided_by_the_safe_default`, `a_refused_intent_names_its_clause_and_has_no_paypal_tick`,
  `history_is_main_only_read_only_closed_and_never_carries_their_words`.
- `crates/table-ledger/src/tests.rs`: `history_rows_are_deal_scoped_windowed_capped_and_refused_whole_on_a_broken_chain`.
- `crates/table-attention/src/forecast.rs`: `forecast_never_moves_money_out_over_every_input`,
  `without_a_payment_executor_no_authorize_or_capture_is_forecast`.
- `crates/table-attention/src/quit.rs`: `every_pending_deal_is_shown_and_no_line_says_money_goes_out`.
- `crates/table-runtime/src/quit_tests.rs`: `quit_confirm_refuses_when_the_shown_lines_changed_though_the_deals_did_not`,
  `quit_with_an_unreadable_forecast_promises_nothing_per_deal`.
- `crates/table-runtime/src/forecast_tests.rs`: the differential test that ticks the real scheduler
  at every line's time and checks state, `decided_by` and audit.
- Client: `windows/main/rewind.test.ts` (tick colours, plain-word narration, no ids or clause
  numbers), `windows/main/home/away.test.ts` (currencies never added, lost answer reads as
  checking), `windows/main/home/AwayCard.test.tsx`, `windows/main/quit.test.ts`,
  `windows/tumbler/walkaway.test.ts`, `windows/main/home/model.test.ts` (dial value text, a payment being checked is not on hold),
  `windows/main/deal/Decision.test.tsx`, `windows/main/unshown.test.ts` (which endings are read, the deals whose record shows an open check), and
  in `windows/main/home/away.test.ts` the two cases that pass the deal's own record (`unshown`). The rewind and
  shown cases for an ending unshown come from the steps (`endedBeforePayPalShowed`), not from the deal's own record.

## Known gaps and UNVERIFIED

- **UNVERIFIED:** how long PayPal keeps an approved but uncollected order is not in the research,
  so no quit line claims it. The "hold released by PayPal after 29 days at most" line rests on
  `.research/paypal-platform.md` [S].
- The native tray Quit dialog and the native `deal_history` handler are compiled only on Windows;
  they were not compiled or run on the Linux build host.
- Typed DecisionTraces are not built: an `intent.refused` row names its clause only when the refusal
  carried `detail.clause`.
- One tick per money operation, not one per `paypal_calls` row: order and reporting reads are not
  ticks. There is no link from a tick to a Proof drawer.
- The Book's On hold now leaves out a payment being checked with PayPal, as Home does (85faf93; `lib/polish3.test.ts`).
  The Book's week answer tone still counts every AUTHORIZED deal (DECISIONS section 34).
- The Rewind's bead tip reads a payment being checked with PayPal (a dashed bead and the check's pill and Money line),
  not on hold or nothing moved (0705f3f, 448fda5; `rewindCheckTip`).
- An ending whose own record could not be read (the read failed or timed out, or the week held more than 500
  endings) reads 'Not available yet' on the away card, the Rewind narration and the bead tip, never 'No money
  moved' (deb1002; DECISIONS.md section 36).
- Open, from wallet-deal-dashboard full r2 (waiting on the operator's Approval; DECISIONS.md section 36):
  economics-1, `deal_display` is read again on each refetch for every CAPTURED and RECEIPTED deal, because
  `record_resolution` does not move `deals.updated_at`; economics-2, a dropped `deal_display` batch keeps reading
  and batches can overlap without limit; economics-3, `useAllEvidence` (the Book) reads `deal_evidence` for every
  lifetime deal at once. The amount note on a deal row (`amountNote`) and the Shield word a deal from its
  state alone, so a checked payment can still read as on hold there.
- The away card's "last seen" is per browser profile (localStorage), not per owner.
- The director's own time words still say "N d N h later"; a lapsed haggle's chip can read
  "Withdrawn" while its banner says it lapsed (noted for the next polish pass).

## Related

- [Tumbler and attention](./tumbler-and-attention.md) - the walk-away row, the ladder and "What you were shown".
- [Approval window](./approval-window.md) - where every owner money decision is taken.
- [Money pipeline](./money-pipeline.md) - authorities, safe defaults, the read-back resolver.
- [Book](./book.md) - the same totals in the ledger view.
- [Preview and director](./preview-and-director.md) - the sample week the Rewind shows in a browser.
- Design: [`../design/the-table.html`](../design/the-table.html) §10 (surfaces), [`../design/window-duality.md`](../design/window-duality.md);
  build log: [`../build/STATUS.md`](../build/STATUS.md) (T4, T6, "While you were away").
