// B6: the Tumbler's announcements and holds are reachable without colour, a mouse or luck of timing.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { TickerForm } from './forms';
import { PuckArt } from './Puck';
import { Tumbler } from './Tumbler';
import { puckName, tickerSpeech, TICKER_MS, cardKeys } from './logic';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);
afterEach(() => { cleanup(); setHarnessBackend(null); });

const t = { key: 'k', kind: 'gate', l1: ['Countersign ', '$329.00', ''], l2: 'Dan · until 18:00', mode: 'sandbox', dealId: null, ms: 8000 } as const;

describe('ticker hold and speech', () => {
  it('hover and focus ask the page to hold; leaving releases', () => {
    const onHold = vi.fn();
    const { container } = render(<TickerForm ticker={t} onOpen={() => {}} onHold={onHold} />);
    const el = container.querySelector('.f.ticker')!;
    fireEvent.mouseEnter(el); fireEvent.mouseLeave(el); fireEvent.focus(el); fireEvent.blur(el);
    expect(onHold.mock.calls.map((c) => c[0])).toEqual([true, false, true, false]);
    expect(el.getAttribute('aria-label')).toContain('Countersign $329.00. Dan · until 18:00');
    expect(el.getAttribute('role')).toBe('button');
  });
  it('speech joins both lines; messages stay long enough to read', () => {
    expect(tickerSpeech(t)).toBe('Countersign $329.00. Dan · until 18:00');
    expect(TICKER_MS.info).toBeGreaterThanOrEqual(5000);
  });
});

describe('hold vs decision without colour', () => {
  const it0 = { deal_id: 'a', module: 'market', kind: 'gate' } as never;
  it('the puck draws a hold as a diamond and a decision as a circle', () => {
    const look = { needs: 2, ring: 'gold', urgency: 'calm', breathe: false, opacity: 100 } as never;
    const items = [it0, { deal_id: 'b', module: 'market', kind: 'hold' }] as never;
    const { container } = render(<PuckArt look={look} items={items} newIds={new Set()} inMotion={0} mode={null} locked={false} handoff={false} />);
    expect(container.querySelector('circle.bead.gate')).not.toBeNull();
    expect(container.querySelector('rect.bead.hold')).not.toBeNull();
  });
  it('the puck name says which is which', () => {
    expect(puckName({ needs: 3, holds: 1, headline: null, inMotion: 0, mode: null, locked: false })).toContain('(2 to decide, 1 paused)');
    expect(puckName({ needs: 1, holds: 1, headline: null, inMotion: 0, mode: null, locked: false })).toContain('(paused, nothing to pay)');
  });
  it('S is named only when snooze is allowed', () => {
    const gate = { kind: 'gate', actions: ['review', 'withdraw', 'snooze30'], deadline: 10_000_000 } as never;
    expect(cardKeys(gate, 0)).toContain('S snoozes');
    expect(cardKeys(gate, 9_999_000)).not.toContain('S snoozes');
    expect(cardKeys(gate)).not.toContain('S snoozes');
  });
});

describe('persistent live region', () => {
  it('is in the first paint, before any news', () => {
    resetMockState();
    setHarnessBackend(mockBackend('tumbler'));
    const { container } = render(<Tumbler />);
    const live = container.querySelector('.sr-only[role="status"][aria-live="polite"]');
    expect(live).not.toBeNull();
    act(() => {});
  });
});
