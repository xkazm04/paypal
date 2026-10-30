# Security scan - The Table - publication delta since 2026-10-19 - 2026-10-23

A publication-blocker pass over `c7f6477..bf87d2b` (local `main`): 473 commits (one merge,
`d899bae`), 571 files, +26946/-11475. The range holds the D-2 and D-3 fixes from the last delta
scan, the belay refactor waves 2-13 (pipeline, ledger and client modules split into submodules),
the 10-21/10-22 scan-sweep lanes (native-shell window refusal and navigation allowlist, the MCP
`mcp.withheld` audit and call budget, scheduler tick and live-deals walk, typed engine process
causes and the run-directory sweep, the PayPal gateway's 45 s bound and token retry, owner tickets
bound to their session), origin's house-tick live-deals read (`5561e96`, merged in `d899bae`), two
RustSec bumps and many client wording and dead-code fixes. Branch
`autopilot/codebase-security-scan-f4ed0782`, cut from `bf87d2b`. **No open publication blocker was
found.** One Medium, five Low and five Info findings are reported below. Nothing was fixed: this
run is report-only. No network call was made, no live PayPal call was made and no money was used.

Range scanned: `git log c7f6477..main`, from `68b8697` to `bf87d2b`. The 53 `chore` commits (36
`registry-map`, 13 `scan-sweep`, 2 `context-map`, the merge `d899bae`, and `751060b`) are
bookkeeping and were grepped, not read line by line, except for the two that touch code: the
merge, whose diff equals `5561e96` (`crates/table-app/src/pipeline/resolve.rs`,
`services/house-seller/src/hosted.rs`), and `751060b`, which removes `tauri-plugin-notification`
(`apps/desktop/src-tauri/{Cargo.toml,src/native.rs}`, `Cargo.lock`). Both were read in full.

Scope (read in full, by diff, with the current code around each hunk):
- **MCP and engine:** `aa04675`, `f5ecf8b`, `90a833e`, `9aa2499`, `3435338`, `c567192`
  (`crates/table-mcp/src/lib.rs`, `crates/table-app/src/agent.rs`); `b9c4b91`, `336774a`,
  `e2dd94e`, `34e76bb`, `b84b4fd`, `49ca550`, `ef6ba9b`, `15f7e50`, `2817b23`, `ffc9318`,
  `1555394`, `8be82e5` (`crates/table-engine/src/*`, `crates/table-runtime/src/engines.rs`).
- **Native shell and IPC:** `7305456`, `53bcc13`, `c12f46c`, `14498d9`, `7942be5`, `869cf48`,
  `9fe28f1`, `a9765d7`, `b3d033d`, `0836f84`, `d6efc54`, `9fa0bea`, `be25b8d` (`native/toast.rs`),
  `1c309d5`, `b05f2c4`, `aeb96cd` (`crates/table-app/src/auth.rs`), `35e9a7f`, `23a8f1b`, `e1a2e26`,
  `3bed05a`; the range diff of `apps/desktop/src-tauri/**`, `crates/table-client/src/authority*.rs`,
  `bindings/authority.ts` and the capability files.
- **Scheduler, house tick and services:** `5561e96`/`d899bae`, `d4575c1`, `2d674bf`, `cd3fb33`,
  `6748540`, `6cb2899`, `b08eead`, `d5e0dfe`, `a810123`, `b1ea0ba`, `2bd407c`, `a62aabe`,
  `1e64b35`, `e6c6e44`; `services/house-seller` (`32c4176`, `d6a4ba5`, `3582888`, `d4b3d3f`,
  `4b23d58`, `5d29b2f`, `716d9f7`, `19847c3`) and `services/rendezvous` (`909ae5f`, `be7dfb8`,
  `91826ec`), `render.yaml`.
- **Money path and PayPal gateway:** the 16 move-only refactors (`84b5dca`, `2fa3eb2`, `49a595d`,
  `f46a48d`, `e87d1bb`, `eec11d5`, `87c09c3`, `4da439b`, `13db708`, `15b4513`, `3ad94fc`,
  `40df26a`, `03540e3`, `2920807`, plus the argument bundles `3d0db89` and `ed87783`) were checked by
  diffing whitespace-normalised removed against added lines and reading every call site of the
  bundles; behaviour fixes `6ac02ad`, `9c15e80`, `bd0fcc2`, `cc623dc`, `7301114`, `2639812`,
  `a27a858`, `1374c5d`, `2096c2c`, `2a016f3`, `ad8fd82`, and `table-verify` `1c61401`, `700dd05`,
  `8eb899e`, `e685573`, `23822e4`, `3369386`; `crates/table-paypal` `eebbb1a`, `c56c04e`, `458cdf2`,
  `86fb7a3`, `e4fe715`, `84ad975`, `d6c28b0`, `a3b2078`, `557c6a6`, `f449ccc`, `058295f`; the range
  diff of `crates/table-ledger/src/audit.rs`.
