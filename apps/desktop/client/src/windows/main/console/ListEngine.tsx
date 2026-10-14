// The console's list engine (rebuild WP2.5): one typed list for every long list of the console - a
// module's deals, the Book's ledger, the record's steps, the rescue list. A search box (debounced,
// case-insensitive, over each row's search text built once per data change), filter chips whose
// counts are counted in one pass per data change, a sort, and windowed rows (only the rows in view
// are in the DOM, lib/data/useWindowedRows), with variable row heights when asked.
//
// Keyboard: the rows are one tab stop; Arrow Up/Down, Page Up/Down, Home, End move; Enter opens the
// focused row. Escape clears the search (or the filter) first; with nothing to clear it goes on to
// the console, which goes one layer up. On a wide window (>= 1500 px, `wideAt`) a list with a
// `detail` shows the picked row beside the list instead of opening it.
//
// Rows are buttons: a row opens or picks, nothing else. Actions belong to the row's detail (the
// pane, or the layer it opens), so a row never holds a second control.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react';
import { formatCount, formatTally } from '../../../lib/data/counts';
import { useWindowedRows } from '../../../lib/data/useWindowedRows';
import { LIST_ALL, LIST_CLEAR, LIST_DETAIL_EMPTY, LIST_FILTER, LIST_NO_MATCH, LIST_SEARCH, LIST_SEARCH_PLACEHOLDER, LIST_SORT, listShowing } from '../../../lib/words';
import { Btn, Field } from '../../../shared/ui';

/** How long the search waits after the last keystroke. */
export const SEARCH_DEBOUNCE_MS = 120;
/** At or under this many rows the toolbar is not drawn: the whole list is in view anyway. */
export const TOOLBAR_MIN = 8;
/** From this window width a list with a `detail` shows the picked row beside it. */
export const WIDE_AT = 1500;

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
  /** The row's content (inside the row button). */
  renderRow: (row: T, s: RowState) => ReactNode;
  /** The row's accessible name, when its content says too much or too little. */
  rowLabel?: (row: T) => string;
  /** Opening a row (Enter or a click): usually `nav.deal(id)` or a detail view. */
  onOpen?: (row: T) => void;
  /** The picked row beside the list on a wide window (it then picks instead of opening). */
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
function useDebounced<V>(v: V, ms: number): V {
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

export function ListEngine<T>(p: ListEngineProps<T>) {
  const { rows, getKey, filters, sorts, onOpen } = p;
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
  const shown = useMemo(() => shownRows(rows, hay, q, filter, sort), [rows, hay, q, filter, sort]);

  const wide = useWide(p.wideAt ?? WIDE_AT);
  const side = wide && !!p.detail;
  const [picked, setPicked] = useState<string | null>(null);
  const pickedRow = side && picked !== null ? shown.find((r) => getKey(r) === picked) : undefined;

  const list = useWindowedRows({ rows: shown, getKey, estimateSize: p.estimateSize, measure: p.measure });
  const toolbar = rows.length > (p.toolbarMin ?? TOOLBAR_MIN);

  const activate = useCallback((row: T) => {
    if (side) setPicked(getKey(row));
    else onOpen?.(row);
  }, [side, getKey, onOpen]);

  const clear = () => { setQuery(''); setFilterValue(null); };
  // Escape clears first; with nothing to clear it goes on to the console (one layer up).
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (query || filterValue) { e.preventDefault(); clear(); }
  };

  const summary = listShowing(shown.length, rows.length, formatTally);
  return (
    <section className={`le${side ? ' side' : ''}${p.className ? ` ${p.className}` : ''}`} aria-label={p.label} onKeyDown={onKeyDown}>
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
          <span className="le-summary" role="status">{summary}</span>
          {sorts && sorts.length > 1 ? (
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
            : (
              <div ref={list.scrollRef} onKeyDown={list.onKeyDown} className="le-scroll" role="list" aria-label={p.label}>
                <div className="le-space" style={{ height: list.totalSize }}>
                  {list.items.map((it) => {
                    const rp = list.rowProps(it);
                    const st: RowState = { focused: list.focusedKey === it.key, selected: side && picked === it.key };
                    return (
                      <div key={it.key} role="listitem" className="le-item" style={{ transform: `translateY(${it.start}px)`, height: p.measure ? undefined : it.size }}>
                        <button type="button" {...rp} className={`le-row${st.selected ? ' on' : ''}`} data-fk={`le-${it.key}`} aria-label={p.rowLabel?.(it.row)}
                          aria-current={st.selected || undefined} onClick={() => activate(it.row)}>
                          {p.renderRow(it.row, st)}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
        {side ? (
          <aside className="le-detail" aria-live="polite">
            {pickedRow !== undefined && p.detail ? p.detail(pickedRow) : <p className="le-empty">{LIST_DETAIL_EMPTY}</p>}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
