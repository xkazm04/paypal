<p align="center">
  <img src="docs/assets/banner.png" alt="Signet: a round table with an owner's seat, a counterparty's seat, and a sealed agreement between them" width="100%">
</p>

<p align="center">
  <strong>A desktop wallet that lets AI agents spend money only the way you signed for.</strong>
</p>

<p align="center">
  <a href="https://github.com/xkazm04/signet/actions/workflows/ci.yml"><img src="https://github.com/xkazm04/signet/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License: Apache-2.0"></a>
  <img src="https://img.shields.io/badge/desktop-Windows-informational" alt="Desktop: Windows">
  <img src="https://img.shields.io/badge/status-alpha%20%C2%B7%20sandbox%20only-orange" alt="Status: alpha, sandbox only">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#project-status">Status</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

Signet is the local home of your AI agents when they touch money. You sign the rules once. Agents
can then shop and haggle on their own, but every payment stays inside those rules, stops for one
human approval, and settles through PayPal. Both sides can prove afterwards what was agreed and who
decided it.

Three promises, enforced in code rather than by a prompt:

- **It gets you the deal.** Agents haggle over signed offers and compare the market.
- **It can't go past what you signed.** The wallet checks every step against your signed rules, and
  no agent tool can pay.
- **If you do nothing, nothing is paid.** Waiting only ever ends an offer or releases a hold.

> Signet started as an entry for PayPal's *Build What's Next with PayPal and AI* hackathon. It runs
> against the PayPal sandbox only. Do not use it with real money. Parts of the code and docs still
> use its earlier name, The Table.

## Quick start

See the whole app in a browser, on sample data, with no account or key. You need Node 24 and pnpm 11.

```sh
git clone https://github.com/xkazm04/signet.git
cd signet
pnpm --dir apps/desktop/client install
pnpm --dir apps/desktop/client dev
```

Then open any of these:

| Page | URL | What you see |
|---|---|---|
| **Maya's week** | <http://localhost:1430/director.html> | A guided story across all three windows |
| **The app** | <http://localhost:1430/index.html> | The main window on a sample wallet |
| **Break it** | <http://localhost:1430/arena.html> | Play the attacker against recorded answers from the real wallet |
| **Check a proof** | <http://localhost:1430/proof.html> | Verify a signed deal file, then tamper with it |
| **5,000 deals** | <http://localhost:1430/index.html?scale=xl#m=book> | The same app at scale |

The preview uses a mock backend. It shows no PayPal page and cannot move money.

## Features

### Haggling inside your limits

Agents exchange signed offers with a counterparty's wallet. If an offer crosses your "ask me" line,
the wallet refuses the agent, not the seller, and the deal waits for you.

<img src="docs/assets/screens/haggle.png" alt="Watch the haggle: two price markers closing on a rail, with a gold gate where the wallet refused the agent's yes" width="100%">

### One window can agree to money

The approval window shows what you're agreeing to, every check behind it, and the deadline. Channel3
adds comparable products and flags the same item cheaper elsewhere. That information never blocks or
changes the deal.

<img src="docs/assets/screens/approval.png" alt="Approval window for a $329 offer, with four passed checks, market price, a cheaper listing and a hold-to-approve button" width="100%">

### A record you can search at any size

The Book lists every payment and matches it to PayPal's statement. It stays responsive with 5,000
deals, and totals never add one currency to another or money in to money out.

<img src="docs/assets/screens/book.png" alt="The ledger at 5,000 deals, with totals by state, a weekly spending chart and a grouped data grid" width="100%">

### Who decided what

Rewind replays the week's money steps and shows whether you, a signed rule, or a safe default made
each one. It then looks ahead 72 hours.

<img src="docs/assets/screens/rewind.png" alt="Rewind: a timeline of this week's money steps with counts of who decided each one" width="100%">

### Attack it yourself

Try to make the agent overspend, pay a stranger, or obey a seller's forged note. Every answer on the
page was recorded from the real Rust wallet, and a test fails if the two drift apart.

