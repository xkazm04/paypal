# Mandates: the rules the owner signs

A mandate is a set of rules the owner signs with their owner key for one of their agents. On screen it
is never called a mandate: it is "Shopper rules", "your signed rules", one card per agent. The rules
say what the agent may do, with whom, up to how much per deal and per day, at what price, to whom it
may pay, and above what amount it must ask them. Every agent intent and every money step is checked
against the rules in force before any network call; a refused intent never reaches PayPal. Rules
are versioned (a change is a new signed version), can be withdrawn (revoked) at any time, and can be
tried against last week's deals before signing (the what-if).

## What the owner sees

**Agent rules (`main`, Settings → Agent rules).** One card per signed rule set, named by its agent
("Shopper rules"), with the limits a person checks first as large lines ("up to $200 each", "asks
you above $250"), "active until 2 Nov" and Change. A header line counts them ("3 agents · 5 rule
sets"). Detailed lists every rule set; every rule, the version, the id and the agent key are one
popover away. A rule set the wallet no longer accepts shows: "This rule set no longer fits what the
wallet accepts, so its agent can't act under it. Sign it again or withdraw it." Change only hands
off to the approval window (`approval_open` with target `mandate`); nothing is signed in `main`.

**Rules editor (`approval`, owner configuration).** Consequences first:
- A pinned scoreboard: this week's deals under the rules in force and under the draft ("now →
  with your change"), and one line above Sign: "This version would have refused 1, asked you about
  2, allowed 6; 1 couldn't be checked."
- A switch between **Levers** (amount sliders whose tracks carry this week's deals as ticks
  coloured by the draft's answer, with a notch at the signed value) and **the week** (only the deals
  whose answer changes; unchanged ones fold).
- **Who and what**: the agent slot, validity, currency, and the set-type rules (roles, who they
  deal with, categories, payees, items), each a row that opens a popover.
- **Templates** on the first signature: "Careful: asks me above $50", "Shop assistant", "Haggler for
  one item". A template only fills a draft; payees and the haggler's item are asked inline and
  block signing until filled.
- **Sign sheet**: the diff, "In plain words", exactly what the window sends; the gold button is
  "Unlock with Windows Hello" while locked, then "Sign with your owner key". Review & sign is
  disabled while the draft has problems; a refusal shows in the editor's words.
- "Withdraw these rules" revokes the set; hovering it previews every line refused with "No rules in
  force".

**Band adjust (`approval`, deal review).** For a haggle before settlement, the owner can move the
price range for that deal's item; it signs a new version and moves the deal onto it. A warning
shows when a change clears the side of the range the deal needs.

Rule names (Layer 1) and clause numbers (Details only):

| # | Clause (`table_core::Clause`) | Name on screen | Notes |
| --- | --- | --- | --- |
| 1 | `Roles { roles }` (buy, sell, shop, rescue) | What agents may do | required |
| 2 | `Counterparties { rule }` (pinned keys, paired, house, subscribers) | Who they deal with | required |
| 3 | `PerDeal { kind, max_amount, categories }` | Limit per deal | required |
| 4 | `Band { item_refs, floor, ceiling, max_rounds, deadline }` | Price range | required for haggles and shop orders |
| 5 | `Velocity { max_deals_day, max_total_day }` | Daily limit | required |
| 6 | `HumanPresentOver { amount }` | Ask me above | required |
| 7 | `Payees { payees }` | Approved payees | required |
| 8 | `Lever { levers, max_discount_bp, max_discount }` | Fixes for failed renewals | rescue only |
| 9 | `MarketWatch { items, max_refreshes_day }` | Keep prices fresh | grants no money authority |

The owner's wallet-wide limits are a separate signed object (`WalletEnvelope`), reported as rule 0
("wallet limit") and set in the approval window; see [Approval window](./approval-window.md).

## How it works

1. **Drafting.** The editor holds owner-typed strings (`mandateDraft.ts`) and converts them exactly
   into `Clause` shapes; money is parsed from strings into minor units. Nothing is checked as
   authority in the window.
2. **What-if.** `mandate_simulate(MandateSimulateArgs { draft, from?, to? })`
   (`crates/table-runtime/src/simulate.rs`) builds the payload `mandate_sign` would sign
   (`draft_payload`), validates it, and replays each recorded deal's intent (rebuilt as the pipeline
   builds it) through `MandatePayload::check` for both the version in force and the draft. Default
   window: the last 7 days; at most 31. A deal missing a fact is `not_simulated`, never guessed. It
   writes nothing, signs nothing and calls no PayPal. The window debounces it by 400 ms.
