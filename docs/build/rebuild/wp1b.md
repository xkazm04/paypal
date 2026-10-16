# WP1b - data layer and resilience (notes for the Director)

Scope: `apps/desktop/client` only. No Rust, `bindings/`, `crates/`, `src-tauri/`, authority table or
capability change (`git diff --stat 859fa04 -- crates bindings apps/desktop/src-tauri` is empty).
Dependencies: none added; `@tanstack/react-query` 5.104.2 and `@tanstack/react-virtual` 3.14.18
(already in `package.json` from WP0) are now used.

## What changed

### Query layer (`src/lib/data/`)
- `keys.ts` - one place decides a read's key. World reads: `['world','settings'|'deals'|'attention'|'runs']`;
  `['counterparties']`, `['mandates']`; per deal: `['deal_display'|'deal_evidence'|'deal_transcript'|'counterparty_note', id]`;
  everything else `['cmd', name, args]`. Two policies: NAMED (stale after 5 s, kept 5 min) and FRESH
  (stale at once, dropped when unshown = the old "read on every mount"). The approval token is never
  in a key (it travels in the query function only).
- `invoke.ts` - `readCommand`: every read gets a 10 s limit (rejects `WalletError` UNAVAILABLE) and is
  counted in `readBudget` (total / in flight / max in flight, per command; `resetReadBudget()` for tests).
  Reads only; mutations do not go through it.
- `invalidation.ts` - THE event -> invalidation map (with `invalidation.test.ts`):
  `deal:changed` -> deals, attention, counterparties, and that deal's display / evidence / transcript /
  history; `attention:changed` -> attention; `settings:changed` -> settings + attention;
  `agent:changed` -> runs; `receipt:created` -> deals + that deal's evidence and display (the toast stays in
  `App.tsx`). Events never write into the cache; they only mark reads stale.
- `bus.ts` - one `listen` per event per window (ref-counted), the map plus each hook's own `refreshOn`;
  per-deal reads follow only events about their deal. Coalescing: targets are flushed once per
  microtask; a key already being read gets ONE trailing read after it settles (no cancel, no pile-up).
- `client.ts` - QueryClient defaults: `networkMode: 'always'` (IPC, not network), no refetch on focus or
  reconnect, retry once after 750 ms only for UNAVAILABLE (never LOCKED/REFUSED/INVALID/...).
  Structural sharing keeps an equal answer's identity, so a refetch that returns the same data does
  not re-render anything.
- `provider.tsx` - `DataProvider scope="main"|"plain"` and `useDataClient()`. `mount.tsx` mounts it:
  main window = `main` (event map held, named reads kept across mounts); approval and tumbler = `plain`
  (no event map, every read FRESH: they follow only their own `refreshOn` and read again on every
  mount, exactly as before; they still get dedupe, coalescing and the time limit). A tree with no
  provider (component tests) gets a private, non-retrying, FRESH client per hook = old semantics.
- `query.ts` - `useCommand(cmd, args, opts)` -> `{ data, error, loading, stale, refetch }`, stable object.
  `stale` = a refetch failed and the last good data is still shown.
- `counts.ts` - `formatCount` (badge: "99+" above 99) and `formatTally` (prototype `n0`: "1.2k",
  "12k"; rounded DOWN so a tally never reads more than there is - the prototype's `toFixed` rounds,
  deliberate deviation); unknown -> the dash, never 0.
- `useWindowedRows.ts` - roving-tabindex windowed list over `useVirtualizer` (fixed or measured rows,
  `getKey`, `overscan` 8, Arrow/Page/Home/End). Focus is tracked by key: survives inserts above, moves
  to the row at its place when removed, and the focused row is always rendered (custom
  `rangeExtractor`) so focus is never dropped to `<body>`. A refetch never pulls focus into the list.
  jsdom caveat: no layout - the test stubs `offsetHeight/offsetWidth`, `scrollHeight/clientHeight`,
  `ResizeObserver` and `Element.scrollTo` (see the test header).

### Compatibility (`src/lib/hooks.ts`)
`useQuery(cmd, args, { refreshOn, enabled, token })` keeps its signature and `{data, error, loading,
refetch}` shape, now `useCommand` underneath (the returned object also carries `stale`). Still true:
an answer is never shown under other arguments, a slow old answer cannot overwrite a newer one, a
refetch keeps data until it answers. `useMutation` semantics unchanged (typed pending/error,
`undefined` on failure); its return object and `reset` are now stable. `useEvent`, `useNow`,
`usePrefersReducedMotion` unchanged. `useCommand`/`CommandRead`/`ReadOptions` re-exported.

### World (`src/windows/main/world.tsx`, `displays.ts`)
- Narrow selectors over an external store: `useWorldSelector(sel, isEqual?)`, `useNeeds`,
  `useDealLabels`, `useLocked`, `useDeals`, `useSettings`, `useRuns`, `useAttention`, `useWorldReady`,
  `useDisplayOf(id)`, `useNeedOf(id)`, `useWorldHealth()`, `useStaleBanner()`. A consumer re-renders
  only when its slice changes (tested: a needs consumer does not re-render on an agent change).
