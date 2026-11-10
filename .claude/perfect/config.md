---
product: "Signet - a desktop wallet your agent cannot misuse (PayPal sandbox, Tauri + React client)"
stack: "Rust workspace (crates/, services/), Tauri 2 desktop shell with three windows, React 19 + Vite client in apps/desktop/client, browser mock + director rig for the demo film"
vault: []
vault_subdir: Perfect
base_branch: main
wave_size: 3
lot_caps: {rust: 1}
pool_target: 10
round_shape: round
cooldown_rounds: 2
commit_format: "feat(<context>): <title>"
context_map: context-map.json
active_runs_ledger: ""
locale_count: 1
---

# Perfect overlay - paypal (Signet)

Scaffolded 2026-11-10 at init from what this repo declares (the spark overlay beside this file, the client's package scripts, the context map, the registry map). The vault is `<repo>/.perfect/Perfect/`, ignored through `.git/info/exclude` because `.gitignore` carried another session's uncommitted edit at init. `round_shape: round` and `lot_caps.rust: 1` are the Director's choice at init, not a repo declaration: the submission closes 2026-11-12 14:00 PT, and one shared cargo target serialises Rust lots (spark log 2026-11-09).

## Gates

always:
- `pnpm --dir apps/desktop/client typecheck`
- `pnpm --dir apps/desktop/client test` (run it alone: beside a cargo build it shows false timeouts)

when Rust crates change:
- `cargo test --workspace`

when the director / demo stage or any text the rehearsal expects changes:
- `pnpm --dir apps/desktop/client build:director`, `vite preview --port <n>`, then `pnpm --dir apps/desktop/client takes --check --url http://localhost:<n>/` (env: PLAYWRIGHT=../ascent/node_modules/playwright/index.mjs, PW_CHROMIUM=ms-playwright chromium-1248). A fresh dev server times out the rig.

builder:
- `pnpm --dir apps/desktop/client typecheck`
- the test files of its own write set: `pnpm --dir apps/desktop/client exec vitest run <paths>`

visual:
- headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe --headless=new --screenshot`) against the dev server on 1430, both themes (`?theme=dark` and light). Headless Chrome cannot render below about 500 px wide, so the Tumbler's small forms need the preview harness or a real window.

## Class B

- `apps/desktop/client/src/lib/words/*.ts` and the `words.ts` files beside a window (copy dictionaries: anchored inserts only).
- `apps/desktop/client/src/windows/main/console/guard.test.ts` (pins the home's `useMutation` set; widen it on purpose, in the same commit).
- Not yet verified at init: the console layer registry file. Name it in the first brief that touches a layer.

## Class C

- `bindings/` (generated from Rust; frozen with the IPC contract until 2026-11-12).
- `context-map.json`, `.ai/registry-map.json`, `.ai/conform-runs/` (the curator loop commits these on main every few minutes).
- `Cargo.lock`, `package-lock.json`, the git index.
- No locale codegen exists (`locale_count: 1`), so there is no string regeneration step.

## Repo law

- Read `CLAUDE.md`, `AGENTS.md` and the context's row in `context-map.json` first; reuse before building.
- The IPC contract (commands, events, error codes, `bindings/`) is frozen until 2026-11-12. A brief that needs a new field or command stops at a read-only feasibility checkpoint and reports.
- No ledger schema migration before 2026-11-12.
- The director (`apps/desktop/client/director.html`, `src/director/`) runs the real windows on the browser mock with a permanent "Preview, sample data" banner. It is watch-only: no action may move money.
- The product is Signet in every owner-visible string.
- Long descriptive text sits behind the Info button; a surface carries one purpose line (stabilize-and-declutter, 2026-11-09).
- Loading, empty and error use the one shared async-state system (perfection-ten, 2026-11-09); no new ad-hoc `if (!data) return null`.
- `tokens.css` holds the only colour literals.
- A client test that renders mock-world time pins the clock (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime(...)`, real timers back in `afterEach`).
- A feature that adds mutations under `windows/main/home` widens the allowlist in `console/guard.test.ts` on purpose. Before changing a default route or home view, list every test that renders the root and every deep link the director frames.
- Files are CRLF: use the Edit tool, never a multi-line scripted replace. Shell heredocs containing apostrophes break the Bash tool: write files with the Write tool.
- Never `git add -A`, never stash; `git commit --only <paths>`.
- A builder's "it fails on HEAD too" is not evidence in a shared tree; the Director re-runs it on an untouched checkout with its own `CARGO_TARGET_DIR`.

## Context sources

- `context-map.json` is a hand rescan by scan-sweep (generator "scan-sweep hand rescan", 2026-10-21, at commit 59584636, 51 contexts). At init it was 887 commits behind `main`; `personas-door contexts refresh --dry-run` reported 405 added files and 252 unassigned. It was NOT refreshed at init because the curator loop was committing `.ai/registry-map.json` (which joins on the map revision) every few minutes.
- The Personas app knows 47 of the 51 names. Map-only, so they earn no coverage: `console-framework`, `console-navigation-and-lists`, `client-data-layer`, `rules-and-settings-areas`.
- Unmapped but real: `crates/table-sandbox/` (the judge-facing sandbox, 13 files) and `scripts/sandbox/sdk-conformance/`.
- `home-overview` in the map lists 5 files; the real surface is `windows/main/home/` plus `windows/main/switchboard/`.

## Smoke

- Dev server: `pnpm --dir apps/desktop/client dev` on 1430 (browser mock, sample data). The director build is served by `vite preview`.
- Live UI e2e is CDP into the shell: `apps/desktop/client/e2e/live/README.md`. The sandbox key is `scripts/sandbox/.env.sandbox`.

## Opportunity arcs

- Submission closes 2026-11-12 14:00 PT. 2026-11-11 is the refilm: surfaces the film frames (home board, Tumbler, approval window, Rewind, proof) weigh most, and what a judge can run or read (sandbox, README, PayPal sandbox integration, the hosted house seller) comes next.
- Stability outranks novelty until submission: a direction must be reversible by one `git revert` and must not move the rehearsal's expected text without updating it.

## Vetoes

- Rescue Pause (needs four contract additions; parked until after 2026-11-12).
- A `revoked` pairing state in the contract; a runtime refusal on an unreadable owner key (both parked by perfection-ten).
- Do not re-shoot `film/signet` before the app work lands; the film and `film-capture.mjs` are the operator's.
- `prototype/` (the Dial and tumbler prototypes) is retired exploration.

## User taste

- Carried from the spark overlay: prototype-over-pick for aesthetic balances; outcome-value over cosmetic churn.
- Round 1 (2026-11-10): 9 of 9 accepted, all of them a live defect or the operator's own rule broken at named lines (on-camera countdown, empty flash, defaults shown as her limits, unknown read as none, naming). The one decline was the rider that added a Rust lot two days before the submission. Director's reading, not the operator's words: near a deadline, client-only fixes with a visible outcome pass; anything that opens a second toolchain does not.

## Skill improvement log

- 2026-11-11 round 1: a lot-scoped builder gate misses a test in ANOTHER folder that pins the changed symbol (rewind/future.test.ts pins `allClearTicker` against the timeline headline; only the full suite at integration caught it). At brief time, grep the tests for each symbol a direction changes and put every hit in that builder's gate, wherever it lives.
- 2026-11-11 round 1: a cross-cutting rule ("Signet in every owner string") is not found by per-context scouts: each reported one or two hits in its own folder, and the Director's whole-client grep found the real set (and that most hits were comments). For a rule violation, the Director greps the whole tree before the gate and the scouts only classify.
- 2026-11-11 round 1: a fixed-size Tumbler form renders faithfully without the app: a scratchpad HTML page with one `srcdoc` iframe per case (420 x 88, `body.w-tumbler`, the six stylesheets `dist/tumbler.html` links, served by `vite preview`), shot by headless Chrome at a 520 px window. Two calls, both themes. The builder's character-per-line estimate was off by more than 2x (it forgot the 88 px the puck takes), so render, do not estimate.
- 2026-11-11 round 1: the spark ledger still describes the home as the proof-table board; it was retired 2026-11-06 for the conversational home, and the director films open the console, so the home is in no film. Score film-fit from `director/stories.ts`, not from the ledger.
