# PayPal Agentic Wallet - The Table

Entry for PayPal's **Build What's Next with PayPal and AI** hackathon (Devpost, submissions close
**2026-11-12 14:00 PT**). A Tauri 2 desktop app that is the local home of a user's AI agents when
they touch money: every payment is a deal with a counterparty, bounded by a mandate the owner
signed, countersigned by the wallet only if it fits, settled by PayPal with one human approval,
and provable by both sides. The LLM engine is the user's own `claude-code` or `codex-cli`.

Status (2026-10-06): **backend B0–B8 and plumbing P1, P2, P4, P5 are built and offline-tested**
- money pipeline, ledger, PayPal clients, MCP tools, two-wallet relay pairing and the hosted HOUSE
seller - and the **React client** (main, Tumbler, approval) is wired to the real IPC contract with a
mock backend for browser preview. Not yet verified: an interactive run inside the native shell,
live PayPal sandbox and engine spikes (native engines stay gated until spike 2 proves isolation),
and deployment. Rescue execution and catalog tools are deferred. See
[`docs/build/STATUS.md`](docs/build/STATUS.md) for phase status, decisions and acceptance coverage.

Run the backend checks on Windows with `./scripts/check.ps1`. It runs formatting, Clippy with
warnings denied, and the complete offline test suite, keeping caches and temporary files in this
repository. On Linux the equivalent checks are `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`, and `cargo test --workspace`.

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