3. **Signing.** `mandate_sign(MandateSignArgs { id?, agent, clauses, not_before, expires })`
   (approval label, token, unlocked) runs `Runtime::sign_mandate`
   (`crates/table-runtime/src/configuration.rs`): it allocates an id for a new set, takes the next
   version, pins the public key of the agent slot (negotiator, shopper, assistant) from the OS
   keychain, runs `validate()` (a refusal comes back as `REFUSED` with its reason), and signs the
   canonical payload with the owner key. `Ledger::insert_mandate` verifies the signature, requires
   exactly the next version, marks the previous active version superseded and appends one
   `mandate.signed` audit row, in one transaction.
4. **Validation at signing.** `MandatePayload::validate` (`crates/table-core/src/mandate.rs`) refuses
   missing or duplicate clauses, mixed currencies, roles that cannot act on the deal kind, a range
   missing the side the roles use, mandates that could never allow an intent, a fixes clause without
   the rescue role and the subscribers rule, and an invalid market-watch rule (1-20 items, 1-200
   checks a day).
5. **The check, before every network call.** `Wallet::mandate_check_rounds`
   (`crates/table-app/src/agent.rs`) reads the deal's mandate version with `active_mandate`
   (signature re-verified; only an active version), requires the deal's signer to be the mandate's
   pinned agent key, then calls `MandatePayload::check`: validity window, the role table, then each
   clause in number order. The answer is `Allow`, `Ask { clause: 6 }` (over "ask me above") or a
   `Refusal { clause, reason }`. Wallet limits are checked right after (`envelope_check`, money out
   only), and a rescue's offer is checked against clause 8.
6. **Who decides.** An intent the check allows is still not money: money steps are made by the Rust
   pipeline on one authority. Under the "ask me above" amount, a policy countersign by the rule is
   authority 2 (`decided_by: policy clause 6`); above it the deal waits for the owner in the
   approval window (authority 1). A refusal is recorded (`intent.refused`, or a deal moved to
   REFUSED with `decided_by: policy {clause}`) and makes no PayPal call. The agent receives the
   closed code `mandate_clause{clause}` with fixed text.
7. **Versions and deals.** A deal records the mandate id and version it runs under. `band_set`
   (selected deal, before settlement) signs a new version and rebinds that deal
   (`Ledger::rebind_mandate`); other deals on a superseded version fail closed until rebound. Sign
   and rebind are separate durable writes: a crash can stop a deal, never authorize it.
8. **Revoking.** `mandate_revoke(MandateRevokeArgs { id })` (approval label, token, unlocked) sets the
   active version to revoked and appends `mandate.revoked`. Deals under a revoked or superseded
   mandate get no new authority: they are left to their deadline's safe default, and the inbox
   rejects their messages once. A revoked mandate never freezes an open money step's safe default.
9. **Listing.** `mandate_list` (main, approval) returns each set with its agent slot after checking
   its commitment and owner signature. A set that today's `validate()` refuses is listed with that
   `refusal`, is never active, and can still be withdrawn.

## Safety properties

- **The LLM never signs rules.** `mandate_sign`, `mandate_revoke` and `band_set` are Owner tier,
  approval label, token and unlock (`crates/table-client/src/authority_table.rs`). No agent tool
  writes a mandate.
