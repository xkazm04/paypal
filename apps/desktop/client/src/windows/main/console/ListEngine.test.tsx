// The list engine at 5,000 rows: only a window of rows is in the DOM, the first paint stays within a
// budget, the filter counts are counted once per data change (not per render or per keystroke), the
// search is debounced and case-insensitive over the prebuilt text, Escape clears before it lets the
// console go back, Enter opens, the toolbar hides on short lists, and a wide window shows the
// picked row beside the list. jsdom has no layout: sizes are stubbed as in useWindowedRows.test.tsx.
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIST_SEARCH, LIST_TWO_STEP, listShowing } from '../../../lib/words';
import { formatTally } from '../../../lib/data/counts';
import { countFilters, ListEngine, SEARCH_DEBOUNCE_MS, shownRows, type ListFilter, type ListSort } from './ListEngine';

type Row = { id: string; title: string; who: string; minor: number; held: boolean };
const rowsOf = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, title: `Monitor ${i}`, who: i % 7 === 0 ? 'Partsco' : `Shop ${i % 5}`, minor: (i * 37) % 10_000, held: i % 3 === 0 }));
const VIEW = 600;
const ROW = 40;

const saved: { oh?: PropertyDescriptor; ow?: PropertyDescriptor; ro?: unknown; st?: unknown } = {};
beforeAll(() => {
  saved.oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  saved.ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('le-scroll') ? VIEW : ROW; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 900; } });
  saved.ro = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  saved.st = (Element.prototype as { scrollTo?: unknown }).scrollTo;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (Element.prototype as { scrollTo: unknown }).scrollTo = function (this: HTMLElement, o: { top?: number }) { this.scrollTop = o.top ?? 0; this.dispatchEvent(new Event('scroll')); };
});
afterAll(() => {
  if (saved.oh) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.oh);
  if (saved.ow) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.ow);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.ro;
  (Element.prototype as { scrollTo?: unknown }).scrollTo = saved.st;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const counted = { n: 0 };
const FILTERS: ListFilter<Row>[] = [
  { value: 'held', label: 'On hold', test: (r) => { counted.n += 1; return r.held; } },
  { value: 'partsco', label: 'Partsco', test: (r) => { counted.n += 1; return r.who === 'Partsco'; } },
];
const SORTS: ListSort<Row>[] = [
  { value: 'list', label: 'As listed', compare: () => 0 },
  { value: 'amount', label: 'Largest first', compare: (a, b) => b.minor - a.minor },
];

function Harness({ rows, onOpen, detail }: { rows: Row[]; onOpen?: (r: Row) => void; detail?: (r: Row) => ReactNode }) {
  return (
    <div className="host">
      <ListEngine<Row> label="Deals" rows={rows} getKey={(r) => r.id} searchText={(r) => `${r.title} ${r.who}`} filters={FILTERS} sorts={SORTS}
        estimateSize={ROW} renderRow={(r) => <span>{r.title} · {r.who}</span>} onOpen={onOpen} detail={detail} empty="No deals yet." />
    </div>
  );
}
const items = () => document.querySelectorAll('.le-item');

describe('pure parts', () => {
  it('counts every filter in one pass over the rows', () => {
    const rows = rowsOf(5000);
    counted.n = 0;
    const c = countFilters(rows, FILTERS);
    expect(counted.n).toBe(10_000);
    expect(c.get('held')).toBe(rows.filter((r) => r.held).length);
    expect(c.get('partsco')).toBe(rows.filter((r) => r.who === 'Partsco').length);
  });
  it('filters, searches the prebuilt text and sorts', () => {
    const rows = rowsOf(50);
    const hay = rows.map((r) => `${r.title} ${r.who}`.toLowerCase());
    const out = shownRows(rows, hay, '  PARTSCO ', FILTERS[0] ?? null, SORTS[1] ?? null);
    expect(out.every((r) => r.held && r.who === 'Partsco')).toBe(true);
    expect(out.map((r) => r.minor)).toEqual([...out.map((r) => r.minor)].sort((a, b) => b - a));
  });
});

