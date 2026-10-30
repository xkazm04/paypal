# Security scan - The Table - publication delta since the approval pass - 2026-10-30

A publication-blocker pass over `3229271..20ad784` (local `main`): 41 commits (no merge), 57 files,
+3764/-293. **Open publication blockers: 0.** Two new Low findings (K-1, K-2) and one Info
finding (K-3) are reported below. None of them blocks publication, so the D1 history rewrite does
not need to remove anything this report found. K-2 is the one it *could* remove, if the operator
widens the rewrite. The range holds:
- the previous scan report `3716744` (docs only);
- the agent-gated-spend tiger pass `9a3dcc8`, `97cf054`, `2610405`, `0102401`, its r3 fix `e25a9d8`
  and its records `695f56f`, `4349d8a` (client words and display logic);
- the subscription-rescue tiger pass `b7fb420`, `bede514`, `fd12048`, `16f2abe` and its record
  `43927f1` (client words and display logic);
- 20 registry-map chores `eb06a8c..36b6417` (`.ai/` only);
- the deal words change `753cb28` (value-2) and its STATUS entry `c1f7de1`;
- the sequencing proposal `16f0211` and its standup record `c3f9b0d` (`docs/concepts/` only);
- the ledger busy-transaction retry `20ad784`.

Branch `autopilot/codebase-security-scan-e5284376`, cut from `20ad784`.

Nothing was fixed: this run is report-only. No live PayPal call was made and no money was used.
Two network reads were made, both to public advisory databases: the RustSec fetch by `cargo deny`,
and the npm registry's audit endpoint by `pnpm audit`.

This report does not restate the owner's e-mail addresses, OS user names, first name, GitHub login
or absolute paths (G-2).

The three questions are kept apart:
1. dependency advisories;
2. secrets and personal data in what the range added;
3. risky code patterns, weighted to the money path: `crates/table-ledger` (`20ad784`) and the deal
   words change (`753cb28`).

G-1, G-2 and E-1 are parked with the operator and are not re-filed. Their status is in
"Carried forward".

