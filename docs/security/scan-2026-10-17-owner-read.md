# Security scan - The Table - owner read paths (§52, §52a, §52b) - 2026-10-17

A focused scan of the read paths of a lost money step after DECISIONS §52, §52a and §52b: the
owner's one read of a lost authorize (`owner_read_authorize`), the wallet's own read-back of a lost
authorize, capture or void (`resolve_deal`, `money_read_due`, `resolve_authorize`,
`resolve_payment`, `confirm_capture`), the backoff, the hourly park and the bounded read maps from
`466d6db`, the desktop `deal_countersign` command that carries the owner's click there, and the
runtime gate in front of it. Base: `4be16b2`, branch `autopilot/codebase-security-scan-d21ed505`.
**Nothing at medium or higher was found, so nothing was fixed. Every item is report only.** No live
PayPal call was made and no money was used.

The prior scan (`docs/security/scan-2026-10-17-rescue.md`, R-1 to R-6) is not re-reported. Where
the same pattern recurs on the countersign path, it is named under "Known, not re-reported".

Scope (read in full):
- `crates/table-app/src/pipeline/resolve.rs` (`resolve_deal` :121-170, `money_read_due` :174-182,
  `owner_read_authorize` :437-483, `resolve_authorize` :487-598, `resolve_payment` :632-814,
  `confirm_capture` :819-884).
- `crates/table-app/src/pipeline/read_state.rs` (all; `insert_capped` :22-44, the floor :61-68,
  `prune_read_state` :104-150).
- `crates/table-app/src/rescue.rs` (`deadline_read_failed` :865-875, and the `466d6db` changes to
  `rescue_tick`, `rescue_deadline`, `rescue_resolve` and `read_failed`).
- `crates/table-app/src/pipeline.rs` (map fields :120-159, `owner_void` :253-, `authorize`
  :1084-1123, `auto_void` :1285-, `deadline_default` :1394-1456).
- `crates/table-app/src/auth.rs` (`ApprovalSession::check`, `ticket`, `validate`; `TICKET_SECS`).
- `apps/desktop/src-tauri/src/native/commands.rs:206-219` (`deal_countersign`) and
  `apps/desktop/src-tauri/src/native.rs:79-95` (`caller`, `ask`).
- `crates/table-runtime/src/service.rs:366-371` (`guard`), `:566-756` (`decide`, `after_paypal`),
  and `crates/table-runtime/src/scheduler.rs` (who calls `resolve_deal` and in which mode).

Also read, unchanged: `crates/table-ledger/src/resolution.rs:154-237` (`record_resolution`),
`crates/table-client/src/lib.rs:33-58` (`CommandError` from `table_app::Error`),
`crates/table-paypal/src/types.rs:216-231` (`Observation`).

Severity is judged for this app: a hackathon desktop wallet against the PayPal **sandbox**.

## Summary

| ID | Severity | Category | File:line | Status | Action |
|---|---|---|---|---|---|
| O-1 | Info | doc vs behaviour (read cadence) | `crates/table-app/src/pipeline/read_state.rs:6-9`, `:22-44`, `:61-68`; `crates/table-app/src/pipeline/resolve.rs:174-182` | closed (comments corrected) | A drop by the cap can bring a backed-off or hourly read forward to the 60 s floor and resets its count; the comments say "never sooner" |
| O-2 | Info | fairness under cap churn | `crates/table-app/src/pipeline/read_state.rs:61-68`; `resolve.rs:178-181` | open | While the cap keeps dropping, the global floor also delays the first read of a brand-new lost step, not only of a dropped one |
| O-3 | Info | schedule reset by owner | `crates/table-app/src/pipeline/resolve.rs:506-516` | open | An owner read that succeeds clears the wallet's backoff; a failed one does not count. By design (§52a); bounded by clicks |
| O-4 | Info | error masking | `crates/table-app/src/pipeline/resolve.rs:168`; `crates/table-app/src/pipeline.rs:1396` | open | A ledger error in `prune_read_state` replaces the step's own result; fails safe |
| O-5 | Info | CPU per tick | `crates/table-app/src/pipeline/read_state.rs:105-109`, `:165-176` | **fixed** `6cb2899` | A key is matched on the deal's canonical id text once per call (`key_names_deal`), with no `DealId` parse per key; still bounded by the cap |

## Answers to the questions

### 1. Can an owner ticket be replayed or reused for more than one read, or a read outside the window?

**Verdict: safe.**

