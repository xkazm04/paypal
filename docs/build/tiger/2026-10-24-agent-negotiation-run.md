# Tiger deepening: agent-negotiation-run (2026-10-24)

A /tiger value pass on The Table's headline feature: the agent that haggles for its owner through
the MCP fence. It covers the policy negotiator and the native engines, the relay, the pipeline up to
the owner's approval, and the deal view the owner watches. The operator fixed the area (no hunt
ranking), with two council rounds. Goal lens: what makes the haggle markedly more valuable and more
legible for a Devpost judge watching a 3-minute video and for a non-technical merchant owner,
without weakening any fence. Headless run: the operator's 2026-10-24 standup direction authorised
building up to three items that meet all five criteria (offline-verifiable, inside the declared
paths, no money-touching IPC change, no live PayPal, every AGENTS.md invariant holds). Everything
else waits on the operator.

## Thesis

Make the haggle the owner and the judge watch the one the wallet actually plays:

- every number is engine-true and pinned by a test;
- the page shows the result and names the agent that acted;
- the stops that silently kill a real haggle today become decisions Maya can make.

No fence changes.

## Seats

| Seat | Lab | Round 1 | Round 2 | Proposals | Anchors valid | Peer mean |
|---|---|---|---|---|---|---|
| `agy:gemini-4-argon@high` | Google | completed, 473 s | completed, 359 s | 7 (2 fusions) | 100% | 4.5 |
| `codex:gpt-6.1-sol@xhigh` | OpenAI | completed, 509 s | completed, 647 s | 6 (2 fusions) | 100% | 5.1 |
| `claude:claude-opus-5-5@xhigh` | Anthropic | completed, 1472 s | completed, 529 s | 7 (2 fusions) | 100% | 8.2 |

- **Skipped:** `grok:grok-4.7@high`. Its probe returned an unknown error with an empty reply.
- **Pool:** 20 proposals (14 in round 1, 6 fusions in round 2).
- **Cost:** reported by the Claude seat only ($11.37). The codex and agy CLIs report none (n/a).
- **Judge:** the caller (Claude Opus 5.5), reading the pool blind with each premise checked in code.
- **Judge's own family:** the Claude seat led the proposals peers rated highest (8.2 mean), and its
  P08 led C3. The peer ratings were independent of the judge.

## Scope

Ordered by dependency. Source ids are pool ids. "n seats" counts the seats that proposed the move
independently.

### Core

| Item | What changes for Maya and the judge | Sources | Status |
|---|---|---|---|
| C1 Name the run that acted | The deal's Details and Instructions name the live run, else the newest. Today they name the deal's oldest: `agent_runs` lists finished runs oldest first, and the practice agent starts a run per peer message. This was the open condition of DECISIONS.md section 21 for ungating the native engines. | P02, P12, P20 (3 seats) | **Built** 7c6ae49 |
| C2 Show how far their price came down | Two new facts on a buyer haggle: "Dan's price is down: $60.00 from $389.00 (15.42%)" and "Room under your most: $11.00". Both come from signed, checked messages only. It compares their listing with their latest price (never your own bid) and makes no "saved" claim. | P11, P01, P16, P17 (3 seats) | **Built** 872b6a6 |
| C3 Pin the demo haggle to the engine | A golden runtime test plays the demo's limits through the real practice agent and the wallet's MCP door, one run per counter from Dan. The limits: most $340 over six offers, ask-me above $250, market p25 $300 and median $330. It asserts the signed $300 / $306 / $312 / $318 / $324, one wallet refusal of the agent's ACCEPT of $329 on the ask-me rule, a gate on that rule, an unagreed deal and zero PayPal calls. | P08, P16, P17, P19 (3 seats) | **Built** 614ed59 |
| C4 Re-cut the film and fixture from C3 | Maya's prices, Dan's counters and the captions in D-0193, `director/beats.ts` and `film/` all come from C3. A test fails on any caption amount the engine doesn't sign. | P08, P16, P17 | Waits on the operator |
| C5 Hear a seller above the limit | Today a buyer table can't open on a listing above its ceiling, and a seller's counter above it is dropped at intake, so the haggle dies. C5 keeps such messages signed and greyed: they can't be accepted, but the agent answers them. | P06, P15, P19 (3 seats) | Waits on the operator |
| C6 Ask Maya when the seller accepts above her line | A seller's ACCEPT of her agent's offer above the ask-me line raises the same gold decision as a counter does. Today nobody can countersign it, and it lapses. | P07, P15, P18 (2 seats) | Waits on the operator |

### Supporting

