# The Tumbler and the attention ladder

The Tumbler (`tumbler`) is the small always-available window that keeps the owner informed while
The Table is closed or behind their work. It is a puck in a screen corner that grows into a ticker, a
card or a stack when something needs them. One attention ladder decides how loudly a decision asks:
steady, then breathing at 2 hours, then one OS notification at 15 minutes, then the deadline's safe
default. The wallet records each rung it actually offered ("informed silence"), and a safe default
cites that record, so the deal page can say "What you were shown" before nothing moved. The Tumbler
can always say no (Withdraw, Let it lapse, Snooze) and can open the other windows; it cannot approve
or pay anything.

## What the owner sees

**Forms** (Rust owns the size table; the page asks for a form by name, never pixels):

| Form | Size | What it shows |
| --- | --- | --- |
| rest | 88 × 88 | The engraved puck: six module ticks, one bead per open item, a gold ring when something needs them (coral when only pauses wait), the count, the mode engraved below. |
| tab | 28 × 96 | Docked flush to a screen edge. |
| ticker | 420 × 88 | One line: an arrival, a receipt, a stop; returns to rest after 6 s (2.5 s for a receipt). |
| card | 440 × 152 | One decision or pause: "Approve $329.00 with Dan?", time left in words, the "If you do nothing" line, the actions. |
| stack | 440 × 336 | Every open item, today's meters (paid out today, on hold now, against wallet limits), the "If you walk away" row, Do not disturb, pin. |
| handoff | 440 × 160 | PayPal is open in the browser: the approve window counting down while the wallet polls. |
| welcome | 440 × 228 | First time The Table is closed, and the first-run steps (four, with the tour; see [Onboarding](onboarding.md)). |