describe('the list engine at 5,000 rows', () => {
  it('draws a window of rows, fast, and counts the filters once per data change', () => {
    const rows = rowsOf(5000);
    counted.n = 0;
    const t0 = performance.now();
    const { rerender } = render(<Harness rows={rows} />);
    const ms = performance.now() - t0;
    expect(items().length).toBeGreaterThan(0);
    expect(items().length).toBeLessThan(60);
    // jsdom is far slower than the shell; a guard against an O(n) render, not the shell's timing.
    expect(ms).toBeLessThan(1500);
    expect(counted.n).toBe(10_000);
    // A re-render with the same rows counts nothing again.
    rerender(<Harness rows={rows} />);
    expect(counted.n).toBe(10_000);
    // The counts go through formatCount: 99+ above 99.
    const chips = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button');
    expect(chips.map((b) => b.textContent)).toEqual(['All99+', 'On hold99+', 'Partsco99+']);
    expect(screen.getByRole('status').textContent).toBe(listShowing(5000, 5000, formatTally));
  });

  it('searches after the debounce, case-insensitively, and Escape clears before going back', () => {
    vi.useFakeTimers();
    const rows = rowsOf(5000);
    render(<Harness rows={rows} />);
    const box = screen.getByRole('searchbox', { name: LIST_SEARCH });
    fireEvent.change(box, { target: { value: 'MONITOR 4999' } });
    expect(screen.getByRole('status').textContent).toBe(listShowing(5000, 5000, formatTally));
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10); });
    expect(screen.getByRole('status').textContent).toBe(listShowing(1, 5000, formatTally));
    expect(items()).toHaveLength(1);
    // Escape with a search: it clears, and the console never sees it.
    const outside = vi.fn();
    window.addEventListener('keydown', outside);
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(first); });
    expect(first.defaultPrevented).toBe(true);
    act(() => { vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10); });
    expect((box as HTMLInputElement).value).toBe('');
    expect(items().length).toBeGreaterThan(1);
    // Escape with nothing to clear goes on to the console (it goes one layer up there).
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { box.dispatchEvent(second); });
    expect(second.defaultPrevented).toBe(false);
    expect(outside).toHaveBeenCalledTimes(2);
    window.removeEventListener('keydown', outside);
  });

  it('a filter narrows the rows; the arrow keys move along them and Enter opens one', async () => {
    const rows = rowsOf(5000);
    const onOpen = vi.fn();
    render(<Harness rows={rows} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /^Partsco/ }));
    expect(screen.getByRole('status').textContent).toBe(listShowing(rows.filter((r) => r.who === 'Partsco').length, 5000, formatTally));
    const list = screen.getByRole('list', { name: 'Deals' });
    const firstRow = list.querySelector<HTMLButtonElement>('.le-row');
    expect(firstRow?.tabIndex).toBe(0);
    act(() => { firstRow?.focus(); });
    fireEvent.keyDown(firstRow as HTMLElement, { key: 'ArrowDown' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect((document.activeElement as HTMLElement).textContent).toContain('Monitor 7 · Partsco');
    fireEvent.click(document.activeElement as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r7' }));
  });

  it('hides the toolbar on a short list, and says so when there is nothing at all', () => {
    const { rerender } = render(<Harness rows={rowsOf(8)} />);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(items()).toHaveLength(8);
    rerender(<Harness rows={[]} />);
    expect(screen.getByText('No deals yet.')).toBeTruthy();
  });

  it('a wide window shows the picked row beside the list instead of opening it', () => {
    const was = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const onOpen = vi.fn();
    render(<Harness rows={rowsOf(30)} onOpen={onOpen} detail={(r) => <p>Detail of {r.title}</p>} />);
    const row = document.querySelectorAll<HTMLButtonElement>('.le-row')[2];
    fireEvent.click(row as HTMLElement);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('Detail of Monitor 2')).toBeTruthy();
    expect(row?.getAttribute('aria-current')).toBe('true');
    // Enter opens the picked row (the two steps: click picks, Enter opens)
    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: was });
  });

  it('a narrow window keeps the pick: the detail sits under the list, a click still picks', () => {
    const was = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
    const onOpen = vi.fn();
    render(<Harness rows={rowsOf(30)} onOpen={onOpen} detail={(r) => <p>Detail of {r.title}</p>} />);
    expect(document.querySelector('.le')?.classList.contains('stack')).toBe(true);
    const row = document.querySelectorAll<HTMLButtonElement>('.le-row')[4];
    fireEvent.click(row as HTMLElement);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('Detail of Monitor 4')).toBeTruthy();
    fireEvent.keyDown(row as HTMLElement, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: was });
  });
});

describe('two steps: a click picks for the pane, Enter opens', () => {
  function Picking({ onPick, onOpen }: { onPick: (r: Row) => void; onOpen?: (r: Row) => void }) {
    return <ListEngine<Row> label="Tables" rows={rowsOf(12)} getKey={(r) => r.id} estimateSize={ROW} renderRow={(r) => <span>{r.title}</span>} onPick={onPick} onOpen={onOpen} empty="None." />;
  }
  it('with onPick and onOpen: a click (and Space) picks, Enter opens, and the list says so once', () => {
    const onPick = vi.fn();
    const onOpen = vi.fn();
    render(<Picking onPick={onPick} onOpen={onOpen} />);
    const row = document.querySelectorAll<HTMLButtonElement>('.le-row')[3] as HTMLElement;
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'r3' }));
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'r3' }));
    expect(onPick).toHaveBeenCalledTimes(1);
    const list = screen.getByRole('list', { name: 'Tables' });
    const hint = document.getElementById(list.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe(LIST_TWO_STEP);
  });
  it('with only onPick: Enter picks too, and no two-step hint is read', () => {
    const onPick = vi.fn();
    render(<Picking onPick={onPick} />);
    const row = document.querySelectorAll<HTMLButtonElement>('.le-row')[1] as HTMLElement;
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(screen.getByRole('list', { name: 'Tables' }).hasAttribute('aria-describedby')).toBe(false);
  });
});
