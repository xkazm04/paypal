# Security scan - The Table - publication delta since the film pilot - 2026-10-19

A publication-blocker pass over the commits `e0105056..85db8d5` (34 commits, 67 files,
+1718/-121). The range holds: the J-3, J-5 and J-6 fixes from the join scan (signed LISTING
quantity, `NotFound` for absent ledger rows, a length cap on pasted listing codes), the Book's
"who decided" key, the Scripted-engine refusal wording, the "Check the price now" screen, mock
fixture and hero-film corrections, client render tests, the `rust-toolchain.toml` components line,
the README CI section, and registry and scan-sweep bookkeeping in `.ai/` and `.claude/`. Base
`85db8d5`, branch `autopilot/codebase-security-scan-7d269ff2`. **No open publication blocker was
found.** Four Low and three Info findings are reported below. Nothing was fixed: this run is
report-only. No network call was made, no live PayPal call was made and no money was used.

Range scanned: `git log e0105056..85db8d5`. That is `2275be8` to `85db8d5`, including the merge
`9cc2e37` (parents `fef1459`, `b679a12`). Its second-parent commits `e59c4cb`, `54e24cf`, `6fc8a87`
and `a8246f0` are in the list and were read like the others.

Scope (read in full):
- Rust: the whole range diff of `crates/table-ledger/src/{book.rs,repositories.rs,tests.rs}`,
  `crates/table-runtime/src/{engines.rs,listing_code_tests.rs,client_tests.rs,groups_tests.rs,policy_tests.rs}`,
  `crates/table-app/src/agent.rs`, `crates/table-proto/src/envelope.rs`,
  `crates/table-proto/tests/protocol.rs` and `crates/table-mcp/tests/server.rs`. I also read every
  caller of the four ledger reads that now return `NotFound` (`table-app/src/{agent,checks,pipeline}.rs`,
  `table-runtime/src/{dispatcher,pairing,scheduler,service,simulate,configuration}.rs`,
  `table-ledger/src/pin.rs`) and the Book filter binding (`book.rs:147`, `:156`, `:224`).
- Fixtures and film: `apps/desktop/client/src/mock/{fixtures.ts,backend.ts}` (Maya's week, the
  browser-preview wallet) and `film/hero/film.json`.
- Bookkeeping: `.ai/conform-detail.json`, the six new `.ai/conform-runs/*.json`,
  `.ai/registry-map.json`, `.claude/scan-history/{scan-sweep,open-backlogs}.jsonl` and
  `.claude/spark/config.md`.
- Toolchain and manifests: `rust-toolchain.toml`, `.gitignore`, `README.md`, and
  `.github/workflows/ci.yml:53-58` for comparison.
- Client: `windows/approval/{PriceCheck.tsx,listingCode.ts}`, `lib/words.ts`, and the
  `film-capture.mjs` diff (child processes only).
- The full patch (`git log -p e0105056..HEAD`, 3577 lines) and the cumulative diff, grepped for
  keys, tokens, JWT/AWS/GitHub/Slack/Anthropic key shapes, private-key blocks, `client_secret`,
  e-mail addresses, URLs, drive-letter and `/Users/` or `/home/` paths, and the owner's user and
  mail names. `git log --numstat` was checked for binary files. The **whole tracked tree**
  (`git ls-files`) was grepped for absolute user paths too, because the question covers tracked
  files as well as the range.

