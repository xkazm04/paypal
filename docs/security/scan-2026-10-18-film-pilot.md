# Security scan - The Table - film pilot and director capture mode - 2026-10-18

A publication-blocker pass for milestone 5 ("public repository with no publication blockers") over
the commits `3dd1174..31ed7b4` (10 commits, 29 files, +2707/-231): the demo-film pilot in `film/`,
the director's film capture mode (`?take=film`, `scripts/film-capture.mjs`, `scripts/lib/rig.mjs`),
the registry and skill bookkeeping in `.ai/` and `.claude/spark/`, and the README section on engines
and relays. Base: `31ed7b4`, branch `autopilot/codebase-security-scan-aa8f8053`. **No open
publication blocker was found. One Low finding was fixed inside `film/` (F-1). Every other item is
report only.** No network call was made, no live PayPal call was made and no money was used.

Range scanned: `git log 3dd1174..31ed7b4` = `0444ee4`, `1f73fe4`, `d8242f7`, `2286833`, `c8f37e1`,
`6fb0492`, `6e34b9a` (director film capture mode), `1ef2c0f` (the haggle film), `f7ea792` (spark and
demo-film skills), `fbcb50b` (registry lead), `31ed7b4` (README).

Scope (read in full):
- `film/README.md`, `film/film.json`, `film/.gitignore`, `film/local/fonts.ts`, `film/local/index.tsx`,
  `film/local/PriceCorridor.tsx` (imports and IO only).
- `apps/desktop/client/scripts/film-capture.mjs` (all), `apps/desktop/client/scripts/lib/rig.mjs`
  (server, browser, Playwright and ffmpeg lookup), the `takes.mjs` diff (a move into `rig.mjs`).
- `apps/desktop/client/src/director/Director.tsx` (the `?take=film` diff, `:155-525`),
  `src/director/entry.tsx`, the `takes.ts` film section (`:443-`), `vite.config.ts`,
  `apps/desktop/src-tauri/tauri.conf.json:6`.
- `.gitignore` and `film/.gitignore` (what generated media can reach git), `.claude/spark/config.md`,
  `.ai/manifest.yaml`, `.ai/registry-leads.jsonl`, the `.ai/` conform JSON (grepped), `README.md`
  diff.
- The full patch of every commit in the range (`git log -p 3dd1174..31ed7b4`), grepped for keys,
  tokens, emails, absolute paths and URLs, and `git log --numstat` for binary files.

