// The motion presets on the money moments (design/presets.ts): a deal's state chip and amount play
// once on a change in front of the owner, never on mount, a refetch with the same value, a reused
// row or a row scrolled back into view; calm shows the final state with no preset class; twenty
// changes at once play at most MOTION_CAP gestures; a list row arrives once and leaves with a fade,
// while a filter never plays either. jsdom has no layout: sizes are stubbed as in ListEngine.test.tsx.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { setCalm } from '../../../design/motion';
import { MOTION_CAP, PRESETS, resetMotionMemory } from '../../../design/presets';
import { ListEngine, type ListFilter } from './ListEngine';
import { Amount, StateChip } from './rows';

type ChipDeal = Pick<Deal, 'state' | 'side' | 'kind'> & { id: string };
const deal = (id: string, state: Deal['state']): ChipDeal => ({ id, state, side: 'buyer', kind: 'purchase' });
const ADV = PRESETS.advanced.className;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => { resetMotionMemory(); });
afterEach(() => { cleanup(); setCalm(false); });

describe('StateChip', () => {
  it('does not animate on mount', () => {
    const { container } = render(<StateChip deal={deal('d1', 'AGREED')} />);
    expect(container.querySelector('.cs-state')).not.toBeNull();
    expect(container.querySelector(`.${ADV}`)).toBeNull();
  });

  it('animates once on a state change, and not again on a refetch with the same state', () => {
    const { container, rerender } = render(<StateChip deal={deal('d1', 'AGREED')} />);
    rerender(<StateChip deal={deal('d1', 'AGREED')} />);
    expect(container.querySelector(`.${ADV}`), 'a refetch with the same state').toBeNull();
    rerender(<StateChip deal={deal('d1', 'AUTHORIZED')} />);
    const chip = container.querySelector(`.${ADV}`);
    expect(chip, 'the change plays').not.toBeNull();
    // The refetch after the change keeps the same element (the gesture never restarts) ...
    rerender(<StateChip deal={deal('d1', 'AUTHORIZED')} />);
    expect(container.querySelector('.cs-state')).toBe(chip);
    // ... and a new instance of the same deal (a windowed row back in view) shows it settled.
    cleanup();
    const again = render(<StateChip deal={deal('d1', 'AUTHORIZED')} />);
    expect(again.container.querySelector(`.${ADV}`)).toBeNull();
  });

  it('never plays when the instance is reused for another deal', () => {
    const { container, rerender } = render(<StateChip deal={deal('d1', 'AGREED')} />);
    rerender(<StateChip deal={deal('d2', 'CAPTURED')} />);
    expect(container.querySelector(`.${ADV}`)).toBeNull();
  });

  it('under calm motion renders the final state with no animation class', () => {
    setCalm(true);
    const { container, rerender } = render(<StateChip deal={deal('d1', 'AGREED')} />);
    rerender(<StateChip deal={deal('d1', 'CAPTURED')} />);
    expect(container.querySelector(`.${ADV}`)).toBeNull();
    expect(container.querySelector('.cs-state')?.textContent).toBeTruthy();
    expect(container.querySelector('.cs-state')?.className).not.toMatch(/\bmo-/);
  });

  it('caps twenty changes at once to a handful of gestures', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `d${i}`);
    const List = ({ state }: { state: Deal['state'] }) => <>{ids.map((id) => <StateChip key={id} deal={deal(id, state)} />)}</>;
    const { container, rerender } = render(<List state="AGREED" />);
    rerender(<List state="AUTHORIZED" />);
    const played = container.querySelectorAll(`.${ADV}`).length;
    expect(played).toBeGreaterThan(0);
    expect(played).toBeLessThanOrEqual(MOTION_CAP);
    expect(container.querySelectorAll('.cs-state')).toHaveLength(20);
  });
});

describe('Amount', () => {
  const money = (minor: number) => ({ minor, currency: 'USD' as const });
  it('plays the change once with an id, never on mount, never without one', () => {
    const { container, rerender } = render(<Amount money={money(6400)} id="d1" />);
    expect(container.querySelector('.mo-changed')).toBeNull();
    rerender(<Amount money={money(6400)} id="d1" />);
    expect(container.querySelector('.mo-changed')).toBeNull();
    rerender(<Amount money={money(5900)} id="d1" />);
    expect(container.querySelector('.mo-changed')?.textContent).toMatch(/59\.00/);
    rerender(<Amount money={money(5000)} />);
    expect(container.querySelector('.mo-changed')).toBeNull();
  });
});

