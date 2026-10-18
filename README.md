# PayPal Agentic Wallet - The Table

Entry for PayPal's **Build What's Next with PayPal and AI** hackathon (Devpost, submissions close
**2026-11-12 14:00 PT**). A Tauri 2 desktop app that is the local home of a user's AI agents when
they touch money: every payment is a deal with a counterparty, bounded by a mandate the owner
signed, countersigned by the wallet only if it fits, settled by PayPal with one human approval,
and provable by both sides. The LLM engine is the user's own `claude-code` or `codex-cli`.

[![ci](https://github.com/xkazm04/paypal/actions/workflows/ci.yml/badge.svg)](https://github.com/xkazm04/paypal/actions/workflows/ci.yml)
**CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull request. Client: `pnpm typecheck`,
`pnpm test` and `pnpm build`. Rust, on Windows and Ubuntu: `cargo fmt --all --check`, `cargo clippy --workspace
--all-targets -- -D warnings` and `cargo test --workspace`, plus `cargo-deny` (licences, bans, RustSec advisories),
the acceptance matrix and an offline `table-verify` check of the safety dossier.

Status (2026-10-08): **backend B0–B8 and plumbing P1, P2, P4, P5 are built and offline-tested**
(money pipeline, ledger, PayPal clients, MCP tools, two-wallet relay pairing, the hosted house seller)
and the **React client** (main, Tumbler, approval) runs on the real IPC contract, with a mock backend
for browser preview. On top of that, these moonshot themes are built:

- **Provable:** signed offline proof bundles checked by `table-verify` (T1); an approval checklist
  composed in Rust and bound to every owner decision by its hash (T5); "who decided" for every money
  step, with a Rewind of the week (T6); one authority table for every IPC command, with a
  permissions fingerprint (T11); a glass-box house seller that publishes a signed record and a public
  scoreboard (T9).
- **Safe by default:** the walk-away forecast in the Tumbler and an honest quit confirm (T4); a
  read-back resolver that settles PayPal calls whose answer was lost, never under a second request id
  (T10); owner-signed wallet-wide limits above every agent's rules (T14).
- **Useful:** a deterministic negotiator that haggles with no LLM (T2); "shop around" with several
  sellers where the first signed agreement wins (T8); a what-if of new rules against last week before
  signing (T12); market prices kept fresh under a signed rule (T15); subscription rescue with one
  owner-approved discount invoice, counted only when PayPal confirms it paid; plain-language questions
  to the Book, answered by the wallet's own reading (no AI).
- **For Maya and for judges:** a first-run path to a first safe deal (the wallet's charter), two design
  polish passes, a WCAG 2.2 AA keyboard and screen-reader pass, the console main window (one decision
  centre with nested layers, below), and a no-install director that plays "Maya's week" across
  all three windows (below), with a rig for repeatable video takes.

Not yet verified: an interactive run inside the native Windows shell (several shell edits are
compiled only on Windows), live PayPal sandbox checks and engine spikes (native engines stay gated
until spike 2 proves isolation; spike 8 for invoices waits for the owner), and deployment. See
[`docs/build/STATUS.md`](docs/build/STATUS.md) for phase status, decisions and acceptance coverage.

Run the backend checks on Windows with `./scripts/check.ps1`. It runs formatting, Clippy with
warnings denied, and the complete offline test suite, keeping caches and temporary files in this
repository. On Linux the equivalent checks are `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace`.

### Watch it work without installing anything

1. Install the client dependencies: `pnpm --dir apps/desktop/client install`
2. Start the preview server: `pnpm --dir apps/desktop/client dev`
3. Open `http://localhost:1430/director.html` in a browser.

"Maya's week" plays all three windows (The Table, the Tumbler and the approval window) side by side
on sample data with a simulated clock: a haggle that needs her, a deadline that passes with no money
moved, a payment request that does not match, and a hold that releases itself while The Table is
closed. A static build also works: run `pnpm --dir apps/desktop/client build:director` (a plain
`build`, and so the release build, does not include the director), then serve
`apps/desktop/client/dist` and open `director.html` from it.

This needs Node and pnpm and nothing else. The repo pins neither version.

### What is real and what is mocked

The browser preview runs on a mock backend with sample data. It is never the wallet: no PayPal page
is shown, no real money moves, and nothing it does can approve or move money. The Rust backend
(money pipeline, ledger, PayPal clients, relay pairing, hosted house seller) is built and tested
offline only. The live PayPal sandbox spikes have not run. They are approved for the owner to run
with their own sandbox credentials, and builders only prepare them (`docs/build/DECISIONS.md`
section 44; script in [`docs/build/SPIKE-RUNBOOK.md`](docs/build/SPIKE-RUNBOOK.md)). The hosted
HOUSE seller is not deployed ([`docs/build/DEPLOY.md`](docs/build/DEPLOY.md): no deployment was
performed).

### Run The Table on Windows

The native shell is Windows-only (`docs/build/STATUS.md`, "Native Tauri is Windows-only"). It has
not been run interactively yet (`docs/build/STATUS.md`, B8 row: "native behavior still needs
interactive verification"), so expect rough edges. There is no signed installer: the Tauri bundle is
switched off (`"bundle": {"active": false}` in `apps/desktop/src-tauri/tauri.conf.json`), so you run
it from source.

Prerequisites:

- Rust, installed through rustup. `rust-toolchain.toml` pins channel 1.97 and rustup fetches it on
  the first cargo command.
- Node and pnpm, for the client.
- Whatever Tauri 2 needs on Windows (a C++ build toolchain and WebView2). This repo does not list
  them, so check Tauri's own prerequisites page. Not verified here.

Steps, from the repository root:

1. `pnpm --dir apps/desktop/client install`
2. `pnpm --dir apps/desktop/client build`. The shell embeds `apps/desktop/client/dist` at compile
   time, so build the client first.
3. `cargo run -p table-desktop`

Or run `npm run tauri:dev:test`, which does the same with a source inspector turned on
(`scripts/dev/tauri-dev-test.mjs`; press Ctrl+Shift+L in the app).

Without a deployed HOUSE and sandbox credentials you cannot complete a real payment. To check the
code without the app, run `./scripts/check.ps1` (formatting, Clippy with warnings denied and the
offline test suite).

#### Connect an agent engine and a relay address

Both are optional for a first look. Read what each step can and cannot do before you rely on it.

Agent engine. In the app, open Connections and choose the "Agent app" card
(`docs/features/agents-and-engines.md`). It lists `claude-code`, `codex-cli` and the "Practice
agent", and "Look for agent apps" probes for the first two.

- The practice agent is the one engine that works today. It is a scripted negotiator with no AI
  model, and it only haggles inside the price range the owner signed. Pick it with "Use practice
  agent". On a deal page, "Start agent" then runs it.
- `claude-code` and `codex-cli` are installed and probed, but they cannot be used yet. The probe
  always reports them unavailable ("Pre-input tool inventory is not established; run isolation
  spike"), and starting one is refused with "Engine isolation conformance not established". The
  isolation spikes that would lift this have not run (`docs/build/SPIKES.md`). There is no setting
  that overrides it, so connecting a real engine is not yet available.

Relay address. A copy with no relay says "This copy is not set up to meet other wallets, and the
House is not available in it" (`apps/desktop/client/src/lib/words/connections.ts`). To attach a
relay, set the environment variable `TABLE_RELAY_URL` before `cargo run -p table-desktop`, for
example in PowerShell: `$env:TABLE_RELAY_URL = "https://<your relay>"`. It is read once at launch
(`apps/desktop/src-tauri/src/native.rs`), must be an HTTPS origin with no path, credentials, query
or fragment (`docs/build/DEPLOY.md`, environment names), and cannot be set from inside the app. If
the value is not a valid origin the shell fails to start with "Invalid relay deployment origin".
There is no public relay to point it at: nothing is deployed. To pair with another wallet you
would need a second desktop copy and your own rendezvous service (`services/rendezvous`), and
native two-desktop pairing has not been tried (`docs/features/pairing-relay-house.md`, "Known gaps").

The HOUSE seller. The word `HOUSE` is not a setting you type in yourself: in Connections, "Connect a
wallet", choose "House seller" and the app sends it for you. It cannot work yet, for two reasons.
The HOUSE is not deployed (`docs/build/DEPLOY.md`; `docs/build/DECISIONS.md` section 42 item 2: the
build carries no relay address until the deploy is approved). And a build made without the public
pin `TABLE_HOUSE_RELEASE_JSON` reports the house as unavailable (`crates/table-proto/src/house.rs`);
a plain `cargo run` is such a build. Without the HOUSE, no real payment can complete, and none can
without the owner's PayPal sandbox credentials either; the spikes that would use them are the
owner's to run (`docs/build/SPIKE-RUNBOOK.md`).

## Implementation documentation

| Document | What it is |
|---|---|
| [`docs/design/the-table.html`](docs/design/the-table.html) | **The design** - business situation (Maya's week), spine (Deal + Mandate), money mechanics for all six capabilities, architecture, data models, trust model, haggle protocol, product surfaces, video, prize strategy, dated build plan, acceptance criteria, risks. Open in a browser. |
| [`docs/design/window-duality.md`](docs/design/window-duality.md) · [`.html`](docs/design/window-duality.html) | **Addendum: The Table and the Tumbler** - three windows (`main`, `tumbler`, `approval`), close-to-tray, the small operative window for gating and alerts, attention ladder, capability split, contracts, acceptance W1-W11. Adapted from athena-portable ADR 0026. |
| [`prototype/console-calibre/index.html`](prototype/console-calibre/index.html) | **Main window design record - the Calibre console** (contest `table-console-r2-r3`, variant B/2, the owner's pick of 2026-10-14): the decision centre with a small Dial presence (a bead strip beside the seal), the six modules as nested layers, the deal, Rewind, rules, connections, settings and the charter; `NOTES.md` explains it. A static reference page, not the app's code. |
| [`prototype/main/index.html`](prototype/main/index.html) | **Earlier main window prototype - The Dial** (superseded as the home by the console; the Dial lives on as the console's bead strip): Layer 0 vault dial routing into the six modules, deal detail, approval moment. Deep links: `#m=spend`, `#d=D-0193`, `#a=D-0193`. Sandbox sample data. |
| [`prototype/tumbler/index.html`](prototype/tumbler/index.html) | **Tumbler prototype**: a stylised desktop with The Table closed and the Tumbler in the corner - forms, attention ladder, approval hand-off. |
| [`.research/`](.research/) | Sourced research the design stands on: PayPal platform facts and gotchas, agent-payments landscape and stack (CLIs, Tauri 2, sponsors), reusable engineering patterns from the owner's earlier desktop agent app. `[S]` sourced / `[R]` recalled. |

Start with the day-1 spikes in the design report (§13): they retire the facts the whole design
depends on (codex-cli MCP approve mode, tool-less engine profile, seller-issued AUTHORIZE order
approved by a second sandbox account, return URL, Channel3 tracking, Invoicing send/pay).

## How the design was chosen

A blind `/contest` (arena in `.contest/`, git-ignored): six design reports from two seats,
grounding-audited against the research; the owner shortlisted *Checkpoint* and *The Table*; a
reveal round let both read the whole field and close their audit defects; a UI round produced six
Layer 0 home scenes, and the owner chose **The Dial** (The Table concept). The window duality was
added on the owner's request after the UI round. A later console contest (`table-console-r2-r3`)
replaced the Dial home with the Calibre "Seal" console: the home is now the decision centre, one
decision at a time, with a small Dial kept as its presence ([`prototype/console-calibre/`](prototype/console-calibre/),
`docs/build/DECISIONS.md` section 40).

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
