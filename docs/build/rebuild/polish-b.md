# Polish wave, builder B: demo mode switcher in the footer (notes for the Director)

Scope: `apps/desktop/client/src/**` only. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority,
capability, CSP or binding change from this package. No dependency added.

## What it does
The main window's footer has a "Demo" group. The owner (or anyone looking at the app) picks a sample
world: Small shop, Busy merchant, First run, Sample week (the default fixtures, Maya's week), and
under "More": Older app version (the degraded world), Locked, Reset sample data (asks first). The
window shows a calm overlay ("Switching to the busy merchant sample") and reloads at the centre;
theme and calm motion are kept (they are stored on their own). The chip names the world plainly
("Sample week", "Busy merchant").

- **Desktop app**: demo is OFF by default. The choice is kept in `localStorage['table-demo']`
  (`off`, or `small|large|first_run|sample` with `+degrade` / `+locked`), read once at startup.
  While on: a persistent amber badge "Demo · sample data · nothing is paid" (it replaces the browser
  preview badge there), the world chip, and "Exit demo". "Live wallet" in the popover also goes back.
- **Browser preview**: always on sample data, as before. The address is the truth (`?scale=`,
  `?first_run=1`, `?degrade=1`, `?locked=1`); the switcher reflects it and rewrites it. No "Live" and
  no "Exit demo". `table-demo` is never read or written in a browser, so the director, Playwright and
  a plain `index.html` stay deterministic.
- **Sample approval (Director decision, after the first round)**: in demo mode (desktop and
  browser, top-level main window) `approval_open` navigates the SAME webview to the approval page,
  `approval.html` with the deal/target and the world's parameters plus `demo=1`, after storing the
  main window's address (route hash included) in `sessionStorage['table-demo-return']`. The page is
  the real approval app on the mock, with a strip across the top: "Demo approval · simulated ·
  nothing is paid". "Back to The Table" and Esc (not inside a field, not taken by one of its own
  layers) go back to that address, so the prior route is restored. No iframe, no CSP change. In the
  real, non-demo flow nothing changes: the approval window still closes with `getCurrentWindow().close()`.
- **Fallback**: if the sample data (the mock chunk) cannot load in the desktop app, `table-demo` is
  set to `off`, a one-time note is left, and the page reloads once into the live wallet, where the
  footer shows "The sample data couldn't open, so this is your live wallet. Nothing in it changed."
  `sessionStorage['table-demo-fallback']` guards the loop: a second failure in the same session goes
  live in place without reloading (the shell is not sealed before the mock loaded, so that is safe).
  The sample approval page, on the same failure, goes back to `index.html` instead.
- **Find**: "Demo: ..." entries mirror the switcher (the other worlds, "Demo: Live wallet" in a
  desktop demo, the two flags on a world), group "places", applied through the same overlay.

## Design
- `lib/preview.ts` (pure, dependency-free): `parseDemo` / `formatDemo`, `demoFromSearch`,
  `withDemoSearch`, `resolveDemo(env)` - the one rule, `pinDemo` / `pinnedDemo`, `previewSearch()`,
  `demoPageUrl`, `demoNow()`, `openDemoApproval`, `demoApprovalPage`, `leaveDemoApproval`,
  `takeDemoNotice`. Rule: a browser page is always demo (world from the address). In the desktop
  app only the main window, top level, reads the stored choice; the approval page follows it only
  when it is marked `demo=1` AND this webview's session carries the return address the demo main
  window left (the real approval window is a separate webview with its own session and no marker).
  The Tumbler and the real approval window are live whatever is stored. Unreadable values are live.
- `firstRunPreview()` / `scalePreview()` default to `previewSearch()` (the page's address, plus the
  stored world in a desktop demo), so the mock, the tour key and the badges agree in a desktop demo.
  In a browser `previewSearch()` is `location.search`, unchanged.
