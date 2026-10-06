# Client v2 port - brief

Owner decision 2026-10-06: the v2 UI baseline is accepted, and the winning page prototypes are ported
into the React client (`apps/desktop/client`). The prototypes are the **UX spec**. The bindings
(`bindings/`) and the Rust contract are the **data truth**. Read `AGENTS.md` (invariants) and
`docs/build/CLIENT-STATUS.md` (what the client does today) first.

## Sources

| Area | Prototype (spec) | Client files today |
|---|---|---|
| Baseline | `prototype/shared/{tokens.css,ui.css,ui.js,baseline.html}` | `src/design/*`, `src/shared/*` |
| Home (Dial) | `prototype/main/` (v2 rework, with the Dark/Light switch) | `windows/main/{Home,Dial,Status}.tsx`, `art.ts` |
| Module shell | `prototype/main` module screens (title bar, sidebar, page head) | `windows/main/{App,Shell,ui}.tsx` |
| Tables | `prototype/pages/tables/variant-3` Price Ladder | `windows/main/Modules.tsx` (tables) |
| Spend | `prototype/pages/spend/variant-2` The Gate | `Modules.tsx` (spend) |
| Shield | `prototype/pages/shield/variant-2` Evidence matrix | `Modules.tsx` (shield) |
| Counter | `prototype/pages/counter/variant-1` Counter board | `Modules.tsx` (counter) |
| Rescue | `prototype/pages/rescue/variant-3` Lever Matrix | `Modules.tsx` (rescue) |
| Book | `prototype/pages/book/variant-1` Ledger Lens | `Modules.tsx` (book) |
| Deal | `prototype/pages/deal/variant-1` Mirror | `windows/main/DealView.tsx`, `charts.tsx` |
| Setup / settings | `prototype/pages/setup/variant-2` The Circuit | `windows/main/Sheet.tsx`, `Palette.tsx` |
| Tumbler | `prototype/tumbler/` (v1 puck, v2 rework) | `windows/tumbler/*` |
| Approval | `prototype/pages/approval/variant-3` The Diff, window **744 px** wide (620 + 20%) | `windows/approval/{App,DealReview,BandAdjust,ui,session}.tsx`, `src-tauri/src/native/routing.rs` |
| Mandate | `prototype/pages/mandate/variant-3` What-if replay | `windows/approval/{MandateEditor,OwnerConfig}.tsx`, `mandateDraft.ts` |
| Pairing | `prototype/pages/pairing/variant-1` Two desks | `windows/approval/PairingConfirm.tsx`, pairing tab in `main/Sheet.tsx` |

## Rules

- **Port the UX, not the prototype's data.** The prototypes render `window.FIX`. The client renders
  the bindings via `lib/hooks` and `useWorld()`. When a prototype shows something the contract
  cannot supply, do not invent it. Render the honest state (UNAVAILABLE, unknown drawn dashed) and
  list the missing field or command in your final report. Do not edit `src/mock/*` or `bindings/`;
  the lead consolidates backend and mock requests afterwards.
- **Prototype-only controls are not ported**: the `ui-proto` boxes, "Prototype · sandbox
  simulation" buttons, simulated desktops and the simulated approval window inside main pages. In
  the app, "Review & approve ↗" calls the real hand-off (`approval_open` etc.), as it does today.
- **Invariants stay as built**: privileged gating (`gating.ts`), idle lock, Enter never releases
  money, MISMATCH has no pay button, untrusted text only through the quarantine component, mode
  badge on every screen, default on silence on every needs-you item, two meters.
- **CSP** is `script-src 'self'; style-src 'self'`: no inline `<style>` or `<script>`, no `style`
  attribute strings in HTML. React `style={{}}` (CSSOM) is fine for dynamic values such as module
  colours and positions.
- **Colour only from tokens**; no hex/rgb in TSX or CSS outside `src/design/tokens.css` (SVG uses
  `var(--…)`). Type and spacing come from the scale (13/12/15/17/20/26, `--sp-*`, `--row`, `--ctl`).
- **Two layers**: indicative rows (one line, two at most) and detail in `Sheet` / `Popover` /
  `Inspector` from `src/shared/ui`.
- **File ownership**: edit only the files your task names. Create new files inside your area. If
  something outside your area must change, say so in your report rather than editing it. Other
  agents are editing the same tree in parallel, so a type error in a file you do not own is their
  work in progress. Your own files must be clean.
- **Gates**, run from `apps/desktop/client`: `pnpm typecheck`, `pnpm test`, `pnpm build`. Keep the
  existing tests green. Add vitest tests for new pure logic. Rust changes must pass
  `cargo clippy --workspace --all-targets -- -D warnings` and `cargo test -p` for the touched
  crate. Browser check with `pnpm dev` (mock backend, http://localhost:1430) and headless screenshots
  (`node <scratchpad>\lead\shot.mjs <url> <out.png> 1280,800 ["js"]` also accepts http URLs).
- No commits. No new dependencies.
