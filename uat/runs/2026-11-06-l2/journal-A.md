# L2 journal - pass A (live, headless Chrome on the mock backend, 2026-11-06)

Voices are appended per Character (they do not replace the L1 voices in `uat/runs/2026-11-06-l1/`). Evidence quotes live in `findings-A.json`; screenshots in `shots/A/`.

## Maya (shop owner)
Journeys: first-run-onboarding partial | sign-rules partial | gated-spend-approval L2-pass | haggle-and-watch L2-pass | subscription-rescue partial | counter-shop-and-wallet partial

"The money screens are the best part and I felt it live. I held Space on the $64 dock and it paid; I hit Enter and it told me, in a sentence, why Enter will not move my money. Watch the haggle showed me exactly where my own wallet said no to Dan's $329 and never showed me his side. That is what I want from something that touches my PayPal.

Then I opened the rules editor and met a numbered legal schedule: 1, 2, 3, 7 down the left of every line. Why seven? Nobody tells me. The what-if opens empty ('No deal this week would have gone differently') until I move something, then says '2 deals would have gone differently' about two deals that were refused before and refused after. I would not trust that sentence twice. On Rescue the one lever I can pull is a discount; the other three are 'not offered for this renewal', which is not true, they are just not built. And the same failed renewal says on one screen 'PayPal has nothing to retry' and on the next 'PayPal retries by itself'. On my own wallet it says '4 of 5 lines signed' forever because the agent app 'isn't connected' while the header says claude-code. I would use it for approvals today and keep reading the rules with a pen."

## Tomasz (power owner)
Journeys: sign-rules partial | counter-shop-and-wallet L2-fail on the hand-off

"I drafted four lowest prices in Counter, pressed Review & sign, and the approval window had one: DP cable to $15. The other three were still in my draft, but nothing told me the signing covers one item. That is a bulk workflow that silently works at 25%. Separately I widened a daily limit to $1,500 over a wallet that caps me at $1,000 a day and the editor, the what-if and the sign sheet all kept quiet about the cap; I would sign a limit that cannot bind and never know. At eight rule sets there is no search or sort (the Spend list at 120 rows has both), and two sets carry the same title. The market band tells me when it was checked but not from where. The gold discipline is real: I could not find two golds in one view."

## Priya (bookkeeper)
Journeys: book-and-proof partial

"I exported the week in two clicks and the totals tie: paid out 83.00 = 45 + 38, paid in 27.50, stopped 13,564 to the cent. The CSV is honest about what it does not know ('unknown', 'n/a', 'pending'), but it has no fee, no net, no decider, no record hash and no authorization id, and three of eight money rows read 'unknown' for the statement right after load. The 'stopped' tile adds refused offers and withdrawn negotiations into one big number I would not post. I changed a price in the signed proof and the checker said 'This file does not check out, caught by The seal', which is the right answer, but nine of its sixteen lines were dashed even for the clean file, and the tamper message says the lines above tell me what changed when the price lines are exactly the dashed ones. Useful as a trail, not yet as a ledger."

## Lena (subscription manager)
Journeys: subscription-rescue partial

"One fix, a discount, and I can see exactly what the customer will read before it goes: that part is good. I cannot see what it costs me: 20% off, $9.60 instead of $12.00, never 'you give up $2.40'. 'Recovered money $9.00' is all-time, no month. The customer is 'subscriber S-14' with a masked email and no history of how often they failed. And the same replay renewal says 'PayPal has nothing to retry' in the list and 'PayPal retries in 3 days 23 h' on the deal page. I could not test roles or the 20-subscription cap on the mock."

## Omar (first-time owner)
Journeys: first-run-onboarding partial | sign-rules L2-fail for a true first-timer

"The first screen is kind: 'Not set up yet. Nothing moves by itself.' Then the counting starts: four steps on the board, 0 of 4 in the approval window, five lines in the Charter, '2 steps are left' in Settings, and line V 'signed' before I did anything. The agent step tells me 'not connected · pending isolation conformance (spike 2)'. I picked 'Careful' and the Review button stayed grey until I typed who may be paid; 'Leather Supply' got 'isn't a payee name: use letters, digits and - _ . : @ + only'. When I finally reached the sign sheet it said 'Adding Limit per deal.' with no number, so I would have signed a limit I could not read. The practice-deal button was grey with no reason. What I could not test: the real developer.paypal.com wall and Windows Hello, because the mock saves keys instantly."

## Dan (counterparty reseller)
Journeys: haggle-and-watch partial | counter-shop-and-wallet partial

"From the buyer side I only see my buyer's own band, never mine, which is right. I could not play the seller in a browser: the wallet-seller relay, the silent below-floor rejection and the hands-off capture need a scripted buyer client, so I decline to call any of that verified. What I could read: a signed proof file carries the sender's own limits and the save sheet says so in plain words, and my floors only change through the signing hand-off, one item at a time."