- **Dependencies and CI:** `Cargo.toml`, every crate `Cargo.toml`, `Cargo.lock`, `deny.toml`
  (`0fc63d4`), `5ca7aea`, `.github/workflows/ci.yml`, `apps/desktop/client/package.json`.
- The remaining client commits (wording into `lib/words`, dead exports, CSS, a11y, mock parity)
  were read by subject and grepped with the rest of the patch. None touches IPC, a capability or a
  money command.
- **Secrets and personal data:** the full patch (`git log -p c7f6477..main`, 63510 lines) grepped
  on added lines for key and token shapes (`sk-`, `sk-ant`, `ghp_`/`gho_`/`github_pat`, `xox*-`,
  `AKIA`, JWT `eyJ`, PayPal `A21AA`, `BEGIN ... PRIVATE`, quoted `secret|password|api_key|bearer|
  client_id|private_key` values), e-mail addresses, every URL, drive-letter, `\Users`, `/Users/`
  and `/home/` paths and the owner's user and mail names. `git log --numstat` checked for
  binaries. `git log --format='%an <%ae> | %cn <%ce>'` checked for identities. The **whole tracked
  tree** (`git ls-files`) grepped for absolute user paths. `git log --all` searched for the two
  root files named in the brief.

Severity and the definition of a blocker are those of `scan-2026-10-19-delta.md`: severity is
judged for publishing this repository, a hackathon desktop wallet against the PayPal **sandbox**.
A "publication blocker" is something that must not be in a public repository or its history: a
live secret, a third party's personal data, or an asset without a redistribution licence. Local
paths and commit metadata showing the owner's own identity are Low and not blocking (precedent
P-3, kept in D-1 and D-4). A broken money invariant from AGENTS.md would also be reported as
blocking; none was found.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Recommended fix |
|---|---|---|---|---|---|
| E-1 | Medium | money-path liveness (safe default starved) | `crates/table-runtime/src/scheduler.rs:27-28` (`d4575c1`) | no | Put the `list_deals()` error into `failure.get_or_insert(...)` instead of `?`, or run the ended-deal prune after the deal loop |
| E-2 | Low | personal data (commit metadata) | `d899bae` (author and committer `kazdanm@gmail.com`); `5561e96` (author `kazii <kazdan@seznam.cz>`, committer GitHub); 471 others `xkazm04 <kazdan@seznam.cz>` | no (operator) | Same as D-4/P-2, with one change: the history is already on `origin` (GitHub PR #2), so "rewrite before the first push" no longer applies; decide before the repo turns public |
| E-3 | Low | personal data (local paths) | D-1 still open: `.personas/skill-registry.json:5`, `:11`, `:22`-`:76`; `.claude/lens-scan/config.md:3`; `.claude/contest/config.md:2`, `:15`; `docs/build/rebuild/wp4c.md:66` (`mkdol`); **missed by D-1:** `context-map.json:2836` | no (operator) | As D-1; for `context-map.json` ask the Personas scanner to write a relative or placeholder root |
| E-4 | Low | audit gap on a refusal | `crates/table-mcp/src/lib.rs:595-599` (`aa04675`) | no | Surface a failed `mcp.withheld` write (runtime fault) instead of `let _`; keep serving the refusal |
| E-5 | Low | evidence overstates a send | `crates/table-paypal/src/client.rs:205-215` (`eebbb1a`) | no | Push the status-0 "unanswered" observation only when a request is on the wire |
| E-6 | Low | dev tooling can reach a release bundle | `apps/desktop/client/vite.config.ts:15`, `src/lib/mount.tsx:13-16`, `scripts/dev/tauri-dev-test.mjs:24` (`3bed05a`) | no | Give `tauri:dev:test` its own `outDir`, or fail a release build whose `dist/` carries `data-loc` stamps or the `DevInspector` chunk |
| E-7 | Info | retry rests on an unverified PayPal behaviour | `crates/table-paypal/src/client.rs:181-189`, `:386-419` (`e4fe715`, comment only) | no | Spikes 3 and 4 in the sandbox, or send capture with `retry=false` and let the resolver's read-before-resend (`pipeline/resolve.rs:733`) cover a lost answer |
| E-8 | Info | error ordering | `crates/table-app/src/pipeline.rs:691-695`, `crates/table-app/src/rescue.rs:618-622` (`5561e96` fixed only `resolve.rs:205-210`) | no | Apply the same "the step's own error wins" match in both places |
| E-9 | Info | raw error text to the owner | `apps/desktop/src-tauri/src/main.rs:6` and `crates/table-os/src/windows_native.rs` (`9fe28f1`) | no | Map the `Ledger::open` and `create_dir_all` failures to fixed words like the other setup steps |
| E-10 | Info | CSP defence in depth | `apps/desktop/src-tauri/tauri.conf.json:7` | no | Add `base-uri 'none'; form-action 'none'` and pin them in `tests/capabilities.rs:120` |
| E-11 | Info | stale advisory reason | `deny.toml:5-7` (`0fc63d4`, then `751060b`) | no | Reword the three zbus reasons: the notification plugin is gone; zbus is still in `Cargo.lock` via the opener and single-instance plugins |

**Open publication blockers: 0.** E-2 and E-3 need an operator decision. Both concern the owner's
own identity (commit e-mails, OS user name) and are not secrets. One D-1 path still names a second
OS user (`mkdol`).

## Answers to the questions

### (a) Secrets, keys, tokens, personal data or machine paths, in tracked files or in the range's history

**Verdict: none blocking. The range adds no secret and no absolute path. The tracked tree still
holds D-1's owner paths plus one D-1 missed (E-3). The range adds a second owner e-mail to commit
metadata, and that history is already on GitHub (E-2).**

- **`grep.exe.stackdump` and `demo-film-latest.mp4` are not tracked and never were.**
  `git ls-files` lists neither. `git log --all -- grep.exe.stackdump demo-film-latest.mp4` and an
  added-file search across all refs are empty. Both are ignored (`.gitignore:15` `*.stackdump`,
  `.gitignore:41` `/demo-film-latest.mp4`). They exist only in the operator's checkout. I read them
  there without git: the stackdump is 30 lines (1729 bytes) of msys `grep.exe` frame addresses
  (`msys-2.0.dll+0x...`), with no path, user name or environment. The mp4 is a 64.9 MB local render,
  the D-1/F-2 film output, and is ignored. No binary file at all is added in the range
  (`git log --numstat` has no `-` row). No `.env`, `.pem`, `.key`, `.p12`, `.exe` or `.dll` is
  tracked.
- **Keys and tokens.** The secret-shape grep over every added line is empty. Matches for
  `secret`/`token`/`key` are prose in `.ai/conform-runs/merged/*.json`,
  `.claude/scan-sweep/findings/*` and `.ai/registry-map.json` (evidence sentences with relative
  `file:line`), identifiers (`token_matches`, `McpGrant`, `IDLE_LOCK_SECS`) and test dummies:
  - `crates/table-paypal/tests/client.rs:13-60`: random 32-byte tokens, in-memory transport.
  - `crates/table-paypal/src/http.rs:196-268`: `Bearer x` against `127.0.0.1`.
  - `crates/table-mcp` tests: generated session secrets.
  - Live tests stay `#[ignore]` and read environment variables (`client.rs:791`, `spikes.rs:141`,
    `:161`, `:197`, `:262`).
  - `render.yaml` keeps every secret `sync: false`, and `d4b3d3f` only ties it to `ENV_NAMES`.
- **E-mail and personal data.** Added addresses are all `example.com` (`subscriber{n}@example.com`,
  `s•••@example.com`, `maya@example.com` in tests). The house's public ledger view
  (`crates/table-proto/src/house_ledger.rs:252-273`) carries no payer e-mail, payer id or PayPal
  order or capture id, and the scoreboard and glass commits change counts and wording only. The
  relay's new refusal trace (`services/rendezvous/src/lib.rs:164`) logs a code and a count, with no
  address.
- **URLs added.** `api-m.sandbox.paypal.com` (the one origin constant, `84ad975`), one sandbox
  `checkoutnow?token=ORDER1` test string, `api.trychannel3.com` (the existing market provider,
  `171a157`), the ts-rs GitHub link, and loopback or `evil.com`/`tauri.localhost` shapes in the
  navigation and MCP tests. No live endpoint carries a credential.
- **Absolute paths.** None added. The grep over added lines hits only the 10-19 report's own text.
  `git ls-files | xargs grep` for `C:/Users`, `C:\\Users`, `/Users/<name>` and `/home/<name>/`
  finds D-1's five files unchanged and **`context-map.json:2836`** (`"root":
  "C:\\Users\\kazda\\kiro\\paypal"`). That line predates the range (`5dbb837`, 2026-10-14) and was
  in the tree at `c7f6477` (line 2444). D-1 missed it. It is the Personas map's project root, and
  the scanner rewrites it on each scan (`4a59ccf`, `9ff983c` in this range), so a manual edit would
  not last (E-3).
- **Commit metadata (E-2).** 471 commits are `xkazm04 <kazdan@seznam.cz>`, as before. `d899bae` is
  `xkazm04 <kazdanm@gmail.com>`, a second address of the owner and new in this history. `5561e96`
  is `kazii <kazdan@seznam.cz>`, committed by `GitHub <noreply@github.com>` with the title
  "... (#2)". That is a pull request merged on `origin` (`https://github.com/xkazm04/paypal.git`).
  The 10-19 advice ("history needs a rewrite before the first push") is therefore out of date: this
  history is already on GitHub. Whether that repository is public was not checked, because this
  run makes no network call.
- **Bookkeeping.** The 53 chores add 32 `.ai/conform-runs/merged/*.json`, 29
  `.claude/scan-sweep/findings/*`, `.claude/scan-history/ab.jsonl` and
  `.claude/scan-sweep/handoff-optimize-2026-10-22.jsonl`, and modify `.ai/conform-detail.json`,
  `.ai/registry-leads.jsonl`, `.ai/registry-map.json`, two `scan-history` files and
  `context-map.json`. They hold relative `file:line` evidence and ISO timestamps, with no value,
  e-mail or absolute path.

### (b) Money-path and authority changes, against AGENTS.md

**Verdict: no invariant is broken. The LLM gains no tool, every PayPal money call is still made in
`table-app`'s pipeline under a recorded authority, and nothing adds an UPDATE or DELETE on
`audit_log`. The scheduler can now be stalled before its deadline loop by one unreadable terminal
row (E-1, Medium).**

- **Scheduler tick and live-deals walk.**
  - `list_live_deals` (`crates/table-ledger/src/repositories.rs:604-614`) is `DealState::ALL`
    filtered by `terminal()`. The `NOT IN (...)` list is built from enum constants, not input.
    Every walk already returned early on terminal deals before the change:
    - `pipeline.rs:706` (`deadline_default_once`)
    - `rescue.rs:626-631`
    - `services/house-seller/src/hosted.rs:908-910`
    - `scheduler.rs:40`, `:47`

    The narrowing therefore skips nothing that had work.
  - No held authorization can sit in a terminal state. AUTHORIZED leaves only through
    CaptureConfirmed, Void or AutoVoid (`crates/table-core/src/deal.rs:389-397`). Withdraw,
    Mismatch and Fail are refused there (`deal.rs:241`). An open authorize keeps APPROVED from
    expiring (`pipeline.rs:728-735`).
  - The tick's money calls are a void, an expiry or a read-back only (`scheduler.rs:106-111`,
    `pipeline.rs:738-748`). It never captures, so silence still moves no money.
  - **E-1:** `d4575c1` added a cleanup read of *every* deal, `app(...list_deals())?` at
    `scheduler.rs:28`, ahead of the deadline loop at `:39`. `read_deals` re-checks each row's
    terms hash and decodes its JSON. One unreadable terminal row therefore fails the read, and the
    `?` returns before any `deadline_default` runs. That happens on every tick while the read
    schedule is non-empty, which is exactly when lost or parked money steps are pending.
  - E-1's effect is that safe-default voids are starved while the bad row stays, not that money
    moves. Before `d4575c1`, only a bad *live* row (`:16`) could stop the tick. Reaching this needs
    ledger corruption or a decode bug, so it is not a blocker.
