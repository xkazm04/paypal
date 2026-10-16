# Security scan - The Table - relay path - 2026-10-16

A focused scan of the relay path that `096a689` changed: the 72 h recovery window and the decaying
poll cadence for settled deals (DECISIONS section 46). Base: `096a689`, branch
`autopilot/codebase-security-scan-bd960234`. **One finding was fixed (R-1, commit `fb954eb`, with its
test). Every other item is report only.** No live PayPal call was made and no money was used. The only
network use was the RustSec advisory fetch (`cargo deny`).

Scope: `crates/table-ledger/src/relay.rs`, `crates/table-runtime/src/relay.rs`,
`crates/table-runtime/src/service.rs`, with their tests in `crates/table-ledger/src/tests.rs` and
`crates/table-runtime/src/house_tests.rs`. Where a finding leads outside these files it is named and
left unchanged.

Three questions, answered separately:

1. **Risky code on the relay.** No relay message, replayed or malformed, can settle a deal twice or
   move money. The relay layer only stages raw text and cursors. Deal state moves only through the
   signed-envelope path, and the window and cadence only decide *when the wallet polls*. Every field
   the relay controls is bounded before it is stored. The deal ids, cursors and window arithmetic
   cannot overflow. One Medium liveness bug in the new cadence could keep a settled route from being
   polled for most of the window. It is **fixed** (R-1). What remains is Low: behaviour when the clock
   goes backwards, and local scan work that grows with the number of deals.
2. **Secrets or personal data logged or persisted.** None. The three files log nothing. Rejected relay
   text reaches the audit log only as digests, and the vault is read only for presence. One Info item:
   the mailbox address is persisted in an audit row (R-6).
3. **Dependency advisories** (crates these files import directly). None. `cargo deny check advisories`
   reports `advisories ok`, against the RustSec DB at `f28da8c` (2026-10-16). Nothing was bumped.

It also gives a judgement on the open signed-haggle must-address line about the four-word check:
**a real but Low exposure for the submission**. The smallest fix is a commitment step (section 4).

Severity is judged for this app: a hackathon desktop wallet against the PayPal **sandbox**, plus the
public HOUSE + relay service on Render.

## Summary

| ID | Severity | Category | File:line | Status | Action |
|---|---|---|---|---|---|
| R-1 | Medium | liveness of recovery / unfair scheduling | `crates/table-ledger/src/relay.rs:44-64` (was `:43-60`); `crates/table-runtime/src/relay.rs:51-59` | **fixed** `fb954eb` | `due()` only filters; the runtime marks the routes it actually sent with `polled()` after the cut to four |
| R-2 | Low | clock goes backwards / future-skewed settlement | `crates/table-ledger/src/relay.rs:53`, `:219-220` | open | Count a `last` later than `now` as due; clamp a settlement time later than `now` |
| R-3 | Low | clock goes backwards (reset rate limit) | `crates/table-ledger/src/relay.rs:280` | open | Treat `now < changed_at` as "window elapsed", or keep the refusal and document it |
| R-4 | Low | local work grows with lifetime deals | `crates/table-ledger/src/relay.rs:185-236`, `:137-156` | open | Skip retired routes in SQL (join `deals`), or record retirement on the route |
| R-5 | Low | HOUSE does not use the cadence (outside scope) | `services/house-seller/src/hosted.rs:639-650` | open | Hold a `SettledPollClock` in the HOUSE `Seller`; call `relay_work_at(now)`, `due`, `polled` |
| R-6 | Info | data persisted (relay address) | `crates/table-ledger/src/relay.rs:161-170` | open | None needed; note that the mailbox is a read/post capability on the relay, not a money credential |
| R-7 | Info | arithmetic hygiene | `crates/table-runtime/src/service.rs:885` | open | `saturating_add` for the purchase deadline |
| S-1 | Low | pairing SAS (signed-haggle must-address line) | `crates/table-proto/src/pairing.rs:151-166`; `crates/table-runtime/src/pairing.rs:381-407` (before the fix) | **fixed** `77edf63` | Commit-then-reveal for the initiator's identity (section 4; DECISIONS section 47) |

