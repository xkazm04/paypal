# WP4b: the approval window and the Tumbler in the Calibre system (notes for the Director)

Scope: `windows/approval/**`, `windows/tumbler/**`, `design/**`, `shared/ui/**`, one new words file
(`lib/words/approval.ts`, re-exported by one line in `lib/words.ts`). No Rust, bindings, authority,
capability, gating or mock change: `git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri`
is empty. No change to what any approval control does, which command it calls, or when it is enabled.

## What changed

### The approval window reads as a front sheet of the console
- **One theme.** The window follows The Table's stored theme and calm choice, live
  (`windows/approval/entry.tsx`: `followStoredTheme()`, new `followStoredCalm()` in
  `design/motion.ts`). Before, it was always dark. The Tumbler now follows the calm choice too.
- **Frame, CSS-only plate** (`frame.css`). On the graticule ground (`<Graticule variant="grid" fixed>`
  in `App.tsx`) sit the console's top bar, the Approvals strip as the sheet's gold index tab, and the
  front sheet. Every child after the tab is drawn on one calibrated plate (`.aw::after`: plate
  gradient, registration corners, ruled bottom edge, lit top edge in `--c`) with one sheet of The
  Table's pile beneath (`.aw::before`). The plate is painted behind the content, so no screen's
  markup changed. `.aw` is now a flex column (the grid row lists in `approval.css`/`owner.css` that
  counted children were removed). On a deal review `--c` is the deal's module colour (`MODULES.cssVar`).
- **Bar** (`ui.tsx` `WindowBar`, used by `Header` and `ReviewBar`, both kept with their signatures):
  `Mark` + crumbs "The Table › Approvals (› module)" + mode badge + preview badge + Details (review
  only) + **Back to The Table**. The strip: "Approvals · the one place money is approved".
- **Back to The Table** closes this window and nothing else: `closeThisWindow()` in `ui.tsx` is the
  close path DealReview's "Close this window" already used (moved, not changed; its two notes are
  byte-identical, now `APPROVAL_FRAME.closePreview/closeFailed`). In the browser preview it says so
  in a toast. It calls no wallet command (test).
- **Deal heading**: a corner `Seal` beside the title (state from the phase: needs / holding /
  stopped / quiet / watching; never "paid", a seal is no receipt; plain label from `APPROVAL_SEAL`),
  a module kicker, the title in the display face (18px, regular). The twin header is drawn as the
  console's facts strip (tick-ruled hairline, uppercase labels, Sofia Sans figures). The answer
  sentence, "What happens next", checks, "If you do nothing" line and footer are unchanged.
- **Motion**: the window arrives like a console layer (`--dur-sheet`, `--ease-out`, rise and settle);
  calm and reduced motion crossfade at `--dur-med` (same rule as `.cs-layer`). Focus return on close
  stays Rust's.
- **Lock / unlock step**: `.lockcard` and `.hello` restyled as small plates of the sheet (rail, the
  glyph in a disc, machined radii). Text and buttons unchanged.
- Machined radii (tokens) replace the px radii left in `frame.css`.

### Hold: HoldButton is now HoldGesture's face
`shared/ui/hold.tsx` keeps the `HoldButton` API, the `ui-hold` class and `holdWord`; its internals are
the WP1a `HoldGesture` (Space only, 1200 ms, `onComplete` once, rosette, `role="progressbar"` with
`aria-valuenow`, calm quarter steps). `shared/ui/hold.test.tsx` (8), `actions.test.tsx` and every
approval test pass unchanged. Behaviour differences, all toward safety: losing focus cancels a hold;
a key-repeat Space is swallowed; a released hold drains visually (no effect on the rule). Screen-reader
words come from `HOLD_WORDS` (same strings as before plus "Hold progress"). Checked in the browser:
a held Space shows ~60% at 650 ms and records the approval after the full hold.

### Tumbler
Calibre tokens checked in all forms (rest, tab, ticker, card, stack, handoff, welcome; plus mismatch
and locked cards), dark and light: no visible regression, sizes unchanged (v2 sizes block kept,
13px body). Added the brand `Mark` (reticle in a ticked bezel, `MARK_D`) engraved faintly in the
puck's well under the count, inside 88 x 88 (gold when the ring is gold). Attention colours were
already semantic tokens (no literal outside `tokens.css`). Guards (no counterparty text, no focus
stealing) untouched.

### Design layer hygiene
- Removed aliases nothing reads: `--on-accent`, `--sans` (grepped `src/**`; every other alias is
  still read: `--accent` by `windows/main/legacy.css`, `--r/--r-sm/--r-lg/--t-fast/--t-med/--red/--label`
  widely). `tokens.test.ts` drops `on-accent` from the v2 list and pins the removal.
