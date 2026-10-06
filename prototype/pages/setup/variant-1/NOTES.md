# Preflight

## The bet
Setup is a short, ordered set of gates, so first run walks them one at a time: engine, PayPal credentials, first mandate, optional HOUSE, with a live "What is true now" column beside each step. On return the same gates become a macOS-style settings list, one line per setting.

## How a person uses it
1. Layer 1, first run: a segmented stepper and one step as a grouped box of one-line rows (state · who · one button), with "silent → …" under it.
2. Probe and pick an engine; "Store… ↗" and "Sign… ↗" hand off to the approval window, where a native dialog writes the keychain.
3. Layer 2: every ⓘ opens a sheet (probe detail, keychain, clauses, HOUSE, idle lock, who can set what); "Clauses ›" is a popover.
4. Ready check, then "See it as settings". Returning: label · status · who · one control per row; ↑/↓, Enter runs the row's act, P pauses.

## What it does better than the other two
Easiest for a first-time judge: one decision per screen. The settings list reuses the same rows, so first run teaches the settings.

## Known limits
- Fixed step order on first run; an expert cannot set things side by side.
- The wizard leaves the lower half of the window empty.
- When locked, every privileged row repeats "Unlock with Windows Hello".
- The mandate editor is linked out.
