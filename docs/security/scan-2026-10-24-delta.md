# Security scan - The Table - publication delta since 2026-10-23 - 2026-10-24

A publication-blocker pass over `bf87d2b..ddb8bbc` (local `main`, equal to the local
`origin/main` ref): 38 commits (one merge, `94788f2`), 75 files, +8811/-405. The range holds eight
product commits (client deal model and story, approval and Tumbler CSS, new client render tests,
ledger and runtime tests) and about 30 bookkeeping commits (`.claude/scan-sweep` challenge state,
`.ai/conform-runs`, `.ai/registry-map.json`, `.ai/conform-detail.json`), plus STATUS and tiger
docs and the 10-23 report itself (`edb6578`). Branch `autopilot/codebase-security-scan-4fdf5521`,
cut from `ddb8bbc`. **No open publication blocker was found.** Two new Low findings and one Info
are reported below. The eleven 10-23 findings (E-1 to E-11) are carried forward unchanged, each
with a status line. Nothing was fixed: this run is report-only. No network call was made, no live
PayPal call was made and no money was used.

This report does not restate the owner's e-mail addresses, OS user names or absolute paths. It
cites the file and line where each one sits (see G-2 for why).

Range scanned: `git log bf87d2b..main`, from `74c26ec` to `ddb8bbc`. The merge `94788f2` joins
`2e2d105` with `714a9a6`. Its diff against its first parent is exactly `714a9a6`'s 30 files.

Scope:
- **(a) Code commits, read in full by diff, with the current code around each hunk:**
  - `74c26ec`: `windows/approval/withdraw.render.test.tsx`.
  - `8ef458b`: `windows/main/console/routeRestore.test.tsx`.
  - `402becf`: `styles/fontFloor.test.ts`, `windows/approval/modeBadge.render.test.tsx`,
    `windows/main/console/modeBadge.test.tsx`, `windows/tumbler/modeBadge.test.tsx`.
  - `f5451e2`: `approval.css`, `tumbler.css`, `fontFloor.test.ts`.
  - `d5b874e`: `crates/table-ledger/src/tests.rs`.
  - `f267e00`: `windows/main/deal/model.ts`, `model.test.ts`, `console/areas/deal/DealPage.tsx`.
  - `4a126f0`: `windows/main/deal/story.ts`, `story.test.ts`, `DealPage.tsx`.
  - `4bb129a`: `crates/table-runtime/src/policy_tests.rs`, `crates/table-runtime/src/tests.rs`.

  Client paths are under `apps/desktop/client/src/`. The STATUS-only commits `f4d5de5`, `36a654b`
  and `ddb8bbc` were read with (c).
- **(b) Bookkeeping, grepped file by file:** every file added or modified in the range under
  `.claude/scan-sweep/` (24 files in `challenge-2026-10-15/`, `findings/relay-sweep-2026-10-23.patch`,
  `findings/stabilize-2026-10-23-rendezvous-relay.jsonl`, the two `handoff-*.results.jsonl`),
  `.claude/scan-history/` (`open-backlogs.jsonl`, `scan-sweep.jsonl`), `.ai/conform-runs/merged/`
  (24 new run files), `.ai/registry-map.json` and `.ai/conform-detail.json`. That is 54 files. The
  key set of all 24 conform runs was listed, to look for fields such as `cwd`, `path`, `user` or
  `host`. There are none: `schema`, `worker`, `subject`, `evaluatedAt`, `provider`, `model`,
  `pairs`, `declined` and `consults` only.
- **(c) Docs:** `docs/build/tiger/2026-10-24-agent-negotiation-run.md` (read in full) and the range
  diff of `docs/build/STATUS.md` (read in full).