**Cards.** A decision (GATE) reads as a question; a pause (HOLD) as a statement with a coral
"Paused" chip and the rule that paused it ("Paused by …", from the wallet's closed rule names). A
payment step whose PayPal answer was lost reads "Checking" with "at the deadline the wallet asks PayPal what happened, releases any hold and collects nothing".
Every card carries the mode badge and the lock indicator. Actions, in order: "Review ↗"
(gold, decisions only), Withdraw (asks once), "Open in The Table ↗", "Let it lapse", "Remind me in
30 min". A pause offers only Withdraw and "See why in The Table ↗". There is no approve button and no
approve hotkey.

**Keys.** `Ctrl+Shift+Space` summons or puts away the Tumbler. On a focused card: Enter = Review
(opens the approval window; it never approves), W = Withdraw (press twice), Esc = back to rest.

**The ladder on screen.** A 2 px deadline rule and an amount ring empty fastest in the last two
hours; the caption reads "plenty of time", "less than 2 hours left", "less than 15 min left · last
reminder", "time is up · the safe default runs". A screen reader hears the top decision once per
rung ("Approve $329.00: under 15 minutes left to decide."), never every second. After 45 seconds
without interaction the puck dims to 55 %, unless a decision is inside 2 hours.

**Notifications and Do not disturb.** At the 15-minute rung, one OS notification per decision and
deadline: "The Table · decision due", "<headline>. If ignored: <default>". It carries no buttons and
no sound; clicking it opens the Tumbler on that card. Do not disturb (the stack's toggle, the
notifications switch, or the system's own quiet mode) suppresses the notification and the breathing;
the ring and count stay, and a "Quiet" chip shows on the stack.

**If you walk away.** The stack's row: `$0.00 out`, `$X in` or `up to $X in` when a buyer still has
to approve, `N holds released`; ⓘ lists up to three lines with when, what, and on whose authority.
No forecast reads "Can't forecast right now". See [Home and Rewind](./home-and-rewind.md).

**What you were shown (`main`, deal page).** On a deal its safe default ended, a one-line strip
under the state strip: "What you were shown: Lapsed Tue 10:37 · shown 09:00 · notified 10:25 ·
opened 10:29 · no money moved". A missing notification says why ("not notified: Do Not Disturb was
on", "notifications were off", "your computer was in a quiet mode", "the notification couldn't be
shown"). A card never on screen says "not shown to you before the deadline". A hold released by
its deadline reads "Hold released … nothing was paid".

## How it works

1. **The snapshot.** `attention_list` returns `AttentionSnapshot { items, stopped_today, in_motion,
   wallet_spend_today_*, locked, forecast?, exposure? }`. Each `AttentionItem` is built by
   `AttentionSource::item` (`crates/table-attention/src/lib.rs`) from fields Rust composes: amount,
   the counterparty display name from the pairing record, module, deadline, default, clause number,
   mode, money check, shield rule. Kinds: GATE and HOLD become items; STOP and MOTION are counts;
   RECEIPT is an event. Items sort by deadline, then id. `attention:changed` pushes new snapshots to
   `main` and `tumbler`.
2. **One schedule.** `table_attention::LADDER` (`schedule.rs`): breathe at 7200 s, notify at 900 s,
   snooze offered only with more than 2700 s left, snooze lasts 1800 s, quiet after 45 s at 55 %.
   `urgency`, `quiet_opacity_percent`, `AttentionLadder::evaluate`, the runtime's notification claim
   and snooze filter, the shell's breathe flag (`native/events.rs`) and the page (`tumbler/logic.ts`
   via the generated `bindings/ladder.ts`) all read this one value. A snooze always ends before the
   notification rung, and that rung always pierces a snooze.
3. **The default line is worded from the forecast.** `word_silence` (`silence.rs`) writes each
   card's `on_silence` from the same snapshot's forecast: a seller card says the payment the buyer
   approved is collected or put on hold; with no forecast it promises nothing.
4. **Notifications.** The shell's `notify_due` evaluates each item. A due notification is claimed
   durably once per deal and deadline (`Action::ClaimNotification`, a ledger preference), the toast
   is shown, and the claim is given back if it could not be shown. Clicking emits
   `tumbler:selected` and opens the card form.
5. **Rungs are recorded.** `Runtime::record_rung` (`crates/table-runtime/src/ladder.rs`) appends an
   `attention.rung` audit row through `Ledger::record_rung` (`crates/table-ledger/src/attention.rs`),
   at most one per (deal, deadline, rung), only for a card of a snapshot whose deadline is live.
   Rungs: shown, breathing (not under Do not disturb), notified (only while the claim is held, so it
   means the toast showed), notify_suppressed (with a reason: do_not_disturb, notifications_off,
   system_quiet, not_shown), card_opened (opening the deal from its Tumbler card), review_opened
   (`approval_open` with a deal), snoozed. A rung that cannot be written is logged without deal text
   and dropped.
6. **Safe defaults cite the rungs.** When a deadline's safe default runs (a lapse, an expiry, an
   auto-void), the ledger adds `rung_deadline`, `rung_chain_hash` (a fold of the rung rows' hashes in
   order), `rung_count` and `last_rung` to that audit row. The default itself is unchanged; a failed
   read leaves the detail as it was.
7. **The record reaches the screen.** `deal_history` attaches `rungs` to the safe-default step that
   cites them; `deal/shown.ts` (`shownStep`, `shownParts`) turns them into the strip. Rung rows ride
   in the proof bundle's audit segment.
8. **Who decides.** Nothing in this module decides a money step. Withdraw, Let it lapse and Snooze
   only move toward the deadline's safe default. Review hands off to the approval window, where the
   owner decides. The safe default at the deadline is authority 3: no money moves, or a hold is
   voided; never a capture.

## Safety properties

- **No path to paying.** The Tumbler's commands are read, ui and act tier only; it holds no token.
  `canReview` and `cardActions` (`tumbler/logic.ts`) only narrow Rust's `actions`; a HOLD never gets
  Review. There is no approve hotkey and no global approve chord.