Severity is judged for publishing this repository: a hackathon desktop wallet against the PayPal
**sandbox**. A "publication blocker" is something that must not be in a public repository or its
history: a live secret, a third party's personal data, or an asset without a redistribution
licence. Local paths that show the owner's own OS user name are Low and not blocking. That is the
precedent set by P-3 in `scan-2026-10-07.md` and kept here.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Recommended fix |
|---|---|---|---|---|---|
| D-1 | Low | personal data (local paths) | `.personas/skill-registry.json:5`, `:11`, `:22`, `:28`, `:34`, `:40`, `:46`, `:52`, `:58`, `:64`, `:70`, `:76` (`08818ba`); `.claude/lens-scan/config.md:3` (`ed800c5`); `docs/build/rebuild/wp4c.md:66` (`017b13f`); P-3 still open at `.claude/contest/config.md:2`, `:15` | no (operator) | Replace with `<repo>`/`<home>` placeholders or untrack and ignore `.personas/`, `.claude/lens-scan/`, `.claude/contest/`; reword `wp4c.md:66` to `PLAYWRIGHT=<python site-packages>/playwright/driver/package/index.mjs` |
| D-2 | Low | product rule, user-facing string | `crates/table-runtime/src/engines.rs:193` (`0f1455c`); shown by `apps/desktop/client/src/shared/honesty.tsx:84`; copied to `docs/features/agents-and-engines.md:190` | no | Name the engines as `claude-code` or `codex-cli` (AGENTS.md), or say "need an engine you have installed" |
| D-3 | Low | fail-open compatibility path | `crates/table-proto/src/envelope.rs:155-160`; `crates/table-app/src/agent.rs:294` (`54e24cf`) | no | Before the first public release, make `Listing.qty` required (drop `Option` and `serde(default)`), or refuse a `None` quantity at `agent.rs:294`; no released build ever signed a qty-less LISTING |
| D-4 | Low | personal data (commit metadata) | all 34 commits in the range, author and committer `xkazm04 <kazdan@seznam.cz>` | no (operator) | Same as P-2/F-7: a GitHub `noreply` identity going forward; history needs a rewrite before the first push |
| D-5 | Info | error classification | `crates/table-ledger/src/repositories.rs:896-916`, `:1090-1091`, `:1098-1107` (`a8246f0`) | no | None: every caller still refuses (see question 2) |
| D-6 | Info | toolchain | `rust-toolchain.toml:4` (`485cc65`) | no | Accept. It adds the official `rustfmt` and `clippy` components and keeps channel `1.97` |
| D-7 | Info | registry evidence names credential gaps | `.ai/conform-runs/91b3bc0b-b8c1-47d0-8b57-cc41ea428da6.json`, `.ai/conform-detail.json` (`5f5996b`) | no | None for publication: they cite `crates/table-runtime/src/configuration.rs:238-245`, `:516`, `crates/table-market/src/lib.rs:71`, `:101` as descriptions, with no value |

**Open publication blockers: 0.** D-1 and D-4 need an operator decision. Both concern the owner's
own identity (OS user name, commit e-mail), not a secret. D-1 has one line that names a second OS
user (`mkdol`, `wp4c.md:66`); see the question at the end.

## Answers to the questions

### 1. Publication blockers in tracked files and in the range's history?

**Verdict: none in the range. Outside the range, the tracked tree still holds owner-identifying
local paths (D-1, Low, not blocking).**

- **Keys, tokens, PayPal credentials.** The range patch holds no API key, OAuth or bearer token,
  PayPal client id or secret, JWT, private-key block or `.env` content. The grep for `secret`,
  `token`, `api_key`, `client_id`, `password`, `bearer` and the usual key prefixes matched only:
  - prose in `.ai/conform-runs/*.json` and `.claude/scan-history/scan-sweep.jsonl` (for example
    "Requests use the stored API key directly", and the carry "token-failure drops observations");
  - the STATUS H4 row;
  - client `tokenReady` session flags (`PriceCheck.tsx:49`, `priceCheck.test.tsx`).

  None of these is a value.
- **Mock, preview-wallet and Maya fixtures.** `mock/fixtures.ts` changes only `decided` authorities
  (`POLICY6` becomes `{type:'human'}` on D-0183, D-0186, D-0190) and the history's purchase-step
  actor (`RULE6` becomes `OWNER`). `mock/backend.ts` bumps `STORE_KEY` to v21 and strips `at` from
  the Book's `decided_by` key. The PayPal-looking ids (`9LM442C`, `0RW7K`, `1QE097D`, `4YB2`,
  `6CC1`, ...) predate the range. They are short synthetic strings, not the 17-character order ids
  PayPal issues, and no request ever uses them. Every counterparty is a fixture key
  (`KEY.partsco`, `KEY.cablehaus`, ...). No e-mail, payer id or real name was added. "Maya" and
  "Dan" are the sample world (`uat/characters/maya-shop-owner.md`).
