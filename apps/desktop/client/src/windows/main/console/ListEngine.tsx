// The console's list engine (rebuild WP2.5): one typed list for every long list of the console - a
// module's deals, the Book's ledger, the record's steps, the rescue list. A search box (debounced,
// case-insensitive, over each row's search text built once per data change), filter chips whose
// counts are counted in one pass per data change, a sort, and windowed rows (only the rows in view
// are in the DOM, lib/data/useWindowedRows), with variable row heights when asked. A list longer than
// `pageSize` (default LIST_PAGE_SIZE = 20) is cut into pages under a Pager; the filter, search and
// sort apply first, so the pager's total is the count after them, and any change of the three goes
// back to page 1. `pageSize={0}` keeps a list whole (the windowed path above).
//
// Keyboard: the rows are one tab stop; Arrow Up/Down, Page Up/Down, Home, End move; Enter opens the
// focused row (its deal). On a paged list Page Up/Down at the edge of a page flips the page. Escape clears the search (or the filter) first; with nothing to clear it
// goes on to the console, which goes one layer up.
//
// Two steps where a list has a pane (rebuild WP4a, Director decision 3): a click (or Space) PICKS the
// row - the area's own pane (`onPick`) or the list's `detail` - and Enter OPENS it (`onOpen`,
// usually the deal). A list without a pane opens on a click too. A `detail` sits beside the list on
// a wide window (>= 1500 px, `wideAt`) and under it on a narrower one, so the pick is never lost to
// the window's width (decision 6).
//
// Rows are buttons: a row opens or picks, nothing else. Actions belong to the row's detail (the
// pane, or the layer it opens), so a row never holds a second control.
import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { formatCount, formatTally } from '../../../lib/data/counts';
import { useWindowedRows } from '../../../lib/data/useWindowedRows';
import { lazyPart } from '../../../lib/lazy';
import { LIST_ALL, LIST_CLEAR, LIST_DETAIL_EMPTY, LIST_FILTER, LIST_GROUP, LIST_GROUP_NONE, LIST_LOADING, LIST_NO_MATCH, LIST_SEARCH, LIST_SEARCH_PLACEHOLDER, LIST_SORT, LIST_TWO_STEP, listShowing } from '../../../lib/words';
import type { DataGrid as DataGridFn, DataGridHandle, GridColumn } from '../../../shared/DataGrid';
import { loadGroup, saveGroup } from '../../../shared/gridState';
import { useGridTier } from '../../../shared/gridLicence';
import { Btn, Field } from '../../../shared/ui';
import { useRowMotion } from '../../../design/presets';
import { pageCount, Pager } from './Pager';
import { Skeleton, Staged } from './stagger';

/** How long the search waits after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 120;
/** At or under this many rows the toolbar is not drawn: the whole list is in view anyway. */
export const TOOLBAR_MIN = 8;
/** From this window width a list with a `detail` shows the picked row beside it. */
export const WIDE_AT = 1500;
/** Rows per page of a long list (a list may pass its own `pageSize`; 0 = never paged). */
export const LIST_PAGE_SIZE = 20;

export type ListFilter<T> = { value: string; label: string; test: (row: T) => boolean; title?: string };
export type ListSort<T> = { value: string; label: string; compare: (a: T, b: T) => number };
export type RowState = { focused: boolean; selected: boolean };

