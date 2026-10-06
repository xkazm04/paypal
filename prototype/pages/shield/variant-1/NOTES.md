# Case cards

## The bet
Every stop is a compact card: who sat down and for how much, the verdict, the five checks as chips (skipped shown as skipped, unknown as unknown), the default on silence, and the act on the card itself. It sharpens the built baseline instead of replacing it: pointer-first, nothing to learn, every explanation one click away.

## How a person uses it
1. Layer 1: the pixel-bay card shows HOLD · $140.00 · held by new counterparty, the check chips, "0 PayPal calls" and "silent → lapses 20:00 · nothing is paid".
2. Layer 2: a check chip opens a popover (rule, numbers, market band); "note ›" opens the quarantined note; "Case file ›" opens the whole case in a sheet.
3. "Review & release ↗" opens the approval window: she types `pixel-bay`, releases, then opens PayPal in her browser.
4. Or "Keep held", or "Refuse…" (confirmed in a sheet). The BLOCK card has no release.
5. Filter by verdict; "How verdicts form" and "Full log ›" are sheets.

## What it does better than the other two
Verdict and evidence read at a glance without learning keys, and it is the cheapest to build from today's React `Shield` section.

## Known limits
- Many stops become a long list of cards (~110px each).
- New counterparty is shown as HOLD (fixtures, §10.5); the §7 table says ASK.
- The approval window is simulated as an overlay.
