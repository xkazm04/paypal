# Gate Log

## The bet
A dense, keyboard-first ledger is the fastest answer: every ask, grouped by agent, one 28px row each with a verdict chip and the clause it hit. The one hold that needs Maya sits in a "Needs you" row above the log, which scrolls on its own, so the decision never leaves view.

## How a person uses it
1. Layer 1: the "Needs you" row shows D-0190, $64 held, "silent → auto-void Sun 09:02 · nothing is paid" and a countdown. ⓘ opens a popover on why it waits.
2. Layer 1: the log has one line per ask, such as "cl 3 ✗ · 0 PayPal calls". `j`/`k` move, `1`–`5` filter, `g` regroups.
3. Layer 2: `Enter` or a click fills the inspector with the amount, payee, PayPal ids, statement and clause trace. Untrusted text sits behind "note ›". `w` opens the mandate sheet.
4. `c` (Review & capture) hands off to the approval window. `v` opens a sheet saying exactly what voiding does.

## What it does better than the other two
It is the fastest to triage. Everything fits on one screen, the keyboard alone is enough, and the inspector follows the selection.

## Known limits
- At 1024 px with the inspector open, the silence line truncates after "auto-void".
- The honor period is a number, not a picture. Velocity shows today only.
- It is closest to the built baseline.