- **One mint point, behind the gate.** The only call of `ApprovalSession::ticket` outside tests is
  `crates/table-runtime/src/service.rs:613`, inside `decide`, after `guard` (label, token, lock;
  `:573`), the selection check (`:574`) and the terms/attempt/MISMATCH/BLOCK check (`:578-584`).
  The ticket is moved into `Pipeline::authorize` in the same `execute` call (`:719-725`).
  `OwnerTicket` is move-only (`Debug` only, `pub(crate)` fields, `auth.rs`), never serialized,
  and never crosses IPC: the webview sends `DecisionArgs` and the `x-wallet-ipc` header
  (`native.rs:79-87`), not a ticket. So a ticket value is spent by construction; the prior scan's
  restart and concurrency analysis (question 1 there) applies unchanged to this path.
- **The spent set.** `owner_read_authorize` inserts `(deal, ticket.at, ticket.generation)` into
  `authorize_owner_read` before the GET (`resolve.rs:465-470`), so a second ticket minted in the
  same second and generation reads nothing (test `one_owner_ticket_gives_one_read_of_a_lost_authorize`,
  `crates/table-app/tests/pipeline.rs:3370`). A refusal before the insert (validation, no
  eligible step, still settling, before the deadline and not parked) spends nothing, and a read
  that fails after it keeps the key spent.
- **Pruning cannot reopen a spent ticket.** `prune_read_state` keeps an entry while
  `at + TICKET_SECS > now` (`read_state.rs:105-107`); `validate` accepts a ticket while
  `expires = at + TICKET_SECS > now` (`auth.rs`). The two bounds are the same inequality, so an
  entry is dropped only once its ticket is already refused. A terminal deal's entries are dropped
  too (`:145-148`); `Pipeline::authorize` refuses any deal not APPROVED (`pipeline.rs:1093-1098`)
  before the spent set is consulted.
- **"The window".** Three windows bound the owner read:
  - the ticket's 60 s life and session generation (`validate`; a lock refuses with `Locked`);
  - the step: only the open authorize of the settled attempt, not a live call (`open_operations`
    lists a `pending` reservation only once stale), not within `SETTLE_SECS`, and only if it is
    parked or the deadline passed (`resolve.rs:453-464`; test
    `before_the_deadline_the_owner_reads_only_a_parked_authorize`, `tests/pipeline.rs:3482`);
  - `PARKED_READ_WINDOW_SECS` bounds the **wallet's own** reads only. Past it the owner read is
    the intended path (§52a), so a read there is by design, not a bypass.
- **The wallet's own reads past the window.** Every automatic read of an authorize, capture or
  void goes through `resolve_deal` (the only callers of `resolve_one`), and `money_read_due`
  returns false once `now - Ledger::deadline >= PARKED_READ_WINDOW_SECS` (`resolve.rs:129-133`,
  `:174-177`). The deadline is durable and never deleted (`set_deadline` upserts; there is no
  delete), so a restart does not reopen it. Every deal with an open authorize, capture or void has
  a deadline row: `send_settle` sets it before a deal can be APPROVED (`pipeline.rs:944`) and
  `confirm_authorization` resets it to the honor period (`resolve.rs:620-625`).

### 2. Can a read on a BLOCK or MISMATCH deal, or with a locked wallet, get through?

**Verdict: safe.**

- **Locked.** `decide` calls `guard` first (`service.rs:573` → `ApprovalSession::check`: label
  `approval`, constant-time token match, then `Locked` if idle-locked). `ticket` re-runs `check`,
  and `owner_read_authorize` re-runs `validate`, which refuses while locked (`resolve.rs:447-448`).
  A lock between mint and use cannot happen: the actor runs one `execute` at a time.
- **BLOCK / MISMATCH.** `decide` refuses `deal.state == Mismatch` or `deal.shield == Block` with
  `Invalid` before the ticket is minted (`service.rs:578-584`). Since that is the only mint point
  (question 1), no ticket exists for such a deal. Belt and braces: a MISMATCH deal is not APPROVED,
  so `Pipeline::authorize` refuses it anyway (`pipeline.rs:1093`). A shield **HOLD** line does not
  stop the read (the `reading` exemption, `service.rs:588-606`), which §52a accepts: nothing moves.
- **The `reading` exemption cannot be turned into a send.** It is computed from
  `has_open_operation` (`service.rs:588-590`), and `Pipeline::authorize` re-checks the same
  predicate in the same actor turn (`pipeline.rs:1099`) and, while it holds, only ever calls
  `owner_read_authorize` or refuses. No mandate, shield or countersign path is reached. The
  exemption also skips `select_signer`; `confirm_authorization` signs nothing, so no key is
  needed.