- `lib/runtime.ts initBackend(label, env?, deps?)`: resolves and pins the choice; live =
  `tauriBackend()` as before; demo = the lazily imported mock, then **seals the shell** in the
  desktop app (`sealShell`: `__TAURI_INTERNALS__.invoke` / `.ipc` replaced by a rejecting function;
  skipped silently per property if the shell made it read-only, Director answer 2). `demoOpener`:
  the top-level main window goes to the sample approval (`openDemoApproval`); in the desktop app it
  opens no other window; the sample approval goes back where it would open a window; any other page
  (browser Tumbler, director frames) keeps `window.open`. `deps` (`loadMock`, `reload`, `go`) are test
  seams. The fallback is `fallBackToLive`.
- `mock/backend.ts` (extend only): `mockBackend(label, { open? })`; `degraded()` and `params` read
  `previewSearch()`; new `resetMockWorld()` clears only the current world's stored state.
- Footer extracted into `console/Footer.tsx` + `footer.css` (`Console.tsx` renders
  `<Footer onSettings onHelp />`); it also shows the fallback note once (toast).
- `console/DemoSwitch.tsx`: the group (`role="group"`, `aria-label="Sample data"`), chip
  (`aria-haspopup="dialog"`, `aria-expanded`) and the shared `Popover` (focus inside, Esc via the
  layer stack, focus back to the chip); options are buttons with `aria-pressed`; "More" is a
  `details`; the reset confirm is inline. `switchDemo(next)` is a tiny store so Find, the Charter and
  Settings use the same overlay; the switch applies after two animation frames (one paint), not a
  timer. Hidden in a framed main window (the director plays a story there).
- `windows/approval/DemoStrip.tsx` + `demo-strip.css`: the sticky strip; `entry.tsx` mounts
  `withDemoStrip(App)` (the strip renders nothing unless this page is the sample approval).
- `lib/words/demo.ts` (re-exported by one line at the end of `lib/words.ts`).

## Touched outside my listed files (small, flagged)
- `windows/approval/ui.tsx closeThisWindow`: on a non-tauri backend it first tries
  `leaveDemoApproval()`, else the old preview note; the tauri path is unchanged.
- `windows/approval/entry.tsx`: `mount('approval', withDemoStrip(App))`.
- `windows/main/console/findIndex.ts` (FindTarget gains `{kind:'demo'}`), `Find.tsx`
  (`...demoFindItems()`), `Console.tsx` (`case 'demo'`, footer import) - one line each.
- `windows/main/setup/Charter.tsx skipToSample` and `console/areas/settings/SettingsLayer.tsx
  showFirstRun`: they rewrote `?first_run=` themselves, which does nothing in a desktop demo. They
  now call `switchDemo(...)`; in a browser the result is the same address.

## How the owner uses it in the desktop app
Footer, "Demo" chip -> pick a sample -> the window reloads on it, badge and "Exit demo" in the
footer. A review or the lock button opens the sample approval in the same window, with the strip;
"Back to The Table" or Esc returns to where you were. "Exit demo" (or Find, "Demo: Live wallet") ->
the live wallet. Reset sample data (under More) starts the current sample over.

## Limits
1. Sealing the shell is best effort per property [R] (kept as is, Director answer 2). The
   structural guarantee: in demo the backend is the mock, `tauriBackend()` is never constructed, and
   `@tauri-apps/api` is imported only by `lib/tauri.ts` and the approval window's close (which
   returns early on a non-tauri backend). Tested with a writable fake.
2. The Tumbler and the real approval window never show demo data; the popover says so. Events the
   shell sends to the main window (e.g. a Tumbler click routing to a deal) are not heard in demo.
3. On the sample approval page the approval app's own preview badge ("Preview · sample data") still
   shows next to the mode badge; the strip above it is the demo statement.
4. Navigating the main webview to `approval.html` in the desktop app uses the same origin and the
   main window's label and capabilities; the page is on the mock with the shell sealed, so it calls
   nothing. Not run in the native shell by me (no native run in this package) [R].
