# WP1a: Calibre design layer (notes for the Director)

Scope: `apps/desktop/client/src/design/**`, `src/shared/ui/**`, new `src/shared/brand/**`, fonts under
`src/assets/fonts/**`. No Rust, bindings, authority, capability, `lib/*` or `windows/*` change
(`git diff --stat c4bbe5b -- crates bindings apps/desktop/src-tauri` is empty). `lib/mount.tsx` was
not touched by WP1a: fonts load through `design/base.css` (`@import './fonts.css'`), which every
entry already imports (main, approval, tumbler and the director preview).

## What changed

### Tokens (`src/design/tokens.css`, v3 "Calibre")
- Night (default) and day (`[data-theme="light"]`) palettes ported from
  `prototype/console-calibre/theme.css`: blue-black slate surfaces, cool steel inks, teal signal.
  Fixed meanings kept (teal yours, coral theirs, gold needs you / PayPal, green settled, red refused).
- Changed from the prototype to pass AA (`lib/contrast.test.ts` and the new `design/tokens.test.ts`):
  day `--muted #364554`, `--dim #46556a`, `--coral-l #923518`, `--gold-l #644a06`, `--red-l #9a2629`,
  `--ok #0f5f31`, `--panel3 #dde4ea`; night `--on-teal #06201d`.
- Day theme selection and focus stay PayPal blue (`--pp-blue`), as `contrast.test.ts` and
  `tour.test.tsx` assume; the other `--pp-*` remain brand constants (UNVERIFIED, as before).
- Six module colours as OKLCH at one lightness (night L .80 C .105, day L .48; Book near-neutral).
- New Calibre tokens: `--bg-deep --micro --gold-d --foil-d --red --signal --sheet --sheet-hi
  --sheet-lo --pile-hi --pile-edge --tab --tab-mix --tab-lo --tab-on --disc --well --toolbar --quar
  --ink-0 --shadow-ink --hi --ink-max --seal --grat --grat-major --vignette --glow-signal
  --glow-gold --label --label-stretch --sans --fs-micro --fw-light --fw-display --track-display
  --track-label --track-money --sp-10 --sp-12 --sp-16 --target --grat-pitch --r-tight --r-card
  --r-pill --r-sheet`.
- Type: body 14px (`--fs-body`, so `1rem = 14px`), floor 12px; titles 16/18/22, display 30.
  Controls `--ctl 28px`, `--ctl-sm 24px` (the 24px target), rows 30/46, bar 40.
