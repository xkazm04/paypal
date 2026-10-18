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

## Question taste

- Prototype-over-pick: when options are aesthetic balances, the operator prefers building all variants and choosing by watching (2026-10-18, demo-film). Offer "prototype all" as an option.
- Secrets: before asking about an API key, scan sibling repos for env var NAMES (never values) and offer "reuse the key from <repo>" as an option.

## Skill improvement log

- 2026-10-18 demo-film-hybrid: `pnpm --dir apps/desktop/client test` has a date-boundary flake (book.test.tsx "paid today") red between 00:00 and 02:00 local (UTC day roll); re-run after 02:00 before blaming a change.
- 2026-10-18 demo-film-hybrid: a worktree cut from origin/<base> while local <base> has diverged lands with `git rebase --onto <base> origin/<base>`, never plain `git rebase <base>`.
- 2026-10-18 demo-film-hybrid: Windows long paths (node_modules under film/) block `git worktree remove`; delete with `cmd /c rmdir /s /q "\\?\<abs path>"` then `git worktree prune`.
- 2026-10-18 demo-film-hybrid: the contract must name the reference frame of every time field (beat-relative vs take-relative); the click atMs mismatch was the one contract gap.
