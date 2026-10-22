// Windowed rows for long lists (the Book's 500 deals, a 5,000-step record): only the rows in view,
// plus `overscan` on each side, are in the DOM. Built on @tanstack/react-virtual.
//
// Keyboard: the list is one tab stop (roving tabindex). Arrow Up/Down, Page Up/Down, Home and End
// move the focused row; the list scrolls to it and focus follows. The focused row is identified by
// its key (`getKey`), not its index, so a refetch that inserts or removes rows above it keeps focus
// on the same thing; if that row is gone, focus moves to the row now at its place. The focused row is
// always rendered, even scrolled out of view, so the focus ring is never dropped to <body>.
//
// Fixed-height rows: pass `estimateSize` as a number. Variable-height rows: pass `measure: true` and
// put `rowProps(row).ref` on the row element, which is then measured as it renders.
//
// jsdom caveat (tests): jsdom has no layout, so the scroll element measures 0 x 0 and no row would
// render. Tests stub the scroll element's size (offsetHeight/offsetWidth, which the virtualizer
// reads) and ResizeObserver; see useWindowedRows.test.tsx. In the shell the real sizes are used.
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';

export const WINDOW_OVERSCAN = 8;

export type WindowedRowsOptions<T> = {
  rows: readonly T[];
  getKey: (row: T) => string;
  /** A row's height in px: one number for fixed rows, or an estimate per row before it is measured. */
  estimateSize: number | ((row: T, index: number) => number);
  /** Measure each rendered row (variable heights). */
  measure?: boolean;
  overscan?: number;
  /** Rows a Page Up/Down moves; default the rows that fit in view. */
  pageRows?: number;
};

export type WindowedRow<T> = { row: T; key: string; index: number; start: number; size: number };

export type RowProps = {
  ref: (el: HTMLElement | null) => void;
  tabIndex: 0 | -1;
  'data-index': number;
  'data-focused'?: true;
  onFocus: () => void;
};

export type WindowedRows<T> = {
  /** Put on the scrolling element (it needs a fixed height and overflow: auto). */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Put on the scrolling element too: the keyboard. */
  onKeyDown: (e: KeyboardEvent) => void;
  /** The height of the whole list in px: give the inner spacer this height. */
  totalSize: number;
  /** The rows to render, each at `translateY(start)` inside the spacer. */
  items: WindowedRow<T>[];
  rowProps: (item: WindowedRow<T>) => RowProps;
  focusedKey: string | null;
  /** Focus a row by key (scrolls to it). */
  focusKey: (key: string) => void;
  scrollToKey: (key: string) => void;
};

export function useWindowedRows<T>(o: WindowedRowsOptions<T>): WindowedRows<T> {
  const { rows, getKey, estimateSize, measure = false, overscan = WINDOW_OVERSCAN } = o;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const lastIndex = useRef(0);
  const wantFocus = useRef(false);
  const nodes = useRef(new Map<string, HTMLElement>());

  const keys = useMemo(() => rows.map(getKey), [rows, getKey]);
  const indexOf = useMemo(() => new Map(keys.map((k, i) => [k, i])), [keys]);

  // The focused row by key; if it left the list, the row now at its place.
  let focusIndex = focusedKey === null ? -1 : (indexOf.get(focusedKey) ?? -1);
  if (focusedKey !== null && focusIndex === -1 && rows.length > 0) focusIndex = Math.min(lastIndex.current, rows.length - 1);
  if (focusIndex >= 0) lastIndex.current = focusIndex;
  const effectiveKey = focusIndex >= 0 ? (keys[focusIndex] ?? null) : null;

  const rangeExtractor = useCallback((range: Range) => {
    const base = defaultRangeExtractor(range);
    if (focusIndex >= 0 && !base.includes(focusIndex)) return [...base, focusIndex].sort((a, b) => a - b);
    return base;
  }, [focusIndex]);

  const v = useVirtualizer<HTMLDivElement, HTMLElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => {
      if (typeof estimateSize === 'number') return estimateSize;
      const r = rows[i];
      return r === undefined ? 0 : estimateSize(r, i);
    },
    getItemKey: (i) => keys[i] ?? i,
    overscan,
    rangeExtractor,
  });

  // Focus follows the focused key after it is rendered, but only if the list had focus: a refetch
  // never pulls focus into the list from elsewhere.
  useEffect(() => {
    if (!wantFocus.current || effectiveKey === null) return;
    const el = nodes.current.get(effectiveKey);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
    wantFocus.current = false;
  });

  const focusAt = useCallback((i: number) => {
    const k = keys[i];
    if (k === undefined) return;
    wantFocus.current = true;
    setFocusedKey(k);
    v.scrollToIndex(i, { align: 'auto' });
  }, [keys, v]);

  const fit = Math.floor((scrollRef.current?.clientHeight ?? 0) / (typeof estimateSize === 'number' && estimateSize > 0 ? estimateSize : 40));
  const page = o.pageRows ?? (fit > 0 ? fit : 10);

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (rows.length === 0) return;
    const at = focusIndex >= 0 ? focusIndex : -1;
    let to: number | null = null;
    switch (e.key) {
      case 'ArrowDown': to = Math.min(rows.length - 1, at + 1); break;
      case 'ArrowUp': to = Math.max(0, at - 1); break;
      case 'PageDown': to = Math.min(rows.length - 1, Math.max(0, at) + page); break;
      case 'PageUp': to = Math.max(0, at - page); break;
      case 'Home': to = 0; break;
      case 'End': to = rows.length - 1; break;
      default: return;
    }
    e.preventDefault();
    focusAt(to);
  }, [rows.length, focusIndex, page, focusAt]);

  const items: WindowedRow<T>[] = [];
  for (const vi of v.getVirtualItems()) {
    const row = rows[vi.index];
    const key = keys[vi.index];
    if (row === undefined || key === undefined) continue;
    items.push({ row, key, index: vi.index, start: vi.start, size: vi.size });
  }
  // Nothing focused yet: the first row rendered is the tab stop (the list's first row may have been
  // scrolled out of the DOM, and the list must still be reachable with Tab).
  const entry = effectiveKey === null ? (items[0]?.index ?? 0) : -1;

  const measureEl = v.measureElement;
  const rowProps = useCallback((item: WindowedRow<T>): RowProps => {
    const isFocused = effectiveKey === item.key || item.index === entry;
    return {
      ref: (el) => {
        if (el) nodes.current.set(item.key, el);
        else nodes.current.delete(item.key);
        if (measure && el) measureEl(el);
      },
      tabIndex: isFocused ? 0 : -1,
      'data-index': item.index,
      ...(effectiveKey === item.key ? { 'data-focused': true as const } : {}),
      onFocus: () => { if (focusedKey !== item.key) setFocusedKey(item.key); },
    };
  }, [effectiveKey, entry, focusedKey, measure, measureEl]);

  return {
    scrollRef,
    onKeyDown,
    totalSize: v.getTotalSize(),
    items,
    rowProps,
    focusedKey: effectiveKey,
    focusKey: (k) => { const i = indexOf.get(k); if (i !== undefined) focusAt(i); },
    scrollToKey: (k) => { const i = indexOf.get(k); if (i !== undefined) v.scrollToIndex(i, { align: 'auto' }); },
  };
}
