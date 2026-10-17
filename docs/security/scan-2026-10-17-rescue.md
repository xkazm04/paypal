# Security scan - The Table - subscription rescue, owner read - 2026-10-17

A focused scan of the subscription-rescue path after DECISIONS §51b: `Pipeline::rescue_approve`,
the new `Pipeline::rescue_owner_read` (`919c5dd`), the in-memory spent-ticket set beside them,
`OwnerTicket` minting and validation, and the desktop `rescue_approve` command that carries the
owner's decision there. Base: `919c5dd`, branch `autopilot/codebase-security-scan-6c541480`.
**Nothing at medium or higher was found, so nothing was fixed. Every item is report only.** No live
PayPal call was made and no money was used. The only network-free tool run was
`cargo deny --offline check advisories` against the local advisory database.

Scope:
- `crates/table-app/src/rescue.rs` (`rescue_approve` :427-488, `rescue_owner_read` :496-512,
  `rescue_poll` :648-703, `rescue_deadline` :759-847).
- `crates/table-app/src/pipeline.rs` (`rescue_owner_read: BTreeSet<(DealId, Timestamp, u64)>`
  :129-132, built empty in `Pipeline::new` :360-368; `authority` :430-).
- `crates/table-app/src/auth.rs` (`OwnerTicket` :27-35, `ApprovalSession::new` :75-85, `unlock`
  :114-129, `ticket` :130-151, `validate` :152-172).
- `apps/desktop/src-tauri/src/native/commands.rs:265-279` (`rescue_approve`).

I also read, without changing them: `crates/table-runtime/src/service.rs:566-668` (the `Decision`
handler that mints the ticket), `crates/table-runtime/src/actor.rs:572-600` (the actor loop),
`crates/table-ledger/src/rescue.rs:257-` (`record_rescue_paid`), `table-ledger/src/redaction.rs`
and `crates/table-paypal/src/secondary.rs:286-294` (`get_invoice`). Where an item leads there it is
named and left unchanged.

Severity is judged for this app: a hackathon desktop wallet against the PayPal **sandbox**.

## Summary

| ID | Severity | Category | File:line | Status | Action |
|---|---|---|---|---|---|
| R-1 | Low | defence in depth (ticket binding) | `crates/table-app/src/auth.rs:27-35`, `:75-85`, `:152-172` | open | Bind an `OwnerTicket` to the session that minted it (a random per-session id checked in `validate`) |
| R-2 | Info | rate / audit volume | `crates/table-app/src/rescue.rs:496-512`; `crates/table-runtime/src/service.rs:664-666` | open | Accept: one GET per privileged owner decision, at most one per deal per second |
| R-3 | Info | audit legibility | `crates/table-runtime/src/service.rs:664` (outside scope) | open | The owner read is logged as an `owner.decision` "rescue" row, also when the spent set then refuses it |
| R-4 | Info | memory | `crates/table-app/src/pipeline.rs:132` | open | The spent set is never pruned (one tuple per owner read); entries older than 60 s could be dropped |
| R-5 | Info | cadence side effect | `crates/table-app/src/rescue.rs:657`, `:819-825` | open | An owner read stamps `rescue_polled`, so the wallet's own deadline read waits up to 60 s more |
| R-6 | Info | test naming | `crates/table-app/tests/rescue.rs:1513-1528` | open | `one_ticket_gives_one_owner_read` presents two tickets minted in the same second, not one ticket twice (a ticket cannot be presented twice: it is moved) |

## Answers to the two questions

### 1. Restart replay: can a restart let the same ticket be replayed inside its 60 s expiry for a second owner read?

**Verdict: safe. Not reachable.** There is nothing to replay, because a ticket never leaves the
process, and it is not even kept between two IPC calls inside one process.

