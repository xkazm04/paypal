// Windowed rows: only the rows in view (plus overscan) are in the DOM, the list is one tab stop,
// the keyboard moves focus and the list follows it, and focus stays on the same row (by key) when
// rows are inserted above it or moves to the row at its place when it is removed.
//
// jsdom has no layout: the scroll element's size (offsetHeight/offsetWidth, which the virtualizer
// reads), its scroll range (scrollHeight/clientHeight, which clamp a scroll), ResizeObserver and
// Element.scrollTo are stubbed here. Real sizes are used in the shell.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useWindowedRows, WINDOW_OVERSCAN } from './useWindowedRows';

type Row = { id: string; label: string };
const rowsOf = (n: number, prefix = 'R'): Row[] => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, label: `${prefix} row ${i}` }));
const getKey = (r: Row) => r.id;
const VIEW = 400;
const ROW = 40;

function List({ rows }: { rows: Row[] }) {
  const w = useWindowedRows({ rows, getKey, estimateSize: ROW });
  return (
    <div ref={w.scrollRef} onKeyDown={w.onKeyDown} data-testid="scroll">
      <div data-total={w.totalSize}>
        {w.items.map((it) => <div key={it.key} {...w.rowProps(it)} data-row={it.key}>{it.row.label}</div>)}
      </div>
    </div>
  );
}

const saved: { oh?: PropertyDescriptor; ow?: PropertyDescriptor; sh?: PropertyDescriptor; ch?: PropertyDescriptor; ro?: unknown; st?: unknown } = {};
beforeAll(() => {
  saved.oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  saved.ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  saved.sh = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight');
  saved.ch = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight');
  // The scroll range: the spacer's height (data-total) inside a VIEW-high scroller.
  Object.defineProperty(Element.prototype, 'scrollHeight', { configurable: true, get(this: Element) { return Number(this.querySelector('[data-total]')?.getAttribute('data-total') ?? 0); } });
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get(this: HTMLElement) { return this.dataset?.testid === 'scroll' ? VIEW : 0; } });
  saved.ro = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  saved.st = (Element.prototype as { scrollTo?: unknown }).scrollTo;
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.dataset.testid === 'scroll' ? VIEW : ROW; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 300; } });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  (Element.prototype as { scrollTo: unknown }).scrollTo = function (this: HTMLElement, o: { top?: number }) {
    this.scrollTop = o.top ?? 0;
    this.dispatchEvent(new Event('scroll'));
  };
});
afterAll(() => {
  if (saved.oh) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.oh);
  if (saved.ow) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.ow);
  if (saved.sh) Object.defineProperty(Element.prototype, 'scrollHeight', saved.sh);
  if (saved.ch) Object.defineProperty(Element.prototype, 'clientHeight', saved.ch);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.ro;
  (Element.prototype as { scrollTo?: unknown }).scrollTo = saved.st;
});
afterEach(cleanup);

const rendered = () => [...document.querySelectorAll<HTMLElement>('[data-row]')];
const focusedRow = () => (document.activeElement as HTMLElement | null)?.dataset.row;
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

describe('useWindowedRows', () => {
  it('renders only the rows in view plus overscan, and the whole height', async () => {
    render(<List rows={rowsOf(1000)} />);
    await frame();
    const n = rendered().length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(VIEW / ROW + 2 * WINDOW_OVERSCAN);
    expect(document.querySelector('[data-total]')?.getAttribute('data-total')).toBe(String(1000 * ROW));
  });

  it('is one tab stop: the first row until another is focused', async () => {
    render(<List rows={rowsOf(50)} />);
    await frame();
    const tabbable = rendered().filter((e) => e.tabIndex === 0);
    expect(tabbable.map((e) => e.dataset.row)).toEqual(['R0']);
  });

  it('the keyboard moves focus, the list scrolls to it, and focus is never dropped', async () => {
    render(<List rows={rowsOf(1000)} />);
    await frame();
    const first = screen.getByText('R row 0');
    act(() => { first.focus(); });
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await frame();
    expect(focusedRow()).toBe('R1');
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' });
    await frame();
    expect(focusedRow()).toBe('R999');
    expect(screen.getByTestId('scroll').scrollTop).toBeGreaterThan(0);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    await frame();
    expect(focusedRow()).toBe('R0');
  });

  it('keeps focus on the same row when rows are inserted above it, and on its place when it is removed', async () => {
    const base = rowsOf(30);
    const r = render(<List rows={base} />);
    await frame();
    const third = screen.getByText('R row 2');
    act(() => { third.focus(); });
    r.rerender(<List rows={[...rowsOf(3, 'N'), ...base]} />);
    await frame();
    expect(document.querySelector('[data-focused]')?.getAttribute('data-row')).toBe('R2');
    expect(rendered().filter((e) => e.tabIndex === 0).map((e) => e.dataset.row)).toEqual(['R2']);
    // R2 goes: the row now at its place (index 5) takes the tab stop
    const without = [...rowsOf(3, 'N'), ...base].filter((x) => x.id !== 'R2');
    r.rerender(<List rows={without} />);
    await frame();
    expect(document.querySelector('[data-focused]')?.getAttribute('data-row')).toBe('R3');
  });

  it('keeps a focused row rendered after it is scrolled far out of view', async () => {
    render(<List rows={rowsOf(1000)} />);
    await frame();
    const first = screen.getByText('R row 0');
    act(() => { first.focus(); });
    const scroller = screen.getByTestId('scroll');
    act(() => { scroller.scrollTop = 30_000; scroller.dispatchEvent(new Event('scroll')); });
    await frame();
    expect(rendered().some((e) => e.dataset.row === 'R0')).toBe(true);
    expect(rendered().some((e) => e.dataset.row === 'R750')).toBe(true);
  });
});
