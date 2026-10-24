# Security scan - The Table - publication delta since the morning scan - 2026-10-24 (approval pass)

A publication-blocker pass over `7be5f85..3229271` (local `main`): 10 commits (one merge,
`d46d72b`), 28 files, +726/-59. The range holds:
- the dependency bump `7554fe3` (lockfiles only);
- the deal page's "last run" chip `9b213e7`;
- the shield release wording per deal `8b4170d`;
- the runtime finish-path fix `bdceccc` (robustness-4) and its STATUS entry `ec84451`;
- the owner-approval-decision tiger pass `677e73e`, `dfa9acb` and `1dee2c5`, with its record
  `3229271`.

Branch `autopilot/codebase-security-scan-a00e8fd9`, cut from `3229271`.

**No open publication blocker was found.** One new Low finding (H-1) and two Info findings (H-2,
H-3) are reported below. Nothing was fixed: this run is report-only. No live PayPal call was made
and no money was used. Two network reads were made, both to public advisory databases: the RustSec
fetch by `cargo deny`, and the npm registry's audit endpoint by `pnpm audit`.

This report does not restate the owner's e-mail addresses, OS user names or absolute paths (G-2).

The three questions are kept apart:
1. dependency advisories;
2. secrets and personal data in what the range added;
3. risky code patterns, weighted to the approval window and the decision path (`677e73e..3229271`).

G-1, G-2 and E-1 are parked with the operator and are not re-filed. Their status is in
"Carried forward".

Severity and the definition of a blocker are those of `scan-2026-10-19-delta.md`, as the 10-23 and
10-24 reports kept them. A broken AGENTS.md money invariant would also block publication. None was
found.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Consequence | Recommended fix |
|---|---|---|---|---|---|---|
| H-1 | Low | misleading owner copy on the release decision | `apps/desktop/client/src/windows/main/modules/shield/matrix.ts:196-199`; `src/lib/words/shield.ts:107`, `:113`; `src/lib/words/deal.ts:91` (`8b4170d`) | no | A seller who releases a hold before the buyer approved is told no other click is needed. In fact the deal stalls at AGREED until the owner countersigns, and a held rescue deal still needs the owner to approve the fix. No money moves; the owner's picture of what their decision does is wrong. | Split `seller-waiting` by state and kind: AGREED or earlier says the owner still approves the order in the approval window, and a rescue deal says the fix still needs their approval |
| H-2 | Info | lockfile drift beyond the stated bump | `Cargo.lock` (11 `windows-sys` edges), `apps/desktop/client/pnpm-lock.yaml:121-123`, `:1218` (`7554fe3`) | no | None found: `cargo deny` advisories, bans, licenses and sources all pass. A reader who trusts the commit message does not know that 12 other lock edges moved. | Say so in STATUS or the next lock commit. Optionally re-run `cargo update -p tokio --precise 1.54.1` from the base to see whether the `windows-sys` moves are needed |
| H-3 | Info | comment that reads against the Rust binding | `apps/desktop/client/src/windows/approval/review/Checks.tsx:22-26` (`1dee2c5`) | no | "A release of a hold needs no checklist" reads as the shield release, which Rust *does* bind (`service.rs:623-640`). The code is right (only `deal_void` is skipped). A maintainer who follows the comment could drop the bound line from `shield_release`, or mistake ReleaseHold for unbound. | Say "Void (which releases the PayPal authorization) needs no checklist" |

**Open publication blockers: 0.**

## (1) Dependency advisories

**Verdict: the bump closed both advisories it names, and no advisory is open on either lockfile as
committed.**

- **Rust (`cargo deny 0.20.2`, `deny.toml` as committed).**
  - `cargo deny check advisories` fetched the RustSec database (head `21d909e`, 2026-10-24 10:30
    +02:00) and printed `advisories ok`.
  - `cargo deny --offline check bans licenses sources` printed `bans ok, licenses ok, sources ok`.
    Its warnings are `multiple-versions` duplicates only, which `deny.toml` sets to `warn`.
  - `deny.toml` is unchanged in the range. Its four ignores (RUSTSEC-2024-0370 and 2026-0370/71/72)
    are the ones already reviewed.
  - `cargo audit` is not installed on this machine, so `cargo deny` is the advisory check.
- **RUSTSEC-2026-0386** (tokio `AsyncFd` I/O safety, patched `>= 1.53.3`). The base locked tokio
  `1.53.1`, which is affected. `Cargo.lock:4798-4799` now locks `1.54.1`. **Closed.**
