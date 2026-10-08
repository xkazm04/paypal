# PayPal Agentic Wallet - The Table

Entry for PayPal's **Build What's Next with PayPal and AI** hackathon (Devpost, submissions close
**2026-11-12 14:00 PT**). A Tauri 2 desktop app that is the local home of a user's AI agents when
they touch money: every payment is a deal with a counterparty, bounded by a mandate the owner
signed, countersigned by the wallet only if it fits, settled by PayPal with one human approval,
and provable by both sides. The LLM engine is the user's own `claude-code` or `codex-cli`.

Status (2026-10-08): **backend B0–B8 and plumbing P1, P2, P4, P5 are built and offline-tested**
(money pipeline, ledger, PayPal clients, MCP tools, two-wallet relay pairing, the hosted house seller)
and the **React client** (main, Tumbler, approval) runs on the real IPC contract, with a mock backend
for browser preview. On top of that, these moonshot themes are built:

- **Provable:** signed offline proof bundles checked by `table-verify` (T1); an approval checklist
  composed in Rust and bound to every owner decision by its hash (T5); "who decided" for every money
  step, with a Rewind of the week on the Dial (T6); one authority table for every IPC command, with a
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
- **For Maya and for judges:** a first-run path to a first safe deal, two design polish passes, a WCAG
  2.2 AA keyboard and screen-reader pass, and a no-install director that plays "Maya's week" across
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

`pnpm --dir apps/desktop/client install && pnpm --dir apps/desktop/client dev`, then open
`http://localhost:1430/director.html`. "Maya's week" plays all three windows (The Table, the
Tumbler and the approval window) side by side on sample data with a simulated clock: a haggle that
needs her, a deadline that passes with no money moved, a payment request that does not match, and
a hold that releases itself while The Table is closed. It is a browser preview, never the wallet:
no PayPal page is shown and nothing it does can approve or move money. A static build
(`pnpm --dir apps/desktop/client build`, then serve `apps/desktop/client/dist`) works the same.

## Implementation documentation

| Document | What it is |
|---|---|
| [`docs/design/the-table.html`](docs/design/the-table.html) | **The design** - business situation (Maya's week), spine (Deal + Mandate), money mechanics for all six capabilities, architecture, data models, trust model, haggle protocol, product surfaces, video, prize strategy, dated build plan, acceptance criteria, risks. Open in a browser. |
| [`docs/design/window-duality.md`](docs/design/window-duality.md) · [`.html`](docs/design/window-duality.html) | **Addendum: The Table and the Tumbler** - three windows (`main`, `tumbler`, `approval`), close-to-tray, the small operative window for gating and alerts, attention ladder, capability split, contracts, acceptance W1-W11. Adapted from athena-portable ADR 0026. |
| [`prototype/main/index.html`](prototype/main/index.html) | **Main window prototype - The Dial**: Layer 0 vault dial routing into the six modules, deal detail, approval moment. Deep links: `#m=spend`, `#d=D-0193`, `#a=D-0193`. Sandbox sample data. |
| [`prototype/tumbler/index.html`](prototype/tumbler/index.html) | **Tumbler prototype**: a stylised desktop with The Table closed and the Tumbler in the corner - forms, attention ladder, approval hand-off. |
| [`.research/`](.research/) | Sourced research the design stands on: PayPal platform facts and gotchas, agent-payments landscape and stack (CLIs, Tauri 2, sponsors), patterns from the owner's Personas Desktop. `[S]` sourced / `[R]` recalled. |

Start with the day-1 spikes in the design report (§13): they retire the facts the whole design
depends on (codex-cli MCP approve mode, tool-less engine profile, seller-issued AUTHORIZE order
approved by a second sandbox account, return URL, Channel3 tracking, Invoicing send/pay).

## How the design was chosen

A blind `/contest` (arena in `.contest/`, git-ignored): six design reports from two seats,
grounding-audited against the research; the owner shortlisted *Checkpoint* and *The Table*; a
reveal round let both read the whole field and close their audit defects; a UI round produced six
Layer 0 home scenes, and the owner chose **The Dial** (The Table concept). The window duality was
added on the owner's request after the UI round.

## License

Apache License 2.0 - see [`LICENSE`](LICENSE).