## 1. Risky code patterns on the relay

**Method.** I read the three files in full, plus the `096a689` diff and the code they call on the relay
path:
- `table_relay::Batch::validate` (`crates/table-relay/src/lib.rs:61-75`);
- `table_app::drain_inbox` (`crates/table-app/src/relay.rs:70-108`);
- the deal transition writer (`crates/table-ledger/src/repositories.rs:250-284`);
- the HOUSE tick that also drives `relay_work` (`services/house-seller/src/hosted.rs:624-736`).

For each relay-controlled field I traced where it is bounded, and for each time comparison I traced
what happens when the clock jumps.

**What is sound.**
- **No double settlement, no money from the relay.**
  - `stage_relay_batch` (`relay.rs:252-322`) writes only to `relay_inbox` and the route cursor. It
    never touches a deal.
  - `drain_inbox` applies a message whose exact hash is already a verified envelope as a no-op
    (`crates/table-app/src/relay.rs:83`). Anything else goes through `receive_relay`, the
    signed-envelope verifier.
  - The relay window decides only whether a route is polled, never a deal state.
  - A replayed SETTLE or RECEIPT therefore either matches an envelope already held (no state
    change) or is verified again and rejected.
  - Silence moves nothing: when the window expires, the route is merely not polled.
- **Owed envelopes are never retired.** `relay_work_at` returns a route that still owes envelopes
  regardless of state or window (`relay.rs:217`). The test
  `receipted_route_that_owes_envelopes_is_delivered_after_the_window` covers this.
- **The audit trail is not skipped.**
  - Every rejected message lands in exactly one `envelope.rejected` row per deal and generation,
    holding digests only (`relay.rs:389-438`).
  - Exact duplicates write no row because nothing changed.
  - `relay.bound` is appended in the same transaction as the route (`relay.rs:157-171`).
  - No path in these files updates or deletes `audit_log`. The `DELETE` at `relay.rs:287` touches
    only transport staging rows already `applied` or `rejected`.
- **Relay-controlled input is bounded before storage and before work.**
  - Each `Batch` is validated in the runtime (`crates/table-runtime/src/relay.rs:194`, `:211`) and
    again in the ledger (`relay.rs:260-266`). Both check:
    - a 32-hex generation;
    - `after + len <= 256`;
    - each message at most 16 KiB of ASCII.
  - `INBOX_CAP` (1024 rows per deal) is checked inside the transaction, so a breach rolls back.
  - A generation reset is rate-limited to one per 10 minutes per route (`relay.rs:280`).
  - A pass sends at most four routes (`crates/table-runtime/src/relay.rs:57`).
  - Batch rejection is capped at 256 messages (`relay.rs:397`).
- **The §46 bound is not attacker-driven.**
  - Whether a route is settled, and when, comes from the local audit log
    (`receipted_at`, `relay.rs:240-250`, the first `deal.transition` to `RECEIPTED`). No relay field
    feeds it.
  - The only writer of that row is `repositories.rs:276-283`, so every Receipted deal has one.
  - A missing row ages from 0 and is retired, never polled forever.
- **No overflow.**
  - Positions are `u64`, bounded to 256 before the `as u32` casts (`relay.rs:297`, `:314`).
  - The cursor is read back as a `u32` widened to `u64`.
  - Every time difference uses `saturating_sub`.
  - The failure backoff shift is capped at `1 << 5` (`crates/table-runtime/src/relay.rs:118-122`).
  - `relay_offset % work.len()` runs only on non-empty work, and `relay_offset` saturates.
  - Deal ids are parsed with `.parse()` into `DealId`; a bad row is `Integrity`, not a panic.
- **Acknowledgement races are safe.** If the relay resets between the first poll and a send, the
  acknowledgement is recorded under the old generation, and the next pass resends under the new one.
  A refused batch skips the acknowledgements entirely (`crates/table-runtime/src/relay.rs:103-105`).
  A duplicate costs nothing (see above).

### R-1 (Medium, fixed in `fb954eb`) - a settled route cut from a pass waited as if it had been polled

