# Lever Matrix

## The bet
"One lever per subscriber" as a matrix: subscribers as rows, the closed lever list as columns, one cell per row. "Do nothing" is a real column and the default; the plan price change is a struck column. The bet is that Maya trusts the rule more when every combination shows its outcome at once.

## How a person uses it
1. Layer 1: each cell is a value and one short line ("$9.60 · invoice · −20%"). A refused cell shows "off" and a code ("REPLAY", "waits retry", "R-3"). The Approve column holds the decision; each subscriber cell shows "silent → nothing sent".
2. Arrow through the cells. The inspector follows focus: what PayPal does, the calls, the rules checked (✓/✕), the email, the decision.
3. Space chooses (0 = do nothing, 1–4 = a lever). Enter on the chosen lever, or Review ↗, opens the approval window.
4. In-flight and settled rows are one line each; their evidence and simulations open in the inspector. "Recovered", "R-3 ⓘ" and ✕ open popovers.

## What it does better than the other two
- Side-by-side comparison across levers and subscribers.
- Silence and the banned plan-price change are columns, not footnotes.
- Every refusal shows a code, with the full reason one focus away.

## Known limits
- The module list folds to icons to give the matrix its width; at 1024 px the table scrolls inside its frame.
- The approval window is an overlay here, not its own window.