- **RUSTSEC-2026-0384** (tokio `Interval` race, dated 2026-10-21). It affects `1.54.0` only and is
  patched at `>= 1.54.1`. The bump went straight to the patched release, so it never applied.
- **Client (`pnpm audit`, pnpm 11.3.0).** It ran on a copy of
  `apps/desktop/client/package.json` and `pnpm-lock.yaml` in a temp directory outside the worktree,
  so no `node_modules` was created or touched.
  - At `3229271` it printed `No known vulnerabilities found`.
  - The same check on the base lockfile (`git show 7be5f85:...`) found 3: GHSA-xjj6-f33q-929c
    (high), GHSA-4qv8-2p9j-2685 (moderate) and GHSA-f72v-6w45-q472 (moderate). All three were
    undici `>=8.0.0 <8.12.2`, reached through `jsdom` and `vitest>jsdom`.
  - `pnpm-lock.yaml` now locks `undici@8.12.3`. **GHSA-xjj6 is closed, and the two moderates the
    commit did not name are closed with it.**
  - undici reaches the tree only through the test DOM, so it was never in the shipped client.
- **What else moved (H-2).** `7554fe3` calls itself "Lockfile-only", and that is true. But beyond
  tokio and undici:
  - It re-pointed 11 crates' `windows-sys` dependency from `0.61.2` back to `0.52.0`, `0.59.0` or
    `0.60.2`. The crates are `dirs-sys`, `errno`, `muda`, `quinn-udp`, `rustix`, `socket2`,
    `tempfile`, `tray-icon`, `uds_windows`, `winapi-util` and `window-vibrancy`. All five versions
    were already in the lock, and `0.61.2` is still there for others.
  - It added `@babel/runtime@7.29.10` for `@testing-library/dom`, and kept `7.29.7`.
  - None of these carries an advisory. `windows-sys` is FFI bindings with no logic of its own.
  - The merge `d46d72b` differs from its first parent (`9b213e7`) by exactly `7554fe3`'s two files.

## (2) Secrets and personal data the range added

**Verdict: clean. No secret, token, PayPal credential, key or third-party personal data.**

- **gitleaks 8.30.1:** `gitleaks git --log-opts="7be5f85..3229271" --redact` scanned 9 commits
  (the merge adds no content of its own) and reported `no leaks found`, with an empty report.
- **Grep on the 726 added lines of `git log -p 7be5f85..HEAD`.** The patterns were the same as on
  10-24: key and token shapes, quoted credentials, e-mail, URL, IPv4, phone and IBAN shapes,
  long hex or base64 runs, and absolute paths with the owner's names. Commit messages were included.
  - Every `sk-` hit is inside "ask-me".
  - The only IBAN-shaped hit is the test ULID `01JDTESTDEAL0000000000000Q`, in
    `bound.render.test.tsx:28` and `review/askMe.test.ts:20`.
  - The long runs are the `Cargo.lock` checksum and the two `pnpm-lock.yaml` integrity hashes.
  - The only URL or IP is the test loopback label `http://127.0.0.1:8765/mcp`
    (`actor_runtime_tests.rs`). It binds no socket.
  - The only e-mail address is `noreply@anthropic.com` in commit trailers.
  - No absolute path or OS user name appears.
- **Docs.** `docs/build/tiger/2026-10-24-owner-approval-decision.md` and the STATUS diff (+37) cite
  repo-relative files and demo personas ("Dan") only.
- **Binaries and identities.** `git log --numstat` shows no binary row. All 10 commits have one
  author and committer, the owner's first address. That is the E-2 class: the owner's own identity,
  not repeated here.
- `.claude/`, `.ai/`, `.personas/`, `context-map.json` and `docs/security/` have no diff in the
  range. G-1 and G-2 are neither widened nor narrowed.

## (3) Risky code patterns

**Verdict: the decision path in Rust did not change in the range, and the client changes only
change words. No decision can skip the READY checks or `checks_hash`. Nothing new can move money
without the owner. No IPC label or token handling moved. One Low wording defect (H-1) sits on the
release decision.**

### What changed where

- **Rust.** Production Rust changed in one line, `crates/table-runtime/src/actor.rs:610` (`bdceccc`).
  The rest is a test (`actor_runtime_tests.rs:631-695`).
