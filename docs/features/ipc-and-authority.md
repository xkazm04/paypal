# IPC and authority: three windows, one table of who may do what

The Table runs as three windows over one Rust wallet. `main` is where the owner works. `tumbler`
is the small always-there window for alerts and gates. `approval` is the only window whose
commands can lead to money or grant authority. Every window talks to Rust through IPC commands.
Who may call each command is written once, in one row of the authority table
(`crates/table-client/src/authority_table.rs`). Everything else is generated or checked against
that row: the Tauri capability files, the shell's command list, the runtime's gate, the browser
mock's gate, and a permissions fingerprint the owner can read. A webview cannot choose its window
label, cannot read the approval token unless it is the approval window, and cannot invent an
owner decision.

## What the owner sees

- **main** (1440 × 900, capped to 90% of the work area): Home (the Dial), the six modules, the
  deal page, Settings. Closing it hides it to the tray. It never shows a money button.
  Privileged actions hand off: "Review & sign", "Open approval window", Setup steps that open
  approval on `credentials`, `mandate` or `unlock`.
- **tumbler** (a puck plus forms: card 440 × 152, stack 440 × 336, hand-off 440 × 160, welcome
  440 × 228): cards with time left and the "If you do nothing" line. It can withdraw, let lapse,
  snooze, pause agents and open the deal or the approval window. It never shows counterparty
  words.
