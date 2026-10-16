# The Seal (A/3, refined)

This is the refined A/3: the round-two build plus a pass that fixes layout defects. The concept, components, palette and type are the same as round two.

## Concept
Money has trusted printed paper for centuries: guilloché, engraving, microprint. Here each layer is a sheet of dark security paper. The front sheet says one thing in one sentence. The owner's authority is a seal she presses (she holds a button and rosette rings draw around it). The depth of the wallet is a real stack of sheets you can see. Everything is sample data on test money: the sheet's microprint border, the seal's ring text and the footer all say "sample data, nothing is paid". Money is always shown to the cent.

## How the layers nest
1. **Decision centre** (the opening sheet). One decision at a time: what it is, who it is with, what happens if you do nothing, one main action, then three facts (amount, market or state, your rules). The large seal beside it shows the wallet's state: quiet, watching, needs you, holding, paid, stopped. Under it, **Next in the stack** shows the next waiting decisions. When fewer decisions wait than there are slots, the free slots show what happened while you were away and what the wallet is watching. These come from the same sample data as Rewind and Rescue.
2. **Module sheets** (Tables, Spend, Counter, Book, Shield, Rescue). These are the tabs on the sheet's top edge. Each has one answer sentence, its counts and its full list, which searches, filters and loads more rows.
3. **Deal sheets**: one deal, what happened and who decided it, the rules that applied, proof from PayPal, the other side's words (shown fenced, never as instructions).
4. **Places** in the top bar: Rewind, Rules (with wallet limits), Connections, Settings, Find.
5. **The approval layer** rises from the bottom over a dimmed stack. The money decision is made only there, by holding the seal.

On every sheet except the centre, the seal shrinks to a corner stamp at the top right of the sheet. It sits fully inside the window.

First run opens on **Your charter**, five lines (I to V). Each line shows its one-line plain explanation. The left side holds the current line's action, how the line will read once signed, and what signing the charter means. "Skip" opens the sample wallet, which is already set up.

## Scale switch
Two sample worlds load from `../data/scale/`: `?scale=small` (a small shop, a handful of deals) and `?scale=large` (a busy merchant, hundreds of deals and dozens of people and agents). The footer has a Small shop / Busy merchant switch, and Settings has another. Lists stay usable at the large scale: search, filters, counts and "show more".

## Sizing
Everything is sized from one root unit, so proportions hold from 1280 x 800 to 2560 x 1440. On windows around 800 px tall, the decision centre tightens its spacing so the sentence, the facts and the stack row all fit. If a sentence still runs long, the decision block scrolls inside itself and never overlaps the stack row. At 390 wide, the page becomes one scrolling column.

## What was cut
- The light theme.
- Live recounting: module sentences are fixed lines from the sample data and do not recount after a simulated decision.
- Real approvals, device unlock and keys: all simulated. Nothing is paid.
- Agent app product names, on purpose.

## Fixes in this pass
- Decision centre, busy merchant at 1280 x 800: the facts strip no longer overprints the stack row, and the stack row is no longer clipped by the sheet edge.
- The corner seal sits fully inside the window at every width, and is still printed on the sheet.
- Small shop: the empty part of the stack row now shows "while you were away" and "watching" cards from the data.
- First run: the charter rows are larger and show each step's explanation, and the left column explains what signing means. No large empty bands remain.

## What changed in round 3

Direction: **Calibre: cool instrument precision.** The same page, re-skinned as a calibrated instrument. The brand motif is the scale itself: hairline 0.5 to 1 px strokes, ticks at a fixed pitch, registration corners, a reticle at the centre and one soft signal sweep. Layout, structure, strings, order, interactions, `?scale=`, keyboard and Escape behaviour are the same as the control.

**How it is built (for diffing against the control).** `style.css` now reads every colour, surface and radius from custom properties, and its `:root` holds the control's own values, so `style.css` alone still renders the control. `theme.css` holds the Calibre tokens (night and day) and the decoration rules. `deco.js` is the one decoration module: the dial, the brand mark, the hold gauge, the textures and the key art. `app.js` asks `deco.js` for these and falls back to its original engraving when that file is missing. Remove `theme.css` and `deco.js` and you get the control back.

Changes, each with the sentence of the owner's review it answers:

