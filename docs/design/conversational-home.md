# Conversational home: does it need MCP?

Status: design note, 2026-10-31. The board as built now looks and reads as [The Proof Table](the-proof-table.md) (2026-11-03). Prototypes are in the (gitignored) contest arena; nothing here is built in the client.

## The idea in one paragraph

A single-page alternative to the 20-layer console. It opens on what needs the owner (or on setup when the wallet is new), lets her click into the decision behind each item, and answers everything else in a chat whose replies are panels chosen by the assistant from a closed set.

## Answer: no new MCP server is needed for the base design

**The UI already has a typed, gated API.** The main window can call 71 IPC commands through `useQuery` / `useMutation` (`lib/hooks.ts`). The reads a chat needs already exist: `attention_list`, `list_deals`, `deal_history`, `mandate_list`, `envelope_get`, `rescue_book`, `safety_record`, `audit_page`, and `book_query` (a closed query a model can generate as JSON; Rust rejects anything off-schema).

**The existing MCP server is the wrong tool.** `table-mcp` (`crates/table-mcp/src/lib.rs`) is a loopback server for negotiating agents the wallet launches. Its seven tools are scoped to a deal and a role, sessions last 120 s, and the client never calls it. Reusing it would hand a chat model negotiation tools it should not have.

**Where MCP would matter.** Only if the chat model runs out of process, for example `claude-code` or `codex-cli` driving the chat. Then those CLIs need a tool surface, and it should be a new read-only role (the same reads as above) plus `approval_open` as its single write. Today both engines are reported `available: false` until the isolation spike passes, so this is a later option, not a dependency.

## What is missing instead

1. **A model path.** No model call is reachable from the UI. "Ask your book" and "Say it" are fixed-grammar parsers. A real assistant needs a Rust-side caller (keys must not enter the webview; engines already strip them) and one new command with an authority-table row at `read`/`ui` tier, `main` label, plus a mock handler and contract entry.
2. **A panel renderer.** The registry standard (schema-driven-ui) gives the shape: a closed, versioned node vocabulary mapped onto the existing `shared/ui` primitives; one validation door that salvages valid nodes and discloses what it dropped; the renderer takes capabilities from the host and imports no global state.
3. **Two attention signals** the dashboard would want and nobody computes: rules expiring (derive from `payload.expires`) and a limit about to be hit (`nearLimit()` already exists in `lib/limits.ts`).

## The line that does not move

- Deciding and signing (`deal_countersign`, `deal_capture`, `deal_void`, `shield_release`, `rescue_approve`, `mandate_sign`, `envelope_sign`) stay in the approval window, behind its token and unlock. `console/guard.test.ts` fails if a main-window file names them.
- The chat may only open the right decision: `approval_open { deal_id, target, draft? }`, exactly as "Say it" does. The registry rule says the same: an action in a spec is a proposal, resolved by the host and armed only through the consent gate, and the confirmation is rendered from the resolved action, not from the spec's own label.
- Counterparty free text (`counterparty_note`, transcript bodies) is untrusted. A model must not read it unquarantined, or the chat becomes a prompt-injection path into a wallet.
- Silence never moves money, so the dashboard states what happens on silence for every item.

## Where it plugs in

`App.tsx` renders `<Console/>` inside `WorldProvider`, `ToastProvider` and `CounterpartyProvider`. A sibling view beside `Console` shares all three and keeps the console reachable for deep links (every module and deal already has a hash route). A third branch in `CentreLayer` (`console/layers/core.tsx:189`) is the cheaper alternative and keeps the top bar, Find and Esc. First-run state comes from `useStart().show` (`lib/firstRun.ts:79`) and the world flag `?first_run=1` previews it.

## Deviations and risks

- Deviation to record when built: any panel kind that is not a thin read of an existing command would break "one authority per vocabulary"; keep the panel registry derived from the command contract.
- The scripted prototype assistant is not evidence that a live model picks good panels. Measure that separately (an eval over a fixed set of intents) before shipping a model-driven version.