- **No diff in the range** (`git diff --quiet 7be5f85..HEAD`) for: `crates/table-client`
  (including `authority_table.rs` and `PINNED_MANIFEST`), `bindings/`, `apps/desktop/src-tauri/`
  (capabilities, `build.rs`, `tauri.conf.json`), `crates/table-app`, `crates/table-core`,
  `crates/table-paypal`, `crates/table-mcp`, `crates/table-ledger/migrations`, `services/`, every
  `package.json`, `Cargo.toml` and `vite.config.ts`.
- **So:** no IPC command was added or changed, no authority row moved, and the audit log gained no
  UPDATE or DELETE path.

### Can a decision skip the READY checks or `checks_hash`?

No. The client sends its hashes, but Rust is the gate. Unchanged code in `service.rs:596-641`
(`decide`) does this, in order:

1. `guard(label, token)` (`:603`, via `approval.check`).
2. The selected deal must be this deal (`:604`).
3. `terms_hash` and `attempt` must match the deal now. A MISMATCH or BLOCK deal is refused
   (`:608-613`).
4. For every decision except Void, the checklist is recomputed. A `checks_hash` that differs is
   refused (`summary_changed`, `:623-629`).
5. Any Fail line is refused (`check_failed`, `:633-639`), with two exemptions. ReleaseHold may fail
   the shield line only. The owner's one read of an open authorize decides nothing.
6. The owner ticket is issued (`:643-650`).
7. Only then does `record_decision` (`:568-594`) write `owner.decision` with that `checks_hash`,
   before `create` / `authorize` / `capture` / `owner_release_hold` / `rescue_approve` runs.
8. `pipeline.authority` (`table-app/src/pipeline.rs:444-448`) validates the ticket again for
   `Authority::Owner`.

What the tiger pass added on top is display only:

- **`boundLine` (`review/Checks.tsx:27-30`, shown at `DealReview.tsx:243-246`) after a successful
  call.** It states that the wallet re-checked the list and recorded it. The call above backs that
  claim for every command that gets the line:
  - `deal_owner_accept`, `deal_countersign`, `deal_capture`, `shield_release` and `rescue_approve`
    record the checklist.
  - The line is withheld for `deal_void`, which is unbound by design, and for the lost-authorize
    read (`read` = `readsLostAuthorize`).
  - If the client misjudges `read`, the line is either withheld when it would have been true, or
    shown for a read that Rust also hash-checked and recorded (`:618-641`). Neither case
    overstates what Rust did.
  - The list shown comes from the same `summary` whose `checks_hash` the call sent, and Rust
    accepted that hash, so the list is the bound one. H-3 covers a comment beside the function.
- **`checksNowLabel` and the Details title (`Checks.tsx:34`, `review/Details.tsx:94`).** They stop
  claiming that the current list is "your checks before you decided", which was a stale-list claim.
  This removes an overstatement.
- **C1 (per item, `review/diff.ts:240-250`, `:269`, `review/says.ts:122-128`).** The price-range
  row now sets `unit_price` beside the ceiling, as Rust's band check does
  (`table-core/src/mandate.rs:502-524`: "Band refers to the signed unit price"). Before, the twin
  showed the total beside a per-item ceiling while comparing per item, so the fix aligns the
  display with the gate. `qty`, `unit_price` and the total come from Rust's `Deal`.
- **C2 (ask-me, `review/why.ts:47-52`, `review/diff.ts:252-262`, `DealReview.tsx:339`).** The rule
  asks only when `amount.minor() > threshold.minor()` (`mandate.rs:561-563`), and `relWithin` is `<=`
  for `'≤'` (`diff.ts:59-62`). So "isn't above that" at equality is the wallet's rule. The new text
  says the owner *may* accept here, and that is still a privileged, ticketed `deal_owner_accept`.
  It does not widen any agent authority, because the window only describes clause 6.
- **New sinks.** None in the added lines: no `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `fetch`, new `invoke`/`s.call`, `window.open`, storage or `href`. Strings reach React as text
  nodes.

### Can anything move money without the owner?

No new path. The two runtime and main-window changes:

- **`actor.rs:610` (`bdceccc`).** On an engine event the run cannot take, the actor now:
  - emits the fault first;
  - then ends the run Failed through `finish_run` (`engines.rs:455-490`);
  - then reports either the Failed snapshot or `finish_run`'s own audit-write fault, which before
    was dropped (`let _ =`).

  `finish_run` removes the run, lists it in `run_history` and appends `run.finish`. It calls no
  pipeline money step. The new test's `fail_run_audit` switch is `#[cfg(test)]`
  (`service.rs:177-179`, `engines.rs:470-473`). It makes a fault visible that was silent before.
