# The approval window

The approval window (`approval`, 744 × 660, not resizable) is the one place where the owner takes a
decision that leads to money at PayPal, signs or changes rules, sets wallet limits, enters
credentials and confirms a connection. A non-technical merchant reaches it from a "Review" or
"Change…" hand-off in The Table or the Tumbler. The wallet composes the checklist they see, binds
their decision to the exact list they saw (`checks_hash`), makes them hold the button rather than click
it, and locks itself after 15 quiet minutes. Their agents never reach this window: they have no tool
that opens it, and nothing in `main` or the Tumbler can call its commands.

## What the owner sees

The window opens in one of two modes, chosen by what it was opened for.

**Deal review ("The Diff").** Two columns, "your side" and "the side being asked", with a relation
mark per row (`=` same, `≠` different, `?` missing). A state strip runs CHECKING → READY → (LOCKED) →
IN BROWSER → APPROVED → seller attested → RECEIPTED, or ends in MISMATCH / EXPIRED / WITHDRAWN /
paused by a scam check.
- **The wallet's checklist**: up to six lines in a fixed order: amount, payee, host, invoice, scam
  check, your rules. Each line is pass, fail, wait ("checked later") or not needed (folded into
  one quiet line). Words are the wallet's own; "Why?" and "Proof" open the Layer 2 fact. The lines
  appear one by one while CHECKING; that reveal is presentation only, the list is complete first.
- **One gold action**, always a hold-to-confirm button: "Approve $329.00" (accept a counter-offer,
  or approve the order), "Pay Dan $64.00" / "Collect $212.00" (an authorized hold), "Approve the
  discount · $9.60" (a rescue fix), "Unpause" (release a scam-check pause, after typing the other
  side's exact name). "Open PayPal in your browser ↗" is a click, because the approval itself
  happens on PayPal's own page. Quiet actions: Withdraw, "Cancel and release hold", Close.
- **Enter never releases money.** The window focuses its heading; a money button ignores Enter and a
  toast says to press and hold (or hold Space on the focused button).
- A failed line disables the money buttons. A MISMATCH or a scam-check BLOCK shows no pay action at
  all. "The summary changed. Review it again." reloads the review when Rust refuses a stale list.
- "What happens next" and a "Why?" note explain the step in plain words; Details lists every check
  plus a "Checklist" hash reference (Layer 2).

**Owner configuration** (opened with no deal, also on first run). A calm checklist:
- **Wallet**: Unlock ("Changes here ask for Windows Hello" / "Locks again after 15 quiet minutes"),
  credentials (entered in a native OS dialog, never a web form), agent app (read-only), house
  seller state.
- **Agent rules**: the signed rule sets, "New rules…" / "Sign your first rules…" (three templates on
  the first signature: "Careful: asks me above $50", "Shop assistant", "Haggler for one item"). The
  rules editor with its what-if is described on [Mandates and rules](./mandates-and-rules.md).
- **Wallet limits**: three rows ("Most your agents can pay out in a day", "Most on hold at once",
  "Most deals a day") with today's meters, gold at four fifths, and a change sheet with one gold
  button. Expired or unverifiable limits get a gold line: "Your agents can't pay anyone until you
  set them again."