- A lost authorize on a BLOCK or MISMATCH deal therefore has no owner read; that is §52a's Open
  item, not a finding.

### 3. Can any read path send a POST, capture or void, or move state on a failed read?

**Verdict: safe.**

- **Failed reads.** Each failed GET goes to `defer` (or, for the order read of a CAPTURED capture,
  the equivalent `Deferred` row) and returns `Unavailable`: `resolve_authorize` `:511-516`,
  `resolve_payment` `:653-656`, `confirm_capture` `:835-850`. `record_resolution` with `Deferred`
  carries no event (`resolve.rs:283-287`) and leaves the operation open (`resolution.rs:20`,
  `:190-202`: a repeat writes only the call rows). The `?` in `resolve_deal` (`:163`) stops the
  loop, and every caller treats `Unavailable` as "do nothing this tick": `auto_void` returns
  before reserving a void (`pipeline.rs:1299-1301`), `deadline_default` neither voids nor expires
  (`:1416`, and `Ok(false)` when only parked money is open, `:1445-1446`).
- **The owner read sends nothing.** `owner_read_authorize` makes one `get_order`. In
  `resolve_authorize` with `owner == true` the resend branch is unreachable: an untouched order is
  recorded `absent` under `Deadline` or parked under `Advance` (`:555-571`), before `holds_resend`,
  `may_resend` and `api.authorize` (`:572-591`). `end_unread_authorize` is gated on `!owner`
  (`:537`). A failed owner read does not call `deadline_read_failed` (`:512-514`). Tests:
  `an_owner_read_of_an_authorize_that_fails_is_unavailable_and_leaves_the_deal_open` and
  `a_failed_owner_read_leaves_the_wallets_own_read_schedule_as_it_was`.
- **What a successful wallet read may send** is unchanged by §52/§52b and stays inside the
  invariants: a capture is re-sent only before the deadline under its own re-checked
  non-human authority (`resolve.rs:698-760`, `may_resend` `:298-354`), and a void only as the safe
  default or at the deadline (`:313-314`), never beside an open capture (`:776-782`).
- **Could the `continue` that §52/§52b introduced let a later step act past an unread one?** A
  step in backoff is now passed over (`continue`, `resolve.rs:147-151`) rather than stopping the
  loop, so a later open step of the same deal could be read. It cannot matter: a deal has at most
  one open money operation at a time, because every reserve is gated on `has_open_operation`
  (`pipeline.rs:711`, `:819`, `:1099`, `:1194`, `owner_void` `:266`) or on `resolve_deal`
  returning true (`auto_void` `:1299`). And `resolve_deal` still returns false while the skipped
  step is open (`:165`), so the deal's next step does not run.

### 4. Can eviction drop a pending operation so it is never resolved, or so a later read moves money?

**Verdict: safe as to money; the window close is by design.**

- **The maps hold schedule, not operations.** `parked_read`, `rescue_read_backoff` and
  `rescue_polled` hold times and counts only. The operation itself is a ledger row that eviction
  never touches; `prune_read_state` only reads the ledger (`read_state.rs:112-128`).
- **What each drop does.** Terminal deal, closed step, or a money key past the durable window:
  nothing reads those any more (`resolve_one` returns early for a terminal or moved deal;
  `money_read_due` refuses past the window). A drop by the cap: the step's next read is at the
  60 s floor at the earliest (`read_state.rs:64-68`), never on a 1 s tick. That floor can be
  *earlier* than the dropped schedule (O-1), which costs only reads.
- **No later read moves money because of eviction.** Eviction changes only *when* a read happens.
  What a read may send is decided by the deal's state, the deadline and the recorded authority
  (question 3), none of which is in the evicted maps. A capture is never sent at or after the
  deadline whatever the schedule (`resolve.rs:707`).
- **Never resolved.** Past `PARKED_READ_WINDOW_SECS` the wallet stops reading on its own. A lost
  authorize then has the owner read; a lost capture or void has none and waits AUTHORIZED. This is
  §52b's Open item ("No owner read of a lost capture or void"), not a finding: silence moves no
  money, and the money-check card shows the parked step.

### 5. Are the read maps bounded under an adversarial counterparty (deal-id flooding)?

**Verdict: yes.**

- `parked_read`, `rescue_read_backoff` and `rescue_polled` are capped at `READ_STATE_CAP` (4096)
  on every insert (`read_state.rs:70-96`); all three inserts go through `note_*`.