- **Where:** `SettledPollClock::due` (`crates/table-ledger/src/relay.rs`, previously `:43-60`), called
  from `start_relay` (`crates/table-runtime/src/relay.rs:51-57`).
- **What:** `due` marked every due settled route as polled at `now`. `start_relay` then rotated the list
  and cut it to four routes. The routes that were cut were never polled, yet each now waited a full
  `recovery_interval`, which is an hour once a deal is an hour past settlement.
- **When it bites:** any wallet with more than four routes due at once. That is most likely after a
  restart, when `last` is empty and every settled route is due on the first pass. Routes past their
  first hour then share the same `last` and come due together again every hour. Only four of them are
  polled each time, so with *M* such routes each one is polled about once every *M*/4 hours. With 100
  settled deals inside the window, a route goes about 25 h between polls. A relay restart (or the
  relay's 24 h mailbox expiry) is then not noticed for most of the 72 h window, and the counterparty
  that is missing the signed history (a RECEIPT) does not get it back. No money moves, because both
  wallets keep their safe defaults. But the recovery window that §46 promises is not met.
- **Fix:** `due()` only filters. A new `SettledPollClock::polled(&sent, now)` marks the settled routes
  that were actually sent, and `start_relay` calls it after the rotation and the cut to four
  (`crates/table-runtime/src/relay.rs:59`). A route left out stays due and the rotation reaches it on a
  following pass.
- **Test:** `settled_route_left_out_of_a_pass_stays_due_until_it_is_sent` in
  `crates/table-ledger/src/tests.rs`. Before the fix it failed (`left: 0, right: 1`). The existing
  cadence test `settled_route_is_polled_on_a_decaying_cadence_then_retired` now marks what each
  simulated pass sends, and its schedule assertions are unchanged.
- **Residual (Info):** `polled()` marks a route when the pass is dispatched, not when the poll succeeds.
  A settled route whose poll failed waits its interval (at most an hour, inside the window) on top of
  the relay-wide backoff. That matches the cadence §46 accepted. Marking on success in
  `relay_finished` would tighten it; this needs no owner decision.

### R-2 (Low) - a clock that goes backwards, or a settlement time in the future

- **Where:** `crates/table-ledger/src/relay.rs:53` (`now.saturating_sub(*last) >= ...`) and `:219-220`
  (`now.saturating_sub(at) >= RECOVERY_WINDOW_SECS`).
- **What:**
  - If the clock steps back by *X*, a settled route already polled at the later time is not due again
    until the clock catches up: a delay of *X* plus the interval.
  - If a deal was receipted while the clock ran ahead (`at > now` after correction), its age is
    negative. The cadence then clamps to the 5 s base, and the route stays in the window until the clock
    reaches `at + 72 h`.
  - So a far-future skew at settlement polls one route every 5 s for the length of the skew. Each poll
    is capped and is one of four per pass.
- **Why Low:** the wallet's clock is the system clock, which the relay does not control. No money moves
  and no audit row is skipped; the effect is only a delayed or extra poll.
- **Action:** in `due`, treat `last > now` as due (and overwrite it). In `relay_work_at`, clamp a
  settlement time later than `now` to `now`, so the cadence decays from the corrected clock.

### R-3 (Low) - the generation-reset rate limit and a clock that goes backwards

- **Where:** `crates/table-ledger/src/relay.rs:280`.
- **What:** `now.saturating_sub(changed_at)` is negative after a backwards step, so a legitimate relay
  reset is refused until the clock passes `changed_at + 600`. That delays recovery for the deal by the
  size of the step.
- **Why Low:** refusal is the safe direction (the doc comment at `:69-73` already says a refused reset
  only delays). The relay cannot cause the step.
- **Action:** count `now < changed_at` as an elapsed window, or keep the refusal and note it next to the
  constant.

### R-4 (Low) - the relay scan does work for every route ever bound, every second

- **Where:**
  - `relay_work_at` (`crates/table-ledger/src/relay.rs:185-236`) reads every `relay_routes` row on
    every pass (about 1 Hz from the actor tick). For each row it runs the outgoing query and
    `read_deal`, and for a quiet Receipted route also `receipted_at`. Retired routes are skipped only
    *after* those queries.
  - `bind_relay` (`:137-156`) likewise reads every route to count the live ones.
- **What:** §46 bounded the *network* polling, but the local scan still grows linearly with the
  wallet's lifetime count of relay deals. An attacker can only grow it by completing paired deals,
  which needs a pairing (or a HOUSE table, under the HOUSE daily limit) per deal.
- **Action:** select only candidate routes in SQL: join `deals`, and keep a route when it owes
  envelopes, is not terminal, or is `RECEIPTED`. Alternatively, record retirement on the route row. Do
  not delete the route row, because `bind_relay` relies on it to refuse a rebind to a different mailbox
  (`:120-131`).

### R-5 (Low, outside the five files) - the HOUSE polls settled routes every tick for the window

- **Where:** `services/house-seller/src/hosted.rs:639-650` calls `relay_work()` (the system clock) and
  delivers every entry each tick. There is no `SettledPollClock` and no cut to four.
- **What:** the decaying cadence of §46 does not apply on the public HOUSE. Each settled HOUSE route is
  re-created and polled every tick for 72 h. The window is also measured at the system clock while the
  rest of the tick uses the injected `now`. The relay is in-process, so each poll is cheap; the cost is
  CPU and SQLite work that scales with HOUSE deals settled in the last 72 h.
- **Action (not taken, file outside scope):** hold a `SettledPollClock` in `Seller`, then call
  `relay_work_at(now)`, then `due`, then `polled`, the same as the wallet.

### R-7 (Info) - one non-saturating time addition

- **Where:** `crates/table-runtime/src/service.rs:885`
  (`self.clock.now() + PURCHASE_DECISION_WINDOW_SECS`).
- **What:** this overflows only for a clock near `i64::MAX`. No relay or counterparty field reaches it.
- **Action:** `saturating_add`, for consistency with the rest of the file.

## 2. Secrets and personal data logged or persisted

**Method.** I read the three files for every `log`, `tracing`, `eprintln!`, `println!`, `format!`,
audit `detail`, SQL write and vault access, and followed each value written to its source.

**What is clean.**
- **Neither relay file logs anything.** The runtime maps relay failures to fixed words ("Table paused;
  relay delivery will retry", `crates/table-runtime/src/relay.rs:123`) with no transport detail.
- **Rejected relay text is never written to the audit log**, only SHA-256 digests (`raw_hashes`,
  `crates/table-ledger/src/relay.rs:417-431`). The raw text sits in `relay_inbox` as transport staging.
  It is pruned on a generation reset once applied or rejected (`:287`) and capped at 1024 rows per
  deal.
- **`service.rs` reads the vault only for presence** (`paypal.sandbox` and `channel3`, `:351-358`,
  returning `is_some()`).
  - Signing keys are loaded and never formatted.
  - The keys and words inside `PendingPair` have a redacting `Debug` (`:83-87`).
  - The `owner.decision` audit row holds only hashes, an attempt number and the decision name
    (`:510-533`).

### R-6 (Info) - the mailbox address is persisted in the audit log

- **Where:** `relay.bound` (`crates/table-ledger/src/relay.rs:161-170`) stores the mailbox, which is
  H(H(code) || deal id) (`:88-105`).
- **What:** the mailbox is not a secret in the keychain sense, and it gives no authority over money.
  But anyone who learns it can read the deal's signed envelopes off the relay, or post junk to it.
  Junk is rejected and costs one audit row per batch. The pairing code itself is never persisted:
  only its hash is (`pairing_mailboxes.code_hash`).
- **Action:** none needed. If audit rows are ever exported or published in full, treat the `mailbox`
  field as a relay capability and drop it from the export.

## 3. Dependency advisories (direct imports of the scoped files)

| File | External crates imported directly | Locked version | Advisory |
|---|---|---|---|
| `crates/table-ledger/src/relay.rs` | `rusqlite` (with `libsqlite3-sys`), `serde_json` | 0.38.0 (0.36.0), 1.0.151 | none affecting these versions |
| `crates/table-runtime/src/relay.rs` | `tokio` | 1.53.1 | none affecting this version |
| `crates/table-runtime/src/service.rs` | `ed25519-dalek`, `serde_json`, `tokio` | 2.2.0, 1.0.151, 1.53.1 | none affecting these versions |

The workspace crates they import (`table-core`, `table-relay`, `table-client`, `table-ledger`,
`table-app`, `table-paypal`, `table-proto`) are first-party.

`cargo deny check advisories` was run in the worktree and printed `advisories ok`, with the RustSec DB
at `f28da8c` (2026-10-16). The DB's entries for these crates all affect older versions:
- `rusqlite`: RUSTSEC-2020-0014, RUSTSEC-2021-0128;
- `tokio`: RUSTSEC-2021-0072, -2021-0124, -2023-0001, -2023-0005, -2025-0023;
- `ed25519-dalek`: RUSTSEC-2022-0093, fixed in 2.0.

Nothing was bumped; `Cargo.toml` and `Cargo.lock` were not touched.

## 4. Judgement: the signed-haggle line on the four-word check

> "The four-word check has no commitment step and only 24 bits, so it stops a relay that lacks the code
> but not one that has it."

**The statement is accurate. It is a real exposure, but Low for this submission.**

- **How the check works.** The words are the first 24 bits of SHA-256(buyer key || seller key || code)
  (`crates/table-proto/src/pairing.rs:151-166`). The initiator publishes its signed identity first. The
  joiner sees it, then replies with its own (`crates/table-runtime/src/pairing.rs:381-407`). Nothing
  makes either side fix its key before seeing the other's.
- **The attack.** An attacker in the relay position who also *has the code* can sit between owners A
  and B:
  - It answers A with a key M1 and offers B a key M2.
  - Once B's reply fixes B's words, it grinds M1 until A's words match B's. That takes about 2^24 key
    generations: minutes on one core, seconds in parallel.
  - Both owners then read the same four words and confirm.
- **Without the code, the words are close to irrelevant.** The code has 128 bits of entropy and the
  relay only ever sees its hash (`mailbox_hash`). An attacker without the code cannot produce bundles
  that carry the right `code_hash`, so it is stopped before the words matter.
- **What the words actually guard.** Only the case where the code leaked, for example pasted into a
  channel the attacker reads, *and* the attacker is the relay or controls the path to it. In that case
  they add no protection.
- **Impact if it happens.** A pinned impostor counterparty. It can negotiate, and it can declare its
  own `payee`. It cannot move money:
  - outgoing money still needs the owner in the `approval` window and the buyer's approval on PayPal;
  - the app is sandbox-only.
- **HOUSE pairing is not affected.** It is pinned by the release identity
  (`crates/table-runtime/src/pairing.rs:599-611`), not by the words.
- **Rating:** Low for the submission. It is not a blocker. It is worth stating honestly in the threat
  model, because the UI presents the four words as the check against a relay in the middle.
- **Smallest fix (not made; outside the five files):** a commit-then-reveal on the initiator's side,
  as in ZRTP or Bluetooth numeric comparison:
  1. The initiator's first publication carries only `commit = H(initiator bundle || nonce)`.
  2. The joiner publishes its full bundle.
  3. The initiator then reveals its bundle and nonce.
  4. The joiner checks it against `commit` before computing the words.

  An attacker must then fix M1 before it learns A's key, and M2 before it learns B's, so each attempt
  succeeds with only 2^-24, and a failed attempt shows up as a mismatch the owners abort on. The change
  touches `table-proto` (one field on `PairingIdentity`, or a separate commit message), the pairing
  flow in `crates/table-runtime/src/pairing.rs`, and the client pairing steps. The cheaper alternative
  is more words (six words give 36 bits), but that only raises the grind cost to about 2^36. It is
  still not a commitment and does not change the "has the code" case in kind.

## Verification

- `cargo test -p table-ledger settled_route` failed before the fix on the new test, and both tests pass
  after it.
- `cargo test --workspace` and `cargo check --workspace` were run at the end (see the run result).