- **Patterns:**
  - The range patch (`git log -p bf87d2b..main`, 11432 lines, 8950 added) was grepped on added
    lines for key and token shapes: `sk-`, `sk-ant`, `ghp_`/`gho_`/`github_pat`, `xox*-`, `AKIA`,
    JWT `eyJ`, PayPal `A21AA`, `BEGIN ... PRIVATE`, and quoted
    `secret|password|api_key|bearer|client_id|private_key|access_token` values.
  - It was also grepped for e-mail addresses, every URL, IPv4, phone and IBAN shapes, 32+ character
    hex and base64 runs, drive-letter and `\Users`/`/Users/`/`/c/Users`/`/home/` paths, `AppData`,
    and the owner's user and mail names.
  - Commit messages in the range were grepped the same way.
  - `git log --numstat` was checked for binaries, and
    `git log --format='%an <%ae> | %cn <%ce>'` for identities.
  - The **whole tracked tree** (`git grep -F` at `HEAD`) was searched for absolute user paths and
    the owner's names. The fixed-string pass is the authoritative one: an earlier regex pass
    missed the JSON-escaped `context-map.json:2836`.

Severity and the definition of a blocker are those of `scan-2026-10-19-delta.md`, as the 10-23
report kept them. Severity is judged for publishing this repository, a hackathon desktop wallet
against the PayPal **sandbox**. A "publication blocker" is something that must not be in a public
repository or its history: a live secret, a third party's personal data, or an asset without a
redistribution licence. Local paths and commit metadata showing the owner's own identity are Low
and not blocking (precedent P-3, kept in D-1, D-4, E-2 and E-3). A broken money invariant from
AGENTS.md would also be reported as blocking. None was found.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Recommended fix |
|---|---|---|---|---|---|
| G-1 | Low | personal data (local paths) | `.claude/scan-sweep/challenge-2026-10-15/builder-brief.md:3`, `critic-brief.md:3`, `scout-brief.md:3`, `:27` (`714a9a6`) | no (operator) | Replace the four absolute repo and registry paths with repo-relative wording, or stop tracking `.claude/scan-sweep/challenge-*/*-brief.md`; any history rewrite for E-2 should cover `714a9a6` too |
| G-2 | Low | personal data republished by the scan reports | `docs/security/scan-2026-10-23-delta.md:73-74`, `:86`, `:128`, `:132-134`, `:323-324`, `:425`; `scan-2026-10-19-delta.md:54`, `:61`, `:108`, `:191`, `:259`; `scan-2026-10-18-film-pilot.md:43`, `:72` | no (operator) | When the operator settles E-2/E-3, redact the addresses, OS user names and paths in `docs/security/*.md` in the same pass. Otherwise a history rewrite leaves them in the tree |
| G-3 | Info | counterparty-chosen anchor in a display fact | `apps/desktop/client/src/windows/main/deal/story.ts:194-201`, `:223-231` (`4a126f0`) | no | Keep the fact out of the approval window, or show it next to the market reference if S4 moves it there |

**Open publication blockers: 0.** G-1 and G-2 add to E-2/E-3. They concern the owner's own
identity (OS user names, local paths and commit e-mails, already in the history) and are not
secrets.

## Answers to the questions

### (a) The eight code commits: money path, IPC and the deal page's sources

**Verdict: nothing on the money path moved. The new deal-page facts come only from local state
the main window already read.**

- **Production code changed in four files only:** `model.ts` (+10), `story.ts` (+31/-2),
  `DealPage.tsx` (+5/-5), and two stylesheets.
  - No Rust production file changed. The three Rust files are test modules:
    - `crates/table-ledger/src/lib.rs:203-204` is `#[cfg(test)] mod tests`.
    - `crates/table-runtime/src/lib.rs:30-31` is the same for `tests`.
    - `crates/table-runtime/src/tests.rs:27` declares `policy_tests` inside it.
  - `crates/table-client`, `bindings/`, `apps/desktop/src-tauri/**` (capabilities,
    `tauri.conf.json`, `build.rs`), `services/`, `Cargo.toml`, `Cargo.lock`, `deny.toml` and
    `crates/table-ledger/migrations` have no diff in the range (`git diff --quiet` over all of
    them).
  - So there is no new IPC command, no changed authority row and no changed `PINNED_MANIFEST`.