- The spent-ticket sets hold only tickets minted in the last `TICKET_SECS`, and tickets need the
  owner's unlocked approval window (question 1).
- A counterparty cannot even fill them: an entry exists only for the wallet's **own** lost money
  step whose read **failed** at PayPal (backoff), its own parked step (park), or its own sent
  invoice. A counterparty cannot make the wallet's GET of its own order or authorization fail.
  Reaching the cap needs over 4096 such steps in an outage. This holds for the house seller too,
  which runs the same `Pipeline`.
- Outside these files: the runtime scheduler's `last_poll` (`scheduler.rs:152-156`,
  `service.rs:131`) has one entry per polled AWAITING_APPROVAL deal and is never pruned. §52b
  already lists it as Open. Each entry needs the wallet to have created a PayPal order, which the
  mandate bounds, so it is not a flooding vector either.

### 6. Is the label/token/lock check done before any IO?

**Verdict: yes.** `deal_countersign` passes the window label and the header token into the actor
(`commands.rs:206-219`, `native.rs:79-95`). `decide` runs `guard` as its first statement
(`service.rs:573`), before any ledger read and before any PayPal call. `approval_checks` is
synchronous and calls no PayPal API (`service.rs:512`). The decision row is written only after the
ticket is minted (`:716`). In the pipeline, `owner_read_authorize` runs `validate` before any
ledger read or GET (`resolve.rs:447-448`).

### 7. Does an error leak a secret, token or PayPal id into logs or the client?

**Verdict: no.**

- The owner read's errors are `Permission`, `Locked`, `Unavailable` and
  `LedgerError::Integrity("operation request id")`. Their `Display` text is fixed
  (`table-app/src/agent.rs:10-31`), and `CommandError` carries only that text
  (`table-client/src/lib.rs:33-58`). `after_paypal` swaps a refusal for `STEP_NOT_CONFIRMED` or
  `REACHED_PAYPAL` (`service.rs:758-`). The PayPal error itself is consumed by `defer`, which keeps
  only its observations, and never reaches the client.
- Observations go to `paypal_calls` through `calls()` (`pipeline.rs:749-`), with bodies redacted
  as before. `Observation`'s `Debug` prints only the status (`types.rs:225-231`). No observation
  holds the OAuth token: there is no header field.