- **`film/hero/film.json`.** Capture timing (`"from": "ready"`), `ZoomToRect` props, and one
  narration line ("a sixty-four dollar dock Maya approved"). No path, voice id, key or URL.
- **`.ai/conform-runs/` and `.claude/scan-history/`.** Six run files with relative `file:line`
  evidence and ISO timestamps. One `open-backlogs.jsonl` row points to the relative path
  `.claude/scan-sweep/handoff-stabilize-2026-10-18.jsonl`. No absolute path, user name or e-mail.
  `.claude/spark/config.md` adds one lesson with no path.
- **Absolute paths in the range.** None: the drive-letter, `\Users`, `/Users/` and `/home/` grep
  over every added line is empty. The only URLs added are the repo's own CI badge
  (`README.md:9`, `github.com/xkazm04/paypal`, the public repo name) and two fake links in a
  quarantine test (`http://x`, `http://evil.test`, `NoteChip.test.tsx`).
- **Binary or media files.** `git log --numstat` lists none. `.gitignore:41` adds
  `/demo-film-latest.mp4`, so the local render stays out of git.
- **Tracked tree, outside the range (D-1).** `git ls-files | xargs grep` for `C:/Users`,
  `C:\\Users` and `/Users/<name>` finds the five files in the D-1 row plus
  `docs/security/scan-2026-10-07.md`, whose hit is a list of search patterns. The P-3 file
  (`.claude/contest/config.md`) was reported on 2026-10-07. `.personas/skill-registry.json`,
  `.claude/lens-scan/config.md` and `docs/build/rebuild/wp4c.md` came in between the 2026-10-07
  full scan and this range (`08818ba`, `ed800c5`, `017b13f`, all ancestors of `e0105056`). The
  delta scans did not cover them. `skill-registry.json` also lists the owner's other local
  project names (`systedo-case`, `kp`, `firetv`, `ascent`, ...).
- **Commit metadata (D-4).** All 34 commits have author and committer
  `xkazm04 <kazdan@seznam.cz>`, as in all earlier history (P-2, F-7).

### 2. Risky code patterns in the Rust changes, against the AGENTS.md invariants

**Verdict: no invariant is broken. One compatibility path accepts a weaker LISTING (D-3, Low). One
user-facing string names vendor products (D-2, Low).**

- **The LLM never moves money.** No MCP tool was added or changed: the only `table-mcp` change is
  the test helper `tests/server.rs:596`. No money-moving PayPal call site changed: no file in
  `crates/table-paypal/`, `table-app/src/pipeline.rs` or the authority table is in the range. The
  `engines.rs:192-195` change is message text only, and the guard that refuses a Scripted run for
  a shopper or assistant role is unchanged.
- **No live PayPal call without the operator.** No new network path. Every new or changed test is
  offline (`Ledger::in_memory`, `paired_owners()`, `MemoryNonces`). "Check the price now" calls
  `market_refresh` (`PriceCheck.tsx:35`), an existing command whose authority row is unchanged. It
  reads the market provider, not PayPal, and only on the owner's click in the approval window.
