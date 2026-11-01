# Safe acts from chat (conversational home)

Status: built. Round 1 shipped pause-all on existing commands only. Round 2 (this revision) adds the owner's three answers: a wallet command that undoes a lapse, a provenance record in the audit chain, and a one-agent pause. Feature page: [`docs/features/conversational-home.md`](../features/conversational-home.md). Related: [`conversational-home.md`](conversational-home.md), [`conversational-home-engine-path.md`](conversational-home-engine-path.md).

## The question

Before this work the board's assistant could only propose three hand-offs: open a decision, open a setup step, open a console page. Each one opens something; none of them changes the wallet. This note decides which small, reversible owner actions the assistant may also propose, so the owner can do them from the board after one explicit press, and how that press is guarded.

The fixed rules this note works inside:

- The assistant never moves money, and silence never moves money.
- The main window calls no decision-tier command except `approval_open` (which is `ui` tier).
- Every act runs on a command at `act` tier that the main window may call (`bindings/authority.ts`, generated from `crates/table-client/src/authority_table.rs`). Round 1 allowed no new command; round 2 added four act-tier rows on the owner's say-so (below).
- Anything at decision, owner or session tier, anything that moves, approves, signs, captures, voids or releases money, and anything that cannot be undone stays in the approval window or the console.
- Every proposable act can only make the wallet do less. No undo is proposable.

## The standard this follows

Registry subjects read before deciding: `schema-driven-ui` / technique `action-consent-wiring`, `hitl-approval` / technique `consent-gates`, and `cicd-monitoring` / technique `remote-action-consent` (for proportional confirmation and in-flight disarm). What they ask, and how this design answers:

| The standard says | Here |
|---|---|
| An action is a reference into a closed, host-registered vocabulary with typed parameters, never code. | `pause_agents` (no parameter), `pause_agent` (`agent`: one of three slots) and `let_lapse` (`deal_id`: a deal on the board) are entries in `ACTIONS` (`lib/assistant/vocabulary.ts`). The wallet side is a second closed enum, `AssistantAct` (`crates/table-client/src/acts.rs`). |
| Rendering never executes; resolution happens before arming; an unresolvable proposal is shown disarmed with its reason. | The proposal row is inert until pressed. `switchboard/resolve.ts` resolves it against host data and either arms it or disarms it with a fixed reason. |
| The consent surface renders from the resolved action, never from the proposer's self-description. | The consent box is built from fixed words plus host facts (paused or not, how many are working, which agents are paused, the deal's own label). The assistant's `why` is shown above it, labelled as the board's suggestion, and never inside it. |
| Disclose in units of consequence: what is done, to what, what it costs, whether it can be undone. | The box says what stops, what does not happen, and how to reverse it. |
| Consent binds to the disclosed parameters; if they change before execution, re-ask. | The resolved action carries a fingerprint of the facts it was shown with. The press re-resolves; if the fingerprint changed the press does nothing and the row re-renders with the new state. |
| Confirmation proportional to blast radius; uniform "are you sure" is worse than none. | One explicit press on a box that already states the consequence. No second dialog for a reversible act. Irreversible acts are not offered here at all. |
| In-flight disarm: busy and disabled from click to acknowledgement. | The button is disabled and says "Pausing…" while the command runs; a second press cannot send a second command. |
| Fire, then watch: acknowledged is not succeeded; never fabricate the outcome. | The result line appears only after the wallet answers success; the undo is offered only while the wallet's own facts show something to undo. A failure shows the wallet's own error notice. |
| Audit and provenance: record which proposal, what the user was shown, and the decision. | `assistant_act` writes one `assistant.act` row to the hash-chained audit log after the act runs: `source`, `act`, `agent`, the consent `words`, their SHA-256 and the fingerprint (`crates/table-runtime/src/acts.rs`). |

### Deviations from the standard (recorded, not hidden)