- Motion, named (replacing the prototype's magic delays): easings `--ease --ease-out --ease-in
  --ease-linear`; `--dur-instant 80ms --dur-fast 120ms --dur-med 200ms --dur-slow 380ms
  --dur-sheet 460ms`; `--hold-ms 1200ms`, `--seal-settle-ms 460ms`, `--readout-ms 900ms`,
  `--toast-ms 3600ms`; sweeps `--sweep-quiet 54s --sweep 18s --sweep-needs 9s`. The same values in
  code: `src/design/motion.ts` (`HOLD_MS`, `HOLD_DRAIN_MS`, `DUR`, `isCalm`, `setCalm`, `useCalm`,
  `motionMs`); `tokens.test.ts` keeps CSS and code equal.
- **The Tumbler keeps the v2 sizes** (`:root:has(> body.w-tumbler)`: 13px body, v2 titles, ctl 26/22,
  row 28/44, bar 38). Its forms are fixed grids in 440 x 152-336 px native windows; 14px would
  break their row heights. Colours, faces, radii and motion are Calibre there too.

### Aliases (every v2 token name still resolves)
All 94 v2 names are defined (checked by `tokens.test.ts`). Those that now point at a Calibre value:

| v2 name | now |
|---|---|
| `--r-sm` / `--r` / `--r-lg` | `.2rem` / `var(--r-card)` .25rem / `var(--r-sheet)` .35rem (were 5/8/11 px) |
| `--t-fast` / `--t-med` | `var(--dur-fast)` / `var(--dur-med)` |
| `--accent` / `--on-accent` | `var(--teal)` / `var(--on-teal)` (unchanged) |
| `--refuse` | the Calibre red; `--red` is new and aliases it |
| `--font` / `--display` | `"Archivo"` + system fallbacks |
| `--num` | `"Sofia Sans"` + Bahnschrift/DIN/system fallbacks (was the UI font) |
| `--mono` | Cascadia Mono first, system mono stack |
| `--scrim`, `--shadow-1/2/3`, `--material` | `color-mix()` of `--ink-0` / `--shadow-ink` (no rgba literals) |

### Fonts (`src/assets/fonts/`, `src/design/fonts.css`)
| Face | Role | Version | Files (latin + latin-ext, woff2) | Licence |
|---|---|---|---|---|
| Archivo (Omnibus-Type) | UI and display; labels use its semi-condensed cut via `font-stretch: var(--label-stretch)` (87.5%) | 2.001 (Google Fonts v25, via @fontsource-variable/archivo 5.3.0) | variable wght 100-900 + wdth 62-125: 90,104 + 86,240 B | SIL OFL 1.1, `archivo/OFL.txt` |
| Sofia Sans (Lettersoup) | Numerals: money, counts, times (DIN-like figures, closest open match to the prototype's Bahnschrift) | 4.101 (Google Fonts v20, via @fontsource-variable/sofia-sans 5.3.0) | variable wght 1-1000: 40,372 + 18,468 B | SIL OFL 1.1, `sofia-sans/OFL.txt` |

Total 235,184 B (230 KB; target < 600 KB). `font-display: swap`, split by `unicode-range`, served
from the bundle (`default-src 'self'` covers fonts); no runtime network. Features checked with
fontTools: both have `tnum`; neither has `onum`, so figures are lining by default (no `lnum`
feature exists or is needed); neither has `zero` (no slashed zero, the prototype asked for it "where
the font has one"). Mono stays a system stack (Cascadia Mono first) for ids, keys, microprint and
untrusted text. The fonts were fetched once from the npm registry at build time by WP1a and are
committed as files; no package was added.

### Base and kit CSS
- `base.css`: Archivo body, `.money`/`.num` in Sofia Sans with `tnum lnum`, new `.display` and
  `.kicker`, square-LED badge indicators, machined radii, the counterparty fence (coral rail on a
  hatched ground, still quoted text only), and the in-app calm class (`calm` on `<html>` or
  `<body>`) stopping motion exactly like `prefers-reduced-motion`.
- `ui.css` (restyled in place, no class renamed): chips with square LEDs and tight radii, lit gold
  plate buttons, ruled meter gauge, sheet plate gradient, calibration bracket on section titles,
  light-weight display numerals, tabular figures on every number, `--hold-ms` for the HoldButton fill.
- `kit.css` (new, imported at the top of `ui.css`): the console kit below.

### Kit (`src/shared/ui`, all v2 exports unchanged)
New: `Stack`, `TabStrip`, `ModuleTab`, `FilterChips`, `Facts`, `ListShell` (with the documented
**`renderRows`** slot and `bodyRef` for WP1b's windowing), `Depth`, `HoldGesture`, `Presence`,
helpers `shownCount`/`UNKNOWN`, `nextTab`, `toggleFilter`, `pileCount`, `holdPhaseWord`,
`shownProgress`. `Crumbs` gained an optional `depth`. `SummaryCard` and `DetailPage` are
restyled by CSS only (module colour rail via `--mc`). Table of props: `src/shared/ui/README.md`.
Every user-facing string is a prop; the kit holds no copy of its own.

`HoldGesture` never calls a command: one full unbroken hold calls `onComplete` once. Pointer hold
or held Space; Enter (default prevented), click, short press, right button, leaving, blur and
`disabled` never complete; disabling re-arms it. `role="progressbar"` gauge with `aria-valuenow`;
one phase word in a polite live region (never a running number). Calm/reduced motion: the full
hold time still applies, the rosette fills in quarter steps and the release drain is instant.

### Brand (`src/shared/brand`, new)
`Seal` (states quiet/watching/needs/holding/paid/stopped, `progress` = fraction of a deadline left
drawn as the gold arc, optional microprint `ring`, sizes centre/corner), `Mark`, `Rosette`,
`Graticule` (CSS gradients only), `KeyArt` (six calibration plates, line-work ported from
`deco.js`), `DialStrip` (the small Dial kept as presence: one segment per module, beads in
`ChipTone`s, "+n" tail, fed only by props). Pure geometry in `geometry.ts`. React elements only
(no innerHTML, no data-URI builders); `role="img"` with a caller-given label, parts `aria-hidden`;
all motion stops under reduced motion and the calm class. The dial is sized to keep its deadline
arc inside its box (no scroll overflow).

## Tests (behaviour, not markup)
`design/tokens.test.ts` (13: v2 names, type floor, targets, AA on the new sheet surfaces and filled
controls in both themes, motion CSS = code, fonts present/licensed/local/swap/< 600 KB),
`shared/ui/holdGesture.test.tsx` (13), `shared/ui/console.test.tsx` (16, incl. Presence with fake
timers), `shared/brand/brand.test.tsx` (13).

Gates at hand-off: `pnpm typecheck` clean; `pnpm exec vitest run`: 117 files, 1227 tests, all
passed (includes WP1b's files in this worktree). `lib/contrast.test.ts` green in both themes.

## Screenshots reviewed (scratchpad `wp1a-shots/`)
Approval (home and a deal review at 744 x 660), Tumbler (simulated desktop; welcome and hand-off
forms), main (Dial home, Spend, Book) in dark and light at 1280 x 800, and a throwaway kit gallery
(deleted). Fixed during review: the presence strip overflowed (now wraps); the seal's arc and glow
overflowed their box (dial now inset); the Tumbler's fixed forms (v2 sizes kept, above). The hand-off
form's silence line wraps under the puck in both the old and the new type (checked with the old
font); not a WP1a regression.

## Open / for the Director
1. **Enter on the hold.** The WP1a brief says "Space/Enter"; the shipped rule (HoldButton,
   docs/ux ROUND-2, the approval window's "Enter never releases money") is Space only, and
   HoldGesture follows it. Allowing a held Enter is a one-line change if the owner wants it.
2. **Strings.** WP1a did not edit `lib/words.ts` (outside its scope); the new components take
   every string as a prop. Whoever wires them adds the words (hold hint, progress label,
   "Keep holding", "Confirmed", waiting badge, seal labels, key-art labels, microprint).
3. **Main window at 14px**: the current Dial home's left column ("This week") now reaches the
   footer at 1280 x 800 in light; main is being rebuilt, so left as is.
4. `HoldButton` (approval) is unchanged in behaviour and only restyled; switching the approval
   window to `HoldGesture` is a layout change and belongs to a later package.
5. Prototype "slashed zero": neither open face has `zero`; amounts render without it.

## Files
- `apps/desktop/client/src/design/tokens.css` (rewritten), `base.css`, `ui.css` (edited),
  `fonts.css`, `kit.css`, `motion.ts`, `tokens.test.ts` (new)
- `apps/desktop/client/src/assets/fonts/archivo/{archivo-latin-standard-normal.woff2, archivo-latin-ext-standard-normal.woff2, OFL.txt}`
- `apps/desktop/client/src/assets/fonts/sofia-sans/{sofia-sans-latin-wght-normal.woff2, sofia-sans-latin-ext-wght-normal.woff2, OFL.txt}`
- `apps/desktop/client/src/shared/ui/console.tsx`, `HoldGesture.tsx`, `Presence.tsx`,
  `console.test.tsx`, `holdGesture.test.tsx` (new); `components.tsx` (Crumbs `depth`),
  `index.ts` (exports), `README.md` (kit table)
- `apps/desktop/client/src/shared/brand/{geometry.ts, Seal.tsx, Mark.tsx, Rosette.tsx, Graticule.tsx, KeyArt.tsx, DialStrip.tsx, brand.css, index.ts, brand.test.tsx}` (new)
