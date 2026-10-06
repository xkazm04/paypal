# Page prototypes - common brief

## v2 rework (2026-10-06) - read this first; it overrides the sections below where they differ

The owner's notes on round 1: the baseline from the landing page is "rough and not pleasant to work
with". Components and sections are space-inefficient. Pages resolve everything on one layer, so
text overload breaks the visual ideas. The fix is a macOS-like baseline that keeps the colour theme.

1. **Load the v2 baseline** in this order, and build with its components:

   ```html
   <link rel="stylesheet" href="../../../shared/tokens.css">
   <link rel="stylesheet" href="../../../shared/ui.css">
   <script src="../../../main/fixtures.js"></script>
   <script src="../../../shared/ui.js"></script>
   <!-- your <style>, markup and script -->
   <script src="../../../shared/shell.js" data-page="<page>" data-variant="<n>"></script>
   ```

   Open `prototype/shared/baseline.html` in a browser and read `shared/ui.css` + `shared/ui.js`.
   They are the reference: window frame (`ui-app`, `ui-titlebar`, `ui-split`, `ui-sidebar`,
   `ui-main`, `ui-inspector`), rows (`ui-group` > `ui-row`, `.two`), `ui-table`, `ui-btn`
   (`.primary`, `.gold` = hand-off / needs you, `.danger`, `.plain`, `.sm`), `ui-seg`, `ui-field`,
   `ui-chip` (teal/coral/gold/ok/red/line/dashed), `ui-stat`, `ui-meter`, `ui-kv`, `ui-silence`,
   `ui-proto` (prototype controls) and the layer-2 API `UI.sheet / UI.popover / UI.inspector /
   UI.toast / UI.esc`. Page CSS adds only what is unique to the variant's bet (a chart, a canvas, a
   ladder). Do not restyle the baseline components.
2. **Density, macOS style.** 13px body, 12px secondary (the floor), 15px section and sheet titles,
   17px page title, `--fs-display` 26px only for the one key figure. 4 pt spacing (`--sp-*`), 28px
   rows (44px two-line), 26px controls, 38px bars. No hero headers, no paragraph intros, no
   oversized cards, no empty vertical air. The page should show at 1280x800 what used to take two
   screens. `html` is fixed at 13px now, so `rem` = 13px.
3. **Two layers.**
   - **Layer 1 (indicative)** shows key metadata only: one line per item, two at most. That means
     id · who · amount · state chip · deadline or default on silence. A hint is one 12px line.
   - **Layer 2 (detail)** holds every explanation: clause traces, evidence, timelines, market
     detail, consequences of an act, untrusted text. It opens on demand in a sheet, a popover, or
     the inspector (filled by the selected row).
   - **The decision stays on Layer 1** as one button, with a one-line default on silence beside
     it. Its confirmation, and what it does in exact words, live in a sheet.
   - The rules still hold: untrusted text is still quarantined, but behind a "note ›" chip, not
     inline. "If you do nothing" is still visible on Layer 1 for every item that needs Maya.
4. **Colour only from tokens.** No hex or rgb literals in the page (use `color-mix()` of tokens;
   `--on-gold`, `--on-teal` for ink on fills). Fills (`--gold`) are for surfaces; inks (`--gold-l`)
   are for text. The tokens now carry a light PayPal theme (`<html data-theme="light">`). Only the
   landing page shows the switch, but every page must stay legible if it is set.
5. **Keep each variant's bet** (its interaction model and dominant element). The rework changes
   density, structure and layering, not the idea. Update its NOTES.md (same headings, under 250
   words) so "How a person uses it" names what sits on each layer.

The Table is a Tauri 2 desktop wallet for AI agents that touch money (PayPal sandbox). It has
three windows: **main** (Home = The Dial, six modules, one deal view, settings), the small
always-there **tumbler**, and the transient privileged **approval** window, the only place money
can be released. The visual language is decided ("The Dial"). The owner now wants **three UX
variants of every page**, so the build picks the best interaction model per page, not per theme.

Read before you design (only the parts for your page):

- `AGENTS.md` - the invariants (who may move money, untrusted text, silence never moves money).
- `docs/design/the-table.extract.txt` §10 "Product surfaces" (lines ~686-860) - what each page
  sees first, its one decision, its states, empty and error states, where it moves to.
  `docs/design/the-table.html` wins on any difference.
- `docs/design/window-duality.md` - the three windows, the Tumbler's forms and attention ladder,
  the approval hand-off.
- `prototype/main/fixtures.js` - **the dataset** (`window.FIX`): Maya's sandbox week, snapshot
  Thu 29 Oct 2026 14:02. Every page renders from it.
