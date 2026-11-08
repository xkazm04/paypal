# Board view-choice evaluation

Does the assistant choose the right answer **form** for the owner's question: which panel or
panels, which proposal, or no panel at all when the honest answer is a sentence? The design note
(`docs/design/conversational-home.md`, last section) says to measure this before shipping a
model-driven board. This folder is that measurement.

## What it measures

A labelled set (`cases.ts`, 40 cases) of an owner question, the board it is asked against
(`maya`, `first_run`, `quiet`) and the expected form. Twelve cases are negatives: eight whose
honest answer is one sentence, four where a panel is right but an act proposal is not. Every panel
kind is covered, every safe act (`pause_agents`, `pause_agent`, `let_lapse`) appears once as a
positive and once as a must-not, four comparative questions expect two panels, and the same words
are asked against different boards ("What needs me?" on Maya's Friday, a new wallet, a quiet day).

Every reply goes through the real door (`validateReply`) first, exactly as the board receives it;
everything after that is scored on the validated reply (`score.ts`):

| Figure | Meaning | Denominator |
|---|---|---|
| schema-valid | the door kept every part and the reply was readable (cleaned text still counts; "repaired" is reported apart) | every case |
| exact choice | the panels shown are exactly the panels expected, in any order, with the deal / module / fate where the case names one, and nothing extra | cases that label panels |
| false trigger | a panel where the answer is a sentence, an act proposal the case did not expect, or anything on the case's must-not list | every case |
| missed trigger | an expected panel kind, or an expected act, is absent (a right kind naming the wrong deal is a wrong choice, counted as "wrong identity") | cases that expect a panel or an act |
| pass | schema-valid, exact choice, every expected act present, no false trigger | every case |

The table also prints the false triggers by cause, a confusion table (expected kind by shown kind,
`-` is no panel) and every failed case with its reason. Engine failures (timeout, no CLI, bad
output) are scored as unreadable replies, never skipped.

What it does not measure yet (the standard asks for these; each needs more than this folder):
field relevance judged by a model calibrated against people, drift over whole sessions, and whether
people catch seeded wrong answers. The `say` text is not scored (the poem case shows why it
should be: see below).

## How to run

- **Scripted arm**: part of `pnpm test` (`scripted.eval.test.ts`). It prints the table on stderr
  and asserts only that the harness runs and that schema validity is 100%. Accuracy is measured,
  never asserted.
- **Live arm**: `pnpm eval:board [--concurrency N] [--only id,id] [--limit N] [--out file]`.
  Runs every case through the dev bridge's own call path (`runClaude` in
  `scripts/assistantBridge.ts`: same prompt, schema, per-call budget cap, timeout and stripped
  environment) with the installed `claude` CLI and the owner's login. It costs real usage. Results
  go to the OS temp folder (`board-eval/claude-code-<time>.json`) unless `--out` says otherwise;
  never commit them. `ASSISTANT_CLAUDE_MODEL` picks a model; unset means the CLI default. If no
  CLI is found, or every call fails, it says why and writes nothing.

## Measured

### 2026-11-03, arm scripted, 40 cases

```
schema-valid      40/40  100.0%
exact choice      21/37   56.8%
false trigger      7/40   17.5%  (panel when prose 7, unexpected act 0, must-not 0)
missed trigger    12/31   38.7%
pass              21/40   52.5%
```

The misses: the scripted engine never proposes a safe act (3 missed acts, known gap on the feature
page), shows one panel for each comparative question (4), answers a named deal that does not need
her with the book list instead of the deal card (2), routes two rules questions to book and needs
(2), and answers "Dan's offer ends soon. What happens then?" with the week (1). Seven of the
eight sentence-shaped questions get a panel; only "What can you do for me?" gets prose.

### 2026-11-03, arm claude-code (CLI 2.1.317, CLI default model, concurrency 3), 40 cases

```
schema-valid      40/40  100.0%
exact choice      25/37   67.6%
false trigger      8/40   20.0%  (panel when prose 8, unexpected act 0, must-not 0)
missed trigger     4/31   12.9%
pass              28/40   70.0%
```

65 s wall time, median 4.4 s per call, reported cost $0.35 for the run. Every single-panel case,
every act case and every no-act negative passed. The twelve failures have two causes, both in the
prompt rather than in the model's reading of the question:

- **All eight sentence-shaped questions got a panel** (needs 5, deal, money, setup, book). The
  `say` lines were good sentences ("Yes, the dock supplies are paid."); the panel came on top,
  because `prompt.ts` tells the model to "Start with a show op", and the honest-gaps rule says to
  show the nearest panel. The product currently cannot answer in prose alone.
- **All four comparative questions got one panel** plus a focus, filter or console button for the
  second half, because the vocabulary still describes `show` as "replaces the current one" (the
  composed region has landed in the board, but the model-facing words are pinned for the shell).

One further observation the scorer does not catch: asked for a poem, the model wrote one before
turning to the deals, where the standard asks to divert.

## Changing a case

Never edit a case to make a run pass. A case changes only when the product's expected answer
changed (a new panel kind, a decision to answer some question in prose, a new act), and its `note`
then says what changed and why, so the figures before and after the change can be told apart.
Add cases freely; keep at least a quarter negatives (`cases.test.ts` checks the set's shape, never
an engine's answers).