- **Untrusted text never reaches the Tumbler.** `AttentionItem` has no free-text field from the other
  side (`w4_tumbler_schema_has_no_untrusted_text_and_w11_lock_preserves_items`); `counterparty_note`
  is granted to `main` only.
- **Never steals focus.** An arrival shows the window without activating it (`show_without_activation`).
- **One notification per card and deadline**, durably claimed; Do not disturb records one
  suppression and never notifies (`dnd_records_one_suppression_per_card_and_deadline_and_never_notifies`).
- **Evidence never delays a default.** A rung that cannot be written changes nothing
  (`f3_w6_a_rung_that_cannot_be_written_never_delays_the_default`).
- **Rungs only for what they could have seen.** No rung row for a deal not in a snapshot.
- **The lock preserves items.** An idle-locked wallet still shows every card.

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Client | `apps/desktop/client/src/windows/tumbler/Tumbler.tsx`, `forms.tsx`, `Puck.tsx`, `logic.ts`, `tumbler.css` | `FORM_SIZE`, `SECONDS`, `rung`, `rungNotice`, `cardActions`, `canReview`, `snoozeEligible`, `cardWhy`, `walkAway`, `CardForm`, `StackForm`, `HandoffForm` |
| Client, deal page | `windows/main/deal/ShownStrip.tsx`, `deal/shown.ts`, `deal/whatYouWereShown.css`, `src/lib/words.ts` | `shownStep`, `shownParts`, `SHOWN_TITLE`, `NOT_NOTIFIED_BECAUSE`, `NEVER_SHOWN` |
| Domain (pure) | `crates/table-attention/src/lib.rs`, `schedule.rs`, `silence.rs`, `placement.rs` | `AttentionItem`, `AttentionSnapshot`, `AttnKind`, `TumblerAction`, `AttentionLadder`, `LADDER`, `word_silence`, `FORMS`, `place`, `snap` |
| Domain types | `crates/table-core/src/ladder.rs` | `LadderRung`, `NotifySuppression`, `RungMark` |
| Runtime | `crates/table-runtime/src/ladder.rs`, `dispatcher.rs` | `record_rung`, `record_snapshot_rungs`, `ClaimNotification`, `ReleaseNotification`, `NotificationShown`, `Snooze` |
| Ledger | `crates/table-ledger/src/attention.rs` | `record_rung`, `rungs`, `silence_evidence`, `rung_chain_hash`, `cite_rungs` (no migration) |
| Shell | `apps/desktop/src-tauri/src/native/events.rs`, `native/surface.rs`, `native/routing.rs`, `native.rs` | `notify_due`, `notify_once`, `show_toast`, the `Ctrl+Shift+Space` shortcut |
| Bindings | `bindings/AttentionSnapshot.ts`, `AttentionItem.ts`, `LadderSchedule.ts`, `ladder.ts`, `LadderRung.ts`, `RungMark.ts`, `TumblerPreferences.ts`, `VisualState.ts`, `TumblerHandoff.ts` | `ladder.ts` is generated and drift-checked |

IPC commands the Tumbler may call (from `authority_table.rs`):

| Command | Windows | Tier | Token / unlock |
| --- | --- | --- | --- |
| `attention_list`, `get_settings`, `deal_display`, `envelope_get` | all | read | no / no |
| `deal_snooze` | tumbler only | act | no / no |
| `deal_withdraw` | all | act | no / no |
| `deal_let_lapse`, `pause_all_agents`, `quit_confirm` | main, tumbler | act | no / no |
| `quit_summary` | main, tumbler | read | no / no |
| `main_open`, `approval_open`, `settings_write` | main, tumbler | ui | no / no |
| `tumbler_set_form`, `tumbler_pin`, `tumbler_drag`, `tumbler_snap` | tumbler only | ui (shell-enforced) | no / no |

Events to the Tumbler: `attention:changed`, `receipt:created`, `settings:changed`, `tumbler:form`,
`tumbler:orient`, `tumbler:selected`, `tumbler:visual`, `tumbler:handoff`.

