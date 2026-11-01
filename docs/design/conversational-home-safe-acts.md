# Safe acts from chat (conversational home)

Status: built with this note. Feature page: [`docs/features/conversational-home.md`](../features/conversational-home.md). Related: [`conversational-home.md`](conversational-home.md), [`conversational-home-engine-path.md`](conversational-home-engine-path.md).

## The question

Until now the board's assistant could only propose three hand-offs: open a decision, open a setup step, open a console page. Each one opens something; none of them changes the wallet. This note decides which small, reversible owner actions the assistant may also propose, so the owner can do them from the board after one explicit press, and how that press is guarded.

The fixed rules this note works inside:

- The assistant never moves money, and silence never moves money.
- The main window calls no decision-tier command except `approval_open` (which is `ui` tier).
- No new wallet command is added. A candidate needs a command that already exists at `act` tier or lower in the authority table (`bindings/authority.ts`, generated from `crates/table-client/src/authority_table.rs`) and that the main window may call (`labels` includes `main`).
- Anything at decision, owner or session tier, anything that moves, approves, signs, captures, voids or releases money, and anything that cannot be undone stays in the approval window or the console.

## The standard this follows

Registry subjects read before deciding: `schema-driven-ui` / technique `action-consent-wiring`, `hitl-approval` / technique `consent-gates`, and `cicd-monitoring` / technique `remote-action-consent` (for proportional confirmation and in-flight disarm). What they ask, and how this design answers:

| The standard says | Here |
|---|---|
| An action is a reference into a closed, host-registered vocabulary with typed parameters, never code. | `pause_agents` is one more entry in `ACTIONS` (`lib/assistant/vocabulary.ts`), with no parameters at all. |
| Rendering never executes; resolution happens before arming; an unresolvable proposal is shown disarmed with its reason. | The proposal row is inert until pressed. `switchboard/resolve.ts` resolves it against host data and either arms it or disarms it with a fixed reason. |
| The consent surface renders from the resolved action, never from the proposer's self-description. | The consent box is built from fixed words plus host facts (are agents paused, how many are working). The assistant's `why` is shown above it, labelled as the board's suggestion, and never inside it. |
| Disclose in units of consequence: what is done, to what, what it costs, whether it can be undone. | The box says what stops, what does not happen, and how to reverse it, with the live count of working agents. |
| Consent binds to the disclosed parameters; if they change before execution, re-ask. | The resolved action carries a fingerprint of the facts it was shown with. The press re-resolves; if the fingerprint changed the press does nothing and the row re-renders with the new state. |
| Confirmation proportional to blast radius; uniform "are you sure" is worse than none. | One explicit press on a box that already states the consequence. No second dialog for a reversible act. Irreversible acts are not offered here at all. |
| In-flight disarm: busy and disabled from click to acknowledgement. | The button is disabled and says "Pausing…" while the command runs; a second press cannot send a second command. |
| Fire, then watch: acknowledged is not succeeded; never fabricate the outcome. | The result line appears only after the command returns success, and the row reads the paused state back from the wallet's settings. A failure shows the wallet's own error notice. |

### Deviations from the standard (recorded, not hidden)

1. **No per-act decision record.** `action-consent-wiring` asks that each executed action record which proposal it came from, what the owner was shown and the decision. The wallet already writes the pause into its own settings, but nothing records that the press came from an assistant proposal or what the box said. Adding that needs a wallet-side write (a new command or a new field), which this work may not add. Consequence: "what did the board claim when she pressed it?" has no stored answer after the page is closed. Open question below.
2. **No standing grants.** `consent-gates` describes first-use grants that let repeats proceed silently. This design deliberately asks every time: the set is one act, it is rare, and a standing grant would be a second thing to revoke. This fails toward asking too often, which the standard allows.
3. The switchboard and `lib/assistant` have no row in `.ai/registry-map.json` yet (the map predates the board). A rescan should add them; until then the deviations above live here.

## Candidates, judged against the authority table

Every act-tier command in the table, and why it is in or out. "Main" means the main window may call it.

