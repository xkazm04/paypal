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

**The proof checker** (`/proof.html`, a static page with no wallet and no backend; also the Book's "Check a proof file" and the recorded house haggle's deal page, D-0205, Proof, in the preview): a deal's signed proof file checked in the page, then broken on purpose. It is not part of the director's story (those beats are the film's). See [proof-and-verification.md](./proof-and-verification.md), step 10.

**The director** (`/director.html`, or a static `dist` build served from anywhere):
- A stage with the three windows framed at their native sizes (The Table 1280 × 800, the approval
  window 744 × 660, the Tumbler in a corner), dark or light following the theme switch (all three windows follow
  it, live across windows; the approval window was always dark before the console rebuild of
  2026-10-14). The Table is the console: its decision centre, module layers, deal page, Rewind and
  places; the approval window is drawn as the console's front sheet.
- A camera that follows each beat, a caption rail with the simulated time, play / pause /
  previous / next / restart (Space, ←, →, Home) and a per-chapter scrubber.
- The banner: "Browser preview with sample data — not the wallet. No PayPal page is ever shown."
- The story, in seven chapters (opening, shopping around, the haggle, silence, the mismatch, The
  Table closed, the ending), about three and a half minutes. Shopping around (beats `shop-ask`,
  `shop-prices`, `shop-rule`, route `#m=tables&v=shop`): her agent bargains for the same monitor at
  two sellers' tables at once, Dan at his $389 listing and the house seller at $334, the lowest so
  far, under the rule that the first seller to agree wins and the others are told no; at the
  story's start the group is still bargaining, so the captions state the rule, not a winner. Then
  (a) a haggle reaches Dan's $329 counter, the "ask me above" rule
  sends it to Maya, the Tumbler card appears and the approval window opens, but is never approved;
  (d) the clock runs past the deadline and the haggle is withdrawn by the safe default; (c) a $339
  payment request does not match the $329 deal: a pause and a review with no pay button; (b) The
  Table closes with a payment on hold, days pass, and the hold releases itself. The ending opens
  "Your safety record" (beat `end-safety`, route `#p=safety&m=book`): who decided each money step,
  and that PayPal never heard of a request her rules refused. Before it, `end-proof` (route
  `#d=D-0190&dv=proof`) opens the dock's proof from PayPal: an order and a hold, no payment, no
  receipt, nothing on the statement, "decided by the safe default". 28 beats in all, 214 s (3:34).
- URL parameters: `?beat=<index or id>`, `?play=0`, `?camera=desk`, `?date=YYYY-MM-DD` (the story
  starts at 14:02:04 that day), `?take=1` (hides the transport for recordings), `?take=film` (the
  demo film's capture, below).

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
8. **Film capture.** `apps/desktop/client/scripts/film-capture.mjs` is the capture step of the
   demo-film kit (ai-registry `skills/demo-film`): `node scripts/film-capture.mjs <film-dir>
   [--story maya] [--base-url <url>] [--keep-server]`. It reads `<film-dir>/film.json` (the kit's
   `FilmScript`) and `<film-dir>/audio/manifest.json` (measured clip lengths; without it every line's
   length is estimated), and plays each film beat that has `capture` on `director.html?take=film`:
   - **Film mode** (`?take=film`, implies `take=1`): no caption rail and no transport, the camera
     fixed on the whole desk with no glide, no pointer, and the clock stopped: the director never
     advances on a beat's `at`, the rig plays each beat (`__takes.film.go(n)`: in place when it is the
     next beat, otherwise the same rebuild as `?beat=`). The banner and every window's "Preview ·
     sample data" badge stay.
   - **The hook** (`window.__takes.film`, film mode only): `rects(selectors)` measures page pixels of
     the recorded 1920 × 1080 viewport, a `main|`, `tumbler|` or `approval|` prefix picking a framed
     window (its rectangle mapped through the frame's place on the desk and the desk's transform,
     `stageRect` in `takes.ts`); `record()` reduces the mock world for the current beat (the haggle:
     her offers, Dan's, the ceiling and the ask-me threshold from the signed mandate version the deal
     runs on, and the gate's amount once it is up; `haggleRecord`; shopping around: `shop`, the group
     as the Shop around view draws it, `shopRecord`; silence and The Table closed: `deadlines`, every
     deadline of this week still open or decided by its deadline, with the dollars the history shows
     moved, `deadlinesRecord`; the ending: `decisions`, the Rewind's money steps of the week with who
     decided each (`agent`, `deadline`, `owner`, `refused`) and whether it paid, `decisionsRecord`;
     shapes in `src/director/README.md`); `shown(record)` (`recordShownOnStage`) says where The Table
     does not draw the haggle's figures, or where no figure of another kind is drawn on the stage; `clicks()` gives the centre of what the beat's action stood in
     for pressing (`FILM_PRESS`: the Tumbler's notification, its "Review and decide"), measured before
     the action runs. Nothing is clicked.
   - **The take**: one recorded context (1920 × 1080, the same locale, time zone and story day as
     `takes.mjs`, which shares its Playwright, server and beat-wait code through `scripts/lib/rig.mjs`).
     For each beat: `startMs` when the beat's actions ran (from context creation), the director's
     `EXPECT` check (a broken beat is recorded in `error` and the take carries on), rects for every
     target, clicks, the record (checked against what The Table draws), then a hold of
     `max(clip or estimate, settleMs) + breathMs` from `startMs`. Beats without `capture` are not
     filmed. It writes `take/take.webm`, an h264 copy `take/take.mp4` (30 fps, no audio, same clock)
     and `take/take.json` (the kit's `Take`, `offsetUncertaintyMs` 300), and exits 1 at the end
     naming every broken beat. It starts its own Vite on port 1531 (`--strictPort`) unless
     `--base-url` names a server, and stops it on exit. The kit's `contract.ts` comes from
     `$DEMO_FILM_KIT` (default `<repo>/.claude/skills/demo-film`).
9. **Code splitting.** `src/lib/lazy.ts` `lazyPart(load)` behaves like `React.lazy` until its chunk
   arrives, then renders directly (later navigation never suspends); `.preload()` loads once and
   retries after a failure; `preloadWhenIdle(parts)` loads parts after first paint. In `main` (the
   console) every layer is its own lazy part (`console/layers.registry.ts`, `LAYER_PARTS`, preloaded
   when the window is idle with the quit sheet), and the deal page's views and sheets are their own
   chunks; the console frame, the decision centre and the waiting list stay in the entry chunk. In `approval` the owner configuration,
   the rules editor with its what-if and the replay sheet are lazy; a deal review stays in the
   entry chunk. Stylesheets stay eager.
10. **Build.** `vite.config.ts` has four inputs (`main`, `tumbler`, `approval`, `director`); no shell
   window points at `director`. The shell's CSP allows only `'self'` scripts and styles and no
   frames, so every page ships as bundled files.

   `director.html?story=say` plays a third, "Say it, then see it" (`director/sayStory.ts`, 9 beats, about 95 s, on Maya's sample week): one sentence in
   The Table's Say it box (`{ do: 'say', text, answers? }`), the Rewind's timeline past a gold Now line, a question it asks instead of guessing, and Review
   rules opening the approval window on the rules it read (`{ do: 'owner', rules }`). Nothing in a beat can sign.

   `director.html?story=try` plays "Try to break it" (`director/tryStory.ts`, 5 beats, 35 s, on Maya's sample week):
   Break The Table in the console's place "Try to break it" (`#p=try`). Two recorded attacks land, one her signed
   rules refuse and one asking for a payment tool that does not exist; the counter shows what they moved and how often
   PayPal was asked; the closing card checks the attack's signed file. `{ do: 'arena', played, finale }` stages which
   recorded attacks have landed (`src/arena/stage.ts`); nothing is clicked. Caption figures come from the arena record.
   The no-pay-button rule leaves out only the arena's recorded attack cards (`takes.ts` `isArenaAttackCard`).
   Rehearse with `pnpm takes --check --story try`. Under the director live mode never probes for a sandbox.

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
| Takes rig | `apps/desktop/client/scripts/takes.mjs`, `scripts/lib/rig.mjs`, `package.json` (`takes` script) | `--check`, `--stills`, `--video` |
| Film capture | `apps/desktop/client/scripts/film-capture.mjs`, `src/director/takes.ts`, `Director.tsx` | `?take=film`, `__takes.film`, `stageRect`, `haggleRecord`, `shopRecord`, `deadlinesRecord`, `decisionsRecord`, `recordShownOnStage`, `FILM_PRESS` |
| Code splitting | `src/lib/lazy.ts`, `windows/main/console/Console.tsx`, `windows/main/console/layers.registry.ts`, `windows/approval/App.tsx` | `lazyPart`, `preloadWhenIdle`, `LAYER_PARTS` |
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
- `src/director/film.test.ts`: "maps an iframe-local rectangle through a scaled desk", "reads the
  ceiling and the ask-me threshold from the signed mandate", "changes with the fixtures, not with a
  typed constant: a re-signed rule moves the record", "reads the sample group as the Shop around view
  draws it at the story's start", "when the dock's hold runs out: released, and no deadline of the
  week moved money", "reads amounts and money moved from the world: a capture on the record would
  show", "lists the Rewind's money steps of the week, with who decided and whether money moved".
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
- A chunk that fails to load shows its layer's calm fallback ("Try again"): every window, layer
  and panel has an error boundary since the console rebuild (`src/shared/boundary/`).
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