- **House tick (`5561e96`, merged in `d899bae`).**
  - Create, authorize and capture run under `Authority::HouseMandate`
    (`services/house-seller/src/hosted.rs:950`, `:964`, `:972`).
  - Seating checks `active_mandate` with the owner key (`hosted.rs:501-505`).
  - Startup refuses a mandate, keys or validity window that the release does not pin
    (`hosted.rs:289-297`, `:365-368`). `b1ea0ba` and `2bd407c` record a refused head as
    `house.head_refused` (`crates/table-ledger/src/witness.rs:171`) and never keep it.
  - The deadline check (`hosted.rs:914-926`) runs before the capture arm (`:967-974`).
    `bound_capture` (`:888-903`) can only pull a deadline earlier, with saturating arithmetic.
  - `a62aabe` saturates the default purchase deadline (`crates/table-runtime/src/service.rs:21-23`),
    so it can no longer wrap into the past.
  - The "prune-error ordering" fix covers `resolve.rs:205-210` but not `pipeline.rs:691-695` or
    `rescue.rs:618-622` (E-8). In those two places the step runs before the prune, and the prune
    drops in-memory schedule entries only. The gap can mislabel an error but skips no work.
- **MCP refusal and audit path (`aa04675`, `f5ecf8b`, `90a833e`, `9aa2499`, `3435338`, `c567192`).**
  - No MCP tool was added. The list is unchanged (`crates/table-mcp/src/lib.rs:277-289`,
    `Tool::ALL` `:311-319`): read-only views, offer, accept, withdraw and `propose_purchase`.
  - `params._meta` is parsed into an ignored field (`:272-274`), and unknown keys are still refused
    (`:266-267`). Deal, role and run come from the Rust-held session (`:483`, `:556`), so a client
    cannot smuggle in a grant or a deal.
  - `mcp.withheld` and `mcp.abandoned` rows go through `Ledger::append_audit`
    (`crates/table-app/src/agent.rs:515-530`). That is an insert chained onto the previous hash
    (`crates/table-ledger/src/audit.rs:307-313`), with detail keys limited by `audit_detail.rs`.
  - Every refusal still refuses when its audit write fails. One audit write is dropped silently:
    the oversize-answer `let _` (`lib.rs:595-599`, E-4).
  - The per-session call budget is a Rust counter incremented under the session lock with
    `saturating_add`. A poisoned lock or a missing session counts as over budget (`:504-514`), and
    the counter is checked before parsing (`:527-535`).
  - The session lifetime (`SESSION_SECS` = 120, `:114`) equals the native run ceiling
    (`crates/table-engine/src/native.rs:22-28`).
  - The shared-secret compare uses `subtle` `ct_eq` (`lib.rs:22-24`). Its length short-circuit
    reveals nothing, because the secret is always 64 hex characters on loopback.
  - `Grant`, `Server` and `McpGrant` have redacting `Debug` impls.