1. **Typography** ("the type families, the scale, weights, tracking, numerals… the display voice versus the reading voice"):
   - Display and money use an engineered DIN-style grotesque (Bahnschrift, then DIN Alternate, D-DIN and system fallbacks) at light weights (260 to 350), tracked slightly tight.
   - Labels, kickers and tabs use its semi-condensed cut, uppercase and tracked at .16em.
   - Reading text stays in the UI face. Scales, microprint, key hints and untrusted text are monospace.
   - The wordmark is set in tracked capitals.
   - System fonts only. No font file is shipped.
2. **Money** ("money should look unmistakably like money"):
   - Every amount uses the same numeral face with tabular, lining figures (slashed zero where the font has one).
   - Amounts carry a little extra tracking so a sum reads like an instrument reading.
   - Sizes are unchanged, so body text stays at 14 px or more.
3. **Palette** ("re-derive the surfaces, inks, lines, glows and the six module colours"):
   - Night: blue-black slate surfaces (`#0a0e13` to `#1e2936`), cool steel inks and lines, and a teal "signal" glow for your side.
   - The six layer colours are re-derived at one calibrated lightness (OKLCH L .80, C .105; Book kept near-neutral), so no layer shouts louder than another.
   - The fixed meanings are kept: teal yours, coral theirs, gold needs you and PayPal, green settled, red refused.
   - Every text-on-ground pair was checked at WCAG AA (4.5:1) on the ground, the sheet and the pressed surface.
4. **Light theme** ("each variant must also have a light theme… and respect prefers-color-scheme"):
   - A day theme on chart paper, with darker semantic and layer inks (all AA on paper) and softer shadows.
   - It follows `prefers-color-scheme` live. `?theme=light` or `?theme=dark` pins one for comparison. There is no on-screen switch, because adding one would change the layout.
   - This supersedes "The light theme" under *What was cut*.
5. **Branded decoration** ("the guilloche, rosette, micro-text border, paper texture, seal, sheet edges, module key art and dividers: redraw them as a coherent brand language"):
   - **Seal:** a calibrated dial. It has a 180-tick bezel with a degree scale, the "sample data · nothing is paid" ring kept, a vernier pair of tick rings, a dashed range ring, spokes, a reticle, and a soft signal sweep. The sweep is slow when quiet, quicker when a deal needs you, coral when holding, and dimmed when stopped.
   - **Brand mark and approval mark:** a reticle in a ticked bezel.
   - **Hold to confirm:** four tick rings that fill like a gauge.
   - **Paper:** a hairline graticule, with cross marks every 48 px.
   - **Sheet edges:** ruled tick edges and registration corners. The microprint border stays, now in monospace.
   - **The stack under the sheet:** ruler ticks.
   - **Approvals:** the gold band is now a gold ruler.
   - **Ground:** a polar graticule centred on the dial.
   - **Key art:** each layer keeps its subject, now drawn as a calibration plate: corner brackets, edge rulers, a centre cross, a dot-screen and scan-line fill in the layer's colour.
   - **Indicators** are square LEDs. **Dividers** are hairlines with ticks.
   - **Decision stamps** are now lit readouts instead of rotated rubber stamps.
   - **Counterparty words** are fenced by a coral rail on a hatched ground, and still shown as quoted text only.
   - All of it is still labelled stylised. The sample-data strip and footer badges are unchanged.
6. **Radii** (part of the skin): pills and rounded cards become machined corners (.15 to .35 rem). The round controls stay round: the dial, the pagers and the hold gauge's face.
7. **Motion** ("prefers-reduced-motion gets a calm version"): the sweep and the readout flash stop under reduced motion and in the calm mode. The control's motion rules are untouched.

**What it costs.**
- Bahnschrift is a Windows font. On macOS the display falls back to DIN Alternate, and on other systems to a plain system sans, so there the voice is less distinct.
- The cooler, tighter palette loses some of the warmth and "banknote" trust of the engraved control. Trust has to come from precision instead.
- At small sizes the graticule paper is busier than plain paper. It is kept at 2 to 7 % opacity so it never competes with text.
- The degree numerals in the dial are decorative and unreadable at the corner-stamp size. That is intended: they are texture, not information.

**Left alone on purpose.**
- The key art's accessible label still says "Stylised engraving: …" although the art is now a drawn plate. Changing it would change a string, so it is listed here instead.
- The scale switch reloads without `?theme=`, which is the control's behaviour. The system setting still applies.
- The new type pushed the dial's caption down onto the stack row's rule at 1280 x 800. The caption's own spacing (line height, top margin) was tightened so it clears the rule again. No layout rule changed.
