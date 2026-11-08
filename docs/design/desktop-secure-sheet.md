# Desktop secure sheet

Status: built, 2026-11-06 (owner's picks: option A, fixed height per step). Follows [abstract-first-home.md](abstract-first-home.md), which left the desktop app on the approval window for secure steps.

Goal: in the desktop app, the setup guide's secure steps (PayPal keys, signing rules, the practice shop's four words) feel like the browser preview's sheet. The step should be one focused form over the dimmed home, not a full "Owner review" window. No privileged gate may get weaker.

## What exists (scouted on main d60e311b)

- **CSP.** `apps/desktop/src-tauri/tauri.conf.json` pins `frame-src 'none'`, and `tests/capabilities.rs` asserts it directive by directive. Security scans of 2026-10-07 and 2026-10-23 cite it.
- **Authority is the window label.** `native.rs` `label()` / `caller()` and `table_client::authority::admits(command, window.label())` gate every command. The `approval` capability alone grants `set_credentials`, `mandate_sign` and `pairing_confirm`; those calls also need the session token header (`x-wallet-ipc`).
- **`approval_open`** (`src/native/routing.rs`):
  - Rust checks the target and draft (`Action::OpenApproval`).
  - It always loads `approval.html`, at 744x660, not resizable, titled "Owner review · The Table".
  - **When The Table is on screen, the window is already docked:** a child of `main` (`builder.parent`), centred over it (`surface.rs` `dock_target`, `position_approval`, `table_attention::approval_docked_rect`).
- **Navigation.** Every window's `on_navigation` admits the app origin only (`navigation.rs`), and new windows are denied.
- **The bare surface is already built.** `approval.html?bare=keys|rules|pairing` (`windows/approval/bare/`) renders one form with the same session provider, token and gates. On desktop the keys form is a button that opens the Windows credential dialog (`table-os` `credential_prompt.rs`), so keys never reach a page. Today desktop never opens it, because `approval_open` cannot ask for `?bare=`.
- **Wire.** `ApprovalOpenArgs { deal_id, pairing, target, draft }` (`crates/table-client/src/approval.rs`, ts-rs bindings). This is not the Rust-pinned assistant reply contract.

## The options

| | What changes | Security | Verdict |
|---|---|---|---|
| **A. Sheet window** (recommended) | `approval_open` gains a sheet presentation for setup targets: it loads `approval.html?bare=<kind>` in the same docked child window, frameless, sized to the form and centred over main. Main dims while it is open. | Unchanged. Same label, capability, token and CSP. The only new input is one closed enum, which Rust validates. | Looks like the browser sheet; no gate moves. |
| B. Relax CSP, iframe in main | `frame-src 'self'`; main frames `approval.html?bare=`. | **Breaks the model.** IPC from a frame runs under the hosting window's label (`main`), so `set_credentials` / `mandate_sign` would be refused. Making them pass means trusting frames inside `main`, which widens the label boundary every gate rests on. Also undoes a pinned, scanned policy. | Rejected. |
| C. Child webview in main | Tauri multiwebview (`unstable` feature): a webview labelled `approval`, layered inside the main window. | Label-safe, but turns on an unstable Tauri feature on a pinned `tauri =2.12.1`. Capabilities and the event audience must handle two webviews in one window, and the "approval window" assumptions in `events.rs` / `surface.rs` move. | Possible later if A is not seamless enough. |

**Recommendation: A.** "Rust security-policy change" then means a narrow change to `approval_open`'s window policy, not to the CSP or the capabilities. If sizing needs a new grant (decision 2), it is one window permission on the `approval` capability only.

## Work packages (option A)