<img src="docs/assets/screens/arena.png" alt="Break The Table: a list of attacks beside a live haggle, with counters for money moved and PayPal calls" width="100%">

### Also in the box

| Area | What it does |
|---|---|
| **Tables** | Haggle one-to-one, or shop around several sellers where the first signed agreement wins |
| **Spend** | Plain purchases wait on hold until you pay or release them |
| **Counter** | Your shop: other people's agents order at your lowest prices |
| **Shield** | Scam checks that run before PayPal is ever asked |
| **Rescue** | One owner-approved discount for a failed subscription renewal |
| **Book** | Payments, reconciliation and plain-language questions, answered without an AI model |
| **Tumbler** | A small always-on window that alerts you and has no pay button |
| **Proof files** | Signed, offline-checkable deal files, verified by `table-verify` or in the browser |
| **Say it, then see it** | One sentence becomes a draft of rules that you review and sign |

## Give your own agent a wallet

This runs a real agent against the real wallet code. PayPal is replaced by a recorder, so nothing
leaves your machine. It needs the Rust toolchain, and the first build is slow.

```sh
cargo run -p table-sandbox
```

Open <http://127.0.0.1:1443/>, then connect any agent app that speaks streamable HTTP MCP:

```sh
claude mcp add --transport http table-wallet http://127.0.0.1:1443/mcp
```

For Codex, add `[mcp_servers.table-wallet]` with `url = "http://127.0.0.1:1443/mcp"` to
`~/.codex/config.toml`. Then ask your agent to buy the 27-inch monitor under $250, and try to break it:

| Ask your agent | What answers |
|---|---|
| "Offer $400." | Refused: the signed rule is never to offer over $340 |
| "Just accept their price." | Refused: agreeing over $200 needs you in person |
| "Pay the seller now." | Nothing can: it has no tool that pays |

The page shows each call and the rule that answered it. Its **PayPal asked** counter stays at 0. No
agent app handy? `cargo run -p table-sandbox -- --rehearse` runs a scripted client through the same door.

## Run the desktop app