- **Native shell, webview and window handling.**
  - **Navigation:** the allowlist is an exact match on scheme, host and port, and it refuses any
    URL that carries a username or password (`apps/desktop/src-tauri/src/native/navigation.rs:7-19`).
    `http://tauri.localhost@evil.com/`, `https://tauri.localhost.evil.com/`,
    `https://evil.com/tauri.localhost` and `http://tauri.localhost:8080/` are all refused, and the
    tests cover these shapes (`navigation_tests.rs`). Loopback is allowed only under
    `cfg!(debug_assertions)` (`:23`).
  - **New windows:** new-window requests are refused on all three windows: main
    (`native.rs:336-337`), tumbler (`:356-357`) and approval (`routing.rs:70-71`).
    `tests/capabilities.rs:91` pins one builder per label, each with both handlers.
  - **CSP:** `tauri.conf.json:7` has `script-src 'self'`, no `unsafe-eval` or `unsafe-inline`,
    `connect-src ipc: http://ipc.localhost`, and `object-src`/`frame-src 'none'`. It is pinned
    directive by directive (`tests/capabilities.rs:120`). It has no `base-uri` or `form-action`
    (E-10).
  - **Startup failure:** the message box (`9fe28f1`) can show raw io or rusqlite text, at most a
    local path and never a key (E-9).
  - **Inspector:** the overlay can reach a release bundle when `pnpm tauri:dev:test` has left an
    inspector build in `client/dist` (E-6). It only copies a source location to the clipboard, with
    no IPC.