- No scoped file logs: there is no `println!`, `eprintln!`, `log::` or `tracing::` in
  `pipeline/`, `pipeline.rs` or `rescue.rs`. The `money.resolved` audit detail names the request id
  (`{deal}-{attempt}-{operation}`, the wallet's own), never an order or authorization id
  (`resolution.rs:225-236`).
- On success `decide` returns the `Deal` to the approval window, PayPal refs included, as every
  decision already does. That is unchanged by these sections.

## Findings

### O-1 (Info): a drop by the cap can bring a read forward to the 60 s floor

`insert_capped` drops the entry with the smallest time (`read_state.rs:31-41`). For
`rescue_read_backoff` that is the smallest `next`; for `parked_read` the oldest last read. After
the drop, the step has no entry, so `money_read_due` answers `!read_floor_holds(now)`
(`resolve.rs:178-181`), and the parked check does the same (`:153-156`). The step is read once the
floor lapses, 60 s after the drop. If every other entry was in its hourly phase, the dropped step's
own next read was up to `PARKED_READ_SECS` away, so it is read up to about an hour sooner. Its count
also restarts at one, so it gets up to `RESCUE_READ_ATTEMPTS` more backed-off reads before it is
hourly again.

The comments say a drop "never makes a read come sooner than its schedule allows"
(`read_state.rs:6-9`, `pipeline.rs:137-141`, and §52b decision 5). The guarantee the code actually
gives is weaker and still sound: "never sooner than the 60 s floor, never past the window".

*Exploit sketch:* none practical. It needs more than 4096 of the wallet's own steps failing to read
at once (question 5). The cost is extra GETs, which move no money. *Action:* report only. Changing
the floor (per-key, or floor = the dropped `next`) is the trade-off §52b already weighed and
rejected ("A per-key floor after a cap drop"). The comment could say "never sooner than
`RESCUE_POLL_SECS` after the drop" next time those lines are edited.

### O-2 (Info): the global floor also delays a brand-new lost step under cap churn

`read_floor_until` is one timestamp for every key (`read_state.rs:61-68`). While the cap keeps
dropping entries, every read with no entry waits, including the **first** read of a step lost just
now, which has no entry yet. When the floor lapses, the first such read in `list_deals` order that
fails pushes it again. A newly lost capture can therefore wait behind dropped ones. §52b's Open item
names only "a deal whose entry keeps being dropped".

*Impact:* a later answer only. Before the deadline, an unread capture blocks the safe-default void
(`auto_void` needs `resolve_deal` to return true), which is the correct direction. Same
reachability as O-1. *Action:* report only.

### O-3 (Info): an owner read that succeeds resets the wallet's backoff

`resolve_authorize` clears `rescue_read_backoff` on any successful `get_order`, the owner's
included (`resolve.rs:506-509`). A failed owner read is not counted (`:512-514`). On a PayPal that
answers the owner's read and then fails again, each click puts the wallet back at the 60 s phase.
This is exactly what §52a specifies ("a read that succeeds clears the wallet's failure count"). It is
bounded by the owner's privileged clicks, at most one per second per deal (R-2), and every read is a
GET. *Action:* accept.

### O-4 (Info): a prune error replaces the step's result

`resolve_deal`, `deadline_default` and `rescue_tick` compute their result, then
`self.prune_read_state(id, now)?` (`resolve.rs:168`, `pipeline.rs:1396`). A ledger error in the prune
is returned instead of the step's `Ok`. By then the step's ledger effects are committed, so the
caller sees an error for work that happened. Every caller treats an error as "nothing more this
tick", and the next tick starts again from the ledger, so this fails safe. *Action:* report only.
Returning `result` first and logging a prune failure would be more accurate, but this module has no
logging and the gain is cosmetic.

### O-5 (Info): pruning scans every key on every call

`prune_read_state` first counts the deal's entries with `read_state_of`, which parses the deal id out
of every key of `parked_read` and `rescue_read_backoff` (`read_state.rs:165-176`). It runs after
every `resolve_deal`, `deadline_default` and `rescue_tick`, so once per affected deal per 1 s tick.
With the maps full, that is about 8k string parses per such deal per tick. Bounded by the cap, and
zero while the maps are empty, which is the normal case. *Action:* report only.

## Known, not re-reported

- **R-3's pattern on the countersign path.** `decide` appends the `owner.decision` "countersign" row
  (`service.rs:716`) before `Pipeline::authorize`. A same-second second click that the spent set
  refuses still leaves that row, with no read after it. Same finding, same fix location
  (`table-runtime`, outside the in-scope files).
- **R-6's pattern.** `one_owner_ticket_gives_one_read_of_a_lost_authorize` presents two tickets minted
  in the same second (`same_ticket`, `tests/pipeline.rs:3170`), not one ticket twice, which cannot
  be written because the ticket is moved.
- **§52a/§52b Open items:** no owner read on a BLOCK or MISMATCH deal; no owner read of a lost capture
  or void; `last_poll` unbounded; reads that succeed but cannot settle (`signer_missing`,
  `holds_resend`) are made on every tick.

## Dependencies, secrets and risky patterns

- **Dependencies.** `e7b95a3..4be16b2` change no manifest and no `Cargo.lock`.
- **Secrets.** Nothing on these paths reads or writes a secret. The IPC token is compared in constant
  time and is not printed (`ApprovalSession`'s `Debug` shows only `locked`).
- **Risky patterns.** The scoped files have no `unwrap`/`expect` outside tests and no `unsafe`. Time
  arithmetic uses `saturating_*`.

## Verification

- `cargo test -p table-app --test pipeline owner`: 11 passed, run before writing (offline,
  `LossyApi`).
- Gates at the end of this branch: `cargo fmt --all --check`,
  `cargo clippy --workspace --exclude table-desktop --all-targets -- -D warnings` and
  `cargo test --workspace --exclude table-desktop`. `table-desktop` is excluded because its
  `generate_context!` needs the gitignored `client/dist`, which this worktree does not have.

## Decisions-style note

No fix was made, so no decision is recorded. If O-1 is taken up, the note would read: *"After a drop
by the cap, a read with no schedule entry waits at least `RESCUE_POLL_SECS` from the drop. It may come
sooner than the dropped entry's own schedule, never on a 1 s tick, and never past the window."*

## Closed 2026-10-21 (belay wave 5)

O-5 was fixed in `6cb2899`: the scan compares each key against the deal's id text, which every key is
built from, so the same keys match. No timing was measured; the maps stay capped at 4096 entries.
O-4 stays open: its report-only verdict holds.
