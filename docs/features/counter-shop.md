# Counter (the owner's shop)

Counter is the owner's shop as other people's agents see it: buyers' agents place orders at it,
the owner's signed shop rules set the lowest price for each item, and money comes in when the
buyer approves the order on PayPal. Maya's question here is "is anyone buying, and is anything
selling below what I'd accept?". The seller side needs no click to receive money the buyer already
approved; it only asks the owner when the shop rules say so. This page also describes the house
seller from the buying owner's side: the always-open demo shop a new wallet can practice with.

## What the owner sees

**Main window, Counter page** (`apps/desktop/client/src/windows/main/modules/counter.tsx`):

- Header "Counter" with "Your shop · other people's agents buy here, never below your lowest
  prices", then a first-visit explainer: "Agents shop here", "Never below your price", "Buyers pay
  on PayPal".
- Live orders as cards: who, what, amount, state (seller words: "Waiting for buyer", "On hold",
  "Paid"), time left and the "If you do nothing" line. An order that needs the owner has one gold
  "Review & approve ↗" that opens the approval window, "the only place money can be released".
  An order being checked with PayPal shows a dashed "Checking with PayPal" chip and does not count
  as needing the owner.
- "Your lowest prices": the catalog as a plain list (item, lowest price, orders now). The lowest
  price is editable with a currency mark and ± steppers. An edit becomes an "Unsigned change" in a
  sticky draft bar ("Becomes version N of your shop rules"); its only exit is the approval window
  ("Opens the approval window, the only place your rules are signed"). If a live quote sits under
  the new price: "Your new lowest price is above this quote: signing the change withdraws it. No
  money moves." Esc with an unsigned draft warns once.
- Items the shop knows only by code show a quiet code tag (`itemWords()` gives a plain fallback
  name), never an invented catalog title. "Your shop's catalog is not connected yet, so list
  prices, stock and quotes can't be shown. Orders you already have still appear here."
- **Detailed** view: one dense line per order, the catalog ledger with filters (All, With orders,
  Above market, Changed) and a vs-market column (`vsMarket`, never across currencies). The
  Inspector shows the selected order or item; their words only through the quarantine chip.

**Approval window**: the shop-rules editor, prefilled with the drafted floor; the order review
(checklist, hold to confirm) when an order needs the owner.

**House seller, as a buyer** (main window): Tables' "Try the house seller" opens the connection
sheet on the house tab (`windows/main/setup/PairingDesk.tsx`). Waking and refusals are plain
words from Rust: "The house is full right now. No money moved.", "The house has hit its limit for
today. No money moved.", "The house turned this table down", or "The house is waking or could not
be reached" with "Try again; nothing is lost". On a receipted house deal, the proof tab carries a
"House seller's record" card (`houseRecordWord()` in `lib/words.ts`); a warning puts a chip on
"Proof from PayPal" ("The house's record got shorter since your receipt. No money moved. Keep your
signed proof…"). The name is always "House seller" (`houseWords()`), never all-caps.

## How it works

**Selling at the Counter** (a seller deal of kind `shop_order`, routed to Counter by `moduleOf` in
`windows/main/logic.ts`):

1. **Shop rules.** A seller mandate allows the Shop role, names `shop_order` in a per-deal clause
   and carries a price range whose floor is the lowest price; a haggle or shop order with no price
   range is refused ("band missing", clause 4, `crates/table-core/src/mandate.rs`). One shop-rules
   version holds one price range, so the Counter hands one changed floor at a time to the approval
   window (`approval_open` with target `mandate` and a `floor` draft); `mandate_sign` signs the new
   version there.
2. **Listing and agreement.** The shop lists to a paired buyer (`deal_create` queues a signed
   LISTING); offers and both ACCEPTs move it to AGREED. The wallet refuses inbound offers below
   its own floor.
3. **Order.** On an AGREED seller deal the scheduler creates the PayPal order under the "Ask me
   above" rule (`Authority::Policy`, clause 6) when the rules allow it
   (`crates/table-runtime/src/scheduler.rs`). Above that amount, or when the scam check says
   "check with you", the policy create is refused and the owner creates it with `deal_countersign`
   in the approval window.
4. **The buyer approves on PayPal.** The scheduler reads the seller's order back every 10 s while
   it waits.
5. **Money in, no click** (acceptance H5, report §6.5). Once PayPal shows the buyer approved, the
   seller authorizes and captures under its signed shop rules (`Authority::SellerMandate`, only on
   a seller deal in APPROVED or AUTHORIZED, `Pipeline::authority` in
   `crates/table-app/src/pipeline.rs`). `decided_by` records `seller_mandate` with the rules' hash;
   the receipt is signed and sent to the buyer.
6. **Silence.** An order the buyer never approves expires (PayPal's approval window,
   `ORDER_APPROVAL_SECS` = 6 h); a hold that is not captured is voided after 72 h. The Tumbler's
   "If you walk away" counts money in only for orders the buyer already approved.

**Buying from the house seller** (the hosted shop in `services/house-seller`; details in
[pairing-relay-house.md](./pairing-relay-house.md)):

1. `house_wake` wakes it; `pairing_join` with the house returns its signed practice table;
   `pairing_confirm` (approval window) pins it against the release pin.
2. The owner's agent haggles. The house concedes on a schedule (`Policy::decide_on_schedule`,
   `crates/table-core/src/negotiation.rs`): it accepts only at or above the price it would counter
   that round, moving from its ask to its floor over its rounds, so a floor bid is countered until
   the last round. It never goes below its floor.