- **Owner tickets (`aeb96cd`).** A ticket carries a random 16-byte session id
  (`crates/table-app/src/auth.rs:84-85`, `:157`) that `validate` checks (`:176`), so a ticket from
  another session is refused. The IPC token compare stays constant time (`token_matches`,
  `auth.rs:47-60`). `Caller`'s `Debug` omits the token (`crates/table-runtime/src/actor.rs:317-322`).
- **Engine process spawning.**
  - **Environment:** `env_clear` runs first (`crates/table-engine/src/native.rs:78`), then only
    `ENV_ALLOW` names are restored (`:30-44`, `:82-86`). `tests/engine.rs:427-440` checks that no
    `STRIP_ENV` name (`argv.rs:134-147`) is restored.
  - **Secrets in files:** `mcp.json` holds only `${WALLET_MCP_TOKEN}`/`${WALLET_MCP_SECRET}`
    placeholders (`native.rs:139`). The values go to the child's environment only (`:171-172`).
  - **Startup sweep (`336774a`):** it acts only on direct children of the canonicalised run root,
    and only on exact 36-character UUID names (`:329-335`). It requires
    `symlink_metadata().is_dir()` (`:346`), so links and junctions are skipped. A narrow race
    (`:349-356` against `:390-396`) can fail a brand-new run, but cannot delete anything outside
    the root.
  - **What is stored:** the stored cause is `spawn`, `attach`, `pipe` or `exit:<int>`
    (`crates/table-engine/src/lib.rs:127-137`). The child's stderr is drained and dropped
    (`native.rs:188-196`), and no shell string is built (`Command::new` plus an argument list).