| Item | What changes | Sources | Status |
|---|---|---|---|
| S1 The agent's price ladder | "Step 3 of 5, toward $330 the typical price", plus "next offer" and "most your agent will offer". Rust computes it from the same function that decides. It is shown only while the practice agent runs, and only under a bubble whose signed price equals its step. | P09, P16, P17 (2 seats) | Waits on the operator |
| S2 Re-arm on a re-signed band | Key re-arming on (transcript head, mandate version), so a band Maya re-signs mid-haggle wakes the agent once. | P04, P15, P18 | Waits on the operator; needs C5 or C6 for its main case |
| S3 The stop inline in the thread | "Your agent would take $329; above $250 your rules hand it to you", placed after Dan's counter. Today this appears only in "Who decided". | P02, P16 | Waits on the operator |
| S4 Below-listing at the decision | The C2 numbers as a row in the approval window's Diff. Needs `askingDrop` moved to `lib/`. | P01, P17 | Waits on the operator |

### Leaps

| Item | What changes | Sources | Status |
|---|---|---|---|
| L1 Every move provable | `run.start` records the typed brief and the market digest. A pure replay re-derives each practice-agent move, and `table-verify` gains a "strategy" check. | P10, P12, P20 (2 seats) | Waits on the operator |
| L2 "Try for less" at the gate | Re-sign a lower limit and send the agent back. Rust previews its next move before signing. | P18 | Waits on the operator; needs C6, S1, S2 |
| L3 Rehearse a rule change | A read-only preview of the agent's offers and stops under a drafted band. | P13, P20 | Waits on the operator |

### Left out

- **P05:** false premise. No Tight / Balanced / Fast stances exist, and `decide_on_schedule` is the
  seller's rule. Its forward-ladder idea lives on in S1.
- **P14** (comparison-mode shop-around): effort L, post-submission.
- **P03** (shop-around strip on the deal page): premise not verified beyond its anchors; kept for a
  later round.

## What was built

All three are display or test changes. None adds or changes an IPC command, touches the money path
or calls PayPal.

- **7c6ae49** `fix(deal)`: `actingRun` in `apps/desktop/client/src/windows/main/deal/model.ts`, used
  by the deal page's Details and Instructions.
  - Test: `model.test.ts` "actingRun: the deal page names the run that acted". It fails under the old
    first-match rule.
- **872b6a6** `feat(deal)`: `askingDrop` and two buyer-side facts in `standingFacts`
  (`windows/main/deal/story.ts`), fed the conversation the page already reads.
  - Test: `story.test.ts` "how far their price came down". It covers D-0193, comparing their price
    and never your bid, unchecked signatures, no move, a missing listing, another currency, and the
    seller side.
- **614ed59** `test(runtime)`:
  `the_demo_haggle_is_what_the_practice_agent_signs_and_it_stops_at_the_ask_me_line` in
  `crates/table-runtime/src/policy_tests.rs`. It adds `setup_priced` in `tests.rs`.
  - Replacing the asserted prices with the film's current $290 / $305 / $314 / $321 / $327 fails
    the test.

## Found while building (not items)

- **F1. A buyer table can't open above its ceiling.** `create_deal` mandate-checks the deal's terms
  (`crates/table-runtime/src/service.rs`), and the signed listing must equal them. So "Dan asks $389
  against a $340 ceiling" can't happen in the app; C3 lists at $340 for that reason. This is folded
  into C5.
- **F2. Warm-up refusals in the owner's record.** Each practice-agent run retries `table_view` until
  its grant is enabled (`crates/table-engine/src/policy.rs`). The MCP fence audits each early read
  as an `intent.refused` with `session_not_enabled`, and the safety record counts it in its "out of
  turn" family (`crates/table-runtime/src/safety.rs`). The C3 run left six such rows in one normal
  haggle.
  - Not built: changing what the fence audits is the operator's call.
  - Two fixes to weigh: stop auditing the pre-enable read, or have the engine wait for its Init to
    be processed.

## Waits on the operator

Every item from C4 to L3 above, plus F2. In the scope's own order of value: C5 and C6 first (they
decide whether a real haggle can finish), then C4 (the video's numbers), then S1. Each is listed
verbatim in this run's result for approval.

## Gates

At the end of the run, in the worktree: `cargo fmt --all --check` clean, `cargo clippy --workspace --all-targets -- -D
warnings` clean, `cargo test --workspace` 914 passed, 0 failed, 10 ignored.
Client: `tsc --noEmit` clean and `vitest run` 204 files / 1970 tests passed, both run in the
worktree after `pnpm install --frozen-lockfile`. The merge gate itself runs neither.
