# Mirror

## The bet
The whole deal sits on one screen in the report's order, with the three sides side by side: Maya's mandate, the signed timeline and the counterparty. The columns are linked. Hovering an envelope lights the clause that checked it and the side that sent it.

## How a person uses it
1. Layer 1 shows the amount, state, money right now, the countdown, the state strip, and one decision row with its default on silence.
2. The columns list one line per item: each clause with its verdict, each envelope, and the counterparty facts as chips.
3. Layer 2 opens on demand. A clause or envelope opens a popover with the reason, signer, hash link and checks. Mandate, Details, the untrusted note and the four evidence indicators open sheets.
4. Withdraw and Export confirm in a sheet. Review hands off to the approval window.
5. Switch deals from the sidebar or the id menu. Esc goes back.

## What it does better than the other two
Nothing hides behind a key or a playhead, so a first-time owner or a judge sees all three sides at once. It is closest to `DealView.tsx`, so it is the cheapest to ship.

## Known limits
- At 1024 wide the columns drop to two.
- Hover links cover only the clauses named in an envelope's checks.
- The approval window and the PayPal events are simulated.
