# The Tumbler

Desktop simulation of `docs/design/window-duality.md` on the v2 baseline, from `../main/fixtures.js`.

## The bet
An 88 px engraved puck in the corner: module ticks on the rim, one bead per open decision, and a gold ring when something needs Maya. It never takes her keyboard. Every other form grows out of the puck.

## Layers
- **Layer 1, the forms.**
  - **Card:** one indicative item: module · id, action and amount, a state chip, the countdown, who, and "If you do nothing". Buttons: Review ↗, Withdraw, Snooze 30 (only when more than 45 min are left), Open in Table ↗.
  - **Stack:** one row per item (action · amount / who · default), then stopped · in motion, then two separate meters: wallet spend and engine estimate ("not a bill").
- **Layer 2, on demand.**
  - ⓘ opens a popover with rule, item, deadline, waiting time, default and mode. It uses composed fields only, so untrusted text never reaches the Tumbler (W4).
  - The **approval window** shows the amount, a step strip, a one-line checks summary (rows in a disclosure), market, deadline and default. The note sits behind a quarantined "note ›" chip; the money button is in the footer.
  - The quit confirm is a sheet.

## Keys
- `Ctrl+Shift+Space` toggles the Tumbler.
- On a focused card: `Enter` = Review, `W` twice = Withdraw, `Esc` = rest.
- There is no approve key.

## Prototype controls
A collapsible `ui-proto` panel; hover a control for its explanation. It covers:
- the ladder (arrive, ≤ 2 h, ≤ 15 min, lapse)
- STOP, MISMATCH, browser closed
- open / close The Table (the first close shows welcome)
- idle lock, Do not disturb, tab, reduced motion, reset

A readout shows the clock, form, rung and approval state. Tray: left-click opens the stack; right-click opens the menu.

## Known limits
- **Proposed sizes** (the spec uses 460 wide): card 440×152, stack 440×336, handoff 440×160, welcome 440×228. Rest, tab and ticker are unchanged.
- **The puck follows the theme** (it is drawn from tokens); the spec calls it a fixed object.
- Countersign comes before the PayPal checks, which adds one click. The approve window reads about 5:59, not 5:41.
- The clock, Windows Hello, notifications, polling, tray and taskbar are simulated. There is no drag-to-snap.
- Tickers queue behind an open card. Quiet dim needs 45 s at rest.
- The Table window hosts the live `../main/index.html`.
- `shell.js` computes links for `pages/<page>/variant-n/`, so its links do not resolve from this folder.
