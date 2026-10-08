# Agents and engines

An agent is a run that works one deal for the owner: it haggles, proposes a purchase, or reads
the owner's records. An engine is the program that drives the run. Today the working engine is
the built-in policy negotiator, labelled "Practice agent". It bargains with fixed concession
rules inside the price range the owner signed and uses no LLM. The owner's own `claude-code` or
`codex-cli` can be installed and probed, but they stay unavailable until a live isolation spike
proves they see only the wallet's tools. Whatever the engine, an agent reaches the wallet only
through a closed tool surface (MCP). It reads a closed projection of its table, and every call is
checked against the signed rules. No tool moves money: paying, approving, capturing and refunding
happen only in the [money pipeline](./money-pipeline.md).

## What the owner sees

- **main window, Settings ("The Circuit", `windows/main/setup/CircuitView.tsx`):** an "Agent app"
  picker listing `claude-code`, `codex-cli` and the practice agent, each with its version or why
  it is not available. "Pause all agents" works with one click and no confirmation, because
  stopping is always free. "Resume agents" undoes it. The roster of agent keys comes from
  `owner_facts`.
- **main window, deal page:** a "Start agent" button ("Agents paused" while paused). The
  Details list has an "Agent app" row with the engine id and a "Practice agent" badge
  (`runBadge` in `lib/words.ts`, `RunBadge` in `shared/honesty.tsx`). An "Agent instructions"
  row opens "What your agent app is told": the role's playbook, word for word. A practice-agent
  run shows "None: fixed price rules inside your range".
- **Rewind and the deal's "Who decided" list:** an agent's refused call shows as "Your rules
  refused …" with no PayPal tick (see [home-and-rewind.md](./home-and-rewind.md)).
- **tumbler:** "Pause all agents" is also offered here (`pause_all_agents` is granted to main and
  the Tumbler). Agents never appear in the Tumbler by name, and no counterparty text appears there.
- **approval window:** no agent controls. An agent can never open or answer it.

## How it works

1. **Roles and keys.** Three agent keys live in the OS keychain, one per slot (`AgentSlot`:
   negotiator, shopper, assistant; `crates/table-client/src/lib.rs`). A mandate pins one agent
   key. Rust selects the signer from the deal's mandate, never from model input
   (`Wallet::select_signer`). The role follows the key and the deal kind (`AgentRole`:
   Negotiator, Shopper, Assistant; `crates/table-app/src/agent.rs`).
2. **Start.** `agent_start` (main) calls `Runtime::start_agent`
   (`crates/table-runtime/src/engines.rs`). It refuses while paused, past four runs, or when the
   deal already has one. It refuses an engine marked unavailable, a terminal deal, a Replay deal,
   and invoice or rescue deals. It runs the mandate check before any grant exists. Then it mints a
   run id, an MCP grant bound to that run (expiry 120 s), and writes a `run.start` audit row.
