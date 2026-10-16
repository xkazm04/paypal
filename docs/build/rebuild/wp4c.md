# WP4c - docs and the takes rig on the console (notes for the Director)

Scope: docs, `apps/desktop/client/src/director/**`, `scripts/takes.mjs`, one comment block in
`src/lib/theme.ts`. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority, capability, mock or
`windows/*` change (`git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri` is empty).
No dependency added. Nothing committed. `windows/main/console/perf.test.tsx` shows as modified in
the tree: not mine (it changed while I worked).

## 1. Docs (done first)

- `docs/build/STATUS.md`: new section "Console rebuild (2026-10-14; client only; DECISIONS.md
  section 40)": per package (WP0 to WP4c with commits), gates, perf, scale findings fixed,
  dependencies (TanStack Query 5.104.2 and Virtual 3.14.18 added, zustand removed; Archivo 2.001 and
  Sofia Sans 4.101, OFL 1.1, 235,184 B, licence files), deviations, open items from every package
  note that are still open, UNVERIFIED (nothing new), known gaps.
- `docs/build/SCALE-FINDINGS.md`: a "rebuild (2026-10-14)" column on every row (Fixed / Fixed in the
  client / n/a, one line each) and a short "The console rebuild" paragraph.
- `docs/build/DECISIONS.md`: section 40 "The console rebuild: one window, one theme, the approval
  window stays separate" with the calm-nested-ui decisions (Set up page, docked approval
  onboarding, summary + nested detail) recorded for the first time, then baseline branch, replace
  in place, scope, IPC frozen, TanStack, bundled fonts, small Dial kept, one window / one theme,
  hold Space-only, Latest strips, `&v=` / `&dv=`, the stricter footer figure; tests that hold it.
- `docs/ux/UX-GUIDE.md`: the per-area words files, a "The console" section (centre, seal, bead
  strip, tabs, layers and depth, module summary, Latest strip, lists, footer, one theme), six
  vocabulary rows (Paid out today vs Budget used today, the week's lists, the charter, the approval
  strip and Back to The Table, Later), visual language (Calibre theme, faces, LEDs, 14 px body),
  checklist extended (both sizes and scales, dead band, layer rules, area words guards).
- `docs/ux/UX-AUDIT.md`: "The console rebuild (2026-10-14)" section: what changed for Maya, the
  checks that guard it, leftovers.
- `README.md`: the Rewind is no longer "on the Dial"; the console is listed; a new row for
  `prototype/console-calibre/` as the design record; `prototype/main` is "earlier ... superseded as
  the home"; "How the design was chosen" says the home is now the decision centre with a small Dial.
  `prototype/tumbler` was never cited as the Dial (only as the Tumbler prototype): unchanged.
- `docs/design/window-duality.md`: one "Visual note" under the window table (skin only; approval
  is the console's front sheet; all three windows follow the theme; W1-W11 unchanged).
- `docs/features/preview-and-director.md`: the approval window follows the theme; code splitting
  describes the console's layer parts; the error-boundary gap is closed; the code-splitting row.
- `src/lib/theme.ts` header, `director/Director.tsx` (one comment), `scripts/takes.mjs` (one
  comment): no "always dark approval window" left (grep).

## 2. Takes rig

Baseline on the console before any change: Maya's week 3 of 22 beats broken (`intro`, `end`: "This
week"; `haggle-trade`: "$290.00"), First run 5 of 15 (`start`, `table-hub`, `table-steps`,
`table-engine`, `end`: the four-step title and step states in The Table).

Changed (stories keep 22 beats ending at 182 s and 15 beats at 94 s; no beat, time, action or
route changed, so `beats.test.ts` / `stories.test.ts` constraints are untouched):
- `takes.ts`: `intro` and `end` expect the decision centre (`CENTRE_TITLE`, `IF_NOTHING`,
  `SAFE_DEFAULT_LINE`); `haggle-trade` expects her latest $314.00, "Most you’ll pay $340.00",
  "Offers used 3 of 6", still no $327.00 (the deal page shows the latest moments first; the $290
  opening is one view down). First run: The Table's step list is titled `CHARTER_TITLE`; new
  `CHARTER_LINES` and `charterSteps(classes)` read the charter's five lines (keys, rules, practice,
  agent, unlock) as the four steps (done / waiting or `cur` = next / todo / unknown; unlock maps to
  none).
