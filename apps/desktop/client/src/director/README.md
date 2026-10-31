# The director: "Maya's week" and "First run" (browser preview only)

`director.html` frames the three real windows (The Table, the Tumbler, the approval window) on
the browser mock and plays a story's beat file across them, with captions. It is a judge path
that needs no install and the rehearsal rig for the video. It never runs inside the desktop
shell, and it never clicks inside a window: no beat can approve, pay, capture or release.

Three stories, chosen with `?story=` (`stories.ts`):

- **Maya's week** (no `story`, the default; `beats.ts`): the sample week, 28 beats in 214 s
  (3:34): the opening, shopping around (three beats on the Tables layer's Shop around view,
  `#m=tables&v=shop`: Dan and the house seller bargaining for the same monitor, Dan at his $389
  listing, the house seller at $334, the lowest so far, and the rule that the first seller to agree
  wins and the others are told no; nobody has agreed when the story opens, so no winner is shown),
  the haggle, silence, the mismatch, The Table closed, and the ending (the dock's deal, its proof
  from PayPal on `#d=D-0190&dv=proof`: an order and a hold, no payment, no receipt, nothing on the
  statement, "decided by the deadline"; then the Rewind, the safety record and the decision centre).
  Its ending is switched by `film_ending` (the story's `filmEnding`, default `today`; `?film_ending=say`
  wins): `today` shows the Rewind as it was before Say it, `say` shows the Say it box and the timeline
  past now and closes on "If you walk away: $0 leaves." (`film/hero/README.md`).
- **Say it, then see it** (`?story=say`; `sayStory.ts`): one sentence in The Table's Say it box, read
  with a fixed word list (no AI) into chips; the Rewind's timeline draws the week behind Maya, the gold
  Now line and the next 72 hours (the walk-away forecast as dashed ticks, one per forecast line) and what
  her new rules would allow over them; a sentence with a part missing asks one question instead of
  guessing; Review rules opens the approval window with the rules filled in. 9 beats, 83 s, on Maya's
  sample week. `{ do: 'say', text }` types the sentence for the viewer (the window keeps it in its own
  storage and the frames follow), and `{ do: 'owner', rules }` opens the approval window's editor on the
  rules that sentence reads to, as Review rules does. `{ do: 'look', at }` only scrolls the framed window to the part the
  caption is about (the Say it box, the chips, the track, the open tables); it presses nothing. The sentence ends "for 3 days", so it means the
  same on any day. It never signs: nothing in a beat can.
- **First run** (`?story=first-run`; `firstRunStory.ts`): the onboarding on a brand-new wallet,
  94 s. Every frame and the page's own mock core open in the `?first_run=1` world (the page adds
  `first_run=1` to its own address), so the sample week's stored state is never touched. The
  Table opens on its charter (five lines: the four getting-started steps plus unlock) with the
  agent app to do on the practice agent, and the tour's coach mark walks each window's stops: The Table's five, then the Tumbler's four on its
  first-run welcome, then the approval window's four on the owner's setup. The tour moves by
  `{ do: 'tour', win, at }`, which writes that window's saved tour progress under the first-run
  key; the framed window follows the write (its `storage` event). Nothing presses Next, Back or
  Skip. An unknown `story` plays Maya's week.

| File | What it holds |
| --- | --- |
| `beats.ts` | Maya's week: chapters, beats, their times, captions and actions |
| `firstRunStory.ts` | First run: the same, on the brand-new wallet's world |
| `stories.ts` | `?story=`: which story, and the frames' addresses in its world |
| `actions.ts` | what a beat can do on the mock world (no money action exists), and the tour's pointer |
| `helpers.ts` | every Tumbler preview control as a beat helper |
| `takes.ts` | per-beat expected end state on screen (`EXPECT`, `FIRST_RUN_EXPECT`), still names, chapter takes, story date |
| `retime.ts` | puts a lagging screen recording back on the beat file's clock |
| `Director.tsx` | the stage, the camera, the caption rail, and the `window.__takes` hook (`.film` under `?take=film`) |
| `film.test.ts` | the film capture's rectangle mapping and the chapter records (haggle, shop, deadlines, decisions) |

