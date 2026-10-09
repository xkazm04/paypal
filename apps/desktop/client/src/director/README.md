# The director: "Maya's week" and "First run" (browser preview only)

`director.html` frames the three real windows (The Table, the Tumbler, the approval window) on
the browser mock and plays a story's beat file across them, with captions. It is a judge path
that needs no install and the rehearsal rig for the video. It never runs inside the desktop
shell, and it never clicks inside a window: no beat can approve, pay, capture or release.

Two stories, chosen with `?story=` (`stories.ts`):

- **Maya's week** (no `story`, the default; `beats.ts`): the sample week, about three minutes.
- **First run** (`?story=first-run`; `firstRunStory.ts`): the onboarding on a brand-new wallet,
  94 s. Every frame and the page's own mock core open in the `?first_run=1` world (the page adds
  `first_run=1` to its own address), so the sample week's stored state is never touched. Home
  shows the four getting-started steps with the agent app to do on the practice agent, and the
  tour's coach mark walks each window's stops: The Table's five, then the Tumbler's four on its
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
| `Director.tsx` | the stage, the camera, the caption rail, and the `window.__takes` hook |

Run it: `pnpm --dir apps/desktop/client dev`, then open `/director.html` (Maya's week) or
`/director.html?story=first-run`.

URL parameters: `?beat=<index or id>` starts at a beat, `?play=0` starts paused,
`?camera=desk` keeps the whole desk in view, `?date=YYYY-MM-DD` starts the story at 14:02:04
on that day instead of today, and `?take=1` hides the transport controls for a recording. The
preview banner and the captions stay in every mode.

## Takes: stills, video and the rehearsal check

`scripts/takes.mjs` drives the director with Playwright through the read-only `window.__takes`
hook (plan, where the story is, what the stage shows, play and pause). Playwright is not a
dependency of this package: install it globally (`npm i -g playwright`) or set
`PLAYWRIGHT=/path/to/playwright/index.mjs`. Set `PW_CHROMIUM` to a Chromium binary, or let
Playwright use its own download. Node 22.18 or later (the script loads `retime.ts` directly).

`ffmpeg` on the `PATH` (or `FFMPEG`) finishes a video: Chromium's recorder falls behind real time
on a busy machine (up to 7 s by the end of the story on a loaded 4-core host), so the script finds
where each caption changes in the raw recording and retimes the stretches between them so every
beat starts exactly when the beat file says, cutting the loading lead-in. The cue sheet says how
far off the raw recording ran. Without ffmpeg the raw webm is kept as recorded, with its lead-in
and lag, and the cue sheet gives wall-clock times.

Without `--url` the script uses a server already on `--port` (default 1444) or starts `vite` there
and stops it at the end. Every run uses 1920x1080, the en-US locale, the America/Los_Angeles time
zone, reduced motion off, and the story day 2026-11-05 (`--date`, `--tz` to change), and waits for
fonts and for the camera and Home's opening animation to settle before a still.

From the repository root:

```sh
# Rehearsal: every beat must show its end state; exit 1 on any page or console error, a missing
# preview banner or "Preview · sample data" badge, or a beat that does not show what it should.
pnpm --dir apps/desktop/client takes --check

# Stills: one 1920x1080 PNG per beat, <dir>/<theme>/NN-chapter-beat.png (NN is the ?beat= index).
pnpm --dir apps/desktop/client takes --stills /tmp/takes/stills --theme both

# The whole story in real time (about 2:51), one webm, plus /tmp/takes/maya.webm.cues.json with
# the time each beat starts in the video.
pnpm --dir apps/desktop/client takes --video /tmp/takes/maya.webm

# One chapter, counted as the caption rail counts them (0 opening, 1 the haggle, 2 silence,
# 3 the mismatch, 4 The Table closed, 5 the ending), or by id (--chapter haggle).
pnpm --dir apps/desktop/client takes --video /tmp/takes/haggle.webm --chapter 1

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
`data-tour-stop` and the steps' `s-<state>` class.