- **Where a ticket lives between mint and use.** It is a Rust value inside one actor call:
  - The webview sends `rescue_approve` with `DecisionArgs` (deal id, terms hash, attempt, checks
    hash) and the IPC token (`commands.rs:265-279` → `ask(... Action::Decision(args,
    Decision::Rescue))`). No ticket crosses IPC in either direction.
  - The runtime checks the token, the selection, the terms hash, the attempt and the checklist
    hash (`service.rs:573-604`), then mints the ticket with the runtime clock
    (`service.rs:606-613`), and moves it into `rescue_approve` a few lines later
    (`service.rs:666`), in the same `execute` call.
  - `OwnerTicket` derives only `Debug` (`auth.rs:27`): no `Clone`, `Copy`, `Serialize` or
    `Deserialize`. Its fields are `pub(crate)` (`auth.rs:29-34`), so no crate but `table-app`
    can build one; the only constructor is `ApprovalSession::ticket` (`auth.rs:143-150`).
    `rescue_approve` takes it by value, so one ticket value can be used once by construction.
  - Nothing persists it: it is not written to the ledger, the audit log or any file.
- **`generation` restarts at 0 on every launch.** True: `ApprovalSession::new` sets
  `generation: 0` (`auth.rs:82`), and `unlock` increments it (`auth.rs:125`), so the first unlock
  of every launch is generation 1. A ticket from a previous process *would* match generation 1 if
  it could be presented, but it cannot reach the new process (above). The thing that crosses IPC,
  the approval token, is 32 fresh random bytes per process (`auth.rs:76-79`), so a token from the
  previous launch fails `token_matches` and no ticket is minted.