- **`releaseCase` (`8b4170d`).** It changes the words of a hand-off button only. `open.run` and
  every `useMutation` are unchanged, and the release still happens in the approval window as
  ReleaseHold. The `seller-approved` claim (money comes in on the next check with no other click)
  matches Rust:
  - `pipeline.rs:452-463` grants `SellerMandate` only to a seller deal in APPROVED or AUTHORIZED.
  - `shield_gate.rs:51-61` passes a released HOLD (ASK) for that mandate on Authorize and Capture.
  - `scheduler.rs:205`, `:221` drive it.

  This is the AGENTS.md authority 2 (H5), and it is not new. The `seller-waiting` claim is the one
  that is wrong (H-1).

### Can an IPC label or token be spoofed?

Nothing in the range touches how either is derived or checked.

- The label is Tauri's own `window.label()` (`apps/desktop/src-tauri/src/native.rs:55-61`, against
  `authority::admits`), never a client argument.
- The token is checked in `approval.check` through `guard` (`service.rs:392-396`).
- The three decision rows are unchanged: `deal_owner_accept`, `deal_countersign` and
  `shield_release` are `APPROVAL, Decision, PRIVILEGED, SELECTED` (`authority_table.rs:205`, `:223`,
  `:226`).
- The new tests mock `invoke`. They do not ship.

### Unvalidated input?

None added.

- The new client logic reads only Rust-typed fields of `ApprovalSummary`, `Deal` and
  `RunSnapshot`.
- `lastFinishedRun` (`deal/model.ts:365-368`) filters a list the page already read. Its chip text
  comes from a closed table, with the state cast to the three ended states after the filter.
- The one counterparty-sourced string in the new copy is `cpName`, the display name the window
  already showed. It is rendered as text, and only in the approval and main windows, never the
  Tumbler.

## Findings

### H-1 (Low): "with no other click from you" is untrue for a seller hold released before the buyer approves

- **Where:** `apps/desktop/client/src/windows/main/modules/shield/matrix.ts:196-199`. `releaseCase`
  maps every seller deal that is not APPROVED or AUTHORIZED to `seller-waiting`. Its signature takes
  `kind` but never reads it. The words are:
  - `src/lib/words/shield.ts:107`: "Releasing doesn't take the money yet: it comes in after the
    buyer approves at PayPal, with no other click from you."
  - `:113`: the toast, same claim without the last clause.
  - `src/lib/words/deal.ts:91`: same as `shield.ts:107`.

  They are shown at `Decision.tsx:130`, `shield/Checks.tsx:139` and `shield/parts.tsx:81`, `:157`.
  `shield.test.tsx` ("seller agreed" and "seller negotiating" give `seller-waiting`) and
  `matrix.test.ts` pin the mapping.
- **What Rust does:**
  - For a seller deal at AGREED, the scheduler creates the order on `Authority::Policy`
    (`crates/table-runtime/src/scheduler.rs:152-166`).
  - A released HOLD gates as ASK (`shield_gate.rs:36-41`), and `shield_allows(Ask, Policy, Create)`
    is `false` (`:51-61`).
  - So the create returns `Permission`, which the scheduler swallows without a word (`:161-165`).
    The order is never created until the owner countersigns in the approval window
    (`service.rs:731-743`, `DecidedBy::Human` passes ASK).
  - The table-app test says so in plain words: "Released, it reads as ASK: a clause-6 policy step
    still waits for the owner" (`crates/table-app/tests/pipeline.rs` around line 1636).
  - The same holds for a NEGOTIATING deal once it agrees.
- **Rescue deals.** A seller **rescue** deal (`kind: 'rescue'`, always `Side::Seller`,
  `table-app/src/rescue.rs:182`) that is held at AGREED gets the same words. But its invoice goes
  out only on the owner's `rescue_approve` (`rescue.rs:441-505`; `pipeline.rs:415-417` refuses any
  other authority).
- **Consequence:** the owner releases the hold believing they are done. The deal then waits at
  AGREED until its deadline, and the safe default lets it lapse. No money moves without the owner,
  and silence still moves none, so no invariant breaks. But the copy the decision path shows misstates
  what the owner's release achieves. This is the very defect `8b4170d` set out to remove, now in
  the other direction, and it can cost a sale. It is not a publication blocker.