5. Bundle: the mock and `mock/scale.ts` stay in the lazily loaded `backend-*.js` chunk (105.6 kB),
   not in the main entry's initial files (checked by a string from scale.ts). Main entry initial
   files: HEAD 84cfa96 875,952 B (252,546 B gzip) -> worktree (first round) 908,023 B (266,275 B
   gzip), which includes builders A and C's work in progress; mine about 8 kB switcher, 3.5 kB words
   and preview code, 3 kB CSS (the removed sheet makes it slightly smaller now).
6. `git diff --stat c4bbe5b -- crates bindings apps/desktop/src-tauri` is NOT empty:
   `apps/desktop/src-tauri/icons/icon.ico` changed (the logo work, not this package).

## Tests (all behavioural)
- `src/lib/demo.test.ts` (19): stored form round-trip, unreadable = live; address -> world;
  rewriting only world parameters; `resolveDemo` precedence (browser: address; desktop: stored beats
  address; Tumbler, real approval, an unmarked approval, a marked approval without the return
  address, a framed main = live; the sample approval with marker and return address follows);
  `previewSearch` feeding `firstRunPreview` / `scalePreview`; the sample approval URL; runtime: demo
  off reaches the (fake) shell; demo on never reaches it, by the backend or by `@tauri-apps/api/core`
  `invoke` directly (`DEMO_SEALED`), `approval_open` navigates to the sample approval (no window) and
  stores the return address with the route, no fetch / XHR / WebSocket; switching off restores the
  shell; Tumbler and real approval stay live; the sample approval's approve (`deal_owner_accept`) is
  recorded on the mock with no shell, network or window; Back returns to the stored route once; the
  real approval window is never the sample approval; fallback clears the choice, reloads once, goes
  live and notes once; no reload loop on a second failure; a browser load error is not hidden;
  browser framed main keeps `window.open`; browser top-level navigates in place.
- `src/windows/main/console/demo.test.tsx` (16): switcher group, badge, chip names, popover focus /
  Esc / focus back, option order and `aria-pressed`, world -> overlay -> injected reload, Exit demo
  and Live wallet, More toggles and reset confirm, unavailable samples, a switch from Find; the strip
  only on the sample approval (not without the return address, not live) and the entry wiring; Find
  entries per mode and wiring; words: no internals, PayPal the only vendor, "nothing is paid",
  sentence case.
- Playwright (scratchpad `layout_b.py`, `nav_b.py`): footer at 1280x800 / 1920x1080 in four modes,
  no overlap or clipping; desktop demo (fake shell): gold action -> `approval.html?...&demo=1` with
  the strip, Esc -> `index.html`; locked demo from `#p=rules`, lock button -> sample approval, "Back
  to The Table" -> `index.html#p=rules` with the rules layer; zero calls to the fake shell in demo;
  mock chunk blocked -> `table-demo=off`, live wallet with the one-line note; browser approval and back
  keep `?scale=small`.

## Screenshots (scratchpad `polish-b-shots/`, all read)
Each world in the browser (both themes, 1280 and 1920), the desktop demo footer, the popover
closed/open/More open, the sample approval page (light 1280; locked dark 1920), back to the rules
layer, the fallback note, locked and degraded demos, first-run demo, the browser popover, the
director page (switcher hidden in its framed main window). No console errors except the fake
shell's own rejections on the live fallback run.

## Files
New: `src/lib/words/demo.ts`, `src/lib/demo.test.ts`,
`src/windows/main/console/{Footer.tsx, footer.css, DemoSwitch.tsx, demo.test.tsx}`,
`src/windows/approval/{DemoStrip.tsx, demo-strip.css}`, this note.
Changed: `src/lib/{preview.ts, runtime.ts, words.ts (one line)}`, `src/mock/backend.ts` (extend),
`src/windows/main/console/{Console.tsx, console.css (footer rules moved out), Find.tsx, findIndex.ts}`,
`src/windows/approval/{ui.tsx, entry.tsx}`, `src/windows/main/setup/Charter.tsx`,
`src/windows/main/console/areas/settings/SettingsLayer.tsx`.
Removed (first round only, never committed): `console/DemoApproval.tsx` (the iframe sheet).