3. **Tool surface.** The wallet serves MCP on `127.0.0.1` (`crates/table-mcp/src/lib.rs`,
   `Server`, at most 64 sessions). Each role sees a fixed catalogue (`catalog()`):
   - Negotiator: `table_view`, `market_reference`, `send_offer`, `accept_offer`,
     `withdraw_offer`.
   - Shopper: `market_reference`, `propose_purchase`.
   - Assistant: `book_query`.

   `market_reference` answers with the deal's fresh cached market band only (`p25`, `median`,
   `p75`, `retrieved_at`, `response_hash`, `cached`). The fair-price certificate behind it (the
   comparables and the market's product ids) is dropped before the answer (`crates/table-app/src/agent.rs`); it is evidence for the
   owner, never agent input.

   Every tool has one fixed description (`description()`), and every description says it moves
   no money. A session can list tools before it is enabled but cannot invoke one until the host
   enables its grant (`grant_pending` / `enable`).
4. **Closed projection.** `table_view` returns `AgentProjection` (`crates/table-core/src/agent.rs`):
   deal id, side, kind, a fixed counterparty label (house / paired_wallet / unpaired), item,
   quantity, currency, delivery, phase, prices, the signed band (floor, ceiling, rounds used and
   left, deadline), market quartiles and freshness, a price-only history of at most 64 steps,
   whose turn it is, and which tools can succeed now. Every type is `deny_unknown_fields` with no
   free text field. NOTE, HELLO and APPROVED cannot be represented. Counterparty words never
   reach an agent.
5. **Each call.** `send_offer` / `accept_offer` / `withdraw_offer` first ask
   `AgentProjection::refusal` (turn, rounds, deadline, shield hold, closed table, band). Then the
   mandate check and the wallet limits run, and an accept above "Ask me above" (clause 6) is
   refused as `owner_approval{6}` before anything is signed. Allowed intents become signed
   envelopes in the transcript. They never call PayPal.
6. **Refusal codes.** Every refusal is one closed `RefusalCode` with fixed text, returned as an MCP
   `isError` result with `{code, clause, text, detail?}` in `structuredContent` and as JSON text.
   The codes: `mandate_clause{clause}`, `wallet_limit`, `outside_band`, `rounds_exhausted`,
   `deadline_passed`, `owner_approval{clause}`, `group_closed`, `shield_hold{rule}`,
   `not_your_turn`, `table_closed`, `paused`, `run_ended`, `session_not_enabled`, `tool_absent`,
   `malformed_call`, `out_of_scope`, `market_unavailable`, `invalid_request`, `unavailable`.
   Every refused call writes exactly one `intent.refused` audit row
   `{layer, tool, code, clause, reason}` (`Wallet::audit_refusal`).
7. **Role playbooks.** A native run starts from its role's playbook, compiled in from `prompts/`
   (`Playbook`: `buyer_haggler` → `prompts/buyer-haggler.md`, `seller_counter` →
   `seller-counter.md`, `shopper` → `shopper.md`, `shop_assistant` → `shop-assistant.md`). The
   text is fixed: nothing is spliced in at run time. `RunSnapshot.playbook` names it for the UI.
8. **The policy negotiator (practice agent).** `table_engine::PolicyEngine`
   (`crates/table-engine/src/policy.rs`) uses `EngineId::Scripted` and runs in
   `Mode::ScriptedEngine`. It calls `tools/list`, then `table_view`, then one of
   `send_offer` / `accept_offer` / `withdraw_offer` through the same MCP grant. It decides from a
   typed `PolicyBrief` (signed band, transcript shape) and the projection, using
   `table_core::negotiation`. The buyer opens at its floor (else the fresh market p25, else 60% of
   the ceiling) and concedes linearly toward the lower of the ceiling and a fresh median. The
   seller concedes from its ask toward its floor. Neither ever goes outside the band.
   `Runtime::arm_policy_run` starts one run per peer OFFER, COUNTER or ACCEPT (keyed on the
   transcript head), only when the practice agent is selected and agents are not paused. The
   buyer's first offer is always the owner's "Start agent".
9. **Native engines (`claude-code`, `codex-cli`).** `NativeEngine`
   (`crates/table-engine/src/native.rs`) does the following:
   - resolves the executable directly or through a recognised npm layout, never running shim
     text;
   - clears the environment, restores a small allowlist and strips API keys and parent-session
     variables (`STRIP_ENV`);
   - writes token-free temporary MCP config;
   - on Windows, starts the child suspended inside a kill-on-close Job Object.

   Input is withheld until the stream parser accepts a tool inventory equal to the wallet's
   catalogue (`parser.rs`, `TOOLS`, `wallet_tool`). A missing or decoy tool fails closed.
   `argv()` passes only the wallet MCP server and disables shell and web tools. The version probe
   always returns `available: false` with "Pre-input tool inventory is not established; run
   isolation spike", so `start_agent` answers "Engine isolation conformance not established".
10. **Pause and end.** `pause_all_agents` persists the pause, cancels every job and revokes every
    grant. Calls queued under an old run are re-checked against that exact run and its expiry
    (`run_ended`). Deadlines, read-backs and approval polls keep running.

## Safety properties

| Invariant | Where it is enforced |
| --- | --- |
| No tool moves money | `table_mcp::catalog` and `table_engine::TOOLS` list seven tools, none a payment; `AgentService` owns no PayPal client; test `every_tool_is_described_and_no_description_or_tool_moves_money` |
| Counterparty text is never an instruction | `AgentProjection` has no free-text field; NOTE bodies are `Body::Note` and never projected; test `table_view_is_the_closed_projection_and_a_counterparty_note_never_reaches_it` |
| Every intent passes the mandate check before any network call | `Wallet::mandate_check` / `envelope_check` before signing; refused intents write `intent.refused` and zero `paypal_calls` |
| The engine sees only wallet tools | `argv()` flags, stream allowlist check, pre-input inventory gate; native engines unavailable until proven |
| The signer is chosen by Rust | `select_signer` from the mandate's pinned key |
| Above the owner's threshold, only the owner accepts | `owner_approval{6}` refusal; `deal_owner_accept` is approval-window only |
| Bounded runs | four runs, one per deal, 120 s grants, 64 MCP sessions, 64 retained run summaries |
| No vendor product names on screen | engines shown by id (`claude-code`, `codex-cli`) or "Practice agent"; playbook test checks for vendor names |

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Domain (pure) | `crates/table-core/src/agent.rs`, `negotiation.rs` | `AgentProjection`, `TablePhase`, `RefusalCode`, `Playbook`, `Policy`, `BuyerPolicy` |
| Agent service | `crates/table-app/src/agent.rs` | `AgentRole`, `AgentScope`, `Wallet::projection`, `accept`, `withdraw`, `audit_refusal`, `refusal_code` |
| MCP server | `crates/table-mcp/src/lib.rs` | `Server`, `Grant`, `catalog`, `description`, `playbook`, `refusal_result` |
| Engines | `crates/table-engine/src/` | `EngineAdapter`, `EngineId`, `PolicyEngine`, `NativeEngine`, `argv`, `StreamParser`, `windows_job.rs`, `bin/engine-fixture.rs` |
| Runtime | `crates/table-runtime/src/engines.rs`, `policy.rs`, `configuration.rs` | `start_agent`, `attach_scripted`, `attach_native_engines`, `policy_brief`, `arm_policy_run` |
| Playbooks | `prompts/*.md`, `bindings/playbooks.ts` | four role texts |
| Client | `windows/main/setup/CircuitView.tsx`, `windows/main/DealView.tsx`, `windows/main/deal/Instructions.tsx` | engine picker, pause/resume, Start agent, instructions sheet |

IPC commands (from `crates/table-client/src/authority_table.rs`; all runtime-enforced, no token):

| Command | Windows | Tier |
| --- | --- | --- |
| `engine_status`, `agent_runs` | main | read |
| `engine_select`, `agent_start`, `resume_all_agents` | main | act |
| `pause_all_agents` | main, tumbler | act |

Event `agent:changed` (main) carries `RunSnapshot` with no model text.

## Tests that pin it

- `crates/table-mcp/tests/server.rs`: `h1_m3_out_of_band_is_error_and_zero_paypal_rows`,
  `table_view_is_the_closed_projection_and_a_counterparty_note_never_reaches_it`,
  `every_refusal_is_coded_audited_once_and_never_reaches_paypal`,
  `every_tool_is_described_and_no_description_or_tool_moves_money`,
  `each_playbook_names_exactly_its_roles_tools_and_no_other_wallet_tool`.
- `crates/table-core/src/agent_tests.rs`: `the_projection_is_closed_and_carries_the_six_four_fields`,
  `refusal_codes_are_closed_tagged_and_carry_fixed_text`.
- `crates/table-engine/tests/engine.rs`: `s3_inventory_missing_or_decoy_tools_fails_closed`,
  `stream_allowlist_is_exactly_the_tools_the_wallet_server_serves`,
  `e1_both_adapters_pass_one_conformance_suite_for_both_profiles`.
- `crates/table-engine/tests/native.rs`: `native_preinput_failures_and_watchdog_never_send_prompt`,
  `inherited_canary_environment_is_stripped_before_child_launch`.
- `crates/table-runtime/src/policy_tests.rs`:
  `buyer_policy_above_the_signed_ceiling_is_refused_and_leaves_no_paypal_rows`,
  `rearming_never_exceeds_four_runs_or_one_run_per_deal`,
  `e2_every_scripted_engine_run_carries_the_mode_its_agent_card_labels`.
- `crates/table-runtime/src/agent_surface_tests.rs`: `a_native_run_starts_from_the_closed_table_and_its_role_playbook`,
  `the_agent_market_tool_answers_with_the_band_and_never_the_comparables`.

## Known gaps and UNVERIFIED

- **Native engines are gated.** No real model has run. Spikes 1 and 2 (decoy MCP config, tool
  inventory before input, live isolation and cancellation) are unrun (`docs/build/SPIKES.md`).
  Only the version-only spike 6 passed. Probed versions: claude-code 2.1.287, codex-cli 0.160.0.
- `// UNVERIFIED:` in code:
  - `crates/table-engine/src/argv.rs`: codex-cli MCP approval mode, and `env_http_headers` on
    the installed version.
  - `crates/table-engine/src/native.rs`: the native NDJSON input shape and init ordering.
  - `crates/table-mcp/src/lib.rs`: whether either engine shows MCP `structuredContent` to the
    model with protocolVersion 2024-11-05. The first text block carries the same JSON.
- The practice agent supports only the negotiator role. A practice run for a shopper or
  assistant key is refused with "Scripted fixture supports table-view only"
  (`engines.rs`). The message predates the policy negotiator and the run no longer just reads
  the table.
- A wallet seller refuses inbound offers below its own floor, so only the house seller produces
  real counters. Withdrawing on exhausted rounds is not tested end to end.
- Catalog tools (`shop_search`, quote, checkout) are not built. `propose_purchase` supports one
  mandate-bound template line.
- `prompts/shield.md` is a stub and is not loaded. The toolless profile uses a fixed prompt in
  `native.rs::system_prompt`, and the shield's model-caution path has no production caller (see
  [shield.md](./shield.md)).
- No approval-window view of refusals per code yet.

## Related

- [money-pipeline.md](./money-pipeline.md): what happens after an agent's ACCEPT agrees a deal.
- [tables-haggling.md](./tables-haggling.md): haggles and the negotiator on the Tables page.
- [spend-purchases.md](./spend-purchases.md): purchase proposals that wait for the owner.
- [mandates-and-rules.md](./mandates-and-rules.md): the clauses every agent call is checked against.
- [book.md](./book.md): the assistant's `book_query`, and the owner's own questions with no agent.
- [ipc-and-authority.md](./ipc-and-authority.md).
- Design: [the-table.html](../design/the-table.html) §6.4 (agent view of the table), §8, §9;
  [STATUS.md](../build/STATUS.md) "T2 deterministic negotiator" and "Agent tool surface 1".
