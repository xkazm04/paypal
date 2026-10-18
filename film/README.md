# film/ - "The Table - the haggle" (demo-film pilot)

A ~37 s voice-first demo film of Maya's haggle (browser preview, sample data), compiled by the
demo-film kit from one script, `film.json`. The kit lives outside this repo (registry skill
`demo-film`); point `KIT` at it.

| Path | What it is |
| --- | --- |
| `film.json` | the FilmScript: voice, music cue, StyleLock (brand palette, Archivo, `../branding/logo.svg`), six beats |
| `local/index.tsx` | bespoke heroes, imported by the kit as `@film/local`: `PriceCorridor`, `PreviewTag` |
| `local/PriceCorridor.tsx` | the hero: Maya's and Dan's offers closing inside her signed range; every figure from the take record |
| `local/fonts.ts` | registers Archivo and Sofia Sans from the app's own woff2 files (`apps/desktop/client/src/assets/fonts`) |
| `audio/`, `take/`, `out/` | generated (gitignored): narration + music, the capture, the renders |

## Run

```sh
KIT=<path to the demo-film skill>          # e.g. ai-registry/skills/demo-film (npm ci there once)
node $KIT/tools/narrate.mjs film --dry     # plan: chars, holds vs maxMs 40000
node $KIT/tools/narrate.mjs film           # ElevenLabs narration (spend: characters)
node $KIT/tools/music.mjs film             # ElevenLabs music bed (one cue)
# capture: the director, driven beat by beat (port 1531, never 1430)
PLAYWRIGHT=<playwright>/index.mjs DEMO_FILM_KIT=$KIT node apps/desktop/client/scripts/film-capture.mjs film
node $KIT/tools/check.mjs film --balance sandwich
node $KIT/tools/render.mjs film --balance overlay|sandwich|led   # -> film/out/the-table-the-haggle-<balance>.mp4
```

The key comes from the repo-root `.env` (`ELEVENLABS_ENV_FILE` pointer, gitignored); it is never
printed. Re-run capture whenever a hold changes (settleMs, a new clip) or a capture target is added.

## Notes

- `PriceCorridor` reads the haggle record with the most offers in the chapter (the gate beat's), since
  the trade beat's own record stops midway. With no record it draws nothing; it never invents a figure.
- `mode: "inset"` (sandwich) is a panel beside the framed Table with a gold hand-off to the Tumbler,
  placed through the footage camera (`ctx.toScreen`). `mode: "full"` (led) takes the screen for the
  first 5.7 s of the trade beat; the inset then arrives already settled.
- `PreviewTag` restates the director's preview banner only when a zoom pushes the real banner out of frame.
- `StatCounter` uses the kit's `record: "ceiling"` prop (the kit resolves record keys; no wrapper needed).
