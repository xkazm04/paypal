# Client status

Updated 2026-10-03. The React client for all three windows is built against the real contract
(`bindings/`) and embedded by the Tauri shell (`frontendDist: ../client/dist`). It has been
verified in a browser against the mock backend; **it has not yet been run inside the Tauri
shell** (native windows, transparency, Windows Hello, notifications need an interactive session).

## Run it

```powershell
pnpm --dir apps/desktop/client install
pnpm --dir apps/desktop/client dev          # browser preview on http://localhost:1430 (mock backend)
#   index.html (main) · tumbler.html · approval.html?deal=<ULID> · approval.html (configuration)
#   ?degrade=1 simulates an older shell missing the safe read projections
pnpm --dir apps/desktop/client typecheck; pnpm --dir apps/desktop/client test; pnpm --dir apps/desktop/client build
./scripts/check.ps1                          # client gates + build, then the Rust gates
```

Gates at the client-request boundary: client typecheck clean, 101 vitest tests, CSP-clean build (no inline script
or style); Rust clippy -D warnings clean, 180 tests + 9 ignored live checks, with the client
embedded.

## What exists

| Window | Built | Code |
|---|---|---|
| Main - The Dial | Layer 0 dial (engraved medallions, beads by state, hub "Needs you" with default on silence and live countdown, ledger, needs-you column, intro, first-run), six modules with rail and honest UNAVAILABLE states, deal detail (state strip, convergence chart, mirrored columns, PayPal evidence, reconcile, market band), settings sheet (engines, pause, HOUSE, pairing create/join/poll, mandates), find palette, `#m=` / `#d=` / `#s=` routing | `src/windows/main/` |
| Tumbler | all seven forms (rest, tab, ticker, card, stack, handoff, welcome) on Rust-reported form/orientation, attention ladder visuals, HOLD cards without review-to-pay, drag via `tumbler_drag`, Enter/W/Esc, client-side snooze, labelled browser preview stage | `src/windows/tumbler/` |
| Approval | token in memory only, selection fallback chain, deal review (CHECKING / READY / LOCKED / IN BROWSER / HOLD / BLOCK / MISMATCH / settled), gating that only narrows Rust's flags, typed-name shield release, Windows Hello unlock, owner configuration (credentials via native dialog only, 7-clause mandate editor, versions, revoke, HOUSE), pairing confirm (demo only, see request 2) | `src/windows/approval/` |
| Shared | contract layer, hooks, formatting, honesty components, module glyphs, tokens, browser mock (Maya's week in binding shapes, mirrors the real gates) | `src/lib`, `src/shared`, `src/design`, `src/mock` |

## Backend requests from the client (priority order)

All seven requests are **done in the backend**, including actor/service, ledger reads,
native registration/capabilities/manifest, generated bindings and the browser mock.
The client window session still needs to connect the new actions/events to the UI;
this backend session edited only src/lib and src/mock.

1. **Done: owner ACCEPT above human_present_over.** Privileged deal_owner_accept uses
   DecisionArgs plus the required counter_hash from ApprovalSummary. Check
   can_owner_accept===true; owner proof signs the exact last counter and terms.
   Agent ACCEPT still refuses above clause 6; mandate/shield/round/deadline checks
   remain. The two-wallet and HOUSE offline tests now settle through owner ACCEPT.
2. **Done: pairing handoff.** Main calls approval_open({deal_id:null,pairing:pairing_id});
   approval reads approval_pairing for id, words, house flag and fixed context.
   Confirmation still requires capability/unlock/exact words; expired or confirmed
   reads return null. Pairing remains transient until confirmation.
3. **Done: all four safe projections.** approval_selection, deal_display,
   deal_transcript and counterparty_list are real commands; pending.ts re-exports
   their generated types. Labels are persistent per deal. Titles currently use the
   owner's locally bound signed item_ref; descriptive catalog titles await the
   existing catalog work. No peer prose, secrets or URLs cross these projections.
4. **Done: tumbler:handoff {deal_id,approve_until}.** Targeted to Tumbler after a
   successful Rust system opener and actor handoff; deadline comes from the ledger.
5. **Done: currency and deal timestamps.** AttentionSnapshot carries
   wallet_spend_today_currency (null for empty/mixed currency); Deal projects stored
   created_at/updated_at. Migration 0006 reuses the existing timestamp columns and
   adds stable labels/index. Accounting remains unavailable, so native meters stay
   hidden. New metadata supports legacy snapshots; absent timestamps/currency mean
   unavailable and absent can_owner_accept means false.
6. **Done: native snooze.** deal_snooze is registered and granted only to Tumbler.
   Requires GATE strictly more than 45 minutes from deadline; persists 30 minutes.
   HOLD and the last notification rung pierce it. Deal/default/deadline and scheduler
   remain independent; no PayPal calls. UI can now replace its local-only snooze.
7. **Done: mandate slots.** mandate_list returns flattened MandateListEntry with
   original payload/signature and agent resolved from its pinned key.

No request is deferred. Initial required-field type errors in unchanged
windows/approval/gating.test.ts and windows/tumbler/logic.test.ts were resolved through
backward-compatible generated snapshot metadata, with default-deny owner capability.
No window files were edited; all three client gates pass.

## Known gaps (client)

- Not yet run in the Tauri shell: native transparency, drag/snap, notification click, Hello.
- The approval window does not close itself after "Open PayPal in your browser".
- MISMATCH has no transcript export command; it points to The Table.
- Chart/timeline times use the local clock.

## UI wiring of the backend answers (2026-10-03)

All seven answers are wired into the windows: owner accept ("Accept $X as the owner") in
approval, real pairing confirmation from `approval_pairing`, mandate agent slots and
pre-filled versions, approval self-close after the PayPal hand-off (`core:window:allow-close`
granted to the approval label), Main's pairing hand-off to approval and a true "This week"
ledger from Deal timestamps, the spend meter's real currency (null = empty/mixed, said so), the
Tumbler's hand-off form from `tumbler:handoff` with PayPal's approve deadline, and snooze via
`deal_snooze`. Client 124 tests; Rust 180 + 9 ignored.

### Small follow-ups (next backend run)

- Attention headline for an owner-accept gate still reads "Countersign $X"; emit "Accept $X".
- Confirm `deal_snooze` emits `attention:changed` (the Tumbler refetches defensively today).
- A cancel-pairing command, so "the words don't match" can end the pairing, not just reset the window.
- Mock: a buyer deal in AWAITING_APPROVAL, and a null/mixed spend currency and timestamp-less
  deals, so those UI states can be screenshotted without editing stored state.

## v2 port foundation (2026-10-06)

Brief: `docs/build/CLIENT-V2-PORT.md`. Laid before the eight page agents start:

- v2 tokens (dark default + light PayPal palette under `[data-theme="light"]`, UNVERIFIED hues),
  type/space/size scale, `1rem = 13px` (the old `clamp()` root is gone); `src/design/ui.css` ports
  the `ui-*` baseline (no `data:` images: the CSP blocks them).
- `src/lib/theme.ts` (`table-theme` in localStorage, guarded; applied before the first render in
  the main window only). `ThemeSwitch` exists; Home will place it.
- `src/shared/ui`: Sheet, Popover, Inspector (portals into the Shell's column), layer stack (Esc
  closes the topmost layer, before App's back-one-level), toasts (moved from `main/ui.tsx`,
  re-exported), and the Layer-1 components. See `src/shared/ui/README.md`.
- Module Shell on the v2 frame; Modules split into `windows/main/modules/*`; `main.css` split into
  area files; approval CSS split into `frame.css` / `approval.css` / `owner.css`.
- Client tests 146 (theme + layer stack added). Pre-v2 classes survive, frozen, in
  `windows/main/legacy.css` until the pages stop using them.

## v2 port of the chosen prototypes (2026-10-06)

Every page now follows the owner's chosen variant (see STATUS.md "Page prototypes awaiting
verdict"), rendered from the bindings: Home = the Dial (with the only Dark / Light switch) · Tables
v3 Price Ladder · Spend v2 The Gate · Shield v2 Evidence matrix · Counter v1 Counter board · Rescue
v3 Lever Matrix · Book v1 Ledger Lens · Deal v1 Mirror · Settings = Setup v2 The Circuit (with
Pairing and Mandates tabs on the shared Sheet) · Tumbler v1 puck · Approval v3 The Diff · Mandate
v3 What-if replay · Pairing v1 Two desks. Prototype-only controls were not ported. Wherever the
contract lacks a fact, the UI draws it as unknown (dashed) or UNAVAILABLE, never as passed.

- Gates: client typecheck clean, **305 vitest tests** (19 files), CSP-clean build. Rust: the
  approval window is **744 × 660** (`routing.rs` inner/min size, `table-attention::placement::
  APPROVAL_SIZE`, pinned by a test). The mock opens it at the same size.
- No colour literals remain in client code outside `src/design/tokens.css`. The module `color`
  hex field is removed; use `MODULE[m].cssVar`.
- Behaviour changes worth knowing:
  - Enter on any approval money button does nothing (toast); Space or a click acts.
  - Void from Spend hands off to the approval window (`deal_void` is approval-only).
  - Rescue approval is a hand-off only (`rescue_approve` is still UNAVAILABLE).
  - Book lenses run in the window over rows already read (there is no `book_query`); a typed
    question shows UNAVAILABLE.
  - "Keep held" on Shield was dropped (no command; silence already keeps a hold).
  - The pairing confirm checkbox is gone; the button label is the assertion.
  - The what-if replay in the approval window is UNAVAILABLE until that window can read deals.
- Tumbler: fitted to the current Rust form sizes. Proposed tighter sizes, for an owner decision:
  card 440×152, stack 440×336, handoff 440×160, welcome 440×228 (Rust table + `FORM_SIZE` +
  tests change together).

### Backend requests from the v2 port (consolidated, not yet prioritised)

Status after wave 0 (2026-10-06, `docs/build/PORT-GAPS-BRIEF.md`; details in STATUS.md "Wave 0
port gaps"): struck items are built end to end and wired into the pages named. The rest belong to
moonshot themes (T1, T5, T6, T12, T14) or to the deferred catalog / rescue executor.

1. **`mandate_preview`** (approval, read-only): a draft mandate → each recent deal's verdict under
   signed vs draft from Rust's real check. Alternatively, grant the approval window `list_deals` and
   add category + payee to `Deal`. Needed by Mandate what-if.
   → **Theme T12 (`mandate_simulate`).** Still UNAVAILABLE in the What-if replay.
2. **Per-clause trace on deals** (main, read-only): which clause passed, refused or asked, and the
   refusal text. Needed by Spend lanes, Deal Mirror clause column, Shield check cells (per-check
   results, deciding check, typology). → **Theme T6 (`deal_history`).** Partly eased by wave 0: a
   refused purchase's `decided_by` names Rust's refusing clause, and the Spend lane marks it ✗.
3. ~~**`decided_by` on `Deal`** (policy vs owner). Needed by Spend, Book "Policy vs me", Deal.~~
   **Done (wave 0):** `Deal.decided_by`; Spend outcome + inspector, Book lens and row, Deal decision row.
4. ~~**Counterparty note read** through the quarantine path (main). Needed by Deal, Tables, Shield, Counter.~~
   **Done (wave 0):** `counterparty_note` (main only); every "note ›" and Counter's "Their words".
5. **Transcript export command** (signed file). Needed by Deal and Approval Details. → **Theme T1.**
6. ~~**Draft hand-off on `approval_open`** (band draft, floor draft, lever choice) so the approval
   window opens pre-filled instead of asking the owner to re-enter. Needed by Tables, Counter, Rescue.~~
   **Done (wave 0):** `draft` + `approval_handoff`; band pre-fills BandAdjust, floor pre-fills the
   mandate editor (one floor per hand-off), the lever shows in approval (approving stays UNAVAILABLE).
7. ~~**`approval_open` targets** (credentials / mandate / unlock) instead of one owner configuration.~~
   **Done (wave 0):** `target`; Setup opens on credentials / mandate / unlock.
8. ~~**Book**: `book_query` (structured, read-only), audit-log read, last Transaction Search poll time.~~
   **Done (wave 0):** `book_query` answers the lenses (INVALID reason verbatim), `audit_page` (Audit
   trail sheet), `owner_facts.last_reporting_poll` (statement header). Typed questions stay preset-only.
9. **Shop catalog read** (list price, stock, feed) and seller-mandate floors in the mock. **Rescue**:
   suggested lever + parameters + eligibility, rescue mandate clause, `rescue_approve`.
   → **Deferred backend items** (catalog, rescue executor), out of wave 0.
10. ~~**Pairing**: `pairing_abort`, `PendingPairing.expires`, a pinned signal back to Main, pairing
    status and declared payee in `CounterpartyDisplay`, `house_wake`.~~
    **Done (wave 0):** all five; the Pairing desk and the approval PairingConfirm use them.
11. **Approval diff**: order payee, a lock-independent "settle verified" flag (or the settle facts),
    which shield rule tripped a HOLD, rescue lever type/size, `mandate_versions` (history incl. revoked).
    → **Theme T5** (payee, settle facts) and T6 (history); still open.
12. **Settings / Tumbler**: ~~idle time-to-lock, engine probe detail and time, credential stored date,
    agent roster~~ **(done, wave 0: `owner_facts`, shown in Setup)**; `AttentionSnapshot` daily cap /
    held amount / deals today, weekly engine estimate, stopped/in-motion lists, item "waiting since"
    → **Theme T14** (exposure envelope); still open.

Remaining client follow-ups from wave 0: the approval window's owner configuration could show the
credential dates and the lock countdown too (`owner_facts` is granted to approval); the Tumbler
forms were not touched (another session owns them). Client gates after wave 0: typecheck clean,
**312 vitest tests**, CSP-clean build. The mock store key is now `the-table-mock-state-v5`.

### Mock and fixture follow-ups

- D-0193's attention item names clause 4 of M-12, but haggle deals bind the haggle mandate (Rust
  would name clause 6).
- D-0199 (MISMATCH) has no SETTLE transcript entry, so the asked $339 cannot show.
- No seller mandate with floors, no pre-checkout `shop_order`, no settled or in-flight rescue
  deals, no lock toggle for screenshots.
- **Decision needed:** Rust's band clause refuses every deal whose item is not in the band,
  purchases included. The mock's first mandate combines a purchase limit with a monitor-only band.
  Either the fixture or the band's scope in `crates/table-core/src/mandate.rs` changes.