- `useWorld()` kept (deprecated aggregate) with the same fields plus `dealById`, `health`,
  `settingsError`, `attentionError`, `runsError`, `stale`. Every part is memoised on its own inputs,
  `display(d)` returns the same object for the same answer.
- `WorldProvider` mounts its own non-retrying DataProvider when there is none (component tests).
- `useDisplays`: same batch-of-100 / 8-wide / live-first / `displaysToRead` rules, now one pass runner
  per window over the query cache (`['deal_display', id]`, shared with `useDealDisplay` and the
  tumbler). One pass at a time: a newer list aborts the running pass (unstarted reads only) and the next
  pass runs once the reads out have settled - so at most 8 pass reads in flight whatever the event rate
  (before: overlapping passes, 40 in flight measured). A failed read now keeps that deal's last good
  answer if it had one (before: fell back to the short id); no answer yet -> fallback, as before.
- `evidence.ts` untouched (it already coalesces and caps at 8).

### Resilience (`src/shared/boundary/`)
`ErrorBoundary layer="window"|"view"|"panel"` (calm sentence + "Try again" that refetches only the
failed queries and redraws; `resetKeys` for routes; error and component stack to `console.error`
only), `WindowBoundary` (mounted by `mount.tsx`; installs `window` `error`/`unhandledrejection`
console logging), `LayerSuspense` (boundary + Suspense with a calm loading line), `staleBannerOf()`
(the banner's data contract: kind stale/unread, title, text with the "if you do nothing" line, parts in
plain words, never a code/command/message). `boundary.css` is minimal and token-based; WP2 may restyle.
Words appended to `lib/words.ts`: `BOUNDARY_*`, `LAYER_LOADING`, `STALE_*`, `UNREAD_*`, `STALE_PART`.

## Measurements (jsdom, mock backend, `?scale=large`, 500 deals; throwaway profiler test, deleted)
Home = React Profiler commits of the Home subtree. "Burst" = 10 `deal:changed` events delivered together.

| | before (859fa04) | after |
|---|---|---|
| IPC on load | 512 (engine_status x2, counterparty_list x2) | 510 |
| Home commits on load | 24 | 23 |
| max reads in flight on load | 10 | 10 |
| burst, ledger unchanged: IPC | 339 (list/attention/counterparties/history x10, 299 displays) | 4 (one each, 0 displays) |
| burst, ledger unchanged: Home commits | 7 | 2 (clock ticks of `useNow` during the wait) |
| burst, 10 deals changed: IPC | 347 (x10 lists, 307 displays) | 311 (x1 lists, 307 displays) |
| burst, 10 deals changed: Home commits | 6 | 3 |
| burst: max reads in flight | 40 | 8-9 |

Read-budget test (`world.test.tsx`, kept): load reads every display exactly once (500), <= 8 in flight,
each world read once; an unchanged storm of 20 events = 1 list read, 0 displays; 10 ended deals
changed = 1 list read and exactly `displaysToRead(...)` displays, <= 8 in flight.

Browser smoke (vite on 1497 + Playwright, 1280x800): main, main `?scale=large`, main `?degrade=1`,
approval, tumbler: no console errors, no boundary fallback shown.

## Gates
`pnpm typecheck` clean. `pnpm test`: 117 files / 1227 tests passed at the final run (baseline before
WP1b: 107 / 1131; the difference includes WP1a's new tests in the same worktree). No existing test was
changed.

## Open / for the Director
1. Residue: after any ledger change ~300 displays are re-read at scale (the live deals plus every
   CAPTURED/RECEIPTED deal, `CHECKED_AFTER_END` in `displays.ts`, kept because a capture read-back can
   change the "if you do nothing" line without a row write). Narrowing it needs either a row timestamp
   on that Rust write or a batched display command - both out of scope (no Rust change).
2. `counterparty_note` keeps the broad `deal:changed` refresh (each card re-reads on any deal change,
   now coalesced and deduped). Narrowing it to the deal is safe only if a note can change only with its
   own deal - not verified in the Rust; left broad.
3. The Book's `evidence.ts` cache and the `['deal_evidence', id]` query entries are separate: a deal
   page opened from the Book reads its evidence once more. Merging them is a small follow-up.
4. `mount.tsx`: besides the provider, the window-level boundary was added there (3 lines) - the only
   mount point every window shares. WP1a's CSS import lines are untouched.
5. The fallback button uses the existing `.ui-btn` class; if WP1a renames it, update `ErrorBoundary.tsx`.

## Files
New: `src/lib/data/{keys,invoke,invalidation,bus,client,provider.tsx,query,counts,useWindowedRows}.ts`,
tests `src/lib/data/{invalidation,counts}.test.ts`, `src/lib/data/{query,useWindowedRows}.test.tsx`,
`src/shared/boundary/{ErrorBoundary.tsx,LayerSuspense.tsx,staleBanner.ts,index.ts,boundary.css,boundary.test.tsx}`,
`src/windows/main/world.test.tsx`, this note.
Changed: `src/lib/hooks.ts`, `src/lib/mount.tsx`, `src/lib/words.ts` (append only),
`src/windows/main/world.tsx`, `src/windows/main/displays.ts`.