- **Checked before any network call.** Every agent intent and every pipeline money step passes the
  mandate check first; refused intents leave zero rows in `paypal_calls` (and a ledger trigger
  refuses PayPal rows for a REFUSED deal, `0002_integrity.sql`).
- **Signed versions are immutable.** `mandate_body_immutable` aborts any update of a version's body,
  hash, signature or key; versions only advance by one.
- **Fail closed.** A forged, tampered, retired or unreadable mandate refuses money; a signed set the
  rules now refuse is never active.
- **Rules can only restrict what limits allow.** Wide wallet limits never loosen a mandate; a market
  watch rule changes no answer.
- **Agents see codes, not the rules' text as instructions.** Refusals reach the agent as closed
  codes with fixed text.

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Domain (pure) | `crates/table-core/src/mandate.rs` | `Clause`, `CpRule`, `Role`, `MandatePayload`, `OpenMandate`, `validate`, `check`, `MandateDecision`, `Refusal`, `MAX_WATCHED_ITEMS`, `MAX_MARKET_CHECKS_DAY` |
| App | `crates/table-app/src/agent.rs` | `Wallet::check_mandate`, `mandate_check`, `mandate_check_rounds`, `envelope_check`, `select_signer` |
| Runtime | `crates/table-runtime/src/configuration.rs`, `simulate.rs`, `dispatcher.rs`, `service.rs` | `mandate_list`, `draft_payload`, `sign_mandate`, `band`, `mandate_simulate`, `mandate_retired` |
| Ledger | `crates/table-ledger/src/repositories.rs`; `migrations/0001_table.sql` (`mandates`), `0002_integrity.sql` (`closed_mandates`, `mandate_body_immutable`) | `insert_mandate`, `active_mandate`, `mandate_evidence`, `revoke_mandate`, `list_mandates`, `next_mandate_version`, `rebind_mandate` |
| Client, main | `apps/desktop/client/src/windows/main/setup/Mandates.tsx`, `setup/limits.ts` | `highlights`, `agentTitle`, `limitLines`, `setsLine` |
| Client, approval | `windows/approval/MandateEditor.tsx`, `mandateDraft.ts`, `BandAdjust.tsx`, `owner/WhoWhat.tsx`, `owner/Lever.tsx`, `owner/WhatIf.tsx`, `owner/SignSheet.tsx`, `owner/simulation.ts`, `owner/data.ts`, `templates.ts`, `owner/Templates.tsx` | `buildMandate`, `ruleProblems`, `refusalWords`, `useSimulation` |
| Words | `src/lib/words.ts`, `src/shared/honesty.tsx` | `RULE_NAME`, `RULE_NUMBER`, `ruleSentence`, `rulesName`, `NO_LONGER_FITS` |
| Bindings | `bindings/Clause.ts`, `MandatePayload.ts`, `MandateSignArgs.ts`, `MandateListEntry.ts`, `MandateRevokeArgs.ts`, `BandArgs.ts`, `MandateSimulation.ts`, `SimulatedVerdict.ts`, `Refusal.ts`, `AgentSlot.ts` | |

IPC commands (from `authority_table.rs`):