- **Failed renewals**: "Replay a failed renewal" (a labelled REPLAY that never counts as recovered)
  and the rescue watch row, which opens the **rescue watch sheet**: the watched subscriptions with
  state chips ("not checked yet", "renewals paid", "fix suggested", "failed · no fix",
  "can't check now") and "Stop watching", plus
  a form (subscription id, the subscriber's email the owner enters, plan). At most 20 watches and
  100 reads a day.
- **Connections**: a waiting connection opens the four-word confirm ("They differ: abort").
- **Details**: the owner key in groups of four with Copy (the permissions fingerprint is shown in
  `main`'s Settings, not here).

**Locked.** "Locked. Money stays where it is until you unlock." Every money button is disabled and
the gold button becomes "Unlock with Windows Hello". Reading stays possible. Withdraw stays
available (it is the safe direction).

## How it works

1. **Opening.** `main` or the Tumbler calls `approval_open({ deal_id, pairing?, target?, draft? })`.
   Rust selects the deal (or pairing, or configuration) and builds the window beside the window that
   asked (`approval_rect`, flips left, clamps to the work area). `target` is one of deal, pairing,
   credentials, mandate, unlock, rescue, rescue_watch. A `draft` from `main` (band, floor or rescue
   lever) is a pre-fill only: Rust checks it binds to the selection and never signs it.
2. **The capability.** The window asks `approval_token` once and keeps it in a ref inside
   `SessionProvider` (`session.tsx`): never React state, storage or a request body. Privileged calls
   send it as the `X-Wallet-Ipc` header. `main` and the Tumbler cannot obtain it.
3. **Unlock.** `unlock` runs the OS re-authentication (Windows Hello through the desktop HWND) in
   Rust; only a verified answer unlocks. `ApprovalSession` (`crates/table-app/src/auth.rs`) starts
   locked, locks when 900 seconds pass without a privileged action (`locked()`), and only a
   successful privileged call refreshes that clock; reads and background ticks do not. `lock_in`
   reports the countdown without refreshing it. A re-auth bumps a generation that invalidates older
   tickets.
4. **The summary.** `approval_summary` (selected deal only) returns `ApprovalSummary { deal,
   evidence, attempt, terms_hash, counter_hash?, can_owner_accept?, locked, can_release,
   can_open_paypal, unavailable_reason, checks, checks_hash, rescue? }`. `Pipeline::approval_checks`
   (`crates/table-app/src/checks.rs`) reads the ledger, the shield verdict and the mandate check and
   calls the pure `compose`; no PayPal call, no write. `checks_hash` is SHA-256 over
   `table.approval-checks.v1\0` plus the canonical JSON of the list (`table_core::checks_hash`).
5. **Gating in the window only narrows.** `deriveGates` (`gating.ts`) hides or disables a button
   when the window is locked, the capability is missing, Rust says `can_release=false`, a line fails,
   the shield holds, or the deal is a buyer haggle (the seller's PayPal resource). It never grants.
6. **The decision.** The button sends `DecisionArgs { deal_id, attempt, terms_hash, counter_hash?,
   checks_hash }` copied from the summary. `Runtime::decide` (`crates/table-runtime/src/service.rs`)
   then: checks label, token and unlock; checks the selected deal, terms hash and attempt, refuses
   MISMATCH and BLOCK; recomputes the checklist and refuses a missing or different hash ("The
   summary changed. Review it again.") or any failing line ("A check on this deal failed, so
   nothing was done.", the shield line exempt for a release); mints an owner ticket bound to deal,
   terms hash and attempt that expires after 60 seconds; appends one `owner.decision` audit row
   (`{decision, decided_by: human, checks_hash, terms_hash, attempt}`); and only then runs the step.
   Void is the safe direction and needs no checklist hash.
7. **Who decides.** Every money step started here is recorded as `decided_by: human` (authority 1 in
   AGENTS.md). The pipeline still re-checks the mandate, wallet limits and shield inside the step.
8. **Rules, limits and watches.** `mandate_sign`, `mandate_revoke`, `band_set`, `envelope_sign`,
   `rescue_watch_add`, `rescue_watch_stop`, `rescue_replay`, `pairing_confirm`, `set_credentials`,
   `deal_create` and `deal_join` all need the approval label, the token and an unlocked session.
   `mandate_simulate` (the what-if) needs only the approval label: it signs nothing and writes nothing.

## Safety properties

- **One label releases money.** Every Decision and Owner tier command is granted to `approval` only,
  with token and unlock; Decision commands are also bound to the selected deal
  (`crates/table-client/src/authority_table.rs`; pinned independently in `authority.rs`).
- **The owner decides on what they saw.** A decision whose checklist changed or fails is refused
  before any ticket, PayPal call or write (`service.rs` `decide`).
- **Owner authority is evidence.** The `owner.decision` row precedes the money step; proof bundle v2
  checks it (`owner_saw`, see [Proof and verification](./proof-and-verification.md)).
- **No click, no Enter.** Money actions are `HoldButton` (`src/shared/ui/hold.tsx`, 1.2 s, pointer or
  held Space); Enter never fires them.
- **The token never leaves memory.** `session.tsx` keeps it in a ref; it is not an API credential or
  a signing key.
- **Locked means nothing moves.** A locked session refuses every privileged call (`LOCKED`); deadline
  defaults keep running and never capture.
- **No counterparty free text.** The review shows signed terms, the wallet's display names and
  Rust's check words; the other side's note lives only in `main`'s quarantine box.

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Client entry | `apps/desktop/client/src/windows/approval/App.tsx`, `selection.ts`, `session.tsx`, `ui.tsx` | `SessionProvider`, `useSession`, `useSelection`, `LockCard` |
| Client, review | `windows/approval/DealReview.tsx`, `gating.ts`, `model.ts`, `review/Checks.tsx`, `review/diff.ts`, `review/next.ts`, `review/why.ts`, `review/Details.tsx`, `BandAdjust.tsx` | `deriveGates`, `checksAllow`, `decisionArgs`, `ownerAcceptArgs`, `derivePhase`, `WalletChecks` |
| Client, configuration | `windows/approval/OwnerConfig.tsx`, `owner/WalletLimits.tsx`, `owner/RescueWatch.tsx`, `owner/watch.ts`, `owner/RescueReplay.tsx`, `owner/replay.ts`, `PairingConfirm.tsx`, `templates.ts`, `owner/Templates.tsx` | |
| Client, shared | `src/shared/ui/hold.tsx`, `src/lib/limits.ts`, `src/lib/words.ts` | `HoldButton`, `readLimits`, `buildLimits`, `SUMMARY_CHANGED`, `CHECK_FAILED`, `LIMIT_WORDS` |
| Domain | `crates/table-core/src/checks.rs`, `exposure.rs` | `ApprovalCheck`, `ApprovalCheckId`, `checks_hash`, `WalletEnvelope` |
| App | `crates/table-app/src/checks.rs`, `auth.rs` | `compose`, `compose_rescue`, `Pipeline::approval_checks`, `ApprovalSession`, `OwnerTicket` |
| Runtime | `crates/table-runtime/src/service.rs`, `dispatcher.rs`, `limits.rs`, `simulate.rs` | `summary`, `decide`, `SUMMARY_CHANGED`, `CHECK_FAILED`, `Runtime::admit` |
| Shell | `apps/desktop/src-tauri/src/native/routing.rs`, `crates/table-attention/src/placement.rs` | `APPROVAL_SIZE`, `approval_rect` |
| Ledger | `crates/table-ledger/migrations/0009_wallet_limits.sql`, `0014_rescue_watch.sql`; `src/limits.rs`, `src/rescue_watch.rs` | `insert_wallet_envelope`, `watch_subscription`, `stop_watching` |

IPC commands granted to the approval window (from `authority_table.rs`):

| Command | Tier | Token / unlock | Selection |
| --- | --- | --- | --- |
| `approval_token` | session | no / no | any |
| `unlock` | session | yes / no | any |
| `deal_owner_accept`, `deal_countersign`, `deal_capture`, `deal_void`, `shield_release`, `rescue_approve`, `open_paypal_in_browser` | decision | yes / yes | selected deal |
| `set_credentials`, `mandate_sign`, `mandate_revoke`, `pairing_confirm`, `deal_create`, `deal_join`, `envelope_sign`, `rescue_replay`, `rescue_watch_add`, `rescue_watch_stop` | owner | yes / yes | any |
| `band_set`, `market_refresh` | owner | yes / yes | selected deal |
| `approval_summary` | read | no / no | selected deal |
| `approval_selection`, `approval_pairing`, `approval_handoff`, `mandate_simulate` | read | no / no | any (approval only) |
| `deal_display`, `deal_transcript`, `deal_withdraw` | read / act | no / no | its own deal when called from approval |
| `counterparty_list`, `mandate_list`, `owner_facts`, `rescue_book`, `deal_export_proof`, `envelope_get`, `attention_list`, `get_settings` | read | no / no | shared with other windows |
| `pairing_abort` | act | no / no | its own pairing |

## Tests that pin it

- `crates/table-runtime/src/checks_tests.rs`: `a_decision_with_a_missing_or_stale_checks_hash_is_refused_before_any_paypal_call_or_write`,
  `a_decision_while_a_check_fails_is_refused_and_a_release_may_fail_only_the_shield_line`.
- `crates/table-app/src/checks_tests.rs`: `a_ready_deal_composes_six_lines_in_order_all_passing_in_plain_words`,
  `payee_is_the_paired_keys_declared_payee_or_the_owners_own_and_on_the_approved_list`.
- `crates/table-core/src/checks.rs`: `the_checks_hash_is_domain_separated_and_commits_every_field_and_the_order`.
- `crates/table-app/tests/pipeline.rs`: `f4_w3_w11_approval_label_token_idle_lock_and_os_reauth`;
  `crates/table-app/src/auth.rs`: `owner_tickets_bind_terms_deal_attempt_expiry_and_session_generation`.
- `crates/table-runtime/src/authority_tests.rs`: `every_command_answers_label_lock_and_token_exactly_as_the_authority_table_says`.
- `apps/desktop/src-tauri/tests/capabilities.rs`: `w3_release_set_is_approval_only_and_all_commands_are_declared`.
- `crates/table-runtime/src/limits_tests.rs`: `tighter_limits_stop_an_owner_decision_before_any_paypal_call`.
- `crates/table-runtime/src/client_tests.rs`: `approval_open_targets_and_drafts_are_checked_prefill_only_and_never_signed`.
- Client: `windows/approval/gating.test.ts` ("locked: no money button is ever enabled", shield,
  MISMATCH, buyer haggle, owner accept), `windows/approval/review/checks.test.tsx`,
  `src/mock/checks.test.ts`, `windows/approval/owner/watch.test.ts`, `src/lib/limits.test.ts`,
  `src/mock/authority.test.ts`.

## Known gaps and UNVERIFIED

- **Native verification owed:** Windows Hello success, cancel and idle re-lock, the native credential
  dialog, the approval window's placement at mixed DPI and real IPC label/token checks have not been
  run on a desktop. Shell edits compile only on Windows.
- **UNVERIFIED (house seller):** the "waking up, about a minute" wording in `OwnerConfig.tsx` is
  unmeasured (Render cold-start timing is not in the research).
- The idle lock is enforced in Rust, but the native per-decision prompt (Hello on every money
  decision) is not built; the 15-minute session lock is the gate today.
- A buyer haggle's PayPal order payee is not read (the order is seller-owned), so the payee line
  compares the paired key's declared payee.
- `deal_export_proof` from the approval window is not bound to that window's deal; `attention_list`
  in approval filters to its own deal rather than refusing. Both are deliberate looks left open.
- There is no Proof drawer that shows an `owner.decision` row ("owner saw: …") yet, and no action to
  re-send an owner-decided step under a fresh ticket after a lost answer.
- Wallet limits hold one currency; a decision does not yet show "after this: $X of $Y today".
- After the request-id window, approving a closed rescue send is refused with a ledger conflict
  rather than plain words.

## Related

- [Mandates and rules](./mandates-and-rules.md) - the rules editor, what-if and signing.
- [Tumbler and attention](./tumbler-and-attention.md) - the Review hand-off and the browser hand-off form.
- [IPC and authority](./ipc-and-authority.md) - the authority table, manifest and capability files.
- [Money pipeline](./money-pipeline.md) - what each decision starts at PayPal.
- [Shield](./shield.md), [Rescue](./rescue.md), [Spend](./spend-purchases.md) - the decisions this window takes.
- Design: [`../design/the-table.html`](../design/the-table.html) §8 (step 4), §9 (trust model), §10.3 (approval moment);
  [`../design/window-duality.md`](../design/window-duality.md) §4; [`../ux/UX-GUIDE.md`](../ux/UX-GUIDE.md);
  build log [`../build/STATUS.md`](../build/STATUS.md) (T5, T12, T14, rescue).
