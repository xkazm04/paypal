# The Dial

## Philosophy
Security is the product, so the home is a machined vault dial and nothing turns without Maya. The outer ring holds six module medallions; every deal is a bead on the middle ring (teal moving, gold-locked held, green settled, × stopped, hollow withdrawn; gold pulse = needs you). The hub opens on "Needs you": the top decision, its default on silence, one gold button.

## Two layers
- **Layer 1** (indicative): the dial and hub are the hero. Left: the week as five rows (moved out / in, held, in motion, stopped) plus the engine estimate, never summed with wallet spend. Right: one two-line row per open decision with its "silent →" default. Modules and the deal view show one decision row, then compact rows.
- **Layer 2** (detail): the hub's Details, ledger rows, ⓘ, "note ›" (untrusted text) and "Why?" open popovers; mandates, settings, audit, pairing and the email draft open sheets; money opens only the approval window.

## Interaction
Intro spin, hover / wheel / ←→ to turn, 1–6 or Enter to zoom into a module, Esc back out. Deep links: `#m=spend`, `#d=D-0193`, `#a=D-0193` (approval window), `#s=settings|mandates|audit|pair|house`.

## Theme
A Dark / Light switch in the top bar (and in Settings) sets `<html data-theme="light">` (PayPal palette from `shared/tokens.css`) and remembers it in localStorage. Every colour, including the dial's SVG, comes from tokens.

## Known limits
- Snapshot Thu 29 Oct 14:02, sample week, sandbox; external PayPal events are labelled simulation buttons.
- D-0190 waits for the owner because its payee is off the clause-7 allowlist (left open by the report).
- Reduced motion turns the spin and zoom into fades.
