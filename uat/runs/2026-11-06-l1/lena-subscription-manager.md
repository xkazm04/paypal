# Lena (customer care) x subscription-rescue: L1 report, 2026-11-06

**Verdict: L1-conditional.** The job can be done structurally and the rules are enforced, but the figure Lena reports to Maya does not exist and one of the four fixes is built.
**Time saved (if it all worked): ~3 h/month of her ~4 h** (assumption in the Character file). **Estimated live: ~1.5 h/month. Confidence medium-low**, because L2 cannot test real detection (no PayPal sandbox runs yet, see accepted-gaps).
**Reachability:** Rescue, Home/board and Tumbler are all in the main window she uses. Approving a fix is not (approval window, Maya's), by design.

## Scored criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Failed renewals listed with next step | pass | RescueLayer.tsx:58-70, parts.tsx:253 |
| 2 | Lever cost visible | partial: percent and two prices, no "$ you give up" in Rescue | rescue.ts(words):113, diff.ts:347 |
| 3 | Outside-rule lever refused | pass in engine, invisible in Rescue | table-core rescue.rs:145-180, tests rescue.rs:378-405, table-app tests rescue.rs:481-545 |
| 4 | Monthly saved figure | fail: only all-time "Recovered so far" | RescueLayer.tsx:135, model.ts:161-178 |
| 5 | Plain words | partial: no "dunning/mandate/clause/lever"; "Ledger", "Replay", API paths leak | words/rescue.ts:33,91; model.ts:27 |

## Surface model (short)
- Summary answer, "Your call" and one gold button (HandOff) open the approval window (RescueLayer.tsx:237-283). Four views: Needs a fix, Fixes in progress, Recovered money, Watching, plus Compare.
- Data in: `rescue_book` returns `RescueBook{cases[RescueView], recovered[Money], watching, watch_reads_*}` (bindings/RescueBook.ts). The mock reproduces Rust arithmetic (mock/rescue.ts:28-49).
- Fix panel: radio group (Do nothing preselected, Discount), "what the subscriber would get", why-not for unbuilt fixes, invoice wording (parts.tsx:143-260).
- Rules: only the signed fixes clause counts, shown in Watching as one sentence (words.ts:229). The wallet computes the largest in-rule discount; the owner cannot type a number (rescue.rs:111-137).

## Wiring audit (RescueView/RescueBook fields vs UI)
| Field | UI hits (non-test, outside approval/mock) |
|---|---|
| failed_payments | **0** (LENA-L1-04) |
| offer.discount (money given up) | **0 in Rescue**; only approval diff.ts:347 (LENA-L1-03) |
| offer.lever | 0 (always the discount; harmless) |
| WatchView last_read_at, added_at | 0 (minor; "next_read_at" used) |
| recipient, next_retry_at, counted, invoice, text, offer.cycle/invoice/discount_bp, recovered, watching | used |
Ratio: 2 of the 6 per-case fields the character cares about are computed and never shown.

## Jargon check
`dunning`: 0 hits in the repo UI. `mandate`, `clause`, `lever`: not in rescue strings; Rust headline "Approve rescue lever" is mapped to "Approve a fix" (words.ts:389). Leaks: "Ledger" (words/rescue.ts:33), "Replay a renewal", "Open agent rules", and `POST /v2/invoicing/...` inside a disclosure (parts.tsx:223-225). The sample's only failing case is a replay.

## Lena, first person
"I opened Rescue and the first thing I liked is that it tells me, row by row, what happens if nobody does anything: PayPal retries, nothing is sent. That is exactly what I worry about: I never want a customer to get a message because of a button I pressed by accident. The invoice wording is fixed, calm and shows the same price they pay today, so a customer will not feel nagged. I cannot change the tone, and I would have liked a gentler line, but I would rather have it fixed than invented by an agent.

What stops me from calling this done: the card says '20% off: $9.60 instead of $12.00' and I have to do the subtraction myself. My support lead would reject that. Show me 'costs you $2.40'. I also see nothing about this customer: has this card failed once or four times, how long have they paid us? The wallet knows the count of failed payments and throws it away. I would give a longtime subscriber a discount and a third-time failure a reminder, and I cannot tell them apart. They also show up as 'subscriber S-14' with a masked email; I would have to look them up elsewhere.

And Maya asks me every month 'what did we save?'. 'Recovered so far' is a running total with no month. I would paste a screenshot and still have to say 'since when?'. Three of the four fixes are 'Not available yet', so pauses stay my own emails. It is honest about that and I appreciate it.

Would I adopt it? Yes for the discount cases and the safety. It saves me maybe an hour and a half, not three and a half. I would tell a peer: good guardrails, thin on the numbers I report."

## Ranked findings (impact = frequency x reachability x trust)
1. LENA-L1-01 No monthly saved figure (major, confirmed-absent).
2. LENA-L1-03 Discount cost shown as percent and prices, not the dollars given up (major, present-but-missed).
3. LENA-L1-04 No customer history; failed_payments never shown (major).
4. LENA-L1-02 Only 1 of 4 fixes built (major, by-design, scope_note).
5. LENA-L1-08 Lena cannot approve; no "waiting for Maya" (minor).
6. LENA-L1-05 Customers are ids and masked emails (minor).
7. LENA-L1-07 Jargon leaks (minor).
8. LENA-L1-06 Refusals are enforced but not visible (minor).
9. LENA-L1-09 Watch list is manual, capped at 20 (minor, uncertain).
Strengths (do not touch): LENA-L1-10, 11, 12.

## L2 handoff
Environment: preview on :1430, mock backend. The mock has one failing row (D-0188, a replay) and the directory has entries for the three subscribers, so history and identity will look better than a real wallet. Real PayPal detection and the native lock are L2-unreachable and stay `uncertain`.