3. On agreement the house creates, authorizes and captures under its own release-pinned mandate
   (`Authority::HouseMandate`: seller side, sandbox, quantity 1, digital delivery, rules allow).
   The buyer's only money step is approving on PayPal; the buyer's wallet makes no PayPal API call.
4. A house order not approved within 30 minutes lapses (`HOUSE_APPROVAL_SECS`) and frees one of
   the house's slots. The buyer's own safe default waits a 15-minute grace
   (`HOUSE_RECEIPT_GRACE_SECS`), and the house cuts its capture deadline so a stalled house voids
   rather than captures money the buyer's record would call lapsed.
5. After a house purchase is receipted, the buyer's wallet keeps the house's signed ledger head and
   re-checks it every 900 s (`crates/table-runtime/src/witness.rs`); `DealEvidence.house_record`
   reports kept / holds / longer / restarted / shorter / rewritten. It is evidence only: no state
   change, no money effect.

## Safety properties

- **Never below the lowest price.** The floor is in the signed shop rules; the agent, the policy
  negotiator and the house all stop at it, and the Counter itself cannot change it (only the
  approval window signs).
- **Money in needs no click, money out still does.** Seller-mandate authority exists only for a
  seller deal the buyer already approved; it is refused on create and on any buyer step.
- **The scam check still applies.** One gate, `shield_allows` in `pipeline.rs`: HOLD and BLOCK stop
  every step; "check with you" lets the seller's authorize and capture through but not a policy
  create.
- **The house is boxed in.** House authority requires the release-pinned mandate commitment and
  the release payee; a house deal is sandbox only.
- **Their words stay data**: buyer notes only in quarantine, never in the Tumbler.
- **Silence never moves money out**; for a seller, silence lets an order expire or a hold release.

## Where it lives

| Layer | Path | Key items |
|---|---|---|
| Domain | `crates/table-core/src/mandate.rs` | `Role::Shop`, `Clause::Band` (floor), band-missing refusal |
| Domain | `crates/table-core/src/negotiation.rs`, `deal.rs` | `Policy::decide`, `Policy::decide_on_schedule`, `ORDER_APPROVAL_SECS`, `HOUSE_APPROVAL_SECS`, `HOUSE_RECEIPT_GRACE_SECS` |
| Pipeline | `crates/table-app/src/pipeline.rs` | `authority` (`Policy`, `SellerMandate`, `HouseMandate`), `shield_allows` |
| Runtime | `crates/table-runtime/src/scheduler.rs`, `pairing.rs`, `witness.rs` | seller create and collect, house refusal words, house head witness |
| Ledger | `crates/table-ledger/src/witness.rs`, `migrations/0010_house_heads.sql` | kept house heads (append-only) |
| Service | `services/house-seller/` | hosted house seller, signed ledger, scoreboard |
| Client | `apps/desktop/client/src/windows/main/modules/counter.tsx`, `counter/model.ts` | page, `buildCatalog`, `draftImpact`, `vsMarket`, `currencyMark` |
| Client | `apps/desktop/client/src/windows/main/setup/PairingDesk.tsx`, `src/lib/words.ts` | house connection, `houseWords`, `houseRecordWord` |

