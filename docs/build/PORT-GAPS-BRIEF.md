# Wave 0: backend for the v2 client port's gaps

The v2 client port (`docs/build/CLIENT-V2-PORT.md`, `CLIENT-STATUS.md` "v2 port") renders an honest
UNAVAILABLE or unknown state wherever the contract lacks a fact. This wave closes the gaps that **no
moonshot theme covers** (`docs/concepts/moonshot-backlog.md` §1a), end to end: the Rust command or
field, the generated binding, the mock parity, and the client page switching from "unknown" to the
real fact.

## Not in this wave (owned by a theme, do not build here)

| Port request | Theme |
|---|---|
| `mandate_preview` (what-if) | T12 `mandate_simulate` (wave 2) |
| Transcript / proof export | T1 proof bundle (wave 1) |
| Per-clause trace, decision history | T6 `deal_history` (wave 2) |
| Rust-composed READY checks, settle facts, order payee in the approval diff | T5 (wave 1) |
| Daily cap / held / real meters | T14 exposure envelope (wave 3) |

## In this wave (in this order; `scripts/check.ps1` green after each step)

1. **Deal facts**: `decided_by` on `Deal` (owner / policy clause N / safe default, as already
   written to the audit log). Spend, Book "Policy vs me" and Deal Mirror read it.
2. **Counterparty projection**: pairing status (words confirmed / HOUSE pinned / unpaired) and the
   declared payee in `CounterpartyDisplay`. A quarantined **counterparty note read** for the main
   window: the same untrusted-text path the approval window uses, length-capped, never parsed.
   Deal, Tables, Shield and Counter show it behind "note ›".
3. **Pairing lifecycle**: `pairing_abort` (either window may abort; aborting restricts, so it needs
   no privilege), `PendingPairing.expires`, a `pairing:pinned` event to main after a confirm, and a
   `house_wake` (no money; wakes the hosted HOUSE through the existing path).
4. **Approval hand-off**: an `approval_open` target (deal | pairing | credentials | mandate | unlock)
   and an optional **draft** carried to the approval window: a band draft (floor / ceiling), a floor
   draft (seller mandate), a rescue lever choice. The approval window opens pre-filled. Everything
   is still re-checked and signed only there; main never signs.
5. **Read-only owner facts**: an audit-log read (paged, newest first) for Book; the last Transaction
   Search poll time; idle seconds until lock; the engine probe's time and detail; the stored date of
   each credential (never the secret); the agent roster (slot, engine, what it does).
6. **Book query**: `book_query(structured)`, a read-only structured query over the ledger with a
   closed schema (view, group_by, metrics, filters). It is validated in Rust, and an INVALID result
   carries the schema rejection verbatim. The client already renders the slip and lenses; typed
   questions stay preset-only unless an engine turns text into the structure.

Out of scope: the shop catalog and the rescue lever engine (backend "deferred" items with their own
design). If a step reveals that one of them is needed, stop and report it.

## Rules

- `AGENTS.md` invariants hold. None of these commands moves money. New privileged commands are
  granted to the `approval` label only; read projections follow the existing label rules. Refused
  intents still leave zero `paypal_calls` rows. `audit_log` stays append-only.
- Every new command is added to `COMMANDS` / `CommandContract` in `crates/table-client`, registered
  in the shell (`generate_handler!` and the build.rs list), and granted in `capabilities/*.json`;
  the existing contract tests check the two directions. Append only, never reformat (T11 will
  regenerate this table later). Ledger migrations are append-only and numbered after the last one.
- Regenerate `bindings/` with the existing ts-rs path. Update `src/mock/backend.ts` + `fixtures.ts`
  so the mock mirrors the real gates. Wire the client pages that today show the gap (see
  `CLIENT-STATUS.md` "v2 port"). Do not redesign pages.
- Tests never touch the network. Add domain tests for each projection and gate, plus client tests
  for the wiring. `cargo fmt --all`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo test --workspace` and the client gates must pass. `./scripts/check.ps1` runs them all.
- Mark anything you cannot ground in `.research/` as `// UNVERIFIED:` and list it in STATUS.md.
- Update `STATUS.md` and `CLIENT-STATUS.md` (strike the closed requests). No commits.
