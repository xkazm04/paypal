# Scout brief - scan-sweep --challenge, run challenge-2026-10-15

You are a READ-ONLY scout. Repo: C:\Users\mkdol\dolla\paypal (git, branch main, base sha e19a83d).
Do NOT modify, create or delete any file except your own card file (named below). No git commands that write. No cargo/pnpm builds (a baseline gate is running; a build would fight it for the target lock). Reading, grep and `git log`/`git show`/`git blame` are fine.

## Your job
Read your HOST context in full (every file listed in contexts.json under its slug) plus every RIDER context in full, then return **exactly two challenge cards** for the host (a card MAY target a rider instead):

- **Slot A - `architecture-challenger`**: the ONE structural move that stops this context being the reason something else is hard. A specific seam with its cost counted: a rule implemented twice that should be one module, a synchronous path that should be a job, a hand-maintained list that should be derived from its ground truth, a state machine hiding in booleans, a store call leaking through layers. Not a smell list, not "reduce coupling".
- **Slot B - `ux-elevation`**: the experience LEAP, not polish: a five-step flow that should be one, a decision the user makes blind though the app already holds the data, a surface that reports state it should let you act on, a missing mode (compare, bulk, undo, preview, resume). An operator-facing surface (CLI output, admin page, a service's public page) IS a user surface. If the host + riders have no user surface at all, slot B is a second `architecture-challenger` card on a DIFFERENT seam, with `"slot":"B-architecture (no UI surface)"`.

Consider many ideas; return the best two, and name the runner-up of each slot in one line.

## Floors (a card under any floor is not acceptable - re-scout the slot)
- size **M or L** (never S/XS; XL = spans contexts/modules or > ~15 files / > ~800 changed lines -> not a card)
- effort >= 5 (1-10), impact >= 7 (1-10), risk 4-8 (1-10)
- declared `write_set` (repo-relative paths, as `git ls-files` prints them), <= ~15 files, <= ~800 changed lines
- 3-8 `acceptance` cases: each "input -> expected result", concrete enough that a builder writes each as a FAILING test before touching the implementation. For a UX card: behaviour of the logic module under the surface (state entered, action enabled, call made). A claim that cannot be written as cases is not a card.
- gate must NOT be `irreversible` or `policy-loosen` or a contract consumed outside this repo (those are never built in this mode). `architecture` / `direction` inside the product's declared scope are allowed but must be named.

## Never re-propose
Read FIRST: `docs/concepts/moonshot-backlog.md` (§1 themes, §1a owner decisions, §4 all cards) and the headings of `docs/build/STATUS.md` (much of the moonshot deck is ALREADY BUILT - see the T1..T15 sections; read the section for anything near your context). A card that restates a built item or a moonshot card title is void. You MAY adopt a moonshot item that is NOT built (e.g. the post-submission wave-4 themes T13/T16/T17/T18/T19, or a "Not chosen now" approach) - say so explicitly and cite it, and note the owner scheduled it post-submission (submission deadline 2026-11-12). Also read `docs/` DECISIONS (find it with glob `**/DECISIONS*.md`) for owner rules that bind your area.

Note: a large client "console rebuild" landed 2026-10-14/15 (commits 8f03961, 3857b00, 84cfa96, 662824f). Judge the tree AS IT IS NOW; old docs may describe removed UI.

## Registry (optional, brief)
`.ai/registry-map.json` maps contexts to governing registry subjects (registry checkout at C:\Users\mkdol\dolla\ai-registry). If your context has a subject, skim its golden path; name a technique in the card when one applies. Do not spend more than a few reads here.

## Premise discipline
An independent critic will re-verify EVERY `file:line` you cite against the tree. A false premise voids the card. Cite only what you read. Paths are repo-relative.

## Card shape (all fields required)
```json
{"context":"<host slug or rider slug the card targets>","slot":"A|B|B-architecture (no UI surface)","lens":"architecture-challenger|ux-elevation",
 "title":"<= 80 chars","size":"M|L","effort":7,"impact":8,"risk":6,
 "write_set":["<repo-relative path>"],"new_files":["<path>"],
 "file_kinds":{"<path>":"hand-edited|generated-by-<X> (regen: <cmd>)|release-artefact-coordinator-owns"},
 "shared_surfaces":["<e.g. locale catalog, migrations list, COMMANDS table>"],
 "acceptance":["<input -> expected>", "... 3-8"],
 "premise":["<path>:<line> - <fact>", "..."],
 "rollback":"<how the commit series reverts cleanly>",
 "gate":"none|contract|policy-tighten|architecture|direction",
 "test_commands":["<the narrowest commands that run the new tests, e.g. cargo test -p table-runtime limits:: / pnpm --dir apps/desktop/client exec vitest run src/...>"],
 "runner_up":"<the slot's second-best idea, one line>",
 "adopts":"<moonshot card id / STATUS item it adopts, or null>",
 "body":"## Summary\n...\n\n## Description\n...\n\n## Flow\n- ...\n\n## Expected impact\n...\n\n## Evaluation\nClaim: ...\nBefore: 0 of N acceptance cases pass (...)\nAfter: N of N (predicted)\nMethod: simulation - <walked cases>; the gate rung is the builder's\nResult: better\nGate: ...",
 "evidence":"<code block / file:line list - the proof, not prose>"}
```

## Output - write BEFORE you reply
Write `.claude/scan-sweep/challenge-2026-10-15/cards-<host-slug>.json`:
```json
{"host":"<slug>","files_read":["..."],"cards":[<slot A card>,<slot B card>],
 "riders":[{"context":"<slug>","checked":"<files read, hypothesis traced, why no card went there - one line>"}],
 "never_repropose_checked":"<one line: which built/deck items you ruled out as overlaps>"}
```
Then reply in <= 15 lines: the two titles with size/effort/impact/risk, the runners-up, and anything the coordinator must know (e.g. a write set that touches a shared surface, a premise you are unsure of).
