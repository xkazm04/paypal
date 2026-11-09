# Security scan - The Table - publication delta over the hackathon fusion - 2026-10-31 - 0 open blockers

A publication-blocker pass over `20ad784a..c98151a6` (`origin/main`, rewritten by D1): 121 commits
(115 plus 6 merges), 303 files, +89774/-966. Of the insertions, 65154 are 28 recorded data files
(`.tableproof` samples, parity and fuzz files, the arena and haggle recordings). **Open publication
blockers: 0.** One new Low finding (L-1) and two Info findings (L-2, L-3) are reported below. None of
them blocks publication. The 10-30 report's K-1 and K-2 are closed in the range.

The start is the commit the 10-30 scan stopped at: `20ad784a` ("re-run a busy write transaction
whole", the same subject on the rewritten main). It is the parent of `82420168`, which the 10-30
scan did not cover, and of the 10-30 report itself (`d4f987eb`). The range holds:
- the 10-30 follow-ups: the film-before-R11 record `82420168`, the 10-30 report `d4f987eb`, the
  K-2 fix `ded70fa1`, the K-1 fix `f3558e38` and the D1 citation re-point `056609da` (docs only);
- the hackathon fusion, five entries merged by `31bb2e8a` (e1, Break The Table), `42aa7720` (e4,
  watch the haggle), `a44724f9` (e2, the proof checker in the browser), `690c2483` (e3,
  `crates/table-sandbox`) and `49ce8442` (e5, say it, then see it);
- the fusion work packages after them: WP1 `58aa7a98` (one recorded truth), the live-mode stub
  `24d78874`, WP2 `c95e9d50` (arena live mode through the sandbox), WP3 `227562da` (Break The Table
  in the app) and WP4 `92a561f9` (say it in the film and the arena), merged as PR #6 `c98151a6`.

Worktree on branch `docs/scan-2026-10-31-delta`, cut from `c98151a6`.

Nothing was fixed: this run is report-only. No live PayPal call was made and no money was used.
Two network reads were made, both to public advisory databases: the RustSec fetch by `cargo deny`,
and the npm registry's audit endpoint by `pnpm audit`.

This report does not restate the owner's e-mail addresses, OS user names, first name, GitHub login,
GitHub display name or absolute paths (G-2).

The three questions are kept apart:
1. dependency advisories;
2. secrets and personal data in what the range added;
3. risky code patterns, weighted to what is new on the agent's path: `crates/table-sandbox`, the
   `call_budget` refusal code, `ApprovalDraft::Rules` and the arena and proof pages.

G-1, G-2 and E-1 are parked with the operator and are not re-filed. Their status is in
"Carried forward".

Severity and the definition of a blocker are those of `scan-2026-10-19-delta.md`, as the later
reports kept them: a publication blocker is something that must not be in a public repository or
its history (a live secret, a third party's personal data, or an asset without a redistribution
licence). The owner's own identity is Low and not blocking. A broken AGENTS.md money invariant
would also block publication. None was found.

## Summary

| ID | Severity | Category | File:line (or commit) | Blocks publication | Consequence | Recommended fix |
|---|---|---|---|---|---|---|
| L-1 | Low | vendor product names in user-facing strings | `crates/table-sandbox/src/page/app.js:84-85`, `crates/table-sandbox/src/main.rs:88-89` (`d282fbd9`) | no | The sandbox's live page and its terminal banner print a `claude mcp add ...` command and a `~/.codex/config.toml` block. AGENTS.md: "never put a vendor product name in user-facing strings". The same class as D-2 (10-19). The page is for a judge, not the merchant, and the commands only work if they name the tools. | Keep the generic MCP URL line as the lead and label the two commands by engine id (`claude-code`, `codex-cli`), or move them to the crate README. Or keep them on purpose and record the exception in AGENTS.md |
| L-2 | Info | dead loopback probe in the desktop bundle | `apps/desktop/client/src/windows/main/console/areas/try/TryLayer.tsx:5`, `:9`; `src/arena/BreakTheTable.tsx:32`, `:73`; `src/arena/live.ts:21-23`, `:71` (`227562da`, `c95e9d50`) | no | The console's "Try to break it" place mounts the arena, and the arena always runs `useLive()`. In the desktop app it fetches `http://127.0.0.1:1443/api/arena/hello` on mount and every 10 s. The desktop CSP (`connect-src ipc: http://ipc.localhost`, `tauri.conf.json:7`) blocks it, and the sandbox refuses any origin other than port 1430. So nothing is reached, but each attempt is a CSP violation. | Pass `host` to `useLive` and skip the probe when `host === 'console'`, or leave it and note why it is inert |
| L-3 | Info | a local door holds the wallet's grant | `crates/table-sandbox/src/front.rs:327-384`, `:691-694`; `:30-31`, `:798-822` (`d282fbd9`, `c95e9d50`) | no | `POST /mcp` needs no secret: the front adds the wallet's `x-wallet-secret` and session token itself. Any local process that sends a loopback `Host` and no `Origin` can drive the negotiator under the live grant. The arena bridge trusts any page served on port 1430. This is the design ("hand your own agent a wallet"), and its reach is small: five tools, none moves money, no owner is present, and PayPal is a recorder. | None needed. Optionally say in the crate README that any local process can use `/mcp` while the sandbox runs |

**Open publication blockers: 0.**

## (1) Dependency advisories

**Verdict: no advisory is open on either lockfile as committed. `Cargo.lock` gains no third-party
crate. `pnpm-lock.yaml`, every `package.json` and `deny.toml` are unchanged.**

`git diff 20ad784a c98151a6` touches `Cargo.lock` (+31), `crates/table-client/Cargo.toml`,
`crates/table-runtime/Cargo.toml` and the new `crates/table-sandbox/Cargo.toml`. Nothing else in
the dependency set moved.

- **New in `Cargo.lock`:** one `[[package]]`, `table-sandbox` itself, and two edges on
  `table-client` (`base64 0.22.1`, `ed25519-dalek`). Every crate `table-sandbox` names is a
  workspace crate or was already in the lock, including `tower 0.5`, which it takes as a direct
  dependency (`tower = { version = "0.5", features = ["util"] }`). STATUS justifies the new edges
  (`docs/build/STATUS.md:2825`, `:2874`), as AGENTS.md asks.
- **New features:** `table-runtime/sandbox` (gates `src/sandbox.rs`) and `table-client/samples`
  (gates `sample_proof` and the three recorder bins, `required-features = ["samples"]`). Both are
  off by default, and no shipped crate turns them on. See (3) for what feature unification means.
- **Rust (`cargo deny 0.20.2`, `deny.toml` as committed).**
  - `cargo deny check advisories` fetched the RustSec database (head `2295466`, 2026-10-30 11:12
    UTC) and printed `advisories ok`.
  - `cargo deny --offline check bans licenses sources` printed `bans ok, licenses ok, sources ok`.
    The duplicate-version tree it prints above that line is the usual Tauri and zbus warning set.
  - The four `deny.toml` ignores (RUSTSEC-2024-0370 and 2026-0370/71/72) are the ones already
    reviewed.
  - `cargo audit` is not installed on this machine, so `cargo deny` is the advisory check.
- **Client (`pnpm audit`, pnpm 11.3.0).** It ran on copies of the committed
  `apps/desktop/client/package.json` and `pnpm-lock.yaml` (`git show c98151a6:...`), placed in a
  temp directory outside the worktree. No `node_modules` was created or touched, and nothing was
  installed. It printed `No known vulnerabilities found`.

## (2) Secrets and personal data the range added

**Verdict: no secret, token, PayPal credential, private key or third-party personal data. The 194
gitleaks hits are signed protocol envelopes, not secrets. No new owner identity in the tree.**

- **gitleaks 8.30.1:** `gitleaks git --log-opts="20ad784a..c98151a6" --redact` scanned 115
  commits (about 3.06 MB) and reported `leaks found: 194`. A second pass over the six merges
  (`--first-parent ... -m`, the merges' own diffs) reported 171. Every hit is rule `jwt`, and every
  one is in `apps/desktop/client/src/lib/proof/sample/` or `.../proof/real/`.
  - **What they are:** each is the `raw` field of a signed transcript envelope. All 171 distinct
    strings decode to a header `{"alg":"EdDSA","kid":<public key hex>}`, a payload with the
    protocol keys `aud, body, deal_id, exp, iat, iss, nonce, prev, seq, typ, v`, and a 64-byte
    Ed25519 signature. A signature and a public payload are what a proof file is for; neither
    grants anything.
  - **No private key material.** A walk of every JSON field in the 28 added `.tableproof` and
    `.json` files, including the decoded envelopes, finds no field named secret, private, seed,
    signing, password, token or mnemonic. The key fields are `owner_key`, `agent_key`,
    `owner_key_id` and `house.release.*_key`, all public keys. The only `seed` fields are the
    arena's generator seed and the gauntlet's first seed, both public constants.
  - **Practice keys from public labels.** The three practice deals (`golden`, `buyer`, `busy`)
    and `parity.json` are signed by keys whose seed is `SHA-256("the-table/sample-proof/<name>")`
    (`crates/table-client/src/sample_proof.rs:71-76`). Checked: the public key derived from the
    label `owner` equals `golden.tableproof`'s `owner_key`, and the one from `agent` equals its
    mandate's `agent_key`. Anyone can re-derive these private keys, which is the point: they are
    practice keys and sign nothing real.
  - **The arena files** (`sample/arena-*.tableproof`) are signed by keys drawn from a seeded
    generator with a public constant (`crates/table-app/tests/gauntlet/arena.rs:24`, `:231-235`).
    Re-derivable in the same way.
  - **`d-0205.tableproof` and `real/*.tableproof`** were exported by the runtime's own tests
    (`haggle_record_tests.rs`, and the `TABLE_EVIDENCE_DIR` export in `relay_tests.rs:1050-1057`).
    Their signers lived in the test's `MemoryVault`; only public keys and signatures are in the
    files.
  - **PayPal identifiers in them are not live.** All 22 files say `"mode": "sandbox"`. The
    `real/` files carry `ORDER1`, `AUTH1` and `CAPTURE1` (the offline test transport's
    answers, `crates/table-app/tests/pipeline.rs:29-31`). The practice files carry three fixed
    17-character ids written into `sample_proof.rs:422-424`. The only URL is
    `https://www.sandbox.paypal.com/checkoutnow?token=` with those ids.
- **Grep on the added lines.** `git log -p --no-merges 20ad784a..c98151a6` with messages (134642
  lines), and `git diff 20ad784a c98151a6` without the 28 data files (24895 added lines). The
  patterns were those of 10-30: key and token shapes, quoted credentials, e-mail, URL, IPv4, phone
  and IBAN shapes, and absolute paths or the owner's names.
  - No AWS, GitHub, Slack, OpenAI-style, PayPal access-token, `Bearer`, `client_secret` or
    private-key shape. The known positive (`secret`) matches 22 added lines: the sandbox's
    `x-wallet-secret` header name, the `Live.secret` field (which is never printed, logged or
    served, `engine.rs:23-24`) and test values such as `secret: "secret".into()`.
  - The nine IBAN-shaped hits are test ULIDs (`01JD00000000000000000000A1`,
    `01JTABLE0000000000000000D1`).
  - Every URL and IPv4 is loopback (`127.0.0.1:1430`, `:1443`, `:8765`, `:9`, `localhost:1430`,
    `:1431`), `https://example.test`, the SVG namespace or the PayPal sandbox checkout link above.
  - E-mail addresses in added file lines: `maya@example.com` and `dan@example.com` (demo personas).
    The owner's addresses appear only in commit metadata and in the 10-19 and 10-23 reports'
    existing lines (below).
  - No absolute path, drive letter, `/Users/`, `/home/`, `AppData` or OS user name appears in a
    newly written line. The three `home/model` hits are relative imports.
- **Rewritten lines are not new data.** `056609da` re-pointed commit citations after D1 in 41
  files. Its hunks re-write lines that already held the owner's addresses (the 10-19 and 10-23
  reports, G-2) and local paths (`.claude/scan-sweep/challenge-2026-10-15/*-brief.md`, G-1), so
  they show as added lines. Only the hashes changed. `git grep` for the owner's addresses, user
  name and display name gives 30 lines at `20ad784a` and 30 at `c98151a6`, 14 of them in
  `docs/security/` both times. G-1 and G-2 are not widened.
- **Names.** A sweep of capitalized words in the added Markdown finds no personal name except the
  demo personas ("Maya", "Dan"). The sequencing doc now says "the owner" (K-2, below).
- **Identities.** All 115 non-merge commits and five merges have one author and committer, the
  owner's first address (E-2 class). The PR merge `c98151a6` has the owner's GitHub display name as
  author and `GitHub <noreply@github.com>` as committer, like `5561e96` in E-2.
- **Binaries.** `git log --numstat` shows no binary row in the range.

## (3) Risky code patterns

**Verdict: no money invariant is broken. No PayPal call site, ledger, migration, IPC command,
authority row or capability file changed. The new crate is a headless harness whose PayPal is a
recorder and whose owner is absent. One Low (L-1) and two Info (L-2, L-3) findings.**

### What changed where

- **No diff in the range** (`git diff --stat 20ad784a c98151a6`) for: `crates/table-paypal`,
  `crates/table-ledger` (including its migrations), `crates/table-proto`, `apps/desktop/src-tauri`
  (capabilities, `build.rs`, `tauri.conf.json`), `crates/table-client/src/authority_table.rs` and
  `authority.rs` (`PINNED_MANIFEST`), every `package.json`, `deny.toml`, the root `Cargo.toml`,
  `scheduler.rs` and `mount.tsx`.
- **Production Rust that changed:** `table-core/src/agent.rs` (+`CallBudget`), `table-mcp/src/lib.rs`
  (the budget refusal), `table-runtime` (`configuration.rs`: the `Rules` draft check;
  `safety.rs`: its family; `sandbox.rs`: new, feature-gated), `table-client/src/approval.rs`
  (`ApprovalDraft::Rules`), `table-app/src/agent.rs` (`Wallet::note`), `table-engine`
  (`EngineId::Outside`), `services/house-seller/src/hosted.rs` (table length, `send_note`) and the
  new `crates/table-sandbox`. The rest is tests, recorders and generated bindings.

### `crates/table-sandbox` (`d282fbd9` .. `c9046361`, `c95e9d50`)

`cargo run -p table-sandbox` boots the real wallet actor with an in-memory ledger and vault, an
in-process house seller and the wallet's own loopback MCP server, then serves a front door on
`127.0.0.1:<port>` (default 1443, `main.rs:67`; also `[::1]` when free, `:115-120`).

- **PayPal is never reached.** Both wallets' `table_paypal::Client::sandbox` get the `Recording`
  transport (`paypal.rs:24-30`), which counts the request and returns `TransportError`. The
  credentials are a random pair minted per boot into a `MemoryVault` (`lib.rs:97-102`), never
  valid at PayPal and never written to a file, log or response.
- **No owner is present.** `NoOwnerPresent` (`lib.rs:180-193`) fails every re-authentication, so
  nothing that needs the owner in person can happen after boot. The owner's rule is signed by Rust
  at boot (`table-runtime/src/sandbox.rs:34-66`) through the same `house_pair`, `pairing_confirm`,
  `sign_mandate` and `join_deal` the dispatcher calls. Its in-person line ($200) sits under the
  house's floor ($239), so no agreement can complete without the owner, and no payment can start.
- **The front holds no authority of its own.** `/mcp` forwards each JSON-RPC body unchanged to the
  wallet's MCP server with the live run's grant (`front.rs:351-384`). The wallet's server still
  checks its Host, its secret, the session, the role's catalog and the call budget; the wallet
  still checks the run and the signed mandate. The only change to an answer is the negotiator
  playbook as `instructions` on `initialize` (`:677-686`).
- **The grant is not exposed.** `Live` has a redacting `Debug` (`engine.rs:30-37`). The journal,
  the terminal lines and `/api/state` carry no secret or token (no `secret` or `token` in
  `journal.rs`; `snapshot`, `front.rs:627-673`, lists none).
- **Browsers are kept out of `/mcp`.** It refuses any request whose `Host` is not this port's
  loopback name (DNS rebinding) and any request with an `Origin` header (`:691-694`), which every
  browser sends on a cross-site POST. The smoke test
  `the_front_door_refuses_browsers_and_foreign_hosts` pins it. A local non-browser process can
  still use it (L-3).
- **CORS for `localhost:1430`.** Only `/api/arena/hello`, `/api/arena/note` and `/api/journal`
  answer cross-origin, and only to `http://localhost:1430` and `http://127.0.0.1:1430`
  (`ARENA_ORIGINS`, `:31`), never `null`. A non-preflight request must carry `x-sandbox: arena`
  (`:33`, `:816-820`), which forces a preflight from any other page. The preflight allows only GET
  and POST and only the headers `content-type` and `x-sandbox` (`:837-879`). The private-network
  header is granted only to an allowed origin. `the_arena_bridge_refuses_foreign_origins_null_and_a_missing_header`
  pins foreign origins, `null` and `localhost:1431`. `/api/state` and `/api/proof` send no
  `Access-Control-Allow-Origin`, so another origin cannot read them. `/api/fresh` needs
  `x-sandbox: fresh` and has no `OPTIONS` route, so no cross-site page can trigger it.
- **The arena's note.** `POST /api/arena/note` reads at most 2 KiB (`:934`), takes
  `{"text": string}` with `deny_unknown_fields`, and hands the text to the in-process house, which
  signs it as a NOTE (`hosted.rs`, `send_note`; `ShortText<280>`). The buyer's wallet keeps a NOTE
  quarantined for its owner, and no agent projection carries it
  (`a_seller_note_from_the_arena_reaches_the_owner_and_never_the_agent`). The hosted HOUSE gains no
  HTTP route for notes: `Message::Note` is reachable only through `HouseHandle::note` in process
  (`hosted.rs:1078-1081`; routes at `:1173-1181` unchanged).
- **The page and its CSP.** `/` is served with `default-src 'self'; script-src 'self'; style-src
  'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'` (`front.rs:732-734`).
  `index.html` has no inline script or style. `app.js` writes text with `textContent` (32 uses) and
  has no `innerHTML`, `eval`, `insertAdjacentHTML` or `document.write`; its only fetches are
  same-origin (`/api/state`, `/api/journal`, `/api/fresh`). Agent text printed to the terminal goes
  through `printable` (`:129-145`), which drops control and bidi characters; a unit test pins it.
- **What it writes to disk.** At exit, the session's proof file goes to the OS temp directory
  (`main.rs:156`), outside the repository. A proof file holds no secret.
- **`EngineId::Outside`** (`99cf85b7`). `argv`, `resolve_command` and `NativeEngine::new` refuse
  it, as they refuse `Scripted`. The desktop never registers an adapter for it, and `engine_select`
  accepts only an id that `engine_info` lists as available (`dispatcher.rs:594-601`). So no window
  can select it.
- **The `sandbox` feature.** `table-runtime/src/sandbox.rs` is compiled only with the feature, and
  only `table-sandbox` enables it. A `cargo build --workspace` or CI's `cargo test --workspace`
  unifies the feature into the `table-runtime` the desktop shell links. Nothing outside
  `crates/table-sandbox` calls the four `sandbox_*` methods (`grep` over every `.rs`), no IPC
  command maps to them, and a release build of the shell alone does not enable it. Not a finding.
- **Vendor names.** The page's command block and the terminal banner name the two vendor CLIs
  (L-1).
- `cargo test -p table-sandbox -p table-core -p table-mcp`: 115 passed, 0 failed, including the six
  sandbox smoke tests.

### The recorded samples and `scripts/record.mjs` (`8f488d0a`, `922a7712`, `1ef2a78e`, `58aa7a98`)

- The key material is covered in (2): practice keys from public labels, arena keys from a public
  seed, runtime-test keys never written. No file holds a private key.
- **The recorders do not touch the network.** The arena recorder plays through the real MCP server
  on loopback. The haggle recorder plays the shipped practice agent against the house's rule and a
  given counter list, through the wallet's loopback MCP door, and asserts that its offline PayPal
  transport saw no path (`haggle_record_tests.rs:239`, `:311`). No native engine is launched.
- **`scripts/record.mjs`** (45 lines) runs one or more of three fixed `cargo test` commands with
  `TABLE_RECORD=<name>`, through `spawnSync('cargo', [...])` with an argument array and no shell.
  An unknown step name exits 2 before anything runs. It reads only `mock/haggle.json`, to decide
  whether to re-run the arena and proofs steps. Nothing is downloaded or sent.

### The `call_budget` refusal code (`58aa7a98`)

The MCP server's per-session call budget (`CALL_BUDGET = 64`, `table-mcp/src/lib.rs:117`) used to
refuse with `Unavailable` and a custom sentence. It now refuses with the closed code `CallBudget`
(`"call_budget"`, `table-core/src/agent.rs:405`, `:459`) and the code's own fixed sentence (`:503`).

- The first over-budget call is still audited (`record_refusal`, `lib.rs:526-531`) before the
  agent hears about it, and no call over the budget reaches the wallet. The safety record counts
  it as out of turn (`safety.rs:131`).
- `RefusalCode::ALL` gains it (19 to 20), so the docs and code-list tests cover it. The three
  playbooks tell the agent to stop on it (`bindings/playbooks.ts`).
- Audit rows written before the change keep `unavailable`. Nothing rewrites them.

### `ApprovalDraft::Rules` never signs (`2e90eaa6`, `f1178609`)

"Say it" turns one sentence into a rule set with a fixed grammar in the client (`lib/say/`, no
model, no network call; `grep` finds no `fetch`, `invoke` or socket outside tests).

- **Main can only open the window.** `SayIt.tsx:47` uses `approval_open`, which is not
  privileged and opens the approval window with a draft.
- **Rust checks shape only.** `check_draft` (`table-runtime/src/configuration.rs:142-166`) requires
  a mandate target and no deal, 1 to 9 clauses with no clause number repeated, a start not below 0,
  an end after the start when one is carried, and a focus of 1 to 9. It returns `Ok(())` and
  writes nothing. The serde shape is closed: an extra field such as `"sign": true` is refused
  (`a_rules_draft_reads_as_the_client_sends_it`). The mock repeats the same checks.
- **Signing is still the owner's.** The approval window's editor starts a new draft from it
  (`draftFromRules`, `mandateDraft.ts:144-158`). A missing end stays empty, so nothing is signable
  until the owner sets one. The seed is spent once the editor closes or signs
  (`OwnerConfig.tsx:82-83`, `:157-162`). Signing is the unchanged `mandate_sign`: privileged,
  idle-locked, through `session.unlock`.
- **Speech input.** The sentence can be spoken. `lib/say/speech.ts` uses the browser's own
  recognizer behind a feature check, and the panel says "Speech uses your browser's own speech
  service." Where that service sends audio is the browser's business. This is the owner's own
  input, so it is not a finding.

### `arena.html` and `proof.html` are not in the desktop dist (`3c028137`, `706441be`, `c95e9d50`)

- `vite.config.ts:12`, `:42`: `arena.html` and `proof.html` (and `director.html`) are rollup inputs
  only when `THE_TABLE_DIRECTOR_BUILD === '1'`, which only `pnpm build:director` sets
  (`package.json:10`). `pnpm build` builds `main`, `tumbler` and `approval`, and Tauri ships
  `../client/dist` (`tauri.conf.json:6`).
- This was read from the config, not shown by a build: the worktree has no client `node_modules`.
- **But the arena component is in the desktop bundle.** WP3 hosts `BreakTheTable` as the console's
  "Try to break it" place (`TryLayer.tsx`). It plays the recorded answers and calls no command that
  moves money (`console/guard.test.ts` reads it). Its live probe is inert there (L-2).

### Smaller client and Rust changes

- **`Wallet::note`** (`table-app/src/agent.rs:501-515`) signs a NOTE and commits it to the
  negotiation log. Its only caller is the house's `send_note`. No MCP tool or IPC command reaches
  it.
- **The house's table length** (`hosted.rs`) is now `with_table_secs`, clamped to 60-3600 s and
  still capped by the signed band's deadline. The hosted default stays 300 s.
- **The Tumbler's all-clear ticker** (`windows/tumbler/logic.ts`) is built from the forecast and
  fixed words. No counterparty text enters it.
- **The client passes** (arena, proof checker, corridor, rewind, say it) add no
  `dangerouslySetInnerHTML`, `eval` or new IPC command. The arena's only network call is the
  loopback probe of L-2.

### AGENTS.md money invariants the range touches

| Invariant | Touched by | Status |
|---|---|---|
| The LLM never moves money | `table-mcp` (budget code only), `EngineId::Outside`, `table-sandbox` | holds: no tool added; the sandbox's agent gets the same five negotiator tools; its PayPal is a recorder |
| Mandate check before any network call; refusals leave zero `paypal_calls` rows | none (`table-app` pipeline, `table-core` mandate, `table-paypal` unchanged) | holds; the budget refusal is answered before the wallet is called |
| `audit_log` append-only and hash-chained | none (`table-ledger` unchanged) | holds |
| Silence never moves money | the house's table length (`hosted.rs`) | holds: a lapsed table closes with no money moved; the band's deadline still caps it |
| Secrets in the keychain only | `table-sandbox` (`MemoryVault`, throwaway credentials) | holds: no secret in a file, log, response or fixture; the proof samples hold no private key |
| Counterparty text untrusted, never in the Tumbler | the arena note (`/api/arena/note`), the Tumbler ticker | holds: the note is a quarantined NOTE; the ticker uses fixed words |
| Engines named `claude-code` / `codex-cli` on screen | the sandbox page and banner | **broken in the sandbox's own UI (L-1, Low)**; the desktop names `outside` as "an agent app outside the wallet" (`OwnerConfig.tsx:38`) |

## Findings

### L-1 (Low): the sandbox's page and banner name the vendor CLIs

- **Where:** `crates/table-sandbox/src/page/app.js:84` (`"claude mcp add --transport http
  table-wallet " + url`), `:85` (`"# ~/.codex/config.toml\n[mcp_servers.table-wallet]..."`),
  shown at `page/index.html:74-75` under "Or paste the add command your agent app takes". The same
  two lines are in the terminal banner, `src/main.rs:88-89` (`d282fbd9`).
- **Consequence:** AGENTS.md says engines are `claude-code` and `codex-cli` and that no vendor
  product name goes in a user-facing string. Here a CLI's own command and config path are the
  string. The reader is a judge connecting their own agent app, not the merchant, and a copyable
  command has to name the tool. No safety effect. It is the same rule D-2 (10-19) enforced on a
  runtime message.
- **Fix:** lead with the URL line, which names no vendor (`cmd-url`, `index.html:72`), and move the
  two tool-specific commands to `crates/table-sandbox/README.md`. Or keep them on purpose and say
  in AGENTS.md that the sandbox's connect instructions are an exception.

### L-2 (Info): the desktop's "Try to break it" place probes a loopback port it can never reach

- **Where:** `TryLayer.tsx:9` renders `<BreakTheTable host="console" .../>`; `BreakTheTable.tsx:73`
  calls `useLive()` with no condition; `live.ts:21-23`, `:71` fetch
  `http://127.0.0.1:1443/api/arena/hello` with a 1 s timeout on mount and every 10 s (`227562da`,
  `c95e9d50`).
- **Consequence:** in the desktop app the CSP's `connect-src ipc: http://ipc.localhost`
  (`tauri.conf.json:7`) blocks the fetch, and the sandbox would refuse the Tauri origin anyway
  (only port 1430 passes `arena_gate`). So live mode never works in the app, and the page logs a
  CSP violation every 10 s while the place is open. Under `tauri dev` the page's origin is
  `http://localhost:1430`, which the sandbox allows. Whether the dev CSP then still blocks it was
  not checked. Either way the bridge only reads the journal and sends house notes.
- **Fix:** skip the probe when `host === 'console'` (or take the live state as a prop), or say in
  `live.ts` that it is inert in the app.

### L-3 (Info): any local process can drive the sandbox's negotiator

- **Where:** `crates/table-sandbox/src/front.rs:691-694` (the `/mcp` gate: loopback `Host`, no
  `Origin`), `:351-363` (the front adds `x-wallet-secret` and `x-wallet-session`), `:30-31` and
  `:798-822` (the arena bridge trusts any page on port 1430) (`d282fbd9`, `c95e9d50`).
- **Consequence:** while the sandbox runs, any local process (not a browser) can call the five
  negotiator tools under the live grant without knowing the wallet's secret. Any page a developer
  serves on port 1430 can read the journal and make the house send notes. That is the purpose of
  the harness: an outside agent app connects with no secret. The reach is a practice table: no
  money tool, no owner present, PayPal recorded, an in-memory ledger thrown away at exit.
- **Fix:** none needed. Optionally say in `crates/table-sandbox/README.md` that `/mcp` is open to
  every local process while it runs.

## Carried forward (not re-filed)

These were checked with `git diff --stat 20ad784a c98151a6`. Unchanged in the range:
`scheduler.rs`, `table-paypal`, `table-ledger`, `src-tauri`, `mount.tsx`, `scripts/dev/`,
`deny.toml`, `context-map.json`, `.personas`, the shield module and words, `lib/words/deal.ts`
and `review/Checks.tsx`. `table-mcp/src/lib.rs` and `vite.config.ts` changed (see E-4 and E-6
below). `.claude/` and `docs/build/rebuild/` changed only by `056609da`'s hash re-point.
`docs/security/` changed by the 10-30 report and the same re-point.

| ID | Status at `c98151a6` |
|---|---|
| K-1 (Low) | **Closed** by `f3558e38`. `acceptedAtFloorLine` compares `d.terms.unit_price` with the floor and keeps the "own verified ACCEPT" test without `s.price`. STATUS records it and notes that `mock/fixtures.ts:315` still prices an ACCEPT. |
| K-2 (Low, operator) | **Closed** by `ded70fa1` at the tip, and in history by D1. The rewritten `16f02117` reads "For the owner to decide." on line 3, which K-2 listed. The tip doc says "the owner" on 23 lines. |
| K-3 (Info) | No change; `table-ledger` unchanged. |
| G-1 (Low, operator) | Parked; `.claude/scan-sweep/challenge-2026-10-15/*-brief.md` changed only by `056609da`'s hash re-point. Same paths, no new ones. |
| G-2 (Low, operator) | Parked. `docs/security/` holds the same 14 identity lines as at `20ad784a`; `056609da` changed hashes on some of them. This report adds none. |
| G-3 (Info) | Open; the `story.ts` buyer block is unchanged (`:194-201`). |
| E-1 (Medium, operator) | Parked; `scheduler.rs` unchanged. |
| E-2 (Low, operator) | Open; the 120 non-PR range commits use the owner's first address, and the PR merge `c98151a6` uses the owner's GitHub display name, as `5561e96` did. |
| E-3 (Low, operator) | Open; files unchanged except the re-pointed hashes. |
| E-4 (Low) | Open; `table-mcp/src/lib.rs` changed only at the budget refusal (`:520-531`). The `let _` on the `Withheld` outcome write is unchanged (`:596-599`). |
| E-5 (Low) | Open; `table-paypal` unchanged. |
| E-6 (Low) | Open; `vite.config.ts` changed only the director-build inputs (`:12`, `:42`). `sourceLocPlugin`, `outDir: 'dist'`, `mount.tsx` and `tauri-dev-test.mjs` unchanged. |
| E-7 to E-11 | Open; files unchanged. |
| H-1 (Low) | Open; `shield/matrix.ts`, `lib/words/shield.ts` and `lib/words/deal.ts` unchanged. |
| H-2 (Info) | No change; `Cargo.lock` moved only by the new workspace crate and two workspace edges, which the commit and STATUS state. |
| H-3 (Info) | Open; `review/Checks.tsx` unchanged. |

## Verification

- **Range:** `git rev-parse HEAD` gives `c98151a6`. `git merge-base --is-ancestor d4f987eb
  c98151a6` holds, and `20ad784a` is the parent of `82420168`, with the subject the 10-30 report
  ends on. `git rev-list --count 20ad784a..c98151a6` gives 121; `--no-merges` gives 115.
- **Commits read:** every commit's subject and stat. The full diff of the Rust, `scripts/`, config
  and the money-adjacent client files was read: `crates/table-sandbox` whole (`front.rs`, `lib.rs`,
  `main.rs`, `engine.rs`, `paypal.rs`, `relay.rs`, `page/`), `table-runtime/src/sandbox.rs` and
  `configuration.rs`, `table-core/src/agent.rs`, `table-mcp/src/lib.rs`, `table-client/src/approval.rs`
  and `lib.rs`, `table-app/src/agent.rs`, `table-engine`, `hosted.rs`, the approval editor files,
  `SayIt.tsx`, `lib/say/speech.ts`, `arena/live.ts`, `TryLayer.tsx`, the Tumbler diff,
  `vite.config.ts`, `arena.html`, `proof.html` and `scripts/record.mjs`. The 28 data files were
  parsed by script, not read. The client UI diffs (arena, proof checker, corridor, rewind) were
  grepped for sinks, calls and vendor names, not read line by line.
- **Tools:**
  - `cargo deny check advisories`: `advisories ok` (RustSec head `2295466`).
  - `cargo deny --offline check bans licenses sources`: ok.
  - `pnpm audit` on copies of the committed `package.json` and `pnpm-lock.yaml`: no known
    vulnerabilities.
  - `gitleaks git` over `20ad784a..c98151a6`: 115 commits, 194 hits; over the six merges'
    first-parent diffs, 171 hits. All rule `jwt`, all signed envelopes in proof files.
  - `cargo audit`: not run, because it is not installed. `cargo deny` covers the same RustSec
    database.
  - `cargo test -p table-sandbox -p table-core -p table-mcp`: 115 passed.
- **Gates:** this change adds one Markdown file under `docs/security/` and edits two docs. The
  full `cargo test --workspace` was not run for it; the merge gate runs it. No client file changed,
  so tsc and vitest were not run.

## Questions for the operator

1. L-1: keep the vendor CLI commands on the sandbox page and banner as a recorded exception, or
   move them to the crate README?
2. L-2: stop the arena's live probe in the desktop's "Try to break it" place (client only,
   `live.ts` or `BreakTheTable.tsx`)?

Open publication blockers: 0