- **What binds a ticket to its process.** Only the fact above: it is a move-only in-memory value.
  There is no per-process key or nonce *in* the ticket. That is R-1 (Low): in a test, a ticket
  minted by one `ApprovalSession` validates in another whose generation happens to match (the
  rescue tests' `Rig::restart` builds exactly such a second pipeline, `tests/rescue.rs:1329-1340`).
  Production has one `ApprovalSession` per `Pipeline` and one pipeline per runtime, so this is
  defence in depth only.
- **Mid-session lock and unlock.** An idle lock sets `locked` (`auth.rs:91-96`); `validate`
  refuses while locked (`auth.rs:160-162`). An unlock bumps the generation (`auth.rs:125`), and
  `validate` refuses a ticket from an earlier generation (`auth.rs:166`; unit test
  `auth.rs:209-233`). Because the ticket is minted and used in the same call, a lock between mint
  and use cannot happen anyway: the actor does nothing else in between.
- **Two concurrent `rescue_approve` calls.** They cannot interleave. The runtime is one actor:
  each `Message::Execute` is awaited inline before the next message is received
  (`actor.rs:591-592`), and `rescue_approve` takes `&mut self`. The second call mints its own
  fresh ticket:
  - in the same second and generation, its spent-set key `(deal, at, generation)` equals the
    first's, so `insert` returns false and it is refused with `Permission` before any read
    (`rescue.rs:505-510`);
  - in a later second, it is a new owner decision and gets its own one read. That is the design
    (§51b: one read per owner ticket), not a replay.
- **Does a restart change anything?** A restart empties the spent set (`pipeline.rs:368`), but
  every ticket of the old process died with it, and the new process mints new tickets only on new
  privileged decisions. So the in-memory set is enough. It is not what stops a cross-restart
  replay; the move-only, never-serialized ticket is.
- **Impact if a second read were reachable (it is not).** One more `GET
  /v2/invoicing/invoices/{id}` (`secondary.rs:286-294`), one more `paypal_calls` row, and, through
  the runtime, one more `owner.decision` audit row (R-3). No money moves. A ledger state change
  cannot happen twice: `rescue_poll` requires `AwaitingApproval` (`rescue.rs:650-652`), and
  `record_rescue_paid` re-checks `AwaitingApproval`, the invoice id, the amount and a confirmed
  send inside its transaction (`table-ledger/src/rescue.rs:272-289`). So a second PAID read after
  RECEIPTED is refused (`Invalid`), and no receipt is written twice. Impact: informational, so no
  fix is made.

### 2. Mandate and shield skip: can anything on the owner-read path create, send, cancel, capture, void, expire or park?

**Verdict: safe.** Skipping the mandate and the shield is acceptable because the path makes one
PayPal call, a GET, and its only ledger effects are the same PayPal-driven outcomes the wallet's
own poll records.

- **The full call tree.** `rescue_owner_read` (`rescue.rs:496-512`) runs `validate` and then the
  spent-set `insert`, then `rescue_poll` (`rescue.rs:648-703`). That function:
  - re-checks `kind == Rescue` and `state == AwaitingApproval` (`:650-652`);
  - stamps `rescue_polled` (`:657`; R-5);
  - makes the one PayPal call, `api.get_invoice` (`:658`), which is `GET
    /v2/invoicing/invoices/{id}` with no body (`secondary.rs:286-294`);
  - records the observations as `paypal_calls` rows (`:661-668`); the bodies go through the
    allowlist redaction (`table-ledger/src/redaction.rs:3-33`), so the recipient's email is not
    kept;
  - on a mismatched invoice applies `DealEvent::Mismatch` (`:669-674`): a dead end, and no money
    step proceeds from MISMATCH (the runtime refuses any decision on a MISMATCH deal,
    `service.rs:580`);
  - on PAID with nothing due signs a receipt and calls `record_rescue_paid` (`:681-694`), which
    moves the deal to RECEIPTED and counts it as recovered. That is accounting from PayPal's own
    answer, guarded in the ledger as above. Without the agent key PAID waits (`:680`);
  - on CANCELLED applies `DealEvent::Fail` (`:695-698`): terminal, nothing moves;
  - anything else changes nothing (`:699`).

  None of these is a create, send, cancel, capture, void, expire or park. `rescue_owner_read`
  never calls `rescue_deadline`, `apply_deadline_default`, `park`, `reserve_operation`,
  `countersign` or any POST of `SecondaryApi`. The parking and backoff map (`rescue_read_backoff`)
  is touched only by `rescue_deadline` and `read_failed`, neither of which this path reaches.
  Tests: `an_owner_ticket_reads_a_sent_invoice_past_the_window_and_records_paid`,
  `an_owner_read_that_finds_the_invoice_unpaid_changes_nothing_and_only_reads` (asserts no POST
  and no write at the fake PayPal, `tests/rescue.rs:1453-1487`).
- **Could a later money step trust what the read wrote?** No. The states it can write are
  RECEIPTED, FAILED (terminal) and MISMATCH. The only rescue money steps are `invoice-create` (from
  AGREED) and `invoice-send` (from SETTLING with a recorded decision) in `rescue_approve`
  (`rescue.rs:456-486`), and the resend in `resolve_invoice_send` (`rescue.rs:1074-1107`), which
  needs an open operation. None of these starts from RECEIPTED, FAILED or MISMATCH, and the deal
  state machine has no edge back to AGREED or SETTLING from them (`table-core/src/deal.rs:325`
  is the only way into AWAITING_APPROVAL).
- **The branch condition** (`rescue.rs:441-444`): `deadline <= now && state == AwaitingApproval`.
  - It runs only after `kind == Rescue && side == Seller` (`:434-436`) and after the open-operation
    check (`:437-440`), so a deal with a step still in flight goes to `rescue_resolve`, as before.
  - A deal in another state cannot reach it: the state is read from the ledger, not from the
    caller, and `rescue_poll` checks it again.
  - It replaces only a refusal: before §51b an AWAITING_APPROVAL rescue fell to `_ =>
    Err(Permission)` (`:486`) whether or not its deadline had passed, so no money path was
    diverted.
  - The deadline is not attacker controlled. For an AWAITING_APPROVAL rescue it is set by the
    wallet's own clock plus a constant when the send is confirmed (`send_invoice`, `:602-607`;
    `confirm_invoice_sent`, `:1135-1140`, from `op.started_at`). The caller sends no deadline;
    `DecisionArgs` has none. Even a wrong deadline would only open a GET earlier.
- **A failed read** returns `Unavailable` and still spends the ticket. The `insert` happens before
  `rescue_poll` (`rescue.rs:505-511`), so a failure inside it (no client: `invoicing()`, `:129-
  132`; no invoice id; the GET failing at `:658-665`) leaves the key spent. The GET failure keeps
  its call rows (`:660-662`) and returns `Unavailable` (`:663`); it does not touch the backoff or
  park. Test: `an_owner_read_that_fails_is_unavailable_keeps_its_call_and_leaves_the_deal_open`
  (`tests/rescue.rs:1489-1511`).
