# Priya (bookkeeper) x book-and-proof: L1 (theoretical, code-grounded)

**Verdict: L1-conditional.** The journey completes structurally; two majors on the export and fee gap carry to L2.
**Time saved if it all worked: about 1.5 to 2 h of her ~3 h (assumption). Confidence: medium-low.** That is at or below her 2 h bar until fees, decider and hash reach the export.
Grounding score: n/a (no in-product LLM prompt surface, env.md). Wiring audit: Deal.decided_by, paypal.order and capture, transcript_head and market all reach a UI surface; paypal.authorization reaches deal, spend and shield pages but not Book or the CSV; AuditRow carries no hash field at all.

## Reachability
Main console Book (cards: Money this week, Outlook, Record, Ask), Deal page, Rewind and `proof.html` are all reachable on the mock preview (env.md). Native Save signed proof (file dialog) and the Rust `table-verify` CLI are not browser-drivable; L1 speaks only to "landed".

## Scored criteria
1. Week total reproducible from deal pages: PASS. A script over buildMockState (23 deals, USD) gives an independent per-deal sum equal to sums(): paid out 83.00 and in 27.50, held 64.00 and 118.00, in progress 1,317.01 and 172.60, stopped 13,564.00. Both sides use dealTotal, so this proves internal consistency, not PayPal agreement (L1-08).
2. Each money step names its decider: PASS on the deal page, Rewind and the Book record; 0 of 15 money-state fixture deals lack it. Not in the ledger row or the CSV (L1-06, L1-02, L1-10).
3. Proof check detects a changed price: PASS. TS twin tests redden countersign, paypal_order, receipt and evidence; 121 tests green. Rust not run (L1-09).
4. Unknowns dashed, not 0: PASS with a nit on empty tiles (L1-07, L1-10).
5. Export reachable in 3 clicks or fewer: PASS, 2 clicks. Content is the problem, not reach (L1-10).

## Ranked findings (frequency x reachability x trust erosion)
1. L1-01 No fee anywhere (major).
2. L1-02 CSV lacks decider, record hash, authorization id, ULID (major).
3. L1-03 CSV statement "unknown" for rows never read this session (major).
4. L1-04 One signed proof per deal, no month bundle (minor).
5. L1-05 Paid invoice D-0178 has no capture id and a dash for its statement (minor).
6. L1-06 Decider not in the ledger row (minor).
7. L1-07 Known-zero tile shows a dash (info).

Strengths to protect: L1-08 (single-sourced sums, states never added), L1-09 (tamper twin with Rust parity), L1-10 (dashed unknowns, 2-click export, deciders on record).

## In my words
"Which payout, which fee, which deal id? The Book keeps Paid, On hold and Stopped apart and never adds them, and the week figure ties to the deal pages to the cent in the sample data. I like that. Unknowns are dashed, not zero, and the proof page goes red the moment I raise a price.

But I reconcile against PayPal's payout, and there is no fee on any screen or in the file. My total is gross, theirs is net. The CSV has the PayPal order and capture ids, good, but not who decided, no authorization id and no chain hash, so I would still ask Maya to show me the deal page for every money step. The statement column says 'unknown' for anything I did not scroll past. One signed proof per deal means a month is a lot of saving and checking.

Would I adopt it? Yes for the first pass and for the tamper check. I would keep my spreadsheet for fees. Put gross, fee, net, decider and hash in the export and I would tell a peer."

## L2 hand-off (details in findings.json l2_priority)
Confirm the CSV header and the unknown count after a cold load; the D-0178 row; run `proof.html?break=price` live. Native Save signed proof and the Rust CLI need the shell (accepted gap, not re-raised).

Method note: the sums were computed with a throwaway vitest config in the scratchpad (no app files touched). The proof tests were run with the existing vitest setup.