- **Nothing fails open:**
  - **J-5 `NotFound` (D-5).** `settled_attempt`, `pending_offer`, `counterparty_policy` and
    `counterparty_first_seen` (`repositories.rs:896-916`, `:1090-1091`, `:1098-1107`) now map a
    missing row to `LedgerError::NotFound` instead of a SQL error. I checked every caller for an
    arm that treats `NotFound` as permission. All of them still refuse:
    - `?`/`app(...)?` propagates it as an error (`pipeline.rs:238`, `:265`, `:355`, `:375`,
      `:593`, `:716`, `:1050`...; `scheduler.rs:160`, `:171`; `service.rs:456`, `:477`, `:579`;
      `dispatcher.rs:730`; `pairing.rs:737`).
    - `agent.rs:43` maps it to the refusal `InvalidRequest`.
    - `checks.rs:614` (`.ok()` gives no offer hash) and `checks.rs:635` (`.is_ok_and(paired)`
      gives unpaired) resolve to the stricter fact.
    - `simulate.rs:140` (`.ok()?`, already there before the range) gives "no facts", a read-only
      what-if.

    No caller has an `Err(NotFound) => allow` arm for these four reads. The `NotFound` arms that
    do exist (`service.rs:335`, `:811`, `house.rs:28`, `checks.rs:643`, `:679`) wrap
    `active_mandate` or `get_deal`. They resolve to "retired", "invalid" or "count as open", all
    closed. The regression test is `table-ledger/src/tests.rs:3069-3105` (`reads_of_an_absent_counterparty_deal_or_offer_say_not_found`, `:3073`).
  - **J-3 LISTING quantity (D-3).** `Body::Listing` gains `qty: Option<u32>` with
    `#[serde(default, skip_serializing_if = "Option::is_none")]` (`envelope.rs:155-160`). The buyer
    refuses a mismatch with `qty.is_some_and(|qty| qty != deal.terms.qty)` (`agent.rs:294`). The
    quantity is inside the signed bytes (`protocol.rs:383-421`), so nobody but the seller can add,
    change or strip it. A LISTING with no `qty`, though, is accepted and binds no quantity. That
    is a deliberate compatibility path for listings signed "by a build from before this field".
    Current sellers always sign `Some(qty)` (`agent.rs:342`). *Exploit sketch:* a seller key that
    signs a qty-less LISTING lets the buyer's agent table any quantity. The buyer's mandate still
    bounds the total and the owner or a signed rule still decides, so no money moves without one
    of the three authorities. The J-3 binding is then simply absent for that listing. The repo is
    not public and no build was released, so no legitimate pre-field LISTING exists to stay
    compatible with. *Fix:* make `qty` required now, or refuse `None` at `agent.rs:294`. Both are
    changes in `table-proto` or `table-app`, outside this task's paths.
  - **Book `decided_by` key (`6fc8a87`).** `DECIDED_BY` (`book.rs:38`) is a constant SQL fragment
    with no interpolation. Filter values stay bound parameters (`book.rs:147`, `:156`,
    `params_from_iter` at `:224`). The Book is read-only and drops `at`, `deadline` and
    `mandate_hash` from the grouped key. That shows less, not more. The audit log is untouched:
    nothing in the range writes to `audit_log` or adds an UPDATE/DELETE path.
- **Vendor names on screen (D-2).** `engines.rs:193` returns "...need Claude Code or Codex CLI." as
  an `Unavailable` message. The commit message (`0f1455c`) says this text "can reach the UI".
  `WalletNotice` shows `error.message` when the caller passes no plain words (`honesty.tsx:84`).
  AGENTS.md: "Engines are referred to as `claude-code` and `codex-cli`; never put a vendor product
  name in user-facing strings". This is not a security or money issue, but it breaks a stated
  repo rule in shipped text, so it is reported. *Fix:* "...need the claude-code or codex-cli
  engine", in `engines.rs:193` and the doc line `agents-and-engines.md:190`.
- **Other.** No new `unwrap`/`expect` outside tests. The new `unwrap()`s are in `#[cfg(test)]`
  code (`book.rs:417-483`, `tests.rs`). No `unsafe`, no new SQL string built from input, no new
  file IO.

### 3. Dependency or toolchain changes

**Verdict: one toolchain line, no dependency change (D-6).**

- `rust-toolchain.toml:4` adds `components = ["rustfmt", "clippy"]` (`485cc65`). The channel stays
  `1.97` and the profile stays `minimal`. Both components come from the same rustup distribution
  as the compiler, and CI already installs exactly these (`.github/workflows/ci.yml:55-56`). The
  change adds no third-party code to the build.
- `git diff --stat e0105056..HEAD` lists no `Cargo.toml`, `Cargo.lock`, `package.json`, lockfile,
  `deny.toml` or workflow file. `film-capture.mjs` adds three `execFileSync(ff, [...])` ffmpeg
  calls with argument arrays (no shell). That is the same ffmpeg found from `$FFMPEG` or `PATH`
  (F-5).

## Findings

### D-1 (Low, operator): tracked files show the owner's local paths and one other user name