1. ~~No per-act decision record.~~ **Closed in round 2** by the `assistant.act` row. What is left: the row says the act came from the board's consent box, not which reply proposed it (the reply is not kept). And if the record cannot be written after the act ran, the act still stands: every act is reversible, so the board shows the error and the owner can undo it, rather than the wallet trying to roll back.
2. **No standing grants.** `consent-gates` describes first-use grants that let repeats proceed silently. This design deliberately asks every time: the acts are rare, and a standing grant would be one more thing to revoke. This fails toward asking too often, which the standard allows.
3. The switchboard and `lib/assistant` have no row in `.ai/registry-map.json` yet (the map predates the board). A rescan should add them; until then the deviations above live here.

## Candidates, judged against the authority table

Every act-tier command in the table, and why it is in or out. "Main" means the main window may call it.

| Candidate act | Command | Tier | Main? | Reversible? | Blast radius | Verdict |
|---|---|---|---|---|---|---|
| Pause all agents | `pause_all_agents` | act | yes | Yes: Resume (one press, here or in Settings) | Every running agent run is cancelled; nothing new starts (policy runs, the market watch, the rescue watch and the seller's PayPal order step all hold while paused). No money moves; nothing is approved or cancelled; deadlines keep running and a deal left waiting lapses as it would if she did nothing. | **In** (`pause_agents`). |
| Pause one agent | `agent_pause` (new, round 2) | act | yes (main only) | Yes: `agent_resume` | That agent's live runs are cancelled and none starts for it (including the policy re-arm, which starts runs through `agent_start`). Other agents keep working. The wallet's background passes (market watch, rescue watch, seller order step) follow pause-all only. No money moves. | **In** (`pause_agent`). |
| Let a pending ask lapse | `deal_let_lapse` | act | yes | **Yes since round 2**: `deal_lapse_undo` clears the mark before the deal ends. | Its outcome is the silence outcome: no money moves, nothing is agreed or cancelled early. It leaves her list now. | **In** (`let_lapse`), armed only for a deal on the board whose card offers it (a gate, never a closed mismatch); the wallet checks the same gate again. |
| Resume all / resume one / undo a lapse | `resume_all_agents`, `agent_resume`, `deal_lapse_undo` | act | yes | Yes | They turn activity back on. | **Only as the host's own undo**, right after the act was pressed on the board. Never proposable. |
| Withdraw my own offer | `deal_withdraw` | act | yes | **No.** It sends a signed withdraw to the other side and ends the deal. | No money moves, but the counterparty sees it and the deal is over. | **Out: not reversible and visible outside the wallet.** |
| Snooze a reminder 30 minutes | `deal_snooze` | act | **no** (tumbler only) | Yes | Hides a reminder for 30 minutes. | **Out: the main window may not call it.** |
| Dismiss or acknowledge a notice | none | - | - | - | - | **Dropped: no such command exists.** |
| Start an agent on a deal | `agent_start` | act | yes | Partly (pause) | Starts a negotiation that can reach an agreement. | **Out:** it makes the wallet do more. |
| Open a group of tables | `deal_group_open` | act | yes | No | Opens negotiations with several sellers. | **Out.** |
| Pick the agent app | `engine_select` | act | yes | Yes | Changes who negotiates for her. | **Out:** it lives in Connections. |
| Pairing steps | `pairing_*` | act | yes | Mixed | Trust with a counterparty; nothing on the board to resolve against. | **Out.** |
| Wake the house seller, Quit | `house_wake`, `quit_confirm` | act | yes | n/a / No | Not owner acts for chat. | **Out.** |

So the assistant may propose **three acts: pause all agents, pause one agent, let one ask lapse**. Each has an undo the host offers.

## The wallet side (round 2)

Four rows appended to the authority table, all `main` only, `act` tier, no token, no unlock, runtime-enforced:

| Command | Args | Does |
|---|---|---|
| `deal_lapse_undo` | `DealArgs` | Clears `lapse.<deal>` if it is set and the deal has not ended; refuses otherwise. The deal is this wallet's own (the ledger holds no other). Never touches money; does not restart the agent. |
| `agent_pause` | `AgentArgs { agent }` | Sets `agent_paused.<slot>` (sticky across restarts) and cancels that slot's live runs. |
| `agent_resume` | `AgentArgs { agent }` | Clears it; starts nothing. |
| `assistant_act` | `AssistantActArgs { act, consent }` | The board's one door: refuses consent words that are empty, longer than 800 characters or carry control characters (refused, never trimmed); runs the closed act (`pause_all`, `resume_all`, `let_lapse`, `lapse_undo`, `pause_agent`, `resume_agent`) through the same code as the direct commands; then appends one `assistant.act` audit row. A refused act records nothing. |

`SettingsSnapshot.paused_agents` lists the agents paused one by one, so the settings event carries it. The board now calls exactly two commands: `approval_open` and `assistant_act`. The consent words carry fixed product words, the wallet's own counts and a deal's label (D-0190), never a deal title or counterparty text; the audit door's own scrubber runs on them too.

## Consent copy

Fixed words (in `lib/words/board.ts`, `BOARD_ACT`), with host facts filled in:

- Heading on every act: **Needs your OK**
- **Pause all your agents.** "2 agents working now stop, and nothing new starts." / "Nothing is paid, approved or cancelled. Deadlines keep running, and anything left waiting lapses with no money moving." / "You can undo this here, or press Resume in Settings, Your agents." Button **Pause all agents**.
- **Pause your shopper** (or negotiator, assistant agent). "It makes agent purchases. Its work stops now, and nothing new starts for it. Your other agents keep working." Button **Pause the shopper**.
- **Let D-0190 lapse.** "It leaves your list now and lapses at its deadline, exactly as if you did nothing." / "No money moves. Nothing is agreed, and nothing is cancelled early." / "You can undo this here until its deadline." Button **Let it lapse**.
- Results, then **Undo**: "All agents paused…", "Your shopper is paused…", "D-0190 will lapse at its deadline. No money moves." After undo: "Agents resumed. Nothing restarts by itself…", "Your shopper is back…", "D-0190 is back on your list."
- Disarmed reasons: "your agents are already paused", "that agent is already paused", "all your agents are already paused", "whether your agents are paused is not available yet", "that deal is not on the board", "that deal cannot be left to lapse from here".

## The gate, step by step

1. **The assistant proposes.** A `propose` op names one act with its typed target and a `why`. The validator (`validate.ts`) rebuilds it from the registry. For an act, a stray key (an amount, a command name) is not trimmed away: the whole op is dropped and counted ("1 part could not be shown"). An unknown deal or agent drops it too.
2. **The host resolves.** `resolveAction(action, byId, facts)` arms the act only from wallet facts (settings, runs, the needs-you cards) and builds the consent box and the wire act. Otherwise it disarms with a reason.
3. **The consent surface.** The proposal row for an act draws the consent box from the resolved value only. The assistant's `why` sits above it as "The board says: …".
4. **One explicit press.** The press re-resolves against the current facts and compares fingerprints. Only then does it send `assistant_act` once, with the box's words. While it runs the button is disabled.
5. **The result.** On success the row shows the result line and an Undo button while the wallet still shows something to undo. Undo sends `assistant_act` with the undo act, also recorded. On failure the wallet's error notice is shown and nothing claims success.
6. **The answer was tidied.** A reply that the validator repaired says so under the answer.

## Why silence stays harmless

- Rendering a proposal runs nothing. A reply that is never pressed changes nothing; there is no timer, no default button, no auto-confirm.
- Every proposable act reduces activity. Ignored, agents keep working inside her signed rules; pressed, they stop or a deal falls back to its silence outcome, which moves no money.
- The acts that turn activity back on are never proposed; they are only offered as the undo of something she just pressed.
- Hand-offs to the approval window are unchanged: money decisions still happen only there.

## Open questions (decided safely for now)

1. The console does not offer the one-agent pause or the lapse undo as buttons of its own yet; both commands exist and the board uses them through `assistant_act`. Adding them to Settings and the deal page is a console change.
2. A one-agent pause leaves the wallet's background passes (market watch, rescue watch, seller order step) to the pause-all switch. If the owner wants those per agent too, that is a further wallet change.
3. Re-recording the proof samples was needed because the permissions fingerprint changed; the recorder used to miss a fingerprint-only change (the mask hid it) and now treats it as drift.