Run it: `pnpm --dir apps/desktop/client dev`, then open `/director.html` (Maya's week) or
`/director.html?story=first-run`.

The Table is the console (the 2026-10-14 rebuild): its home is the decision centre, the deal,
module and safety-record beats are its layers, and every frame (The Table, the Tumbler, the
approval window) follows the stored theme. The approval window opens from a beat (`{ do:
'approval' }`), the director's stand-in for the hand-off the console's gold action makes with
`approval_open`; nothing in a beat presses that action.

URL parameters: `?beat=<index or id>` starts at a beat, `?play=0` starts paused,
`?camera=desk` keeps the whole desk in view, `?date=YYYY-MM-DD` starts the story at 14:02:04
on that day instead of today, and `?take=1` hides the transport controls for a recording. The
preview banner stays in every mode, and the captions in every mode but `?take=film` (below).

## Film capture (`?take=film`)

`scripts/film-capture.mjs <film-dir>` is the demo-film kit's capture step: the desk wide and still,
no caption rail, no transport, the clock stopped while the rig plays each film beat through
`window.__takes.film` (`go`, `rects`, `record`, `shown`, `clicks`, `playedAt`), then
`take/take.webm`, `take/take.mp4` and `take/take.json`. It starts Vite on port 1531 unless
`--base-url` names a server. See [preview-and-director.md](../../../../../docs/features/preview-and-director.md)
("Film capture"). The banner and the badges stay; nothing is clicked.

`record()` gives each Maya's week beat its chapter's figures, read from the mock world (never
typed) and reduced by pure functions in `takes.ts`; amounts are dollars, absent keys are omitted:

| Beats | Key | Shape |
|---|---|---|
| `haggle-*` | (top level) | `haggleRecord`: `ceiling`, `askAbove`, `offersMaya[]`, `offersDan[]`, `gateAt` |
| `shop-*` | `shop` | `shopRecord`: `{ group, sellers: [{ deal, seller, price, state }], winner? }` from `deal_groups`, as the Shop around view draws it (`group` is its heading, `state` the chip word) |
| `silence-*`, `closed-*` | `deadlines` | `deadlinesRecord`: `[{ deal, label, amount, kind: offer\|hold, deadlineAt, outcome: open\|lapsed\|released, moved }]`, every deadline in this week (Monday to Monday, as the Rewind) still open or decided by its deadline; `moved` is what the history shows captured |
| `end-*`, `end` | `decisions` | `decisionsRecord`: `[{ deal, step, amount, decidedBy: agent\|deadline\|owner\|refused, paid, at }]`, the Rewind's money steps of the week (`laneSteps`), who decided from its `tickTone` (a rule she signed or her shop rules read as `agent`; the dock and the cables and packing captures are `owner`, as Rust refuses a rule for any purchase step) |

`shown(record)` (`recordShownOnStage`) checks the haggle's latest figures on The Table, and for
each other kind that at least one of its figures is drawn somewhere on the stage.

## Takes: stills, video and the rehearsal check

`scripts/takes.mjs` drives the director with Playwright through the read-only `window.__takes`
hook (plan, where the story is, what the stage shows, play and pause). Playwright is not a
dependency of this package: install it globally (`npm i -g playwright`) or set
`PLAYWRIGHT=/path/to/playwright/index.mjs`. Set `PW_CHROMIUM` to a Chromium binary, or let
Playwright use its own download. Playwright for Python also works: its driver ships the Node
package, so `PLAYWRIGHT=<site-packages>/playwright/driver/package/index.mjs` (with its own
downloaded Chromium) runs the rig. Node 22.18 or later (the script loads `retime.ts` directly).

`ffmpeg` on the `PATH` (or `FFMPEG`) finishes a video: Chromium's recorder falls behind real time
on a busy machine (up to 7 s by the end of the story on a loaded 4-core host), so the script finds
where each caption changes in the raw recording and retimes the stretches between them so every
beat starts exactly when the beat file says, cutting the loading lead-in. The cue sheet says how
far off the raw recording ran. Without ffmpeg the raw webm is kept as recorded, with its lead-in
and lag, and the cue sheet gives wall-clock times.

Without `--url` the script uses a server already on `--port` (default 1444) or starts `vite` there
and stops it at the end. Every run uses 1920x1080, the en-US locale, the America/Los_Angeles time
zone, reduced motion off, and the story day 2026-11-05 (`--date`, `--tz` to change), and waits for
fonts and for the camera and every finite animation (a layer's entrance) to settle before a still.

From the repository root:

```sh
# Rehearsal: every beat must show its end state; exit 1 on any page or console error, a missing
# preview banner or "Preview · sample data" badge, or a beat that does not show what it should.
pnpm --dir apps/desktop/client takes --check

# Stills: one 1920x1080 PNG per beat, <dir>/<theme>/NN-chapter-beat.png (NN is the ?beat= index).
pnpm --dir apps/desktop/client takes --stills /tmp/takes/stills --theme both

# The whole story in real time (about 3:34), one webm, plus /tmp/takes/maya.webm.cues.json with
# the time each beat starts in the video.
pnpm --dir apps/desktop/client takes --video /tmp/takes/maya.webm

# One chapter, counted as the caption rail counts them (0 opening, 1 shopping around, 2 the haggle,
# 3 silence, 4 the mismatch, 5 The Table closed, 6 the ending), or by id (--chapter haggle).
pnpm --dir apps/desktop/client takes --video /tmp/takes/haggle.webm --chapter 2

# Against a server you already run (dev or `vite preview` of a build):
pnpm --dir apps/desktop/client takes --check --url http://localhost:1444/

# First run instead of Maya's week: the same three modes take --story first-run.
pnpm --dir apps/desktop/client takes --check --story first-run
pnpm --dir apps/desktop/client takes --stills /tmp/takes/first-run --story first-run
pnpm --dir apps/desktop/client takes --video /tmp/takes/first-run.webm --story first-run
```

`--story` must name a story the page plays: the script refuses when the director's plan says
another (an unknown `story` would otherwise quietly play Maya's week). First run's stills are
named the same way (`00-start.png` ... `14-end.png`): give them their own directory.

In this dev container: `PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

A video run also checks each beat as it plays and fails if one does not show its end state before
the next beat starts. Write takes outside the repository. The expected end states live in
`EXPECT` in `takes.ts`, next to the story tests they mirror (`story.test.ts`); a new beat needs an
entry there, and `takes.test.ts` fails until it has one. First run's live beside them in
`FIRST_RUN_EXPECT` (never in `EXPECT`'s keys), mirrored by `firstRunStory.test.ts`: the four steps
(PayPal next, the agent app to do) and the stop each window's mark shows, read from the mark's
`data-tour-stop` and the steps' `s-<state>` class; in The Table, from the charter's lines in order
(`ol.ch-fields > li`, their `done` / `waiting` / `todo` / `cur` classes, `charterSteps`).

Maya's week on the console: the opening and the ending expect the decision centre ("What needs
you", an "If you do nothing" line, the footer's "Waiting never pays"); the haggle halfway expects
her latest offer and the deal page's facts ("Most you'll pay $340.00", "Offers used 3 of 6"),
because the deal page shows the latest moments first and her opening $290 offer is one view down.
