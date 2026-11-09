# film/hero/ - "The Table - Maya's week" (the hero film)

A <= 3-minute demo film of The Table (browser preview, sample data) on the **sandwich** balance, told
as Maya's week: open, shop around, the haggle, silence never pays, a mismatched request held, and
proof of who decided. Each chapter opens with a short motion claim and real director footage proves
it. Two full-screen heroes are drawn only from the take's own record. The narration is written for
the ear and paced at the kit's 15 characters per second, so narration and music can be added later
with one command each, without re-cutting.

| Path | What it is |
| --- | --- |
| `film.json` | the FilmScript: 24 beats in 7 chapters, every moment tier <= 2, three music cues (prompts only) |
| `local/index.tsx` | `@film/local`: `DeadlineClock`, `WhoDecided` (here), `PriceCorridor`, `PreviewTag` (from `../shared/`) |
| `local/DeadlineClock.tsx` | full screen at the silence peak: every deadline of the week on one clock (any count; tightens past five), each one ending with what moved |
| `local/WhoDecided.tsx` | full screen at the proof peak: the week's money steps sorted into the Rewind's lanes (her signed rules, Maya, a deadline, refused) |
| `audio/`, `take/`, `out/` | generated (gitignored) |

## Record the heroes read (TakeBeat.record, written by the director's film capture)

- `deadlines` (silence/closed beats): `[{ deal, label, amount, kind: "offer"|"hold", deadlineAt, outcome: "open"|"lapsed"|"released", moved }]`
- `decisions` (proof beats): `[{ deal, step, amount, decidedBy: "agent"|"deadline"|"owner"|"refused", paid, at }]`
- `shop` (shop beats): `{ group, sellers: [{ deal, seller, price, state }], winner? }` (not drawn by a hero yet)

With no record a hero draws nothing; it never invents a figure. Every total (Nothing paid, $X moved,
never paid) is reduced from the record. `deadlineAt` is read as the record's own wall clock, so the
render does not depend on the machine's time zone: an ISO with an offset is read on that offset, a UTC
one (as the director writes them) on `props.utcOffsetMin` (default -480, the capture's default zone,
America/Los_Angeles in November). Change both together if the capture's `--tz` changes.

The recap lines are chosen by the record, not typed: WhoDecided says "every dollar under rules she
signed" only while every paid step is `decidedBy: "agent"` (her agent inside her signed rules).

## Run

```sh
KIT=.claude/skills/demo-film                 # kit >= 0.1.3 (npm ci there once)
node $KIT/tools/narrate.mjs film/hero --dry   # plan: chars, holds vs maxMs 180000 (no spend)
# capture: the director, beat by beat, on a port of its own (never 1430)
PLAYWRIGHT=<playwright>/index.mjs DEMO_FILM_KIT=$KIT node apps/desktop/client/scripts/film-capture.mjs film/hero --port 1533
node $KIT/tools/check.mjs film/hero --balance sandwich
node $KIT/tools/render.mjs film/hero --balance sandwich   # -> film/hero/out/the-table-maya-s-week-sandwich.mp4
# later, when audio is wanted (spend):
node $KIT/tools/narrate.mjs film/hero && node $KIT/tools/music.mjs film/hero
```

## The film's ending (`film_ending`, decided by the owner around 9 Nov)

The film's Rewind shot (`proof-rewind`, captured from the director's `end-rewind` beat) has two endings,
switched by one parameter of Maya's story, `film_ending`:

| Value | What the Rewind shot shows | Caption of `end-rewind` |
| --- | --- | --- |
| `today` (default) | the Rewind as it was before "Say it": the week's money steps and who decided them, the playhead stopping at now; no Say it box, no forecast past now | unchanged |
| `say` | the Say it box above the timeline, and the timeline running on past the gold now line into the next 72 hours; its closing line is the walk-away headline, "If you walk away: $0 leaves." | closes on the same headline |

How to switch it:

- **For one capture or rehearsal** (no code change): add `--film-ending say` (or `today`) to
  `scripts/film-capture.mjs` or `scripts/takes.mjs`, or open the director at `director.html?film_ending=say`
  (`director.html?film_ending=today` and plain `director.html` play the default).