- **Fix:** split `seller-waiting` by state and kind:
  - APPROVED / AUTHORIZED: `seller-approved`, unchanged.
  - AWAITING_APPROVAL: the current `seller-waiting` text is true there.
  - AGREED or earlier: "After you release, you still approve the order in the approval window."
  - rescue: "After you release, you still approve the fix."

  Pin it with a case-table row per state, including a rescue row.

### H-2 (Info): the advisory bump moved more lock edges than its message says

- **Where:** `7554fe3`.
  - `Cargo.lock`: 11 `windows-sys` edges, from `0.61.2` to `0.52.0`, `0.59.0` or `0.60.2`, for the
    crates listed in (1).
  - `apps/desktop/client/pnpm-lock.yaml:121-123`, `:1080`, `:1218`: `@babel/runtime@7.29.10` added
    for `@testing-library/dom`.
- **Consequence:** none found. Every version was already in the lock or is a patch release, and
  advisories, bans, licenses and sources all pass. The point is only that review of a security
  bump should see every edge it moved.
- **Fix:** mention it in STATUS. If the `windows-sys` re-pointing is not needed, a
  `cargo update -p tokio --precise 1.54.1` from the base should give a two-line diff.

### H-3 (Info): a comment beside `boundLine` reads as if a shield release were unbound

- **Where:** `apps/desktop/client/src/windows/approval/review/Checks.tsx:22-26`: "A release of a
  hold needs no checklist, and the read of a lost hold decides nothing, so neither gets the line."
  The code excludes `deal_void` and the read only.
- **Consequence:**
  - In this codebase "hold" names the shield HOLD (`shield_release`, ReleaseHold). Rust binds
    ReleaseHold to the checklist (`service.rs:623-640`); only Void is exempt (`:623-624`).
  - The comment means Void, which releases the PayPal authorization hold.
  - A maintainer who takes it literally could add `shield_release` to the skip list. That would
    hide a true statement, which is harmless. Or they could carry the wrong belief toward the Rust
    side.
- **Fix:** "Void (it releases the PayPal authorization) needs no checklist."

## Carried forward (not re-filed)

None of the files these items name changed in the range: `scheduler.rs`, `table-mcp`,
`table-paypal`, `table-app`, `src-tauri`, `vite.config.ts`, `mount.tsx`, `scripts/`, `deny.toml`,
`context-map.json`, `.personas`, `.claude`, `docs/build/rebuild` and `docs/security` were all
checked with `git diff --quiet 7be5f85..HEAD`.

| ID | Status at `3229271` |
|---|---|
| G-1 (Low, operator) | Parked with the operator; files unchanged. |
| G-2 (Low, operator) | Parked with the operator; `docs/security/` unchanged in the range, and this report adds no address, user name or path. |
| G-3 (Info) | Open; `story.ts` unchanged, and the approval Diff still does not show the counterparty-anchored facts. |
| E-1 (Medium) | Parked with the operator; `scheduler.rs:28` unchanged. |
| E-2 (Low, operator) | Open; the 10 range commits use the owner's first address. |
| E-3 to E-11 | Open; files unchanged. |

## Verification

- **Range:** `git rev-parse HEAD main` both give `3229271`, and `git log 7be5f85..HEAD` lists 10
  commits.
- **Commits read in full:** `git show` for every commit. The approval and shield production
  hunks were traced into Rust:
  - `decide`, `record_decision` and `approval_checks` in `service.rs`;
  - `authority` in `pipeline.rs`;
  - `shield_allows` and `judge` in `shield_gate.rs`;
  - the seller create in `scheduler.rs`;
  - `rescue_approve` in `rescue.rs`;
  - the band and clause-6 checks in `mandate.rs`;
  - `finish_run` in `engines.rs`.
- **Tools:**
  - `cargo deny check advisories`: `advisories ok`.
  - `cargo deny --offline check bans licenses sources`: ok.
  - `pnpm audit` on the copied current lockfile: 0. On the copied base lockfile: 3, all undici.
  - `gitleaks git` over the range: no leaks.
- **Gates:** this commit adds one Markdown file under `docs/security/` and no code, so
  `cargo test --workspace` was not run for it; the merge gate runs it. No client file changed, so
  tsc and vitest were not run.

## Questions for the operator

1. H-1: fix the `seller-waiting` wording now, before the demo? It is a words-only client change
   in `matrix.ts` and `lib/words/`, outside this task's `docs/security/` scope.
2. H-2: is the `windows-sys` re-pointing in `7554fe3` intended, or should the bump be redone as a
   two-line diff?

Open publication blockers: 0