- **approval** (744 × 660, opens beside the window that asked for it): starts locked ("Locked,
  unlock with Windows Hello"). It locks again after 15 minutes without a privileged action. It
  shows one gold decision at a time, with a hold-to-confirm button.
- **Settings › Detailed › approval lock › Details…** shows the "Permissions fingerprint"
  (monospace, groups of 8; `CircuitView.tsx`). Two installs with the same fingerprint run the
  same who-may-call-what table. A proof file names the fingerprint of the version that saved it.

See [window-duality.md](../design/window-duality.md) for the windows' forms and the attention
ladder, and [approval-window.md](./approval-window.md) and
[tumbler-and-attention.md](./tumbler-and-attention.md) for their screens.

## How it works

1. **Labels come from the shell.** Tauri assigns `main`, `tumbler` and `approval`. The
   capability files grant each label only its commands. Main is matched by webview, the others by
   window (`authority.rs`, `capability_json`).
2. **One row per command.** Each `CommandAuthority` row names:
   - `labels`: the windows that may call it;
   - `tier`: `read` < `ui` < `act` < `session` < `owner` < `decision`;
   - `token` and `unlock`: needs the approval token, needs the approval window unlocked;
   - `selection`: `none`, `in_approval` (from approval, only its own deal), `required` (always
     the selected deal) or `pairing_in_approval`;
   - `enforcer`: `runtime`, or `shell` for window-surface commands the shell answers itself.

   Tier `session` and above is the **release set**: approval window only. There are 71 rows
   today. 21 are in the release set and 6 are shell-enforced (`main_open`, `tumbler_set_form`,
   `tumbler_pin`, `tumbler_drag`, `tumbler_snap`, `proof_check`).
3. **The approval token.** `approval_token` returns a random 32-byte hex token, only to the
   `approval` label (`ApprovalSession::token`, `crates/table-app/src/auth.rs`). The approval
   window keeps it in memory (`windows/approval/session.tsx`) and sends it as the `X-Wallet-Ipc`
   header (`IpcHeaders`; `lib/tauri.ts`). The shell reads that header into the `Caller`
   (`apps/desktop/src-tauri/src/native.rs`, `caller`). The token is not an API credential or a
   signing key.
4. **Unlock.** `unlock` (approval, token) runs native re-auth (Windows Hello, HWND-scoped)
   outside the actor. Only a verified completion of the current generation unlocks. Reads and
   ticks never refresh the 15-minute idle clock (`ApprovalSession::locked`, `check`).
5. **The gate.** For runtime commands, `Runtime::admit` (`crates/table-runtime/src/dispatcher.rs`)
   checks the row in order: label (else PERMISSION), then token and unlock (else PERMISSION or
   LOCKED), then the selected deal (else PERMISSION). It runs at the top of every `execute`.
   `Action::command()` (`crates/table-runtime/src/actor.rs`) maps each IPC action to its row.
   Internal steps (notification shown, card opened, relay finished) have no row and keep literal
   checks. Shell commands call `label(&window, "<command>")`, which reads the same table. Money
   decisions also re-check inside `decide()`, `band()` and `prepare_market()` as a second line.
6. **Owner decisions.** Every `decision`-tier command (`deal_owner_accept`, `deal_countersign`,
   `deal_capture`, `deal_void`, `shield_release`, `rescue_approve`, `open_paypal_in_browser`)
   needs approval label, token, unlock and the selected deal. It also carries `DecisionArgs`
   (`deal_id`, `attempt`, `terms_hash`, `checks_hash`, `counter_hash?`). Rust compares these with
   the current deal and checklist before minting a 60-second `OwnerTicket`. The client never
   supplies a URL, a secret, or a decision Rust did not check.
7. **Events are targeted.** `EventContract` names each event and its windows. Examples:
   - `attention:changed` → main and tumbler;
   - `approval:summary` → approval only;
   - `deal:changed` and `pairing:pinned` → main only;
   - `tumbler:handoff` → tumbler only.

   Events carry projections, never retained UI state. After a lag, the shell refreshes from
   snapshots.
8. **Generated, then pinned.** `cargo run -p table-client --bin generate-bindings` writes
   `bindings/*.ts`, `bindings/authority.ts` (`AUTHORITY`, `AUTHORITY_MANIFEST`) and
   `apps/desktop/src-tauri/capabilities/{main,tumbler,approval}.json`. `build.rs` includes the
   table by `#[path]` and passes `COMMANDS` to Tauri's app manifest. `generate_handler!` stays
   hand-written and is tested against `COMMANDS`. The manifest fingerprint `manifest()` is
   SHA-256 over `b"table.authority-manifest.v1\0"` plus the JCS of the rows sorted by name. Any
   change to who may call what changes it. `PINNED_MANIFEST` in `authority.rs` must be updated
   in the same change, deliberately. `get_settings` carries it as
   `SettingsSnapshot.authority_manifest`.
9. **Mock parity.** The browser preview's mock (`apps/desktop/client/src/mock/backend.ts`) gates
   with `GATES = AUTHORITY` from the generated bindings. One generic `gate()` checks label, token,
   idle lock and selected deal, answering the same PERMISSION and LOCKED codes as Rust. A command
   without a row fails the TypeScript type check.

Adding a command (AGENTS.md, theme T11):
1. Add the `CommandContract` field and one row in `authority_table.rs`.
2. Run `generate-bindings`.
3. Wire the shell handler.
4. Map the `Action` in `Action::command()` and add a call in `authority_tests.rs` (or call
   `label(&window, …)` for a shell command).
5. Update `PINNED_MANIFEST`.

Never hand-edit `COMMANDS`, `RELEASE_COMMANDS`, `build.rs`, the capability files or the mock's
gates.

Command families (full list in `authority_table.rs`):

| Family | Examples | Windows | Tier / gate |
| --- | --- | --- | --- |
| Reads | `get_settings`, `attention_list`, `deal_display`, `envelope_get` | all | read |
| Main-only reads | `list_deals`, `get_deal`, `deal_history`, `book_query`, `counterparty_note`, `audit_page` | main | read |
| Review reads | `deal_transcript`, `mandate_list`, `owner_facts`, `deal_export_proof`, `rescue_book` | main, approval | read |
| Approval reads | `approval_summary` (selected), `approval_pairing`, `approval_handoff`, `mandate_simulate` | approval | read |
| Routing and preferences | `main_open`, `approval_open`, `settings_write` | main, tumbler | ui |
| Safe actions | `deal_withdraw` (all), `deal_let_lapse`, `pause_all_agents`, `quit_confirm` (main, tumbler), `deal_snooze` (tumbler) | as listed | act, no token |
| Main actions | `agent_start`, `engine_select`, `pairing_create/join/poll`, `house_wake`, `deal_group_open` | main | act |
| Session | `approval_token`, `unlock` | approval | session |
| Owner authority | `mandate_sign`, `mandate_revoke`, `band_set` (selected), `envelope_sign`, `set_credentials`, `pairing_confirm`, `deal_create`, `deal_join`, `market_refresh` (selected), `rescue_replay`, `rescue_watch_add/stop` | approval | owner, token + unlock |
| Money decisions | `deal_countersign`, `deal_capture`, `deal_void`, `deal_owner_accept`, `shield_release`, `rescue_approve`, `open_paypal_in_browser` | approval | decision, token + unlock + selected |

## Safety properties

| Invariant | Where it is enforced |
| --- | --- |
| Privileged = token AND approval label AND not idle-locked | `CommandAuthority { token, unlock }`, `Runtime::admit`, `ApprovalSession::check` |
| The release set is approval-only | `Tier::release()`; test `the_release_set_and_the_money_decisions_are_pinned_independently` lists the 21 names by hand |
| Untrusted counterparty words never reach the Tumbler or approval | `counterparty_note` is main only; `counterparty_list` and `deal_transcript` exclude the Tumbler (same test) |
| One source of truth | capability files, `bindings/authority.ts`, `COMMANDS` are generated; drift test `checked_in_authority_files_match_the_authority_table` |
| A gate change is visible in review | `PINNED_MANIFEST` test `the_manifest_fingerprint_is_pinned` |
| Runtime answers match the table, cell by cell | `every_command_answers_label_lock_and_token_exactly_as_the_authority_table_says` (each runtime command × label × lock × token; no cell calls PayPal) |
| No secret crosses IPC | `set_credentials` opens a native credential dialog; no private key has an IPC type; `IpcHeaders` Debug is redacted |

## Where it lives

| Layer | Path | Key items |
| --- | --- | --- |
| Table | `crates/table-client/src/authority_table.rs` | `AUTHORITY`, `WindowLabel`, `Tier`, `Selection`, `Enforcer`, `COMMANDS`, `RELEASE_COMMANDS`, `admits` |
| Derived | `crates/table-client/src/authority.rs` | `manifest`, `manifest_hex`, `capability_json`, `capability_files`, `typescript`, `PINNED_MANIFEST` |
| Contract | `crates/table-client/src/lib.rs` | `CommandContract`, `EventContract`, `ErrorCode` (LOCKED, PERMISSION, REFUSED, INVALID, NOT_FOUND, UNAVAILABLE, LEDGER_TRUST, UNSUPPORTED), `IpcHeaders` |
| Generator | `crates/table-client/src/bin/generate-bindings.rs` | writes `bindings/` and the capability files |
| Runtime gate | `crates/table-runtime/src/dispatcher.rs`, `actor.rs` | `Runtime::admit`, `Action::command` |
| Owner session | `crates/table-app/src/auth.rs` | `ApprovalSession`, `OwnerTicket`, `NativeReauth` |
| Shell | `apps/desktop/src-tauri/build.rs`, `src/native.rs`, `src/native/commands.rs`, `src/native/routing.rs`, `capabilities/*.json` | `label()`, `caller()`, `generate_handler!`, window creation and placement |
| Client | `apps/desktop/client/src/lib/tauri.ts`, `lib/runtime.ts`, `windows/approval/session.tsx`, `mock/backend.ts` | invoke with header, native vs mock backend, token in memory, mock `gate()` |
| Bindings | `bindings/` | generated TypeScript, `authority.ts` |

## Tests that pin it

- `crates/table-client/src/authority.rs`: `the_manifest_fingerprint_is_pinned`,
  `the_release_set_and_the_money_decisions_are_pinned_independently`,
  `rows_are_unique_and_well_formed`, `capability_files_grant_exactly_the_table`,
  `manifest_is_domain_separated_and_ignores_row_order`.
- `crates/table-client/tests/bindings.rs`: `checked_in_authority_files_match_the_authority_table`,
  `checked_in_bindings_match_every_rust_command_event_and_dependency`.
- `crates/table-runtime/src/authority_tests.rs`:
  `every_command_answers_label_lock_and_token_exactly_as_the_authority_table_says`,
  `every_action_names_a_command_in_the_table_or_is_internal`,
  `the_settings_snapshot_carries_the_manifest_fingerprint`.
- `apps/desktop/src-tauri/tests/capabilities.rs`: `w3_release_set_is_approval_only_and_all_commands_are_declared`,
  `shell_answered_commands_check_their_own_row_of_the_authority_table`.
- `crates/table-app/tests/pipeline.rs`: `f4_w3_w11_approval_label_token_idle_lock_and_os_reauth`.
- `crates/table-app/src/auth.rs`: `owner_tickets_bind_terms_deal_attempt_expiry_and_session_generation`.
- Client: `apps/desktop/client/src/mock/authority.test.ts` (every command × label × lock × token).

## Known gaps and UNVERIFIED

- The native shell (`apps/desktop/src-tauri`) compiles only on Windows. Its `build.rs` and
  handler edits are checked by the Windows CI leg, not on Linux. No interactive run of the native
  IPC gate has happened (acceptance W3's native IPC test is still owed).
- UNVERIFIED: the capability files' `description` key has not been read by a Windows build. Tauri
  v2 documents it as optional.
- Windows Hello, native credential entry, mixed-DPI placement and no-activation on arrival need
  native UAT. Other platforms answer UNSUPPORTED for unlock.
- Owner look, not changed: `deal_export_proof` from the approval window is not bound to that
  window's deal, and `attention_list` in approval filters to its own deal rather than refusing.
- Open design question: `mandate_revoke` is privileged in code (token + unlock), while STATUS
  notes Revoke as let through the idle lock. The code row is the truth today.
- Left: the fingerprint in receipts and owner-decision audit rows, and a generated authority
  markdown table.

## Related

- [approval-window.md](./approval-window.md), [tumbler-and-attention.md](./tumbler-and-attention.md),
  [home-and-rewind.md](./home-and-rewind.md).
- [money-pipeline.md](./money-pipeline.md): what the decision commands do after the gate.
- [proof-and-verification.md](./proof-and-verification.md): the `permissions` check.
- [preview-and-director.md](./preview-and-director.md): the mock backend that mirrors the gates.
- Design: [window-duality.md](../design/window-duality.md) (windows, capability split, W1–W11);
  [the-table.html](../design/the-table.html) §9 (trust model), §10 (surfaces);
  [STATUS.md](../build/STATUS.md) "T11 single-source authority manifest", "Client handoff".