- **Where:** see the Summary row. `.personas/skill-registry.json` has 12 lines of
  `C:/Users/kazda/...`, naming the skills library and 11 local repositories.
  `.claude/lens-scan/config.md:3` has `C:/Users/kazda/kiro/bp/...`. `docs/build/rebuild/wp4c.md:66`
  has `C:/Users/mkdol/AppData/Roaming/Python/...`. `.claude/contest/config.md:2` and `:15` (P-3)
  are still tracked.
- **Why it matters:** these disclose the OS user name, the directory layout and the names of other
  private projects. None is a credential. The files configure local tooling, and the build does
  not read them.
- **Blocks publication:** no, by the P-3 precedent. If `mkdol` is not the owner, that line is a
  third party's identifier. It is still only a Windows user name, but the operator should confirm.
- **Fix:** `git rm --cached .personas/skill-registry.json .claude/lens-scan/config.md
  .claude/contest/config.md` and ignore them, or rewrite the paths as `<home>`/`<repo>`
  placeholders. Edit `wp4c.md:66` to a placeholder. History keeps the old text until the
  pre-publication history rewrite that P-1/P-2 already call for. All of these paths are outside
  this task's `docs/security/` scope.

### D-2 (Low): a refusal names vendor products on screen

See question 2. *Fix:* one string in `crates/table-runtime/src/engines.rs:193` and the matching doc
line. A test that greps runtime messages for the vendor names would keep it out.

### D-3 (Low): a LISTING without a quantity still verifies and binds none

See question 2. *Fix:* require `qty`. The J-3 test at `listing_code_tests.rs:303-310` already
covers the altered-quantity case. Add a `None` case that must be refused.

### D-4 (Low, operator): the commit e-mail in the range's history

Same as P-2 and F-7. *Action:* the operator decides. A commit cannot change it.

### D-5 (Info): `NotFound` replaces a SQL fault on four reads

See question 2. Checked and closed by every caller. *Action:* none.

### D-6 (Info): toolchain components

See question 3. *Action:* accept.

### D-7 (Info): conform evidence describes credential-custody gaps

The `credential-vault` conform run (`5f5996b`) records registry proposals for the market API key:
stored after a syntax check only, no authenticate-before-store, overwritten without validation, and
no token lifecycle. They are descriptions of existing code with relative `file:line` references and
no value. That the gaps are public is not a blocker. They are backlog items for `table-market` and
`configuration.rs`, which this report-only run does not change.

## Known, not re-reported

- The previous scan's F-6 (director in the release bundle) is closed by `a65be99`, before this
  range: `vite.config.ts:32-35` builds `director.html` only under `THE_TABLE_DIRECTOR_BUILD=1`
  (`package.json` `build:director`), and `README.md:57-58` (this range, `2275be8`) now says so.
- F-2 (ElevenLabs terms for a published render), F-3 (capture writes under any film dir), F-4 and
  F-5 are unchanged by this range.
- The scan-sweep carry for `paypal-gateway` ("token-failure drops observations",
  `.claude/scan-history/scan-sweep.jsonl`) is an open backlog item handed to Approvals, not a
  secret.
- J-6 (`listingCode.ts`, `6f7f3d5`) caps a pasted code at 512 characters on the client. The fix is
  closed in `scan-2026-10-17-join.md`.

## Verification

- `git log -p e0105056..HEAD` and `git diff e0105056..HEAD` grepped as listed under Scope.
  `git log --format='%ae %ce'` gives one identity for all 34 commits. `git log --numstat` lists no
  binary file. `git ls-files | xargs grep` was run for absolute user paths. I read every caller of
  the four `NotFound` reads.
- Gates: this commit adds one Markdown file under `docs/security/` and no code, so `cargo test`
  was not run for it. The merge gate runs `cargo test --workspace`. No client file changed, so tsc
  and vitest were not run.

## Questions for the operator

1. D-1: is `mkdol` (`docs/build/rebuild/wp4c.md:66`) you? Should `.personas/skill-registry.json`,
   `.claude/lens-scan/config.md` and `.claude/contest/config.md` be untracked before publication?
2. D-3: no released build has signed a LISTING without a quantity. Can `qty` become required now?

Open publication blockers: 0