- **`actingRun` (`model.ts:354-361`, `f267e00`).**
  - It is a pure filter over `useRuns().data`, the `agent_runs` read
    (`authority_table.rs:245`, MAIN, Read, OPEN).
  - It picks the live run (`running`/`starting`), else the last one listed, instead of the first.
  - It selects which already-read run's playbook and badge the page shows
    (`DealPage.tsx:205`, `:228`). It sends nothing.
- **`askingDrop` and the two new buyer facts (`story.ts:194-201`, `:223-231`, `4a126f0`).**
  - Inputs are the deal (already held), the display band (`useWorldSelector`), and `steps`.
    `steps` is the `deal_transcript` read the page already made: `DealPage.tsx:69` and `:147` for
    the sheet, `:197` for the story view (`authority_table.rs:202`, Read, OPEN).
  - No new query, `invoke` or fetch.
  - It uses the counterparty's own priced steps only (`by === 'them'`). It requires
    `verified === true` on both the listing and the latest step. That flag is set by Rust
    (`crates/table-core/src/display.rs:43-50`), not by the client.
  - It requires one currency and a positive listing. Integer minor-unit arithmetic with a floored
    basis-point ratio cannot divide by zero (`listing.price.minor <= 0` returns null).
  - "Room under your most" is shown only when the ceiling's currency matches and the room is
    `>= 0`.
  - `standingFacts` is called only from the main window's `DealPage.tsx` (grep over
    non-test files). The approval window does not show these facts, so they cannot sway a money
    decision there. The anchor is chosen by the counterparty (G-3, Info).
- **CSS (`f5451e2`).** `approval.css` and `tumbler.css` change sizes and font tokens only:
  `.dr-mark`, `.nx-n`, `.mini`, `.fr-n`. No selector that hides, reorders or disables a control
  changed. The approval window's buttons and their states are untouched.
- **Client tests (`74c26ec`, `8ef458b`, `402becf`).**
  - All run over `mockBackend` through `vi.mock('.../lib/runtime')`. `withdraw.render.test.tsx`
    wraps the mock's `invoke` only to record calls, and asserts that "Keep the deal" sends no
    `deal_withdraw`.
  - `fontFloor.test.ts:9-19` reads stylesheets with `node:fs` under `process.cwd()/src`. It keys
    them by a repo-relative slice and stores no absolute path.
  - No test makes a network call.
- **Rust tests (`d5b874e`, `4bb129a`).**
  - `d5b874e` exports a proof bundle from an in-memory ledger and checks `deal.mode` in three
    places.
  - `4bb129a` runs the real `PolicyEngine` through an in-process MCP router (`Loopback`,
    `policy_tests.rs:63-70`). The URL `http://127.0.0.1:8765/mcp` is a label: no socket is bound.
  - It also uses `OfflineHttp` and `MemoryVault` (`tests.rs:377-395`). It asserts zero PayPal
    paths, an unagreed deal, and one wallet refusal of the agent's `accept_offer` on the ask-me
    clause.
  - The test confirms that a fence still holds; it does not loosen one. `setup_priced` only
    lifts the listing price into a parameter.
- **AGENTS.md invariants.** The LLM still gains no tool. No silence path changed. No UPDATE or
  DELETE on `audit_log` was added, and the migrations are unchanged.

### (b) Bookkeeping files

**Verdict: no secret, token, PayPal credential, private key or third-party personal data. Three
of the 54 files carry absolute paths that name a second OS user of the owner (G-1).**

