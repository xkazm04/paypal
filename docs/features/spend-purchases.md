# Spend (agent purchases)

Spend is where an agent asks to buy something for the owner from a shop the owner connected. The
agent can only propose: the wallet checks the proposal against the rules the owner signed and the
wallet-wide limits, and a proposal that passes waits for the owner. Every PayPal step of a purchase
(creating the order, putting the money on hold, paying) is the owner's decision in the approval
window; silence lets it lapse. The page answers Maya's question "did my agents buy anything I need
to look at?" and shows, per purchase, which rule let it through or stopped it. This page also
covers the wallet limits: one owner-signed cap above every agent's rules.

## What the owner sees

**Main window, Spend page** (`apps/desktop/client/src/windows/main/modules/spend.tsx`):

- An answer bar, then a first-visit explainer: "Agents ask to buy", "Your rules check it",
  "You pay or release".
- A decision card per purchase that needs the owner. The one gold option hands off to the
  approval window: "Review ↗" for a cleared purchase, "Review & pay ↗" for one on hold. Quieter
  options: "Release hold…" ("Gives the money back"), "Let it lapse" ("It lapses at its deadline
  and nothing is paid"), "Withdraw" ("Cancels the purchase. No money moves.").
- "This week": one plain line per purchase with the rules' verdict: "Passed your rules",
  "Over the per-deal limit ($200.00)", or "Stopped by your … rule". A refused purchase says
  "PayPal was never asked, so there is nothing to undo."
- With no rules covering purchases: "No signed rules cover purchases, so every agent purchase is
  refused before PayPal is asked."
- **Detailed** view, "the gate" (`modules/spend/gate.ts`): one lane per purchase, running left to
  right through the signed rules as columns (Allowed, Per purchase, Daily limit, Ask me, Payees)
  toward PayPal. Each cell is passed, "Asks you", refused, not applicable, or dashed "Not known"
  when the wallet recorded nothing for it (never drawn as passed). The Daily limit column carries
  a meter "Spent today against your daily limit".

**Wallet limits** appear outside the Spend page: the approval window's owner configuration has a
"Wallet limits" card (three rows with today's meters and a change sheet with one gold button,
`windows/approval/owner/WalletLimits.tsx`); Home's "Today", the title-bar meter and the Tumbler
stack show paid out today and on hold now against the limits (gold at 4/5); "No wallet limit"
when none are signed; expired or unverified limits get a gold line (`src/lib/limits.ts`).

**Approval window**: the purchase review with the six-line checklist (amount, payee, payment page
host, invoice number, scam check, rules), then a hold-to-confirm button for the step the deal is
at. **Tumbler**: a purchase on hold is a gate card ("Capture or void $64.00") with its silence line.

## How it works

1. **The deal exists first.** A purchase is a buyer deal of kind `purchase` with one item line,
   opened by the owner under rules for the Shopper role (`deal_create`, approval window). A
   mandate with no price range still gets a deadline: 24 hours (`PURCHASE_DECISION_WINDOW_SECS`
   in `crates/table-runtime/src/service.rs`, DECISIONS §8).
2. **The agent proposes.** The Shopper calls `propose_purchase` (payee, one line with item and
   quantity, amount, category); it may read `market_reference` first
   (`prompts/shopper.md`). `crates/table-app/src/agent.rs` checks the role, kind, category, payee
   and that the amount equals quantity × the deal's price, then runs the mandate check
   (roles, counterparty, per-deal limit, daily limit, payees) and the wallet limits
   (`Wallet::envelope_check`).
3. **Refused:** one `intent.refused` audit row, the deal goes REFUSED with the clause that refused
   it (`decided_by: Policy{clause}`; clause 0 for the wallet limits), and PayPal is never called.
4. **Cleared:** `Ledger::propose_purchase` applies `DealEvent::PurchaseCleared` (PAIRING to
   AGREED) and writes one `purchase.proposed` row in the same transaction. No order is created:
   the scheduler never starts one for a purchase. From this moment the purchase counts in the
   daily budget and the wallet limits until it is withdrawn or lapses (DECISIONS §4).
5. **Owner, step by step, in the approval window** (`Runtime::decide` in `service.rs`; each
   decision rechecks label, token, unlock, terms, attempt, rules, scam check and the checklist
   hash, then writes one `owner.decision` row before the money step):
   - `deal_countersign` on AGREED creates the PayPal order (intent AUTHORIZE, invoice id
     `<deal>-1`, one request id);
   - `open_paypal_in_browser` opens PayPal's approval page; the owner approves there as a buyer;
     the scheduler reads the order back and moves the deal to APPROVED;
   - `deal_countersign` on APPROVED authorizes: the money is on hold at PayPal;
   - `deal_capture` pays, or `deal_void` releases the hold.
   `Authority::Policy` is refused for every purchase step (`Pipeline::authority`,
   `crates/table-app/src/pipeline.rs`), so clause 6 never pays for a purchase, whatever the amount
   (DECISIONS §3).
6. **Silence.** A cleared purchase lapses to WITHDRAWN at its deadline; an unapproved order
   EXPIRES; a hold left alone is voided 72 hours after authorize. Nothing is paid by default.

**Wallet limits** (`crates/table-core/src/exposure.rs`):

- `fold_exposure` computes per currency, money out only (buyer deals): paid today, held now
  (AUTHORIZED), committed now (AGREED through APPROVED), out today and deals today. A deal's day
  is the day it first agreed, as for the per-rules daily limit. Seller deals and released states
  never count.
- `WalletEnvelope { version, currency, max_out_day, max_held, max_deals_day, expires }` is signed
  by the owner key over a domain-separated payload (`envelope_sign`, approval window, privileged).
  Its `check()` only refuses: deals today at the cap, out today plus this amount over
  `max_out_day`, held plus committed plus this amount over `max_held`, an expired envelope, or a
  different currency.
- The check runs inside `mandate_check_rounds`, right after the rules, so agent intents, the
  owner's accept, opening PayPal and every money step are covered before any write or call.
  Wider wallet limits never loosen a mandate.

## Safety properties

- **The agent never pays.** It has `propose_purchase` and `market_reference` only; no tool creates,
  approves, captures or voids.
- **Every purchase money step is the owner's.** Policy authority is refused for purchases before
  any countersign row, reservation or network call; each owner decision is bound to the checklist
  it was taken on (`checks_hash`).
- **Refusals leave nothing at PayPal**: zero `paypal_calls` rows, one audit row.
- **Limits fail closed.** A stored envelope that fails its body, commitment or signature check
  refuses money out; it never reads as "no limit". `wallet_envelopes` is append-only (update and
  delete abort triggers, migration `0009_wallet_limits.sql`), and each signing writes one
  `wallet_limit.signed` audit row.
- **Money is never converted or added across currencies**; one envelope has one currency.
- **Silence never pays.** Every deadline default withdraws, expires or voids.

## Where it lives

| Layer | Path | Key items |
|---|---|---|
| Domain | `crates/table-core/src/deal.rs` | `DealKind::Purchase`, `DealEvent::PurchaseCleared` |
| Domain | `crates/table-core/src/exposure.rs` | `fold_exposure`, `exposure_for_deal`, `WalletEnvelope`, `ENVELOPE_CLAUSE` |
| Domain | `crates/table-core/src/mandate.rs` | `Clause::PerDeal`, `Velocity`, `HumanPresentOver`, `Payees` |
| Agent tools | `crates/table-app/src/agent.rs`, `crates/table-mcp/src/lib.rs`, `prompts/shopper.md` | `propose_purchase`, `market_reference`, `Wallet::envelope_check` |
| Pipeline | `crates/table-app/src/pipeline.rs` | `Pipeline::authority` (no Policy on a purchase), create / authorize / capture / void |
| Runtime | `crates/table-runtime/src/service.rs`, `limits.rs`, `scheduler.rs` | `decide`, `PURCHASE_DECISION_WINDOW_SECS`, approval read-back |
| Ledger | `crates/table-ledger/src/repositories.rs`, `limits.rs` | `propose_purchase`, `insert_wallet_envelope`, `active_wallet_envelope` |
| Migration | `crates/table-ledger/migrations/0009_wallet_limits.sql` | `wallet_envelopes` + triggers |
| Client | `apps/desktop/client/src/windows/main/modules/spend.tsx`, `spend/gate.ts` | page, the gate |
| Client | `apps/desktop/client/src/lib/limits.ts`, `windows/approval/owner/WalletLimits.tsx` | meters, limits card |

IPC commands (rows in `crates/table-client/src/authority_table.rs`):

| Command | Windows | Tier | Token + unlock | Selected deal |
|---|---|---|---|---|
| `list_deals`, `deal_evidence` | main | read | no | any |
| `deal_withdraw` | all | act | no | in approval |
| `deal_let_lapse` | main, tumbler | act | no | any |
| `deal_snooze` | tumbler | act | no | any |
| `deal_create` | approval | owner | yes | any |
| `deal_countersign`, `open_paypal_in_browser`, `deal_capture`, `deal_void` | approval | decision | yes | required |
| `envelope_sign` | approval | owner | yes | any |
| `envelope_get` | main, tumbler, approval | read | no | any |

## Tests that pin it

- `a_cleared_purchase_waits_at_agreed_with_zero_paypal_rows`,
  `one_purchase_proposal_writes_exactly_one_audit_row_and_the_chain_verifies`,
  `a_purchase_never_runs_on_policy_and_the_owner_path_captures_it` (`crates/table-app/tests/pipeline.rs`)
- `f2_a_purchase_authorizes_after_approval_captures_after_its_countersign_or_voids`
  (`crates/table-app/tests/gauntlet.rs`)
- `f1_purchase_refusal_leaves_zero_paypal_rows` (`crates/table-mcp/tests/server.rs`)
- `a_purchase_without_a_band_lapses_after_a_day_and_a_band_deadline_still_wins`,
  `a_tick_never_starts_an_order_for_a_cleared_purchase` (`crates/table-runtime/src/tests.rs`)
- `a_purchase_step_on_policy_is_still_refused` (`crates/table-runtime/src/h5_tests.rs`)
- `no_sequence_of_deals_across_mandates_exceeds_the_envelope` (property test,
  `crates/table-core/src/exposure_tests.rs`)
- `forged_or_tampered_limits_never_read_as_none` (`crates/table-ledger/src/limits_tests.rs`)
- `the_wallet_limit_refuses_the_third_purchase_across_mandates_before_any_paypal_call`,
  `wide_wallet_limits_never_loosen_a_mandate`,
  `expired_or_forged_limits_refuse_money_out_and_never_money_in` (`crates/table-runtime/src/limits_tests.rs`)
- Client: `windows/main/modules/spend/gate.test.ts`, `src/lib/limits.test.ts`, `src/mock/exposure.test.ts`

## Known gaps and UNVERIFIED

- **The browser preview contradicts the code on who paid.** The mock's purchase history
  (`apps/desktop/client/src/mock/fixtures.ts`, the `purchase` helper and `decided: POLICY6` on
  D-0183, D-0186, D-0190) shows purchase orders, holds and captures decided by "your signed rule"
  (clause 6). Rust refuses Policy authority for every purchase step; in the real wallet these are
  the owner's decisions. The preview's Rewind and "Who decided" therefore overstate what a rule can
  do for a purchase.
- No screen opens a purchase deal: `deal_create` has no caller in the client.
- One pre-existing item line per purchase; catalog search, quotes and multi-line checkout are
  deferred (STATUS, B6/P3).
- Opening a buyer deal is not checked against the wallet limits (`create_deal` checks the rules
  directly); the first limit check is the agent's intent or a money step.
- Wallet limits: one currency per envelope (another currency is refused); "Most on hold at once"
  counts held plus agreed-and-waiting money; no "after this: $X of $Y today" line on a decision;
  Book metrics do not yet read the same fold; `meters_available` stays false.
- The native shell handlers for the limit commands compile only on Windows; not checked here.
- UNVERIFIED live: an order created from the owner's own app with an explicit payee, then captured
  or voided, and its approval by a second sandbox account (spikes 4 and 3 in
  [SPIKES.md](../build/SPIKES.md)); the 6 h `PayPal-Request-Id` store for Payments v2 capture and
  void (the research states it for Orders v2 only).

## Related

- [tables-haggling.md](./tables-haggling.md), [shield.md](./shield.md), [book.md](./book.md),
  [counter-shop.md](./counter-shop.md)
- [approval-window.md](./approval-window.md), [money-pipeline.md](./money-pipeline.md),
  [mandates-and-rules.md](./mandates-and-rules.md), [agents-and-engines.md](./agents-and-engines.md)
- Design: [capability 1](../design/the-table.html#cap-1), [Spend module](../design/the-table.html#m-1)
- Build log: [STATUS.md](../build/STATUS.md) ("Spend firewall", T14),
  [DECISIONS.md](../build/DECISIONS.md) §3, §4, §8
