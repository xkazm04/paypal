// The Counter layer on the mock worlds (rebuild WP3a): the summary and every nested view render on
// both worlds within the smoke checks; the order history is read only for the order that is open; a
// price change is a draft whose only way out is the approval window (`approval_open` with the
// mandate target and the floor as a pre-fill; never a sign); discard clears it; the words keep the rules.
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { COUNTER, COUNTER_VIEWS } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, type LayerRun } from '../../testing/scaleSmoke';
import { wordsOf } from '../tables/wordsOf';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

const reads = (r: LayerRun, cmd: string) => r.calls.filter((c) => c.cmd === cmd).length;

describe('Counter at scale', () => {
  it.each(['small', 'large'] as const)('summary on the %s world', async (scale) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'counter' }, scale);
    expect(r.layer.dataset.layer).toBe('counter');
    expectLayerHealthy(r);
    expect(r.layer.querySelectorAll('.ml-cards .ui-sumcard').length).toBe(4);
    expect(reads(r, 'deal_transcript')).toBe(0);
  }, 60_000);

  it.each(['orders', 'prices', 'rules', 'earlier'] as const)('the %s view on the busy world', async (view) => {
    const r = await renderLayerAtScale({ level: 'module', module: 'counter', view }, 'large');
    expectLayerHealthy(r);
    expect(r.layer.querySelector('h1')?.textContent).toBe(COUNTER_VIEWS[view]);
    expect(reads(r, 'deal_transcript')).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe('Counter flows', () => {
  it('a new lowest price is a draft that only the approval window signs', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'counter', view: 'prices' }, 'small');
    const raise = r.layer.querySelector<HTMLButtonElement>(`button[aria-label="${COUNTER.raise}"]`);
    act(() => { raise?.click(); });
    await waitFor(() => expect(r.layer.querySelector('.ctr-tray.on')?.textContent).toContain(COUNTER.unsigned));
    const sign = r.layer.querySelector<HTMLButtonElement>('.ctr-tray .ui-btn.gold');
    expect(sign?.textContent).toContain(COUNTER.reviewSign);
    fireEvent.click(sign as HTMLElement);
    await waitFor(() => expect(r.calls.filter((c) => c.cmd === 'approval_open')).toHaveLength(1));
    const args = r.calls.find((c) => c.cmd === 'approval_open')?.args as { deal_id: null; target: string; draft?: { type: string; floor: { minor: number } } };
    expect(args.deal_id).toBeNull();
    expect(args.target).toBe('mandate');
    expect(args.draft?.type).toBe('floor');
    expect(Number.isSafeInteger(args.draft?.floor.minor)).toBe(true);
    // Nothing but reads and the hand-off was sent.
    expect(r.calls.filter((c) => /sign|band_set|mandate_/.test(c.cmd) && c.cmd !== 'mandate_list')).toEqual([]);
    // Discard clears the draft; the tray says the rules are in force again.
    const discard = [...r.layer.querySelectorAll<HTMLButtonElement>('.ctr-tray .ui-btn')].find((b) => b.textContent === COUNTER.discard);
    act(() => { discard?.click(); });
    await waitFor(() => expect(r.layer.querySelector('.ctr-tray.on')).toBeNull());
  }, 60_000);

  it('picking an order shows it with what happens if nobody acts', async () => {
    const r = await renderLayerAtScale({ level: 'module', module: 'counter', view: 'orders' }, 'large');
    const rows = [...r.layer.querySelectorAll<HTMLButtonElement>('.tr-list .le-row')];
    const last = rows[rows.length - 1];
    act(() => { last?.click(); });
    await waitFor(() => expect(r.layer.querySelector('.tr-pane')?.textContent).toMatch(new RegExp(COUNTER.ifNothing)));
    expect(reads(r, 'deal_transcript')).toBeLessThanOrEqual(4);
  }, 60_000);
});

describe('Counter words', () => {
  it('never name a vendor other than PayPal, an engine, a raw state or an id', () => {
    for (const w of [...wordsOf(COUNTER), ...wordsOf(COUNTER_VIEWS)]) {
      expect(w).not.toMatch(/claude|codex|openai|anthropic|gpt/i);
      expect(w).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+\b|D-\d{4}|mandate|clause|_set\b/);
    }
    expect(COUNTER_VIEWS.earlier).not.toMatch(/week/i);
  });
});