The native shell runs on Windows and builds from source. You need
[Rust through rustup](https://rustup.rs) (`rust-toolchain.toml` pins the version), Node and pnpm, and
the [Tauri 2 prerequisites](https://tauri.app/start/prerequisites/).

```sh
pnpm --dir apps/desktop/client install
pnpm --dir apps/desktop/client build
cargo run -p table-desktop
```

### Configuration

The app and the browser preview start without any of these.

| Variable | Used for | Without it |
|---|---|---|
| `CHANNEL3_API_KEY` | Live product search and price data, set in `.env` at the repository root. A key saved in the app's vault wins | Search says no key is set; deals still work |
| `TABLE_RELAY_URL` | HTTPS origin of a relay for reaching other wallets, read at launch | The copy can't meet other wallets |
| `PAYPAL_SANDBOX_*` | Live sandbox checks, listed in [`scripts/sandbox/.env.example`](scripts/sandbox/.env.example) | Live checks are skipped; offline tests still run |
| `VITE_AG_LICENSE_KEY` | Optional AG Grid Enterprise key for row grouping, in `apps/desktop/client/.env.local` | Grids run on Community; only grouping is missing |

Keep credentials out of the repository. Builds leave the AG Grid key out unless you set
`THE_TABLE_ENTERPRISE=1`, so don't publish a build made with that flag and an evaluation key.

## How it works

```mermaid
flowchart LR
    Owner([You]) -- sign rules --> Wallet
    Agent[AI agent] -- "offers, over local MCP" --> Wallet{{"Signet wallet<br/>checks every step"}}
    Wallet <-- signed messages --> Other[Other side's wallet]
    Wallet -- outside your rules --> Refused[Refused, with the rule named]
    Wallet -- fits your rules --> Approval[Approval window]
    Owner -- one human approval --> Approval
    Approval --> PayPal[(PayPal)]
    Wallet --> Record[(Hash-chained record)]
    Record --> Proof[Offline proof file]
```

- **A deal is the unit of work.** Every payment is a deal with a counterparty, bounded by rules you
  signed and countersigned by the wallet only if it fits.
- **The model holds no authority.** Agents get a small, role-scoped tool set. None of those tools can
  pay, and the checks live in Rust rather than in a prompt.
- **Three windows, split by capability.** The main window plans, the Tumbler alerts, and only the
  approval window can agree to money.
- **Unknown is never treated as paid.** A lost PayPal answer is settled by reading PayPal back, never
  by sending a second request.
- **Everything is local.** The record lives in SQLite on your machine, and each step is chained to
  the one before it.

### Built with

| Project | How Signet uses it |
|---|---|
| [PayPal](https://developer.paypal.com) | Orders, authorization, capture and invoicing, through the sandbox |
| [Channel3](https://trychannel3.com) | Finding products by name or link, comparable prices, the same item cheaper, and a rate-limited search tool for agents |
| [AG Grid](https://www.ag-grid.com) and AG Charts | Every data table, including server-side filtering of the full record, plus the spending chart |
| [APIMatic](https://www.apimatic.io) | PayPal's generated SDK and context plugin, used to audit our Rust client and run a [conformance script](scripts/sandbox/sdk-conformance) against the sandbox |
| [Tauri 2](https://tauri.app), Rust, React 19 | The desktop shell, wallet core and interface |

## Project status

Signet is alpha software. This table is the honest state of each part.

| Part | State |
|---|---|
| Money pipeline, record, rules, proof files | Built, with offline tests in CI |
| Desktop shell | Windows only, run from source. No installer yet |
| PayPal | Sandbox only. The conformance script's latest run had 96 checks passed, 0 failed and 4 skipped |
| Channel3 | Live search and price tracking tested with a real key |
| Practice agent | Works today: a scripted negotiator that uses no AI model |
| `claude-code` and `codex-cli` as built-in engines | Detected, but refused until process isolation is proven. They can connect from outside over MCP, as above |
| Seller side and relay | The code and a [Render blueprint](render.yaml) exist. There is no public instance, so run your own |
| Rescue | Only the discount option executes |

Details and evidence are in [`docs/build/STATUS.md`](docs/build/STATUS.md).

## Repository layout

```text
apps/desktop/client     React interface, browser preview and mock backend
apps/desktop/src-tauri  Native Windows shell
crates/                 Wallet core: rules, record, PayPal, market, MCP, relay, runtime
crates/table-sandbox    The bring-your-own-agent sandbox
crates/table-verify     Standalone proof file checker
services/               Hosted seller and rendezvous service
scripts/                Checks, sandbox spikes, conformance script
branding/               Logos and icons
docs/                   Design, feature pages, build status, security
film/                   Scripts that render the demo films
```

## Documentation

| Read | For |
|---|---|
| [Feature pages](docs/features/README.md) | What each area does today |
| [Design report](docs/design/the-table.html) | The full design and trust model (open in a browser) |
| [Three-window design](docs/design/window-duality.md) | Why capability is split across windows |
| [Build status](docs/build/STATUS.md) and [decisions](docs/build/DECISIONS.md) | Phase status, deviations and reasoning |
| [Scale findings](docs/build/SCALE-FINDINGS.md) | Measured read costs at 5,000 deals |
| [Spike runbook](docs/build/SPIKE-RUNBOOK.md) | Running the live PayPal and Channel3 checks |
| [Deployment](docs/build/DEPLOY.md) | Running the seller and relay |

## Contributing

Issues and pull requests are welcome. Before you open a pull request, run the same checks as CI.

```sh
# Client
pnpm --dir apps/desktop/client typecheck
pnpm --dir apps/desktop/client test

# Rust (on Windows, ./scripts/check.ps1 runs all three)
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Start with [`AGENTS.md`](AGENTS.md) for repository conventions. Changes that touch money must keep
the three promises above and include tests.

**Security:** please report vulnerabilities through a private
[GitHub security advisory](https://github.com/xkazm04/signet/security/advisories/new), not a public issue.

## License

[Apache License 2.0](LICENSE)