export type ListEngineProps<T> = {
  /** The list's accessible name. */
  label: string;
  rows: readonly T[];
  getKey: (row: T) => string;
  /** The text a row is found by (title, counterparty, amount in words...). Built once per change of
   *  `rows` and lowercased then; it must depend on the row only. Absent = no search box. */
  searchText?: (row: T) => string;
  /** Filter chips (one at a time, plus "All"). Keep the array stable (a module constant or a memo):
   *  the counts are counted again when it or `rows` changes, in one pass over the rows. */
  filters?: readonly ListFilter<T>[];
  filterLabel?: string;
  /** Sort choices; the first (or `initialSort`) applies at start. Keep the array stable. */
  sorts?: readonly ListSort<T>[];
  initialSort?: string;
  /** A row's height in px, or an estimate per row; with `measure` each row is measured as drawn. */
  estimateSize: number | ((row: T, index: number) => number);
  measure?: boolean;
  /** The row's content (inside the row button). Unused when `columns` is given. */
  renderRow: (row: T, s: RowState) => ReactNode;
  /** Draws the list as the data grid: the grid's own column sort and filters replace the sort choice
   *  and the pager; the search box drives the grid's quick filter. Filter chips, pick and detail work
   *  as on any list. */
  columns?: readonly GridColumn<T>[];
  /** The row of totals over the rows the grid shows (and a group's money), in one line of words. */
  totals?: (rows: readonly T[]) => string;
  /** The rows the grid shows after every filter, for what follows them (a chart). */
  onFilteredRows?: (rows: readonly T[]) => void;
  /** The row's accessible name, when its content says too much or too little. */
  rowLabel?: (row: T) => string;
  /** Opening a row: Enter, and a click too when the list has no pane (`onPick` / `detail`).
   *  Usually `nav.deal(id)`. */
  onOpen?: (row: T) => void;
  /** Picking a row for the area's own pane (a click or Space); Enter then opens it (`onOpen`). */
  onPick?: (row: T) => void;
  /** The picked row's detail: beside the list on a wide window, under it on a narrower one. A click
   *  picks, Enter opens. */
  detail?: (row: T) => ReactNode;
  /** Shown when there are no rows at all (one calm line). */
  empty: ReactNode;
  /** Shown when the search or the filter hides every row. */
  noMatch?: ReactNode;
  /** Rows at or under which the toolbar is hidden (default 8). */
  toolbarMin?: number;
  wideAt?: number;
  /** Reserved for WP3 (group headers between rows); not drawn yet. Rows keep their order. */
  groupBy?: (row: T) => string;
  /** Rows per page (default LIST_PAGE_SIZE); 0 keeps the list whole and windowed. */
  pageSize?: number;
  className?: string;
};

function subscribeResize(cb: () => void): () => void {
  window.addEventListener('resize', cb);
  return () => window.removeEventListener('resize', cb);
}
/** True on a window at least `px` wide (follows resizes). */
export function useWide(px: number): boolean {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth >= px, () => false);
}

/** A value that follows `v` after `ms` without a change. */
export function useDebounced<V>(v: V, ms: number): V {
  const [d, setD] = useState(v);
  useEffect(() => {
    if (Object.is(d, v)) return;
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, d, ms]);
  return d;
}

/** The counts per filter, in one pass over the rows (pure; exported for tests). */
export function countFilters<T>(rows: readonly T[], filters: readonly ListFilter<T>[]): Map<string, number> {
  const out = new Map<string, number>(filters.map((f) => [f.value, 0]));
  for (const r of rows) {
    for (const f of filters) if (f.test(r)) out.set(f.value, (out.get(f.value) ?? 0) + 1);
  }
  return out;
}

/** The rows shown: the filter, then the search over the prebuilt text, then the sort (pure). */
export function shownRows<T>(rows: readonly T[], hay: readonly string[] | null, q: string, filter: ListFilter<T> | null, sort: ListSort<T> | null): T[] {
  const needle = q.trim().toLowerCase();
  const out: T[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r === undefined) continue;
    if (filter && !filter.test(r)) continue;
    if (needle && hay && !(hay[i] ?? '').includes(needle)) continue;
    out.push(r);
  }
  if (sort) out.sort(sort.compare);
  return out;
}

/** A list this short is drawn at its own height (no long empty band under a few rows). */
export const FEW_ROWS = 6;
export const fewRows = (n: number): string | undefined => (n <= FEW_ROWS ? 'few' : undefined);

const NO_ROWS: readonly never[] = [];

/** The data grid is a chunk of its own (the grid library and its two stylesheets travel with it): it
 *  loads the first time a list draws as a grid, so a plain list, and the first paint, never carry it.
 *  Until it has loaded the list holds its place with a calm skeleton the grid's height. */
