# Shield (scam checks)

The Shield checks every payment for scam signs before PayPal is asked, and again at each money
step. Its rules are deterministic and run on typed facts only, never on what the other side wrote.
A check can only make a payment safer: it can stop a payment or ask the owner, never approve one.
A paused payment ("Paused for you") waits until the owner releases it in the approval window or its
deadline lets it lapse; a blocked payment ("Blocked") can never be released. Every refusal is
recorded once, with the rule that decided it. The page answers Maya's question "did anything
suspicious happen?".

## What the owner sees

Verdict words (UX-GUIDE): CLEAR "Looks safe", ASK "Check with you", HOLD "Paused for you",
BLOCK "Blocked". Rule words come from `shieldRuleWord()` in `apps/desktop/client/src/lib/words.ts`:
"Different payee", "Friends & family", "No usual price", "Price far above usual", "New payee,
large amount", "A second look".

**Main window, Shield page** (`apps/desktop/client/src/windows/main/modules/shield.tsx`):

- "Checks every payment for scam signs before PayPal is asked", an answer bar ("All quiet. Nothing
  suspicious happened."), and a first-visit explainer: "New payees get checked", "Odd prices pause
  it", "Only you can unpause".
- A decision card per paused payment, its reasons as plain lines with icons, "What's normal vs
  this payment", three check lights (a quiet check reads "No alert" / "Didn't stop it" / "Not
  reported", dashed, never green) and a Why? on each reason (`modules/shield/Panels.tsx`,
  `shield/normal.ts`). Options: "Review & release ↗" (opens the approval window, where the payee's
  name is typed), "Keep it paused", "Refuse…" ("Cancels it for good. No money moves and PayPal is
  never asked."), "Open deal ›".
- "Stopped" payments one line each; "Blocked for good" with "No button anywhere can release a
  block, and no PayPal link was ever opened."; payments the owner let go on fold into "You let these
  go on" ("for these terms only. A change to the deal is checked again.").
- "Their messages" only as quarantined plain text (`NoteChip`), never acted on.
- **Detailed** view: an evidence matrix with each payee a column, outcome rows on top and the
  checks below (`shield/matrix.ts`); arrows move the cursor, O opens the deal, R hands a pause to
  the approval window, P shows only the outcome.

**Deal page**: a live HOLD asks "Let this $X payment to Y go ahead?" with the gold "Review &
release" hand-off. **Tumbler**: a HOLD card names the rule; never the other side's words.

**Approval window**: the release review. The scam-check line of the Rust-composed checklist fails
while the hold stands (the release is exempt for that line only); the owner types the payee's name
exactly ("Type the name exactly as shown to unpause.") and holds to confirm. As the Shield page
says: "Releasing doesn't pay: you still approve the payment on PayPal after."

## How it works

1. **The rules, in order; the first that trips decides** (`table_shield::explain`,
   `crates/table-shield/src/lib.rs`):
   1. the payee PayPal would pay differs from the agreed payee: **BLOCK** `payee_mismatch`;
   2. a friends-and-family request: **BLOCK** `friends_and_family`;
   3. no market reference: **ASK** `no_market_reference`;
   4. the unit price is over 1.4 × the market median, whatever the reference's age: **HOLD**
      `price_over_market`;
   5. the reference is stale (older than 900 s): **ASK** `no_market_reference` (a stale price can
      hold a deal but never clear it);
   6. a counterparty first seen in the last 24 hours asking for more than 10000 minor units:
      **ASK** `new_counterparty_over_threshold`;
   7. otherwise **CLEAR**.
   A rescue deal (the owner's own subscriber paying the owner) is judged only by a verdict raised
   on the deal.
2. **A second opinion can only add caution.** `table_shield::evaluate` and `combine` take the
   stricter of the rules and an optional model verdict, and a BLOCK skips the model entirely. A
   raised verdict is recorded as `model_caution`.
3. **It runs at every money step.** `Pipeline::shield_step` (`crates/table-app/src/pipeline.rs`)
   runs inside create, authorize and capture, after the authority check, and records the result
   with `Ledger::record_shield`: `deals.shield_verdict`, `shield_rule` and `shield_terms`, plus one
   audit row only on change (`shield.raised` for HOLD or BLOCK, `shield.checked` for CLEAR or
   ASK). HOLD, BLOCK and raised verdicts are kept as a floor; a computed ASK is not kept, so a later
   fresh price can still clear; a verdict computed for older terms is not used, so a terms change
   is judged again.
4. **The order check.** When PayPal's order names a different `payee.merchant_id`,
   `raise_payee_mismatch` raises BLOCK `payee_mismatch` before the deal goes to MISMATCH.
5. **One gate for every authority** (`shield_allows`): CLEAR passes; ASK passes the owner's
   decision and the house mandate, and the seller mandate only for authorize and capture (money in
   the buyer already approved, report §6.5); ASK refuses the clause-6 policy. HOLD and BLOCK stop
   every step under every authority. A void is never stopped.
6. **A refusal is recorded once.** `Ledger::record_shield_refusal` writes one `shield.refused` row
   per deal, step, verdict, rule and terms hash, with no operation, countersign or `paypal_calls`
   row. The scheduler treats it as waiting for the owner, not a fault, and
   `AttentionItem.shield_rule` puts the rule on the card. An agent's offer on a held table is
   refused `shield_hold{rule}`.
7. **Release, owner only, in the approval window** (`shield_release`, privileged, selected deal,
   checklist hash). `Pipeline::owner_release_hold` releases only a HOLD whose holding rules are all
   named, stored as `shield_release_json {terms_hash, rules, at}` with `decided_by` human and one
   `shield.released` row. The gate honours it only for that terms hash and only while it names
   every holding rule; a terms change, another rule or a new raised HOLD or BLOCK holds again. A
   BLOCK release is refused. While released, `Deal.shield` reads ASK; paying still needs its own
   decision.
8. **Silence.** A held payment waits for its deadline default: an open deal is withdrawn, an
   unapproved order expires, and a hold at PayPal is voided 72 hours after authorize. Nothing is
   paid.

## Safety properties

- **Checks run on typed facts only.** `ShieldRule` is a closed enum; no rule reads counterparty
  free text, and their notes are shown only in quarantine in the main window.
- **A check can only tighten**: `combine` takes the maximum; a BLOCK is final.
- **A block is never lowered or released**, enforced twice: in Rust and by triggers in migration
  `0013_shield_record.sql` (`deals_block_stays`, `deals_block_never_released`).
- **A release is bound** to the terms hash and the rules it names, and only the approval window
  can give it (token, label, unlock).
- **A refused step moves nothing**: no PayPal call, no operation, no countersign; one audit row.
- **The proof file checks it**: the v2 `shield` check fails a non-void money step taken while a
  BLOCK or an unreleased HOLD held those terms (see [proof-and-verification.md](./proof-and-verification.md)).

## Where it lives

| Layer | Path | Key items |
|---|---|---|
| Domain | `crates/table-core/src/deal.rs` | `ShieldVerdict`, `ShieldRule` |
| Rules | `crates/table-shield/src/lib.rs` | `Case`, `explain`, `rules`, `combine`, `evaluate` |
| Domain | `crates/table-core/src/market.rs` | `MarketRef::over_forty_percent`, `MARKET_FRESH_SECS` |
| Pipeline | `crates/table-app/src/pipeline.rs` | `shield_allows`, `shield_step`, `shield_sources`, `raise_payee_mismatch`, `owner_release_hold` |
| Ledger | `crates/table-ledger/src/shield.rs` | `record_shield`, `raise_shield`, `release_shield_hold`, `record_shield_refusal` |
| Migration | `crates/table-ledger/migrations/0013_shield_record.sql` | `shield_rule`, `shield_terms`, `shield_release_json`, block triggers |
| Client | `apps/desktop/client/src/windows/main/modules/shield.tsx`, `shield/` | page, `matrix.ts`, `normal.ts`, `Panels.tsx`, `NoteChip.tsx` |
| Client | `apps/desktop/client/src/windows/approval/gating.ts` | `releaseHold` gate, typed-name match |
| Client | `apps/desktop/client/src/lib/words.ts` | `shieldWord`, `shieldRuleWord`, `shieldReleased`, `CHECK_QUIET` |

IPC commands (rows in `crates/table-client/src/authority_table.rs`):

| Command | Windows | Tier | Token + unlock | Selected deal |
|---|---|---|---|---|
| `list_deals` | main | read | no | any |
| `counterparty_note` | main | read | no | any |
| `counterparty_list` | main, approval | read | no | any |
| `attention_list` | all | read | no | any (approval sees its own deal) |
| `deal_withdraw` ("Refuse…") | all | act | no | in approval |
| `approval_open` | main, tumbler | ui | no | any |
| `shield_release` | approval | decision | yes | required |

## Tests that pin it

- `s1_payee_blocks_without_engine_and_no_reference_never_passes`,
  `a_stale_market_can_hold_a_deal_but_never_clear_it`,
  `every_verdict_names_the_rule_that_decided_it_in_the_shields_order` (`crates/table-shield/src/lib.rs`)
- `a_computed_verdict_is_recorded_once_with_its_rule_and_a_terms_change_judges_again`,
  `a_release_covers_its_terms_and_rules_only_and_a_block_is_never_released_or_lowered`,
  `a_released_raised_hold_does_not_hide_a_new_hold_for_another_rule`
  (`crates/table-ledger/src/shield_tests.rs`)
- `the_shield_gate_matrix_pins_h5_and_step_allowed_agrees_with_every_real_step`,
  `a_shield_refusal_is_recorded_once_per_step_and_verdict_and_moves_nothing`,
  `a_released_second_opinion_hold_is_no_silent_ask_and_a_block_has_no_release`
  (`crates/table-app/tests/pipeline.rs`)
- `a_released_price_hold_lets_the_approved_order_in_as_the_owners_decision`,
  `a_payee_mismatch_blocks_and_nothing_moves` (`crates/table-runtime/src/h5_tests.rs`)
- `a_shield_hold_stops_an_offer_naming_its_rule` (`crates/table-mcp/tests/server.rs`)
- Client: `windows/main/modules/shield/rule.test.ts`, `shield/matrix.test.ts`, `shield/normal.test.ts`

## Known gaps and UNVERIFIED

- **The second opinion has no production caller.** No LLM runs inside the wallet today, so
  `model_caution` is only recorded when something raises it. The Shield page still describes it
  ("The AI second opinion reads a payee's message as plain data, once, with no tools…" in
  `shield.tsx`); that text describes a source that is not wired. `prompts/shield.md` is a stub.
- `friends_and_family` has no typed protocol source, so that rule cannot trip on a real deal yet.
- The "New payee, large amount" words say "more than 100.00", but the threshold is 10000 minor
  units in the deal's currency (`pipeline.rs`), so for a zero-decimal currency it is 10,000 units.
- A computed HOLD stays held for its terms and does not lift on a market refresh without the owner.
  A HOLD recorded when capture is refused on an AUTHORIZED deal waits for the owner or the 72 h
  auto-void.
- The Shield page's "Stopped" group still counts a released deal; the mock files D-0198's card
  under Shield where Rust says Spend.
- Native GUI not run for the release flow.

## Related

- [spend-purchases.md](./spend-purchases.md), [counter-shop.md](./counter-shop.md),
  [tables-haggling.md](./tables-haggling.md), [book.md](./book.md)
- [approval-window.md](./approval-window.md), [money-pipeline.md](./money-pipeline.md),
  [tumbler-and-attention.md](./tumbler-and-attention.md), [proof-and-verification.md](./proof-and-verification.md)
- Design: [capability 7](../design/the-table.html#cap-7), [Shield module](../design/the-table.html#m-7),
  [trust model](../design/the-table.html#trust)
- Build log: [STATUS.md](../build/STATUS.md) ("H5 seller money in", "Shield slice 2",
  "Second review fixes"), [DECISIONS.md](../build/DECISIONS.md) §9