- **To change the default for good**: set `filmEnding: 'say'` on `maya` in
  `apps/desktop/client/src/director/stories.ts`, then update the `stories.test.ts` cases that pin `today` as
  the default. If the shot should then show the headline, add `main|.rw-walk` to `proof-rewind`'s capture
  `targets` in `film.json` and rewrite its `line` (the narration) to end on it.

The switch only changes what the main frame draws (it reaches it as `?film_ending=` on that frame's
address, read by `filmEndingPreview()` in `src/lib/preview.ts`). The app itself has no such address and
always shows the Say it box and the timeline past now. The rehearsal checks each ending's own end state
(`EXPECT` and `FILM_SAY_EXPECT` in `src/director/takes.ts`).

## Licences

The film tracks no font, audio, image or video file of its own. What a render draws on:

| Asset | Where it lives | Licence |
| --- | --- | --- |
| Archivo (woff2) | `apps/desktop/client/src/assets/fonts/archivo/`, imported by `film/shared/fonts.ts` | SIL Open Font License 1.1, `OFL.txt` beside the files (The Archivo Project Authors) |
| Sofia Sans (woff2) | `apps/desktop/client/src/assets/fonts/sofia-sans/`, imported by `film/shared/fonts.ts` (the `NUMERALS` stack) | SIL Open Font License 1.1, `OFL.txt` beside the files (The Sofia Sans Project Authors) |
| Cascadia Mono | named in `film.json` `style.fonts.mono`; not bundled, used only if installed on the rendering machine | not redistributed by this repo |
| Logo | `branding/logo.svg` (`film.json` `style.logo`) | this repository's own artwork (repo `LICENSE`) |
| Narration and music | `audio/` (generated by ElevenLabs, gitignored) | not in the repo; the ElevenLabs plan in use covers public and commercial use of the rendered video (operator-confirmed 2026-10-18) |
| Footage | `take/` (the director on sample data, gitignored) | the app's own UI on the browser mock; no real person, account or money |

## Break The Table in the hero film (the owner's call at R10)

The hero film is captured from the director's `maya` story, whose beats stay as they are. Break The
Table lives in its own short story, `try` (`apps/desktop/client/src/director/tryStory.ts`, 5 beats, 35 s,
`director.html?story=try`; rehearse it with `takes --check --story try`). If the owner wants it in the
film, splice it in like this:

1. **Where.** After `end-safety` (the safety record names what her rules refused, the attacks add to it)
   and before `end`. That keeps the proof chapter's arc: who decided, then try to break it, then the close.
2. **The beats.** In `beats.ts`, add a chapter `{ id: 'try', title: 'Try to break it' }` before `end` in
   `CHAPTERS` (or reuse `end`), and insert `TRY_BEATS` mapped onto Maya's clock:
   `TRY_BEATS.map((b) => ({ ...b, chapter: 'try', at: 202 + b.at }))`, then move `end` to `202 + TRY_LENGTH`
   (237) and keep `HOLD_LAST`. The story grows from 214 s to 249 s; the film's own cut stays <= 3 min, so a
   beat elsewhere gives up its time (the shop chapter's `shop-rule` is the likeliest).
3. **Clear the stage after.** `end` must stage nothing: add `{ do: 'arena', played: [] }` to its `do`
   (otherwise a seek past the try beats leaves the attacks staged; the main frame follows only the
   director's write, so the decision centre is not affected either way).
4. **The checks.** Spread `TRY_EXPECT` into `EXPECT` (and so into `FILM_SAY_EXPECT`), update the beat
   counts and times pinned in `beats.test.ts`, `stories.test.ts`, `takes.test.ts` and `film.test.ts`, and
   the "28 beats in 214 s" lines in `src/director/README.md` and `docs/features/preview-and-director.md`.
5. **The film.** In `film.json`, add one beat per kept try beat, shaped like `proof-rewind`:
   `capture.beat` the director beat id (`try-rule`, `try-tool`, `try-count`, `try-proof`),
   `capture.targets` such as `main|.ar-drop` (the answer), `main|.ar-counter` (the counter) or
   `main|.ar-finale` (the closing card), `from: "ready"`, and a `line` written from the same record
   figures as the captions (`tryStory.ts` derives them; never type $900, $999 or $340). `record()` has no `try` key yet: a hero plate of the counter would need one
   (`{ attacks, moved, asked }` from `counters()` in `src/arena/model.ts`) before it may draw a figure.
6. **Rehearse.** `takes --check` (both `--film-ending today` and `say`), then the capture as above.