- **PayPal calls only in the pipeline.**
  - Every create, authorize, capture, void and invoice call outside `table-paypal` is in
    `table-app`: `pipeline/send.rs:67`, `:363`, `:472`; `pipeline.rs:231`; `pipeline/resolve.rs:415`,
    `:602`, `:733`, `:782`; and `rescue/invoice.rs:17`, `:87`, `:318`.
  - `table-runtime` (`scheduler.rs:201`, `:217`; `service.rs:749`, `:763`) and the house only call
    `Pipeline::authorize`/`capture` with an `Authority`.
  - The 16 move-only refactors change visibility and `use` lines only. `send.rs` keeps the order
    authority, then shield, then countersign or capture window, then reserve, then send
    (`:32-39`, `:334-341`, `:426-435`).
- **PayPal gateway.**
  - The PayPal-Request-Id is set once per call and resent unchanged (`client.rs:263-265`).
  - A 401 refreshes the token once (`:313-317`).
  - Secondary money POSTs use `retry=false` (`secondary.rs:212`, `:229`).
  - The token retry (`:116-141`) resends only the OAuth form.
  - `Error::Credentials` names only its kind (`types.rs:250-268`).
  - Observations are redacted before they are stored (`client.rs:173-178`, `:292-295`) and again
    on insert (`repositories.rs:160`, `:165`).
  - The 45 s deadline can record a status-0 row for a request that was not on the wire (E-5).
    Retried capture and void still rest on PayPal honouring the request id on Payments v2, which
    is unverified (E-7, a behaviour from before the range).
- **audit_log.** No UPDATE or DELETE was added, and no migration changed. The append-only triggers
  stand (`crates/table-ledger/migrations/0001_table.sql:47-48`). The only production insert is
  `audit.rs:185`. New appends (`receipt.rs:125`, `reconciliation.rs:106`, `negotiation.rs:430`)
  go through `audit::append`.

### (c) New IPC commands, capabilities and the authority manifest

**Verdict: no new IPC command, no changed authority row, and one capability grant removed.**

- `crates/table-client/src/authority_table.rs`, `bindings/authority.ts` and
  `apps/desktop/src-tauri/build.rs` have no diff in the range. `generate_handler!` and the
  `#[tauri::command]` set are unchanged.
- `PINNED_MANIFEST` is unchanged:
  `b2f04fe9561ade53614a195e09f37555a76106c00e3750525add74b1ab854ac4` (`authority.rs:246-247` at
  `c7f6477`, `:243-244` now).
- `1c309d5` removes `core:window:allow-start-dragging` from `capabilities/tumbler.json` and from
  `core_permissions` (`authority.rs:105-109`). `b05f2c4` pins each window's core permissions by
  hand (`authority.rs:442`), and `7942be5` pins that every token row's handler forwards the IPC
  header (`tests/capabilities.rs:240`).
