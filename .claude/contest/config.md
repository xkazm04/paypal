---
vault: ["C:/Users/kazda/kiro/paypal/.contest"]
vault_subdir: Backend
arena: .contest/arena
participants: "claude:claude-opus-5-5@high,codex:gpt-6-astra@high"
judges: ""
variants: 3
timeout_min: 90
---

# Contest overlay - PayPal Agentic Wallet (PayPal "Build What's Next" hackathon)

## Engines

`claude` resolves from PATH (`C:/Users/kazda/.local/bin/claude`, a real binary). `codex` is the
nvm npm shim (`codex-cli 0.159.x`); the runner passes the sandbox-bypass flag, which codex on
Windows needs to write at all. A one-line write probe with `gpt-6-astra@high` passed on 2026-10-02.

## Data

Material is staged by hand under `.contest/brief/data/`: the owner's fixed scope, the hackathon
page and rules, and three research notes copied from `.research/` (PayPal platform facts, the
agent-payments landscape plus the Tauri / CLI / sponsor stack, and what the owner's Personas Desktop
already does). Every research note marks sourced (`[S]`) versus recalled (`[R]`) claims.

## Taste

- **Grounded over clever.** The 2026-10-01 business round failed on grounding, not execution. A
  claim about a PayPal API, its sandbox, a sponsor tool or a CLI flag must trace to the staged
  research or be marked as an assumption. Money direction (who pays whom, through which API, who
  approves) must be possible in the PayPal sandbox as the research describes it.
- **Win-shaped.** Every scope decision answers to the five equally weighted judging criteria and
  the prize-stacking rule (one Grand Prize or one Honorable Mention, plus one Sponsor Prize).
- **Security is the signature.** The owner builds agent orchestration platforms with a security
  focus; an agent that can move money is the threat model, and the report should read like it.
- **Implementation-ready.** The chosen report becomes the project's implementation documentation:
  a coding agent must be able to start building from it on day one.
- **Practical before spectacular.** About six weeks, one operator driving coding agents.

## Skill improvement log
