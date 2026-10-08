# The Table: module documentation

High-level pages, one per module, describing what each part of The Table is **today**. They do not
record how it was built: that is the build log, [`docs/build/STATUS.md`](../build/STATUS.md). The
design sources are the [design report](../design/the-table.html),
[window duality](../design/window-duality.md) and the [UX guide](../ux/UX-GUIDE.md). For a
summary of the overnight build waves, open [the build report](../report/index.html).

Every page has the same shape:
- what the owner sees;
- how it works, and who decides each money step;
- the safety properties the module enforces;
- where it lives in the code;
- the tests that pin it;
- known gaps and UNVERIFIED facts.

## The rule under every page

The AI agent never moves money. PayPal calls that move money are made only by the Rust pipeline
(`table-app`), and only on one of three authorities. Each one is recorded per step in `decided_by`
and in the append-only, hash-chained audit log:

1. **The owner, in the approval window.** It needs the IPC token, the `approval` window label and
   an unlocked session. The decision is bound to the Rust-composed checklist the owner saw.
2. **A rule the owner signed.** That is a countersign under the owner's threshold, or a seller
   collecting an order the buyer already approved on PayPal. The house seller acts on its own
   release-pinned rules.
3. **A safe default.** Void, or let the deal lapse at the deadline; never capture. Silence never
   moves money.

Every agent intent passes the mandate check (and the wallet-wide limits) before any network call.
A refused intent leaves zero PayPal calls.

## Pages

### What the owner works with (the `main` window)

| Page | In one line |
|---|---|
| [Home and Rewind](home-and-rewind.md) | The Dial; "While you were away"; what happens if you walk away; who decided each money step. |
| [Tables: haggling](tables-haggling.md) | Agents bargain inside a signed price range. Covers the practice negotiator, shopping around several sellers, fresh market prices and the fair-price certificate. |
| [Spend: purchases](spend-purchases.md) | Agents propose purchases. The wallet checks them against the rules and wallet-wide limits, and the owner pays or releases the hold. |
| [Counter: the owner's shop](counter-shop.md) | Other agents order at the owner's lowest prices. Money comes in once the buyer approves on PayPal. Also the house seller, seen from the buyer's side. |
| [Rescue](rescue.md) | Failed subscription renewals: watched subscriptions, one discount fix per failure, and a replay for practice. |
| [Shield](shield.md) | Scam checks before PayPal is asked. A HOLD or BLOCK can only be released by the owner, and the release is bound to the terms. |
| [Book](book.md) | Every payment in one list, matched to PayPal's statement. Also "ask in your own words", proof-file checks and "Your safety record". |

### Where decisions happen

| Page | In one line |
|---|---|
| [Approval window](approval-window.md) | The only window that can decide money: Rust-composed checklist, `checks_hash`, hold-to-confirm, idle lock. |
| [Tumbler and attention](tumbler-and-attention.md) | The small always-there window. It runs on one attention-ladder schedule, records what the owner was shown, and powers "What you were shown". |
| [Mandates and rules](mandates-and-rules.md) | What the owner signs: clauses 1–9, versions, what-if before signing, revocation. |

### The platform underneath

| Page | In one line |
|---|---|
| [Money pipeline](money-pipeline.md) | Mandate check → authority → shield → one request id → PayPal, plus the read-back resolver for lost answers. |
| [Agents and engines](agents-and-engines.md) | Agent runs, the MCP tool surface, the closed table view, coded refusals, role playbooks, `claude-code` / `codex-cli` (gated). |
| [Proof and verification](proof-and-verification.md) | Signed proof files, the offline verifier, the hostile-agent gauntlet, the acceptance matrix and the CI safety dossier. |
| [IPC and authority](ipc-and-authority.md) | Three windows, one authority table, a pinned permissions fingerprint, and a browser mock that keeps the same gates. |
| [Pairing, relay, house seller](pairing-relay-house.md) | Pairing with four confirm words, signed envelopes, the relay, and the hosted house seller's public record. |
| [Preview and director](preview-and-director.md) | The browser preview on sample data, "Maya's week" director, the takes rig and code splitting. |

## How the code is laid out

| Layer | Where | What |
|---|---|---|
| Domain (pure, no IO) | `crates/table-core`, `table-proto`, `table-attention`, `table-shield` | deals, mandates, money, envelopes, attention ladder, scam rules |
| Storage | `crates/table-ledger` (migrations `0001`–`0014`) | SQLite ledger, append-only hash-chained `audit_log`, proof export |
| Money | `crates/table-app`, `table-paypal`, `table-market` | the pipeline, the PayPal client, market prices |
| Runtime | `crates/table-runtime`, `table-engine`, `table-mcp`, `table-relay`, `table-os` | the actor, schedulers, agent engines, MCP server, relay, OS keychain |
| Contract | `crates/table-client`, generated `bindings/` | IPC types, the authority table, generated TypeScript |
| Verification | `crates/table-verify` | offline proof verifier, safety predicate, acceptance matrix |
| Desktop shell | `apps/desktop/src-tauri` | Tauri 2 windows, native commands (Windows) |
| Client | `apps/desktop/client` | React UI for the three windows, browser mock, director |
| Hosted | `services/house-seller` | the always-open house seller and its public record |

## Keeping these pages true

- When a module changes behaviour, update its page in the same change, and STATUS too.
- Cite only paths, types, commands and tests that exist (grep them). When STATUS and the code
  disagree, the code wins.
- Use the product's words for the UI (see the UX guide). Never name a vendor product. The engines
  are `claude-code` and `codex-cli`.
- Carry PayPal facts that are not sourced in `.research/` as **UNVERIFIED**.