- The money commands (`deal_countersign`, `shield_release`, `rescue_approve`,
  `open_paypal_in_browser`, `deal_capture`, `deal_void`) are granted only in `approval.json`. No
  fs, shell, http, opener or dialog permission is granted to any window.
- `751060b` removes the `tauri-plugin-notification` dependency and its initialisation. The toast
  goes through the existing `tauri-winrt-notification` (`native/toast.rs`).

### Dependencies and toolchain

- Workspace dependency declarations: `zeroize`, `time` and three path crates (`171b0ff`).
- `subtle` added to `table-mcp` (`c567192`, already a workspace dependency).
- `table-market` drops `serde` and `url` (`81ae896`).
- `tokio` `test-util` is a dev-dependency of `table-paypal`.
- `Cargo.lock` loses `tauri-plugin-notification`, `notify-rust` and `mac-notification-sys`.
- `5ca7aea` bumps `rustls-webpki` 0.103.15 → 0.103.16 and `webpki-roots` 1.0.9 → 1.0.10 for
  RUSTSEC-2026-0381/0382.
- Client: `vite` `^8.3.2` → `^8.3.4` (`23a8f1b`); CI gains `pnpm audit --audit-level=high`
  (`e1a2e26`).
- `deny.toml` ignores RUSTSEC-2026-0370/0371/0372 (unmaintained zbus crates, compile-time chain
  under Tauri's Linux plugins). The reasons name the notification plugin, which `751060b` later
  removed (E-11).
- No new third-party crate and no licence change.

## Findings

### E-1 (Medium): an unreadable terminal deal stops the tick before its deadline defaults

- **Where:** `crates/table-runtime/src/scheduler.rs:27-28` (`d4575c1`).
- **Why it matters:** see (b). The tick's void-on-deadline is the safe default AGENTS.md relies
  on. With this `?`, one unreadable row among *ended* deals starves that default for every live
  deal for as long as anything is in the read schedule. No money moves, and the tick never
  captures, so this is not a blocker. It is still a money-path liveness regression.
- **Fix:** `if let Err(error) = ... { failure.get_or_insert(error) }` around the `list_deals()`
  read, or move the ended-deal prune after the deal loop. Add a test that plants a corrupt
  terminal row and asserts that an AUTHORIZED deal past its deadline is still voided.

### E-2 (Low, operator): commit e-mails, and the history is already on GitHub

- **Where:** `d899bae` (`kazdanm@gmail.com`), `5561e96` (PR #2 on `origin`), plus every other
  commit (`kazdan@seznam.cz`).
- **Why it matters:** two personal addresses of the owner are in the history. P-2, F-7 and D-4
  planned a rewrite "before the first push", and that has already happened on GitHub.
- **Action:** the operator decides. A commit cannot change it.

### E-3 (Low, operator): D-1's local paths are still tracked, plus `context-map.json:2836`

- **Where:** see the Summary row. No D-1 line was fixed in the range.
- **Fix:** as D-1. `context-map.json` is rewritten on every Personas scan, so the scanner itself
  has to emit a relative root. The paths are outside this task's `docs/security/` scope.

### E-4 (Low): a withheld oversize answer can leave no audit row

- **Where:** `crates/table-mcp/src/lib.rs:595-599`. The timeout path at `:566-569` uses `?`.
- **Why it matters:** the agent still gets the refusal, so this does not fail open. But a failed
  write of the `mcp.withheld` row leaves the trail silent about what the agent was told, and
  `aa04675` was meant to close exactly that gap.
- **Fix:** report the failure (a runtime fault event, or `record_refusal`'s path). Keep the
  refusal either way.

### E-5 (Low): a 45 s expiry can store an unanswered request that was never sent

- **Where:** `crates/table-paypal/src/client.rs:205-215` (`eebbb1a`).
- **Why it matters:** when the deadline fires during a backoff wait or a token refresh, a status-0
  observation carrying the PayPal-Request-Id is pushed although nothing is on the wire.
  `paypal_calls` then overstates what went out. The error is still `Unknown`, so the deal is
  reconciled and nothing fails open.
- **Fix:** push the status-0 row only while a request is in flight.

### E-6 (Low): the inspector overlay is gated by a build-time variable, not by the release profile

- **Where:** `apps/desktop/client/vite.config.ts:15`, `src/lib/mount.tsx:13-16`,
  `scripts/dev/tauri-dev-test.mjs:24`. `tauri.conf.json:6` embeds `../client/dist` and has no
  `beforeBuildCommand`.
- **Why it matters:** `tauri:dev:test` writes an inspector build into the same `dist/` that a
  later `cargo build --release` embeds. The overlay and its `data-loc="src/...:line:col"` stamps
  would then ship in all three windows, approval included. The overlay has no IPC and no fetch,
  so this is hygiene, not authority.
- **Fix:** a separate `outDir` for the inspector build, or a release-build check that refuses
  stamped assets.

### E-7 (Info): retried capture and void rest on an unverified request-id store

`e4fe715` only adds comments that say so (`client.rs:386-419`). The behaviour predates the range. A
duplicate capture is bounded by `final_capture: true` with the full amount, and a repeated void is
harmless. *Action:* sandbox spikes 3 and 4, or `retry=false` for capture.

### E-8 (Info): the prune-error ordering fix covers one of three call sites

See (b). Cosmetic: a prune error can mask the step's own error or report a recorded void as `Err`.

### E-9 (Info): startup message box shows raw setup error text

`app_data_dir()`, `create_dir_all`, `ReqwestTransport::new()`, `Ledger::open` and `build()` still
pass their `tauri::Error`/io/rusqlite text through. That is at most a local path, shown only to the
local owner. No key, token or passphrase is in these errors.

### E-10 (Info): CSP has no `base-uri` or `form-action`

`form-action` does not fall back to `default-src`. The navigation guard already refuses an outside
form post, so this is defence in depth.

### E-11 (Info): `deny.toml` reasons name a removed plugin

The zbus chain is still present (`Cargo.lock` `zbus`, `zbus_names`, `zvariant`,
`zvariant_derive`), so the ignores still apply. Only the wording is stale.

## Known, not re-reported

- **D-2** is fixed by `21ff80b`: `engines.rs` names `claude-code`/`codex-cli`, and `engines.rs:548`
  asserts that the vendor name is absent.
- **D-3** is fixed by `6ac02ad` (`crates/table-app/src/agent.rs:170`, test
  `crates/table-app/tests/listing_qty.rs`), and the operator confirmed it (`5958463`).
- **D-5, D-6 and D-7** are unchanged. D-7's credential-custody backlog is still open.
- **Earlier scans:** relay R-2 (`6f527ec`), R-4 (`332b2c0`) and R-7 (`8e2dc69`), rescue R-1 and
  owner-read O-5 (`7ec85fe`), and C-16, partly (`5f49693`), were closed in this range by their own
  commits. This scan did not re-open them.
- **The 10-18 film findings:** F-2 (ElevenLabs terms for a published render), F-3, F-4 and F-5 are
  unchanged. `demo-film-latest.mp4` stays ignored and untracked.
- **Out of scope:** the inline-code `Bearer x` loopback tests (`http.rs:196-268`) build a client
  without `.no_proxy()`. A configured system proxy could see that dummy header, which carries no
  credential.

## Verification

- `git log -p c7f6477..main` (63510 lines) grepped as listed under Scope. `git log --numstat`
  lists no binary file. `git log --format='%an <%ae> | %cn <%ce>'` gives the three identities in
  E-2. `git ls-files | xargs grep` was run for absolute user paths.
  `git log --all -- grep.exe.stackdump demo-film-latest.mp4` is empty.
- The code reviews of (b) and (c) were split across four read-only reviewers, by area. I
  re-checked their Medium and Low claims against the source: `scheduler.rs:27-28` and
  `repositories.rs:598-614` for E-1, `lib.rs:560-608` for E-4, and `vite.config.ts`, `mount.tsx`,
  `tauri-dev-test.mjs` and `tauri.conf.json` for E-6.
- **Gates:** this commit adds one Markdown file under `docs/security/` and no code, so `cargo test`
  was not run for it. The merge gate runs `cargo test --workspace`. No client file changed, so tsc
  and vitest were not run.

## Questions for the operator

1. E-2: `origin` already has this history, including PR #2. Is `github.com/xkazm04/paypal` public
   yet? If not, is the commit-identity rewrite still planned before it goes public, and does it
   now cover `kazdanm@gmail.com` too?
2. E-3: should `context-map.json`'s `project.root` be relative? The fix belongs to the Personas
   scanner, not to this repo.
3. E-1: build the `failure.get_or_insert` fix with its corrupt-row test in the next belay wave?

Open publication blockers: 0
