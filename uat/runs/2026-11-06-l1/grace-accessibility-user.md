# Grace (accessibility user) - L1 walk, 2026-11-06

Method: code and CSS only, no browser. Surfaces: Tumbler window, approval window, shared UI primitives, tokens, Shortcuts.tsx, QuitSheet.tsx. Findings: `grace-accessibility-user.findings.json` (GRACE-L1-01..09).

## Verdicts

| Journey | Verdict | Time saved (if it all works) |
|---|---|---|
| gated-spend-approval | **L1-pass** (no majors; two minors, one by-design) | ~3 min per decision vs the mouse-bound way (her 2x penalty removed), confidence low-medium |
| attention-tumbler | **L1-conditional** (majors 01, 02, 03 carry to L2) | ~10 min/day of re-checking, confidence low (assumption) |

## Measured counts

- Interactive elements with a name: icon-only buttons (the info glyph, previous/next arrows, the close cross, pin and do-not-disturb) are named 9/9 by aria-label; the grep for glyph-only buttons without a name returned 0. Raw `aria-label` use on `<Btn>`/`<button>`: Tumbler 2 of 28, approval 18 of 83, shared/ui 4 of 18; the rest carry visible text.
- Clickable non-interactive elements: 3 in scope; 2 handled (WhoWhat row has role=button, tabIndex 0, onKeyDown; the console row is guarded), 1 not (Tumbler ticker `div onClick`, forms.tsx:141). Ratio 2/3.
- tabindex > 0: 0 in all of client src. Live regions (aria-live or role=status/alert): Tumbler 6, approval 19, shared/ui 6.
- outline:none rules: 9 in scope or shared, each with a replacement (the `.f:focus-visible` inset ring, the range-thumb ring, the `.ui-field` ring, or a programmatically focused heading by design). 9/9.
- Reduced motion: OS media query, `calm` class, and Tumbler `.reduced` class. Present in all three. Hold gesture degrades to four steps, still full duration.
- Colour-only status: cards, stack rows and chips use text plus colour (Needs you, Paused, In approval, Checking, Ended). The exception is the puck art: hold vs gate by colour in an aria-hidden SVG (finding 05).
- Contrast (dark, WCAG ratio): gold-l on panel 12.40 / bg 13.44 / panel3 10.23; gold fill on panel 9.68; text 14.95; muted 8.73; dim 5.91 (4.88 on panel3, 3.66 on line2, so dim is only safe on panels); teal-l 12.15; coral-l 10.50; red-l 8.50; ok 10.53; refuse on panel 5.89; on-gold on gold 9.89. Light theme: dim 7.05, gold-l 7.73, focus pp-blue 4.44 (needs only 3:1). Gold on dark is not a problem. The token test (lib/contrast.test.ts) enforces 4.5:1 for 8 inks x 5 surfaces in both themes.
- Fixed px at 200%: Tumbler root 13 px with fixed 22/24 px rows in fixed 440x152-336 windows, nowrap/line-clamp (finding 03). Approval is rem/flex and scrolls. Font floor test pins 12 px.
- Pauseable timers: toasts pause on hover/focus; Tumbler tickers (2.5-6 s) do not (finding 02). Deadlines are real and cannot be paused by design; Snooze is only offered above 45 min and the 15 min rung re-pierces.

## Ranked findings

1. **GRACE-L1-01 major** - Arrival of a gold decision is not reliably announced (rung live region speaks only on a rung climb; arrival ticker is a freshly mounted live node, window is shown non-focusable). Uncertain until a screen reader runs.
2. **GRACE-L1-02 major** - Ticker messages, including the snooze acknowledgement, vanish in 2.5 s with no pause (toast has one).
3. **GRACE-L1-03 major (uncertain)** - Fixed-grid Tumbler likely clips the "If you do nothing" line at 200%.
4. **GRACE-L1-04 minor** - Snooze hides behind "Details: ..."; focus after the card vanishes unproven.
5. **GRACE-L1-05 minor** - Hold vs gate on the puck is colour only; ticker click-only.
6. **GRACE-L1-06 minor, by-design** - 1200 ms hold has no alternative (keyboard Space works).
7. **GRACE-L1-07 minor** - Structural a11y test covers Main only; no screen-reader session ever run.
Strengths: 08 (modal/focus/keyboard), 09 (contrast, names, motion, snooze safety).

## Acceptance criteria (character file)

1 Tab reaches every control: pass by construction (native buttons, roving tabindex). 2 Decision state not colour-only: pass on cards, partial on puck. 3 ARIA names: pass. 4 200% zoom: unproven, at risk on the Tumbler. 5 Snooze keyboard-reachable: pass, but undiscoverable (04).

## Feedback in voice

"Can I reach it by Tab? Mostly yes, and I am glad nobody put a tabindex of 5 on anything. The approval window is the best money screen I have seen for my kind of use: Enter never pays, I hold Space, it says 'Keep holding' and 'Confirmed', and the countdown does not babble every second. I like that Snooze can never push a decision past its deadline.

"Who announces that? That is where it falls down. The Tumbler is a small window that never takes my keyboard, which I respect, but when a new decision lands I am not sure anything speaks, and the little message that tells me about it is gone in two and a half seconds. My own snooze confirmation is on screen for two and a half seconds. At 200% I think the line that tells me nothing moves if I do nothing gets cut off. I would use the approval window tomorrow. I would not rely on the Tumbler to tell me anything until someone has run a screen reader over it. No one has, and the audit says so."

## Appendix

Refuted/uncertain: 01, 03, 04 are uncertain pending a real screen reader or zoom pass; native-shell behaviour is an accepted gap (uat/accepted-gaps.md) so those results should stay uncertain if only preview is available. Not checked: the Main console modules beyond Shortcuts.tsx and QuitSheet.tsx (both use the shared Sheet and inherit its focus handling, finding 08; Shortcuts is a labelled dl, its checkboxes are wrapped in labels; QuitSheet's loading and change notices use role=status).
