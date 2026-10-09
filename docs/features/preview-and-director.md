# Browser preview and the "Maya's week" director

The same React client that runs inside the desktop shell also runs in a plain browser on a mock
backend with sample data. This is how designers review screens, how tests drive the windows, and
how a judge can watch the product with nothing installed: `director.html` plays "Maya's week"
across all three windows (The Table, the Tumbler, the approval window) with captions and a
simulated clock. The preview is never the wallet. It shows a "Preview · sample data" badge in every
window, the director carries a permanent banner, no PayPal page is ever shown, and no script or
beat can approve, pay, capture or release anything. This page also covers how the client is split
into chunks so each window paints fast.

## What the owner (or a judge) sees

**Any window in a browser** (`pnpm --dir apps/desktop/client dev`, then `http://localhost:1430/`
with `index.html`, `tumbler.html` or `approval.html`): the real window on sample data, with the
"Preview · sample data" badge. The Tumbler is drawn inside a labelled preview stage (a stylised
desktop with the puck in a corner and controls that simulate what the wallet core would emit).

**The director** (`/director.html`, or a static `dist` build served from anywhere):
- A stage with the three windows framed at their native sizes (The Table 1280 × 800, the approval
  window 744 × 660, the Tumbler in a corner), dark or light following the theme switch (The Table and the Tumbler
  follow it, live across windows; the approval window stays dark).
- A camera that follows each beat, a caption rail with the simulated time, play / pause /
  previous / next / restart (Space, ←, →, Home) and a per-chapter scrubber.
- The banner: "Browser preview with sample data — not the wallet. No PayPal page is ever shown."
- The story, in six chapters (opening, the haggle, silence, the mismatch, The Table closed, the
  ending), about three minutes: (a) a haggle reaches Dan's $329 counter, the "ask me above" rule
  sends it to Maya, the Tumbler card appears and the approval window opens, but is never approved;
  (d) the clock runs past the deadline and the haggle is withdrawn by the safe default; (c) a $339
  payment request does not match the $329 deal: a pause and a review with no pay button; (b) The
  Table closes with a payment on hold, days pass, and the hold releases itself. The ending opens
  "Your safety record" (beat `end-safety`, route `#m=book&p=safety`): who decided each money step,
  and that PayPal never heard of a request her rules refused. 22 beats in all.
- URL parameters: `?beat=<index or id>`, `?play=0`, `?camera=desk`, `?date=YYYY-MM-DD` (the story
  starts at 14:02:04 that day), `?take=1` (hides the transport for recordings).

**Preview switches** on any window URL (sample data only):

| Parameter | Effect |
| --- | --- |
| `?first_run=1` | A brand-new wallet in a world of its own (separate store and channel). |
| `?locked=1` | Starts the window idle-locked, for the LOCKED states. |
| `?limits=none` | No wallet limits signed. |
| `?forecast=off` | A shell whose forecast read failed ("Can't forecast right now"). |
| `?groups=none` | No shop-around groups. |
| `?records=broken` | The audit trail reads as broken (the plain-words "check again" sheet), and "Your safety record" reads red with no counts. |
| `?safety=violation` | "Your safety record" names one finding: an authority-less capture on the dock order. |
| `?degrade=1` | An older shell without the newer safe projections. |
| `?deal=`, `?pairing=`, `?target=`, `?draft=` | What an approval window was opened for. |

## How it works

1. **One backend per page.** Each window entry calls `initBackend(label)` (`src/lib/runtime.ts`).
   Inside the shell (`__TAURI_INTERNALS__` present, `isTauri()` in `src/lib/tauri.ts`) it is the real
   IPC. In a browser it dynamically imports `mockBackend(label)` (`src/mock/backend.ts`), so the mock
   and its fixtures are their own chunk and never in a window's initial graph in the shell.
