# src/shared/ui - the v2 baseline in React

Thin wrappers over the `ui-*` classes in `src/design/ui.css` (port of `prototype/shared/ui.css`).
Tokens: `src/design/tokens.css` (dark default, light under `[data-theme="light"]`). `1rem = 13px`.
Import from `../../shared/ui` (barrel `index.ts`). No component adds colours or sizes of its own.

## Rules

- **Colour only from tokens.** No hex/rgb outside `tokens.css`; use `var(--…)` / `color-mix()`.
  Module colour: `MODULE[m].cssVar` (`var(--m-spend)`), set as `--mc`; `MODULE[m].color` (hex) is
  only for the fixed-palette Dial / Tumbler art.
- **CSP:** no `data:` images (search icon is inline SVG), no inline `<style>`; React `style={{}}` is fine.
- **Scope page CSS** under your page root: module pages under `.mod-<name>` (set by `ModuleView`),
  so parallel files never collide. Do not restyle `ui-*` classes globally.
- **Two layers:** Layer 1 = one line per item (two at most). Detail goes into `Sheet`, `Popover`
  or `Inspector`.

## Layer stack (Esc)

Every open `Sheet`, `Popover`, `Inspector` with `onClose`, and the main window's `Confirm`
registers on one stack (`layers.ts`). A single `window` keydown listener in the **capture** phase
closes the **topmost** layer on Esc and stops the event. So:

- Esc closes one layer at a time (popover before the sheet it sits in).
- With any layer open, Esc never reaches `App.tsx`'s "back one level" handler or Home's keys; with
  none open, Esc behaves as before.
- `App.tsx` pauses keys 1-6 and passes `keysEnabled=false` to Home while a layer is open.
  Use `useLayerCount()` (re-renders) or `layerCount()` to pause your own page keys.
- Custom surfaces: `useLayer(onClose, kind, active?)` or `pushLayer(close, kind)` (returns remove).
- Effects run child-first: open a nested layer after its parent (on a click), not in the same commit.
- Sheets focus their **heading**, never a button (Enter must not release money), trap Tab, and give
  focus back on close. Money buttons inside a sheet still only hand off to the approval window.

## Components

| Component | Props | Notes |
|---|---|---|
| `Sheet` | `title, onClose, size?: 'narrow'\|'default'\|'wide', footer?, head?, dismissOnScrim? = true, className?, children` | Portal + scrim, drops from the title bar (`--sheet-top`). Footer: put `className="left"` on items for the left. |
| `Popover` | `anchor: HTMLElement, onClose, title?, className?, children` | Outside click or Esc closes; clicks on the anchor are left to the anchor (toggle). Pattern: `const [a,setA]=useState<HTMLElement\|null>(null)`; `onClick={e=>setA(x=>x?null:e.currentTarget)}`; `{a && <Popover anchor={a} onClose={()=>setA(null)}/>}` |
| `Inspector` | `title?, sub?, onClose?, label?, children` | Inside the module `Shell` it portals into the Shell's right column and turns on `has-insp` while mounted (mount = open). `onClose` adds ✕ and makes it an Esc layer. Outside a Shell it renders inline; use `Split`. |
| `Split` | `sidebar?, inspector?, children, className?` | Standalone `ui-split`. |
| `ToastProvider` / `useToast()` | `push(node, tone?: 'ok'\|'info'\|'bad'\|'gold')` | One provider per window (Main has it in App). `windows/main/ui.tsx` re-exports both. |
| `ThemeSwitch` | `className?` | `ui-seg` Dark / Light via `lib/theme.ts`. Home only. |
| `TitleBar` | `children, className?` | 38px bar. `Spacer` pushes the rest right. |
| `Crumbs` | `items: {label, onClick?, title?}[], label?` | Last item = current page. |
| `Sidebar` | `label, head?, foot?, children, className?` | |
| `SidebarItem` | `label, onClick, icon?, count?, need?, countTitle?, on?, title?, style?, className?` | `need` turns the count into the gold badge. |
| `PageHead` | `title, icon?, sub?, info?, actions?, focusKey?, className?, style?` | h1 is focused at mount / when `focusKey` changes (omit to never move focus). |
| `Section` | `title?, end?, children, className?` | Small dim section header. |
| `Group` | `children?, empty?, label?, className?` | Grouped box with inset separators; shows `empty` when no children. |
| `Card`, `Empty`, `Hint` | `children, className?` | |
| `Row` | `title, sub?, id?, lead?, children? (right side), onOpen?, selected?, need?, chev?, label?, className?, style?` | `sub` makes it two-line. `onOpen` makes it focusable (Enter/Space/click); clicks on buttons inside the row do **not** open it. Amount: `<span className="amt">` (+ `held`/`proposed`/`struck`). |
| `Chip` | `tone?: 'teal'\|'coral'\|'gold'\|'ok'\|'red'\|'line'\|'dashed', children, title?, onClick?, className?` | Text + colour, never colour alone. `dashed` = unknown. With `onClick` it is a button. |
| `Dot` | `className?, style?` | 8px dot in `currentColor`. |
| `Btn` | button props + `kind?: 'default'\|'primary'\|'gold'\|'danger'\|'plain', sm?, icon?, locked?, ref?` | `gold` = hand-off to approval / needs you. `locked` draws the lock glyph; it does not disable. `type="button"` by default. |
| `Seg` | `value, options: {value,label,title?}[], onChange, label, className?` | `aria-pressed` buttons. |
| `Field` | input props + `search?, ref?` | 26px field; `search` adds the magnifier. |
| `Kv` | `items: ([k, v] \| null \| false)[], className?` | `dl.ui-kv`; falsy items skipped. |
| `Stat` | `k, v, big?, hint?, children?, className?` | `big` = the one 26px figure. |
| `Meter` | `value: number \| null (0..1), tone?: 'gold'\|'coral'\|'red', label` | `null` draws a dashed **unknown** bar, never zero. |
| `Silence` | `text?, deadline?, children?, className?` | "silent → **text** · countdown". Every needs-you item carries one. |
| `Loading` | `what` | "Reading {what}…" with a spinner. |

Honesty components (`src/shared/honesty.tsx`, APIs unchanged, compact styles in `design/base.css`):
`ModeBadge`, `MockBadge`, `Quarantine` (the only way to show counterparty text), `WalletNotice`,
`Money`, `MinorMoney`, `Countdown`.

## Files and ownership (main window)

- `windows/main/Shell.tsx` + `shell.css`: the module frame. Pages only fill `children`.
- `windows/main/Modules.tsx`: dispatcher (`ModuleView`), root `div.module.mod-<name>` with `--mc`.
- `windows/main/modules/<name>.tsx` + `<name>.css`: one per module, owned by that page agent.
- `windows/main/modules/common.tsx`: shared pre-v2 pieces (`ModuleHead`, `ReviewButton`, `Rows`,
  `BandCard`, `useSorted`, `Nav`). Do not edit; build your own variant in your file instead.
- `windows/main/legacy.css` (via `ui.tsx`): frozen pre-v2 classes (`.card .btn .st .row .sect …`).
  Do not extend; migrate to `ui-*`.
- Area CSS: `home.css` (scoped under `.home`), `deal.css`, `charts.css`, `sheet.css`, `palette.css`.
- Approval: `frame.css` (shared frame + `ui.tsx` pieces, frozen), `approval.css` (DealReview),
  `owner.css` (OwnerConfig / MandateEditor / PairingConfirm). Tumbler: `tumbler.css`.