- **Absolute paths (G-1).** `714a9a6` ("snapshot scan-sweep state before retiring local
  checkout") adds three briefs written on the other machine:
  - `builder-brief.md:3`, `critic-brief.md:3` and `scout-brief.md:3` name that checkout's repo
    root.
  - `scout-brief.md:27` names a sibling `ai-registry` checkout.

  The OS user is the one D-1 already found in `docs/build/rebuild/wp4c.md:66`.
- **Keys and tokens.** The secret-shape grep over the range's added lines has one hit, a false
  positive: `sk-` inside `"risk-assessor"` in `.claude/scan-history/scan-sweep.jsonl`.
  - The quoted-credential grep is empty.
  - `secret`/`token`/`key` matches are prose in the conform evidence (`tokens.css`,
    `approval_token`, "a shared secret and a per-session bearer token (lib.rs:...)").
  - The relay-sweep patch's only URL is the test loopback `https://127.0.0.1:9/`.
- **Identifiers.** Every 32+ character run is a UUID: conform worker ids
  (`.ai/conform-runs/merged/<uuid>.json`), registry subject keys (`<uuid>/<subject>` in
  `conform-detail.json`), and backlog ids in the `handoff-*.results.jsonl` files. None is a
  credential.
- **E-mail and URLs.** No address appears in any bookkeeping file except
  `noreply@anthropic.com` in a commit-trailer template (`builder-brief.md:23`). No URL appears
  other than the loopback above.
- **Content.** The challenge cards, critic verdicts and backlog titles describe open weaknesses,
  for example "A failed token refresh between retries drops the earlier attempts' observations".
  That is the same class of disclosure as `docs/security/`, about a sandbox-only wallet, and is
  not a blocker.

### (c) Tiger record and STATUS

**Verdict: clean.**

- `docs/build/tiger/2026-10-24-agent-negotiation-run.md` names the council seats and their model
  ids, one cost figure ($11.37), the demo personas ("Maya", "Dan") and repo-relative files. It has
  no path, address, key or real person's data.
- The STATUS diff adds acceptance rows and gate counts with repo-relative paths only.

## Findings

### G-1 (Low, operator): a second OS user's paths are tracked in three challenge briefs

- **Where:** `.claude/scan-sweep/challenge-2026-10-15/builder-brief.md:3`, `critic-brief.md:3`,
  `scout-brief.md:3` and `:27`, all added by `714a9a6`. The local `origin/main` ref contains
  `714a9a6`, so this was pushed before the scan. That was not checked over the network.
- **Why it matters:** each path shows an OS user name and a directory layout of the owner's other
  machine. Under P-3 this is the owner's own identity, so it is not a blocker. It does widen D-1,
  and these paths are not regenerated by any tool, unlike `context-map.json`.
- **Fix:** rewrite "Repo `<abs path>`" as "this repo" and the registry path as "the registry
  checkout". Or stop tracking the briefs: they are prompts, and the cards and results carry the
  record. The files are outside this task's `docs/security/` scope.

### G-2 (Low, operator): the security reports republish what E-2 and E-3 would remove

- **Where:** `docs/security/scan-2026-10-23-delta.md:73-74`, `:86`, `:128`, `:132-134`,
  `:323-324`, `:425`; `scan-2026-10-19-delta.md:54`, `:61`, `:108`, `:191`, `:259`;
  `scan-2026-10-18-film-pilot.md:43`, `:72`.
- **Why it matters:** these lines spell out the owner's two commit e-mail addresses, both OS user
  names and absolute paths. A `git filter-repo` mailmap rewrite for E-2 would leave the addresses
  readable in the tree through these reports. Outside `docs/security/`, no tracked file holds
  either address (`git grep -F`).
- **Fix:** in the same pass as any E-2/E-3 decision, replace them with placeholders such as
  "the owner's second address" or `<user>`, and keep the commit ids as evidence. This report
  already follows that rule.

### G-3 (Info): "Their price is down" measures from a number the counterparty chose

`askingDrop` compares the counterparty's own signed listing with their latest signed price. A
seller who lists high and then "comes down" makes the fact look like a win. The fact is accurate
and labelled as their move, not a saving (`story.ts:217-222`). It is shown only in the main
window, never at the approval gate, so it cannot by itself move money. *Action:* if scope item S4
(tiger record) puts these numbers in the approval window's Diff, show the market reference beside
them.

## Carried forward from 2026-10-23

None of the files named by E-1 to E-11 changed in the range (`git diff --quiet bf87d2b..HEAD`
over `crates/table-runtime/src/scheduler.rs`, `crates/table-mcp/src/lib.rs`,
`crates/table-paypal/src/client.rs`, `crates/table-app`, `apps/desktop/src-tauri`,
`apps/desktop/client/vite.config.ts`, `src/lib/mount.tsx`, `scripts/dev/tauri-dev-test.mjs`,
`deny.toml`, `context-map.json`, `.personas`, `.claude/lens-scan`, `.claude/contest`,
`docs/build/rebuild`). Line numbers are as in the 10-23 report.

| ID | Severity | Status at `ddb8bbc` |
|---|---|---|
| E-1 | Medium | **Open.** `scheduler.rs:28` still reads `app(self.pipeline.wallet.ledger.list_deals())?` ahead of the deadline loop. Not a blocker. |
| E-2 | Low (operator) | **Open, widened.** The 38 range commits all use the owner's first address, and the local `origin/main` ref says the whole range is pushed. G-2 adds the reports that restate the addresses. |
| E-3 | Low (operator) | **Open, widened by G-1.** The D-1 lines and `context-map.json:2836` are unchanged. The tracked files holding absolute user paths are now the four from D-1, `context-map.json` and the three G-1 briefs. |
| E-4 | Low | **Open.** `crates/table-mcp/src/lib.rs` unchanged. |
| E-5 | Low | **Open.** `crates/table-paypal/src/client.rs` unchanged. |
| E-6 | Low | **Open.** `vite.config.ts`, `mount.tsx`, `tauri-dev-test.mjs` and `tauri.conf.json` unchanged. |
| E-7 | Info | **Open.** No sandbox spike recorded in the range. |
| E-8 | Info | **Open.** `pipeline.rs` and `rescue.rs` unchanged. |
| E-9 | Info | **Open.** `src-tauri/src/main.rs` unchanged. |
| E-10 | Info | **Open.** `tauri.conf.json` unchanged. |
| E-11 | Info | **Open.** `deny.toml` unchanged. |

The 10-23 "Known, not re-reported" list stands as written:
- D-5, D-6 and D-7 are unchanged, and D-7's credential-custody backlog is still open.
- F-2 to F-5 are unchanged.
- The test-only `A21AAF...` constant at `crates/table-runtime/src/house_tests.rs:964` (added in
  `065ca59`, before the range) is a redaction-test dummy and is not a credential.

## Verification

- **Range:** `git rev-parse HEAD main origin/main` all give `ddb8bbc`, and `git log bf87d2b..main`
  lists 38 commits.
- **Binaries and identities:** `git log --numstat bf87d2b..main` has no binary (`-`) row. The
  identity check gives one author and committer for all 38 commits.
- **Code:** the eight code commits were read with `git show <sha>`. `standingFacts`, `askingDrop`
  and `actingRun` were traced to their callers, and `deal_transcript` and `agent_runs` to their
  `authority_table.rs` rows.
- **Grep results:**
  - Secret-shape grep: one false positive (`risk-assessor`).
  - E-mail grep on added lines: only the 10-23 report's own text, `maya@example.com`,
    `noreply@anthropic.com`, `noreply@github.com` and the `tauri.localhost@evil.com` test shape.
  - Path grep: the G-1 briefs and the 10-23 report's own text.
  - Tracked-tree `git grep -F`: the D-1 files, `context-map.json`, the G-1 briefs and the three
    `docs/security` reports (G-2), and nothing else.
- **Gates:** this commit adds one Markdown file under `docs/security/` and no code, so `cargo test`
  was not run for it. The merge gate runs `cargo test --workspace`. No client file changed, so tsc
  and vitest were not run.

## Questions for the operator

1. G-1/E-3: should the `challenge-*/*-brief.md` prompts stay tracked? If so, can they be rewritten
   with repo-relative wording (outside this task's `docs/security/` scope)?
2. G-2/E-2: if the commit-identity rewrite goes ahead before the Devpost repo turns public, should
   the same pass redact `docs/security/*.md`? That needs a run whose scope covers the old reports.
3. E-1 is still the one Medium. Build the `failure.get_or_insert` fix and its corrupt-row test next?

Open publication blockers: 0