Severity and the definition of a blocker are those of `scan-2026-10-19-delta.md`, as the 10-23 and
10-24 reports kept them: a publication blocker is something that must not be in a public repository
or its history (a live secret, a third party's personal data, or an asset without a redistribution
licence). The owner's own identity is Low and not blocking. A broken AGENTS.md money invariant
would also block publication. None was found.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Consequence | Recommended fix |
|---|---|---|---|---|---|---|
| K-1 | Low | owner-chosen copy that can never show | `apps/desktop/client/src/windows/main/deal/story.ts:225` (`753cb28`); Rust side `crates/table-ledger/src/display.rs:118` | no | The value-2 line ("Your agent accepted at your floor ...", `lib/words/deal.ts:109`) needs an ACCEPT step that carries a price. Rust always sends an ACCEPT with `price: None`, so in the real app the line never shows. The owner chose to "explain in UI", and that choice is not delivered. The tests pass on a shape Rust never produces. No money moves either way. | Compare the floor with `deal.terms.unit_price` (an ACCEPT binds the deal's `terms_hash`, `negotiation.rs:380`) and keep the `by === 'you' && typ === 'ACCEPT'` test without `s.price`. Pin it with a test that has a priceless ACCEPT, as `display.rs` emits |
| K-2 | Low | personal data (owner's own name) | `docs/concepts/sequencing-2026-10-29.md:3`, `:10`, `:50`, `:56`, `:58`, `:60-65`, `:67-69`, `:71-72`, `:81`, `:83`, `:89`, `:102`, `:112`, `:119` (`16f0211`, `c3f9b0d`) | no (operator) | The owner's first name is new to the tracked tree. It was in no tracked file at `3229271`, and the range adds it on 27 lines (22 at the tip). It is the owner's own identity, the E-2/E-3 class, so not a blocker. A P-1 path filter, which is what D1 rewrites, would leave it in history. | Replace it with "the owner" before R8, or leave it on purpose. If it should not be in history either, add the doc to the D1 rewrite (a replace-text pass), or rewrite it before D1 runs |
| K-3 | Info | lock wait on the money path | `crates/table-ledger/src/lib.rs:63`, `:168-187`, `:191-193`; `negotiation.rs:255` (`20ad784`) | no | None found for safety: a retried run is rolled back whole, and the audit chain is re-read inside each run. A writer that loses the lock can now wait up to 3 x 5 s (`busy_timeout`, `lib.rs:78`), where it waited 5 s before. Its caller (`table-app/src/agent.rs`, `pipeline.rs:133`) waits that long before it gets `GroupClosed` or its result. | None needed. Optionally say in STATUS that the worst case is about 15 s |

**Open publication blockers: 0.**

## (1) Dependency advisories

**Verdict: no advisory is open on either lockfile as committed. No manifest, lockfile or
`deny.toml` changed in the range.**

`git diff --quiet 3229271..20ad784` holds for `Cargo.toml`, `Cargo.lock`, `deny.toml`,
`apps/desktop/client/package.json` and `apps/desktop/client/pnpm-lock.yaml`. Both tools were
re-run anyway, because the advisory databases have moved since 10-24.

- **Rust (`cargo deny 0.20.2`, `deny.toml` as committed).**
  - `cargo deny check advisories` fetched the RustSec database (head `ee1a49a`, 2026-10-29 13:57
    UTC) and printed `advisories ok`.
  - `cargo deny --offline check bans licenses sources` printed `bans ok, licenses ok, sources ok`.
  - The four `deny.toml` ignores (RUSTSEC-2024-0370 and 2026-0370/71/72) are the ones already
    reviewed.
  - `cargo audit` is not installed on this machine, so `cargo deny` is the advisory check.
- **Client (`pnpm audit`, pnpm 11.3.0).** It ran on copies of the committed
  `apps/desktop/client/package.json` and `pnpm-lock.yaml` (`git show 20ad784:...`), placed in a
  temp directory outside the worktree. No `node_modules` was created or touched, and nothing was
  installed into the main checkout. It printed `No known vulnerabilities found`.

## (2) Secrets and personal data the range added

**Verdict: no secret, token, PayPal credential, key or third-party personal data. One Low finding
on the owner's own name (K-2).**

- **gitleaks 8.30.1:** `gitleaks git --log-opts="3229271..20ad784" --redact` scanned 41 commits
  (about 266 KB) and reported `no leaks found`, with an empty report.
- **Grep on the added lines of `git log -p 3229271..20ad784` (6632 lines, commit messages
  included).** The patterns were the same as on 10-24: key and token shapes, quoted credentials,
  e-mail, URL, IPv4, phone and IBAN shapes, long hex or base64 runs, and absolute paths or the
  owner's names.
  - The `secret`/`token`/`credential` hits are prose in `.ai/conform-runs/*.json` and
    `.ai/conform-detail.json`. They cite repo files (`services/house-seller/src/main.rs:37`,
    `crates/table-client/tests/bindings.rs:142`, `authority_table.rs:16`) and quote no value. The
    rest are in the quoted 10-24 report.
  - No IBAN, phone, AWS, GitHub, Slack, JWT or private-key shape, and no hex or base64 run of 32
    characters or more. The only long runs are test names and registry technique slugs.
  - The only URL or IP is the test loopback label `http://127.0.0.1:8765/mcp`, quoted inside
    `3716744`.
  - E-mail addresses appear only in commit metadata: the owner's first address as author and
    committer of all 41 commits, and `noreply@anthropic.com` in the trailers. No added file line
    holds an e-mail address.
  - No absolute path, drive letter, `/Users/`, `/home/`, `AppData` or OS user name appears in an
    added line.
- **Docs read in full or in their diff.** `docs/concepts/sequencing-2026-10-29.md` (new),
  `docs/build/tiger/2026-10-24-agent-gated-spend.md` and `2026-10-24-subscription-rescue.md` (new),
  the STATUS diff (+38), `docs/features/spend-purchases.md` and the 10-24 report.
  - The tiger records, STATUS and the feature doc cite repo-relative files and demo personas
    ("Maya", "Dan") only.
  - The sequencing doc names the owner by first name (K-2). It also gives the GitHub remote, which
    names the owner's GitHub login. That URL was already in `README.md` at `3229271`, and R8 makes
    it public, so it is not a new finding.
  - The 10-24 report `3716744` adds no address, user name or path (G-2 not widened).
- **Binaries and identities.** `git log --numstat` shows no binary row. All 41 commits have one
  author and committer, the owner's first address (E-2 class, not repeated here).
- `.claude/`, `.personas/`, `context-map.json`, `docs/build/rebuild/` and `.gitignore` have no diff
  in the range. `.ai/` changed: 23 new `conform-runs/*.json`, `conform-detail.json` and
  `registry-map.json`. The grep above covers them and found no path or address.

## (3) Risky code patterns

**Verdict: no money invariant is touched in a way that breaks it. The only production Rust change
is the ledger write retry, which rolls back whole and keeps the audit chain append-only. The
client changes only change words and display logic, and they add no IPC call. One Low defect
(K-1) makes the value-2 line dead in the real app.**

### What changed where

- **Rust.** Production Rust changed only in `crates/table-ledger/src/lib.rs` (+32) and
  `negotiation.rs` (+2/-5) (`20ad784`). The rest is two tests (`groups_tests.rs`, `tests.rs`).
- **No diff in the range** (`git diff --quiet 3229271..20ad784`) for: `crates/table-client`
  (including `authority_table.rs` and `PINNED_MANIFEST`), `bindings/`, `apps/desktop/src-tauri/`
  (capabilities, `build.rs`, `tauri.conf.json`), `crates/table-app`, `crates/table-core`,
  `crates/table-runtime`, `crates/table-paypal`, `crates/table-mcp`, `crates/table-os`,
  `crates/table-ledger/migrations`, `services/`, `scripts/`, every `package.json`, `Cargo.toml`,
  `vite.config.ts` and `mount.tsx`.
- **So:** no IPC command was added or changed, no authority row moved, no migration changed, and
  no PayPal call site changed.

### The ledger retry (`20ad784`)

`Ledger::write` (`lib.rs:168-187`) runs its body in one `BEGIN IMMEDIATE` transaction. On
`SQLITE_BUSY` only (`busy`, `lib.rs:191-193`), it re-runs the body from BEGIN, at most
`WRITE_ATTEMPTS = 3` times. `commit_negotiation` is its only caller (`negotiation.rs:255`).

- **Nothing partial commits.** A busy error from BEGIN, the body or COMMIT drops the rusqlite
  `Transaction`, and the drop rolls back while the connection is not in autocommit. A failed COMMIT
  leaves the transaction open, so the drop rolls that back too. The new test
  `a_busy_write_reruns_whole_and_any_other_error_returns_at_once` pins it: one row after a busy
  first run, no row after a non-busy error, and a bounded 3 runs.
- **The body has no effect outside the transaction.** `commit_negotiation_in`
  (`negotiation.rs:346-436`) gets only `&Connection`. It reads the deal, runs the group guard
  (`groups::accept_guard`), updates `deals` and `negotiation`, and appends through `append_verified`,
  `apply` and `apply_decided`, all on `tx`. Its inputs are borrowed or `Copy` (`DealEvent` is
  `Copy`, `table-core/src/deal.rs:299`). `Ledger` has no in-memory cache of the chain head (no
  `static`, `Cell` or `Mutex` in `table-ledger/src` outside tests). So a re-run re-reads the
  committed head and appends after it.
- **The audit log stays append-only and hash-chained.** The range adds no `UPDATE` or `DELETE` on
  `audit_log`; the matches in `book.rs` and `tests.rs` are pre-existing tamper and injection
  tests. The new race test ends in `fx.ledger.verify_audit().unwrap()`.
- **The group guard still decides.** A re-run of the losing ACCEPT re-reads the group after the
  winner's commit and returns `GroupClosed` (`an_accept_whose_lock_wait_runs_out_still_meets_the_closed_group`).
  Before the fix, a lock wait that ran out returned `DatabaseBusy`. That was still a refusal, so
  the old behaviour moved no money either. At most one table of a group agrees, as before.
- **Callers send nothing before the commit.** `agent.rs:147-149` returns the signed ACCEPT only
  after `commit_negotiation` returns `Ok`. `pipeline.rs:133-140` (owner accept) does the same. A
  retry therefore cannot put an envelope on the wire that the ledger did not record.
- **No error is widened into a retry.** Only `LedgerError::Sql(SqliteFailure)` with code
  `DatabaseBusy` retries. Every refusal (`Conflict`, `GroupClosed`, mandate or integrity errors)
  returns from the first run.
- The cost is a longer worst-case wait (K-3).
- `cargo test -p table-ledger` (narrowed to the crate that changed): 141 passed, including the two
  new tests and both racing-ACCEPT tests.

### The deal words change (`753cb28`)

`acceptedAtFloorLine` (`story.ts:220-228`) is arithmetic on the deal, the band and the transcript.
It decides nothing, has no IPC call, and is rendered as a text node (`DealPage.tsx:176`).

- **The claim is true where it shows.** "Your agent accepted": an outbound ACCEPT on a seller deal
  is always the agent's. The owner accept is buyer-only (`table-app/src/pipeline.rs:150`).
  "As your rules allow": the band refuses a seller unit price only when it is *below* the floor
  (`table-core/src/mandate.rs:503-535`), so a price equal to the floor is allowed.
- **But it never shows in the real app (K-1).** The line needs `s.price` on the seller's own ACCEPT
  step (`story.ts:225`). Rust builds every ACCEPT step with `price: None`
  (`table-ledger/src/display.rs:118`), and the mock's live path does the same (`mock/backend.ts:952`).
  Only the static fixture `mock/fixtures.ts:315` and the new test give ACCEPT a price.
- No counterparty text enters the line. The words are a constant (`lib/words/deal.ts:109`).

### The spend and rescue client passes

Display only. They change the words and the cell logic in `modules/spend/gate.ts`,
`modules/rescue/model.ts` and `preview.ts`, and the console and approval pages that show them.

- **No new sink or call.** The added lines hold no `dangerouslySetInnerHTML`, `innerHTML`, `eval`,
  `fetch`, `invoke`, `window.open`, storage or `href`. The one changed hook import adds `useNow`.
  The existing `approval_open` mutation in `RescueLayer.tsx` is unchanged, and the stop button gains
  only a `title`.
- **The new money claims match Rust.**
  - "It can only ask: it never pays" and "Every purchase waits for you": `pipeline.rs:408-410`
    refuses any `Authority::Policy` step on a `DealKind::Purchase`.
  - "if you do nothing, nothing is paid" and "it closes and nothing is sent" are the safe default:
    silence never moves money.
  - "passed when cleared" is shown only while the deal's `mandate_version` matches the drawn rule
    set. Otherwise the cells are `unknown` (`e25a9d8`). That removes an overstatement.

### AGENTS.md money invariants the range touches

| Invariant | Touched by | Status |
|---|---|---|
| The LLM never moves money | none (`table-mcp`, `table-app`, `table-runtime` unchanged) | holds |
| Mandate check before any network call; refusals leave zero `paypal_calls` rows | none (`table-app`, `table-core`, `table-paypal` unchanged) | holds |
| `audit_log` append-only and hash-chained | `20ad784` (writes the chain inside a retried transaction) | holds: a re-run rolls back whole, re-reads the head, adds no UPDATE or DELETE path, and `verify_audit` passes |
| Silence never moves money | client words in `b7fb420`..`16f2abe`, `9a3dcc8`..`e25a9d8` | holds: no deadline default changed, and the words now say so |
| Secrets in the keychain only | none | holds |
| Counterparty text untrusted, never in the Tumbler | `753cb28` (constant string only) | holds |
| Engines named `claude-code` / `codex-cli` on screen | none of the new strings name an engine | holds |

## Findings

### K-1 (Low): the "accepted at your floor" line can never show in the real app

- **Where:** `apps/desktop/client/src/windows/main/deal/story.ts:225` (`753cb28`):
  `find((s) => s.by === 'you' && s.typ === 'ACCEPT' && s.verified && s.price)`, then
  `accept.price.minor !== band.floor.minor`. It is rendered at
  `windows/main/console/areas/deal/DealPage.tsx:102`, `:176`.
- **What Rust sends:** `deal_transcript` maps `Body::Accept { .. }` to
  `(TranscriptType::Accept, None)` (`crates/table-ledger/src/display.rs:118`). An ACCEPT envelope
  has no price of its own, only `offer_seq` and `terms_hash`. So `s.price` is always null for an
  ACCEPT, and `acceptedAtFloorLine` always returns `null`.
- **Why the tests pass:** `story.test.ts` builds ACCEPT steps with `price: usd(30000)`. The static
  mock fixture (`mock/fixtures.ts:315`) also prices an ACCEPT. The mock's live accept
  (`mock/backend.ts:952`) and Rust do not.
- **Consequence:** the owner chose "Keep as is, explain in UI" for value-2. The explanation is
  never shown in the native app or the mock's live haggle. No money moves either way, so this is
  not a safety defect. But the commit and STATUS (`c1f7de1`) record a change that does not reach
  the owner.
- **Fix:** an ACCEPT binds the deal's own `terms_hash` (`negotiation.rs:380`), so at AGREED or
  later `deal.terms.unit_price` *is* the accepted unit price. Compare that with `band.floor`
  (currency and minor), keep the "our own verified ACCEPT exists" test without `s.price`, and add a
  test row with `price: null`, as Rust emits it. This is a client-only change, outside this task's
  scope.

### K-2 (Low): the sequencing proposal names the owner by first name

- **Where:** `docs/concepts/sequencing-2026-10-29.md`, 22 lines at the tip (`:3`, `:10`, `:50`,
  `:56`, `:58`, `:60-65`, `:67-69`, `:71-72`, `:81`, `:83`, `:89`, `:102`, `:112`, `:119`). They
  were added by `16f0211` (17 lines) and `c3f9b0d` (10 lines, some replacing earlier ones).
- **Consequence:** the name was in no tracked file at `3229271` (`git grep` at the base finds
  none). It is the owner's own identity, not a secret or a third party's data, so by the 10-19
  definition it is Low and not blocking (the E-2/E-3 class). It becomes public with R8.
- **The D1 rewrite:** as recorded, D1 rewrites history to drop the P-1 owner-assets text, which is
  a path filter. That would leave this doc, and the name in it, in every commit from `16f0211` on.
  Editing the tip after D1 leaves it in history. If the owner wants it out of history too, it must
  be in the same rewrite (a replace-text pass), or be reworded before D1 runs.
- **Fix:** say "the owner" in its place,
  or keep it on purpose. `docs/concepts/` is outside this task's scope.

### K-3 (Info): a busy ledger write can now wait about 15 s

- **Where:** `crates/table-ledger/src/lib.rs:63` (`WRITE_ATTEMPTS = 3`), `:168-187`, with the
  connection's 5 s `busy_timeout` (`:78`) (`20ad784`).
- **Consequence:** under real lock contention (two connections on one ledger file), the losing
  writer now waits up to three busy timeouts before it returns, where it waited one before. The
  caller holds `&mut Ledger` all that time. It does not affect correctness: no money step runs
  inside, no partial state commits, and the result is a refusal or a commit.
- **Fix:** none needed. Optionally record the worst case in STATUS beside the flake fix.

## Carried forward (not re-filed)

These files were checked with `git diff --quiet 3229271..20ad784`, and none of them changed in the
range: `scheduler.rs` (`crates/table-runtime`), `table-mcp`, `table-paypal`, `table-app`,
`table-os`, `src-tauri`, `vite.config.ts`, `mount.tsx`, `scripts/`, `deny.toml`,
`context-map.json`, `.personas`, `.claude`, `docs/build/rebuild`, the shield module and words, and
`review/Checks.tsx`. `docs/security/` changed only by the addition of the 10-24 report.

| ID | Status at `20ad784` |
|---|---|
| G-1 (Low, operator) | Parked with the operator; `.claude/` unchanged. |
| G-2 (Low, operator) | Parked with the operator. `docs/security/` gained only `scan-2026-10-24-approval-delta.md`, which restates no address, user name or path. This report adds none. |
| G-3 (Info) | Open; the two `story.ts` blocks are unchanged in content (`:194-201`; old `:223-231` now `:238-246`, moved by `753cb28`). |
| E-1 (Medium, operator) | Parked with the operator; `scheduler.rs:28` unchanged. |
| E-2 (Low, operator) | Open; the 41 range commits use the owner's first address. |
| E-3 (Low, operator) | Open; files unchanged. K-2 is a new case of the same class. |
| E-4 to E-11 | Open; files unchanged. |
| H-1 (Low) | Open; `shield/matrix.ts` and `lib/words/shield.ts` unchanged. `lib/words/deal.ts` changed only by K-1's constant, and the `:91` line is unchanged. |
| H-2 (Info) | No change; neither lockfile moved in the range. |
| H-3 (Info) | Open; `review/Checks.tsx` unchanged. |

## Verification

- **Range:** `git rev-parse HEAD main` both give `20ad784`. `git rev-list --count 3229271..main`
  gives 41, and `git log --merges` lists none.
- **Commits read:** every commit's message and stat. The full patch of every Rust, client and
  docs commit was read. The 20 `.ai/` chores were grepped, not read in full. Production hunks were
  traced into Rust:
  - `Ledger::write`, `busy` and `commit_negotiation_in` in `table-ledger`;
  - the callers in `table-app/src/agent.rs` and `pipeline.rs` (owner accept, purchase authority);
  - `deal_transcript` in `table-ledger/src/display.rs`;
  - the band check in `table-core/src/mandate.rs`.
- **Tools:**
  - `cargo deny check advisories`: `advisories ok` (RustSec head `ee1a49a`).
  - `cargo deny --offline check bans licenses sources`: ok.
  - `pnpm audit` on copies of the committed `package.json` and `pnpm-lock.yaml`: no known
    vulnerabilities.
  - `gitleaks git` over `3229271..20ad784`: 41 commits, no leaks.
  - `cargo audit`: not run, because it is not installed. `cargo deny` covers the same RustSec
    database.
  - `cargo test -p table-ledger`: 141 passed.
- **Gates:** this commit adds one Markdown file under `docs/security/` and no code. The full
  `cargo test --workspace` was not run for it; the merge gate runs it. No client file changed, so
  tsc and vitest were not run.

## Questions for the operator

1. K-1: fix the value-2 floor line now (client only, `story.ts` and its test), so the owner's
   choice actually shows?
2. K-2: keep the owner's first name in `docs/concepts/sequencing-2026-10-29.md`, or reword it, and
   if reworded, before or inside today's D1 rewrite, so that it leaves history too?

Open publication blockers: 0