- `prototype/main/NOTES.md` + `prototype/main/modules.css` - the craft level expected.
- `apps/desktop/client/src/windows/...` - how the page is **built today** (React). Read the file
  for your page so you know the baseline. At least two of your three variants must differ from
  it in their interaction model. One may be a sharpened version of it.

## The variants compete on UX, not theme

Each variant is a different answer to the page's question, not a re-layout of the same answer.
Axes to bet on (pick your own): the dominant element; list vs canvas vs timeline vs conversation;
density; progressive disclosure vs everything visible; keyboard-first vs pointer-first; where the
act happens (inline, drawer, dedicated step); what is first at a glance.

Theme: **style only from the CSS variables in `prototype/shared/tokens.css`** (dark machined
panels, teal = your side, coral = counterparty/holds, gold = PayPal settlement / needs you,
green = settled, red = refused, mono `tabular-nums` money, 1px lines). A colour with no token is a
`color-mix()` of tokens. Module colours are `--m-<module>`.

## Deliverable

```
prototype/pages/<page>/variant-1/index.html   variant-1/NOTES.md
prototype/pages/<page>/variant-2/index.html   variant-2/NOTES.md
prototype/pages/<page>/variant-3/index.html   variant-3/NOTES.md
```

Each `index.html`:

- **Opens from disk with no build step and no network.** Inline CSS and JS, no CDN, no web fonts.
- **Loads the shared files in this order:**

  ```html
  <link rel="stylesheet" href="../../../shared/tokens.css">
  <script src="../../../main/fixtures.js"></script>
  <!-- your <style> and markup -->
  <script src="../../../shared/shell.js" data-page="<page>" data-variant="<n>"></script>
  ```

  `shell.js` goes at the end of `<body>`; it adds a 44px sticky prototype bar (`--shell-h`) with
  links to every page and a variant switcher. Leave room for it; it is not part of the product.
- **Renders from `window.FIX`.** If the page needs data the dataset lacks, add it inside the page
  as a clearly named constant consistent with FIX (same ids, names, amounts, times).
- **Is the window, not a website.** Main-window pages show the main window's own chrome as the
  page needs it (module rail, breadcrumb `The Table › Tables › D-0193`, mode badge, Esc back).
  Approval-window pages are a ~520-640px wide window centred on a dimmed backdrop. The Tumbler
  page simulates a desktop corner.
- **Works at 1280x800 and 1920x1080**, usable at 1024 wide, no horizontal page scroll.
- **Every interactive element works**: click, filter, drag, type, confirm, withdraw, keyboard
  focus. Local state plus a toast or log line where the real app calls Rust or PayPal. External
  PayPal events are buttons labelled "Prototype · sandbox simulation".
- **Respects `prefers-reduced-motion`.**

Each `NOTES.md`, under 250 words, with exactly these headings:

- `# <Variant name>`
- `## The bet` - what this variant puts first, and why (2-4 sentences; the report quotes it);
- `## How a person uses it` - three to five steps;
- `## What it does better than the other two`;
- `## Known limits`.

## Rules that hold on every page (from the design and AGENTS.md)

- **Mode badge** SANDBOX (or REPLAY / SCRIPTED ENGINE where the record is one) on every screen.
- **Default on silence**: every item that waits for Maya states what happens if she does nothing,
  and that default never moves money ("the offer lapses at 18:00 · no money moves").
- **Only the approval window can say yes to money going out.** Main and Tumbler pages hand off
  ("Review & approve" opens the approval window); they never show a pay/capture/release button
  that acts directly. Withdraw, void-by-default and refuse may live anywhere (restricting is free).
- **PayPal only in the browser**: "Open PayPal in your browser", then a waiting state with the
  approve-window countdown. Never draw a PayPal page.
- **Untrusted text** (counterparty notes, memos, product titles from others) renders as plain
  text in a dashed coral quarantine box labelled UNTRUSTED: never markdown, never links.
- **Two meters, never one axis**: wallet spend (USD agents committed) and engine spend (the CLI's
  own estimate, "not a bill") are separate.
- **Idle lock**: after 15 min idle, privileged buttons show a lock + "Unlock with Windows Hello".
- **Honest evidence labels**: seller-attested until Maya's own evidence exists, then receipted;
  "pending in PayPal reporting" until Transaction Search matches. Unknown is shown as unknown.
- **No invented numbers**: no forecasts, success rates or ETAs the data does not hold.
- Engines are `claude-code` / `codex-cli`. No third-party logos. Body text >= 14px at 1280x800,
  nothing the user must read under 12px.