| Command | Windows | Tier | Token / unlock | Selection |
| --- | --- | --- | --- | --- |
| `mandate_list` | main, approval | read | no / no | any |
| `mandate_simulate` | approval | read | no / no | any |
| `mandate_sign` | approval | owner | yes / yes | any |
| `mandate_revoke` | approval | owner | yes / yes | any |
| `band_set` | approval | owner | yes / yes | selected deal |
| `approval_handoff` | approval | read | no / no | any (carries `main`'s band or floor draft) |

## Tests that pin it

- `crates/table-core/src/mandate.rs`: `missing_duplicate_or_conflicting_clauses_fail_closed`,
  `mandates_that_could_never_allow_an_intent_are_refused_at_signing`,
  `roles_that_cannot_act_on_the_kind_are_refused_at_signing`,
  `deadline_rounds_validity_and_human_boundary`, `band_floor_and_ceiling_property_style`,
  `mandate_commitment_covers_version_and_band_but_not_signature`,
  `a_market_watch_rule_grants_no_money_authority_and_changes_no_answer`.
- `crates/table-ledger/src/tests.rs`: `a_signed_mandate_todays_rules_refuse_is_listed_flagged_never_active_and_revocable`.
- `crates/table-runtime/src/tests.rs`: `signing_refuses_a_mandate_no_role_can_act_under`,
  `signing_a_mandate_needs_the_approval_label_and_its_token`,
  `signed_mandate_versions_revoke_and_band_only_change_selected_unsettled_deal`,
  `a_band_change_that_clears_the_only_bound_is_refused_and_nothing_moves`,
  `a_revoked_mandate_never_freezes_an_open_capture_past_its_deadline`.
- `crates/table-runtime/src/simulate_tests.rs`: `lowering_ask_me_to_fifty_turns_the_sixty_four_dollar_dock_into_a_question`,
  `simulating_writes_nothing_signs_nothing_and_calls_no_paypal`,
  `a_deal_under_the_rules_in_force_gets_the_verdict_the_live_pipeline_gives_it`.
- `crates/table-app/tests/pipeline.rs`: `shield_ask_stops_policy_and_a_revoked_mandate_stops_the_seller_before_network`;
  `crates/table-mcp/tests/server.rs`: `h1_m3_out_of_band_is_error_and_zero_paypal_rows`.
- `crates/table-runtime/src/limits_tests.rs`: `wide_wallet_limits_never_loosen_a_mandate`.
- Client: `windows/approval/mandateDraft.test.ts`, `windows/approval/templates.test.ts`,
  `windows/approval/owner/whatif.test.tsx`, `windows/approval/owner/diff.test.ts`,
  `windows/main/setup/limits.test.ts`, `src/mock/simulate.test.ts`.

## Known gaps and UNVERIFIED

- **One band per mandate.** Per-item floors for the shop need one seller mandate per floor group (a
  gap against design §10.5 "per-SKU floors"); the Counter hand-off carries one floor at a time.
- The what-if checks each payload at `max(now, not_before)`: validity dates are not replayed against
  the past. A seller deal under a draft naming other than exactly one payee is `not_simulated`.
  Main's "Clause trace" reuse of the what-if is not built.
- A new version governs only next actions; signing a higher floor withdraws live quotes below it.
  Both are builder readings, not design text.
- The rules editor's payees box shows the raw signed value "HOUSE" for the house seller; templates
  cannot prefill the real house seller's payee (a release-time pin not exposed to the window).
- `MAX_MARKET_CHECKS_DAY` (200) and `MAX_WATCHED_ITEMS` (20) are wallet guards, not market-service
  limits (UNVERIFIED as service limits).
- Settings and agent-rules tabs move with Tab rather than arrow keys.

## Related

- [Approval window](./approval-window.md) - where rules are signed, limits set and decisions taken.
- [Money pipeline](./money-pipeline.md) - authorities, policy countersign under clause 6, safe defaults.
- [Agents and engines](./agents-and-engines.md) - refusal codes and what agents see.
- [Tables and haggling](./tables-haggling.md), [Counter](./counter-shop.md), [Rescue](./rescue.md) - the rules each role runs under.
- [Proof and verification](./proof-and-verification.md) - how a signed mandate is checked in a proof file.
- Design: [`../design/the-table.html`](../design/the-table.html) §3 (the spine: Deal + Mandate), §8, §9, §10.6 (sign a mandate);
  [`../ux/UX-GUIDE.md`](../ux/UX-GUIDE.md) (rule names); build log [`../build/STATUS.md`](../build/STATUS.md)
  ("Incidental sweep", T12, T14, T15).