Severity is judged for publishing this repository: a hackathon desktop wallet against the PayPal
**sandbox**. A "publication blocker" is something that must not be in a public repository or its
history (a live secret, someone's personal data, an asset without a redistribution licence).

## Summary

| ID | Severity | Category | File:line | Status | Action |
|---|---|---|---|---|---|
| F-1 | Low | asset licence, attribution | `film/README.md:13`; `film/local/fonts.ts:6-10`; `film/film.json:10`, `:31`, `:47`, `:49` | closed (`345690d`) | The film named no licence for the fonts, logo, system font and generated audio a render draws on; the README now has a third-party assets table |
| F-2 | Low | asset licence, generated media | `film/film.json:8-15`, `:21-34`; `film/README.md:28` | open (operator) | Narration and music are ElevenLabs output (gitignored, never tracked). Publishing a **render** needs the ElevenLabs account's commercial terms; not a repository blocker |
| F-3 | Low | file writes outside the repo | `apps/desktop/client/scripts/film-capture.mjs:135`, `:146-148`, `:154-155`, `:211`, `:216`, `:234` | open | The capture writes and deletes under `<film-dir>/take/`, and `<film-dir>` is any path given on the command line |
| F-4 | Info | network port | `film-capture.mjs:89-117`; `apps/desktop/client/vite.config.ts:20` | open | Starts vite on `localhost:1531` (`--strictPort`, loopback, stopped at exit unless `--keep-server`) |
| F-5 | Info | code loaded from outside the repo | `film-capture.mjs:81-86`; `scripts/lib/rig.mjs:22-47`, `:87-89`, `:189-212` | open | Imports the kit's `contract.ts` and Playwright, and runs Chromium and ffmpeg, from env-named or global paths |
| F-6 | Info | ships in a release build | `vite.config.ts:33`; `src-tauri/tauri.conf.json:6`; `src/director/entry.tsx:16-19`; `Director.tsx:197`, `:203` | open | `director.html` (capture mode included) is in `client/dist` and so in the release bundle; it refuses to start under Tauri and runs on the mock |
| F-7 | Info | personal data in history | commit metadata of all 10 commits | open (operator) | Every commit's author and committer is `xkazm04 <kazdan@seznam.cz>`; history cannot be fixed by a commit |

**Open publication blockers: 0.** F-2 and F-7 need an operator decision (the render's audio terms,
and whether the commit email is meant to be public). Neither is a secret or a third party's data.

## Answers to the questions

### 1. Secrets, personal data or private keys in tracked files or in the range's history?

**Verdict: none found. One operator confirmation (F-7).**

- **Keys and tokens.** The range's full patch has no API key, OAuth token, client id, secret,
  private key block or `.env` content. "ElevenLabs" appears only as a model name
  (`film/film.json:10`, `eleven_multilingual_v2`) and as a pointer to where the key lives: the
  repo-root `.env` (`film/README.md:28`), which `.gitignore:10-11` ignores (`.env`, `.env.*`;
  `git check-ignore` confirms `film/.env` too). The `.ai/` conform files name
  `services/house-seller/src/environment.rs:63` and its env-var custody as a registry proposal: a
  description, no value.
- **Personal data.** No PayPal account id, payer id or email in the range. The film's people
  (Maya, Dan) and figures ($340 ceiling, $389 ask, $329 counter, $250 ask-me) are the director's
  sample world (`film/film.json` beat lines; `Director.tsx` record from `world.deal(HAGGLE)` on the
  mock, `:490-503`). No absolute local path or user name appears in any added line: the grep for
  drive letters, `/Users/`, `/home/` and `\Users` over the patch is empty. `.claude/spark/config.md`
  uses `<repo>` and `<abs path>` placeholders only.
- **Recorded audio or video.** None is tracked, now or in the range's history: `git log --all --
  film/out film/take film/audio` is empty, and `git log --numstat` over the range lists no binary
  file. `film/.gitignore:1-3` ignores `audio/`, `take/` and `out/`. The footage the capture records
  is the director on the browser mock under a permanent "Browser preview with sample data" banner
  (`film-capture.mjs:202`), and the narration is a synthetic voice. Neither shows a real identity.
- **Commit metadata (F-7).** Author and committer of all 10 commits are `xkazm04 <kazdan@seznam.cz>`,
  the same identity as the rest of the repo's history since `1fb97f6`. That is the operator's own
  git identity, not a third party's, so it is not counted as a blocker. Making it non-public needs a
  history rewrite or a noreply identity going forward, which only the operator can choose.

### 2. Third-party assets: does each one have a licence that allows public redistribution?

**Verdict: yes for everything tracked. The licence attribution was missing in `film/` and is now added (F-1).**

| Asset | Tracked? | Licence | Evidence |
|---|---|---|---|
| Archivo, latin and latin-ext woff2 | yes, `apps/desktop/client/src/assets/fonts/archivo/` (since `1a2ffeb`, before this range) | SIL OFL 1.1, redistribution allowed with the licence | `archivo/OFL.txt` beside the files |
| Sofia Sans, latin and latin-ext woff2 | yes, `apps/desktop/client/src/assets/fonts/sofia-sans/` | SIL OFL 1.1 | `sofia-sans/OFL.txt` beside the files |
| Cascadia Mono | no: a font family name in `film/film.json:47`, used only if installed where the film renders | not redistributed | nothing to license here |
| Logo | yes, `branding/logo.svg` | the repo's own artwork, Apache-2.0 (`LICENSE`) | `branding/README.md:6` (hand-built paths, no fonts) |
| Narration and music | no, `film/audio/` (gitignored) | ElevenLabs output under the account's terms | F-2 |
| Footage and renders | no, `film/take/`, `film/out/` (gitignored) | the app's own UI | none needed while untracked |

`film/local/fonts.ts:6-10` imports the woff2 files from their existing place; `film/` copies no font,
fetches nothing from the network, and adds no image, audio or video file of its own. No asset in
the range lacks a clear licence.

### 3. Risky code in the capture mode

**Verdict: it writes only under a folder the operator names, opens one loopback port while it runs,
and cannot run in a release build.**

- **Files outside the repo (F-3).** It writes `take.webm`, `take.mp4`, `take.json` and a scratch
  `take/.raw/` under `<film-dir>`, which it resolves from argv (`film-capture.mjs:135`). It deletes
  only `<film-dir>/take/.raw` (`:147-148`, `:216`). ffmpeg overwrites `take.mp4` with `-y`
  (`:220`). Given a film dir outside the repo, it writes there; with the documented call
  (`film`) it stays in `film/take/`. It never deletes `<film-dir>` itself or anything outside
  `take/.raw`.
- **Network port (F-4).** Without `--base-url` it spawns vite on `--port` (default 1531, 1430 refused,
  `:74`) with `--strictPort` (`:99`). `vite.config.ts:20` sets no `host`, so vite listens on
  `localhost` only. The server is killed (with its tree on Windows) at exit (`:100-109`) unless
  `--keep-server`. While it runs it serves the repo root (`fs.allow`, `vite.config.ts:20`) to
  loopback, which is the dev server's existing behaviour. `--base-url` reads `director.html` from
  any origin given (`:90-93`); the rig only drives that page in its own Chromium.
- **Release build (F-6).** `film-capture.mjs` is not in any package script and is not bundled.
  `director.html` is a build input (`vite.config.ts:33`), so the director, film mode included, is
  in `client/dist`, which the Tauri release embeds (`tauri.conf.json:6`). It cannot run there:
  `entry.tsx:16-19` writes "This preview runs in a web browser only." and returns before
  `Director` is imported when `__TAURI_INTERNALS__` is present (`lib/tauri.ts:32-34`), and the shell
  opens no director window. In a browser, film mode is `?take=film` (`Director.tsx:203`). Its hook
  measures rectangles and reads the mock world. Its one core call is `mandate_list` on
  `mockBackend('main')` (`:197`, `:499`), a read, and it moves no money (the mock has none).
- **Code loaded from outside the repo (F-5).** `loadContract` imports `tools/src/contract.ts` from
  `$DEMO_FILM_KIT` or the gitignored skill link `.claude/skills/demo-film` (`:81-86`).
  `loadPlaywright` imports from `$PLAYWRIGHT` or the global npm root (`rig.mjs:22-47`), Chromium
  from `$PW_CHROMIUM` (`:88`), ffmpeg/ffprobe from `$FFMPEG` or `PATH` (`:189-212`). Every child
  process uses `execFileSync`/`spawn` with an argument array, so no shell is involved. This is a
  developer tool trusting its own machine, the same model as the existing `takes.mjs`.

## Findings

### F-1 (Low, fixed): the film named no licence for what a render draws on

`film/` had no attribution for the OFL fonts that `local/fonts.ts` bundles into every render, the
system font `film.json` names, the logo, or the generated narration and music. The fonts' licences
were tracked beside the woff2 files, so redistribution was allowed. What was missing was the
statement from `film/` itself. *Fix:* `345690d` adds a "Third-party assets" table to
`film/README.md`, with each asset's path and licence, and a rule that a committed render or clip
needs its own line there first.

### F-2 (Low, operator): generated narration and music

`film.json` asks ElevenLabs for the narrator voice and one music cue (`:8-15`, `:21-34`). The
output is gitignored and was never tracked, so the repository does not carry it. A published
render does. Whether the account's plan allows public, commercial use of that output is a fact
about the operator's account that this scan cannot check offline. *Action:* operator confirms the
plan's terms before posting a render. Nothing in the repo needs changing.

### F-3 (Low): the capture writes under any film dir it is given

See question 3. *Exploit sketch:* none. Only the person running the script chooses the path, and
the delete is limited to `<film-dir>/take/.raw`. *Action:* report only. A guard that refuses a
`<film-dir>` outside the repo would belong in `film-capture.mjs`, which is under
`apps/desktop/client/`, outside this task's paths.

### F-4 (Info): a loopback dev server while the capture runs

See question 3. Loopback only, a fixed port that fails if taken, stopped at exit. *Action:* accept.

### F-5 (Info): kit, Playwright and ffmpeg come from the developer's machine

See question 3. A hostile `DEMO_FILM_KIT` or `PLAYWRIGHT` is a hostile developer environment, which
is outside this app's threat model. *Action:* accept.

### F-6 (Info): the director is in the release bundle but refuses to start

The film capture mode adds code to a page that was already a build input. It is inert in the shell
(question 3). *Action:* report only. Dropping `director` from the rollup inputs for the Tauri build
would remove it from the bundle. That change is in `apps/desktop/client/`, outside this task's paths,
and the browser preview build needs the page, so it is a product decision.

### F-7 (Info, operator): the commit email in history

See question 1. *Action:* operator decides. A commit cannot change it.

## Known, not re-reported

- `services/house-seller` reading its seeds from host environment variables: the AGENTS.md exception
  (DECISIONS §14), restated in the range only as a conform note in `.ai/`.
- The dev server's `fs.allow` of the repo root (`vite.config.ts:20`) predates this range.

## Dependencies, secrets and risky patterns

- **Dependencies.** The range changes no `Cargo.toml`, `Cargo.lock`, `package.json` dependency or
  lockfile. `remotion` and `@film/kit` in `film/local/*.tsx` resolve from the external kit, not from
  this repo's manifests.
- **Secrets.** None tracked, none in the range's history (question 1).
- **Risky patterns.** No `eval`, no shell string execution, no `fetch` in `film/` or the capture
  script. `fonts.ts` loads only bundled asset URLs.

## Verification

- `git log -p 3dd1174..31ed7b4` grepped for secrets, emails, absolute paths and URLs.
  `git log --numstat` found no binary files. `git log --all -- film/out film/take film/audio` is
  empty. `git check-ignore` confirms `film/{audio,take,out}/` and `film/.env` are ignored.
- Gates at the end of this branch: `cargo check --workspace --exclude table-desktop` and
  `cargo test --workspace --exclude table-desktop`. `table-desktop` is excluded because its
  `generate_context!` needs the gitignored `client/dist`, which this worktree does not have. No
  client file changed, so tsc and vitest were not run.

## Decisions-style note

No decision is recorded: F-1's fix is documentation inside `film/`. If F-6 is taken up, the note
would read: *"The release build leaves out `director.html`. The browser preview build keeps it."*