// ---- list rows -------------------------------------------------------------------------------------
type Row = { id: string; title: string; held: boolean };
const rowsOf = (n: number, from = 0): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i + from}`, title: `Monitor ${i + from}`, held: (i + from) % 2 === 0 }));
const VIEW = 600;
const ROW = 40;
const FILTERS: ListFilter<Row>[] = [{ value: 'held', label: 'On hold', test: (r) => r.held }];

const saved: { oh?: PropertyDescriptor; ow?: PropertyDescriptor; ro?: unknown } = {};
beforeAll(() => {
  saved.oh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  saved.ow = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get(this: HTMLElement) { return this.classList.contains('le-scroll') ? VIEW : ROW; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 900; } });
  saved.ro = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
afterAll(() => {
  if (saved.oh) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.oh);
  if (saved.ow) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.ow);
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = saved.ro;
});

function List({ rows }: { rows: Row[] }) {
  return <ListEngine<Row> label="Deals" rows={rows} getKey={(r) => r.id} filters={FILTERS} estimateSize={ROW} pageSize={0}
    renderRow={(r) => <span>{r.title}</span>} empty="No deals yet." />;
}
const rowOf = (id: string) => document.querySelector(`[data-fk="le-${id}"]`);
const scrollTo = async (top: number) => {
  const el = document.querySelector('.le-scroll') as HTMLElement;
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: top });
  await act(async () => { fireEvent.scroll(el); });
};

describe('windowed list rows', () => {
  it('play nothing on first mount', () => {
    render(<List rows={rowsOf(200)} />);
    expect(document.querySelector('.mo-arrived, .mo-left')).toBeNull();
  });

  it('play nothing when the first rows land after an empty first render (a read loading)', () => {
    const { rerender } = render(<List rows={[]} />);
    rerender(<List rows={rowsOf(5)} />);
    expect(document.querySelectorAll('.le-item').length).toBe(5);
    expect(document.querySelector('.mo-arrived')).toBeNull();
  });

  it('a new row arrives once; scrolled out and back it does not replay', async () => {
    const base = rowsOf(200);
    const { rerender } = render(<List rows={base} />);
    const fresh = { id: 'new', title: 'Monitor new', held: true };
    rerender(<List rows={[fresh, ...base]} />);
    expect(rowOf('new')?.classList.contains('mo-arrived')).toBe(true);
    expect(document.querySelectorAll('.mo-arrived')).toHaveLength(1);
    await sleep(320);
    await scrollTo(5000);
    expect(rowOf('new'), 'scrolled out of the window').toBeNull();
    await scrollTo(0);
    expect(rowOf('new'), 'back in view').not.toBeNull();
    expect(rowOf('new')?.classList.contains('mo-arrived')).toBe(false);
  });

  it('a removed row fades where it stood, then leaves; a filter plays nothing', async () => {
    const base = rowsOf(20);
    const { rerender, getByText } = render(<List rows={base} />);
    rerender(<List rows={base.filter((r) => r.id !== 'r3')} />);
    const gone = rowOf('r3') ?? document.querySelector('.mo-left');
    expect(document.querySelector('.mo-left')?.textContent).toBe('Monitor 3');
    expect(document.querySelector('.mo-left')?.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(gone).not.toBeNull();
    await act(async () => { await sleep(260); });
    expect(document.querySelector('.mo-left')).toBeNull();
    expect(document.body.textContent).not.toContain('Monitor 3');
    // A filter hides rows that are still in the list: no fade, no arrival when it is cleared.
    fireEvent.click(getByText('On hold'));
    expect(document.querySelector('.mo-left, .mo-arrived')).toBeNull();
  });

  it('under calm motion a row simply appears and simply goes', () => {
    setCalm(true);
    const base = rowsOf(20);
    const { rerender } = render(<List rows={base} />);
    rerender(<List rows={[{ id: 'new', title: 'Monitor new', held: true }, ...base.slice(1)]} />);
    expect(document.querySelector('.mo-arrived, .mo-left')).toBeNull();
    expect(document.body.textContent).not.toContain('Monitor 0');
  });
});
