---
product: "paypal - agent money desktop (Tauri + React client)"
stack: "Rust workspace (crates/, services/), Tauri desktop shell, React + Vite client in apps/desktop/client"
vault: []
vault_subdir: Spark
context_map: context-map.json
base_branch: main
active_runs_ledger: ""
locale_count: 1
---

# Spark overlay - paypal

Scaffolded 2026-10-18 from what this repo declares. The vault is `<repo>/.spark/` (gitignored). `.ai/manifest.yaml` declares no `capabilities`, so gates come from the client's package scripts.

## Gates

always:
- `pnpm --dir apps/desktop/client typecheck`
- `pnpm --dir apps/desktop/client test`

when the director / demo stage changes:
- `pnpm --dir apps/desktop/client build`
- `pnpm --dir apps/desktop/client takes` (rehearsal + stills)

when Rust crates change:
- `cargo test --workspace`

builder:
- `pnpm --dir apps/desktop/client typecheck`

## Rituals

None declared.

## Repo law

- Read `CLAUDE.md` / `AGENTS.md` and `context-map.json` first; reuse before building.
- The director (`apps/desktop/client/director.html`, `src/director/`) runs the real windows on a mock backend with sample data and a permanent "Preview, sample data" banner. It is watch-only: no action may move money.
- Never stage with `git add -A`, never stash; stage per file and verify the staged set.
- **A client test that renders mock-world time pins the clock** (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(...)`, real timers back in `afterEach`). The mock world is relative to real now, so an unpinned test goes red by weekday and hour. Before shipping new client tests, run the suite once under a faked Friday 19:30 and Sunday 00:30. Promoted 2026-10-31 on the second sighting (book.test.tsx 2026-10-18; e5's sayit/rewind tests in hackathon killer-1030).

- **Parallel builders share one worktree when the Director commits the contract first**: wire types, moved shared types and compilable stubs with final signatures, then disjoint file scopes staged per file. It worked three times (killer-1030 2026-10-31, conversational-home 2026-11-01, the-proof-table 2026-11-03). Promoted 2026-11-03.
- **Before changing a default route or home view, list every test that renders the root** (`<App/>`, scaleSmoke, routeRestore, film tests) and every deep link the director frames. In the-proof-table 105 console tests and the director films assumed the console opened first.

## Question taste

- Prototype-over-pick: when options are aesthetic balances, the operator prefers building all variants and choosing by watching (2026-10-18, demo-film). Offer "prototype all" as an option.
- Secrets: before asking about an API key, scan sibling repos for env var NAMES (never values) and offer "reuse the key from <repo>" as an option.

## Skill improvement log

- 2026-10-18 demo-film-hybrid (corrected by demo-film-hero): `pnpm --dir apps/desktop/client test` has a wall-clock-dependent failure in book.test.tsx "the footer shows money paid today" - red at 00:06 and all of Sunday 2026-10-18 (mock world relative to real now). It imports no director code; compare against main before blaming a change.
- 2026-10-18 demo-film-hybrid: a worktree cut from origin/<base> while local <base> has diverged lands with `git rebase --onto <base> origin/<base>`, never plain `git rebase <base>`.
- 2026-10-18 demo-film-hybrid: Windows long paths (node_modules under film/) block `git worktree remove`; delete with `cmd /c rmdir /s /q "\\?\<abs path>"` then `git worktree prune`.
- 2026-10-18 demo-film-hero: a builder left `vite --port 1532` running from its worktree, which blocked the worktree's removal; before removing a worktree, check its ports (1531-1534) and stop the owning node process.
- 2026-10-18 demo-film-hero: a film record's "shown on screen" check must match how each page draws the figure (amount vs count, label-first vs number-first) and wait for the page's loaded state; the Rewind and the safety record each needed both.
- 2026-10-18 demo-film-hero review: Playwright recordVideo drifts 1-3 s behind the wall clock per 3-min take (varies run to run), so wall-clock beat windows show the previous page at cuts; film-capture now times beats by an in-frame sync mark. Before trusting any film render, scan it: ffmpeg signalstats YAVG for bright flashes and select=gt(scene,0.04) for in-beat changes.
- 2026-10-18 demo-film-hybrid: the contract must name the reference frame of every time field (beat-relative vs take-relative); the click atMs mismatch was the one contract gap.
- 2026-10-31 hackathon-fusion-killer-1030: the second sighting of wall-clock-bound client tests (after book.test.tsx 2026-10-18) is PROMOTED to Repo law. Also: a parallel WP2/WP3 fan-out in ONE worktree worked because the Director committed the live.ts stub (final signature) first and staged each package by its own file list; the takes harness needs --check plus PLAYWRIGHT/PW_CHROMIUM env vars (ascent's playwright, ms-playwright chromium-1248).
- 2026-10-31 module-pages-redesign: layout work needs a headless-screenshot step in the builder brief (Chrome at C:\Program Files\Google\Chrome\Application\chrome.exe --headless=new --screenshot against the running dev server at 1430); unit tests missed cramped split lists, 2-line Latest strips and clipped chips. Scout layout briefs must list every row component on the page, not only ListEngine call sites.
- 2026-10-31 conversational-home: the repo's .claude/contest/config.md is scoped to the backend contest (codex seat, vault_subdir Backend): a UI contest must pass --participants and --vault-subdir explicitly on init. Headless Chrome cannot render below ~500 px width, so 390 px phone checks need a real narrow window or device emulation.
- 2026-11-01 conversational-home: a consumer package that imports a dev-only module (a dev-server bridge client) leaks its path into the production bundle unless folded by import.meta.env.DEV; the brief for any package importing dev-only code must say so and the Director greps dist for the dev path at the first build. Parallel builders in one worktree worked again with contract+stubs committed first and disjoint scopes.
- 2026-11-03 the-proof-table: a contract that names files must keep a component and a pure module distinct beyond case (standing.ts vs Standing.tsx hit TS1149 on Windows). `takes --check` fails beat 24 end-proof ("decided by the deadline") on main aaa8b995 as well: pre-existing, not a regression. Takes env: PLAYWRIGHT=../ascent/node_modules/playwright/index.mjs, PW_CHROMIUM=ms-playwright chromium-1248.
- 2026-11-07 chat-configure: a feature that adds mutations under windows/main/home must widen the allowlist in console/guard.test.ts on purpose (it pins the home's useMutation set); and before reusing a home class name (fs-chips) grep Home.test.tsx for assertions on it. Shell heredocs containing apostrophes break the Bash tool here: write files with the Write tool.
- 2026-11-08 live-e2e: the sandbox key is scripts/sandbox/.env.sandbox (root .env is an empty template); live UI e2e = CDP into the shell, see apps/desktop/client/e2e/live/README.md. Files here are CRLF: multi-line Python replace silently misses, use Edit.