IPC commands (rows in `crates/table-client/src/authority_table.rs`):

| Command | Windows | Tier | Token + unlock | Selected deal |
|---|---|---|---|---|
| `list_deals`, `deal_evidence` | main | read | no | any |
| `deal_display` | all | read | no | in approval |
| `mandate_list` | main, approval | read | no | any |
| `approval_open` | main, tumbler | ui | no | any |
| `mandate_sign` | approval | owner | yes | any |
| `deal_countersign`, `deal_capture`, `deal_void` | approval | decision | yes | required |
| `house_wake`, `pairing_join` | main | act | no | any |
| `pairing_confirm` | approval | owner | yes | any |
| `counterparty_list` | main, approval | read | no | any |

## Tests that pin it

- `h5_the_seller_takes_money_in_on_the_buyers_approval_with_no_click`,
  `the_sellers_create_on_policy_still_asks`, `a_payee_mismatch_blocks_and_nothing_moves`,
  `a_fresh_price_hold_stops_the_sellers_authorize_and_ageing_never_lifts_it`
  (`crates/table-runtime/src/h5_tests.rs`)
- `the_shield_gate_matrix_pins_h5_and_step_allowed_agrees_with_every_real_step`
  (`crates/table-app/tests/pipeline.rs`)
- `an_unpriced_seller_order_forecasts_money_in_and_a_real_tick_agrees`
  (`crates/table-runtime/src/forecast_tests.rs`)
- `seller_policy_concedes_from_ask_toward_floor_and_never_below`,
  `house_schedule_counters_a_floor_bid_until_the_last_round_and_never_goes_below`
  (`crates/table-core/src/negotiation.rs`)
- `h6_fresh_wallet_pairs_house_and_closes_through_in_process_relay_with_mock_paypal`
  (`crates/table-runtime/src/relay_tests.rs`)
- `house_unapproved_deal_lapses_after_thirty_minutes_and_frees_its_slot`,
  `house_approval_in_its_last_minute_ends_receipted_on_both_sides`,
  `house_full_daily_limit_refusal_and_silence_reach_the_wallet_in_plain_words`
  (`crates/table-runtime/src/house_tests.rs`)
- `buyer_keeps_the_house_head_with_the_receipt_and_flags_a_shrinking_record_without_moving_money`
  (`crates/table-runtime/src/glass_tests.rs`)
- Client: `windows/main/modules/counter/model.test.ts`, `src/lib/houseRecord.test.tsx`

## Known gaps and UNVERIFIED

- **No catalog.** List price, stock, listing details and quotes before checkout are not connected
  (shop/catalog/feed/CSV deferred, STATUS B7/P4). Items are known only from the shop rules and
  orders.
- No screen opens a listing or joins the house practice table: `deal_create` and `deal_join` have
  no client caller.
- One floor per hand-off: a draft that changes several prices goes to the approval window one at a
  time.
- A wallet seller refuses below-floor offers rather than countering them (only the house counters).
- House floor: the house publishes its signed mandate with its floor, so a patient agent still
  reaches the floor after the house's rounds; selective disclosure is T13 (not built).
- During the house grace a buyer deal can show a passed deadline for up to 15 minutes; a capture
  confirmed only after the grace can still leave the buyer EXPIRED.
- UNVERIFIED: live two-account seller AUTHORIZE approve/authorize/capture (spike 3);
  `RECEIPT_DELIVERY_SECS` (120 s) is a chosen budget; hosted house deployment and cold start.

## Related

- [tables-haggling.md](./tables-haggling.md), [spend-purchases.md](./spend-purchases.md),
  [shield.md](./shield.md), [book.md](./book.md)
- [pairing-relay-house.md](./pairing-relay-house.md), [money-pipeline.md](./money-pipeline.md),
  [mandates-and-rules.md](./mandates-and-rules.md), [approval-window.md](./approval-window.md),
  [tumbler-and-attention.md](./tumbler-and-attention.md)
- Design: [capability 3](../design/the-table.html#cap-3), [Counter module](../design/the-table.html#m-3),
  [§6.5 settlement](../design/the-table.html#h-settle), [§6.8 house seller](../design/the-table.html#h-house)
- Build log: [STATUS.md](../build/STATUS.md) ("H5 seller money in", T9, "Council open items"),
  [DECISIONS.md](../build/DECISIONS.md) §9
