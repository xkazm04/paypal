# Client brief - the three windows of The Table

Owner (2026-10-02): "We will then follow with the client implementation polishing concept
winning the UI contest." The winner is **The Dial** (`prototype/main/`, The Table concept), with
the window duality and **the Tumbler** (`docs/design/window-duality.md`, `prototype/tumbler/`).
The client is the product judges see: Design and Presentation are two of five equal criteria.
Build it to the prototype's visual quality or better, on the real contract.

## What exists (do not rebuild)

`apps/desktop/client/` - Vite + React 19 + TypeScript, three pages (`index.html` = main,
`tumbler.html`, `approval.html`), each mounting `src/windows/<label>/App.tsx`.

- `src/lib/contract.ts` - typed `Backend` (invoke/listen), `WalletError` (typed failures;
  `isAvailabilityState` for UNAVAILABLE/UNSUPPORTED). Types come from `@bindings/*` (Rust-owned,
  generated - never edit or redefine them).
- `src/lib/pending.ts` - four **pending backend extensions** the shell does not register yet:
  `approval_selection`, `deal_display` (label "D-0193", own-catalog title, deadline,
  on_silence, band), `deal_transcript` (signed offer history), `counterparty_list`. The mock
  implements them; against the real shell they fail as UNAVAILABLE and **the UI must degrade**
  (short ULID, item_ref, no convergence chart, short key id). Use `src/lib/display.ts` helpers.
- `src/lib/hooks.ts` - `useQuery(cmd, args, {refreshOn})`, `useMutation(cmd)`, `useEvent`,
  `useNow` (1 s clock), `usePrefersReducedMotion`.
- `src/lib/format.ts` - `formatMoney/formatMinor` (exact minor units), `countdown`,
  `shortId`, `shortHash`, `clockLabel`.
- `src/shared/honesty.tsx` - `ModeBadge`, `MockBadge`, `Money`, `MinorMoney`, `Countdown`,
  `Quarantine` (untrusted text, plain only), `WalletNotice` (typed failure).
- `src/shared/modules.tsx` - `MODULES`/`MODULE` metadata and `<Glyph module=…/>`.
- `src/design/tokens.css` + `base.css` - the Dial's tokens and the type floor.
- `src/mock/` - browser mock of the shell with Maya's week in exact binding shapes; mirrors the
  real gates (approval label + token + unlocked + selected deal). Cross-tab events via
  BroadcastChannel, so main / tumbler / approval can run in three tabs.

## The contract is law

Read `docs/build/STATUS.md` → "Client handoff" (commands, gates, events, first run, pairing,
HOUSE, DecisionArgs) before writing a component. Key rules:

- Money decisions, defaults, signing, URL verification and policy stay in Rust. The client never
  computes an authority, never builds a PayPal URL, never stores the approval token.
- Privileged commands only from the approval window, with the in-memory token; disable money
  controls while `locked` or `can_release=false`; gate browser approval on `can_open_paypal`.
- UNAVAILABLE / UNSUPPORTED render as availability states, never as success. Typed failures
  render as failures (`WalletNotice`).
- Subscribe to events, then fetch; events are projections, not retained state.
- Never render counterparty free text except inside `Quarantine`; the Tumbler never renders it.
- Every screen carries the mode badge; in a browser it also shows `MockBadge`.
- Silence never moves money: every needs-you item shows its default-on-silence line.

## Hard constraints

- CSP: `script-src 'self'; style-src 'self'`. All CSS in `.css` files imported from TS; no
  `<style>` elements, no inline `<script>`. React `style={{…}}` props are fine (CSSOM). Static
  trusted SVG via `dangerouslySetInnerHTML` is fine; never with data.
- No network, no CDN, no web fonts, no remote images. Art is inline SVG/CSS/canvas.
- Type floor: body >= 14 px at 1280x800, nothing the user must read below 12 px.
- `prefers-reduced-motion` gets a calm version; any intro hands over control within ~4 s.
- No PayPal logo or brand art; refer to engines only as `claude-code` / `codex-cli`.
- TypeScript strict; no `any` without a comment saying why.

## Ownership while three agents work in parallel

Each window agent edits **only** `src/windows/<its label>/**` (add files and sub-folders freely).
Do not edit `src/lib`, `src/mock`, `src/shared`, `src/design`, `bindings/`, Rust, or another
window. If you need a shared change or a mock change, work around it locally and list the
request in your final report. Do **not** run `vite build` (it writes the shared `dist/`); verify
with `npx tsc --noEmit -p tsconfig.json`, `npx vitest run src/windows/<label>` and a dev server
on your own port: main `npx vite --port 1431`, tumbler `--port 1432`, approval `--port 1433`.
Take Playwright screenshots (Python Playwright is installed) at 1280x800 and 1920x1080 for main,
at each form size for the Tumbler, at 540x620 for approval, and check them yourself.