- `tokens.css` header documents the scale (type, space, sizes, radii, motion, layers) and the
  one-theme rule.
- `ui.css`: the two forced-colors blocks merged into one, moved last in the file (so it wins at equal
  specificity, as the second block did). The `.ui-btn:not(...)` overrides stay where they are, with a
  comment: folding them into the controls would lower their specificity and change contextual button
  rules in the windows. The old fill bar of `.ui-hold` is replaced by the compact HoldGesture rules.
- `legacy.css` lives in `windows/main` and is still imported by `windows/main/ui.tsx`: left alone.

### Fonts and bundle
`vite build` emits the four woff2 files with hashed names (`archivo-latin-standard-normal-DY7AcnAa.woff2`
etc.) and the built `base-*.css` references them as `url(./<hashed>.woff2)` in the same `assets/`
folder, so the Tauri `dist` path resolves them. Fonts are 235,184 B of `dist`, unchanged by WP4b.

Initial load per entry (HTML's script + modulepreload + stylesheets, gzip), baseline = build of this
worktree at the start of WP4b (with WP3 committed), after = final build (includes WP4a's concurrent work):

| entry | baseline gz | after gz | raw after |
|---|---|---|---|
| main (index) | 237.3 KB | 244.9 KB | 851.4 KB |
| tumbler | 153.6 KB | 154.5 KB | 505.0 KB |
| approval | 166.9 KB | 171.9 KB | 582.5 KB |
| director | 79.8 KB | 79.8 KB | 259.0 KB |

`dist` total 1950.6 KB → 1964.6 KB. No entry is over 500 KB gz. Approval's +5 KB is the Seal, brand
geometry and HoldGesture now in its entry chunk; main's change is mostly WP4a's.

## Gates (at hand-off)
- `pnpm typecheck`: clean.
- `pnpm exec vitest run`: 139 files, 1431 tests, all passed (includes the new
  `windows/approval/frame.test.tsx`, 7 tests, and the new tokens test).
- `pnpm build`: passes.
- Rust diff vs 859fa04: empty.

## Screenshots reviewed (scratchpad `wp4b-shots/`, preview port 5297)
Approval at 744 x 660, dark and light, top and scrolled end: accept (D-0193), band / price range
(D-0204), mismatch (D-0199), shield release (D-0198), rescue approve (D-0188, D-0182), seller waiting
(D-0189), pay a hold (D-0190), locked review (`?locked=1`), owner setup home, keys (`target=credentials`),
rules (`target=mandate`), unlock (`target=unlock&locked=1`), pairing confirm (an injected pending
pairing). Hold mid-gesture and after. Tumbler: all forms above, dark and light. Fixed during review:
the crumbs cut "Counter" beside Details and Back (tracking reduced); the heading's item name was cut
at 22px (now 18px). `before-*` shots are the pre-WP4b window for comparison.

## Open / for the Director
1. **Strip wording.** The brief said "the one place money is authorised"; UX-GUIDE keeps
   "authorization" internal (it maps to "On hold at PayPal") and the app's copy says "approve", so the
   strip reads "the one place money is approved". One string in `lib/words/approval.ts` if the owner
   wants otherwise.
2. **Comments outside my files** still say the approval window is always dark: `lib/theme.ts` header
   and `director/Director.tsx` line ~420, `docs/features/preview-and-director.md`, STATUS. Behaviour now:
   it follows the theme. DECISIONS needs a line ("one app, one theme": approval follows theme and calm).
3. The Tumbler stack form shows a sliver of its fourth row above "If you walk away" (a scroll hint,
   as before WP4b); not changed.
4. `frame.css` still carries v2 rem-sized atoms (`.a-big`, `.strip`, `.tbtn`) used by older owner
   pieces; radii were tokenised, sizes left (no layout change in this package).

## Files
- new: `apps/desktop/client/src/lib/words/approval.ts`, `apps/desktop/client/src/windows/approval/frame.test.tsx`, this note
- edited: `lib/words.ts` (one export line); `design/motion.ts`, `design/tokens.css`, `design/tokens.test.ts`,
  `design/ui.css`; `shared/ui/hold.tsx`, `shared/ui/ThemeSwitch.tsx` (comment), `shared/ui/README.md`;
  `windows/approval/{App.tsx, entry.tsx, ui.tsx, DealReview.tsx, review/Parts.tsx, frame.css, approval.css, owner.css}`;
  `windows/tumbler/{entry.tsx, Puck.tsx, tumbler.css}`