- `Director.tsx`: `frameSteps` also reads `ol.ch-fields > li` through `charterSteps`.
- `firstRunStory.ts`: four captions now say "charter" / "five short lines" / "line four" / "a line
  marked signed" instead of Home's four steps and ticks; the header comment.
- `director.css`: the approval frame's bar follows the light theme (it was hard dark, and the frame
  forced `color-scheme: dark` on the approval iframe); the bar note is readable on light.
- `takes.mjs`: the stale `.home.intro` wait is gone (every finite animation is still awaited).
- `takes.test.ts`: centre text instead of "This week"; the charter title; a test for
  `charterSteps` that also pins `CHARTER_LINES` equal to `SETUP_STEPS`.

Playwright: not installed globally for Node. The rig ran through Playwright for Python's bundled
Node driver: `PLAYWRIGHT=C:/Users/mkdol/AppData/Roaming/Python/Python314/site-packages/playwright/driver/package/index.mjs`
(documented in the director README).

Results (`--url` against my own vite on 1463, stopped afterwards):
- `takes --check`: **all 22 beats show their end state**; `takes --check --story first-run`:
  **all 15 beats**. No page or console error.
- `--stills`: Maya dark + light (44) and First run dark (15) in scratchpad `wp4c-stills/`. Read:
  00-intro, 02-haggle-trade, 04-haggle-gate (a decision), 06-haggle-review dark and light (the
  approval frame), 13-mismatch-review light, 19-end-table (a deal), 20-end-safety, 21-end light
  (closing), First run 01-table-hub (the charter), 10-approval-only, 14-end. Fixed from them: the
  approval frame bar in light (above).

## 3. Gates (from `apps/desktop/client`)

- `pnpm typecheck`: clean.
- `pnpm exec vitest run src/director src/lib`: **31 files, 241 tests, all passed**.
- Full `pnpm test` / `scripts/check.ps1`: not run by me (the Director runs it concurrently).

## 4. Could not do / open questions

1. **No Rewind and no module summary in either story.** The brief asked to read a Rewind and a
   module still; no beat visits them (Maya's beats: centre, deals, the safety record; First run:
   the charter). Adding a beat changes both the story and its tests; not done. Want a Rewind beat
   (for example at `end-table`, `#r=rewind`)? `beats.test.ts` would need its route pattern widened.
2. **Four steps vs five lines.** The approval window's owner page still says "Your first safe deal
   in 4 steps" while The Table's charter has five lines (unlock is the fifth). Copy there is WP4b's
   "restyle only"; the First run captions now avoid the number for the approval window.
3. **The tour's coach mark on the charter** covers part of the "What signing the charter means"
   lines and the footer's "Preview · sample data" badge at 1280 x 800 (`01-table-hub`). The badge is
   still in the window's text (the check passes) but half hidden in a still. App-level (shared tour
   placement), not the director frame.
4. Crumbs truncate in the deal stills ("What needs …", "Spe…") at 1280 px; app-level, as WP4a left it.
5. The director's approval frame title reads "only here can money be agreed" while the window's own
   strip reads "the one place money is approved"; left as is (the frame is the director's chrome).
6. The demo video is not re-recorded (`--video` not run); stills and checks only.

## 5. Files

Changed: `README.md`, `docs/build/{STATUS,DECISIONS,SCALE-FINDINGS}.md`, `docs/ux/{UX-GUIDE,UX-AUDIT}.md`,
`docs/design/window-duality.md`, `docs/features/preview-and-director.md`,
`apps/desktop/client/scripts/takes.mjs`, `apps/desktop/client/src/director/{Director.tsx, README.md,
director.css, firstRunStory.ts, takes.ts, takes.test.ts}`, `apps/desktop/client/src/lib/theme.ts`
(comment). New: this note.