1. **Rust: sheet presentation.** One builder.
   - Add `presentation: Option<ApprovalPresentation>` (`"window"` | `"sheet"`, absent = window) to `ApprovalOpenArgs`. Regenerate bindings and the authority table output.
   - In `approval_open`:
     - `sheet` is admitted only with `deal_id: None` and a setup target (`credentials`, `mandate`, `pairing`); anything else is `Invalid`.
     - The URL is `approval.html?bare=<keys|rules|pairing>`. The draft and pairing still travel as they do now, by event and state, not by URL.
     - The window is frameless (`decorations(false)`), uses a sheet size per kind, is docked and centred over main (an undocked fallback keeps today's placement), and is titled after the step.
   - Navigation tests: the bare URL passes `permits`.
   - Rust tests: a sheet with a deal id is refused; a sheet with an unknown target is refused; the window window still opens as before.
   - The CSP and capability pins in `tests/capabilities.rs` stay byte-for-byte.
2. **Rust: tell main.** Emit `approval:sheet` (`{ open: bool, kind }`) to `main` only, through the authority `EVENTS` table (`emit`, never a hand-written label). Send it on open and on the approval window's close or destroy.
3. **Client.**
   - `home/secure/SecureStep.tsx`'s desktop path calls `approval_open` with `presentation: 'sheet'`.
   - The home shows the scrim and the "Finish in the secure step" card while `approval:sheet` is open, and the tick on `done` (`useStart`), as the browser sheet does.
   - The bare page drops its parent `postMessage` when it is top-level, and its own ✕ / Esc call `window.close` (`core:window:allow-close` is already granted).
   - Tests: the desktop presenter sends the sheet args; the scrim follows the event.
4. **Verification.** Run the real desktop build on Windows: all three steps, keys through the Windows credential dialog, one screenshot per step. Check that main cannot call any privileged command (the existing guard plus a manual `invoke` attempt from main's devtools in a debug build).

Gates: `cargo test --workspace`, client typecheck and tests, client build, and the desktop build (`pnpm tauri build`, or the repo's equivalent).

## Decisions (owner, 2026-11-06)

1. Approach: **A, the sheet window**. B (relaxed CSP) rejected: it breaks the label boundary. C (child webview) kept as a later option.
2. Sheet height: **fixed per step** (keys 520x460, rules 560x620, pairing 520x460 logical px; long content scrolls). No new window permission.

## As built

- **Wire.**
  - `ApprovalOpenArgs.presentation` (`window` | `sheet`, absent = window).
  - Event `approval:sheet` `{ open, serial }`, main only (`authority_table.rs` `EVENTS`).
  - Bindings regenerated. `PINNED_MANIFEST` moves deliberately, because an event row is part of the fingerprint.
  - The recorded samples were re-recorded (`node scripts/record.mjs`); `sampleId.ts` follows the re-recorded D-0205.
- **Runtime** (`configuration.rs` `open_approval`): a sheet is admitted only from `main` and only for credentials, mandate or pairing. A deal, unlock, the rescue pages or no target are `Invalid`; the Tumbler gets `Permission` (`client_tests.rs` `a_sheet_is_a_setup_step_from_main_only_never_a_deal`). The browser mock mirrors the same rules (`mock/backend.ts`, `firstRun.test.ts`).
- **Shell** (`routing.rs` `approval_open`, `surface.rs`, `table-attention` `approval_*_rect_sized`):
  - The sheet loads `approval.html?bare=<kind>`.
  - The window is frameless, kept off the taskbar, fixed in size, a docked child centred over The Table (beside its opener when The Table is not on screen).
  - Main is told `approval:sheet` open when the window opens, and closed when it is destroyed, with a serial so main ignores a late close.
  - The window label, capability, token, navigation allow-list and CSP are unchanged; `tests/capabilities.rs` still pins `frame-src 'none'`.
- **Client.**
  - `home/secure/SecureStep.tsx` (desktop path) opens the sheet at once, dims the home while the shell says it is up, and turns into the tick on `done` (`useStart`).
  - The bare page, as its own window (`windows/approval/bare/Bare.tsx`), draws a thin bar ("Secure step · only this window can save keys or sign", ✕). Esc or ✕ close it at once; done closes it after `HOLD_MS`. With no host, it hears its own messages (`protocol.ts` `SELF_EVENT`).
- **Gates:** `cargo test --workspace` green, clippy clean; client typecheck clean, vitest 272 files / 2819 passed (1 skipped), build green.
- **Not verified here:** a live click-through in the real desktop window (keys through the Windows credential dialog, rules signing, the practice shop's words). It needs the installed app and real sandbox keys.