export const DataGridPart = lazyPart(() => import('../../../shared/DataGrid').then((m) => m.DataGrid));
// lazyPart keeps the props but not the generic: the grid is drawn through the real signature.
const Grid = DataGridPart as unknown as typeof DataGridFn;
/** The grid's row height (shared/DataGrid GRID_ROW_HEIGHT), for the placeholder only. */
const WAIT_ROW_PX = 36;

function GridWait({ rows, auto }: { rows: number; auto: boolean }) {
  // A short list is drawn at its own height (header + rows); a long one at the grid's least height.
  const h = auto ? `${(rows + 1) * WAIT_ROW_PX}px` : 'min(60vh, 24rem)';
  return (
    <>
      <p className="sr-only" role="status">{LIST_LOADING}</p>
      <Skeleton h={h} />
    </>
  );
}

export function ListEngine<T>(p: ListEngineProps<T>) {
  const { rows, getKey, filters, sorts, onOpen, onPick } = p;
  const searchRef = useRef(p.searchText);
  searchRef.current = p.searchText;
  const hasSearch = !!p.searchText;
  const hay = useMemo(() => (hasSearch ? rows.map((r) => (searchRef.current?.(r) ?? '').toLowerCase()) : null), [rows, hasSearch]);
  const counts = useMemo(() => (filters?.length ? countFilters(rows, filters) : null), [rows, filters]);

  const [query, setQuery] = useState('');
  const q = useDebounced(query, SEARCH_DEBOUNCE_MS);
  const [filterValue, setFilterValue] = useState<string | null>(null);
  const [sortValue, setSortValue] = useState<string | null>(p.initialSort ?? sorts?.[0]?.value ?? null);
  const filter = filters?.find((f) => f.value === filterValue) ?? null;
  const sort = sorts?.find((s) => s.value === sortValue) ?? null;
  const grid = p.columns;
  const isGrid = !!grid;
  const shown = useMemo(() => shownRows(rows, isGrid ? null : hay, isGrid ? '' : q, filter, isGrid ? null : sort), [rows, hay, q, filter, sort, isGrid]);
  const gridRef = useRef<DataGridHandle>(null);
  const [gridShown, setGridShown] = useState<number | null>(null);
  // Group options: offered only when the Enterprise grid has loaded (../../../shared/gridLicence); a saved
  // choice for a column that is not offered here is ignored, not guessed at.
  const groupable = useMemo(() => grid?.filter((c) => c.group) ?? [], [grid]);
  const tier = useGridTier(groupable.length > 0);
  const [groupBy, setGroupBy] = useState<string | null>(() => loadGroup(p.label));
  const groupChoice = tier === 'enterprise' ? groupable : [];
  const groupNow = groupChoice.some((c) => c.id === groupBy) ? groupBy : null;
  const pickGroup = (v: string) => { const next = v || null; setGroupBy(next); saveGroup(p.label, next); };

  // The page: 1-based, kept with the filter / search / sort it was chosen under, so changing any of
  // them is back to page 1 without an effect; clamped when the data shrinks.
  const pageSize = isGrid ? 0 : p.pageSize ?? LIST_PAGE_SIZE;
  const sig = `${filterValue ?? ''} ${q} ${sortValue ?? ''}`;
  const [pageAt, setPageAt] = useState<{ sig: string; page: number }>({ sig, page: 1 });
  const pages = pageCount(shown.length, pageSize);
  const page = Math.min(pageAt.sig === sig ? pageAt.page : 1, pages);
  const paged = pageSize > 0 && shown.length > pageSize;
  const pageRows = useMemo(() => (paged ? shown.slice((page - 1) * pageSize, page * pageSize) : shown), [paged, shown, page, pageSize]);
  const setPage = useCallback((n: number) => setPageAt({ sig, page: n }), [sig]);

  const wide = useWide(p.wideAt ?? WIDE_AT);
  const hasDetail = !!p.detail;
  const side = wide && hasDetail;
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRow = hasDetail && picked !== null ? shown.find((r) => getKey(r) === picked) : undefined;
  const detailRef = useRef<HTMLElement>(null);

  // Rows joining or leaving while the list is in view (design/presets.ts): one-shot, keyed by the row's
  // key over every row the list knows, so a filter, a search, a page or a scroll never plays it.
  const motion = useRowMotion(rows, isGrid ? NO_ROWS as readonly T[] : pageRows, getKey);
  const list = useWindowedRows({ rows: isGrid ? NO_ROWS as readonly T[] : motion.rows, getKey, estimateSize: p.estimateSize, measure: p.measure });
  const toolbar = rows.length > (p.toolbarMin ?? TOOLBAR_MIN) && (!isGrid || hasSearch || !!filters?.length);

  /** A click or Space: pick when there is a pane, else open. */
  const activate = useCallback((row: T) => {
    if (hasDetail) {
      setPicked(getKey(row));
      // Under the list (a narrow window) the picked row's detail is brought into sight.
      if (!side) requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ block: 'nearest' }));
    } else if (onPick) onPick(row);
    else onOpen?.(row);
  }, [hasDetail, side, getKey, onPick, onOpen]);
  /** Enter: open (the deal); a list that only picks picks. */
  const enter = useCallback((row: T) => {
    if (onOpen) onOpen(row);
    else activate(row);
  }, [onOpen, activate]);
  // Page Up / Down at the edge of a page flips it; the hook's own move handles everything else.
  const focusAfterFlip = useRef<'first' | 'last' | null>(null);
  useEffect(() => {
    const want = focusAfterFlip.current;
    if (!want) return;
    focusAfterFlip.current = null;
    const row = want === 'first' ? pageRows[0] : pageRows[pageRows.length - 1];
    if (row !== undefined) list.focusKey(getKey(row));
  });
  const onListKey = (e: KeyboardEvent) => {
    if (paged && (e.key === 'PageDown' || e.key === 'PageUp')) {
      const edge = pageRows[e.key === 'PageDown' ? pageRows.length - 1 : 0];
      const next = e.key === 'PageDown' ? page + 1 : page - 1;
      if (edge !== undefined && list.focusedKey === getKey(edge) && next >= 1 && next <= pages) {
        e.preventDefault();
        focusAfterFlip.current = e.key === 'PageDown' ? 'first' : 'last';
        setPage(next);
        return;
      }
    }
    list.onKeyDown(e);
  };
  const twoStep = !!onOpen && (hasDetail || !!onPick);

  const clear = () => { setQuery(''); setFilterValue(null); };
  // Escape clears first; with nothing to clear it goes on to the console (one layer up).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (query || filterValue) { e.preventDefault(); clear(); return; }
    if (gridRef.current?.clearFilters()) e.preventDefault();
  };

  const summary = listShowing(isGrid && gridShown !== null ? Math.min(gridShown, shown.length) : shown.length, rows.length, formatTally);
  const hintId = useId();
  return (
    <section className={`le${side ? ' side' : hasDetail ? ' stack' : ''}${p.className ? ` ${p.className}` : ''}`} aria-label={p.label} onKeyDown={onKeyDown}>
      {twoStep ? <p className="sr-only" id={hintId}>{LIST_TWO_STEP}</p> : null}
      {toolbar ? (
        <div className="le-tools">
          {hasSearch ? (
            <span className="le-search">
              <Field search type="search" value={query} placeholder={LIST_SEARCH_PLACEHOLDER} aria-label={LIST_SEARCH} onChange={(e) => setQuery(e.currentTarget.value)} />
            </span>
          ) : null}
          {filters?.length ? (
            <div className="ui-filters le-filters" role="group" aria-label={p.filterLabel ?? LIST_FILTER}>
              <button type="button" className="ui-filter" aria-pressed={filterValue === null} onClick={() => setFilterValue(null)}>
                <span>{LIST_ALL}</span><span className="n">{formatCount(rows.length)}</span>
              </button>
              {filters.map((f) => (
                <button key={f.value} type="button" className="ui-filter" aria-pressed={filterValue === f.value} title={f.title}
                  onClick={() => setFilterValue((v) => (v === f.value ? null : f.value))}>
                  <span>{f.label}</span><span className="n">{formatCount(counts?.get(f.value) ?? 0)}</span>
                </button>
              ))}
            </div>
          ) : null}
          <span className="ui-spacer" />
          {groupChoice.length ? (
            <label className="le-sort">
              <span>{LIST_GROUP}</span>
              <select className="ui-field" value={groupNow ?? ''} onChange={(e) => pickGroup(e.currentTarget.value)}>
                <option value="">{LIST_GROUP_NONE}</option>
                {groupChoice.map((c) => <option key={c.id} value={c.id}>{c.header}</option>)}
              </select>
            </label>
          ) : null}
          <span className="le-summary" role="status">{summary}</span>
          {sorts && sorts.length > 1 && !isGrid ? (
            <label className="le-sort">
              <span>{LIST_SORT}</span>
              <select className="ui-field" value={sortValue ?? ''} onChange={(e) => setSortValue(e.currentTarget.value)}>
                {sorts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <div className="le-main">
        {rows.length === 0 ? <p className="le-empty">{p.empty}</p>
          : shown.length === 0 ? <p className="le-empty">{p.noMatch ?? LIST_NO_MATCH} <Btn sm kind="plain" onClick={clear}>{LIST_CLEAR}</Btn></p>
            : grid ? (
              <div className="le-col">
                <Suspense fallback={<GridWait rows={shown.length} auto={rows.length <= FEW_ROWS} />}>
                  <Grid<T> label={p.label} rows={shown} getKey={getKey} columns={grid} rowLabel={p.rowLabel} onActivate={activate} onEnter={enter}
                    onDisplayed={setGridShown} noMatch={typeof p.noMatch === 'string' ? p.noMatch : LIST_NO_MATCH} autoHeight={rows.length <= FEW_ROWS} handle={gridRef}
                    quickFilter={q} quickText={p.searchText} totals={p.totals} onFilteredRows={p.onFilteredRows} groupBy={groupNow} />
                </Suspense>
              </div>
            ) : (
              <div className="le-col">
              <div ref={list.scrollRef} onKeyDown={onListKey} className="le-scroll" role="list" aria-label={p.label} aria-describedby={twoStep ? hintId : undefined}>
                <div className="le-space" style={{ height: list.totalSize }}>
                  {list.items.map((it) => {
                    const rp = list.rowProps(it);
                    const st: RowState = { focused: list.focusedKey === it.key, selected: hasDetail && picked === it.key };
                    const gone = motion.leaving(it.key);
                    const mo = motion.cls(it.key);
                    return (
                      <div key={it.key} role="listitem" className="le-item" style={{ transform: `translateY(${it.start}px)`, height: p.measure ? undefined : it.size }}
                        aria-hidden={gone || undefined} inert={gone || undefined}>
                        <button type="button" {...rp} className={`le-row${st.selected ? ' on' : ''}${mo ? ` ${mo}` : ''}`} data-fk={gone ? undefined : `le-${it.key}`} aria-label={p.rowLabel?.(it.row)}
                          aria-current={st.selected || undefined} onClick={() => activate(it.row)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.defaultPrevented && !e.repeat) { e.preventDefault(); enter(it.row); } }}>
                          {p.renderRow(it.row, st)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
              {paged ? <Pager page={page} pageSize={pageSize} total={shown.length} onPage={setPage} label={`${p.label} pages`} /> : null}
              </div>
            )}
        {hasDetail ? (
          <aside className="le-detail" aria-live="polite" ref={detailRef}>
            {/* The picked row's pane takes its turn after the list (stagger.tsx; a pane is often evidence-backed). */}
            <Staged wave={2} sizeKey={`list:${p.label}:detail`} skeleton={<Skeleton h="3rem" />}>{pickedRow !== undefined && p.detail ? p.detail(pickedRow) : <p className="le-empty">{LIST_DETAIL_EMPTY}</p>}</Staged>
          </aside>
        ) : null}
      </div>
    </section>
  );
}