2. **The mock enforces the real gates.** `GATES = AUTHORITY` comes from the generated
   `bindings/authority.ts` (the Rust authority table); one `gate()` checks label, token, idle lock
   (15 minutes, on the simulated clock) and selected deal in the runtime's order, and throws
   `GateError` with the same codes (`PERMISSION`, `LOCKED`). Handlers mirror Rust where the window
   depends on the answer: the six-line checklist and its hash (`mock/checks.ts`), the what-if
   (`mock/simulate.ts` mirrors `validate()` and `check()` with Rust's reason strings), the forecast
   and quit lines (`mock/forecast.ts`), wallet limits (`mock/exposure.ts`), rescue offers and invoice
   text (`mock/rescue.ts`), the first-run world (`mock/firstRun.ts`), the safety record counted
   from the same history `deal_history` serves (`mock/safety.ts`) and 13 comparables per sample
   market record (D-0196 keeps an older record). `unlock` simulates a
   successful OS check. `open_paypal_in_browser` opens nothing: it only moves the Tumbler to its
   hand-off form.
3. **Shared state across windows.** The mock world lives in `localStorage`
   (`the-table-mock-state-v18`, `STORE_KEY`, bumped whenever fixtures change shape; v17 added the
   agents' refused requests in Maya's week, v18 the fair-price certificates on the sample market
   records) and a `BroadcastChannel`
   (`the-table-mock`) carries events and state between the open windows, so an approval in the
   approval window shows up in The Table and the Tumbler.
4. **One clock.** `src/lib/clock.ts` is the only clock (`clockNow`, read by `nowUnix()` and
   `useNow()`). In the shell it is wall time: `simulateClock()` refuses when `__TAURI_INTERNALS__` is
   present and offsets are ignored. In the preview, `mockBackend` turns simulation on; the offset is
   shared through `localStorage['the-table-mock-clock']` and a `{kind:'clock'}` message, and every
   countdown jumps together.
5. **The world can pass time, not move money.** `MockWorld` (`mockBackend(label).world`, preview
   only) has `advance`, `sweep`, `rewind`, `reset` and `emit`. `advance` and `sweep` apply the core's
   deadline defaults (AUTHORIZED → AUTO_VOIDED; PAIRING/LISTED/NEGOTIATING/AGREED → WITHDRAWN;
   SETTLING/AWAITING_APPROVAL/APPROVED → EXPIRED), each with `decided_by` safe default, an audit row
   that cites the recorded attention rungs, and the matching events. It has no money operation.
6. **Beats are data.** `src/director/beats.ts` holds chapters and beats (time, focus, caption,
   actions). `src/director/actions.ts` defines the closed `Action` union (advance, until, rewind,
   form, select, visual, handoff, approved_on_paypal, arrival, refused, lock, main, …) with
   deliberately no approve, pay, capture or release action; `runActions` applies them.
   `src/director/helpers.ts` holds every Tumbler preview control as a beat helper, so the preview
   stage and the director run the same code. `Director.tsx` frames the windows as iframes and
   refuses to run inside the shell (`director/entry.tsx`).
   `director.html?story=first-run` plays a second story, "First run": the onboarding tour on a
   brand-new wallet (`?first_run=1` world), see [Onboarding](./onboarding.md#watch-it).
7. **Takes: a rehearsal rig.** `apps/desktop/client/scripts/takes.mjs` (`pnpm takes`) drives the
   director through the read-only `window.__takes` hook (plan, now, seen, verify, play, pause); it
   never clicks inside a framed window. `--check` runs every beat and fails on a page or console
   error, a missing banner or badge, or a beat whose expected end state (`EXPECT` in
   `src/director/takes.ts`) is not on screen. `--stills <dir> [--theme dark|light|both]` writes one
   1920 × 1080 PNG per beat. `--video <file.webm> [--chapter <n|id>]` records the story and, with
   ffmpeg, retimes it onto the beat file's clock (`src/director/retime.ts`) with a cue sheet. Story
   day 2026-11-05, time zone America/Los_Angeles by default. Playwright is not a dependency; see
   `src/director/README.md`.
   A running Vite dev server does not watch the repo-root `bindings/` folder (aliased as
   `@bindings`), so after regenerating bindings (`cargo run -p table-client --bin
   generate-bindings`) restart the dev server before `pnpm takes --check`; otherwise the new
   `authority.ts` is not seen and pages fail with errors such as "Cannot read properties of
   undefined (reading 'labels')".
8. **Code splitting.** `src/lib/lazy.ts` `lazyPart(load)` behaves like `React.lazy` until its chunk
   arrives, then renders directly (later navigation never suspends); `.preload()` loads once and
   retries after a failure; `preloadWhenIdle(parts)` loads parts after first paint. In `main` the six
   module pages, the Settings / Connections / Agent rules tabs, the quit sheet, the deal page's proof
   tab and sheets, the Rewind scrubber and hub and the Book's proof check are lazy; Home, the Dial and
   the deal page's "What happened" stay in the entry chunk. In `approval` the owner configuration,
   the rules editor with its what-if and the replay sheet are lazy; a deal review stays in the
   entry chunk. Stylesheets stay eager.
9. **Build.** `vite.config.ts` has four inputs (`main`, `tumbler`, `approval`, `director`); no shell
   window points at `director`. The shell's CSP allows only `'self'` scripts and styles and no
   frames, so every page ships as bundled files.

## Safety properties

- **Never the wallet.** The mock is chosen only when the shell is absent; the director and the clock
  simulation refuse inside the shell (`isTauri()`); `clock.test.ts` pins the passthrough.
- **No money action exists in the script.** `beats.test.ts` "never moves money: no action can
  approve, pay, capture, release or sign"; `story.test.ts` checks the whole run never enters a money
  state and every lapse is a safe default.
- **No PayPal page.** The mock's browser hand-off opens nothing; the banner says so on every frame.
- **Same gates as the wallet.** The mock's gate table is generated from the Rust authority table,
  and `mock/authority.test.ts` checks every command for every label, lock and token (over 1000 cells).
- **Honest labelling.** Every window shows the "Preview · sample data" badge; mock payloads say
  sandbox, replay or practice agent; the takes check fails without the banner and badge.
- **No network.** The mock and the director make no network calls; tests never touch the network.

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Backend choice | `apps/desktop/client/src/lib/runtime.ts`, `src/lib/tauri.ts`, `src/lib/contract.ts` | `initBackend`, `backend`, `isTauri`, `Backend` |
| Mock | `src/mock/backend.ts`, `fixtures.ts`, `checks.ts`, `simulate.ts`, `forecast.ts`, `exposure.ts`, `rescue.ts`, `firstRun.ts`, `safety.ts` | `mockBackend`, `MockWorld`, `GateError`, `STORE_KEY`, `CLOCK_KEY`, `mockInject`, `resetMockState`, `buildMockState` |
| Clock | `src/lib/clock.ts`, `src/lib/format.ts`, `src/lib/hooks.ts` | `clockNow`, `simulateClock`, `setClockOffset`, `nowUnix`, `useNow` |
| Badges | `src/shared/honesty.tsx` | `MockBadge`, `ModeBadge`, `RunBadge` |
| Tumbler stage | `src/windows/tumbler/App.tsx`, `preview/Preview.tsx`, `preview/Framed.tsx` | the mock-only stage and the director's bare frame |
| Director | `src/director/Director.tsx`, `entry.tsx`, `beats.ts`, `actions.ts`, `helpers.ts`, `takes.ts`, `retime.ts`, `README.md`, `director.html` | `BEATS`, `CHAPTERS`, `runActions`, `EXPECT`, `checkBeat`, `BANNER`, `MOCK_BADGE`, `retimePlan` |
| Takes rig | `apps/desktop/client/scripts/takes.mjs`, `package.json` (`takes` script) | `--check`, `--stills`, `--video` |
| Code splitting | `src/lib/lazy.ts`, `windows/main/App.tsx`, `windows/main/Home.tsx`, `windows/approval/App.tsx` | `lazyPart`, `preloadWhenIdle`, `HOME_PARTS` |
| Build | `apps/desktop/client/vite.config.ts`, `apps/desktop/src-tauri/tauri.conf.json` (CSP) | four Vite inputs |

IPC: none of its own. The mock answers every command in the authority table with the gates of
`crates/table-client/src/authority_table.rs`; the director uses only the mock's world handle.

## Tests that pin it

- `src/director/beats.test.ts`: "never moves money: no action can approve, pay, capture, release or
  sign", "captions speak plain words, not internals", "tells each of the four stories".
- `src/director/story.test.ts`: "(c) the mismatch arrives as a HOLD that no window can pay", "(b)
  with The Table closed the hold releases itself at the deadline, never a capture", "the whole run:
  every lapse is a safe default and nothing is ever captured", "the attention ladder follows the
  simulated clock".
- `src/director/takes.test.ts`: "always wants the preview banner and a badge in every open window",
  "wants the haggle's review to be a live decision and the mismatch's to have no way to pay".
- `src/director/retime.test.ts`: "puts every caption change back on its beat and cuts the lead-in".
- `src/lib/clock.test.ts`: "is a passthrough inside the desktop shell: simulation refuses there".
- `src/mock/authority.test.ts`: "gates every command exactly as the authority table says, for every
  label, lock and token".
- `src/mock/checks.test.ts`, `src/mock/simulate.test.ts`, `src/mock/forecast.test.ts`,
  `src/mock/exposure.test.ts`, `src/mock/fairPrice.test.ts`: parity with the Rust answers the
  windows depend on.
- `src/lib/lazy.test.tsx`: "once preloaded, renders on the first pass without the placeholder",
  "a failed preload can be retried".
- `src/lib/casing.test.ts`: fails on two client files whose names differ only by case (they broke
  the Windows build once).

## Known gaps and UNVERIFIED

- The mock is a mirror, not the wallet: parity is tested for gates, checks, what-if, forecast,
  limits and rescue, not for every handler. The mock never makes market price checks (fixed counts)
  and never records the "notified" rung.
- The mock's `tumbler:orient` rectangle uses older form sizes (`FORM_SIZE` in `src/mock/backend.ts`)
  than Rust and the page (`windows/tumbler/logic.ts`); the preview stage draws from the page's table.
- The mock's idle lock follows the simulated clock, so the Tumbler shows its lock after a jump over
  15 minutes (accurate, but it surprises first-time viewers).
- No error boundary for a chunk that fails to load (assets are local in the shell).
- Not yet done: measuring time-to-first-gate on cold viewers (target under 30 s), hosting the static
  build at a public link, recording the final takes (planned for Nov 6-9). The director's own time
  words still read "N d N h later".
- The `end-safety` beat is played from the preview; a take from a release build is not yet
  recorded. The mock's purchase fixtures still credit create and authorize to rule 6, which Rust
  refuses (see [spend-purchases.md](./spend-purchases.md)); the preview's safety record counts
  from those fixtures.

## Related

- [Home and Rewind](./home-and-rewind.md), [Tumbler and attention](./tumbler-and-attention.md),
  [Approval window](./approval-window.md) - the three windows the director frames.
- [IPC and authority](./ipc-and-authority.md) - the authority table the mock's gates come from.
- [Proof and verification](./proof-and-verification.md) - the no-install checks judges can run on the house seller.
- [`../../README.md`](../../README.md) "Watch it work without installing anything";
  [`../../apps/desktop/client/src/director/README.md`](../../apps/desktop/client/src/director/README.md);
  build log [`../build/STATUS.md`](../build/STATUS.md) (T7, "Director takes", "Client code splitting",
  "Your safety record", "Fair-price certificate on every receipt").