## Tests that pin it

- `crates/table-attention/src/schedule.rs`: `the_rungs_are_ordered_so_a_snooze_ends_before_the_notification`, `boundaries`.
- `crates/table-attention/src/lib.rs`: `ladder_boundaries_and_w5_one_notification_dnd`,
  `dnd_records_one_suppression_per_card_and_deadline_and_never_notifies`,
  `urgency_ladder_and_quiet_rule_agree_with_the_one_schedule_at_every_boundary`,
  `w4_tumbler_schema_has_no_untrusted_text_and_w11_lock_preserves_items`,
  `every_offered_action_is_one_the_state_machine_accepts`.
- `crates/table-attention/src/silence.rs`: `card_and_forecast_agree_over_every_input`,
  `unreadable_forecast_promises_nothing_for_a_seller_that_may_move`.
- `crates/table-runtime/src/ladder_tests.rs`: `w6_an_ignored_gate_is_shown_breathes_is_notified_and_its_lapse_cites_the_chain`,
  `w5_do_not_disturb_records_why_the_owner_was_not_notified`,
  `a_snooze_is_recorded_hides_no_evidence_and_the_notification_rung_pierces_it`,
  `no_rung_row_is_ever_written_for_a_deal_not_in_a_snapshot`,
  `f3_w6_a_rung_that_cannot_be_written_never_delays_the_default`.
- `crates/table-runtime/src/history.rs`: `a_safe_default_carries_the_rungs_it_cites_and_no_other_step_does`.
- `crates/table-client/src/ladder.rs`: `every_field_of_the_schedule_is_exported_with_its_value`;
  `crates/table-core/src/ladder.rs`: `every_rung_name_is_its_wire_name`.
- `apps/desktop/src-tauri/src/native/events.rs`: `each_failure_streak_is_shown_once` and the
  `notify_tests` module (at most one notification; a failed toast releases the claim).
- Client: `windows/tumbler/ladder.test.ts`, `windows/tumbler/logic.test.ts` (tickers never name ids),
  `windows/tumbler/walkaway.test.ts`, `windows/main/deal/shown.test.ts`.

## Known gaps and UNVERIFIED

- **Native verification owed:** no-activation on arrival, mixed-DPI placement, drag and snaps,
  single-instance summon, notification identity, delivery, click and Do not disturb have not been
  checked on a desktop. `native/events.rs` and `native/routing.rs` compile only on Windows CI.
  Notification identity needs a packaged app.
- "card_opened" means opening the deal from its Tumbler card (`tumbler_set_form` carries no deal).
- The mock never records "notified"; the preview only shows the other rungs.
- The mock's `tumbler_set_form` still reports older form sizes in its `tumbler:orient` rectangle
  (`src/mock/backend.ts` `FORM_SIZE`, e.g. card 460 × 320) while the page and Rust use 440 × 152; the
  preview stage draws from the page's table, so only that event payload differs.
- The receipt ticker does not name the rungs yet; the trust model has no "informed silence" row yet.
- The stack's "Checking with PayPal" item shows "Paused" in the mock (it uses `kind: 'hold'`); stack
  rows truncate at 440 px with the full text on hover.
- No Tumbler-menu quit entry; the optional chime at the 15-minute rung is not built.

## Related

- [Home and Rewind](./home-and-rewind.md) - the walk-away forecast and the record the strip reads.
- [Approval window](./approval-window.md) - where Review leads.
- [Money pipeline](./money-pipeline.md) - safe defaults and deadlines.
- [IPC and authority](./ipc-and-authority.md) - window labels and shell-enforced commands.
- [Preview and director](./preview-and-director.md) - the Tumbler preview stage.
- Design: [`../design/window-duality.md`](../design/window-duality.md) §2-§4 and acceptance W1-W11;
  [`../design/the-table.html`](../design/the-table.html) §10.1; build log [`../build/STATUS.md`](../build/STATUS.md)
  (T4, "Evidence of informed silence").