| Candidate act | Command | Tier | Main? | Reversible? | Blast radius | Verdict |
|---|---|---|---|---|---|---|
| Pause all agents | `pause_all_agents` | act | yes | Yes: Resume (one press, here or in Settings) | Every running agent run is cancelled; nothing new starts (policy runs, the market watch, the rescue watch and the seller's PayPal order step all hold while paused). No money moves; nothing is approved or cancelled; deadlines keep running and a deal left waiting lapses as it would if she did nothing. | **In.** Fails closed: it can only make the wallet do less. |
| Resume all agents | `resume_all_agents` | act | yes | Yes: Pause | Clears the pause. Starts no run by itself, but re-enables policy runs, the market watch, the rescue watch and the seller's order step, all inside her signed rules. | **Only as the host's own undo**, right after a pause made on the board. Not proposable by the assistant: the assistant may only suggest acts that make the wallet do less. |
| Let a pending ask lapse | `deal_let_lapse` | act | yes | **No.** It sets a hidden "lapse" mark on the deal; no command clears it. The deal leaves her needs-you list and the attention feed, and its agent is never restarted. | Money: none (the outcome is the silence outcome). But she loses the chance to say yes before the deadline from the board or the console. | **Out: not reversible.** Stays on the deal page in the console. |
| Withdraw my own offer | `deal_withdraw` | act | yes | **No.** It sends a signed withdraw to the other side and ends the deal. | No money moves, but the counterparty sees it and the deal is over. | **Out: not reversible and visible outside the wallet.** Stays in the console, where it already asks once. |
| Snooze a reminder 30 minutes | `deal_snooze` | act | **no** (tumbler only) | Yes | Hides a reminder for 30 minutes. | **Out: the main window may not call it.** |
| Dismiss or acknowledge a notice | none | - | - | - | - | **Dropped: no such command exists** at any tier. |
| Start an agent on a deal | `agent_start` | act | yes | Partly (pause) | Starts a negotiation that can reach an agreement. | **Out:** it makes the wallet do more and leads toward money. |
| Open a group of tables | `deal_group_open` | act | yes | No | Opens negotiations with several sellers. | **Out:** leads toward money, not reversible. |
| Pick the agent app | `engine_select` | act | yes | Yes | Changes who negotiates for her; checked for isolation. | **Out:** not a chat-sized choice; it lives in Connections. |
| Pairing steps | `pairing_create`, `pairing_join`, `pairing_poll`, `pairing_abort` | act | yes | Mixed | Trust with a counterparty. The board has no pairing data, so a target could not be resolved. | **Out:** trust setup, and nothing on the board to resolve against. |
| Wake the house seller | `house_wake` | act | yes | n/a | Demo seller plumbing. | **Out:** not an owner act. |
| Quit | `quit_confirm` | act | yes | No | Closes the app. | **Out.** |

So the final set the assistant may propose is **one act: pause all agents**, with **resume** offered by the host only as the immediate undo. Everything else either has no command, is not callable from the main window, is not reversible, or makes the wallet do more.

## Consent copy

Fixed words (in `lib/words/board.ts`, `BOARD_ACT`), with host facts filled in:

- Heading: **Needs your OK**
- Title: **Pause all your agents**
- What it does: "2 agents working now stop, and nothing new starts." / "No agent is working right now. Nothing new starts while they are paused." / "How many agents are working is not available yet. Nothing new starts while they are paused."
- What it does not do: "Nothing is paid, approved or cancelled. Deadlines keep running, and anything left waiting lapses with no money moving."
- How to reverse: "You can undo this here, or press Resume in Settings, Your agents."
- Button: **Pause all agents** (while running: "Pausing…")
- Result: "All agents paused. Their work stopped; nothing new starts." with **Undo** (resume). After undo: "Agents resumed. Nothing restarts by itself; restart a table in Settings if you want one back."
- Disarmed reasons: "your agents are already paused", "whether your agents are paused is not available yet".

## The gate, step by step

1. **The assistant proposes.** A `propose` op names `{ action: 'pause_agents' }` and a `why`. The validator (`validate.ts`) rebuilds it from the registry. For an act, a stray key (an amount, a deal id, a command name) does not get trimmed away silently: the whole op is dropped and counted ("1 part could not be shown"). A hand-off keeps the old repair rule.
2. **The host resolves.** `resolveAction(action, byId, facts)` in `switchboard/resolve.ts` maps `pause_agents` to the one command `pause_all_agents` and arms it only when the wallet's settings say agents are not paused. Unknown state or already paused disarms it with a reason. The resolved value carries the consent words and a fingerprint of the facts used.
3. **The consent surface.** The proposal row for an act draws the consent box from the resolved value only. The assistant's `why` sits above it as "The board says: ...". The model's words never appear in the title, the effect lines or the button.
4. **One explicit press.** The press re-resolves against the current facts and compares fingerprints. Only then does it call `pause_all_agents`, once. While it runs the button is disabled.
5. **The result.** On success the row shows the result line and an Undo button. Undo calls `resume_all_agents` and is the only way the board ever calls it. On failure the wallet's error notice is shown and nothing claims success.
6. **The answer was tidied.** A reply that the validator repaired (cleaned text, filled-in nulls) says so under the answer, so a repair is never silent.

## Why silence stays harmless

- Rendering a proposal runs nothing. A reply that is never pressed changes nothing; there is no timer, no default button, no auto-confirm.
- The only proposable act reduces activity. If the owner ignores it, agents keep working inside her signed rules exactly as before; if she presses it, they stop, and every deal falls back to its silence outcome, which moves no money.
- Resume, the one act that re-enables activity, is never proposed by the assistant and is only offered as an undo of a pause she just made.
- Hand-offs to the approval window are unchanged: money decisions still happen only there.

## Open questions (decided safely for now)

1. Should `deal_let_lapse` become reversible (a wallet command to clear the lapse mark)? If it did, it would qualify. Until then it stays out.
2. Should the wallet record that an act came from an assistant proposal, with the words shown (deviation 1)? That needs a wallet-side change.
3. Pause is all-or-nothing; there is no per-agent pause command. A per-deal pause would need a new command and is out of scope.
