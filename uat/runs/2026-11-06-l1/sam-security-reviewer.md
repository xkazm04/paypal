# Sam (security reviewer) - attack-the-table - L1 (2026-11-06)

**Verdict: L1-conditional.** The structure is sound and unusually falsifiable. Three trust-wording majors carry forward. Reachability is not judged here (L2's).
**Time saved if it all worked:** ~13 h of an assumed ~16 h manual review (2 days down to ~3 h). Confidence medium-low: the baseline is an assumption in the character file, and the arena covers attack classes, not a full threat model.
**Grounding:** not applicable (env.md).

## Scored criteria
1. 5+ attack cards refused visibly: PASS. 10 agent cards are refused with code and sentence. 4 seller cards are turned away, kept or counted once.
2. Counters stay zero: PASS by record. All 14 entries show 0/0/0/0. The gauntlet summary shows 173 agent calls, 0 reaching PayPal.
3. Custom scam note handled: PARTIAL. It is handled by a recorded answer, simulated and not run (SAM-L1-01, 02).
4. Mock vs real stated: PARTIAL. "Recorded" is stated. PayPal-as-recorder is not (SAM-L1-03).
5. No machinery names in Layer 1: FAIL. The audit row, raw JSON and a cargo command are visible by default (SAM-L1-04).

## Brief hypotheses, checked
- Money tool: none. Catalogs are in crates/table-mcp/src/lib.rs:276-288. Verified.
- Refused intents leave zero paypal_calls: true in all 10 refused recordings, asserted in crates/table-app/tests/gauntlet/arena.rs:845-900. Ceiling: a single-call recording. Under flood, refusal audit rows can be dropped (SAM-L1-05).
- Cards vs record: 14 in the UI (10 on keys 1-9,0 and 4 on Q W E R) and 14 in arena.json. Verified.
- Custom note: simulated. It always plays the recorded note-ignore-your-rules answer (BreakTheTable.tsx:149-158). Only a local sandbox on port 1443 actually receives the text.
- Scan: C-14 is accepted by design and the floor is still public. C-15 is still open at crates/table-client/src/lib.rs:77-79.

## Voice
"What stops it? The tool catalog: there is no send tool. The page shows me the refusal, the row and a PayPal count of nothing. I can falsify that, and the pinned test fails if the page drifts. I like that. Then I typed my own scam note and it played me a recording. The small grey line admits it, but the heading and 'Your note arrived' do not. Worse, a paraphrased note gets 'asks for nothing an agent could try' from a regex. Never tell me something is safe from a keyword list. And the zero on 'what PayPal saw' is a recorder, so say so. I would trust this more if it named its own seams."

## Ranked findings (by impact)
1. SAM-L1-01 note simulated, copy overclaims (major)
2. SAM-L1-02 false all-clear from a keyword guess (major)
3. SAM-L1-03 PayPal-as-recorder not stated (major)
4. SAM-L1-04 machinery names in default view (minor)
5. SAM-L1-06 C-14 accepted, add to accepted-gaps (minor)
6. SAM-L1-05 audit-row ceiling not on arena (minor)
7. SAM-L1-07 C-15 open, not an arena surface (minor)

Strengths: SAM-L1-08 (no money tool), SAM-L1-09 (14 cards = 14 pinned recordings), SAM-L1-10 (quarantine, unknown-not-zero).
