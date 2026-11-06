# UAT run 2026-11-06 - L2 report (live, headless Chrome against the preview mock)

Environment: preview server http://localhost:1430, MOCK backend, driven by playwright-core with the installed Chrome (the Chrome extension was not connected). Native shell, real PayPal, screen readers: not covered. See `_L2-PREFLIGHT-A.md`, `_L2-PREFLIGHT-B.md`.
Rows: `findings-A.json` (89: 65 confirmed, 22 uncertain, 2 refuted, 10 new L2A-*) and `findings-B.json` (47: 41 carried, 6 new L2B-*). Voices: `journal-A.md`, `journal-B.md`.

## Journey verdicts
| Journey | Verdict |
| --- | --- |
| gated-spend-approval | L2-pass (Maya, Grace keyboard side) |
| haggle-and-watch | L2-pass (Maya) |
| sign-rules | L2-fail for Omar (L2A-06), partial for Tomasz |
| counter-shop-and-wallet | L2-fail for Tomasz (one of four drafted prices handed off), partial otherwise |
| first-run-onboarding, book-and-proof, subscription-rescue | partial |
| attack-the-table, attention-tumbler, evaluate-in-20-minutes | partial |

## Top confirmed / new findings
1. L2A-06 (major, new): the first-rule sign sheet lists clause names with no amounts.
2. L2A-02 (major, new): replay renewal D-0188 gets two opposite "if you do nothing" answers (Rescue vs deal page/approval).
3. L2A-03 (major, new): agent-app status contradicts itself across surfaces; setup counts disagree ("four steps", "0 of 4", "0 of 5 lines", "2 steps left").
4. SAM-L1-02 widened: any note, even a greeting or German, gets "asks for nothing an agent could try"; PayPal-is-a-recorder stated nowhere on the arena.
5. TOM-L1-01: nothing says a wallet cap limits a rule; TOM-L1-03 only one Counter price handed off.
6. Book CSV lacks fee, decider, hash, ULID; 3 of 8 statements read "unknown" after load. Book tiles tie to the cent.
7. Tumbler: ticker 6 s, snooze acknowledgement 2.4 s, hover does not hold; focus falls to body after snooze; hold vs gate colour-only; three buttons named "Open Assistant rules...".
8. proof.html: no sample-data chip; price/payee checks stay dashed (9 of 16) so a price tamper is caught only by the seal (L2A-07, L2B-04).

## Re-scored / refuted
MAYA-L1-02 and TOM-L1-04 narrowed to minor; GRACE-03 narrowed (text-only simulation); CHEN-05 narrowed; MAYA-L1-19 strength refuted; TOM-L1-12 refuted (at most one gold per view); SAM-02, JUDGE-09 widened; MAYA-L1-13, OMAR-L1-10 widened. MAYA-L1-09 (Spend 'on hold at PayPal') uncertain: needs a purchase with `money_check` set.

## What passed
All 14 arena cards refused with counters at $0.00 / 0 PayPal asks; 7 of 7 proof tamper buttons caught by the seal; Book tiles tie to the cent; reduced motion honoured; one gold button per view; Enter never pays, hold-to-confirm works.

## Not reproducible on this host (and the fixture that would close it)
Screen-reader speech (NVDA/Narrator on Windows); native 200% zoom (Windows shell); Hello-off dead end and native credentials dialog (native shell); wallet cap vs rule and audit rows (Rust-backed run); refusal flood and Dan's relay-side items (live sandbox with a relay); clean-machine install time (fresh VM).