- **The pre-existing money path still runs mandate and shield.** For AGREED and SETTLING,
  `rescue_approve` calls `self.authority(&deal, category, Authority::Owner(ticket), 1, now)`
  (`rescue.rs:451`) and then `shield_allows(..., MoneyStep::Create)` (`:452-454`) before any
  write. `authority` runs `wallet.mandate_check` (`pipeline.rs:448`) and refuses any non-owner
  authority for a rescue (`pipeline.rs:445-447`). The lost-send resend runs the same pair
  (`rescue.rs:1086-1096`). The runtime also refuses before the ticket if the checklist has a
  failing line or the deal's shield verdict is BLOCK (`service.rs:575-603`). Test:
  `every_refusal_comes_before_any_paypal_call` (`tests/rescue.rs:481`).

## Findings

### R-1 (Low): a ticket is not bound to the session that minted it

`OwnerTicket` carries deal, terms hash, attempt, generation, expiry and mint time
(`auth.rs:27-35`), and `validate` compares them against the live session (`auth.rs:152-172`).
Nothing in the ticket names *which* `ApprovalSession` minted it, and `generation` starts at 0 in
every session (`auth.rs:82`). So any two sessions whose unlock count matches accept each other's
tickets. Not reachable in production (question 1: one session per process, the ticket never leaves
the actor call). Recommended, if a second session ever appears (for example a hosted runtime): a
random `session: [u8; 16]` set in `new`, copied into the ticket and compared in `validate`. Not
fixed: below the medium bar.

### R-2 (Info): owner reads are bounded only by owner decisions

Each privileged `rescue_approve` past the deadline gives one GET. The spent set refuses a second
ticket in the same second (key `(deal, at, generation)`, `pipeline.rs:132`), so the ceiling is one
GET per deal per second, and only from an unlocked approval window holding the IPC token, which
could already approve money. Accepted.

### R-3 (Info, outside scope): an owner read is logged as an owner decision

The runtime appends an `owner.decision` row for `Decision::Rescue` before calling
`rescue_approve` (`service.rs:664`, `record_decision` `:538-`). For an owner read nothing is
decided, and when the spent set refuses a same-second second click that row still stands with no
read after it. It is append-only and truthful about the click, but a reader could take it for an
approval. If the trail must tell them apart, a distinct action (for example `owner.read`) belongs in
`table-runtime` and `table-ledger/src/audit_detail.rs`, outside this scan's paths.

### R-4 (Info): the spent set is never pruned

One `(DealId, Timestamp, u64)` per owner read, for the life of the process. Bounded by owner clicks,
so negligible. A ticket older than 60 s can never validate, so entries with `at < now - 60` could be
dropped on insert.

### R-5 (Info): an owner read delays the wallet's own deadline read by up to 60 s

`rescue_poll` stamps `rescue_polled` (`rescue.rs:657`), and inside the 30-day window the wallet's
own deadline read waits `RESCUE_POLL_SECS` after any poll (`rescue.rs:819-825`). Harmless: the read
it delays has just happened.

### R-6 (Info): the one-read test exercises two tickets

`one_ticket_gives_one_owner_read` (`tests/rescue.rs:1513-1528`) mints two identical tickets in the
same second and shows the second is refused. That is the real guarantee (one read per mint second);
"one ticket twice" cannot be written, because `rescue_approve` takes the ticket by value. A name such
as `a_second_ticket_in_the_same_second_reads_nothing` would say what it proves.

## Dependencies, secrets and risky patterns

- **Dependencies.** The rescue commits `a644b19` and `919c5dd` change no manifest and no
  `Cargo.lock` (the last lockfile change is `2eb9061`, the rustls bump).
  `cargo deny --offline check advisories` reports `advisories ok` against the local advisory
  database (snapshot of 2026-10-15; not refreshed, as no network was used).
- **Secrets.** No secret is read or written on the owner-read path. The IPC token is compared in
  constant time (`auth.rs:39-52`) and is not logged (`ApprovalSession`'s `Debug` prints only
  `locked`, `auth.rs:20-26`). The invoice GET bodies are reduced to the allowlist before storage
  (`redaction.rs`). The subscriber email from the detect read is redacted besides (`rescue.rs:385-
  405`).
- **Risky patterns.** There is no `unwrap`/`expect` outside tests in the scoped files, and no
  `unsafe`. The arithmetic uses `saturating_*` and `checked_add`.

## Decisions-style note

No fix was made, so no decision is recorded. If R-1 is taken up, the note would read: *"An owner
ticket names the approval session that minted it; a ticket from another session is refused even at
the same generation (defence in depth; one session per process today)."*
