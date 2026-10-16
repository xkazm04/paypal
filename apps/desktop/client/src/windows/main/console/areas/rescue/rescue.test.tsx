// The Rescue layer on the mock world (rebuild WP3b): the decision is on the summary (Your call, the
// first failed renewal named, what happens if you do nothing, one gold hand-off that only opens the
// approval window on it); the renewals are a windowed list, never a page-long dump (#12); the fix
// picked beside the list travels to the approval window as a draft; replaying a renewal and the
// watch list hand off to the approval window too; recovered money is the wallet's own figure.
import { act, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatMinor } from '../../../../../lib/format';
import { IF_NOTHING, RESCUE, RESCUE_VIEWS_TITLE, YOUR_CALL } from '../../../../../lib/words';
import { mockBackend } from '../../../../../mock/backend';
import { splitRows } from '../../../modules/rescue/model';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

async function failing() {
  const w = mockBackend('main');
  const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
  const byId = new Map(att.items.map((n) => [n.deal_id, n] as const));
  return splitRows(deals, (d) => byId.get(d.id)?.deadline ?? null).failing.filter((d) => byId.has(d.id));
}

describe('Rescue summary', () => {
  it.each(['small', 'large'] as const)('draws the answer and four cards (%s)', async (scale) => {
    const r = await renderLayerAtScale('#m=rescue', scale);
    expectLayerHealthy(r);
    expect(r.layer.querySelectorAll('.ml-cards .ui-sumcard')).toHaveLength(4);
  }, 60_000);

  it('carries the first decision: Your call, the default, and one gold hand-off', async () => {
    const r = await renderLayerAtScale('#m=rescue', 'large');
    const fails = await failing();
    expect(fails.length).toBeGreaterThan(1);
    expect(r.layer.querySelector('.ml-call')?.textContent).toContain(YOUR_CALL);
    expect(r.layer.querySelector('.ml-silence')?.textContent).toContain(IF_NOTHING);
    expect(r.layer.querySelector('[data-card="failed"]')?.textContent).toContain(IF_NOTHING);
    const gold = r.layer.querySelectorAll('.ml-head .ui-btn.gold');
    expect(gold).toHaveLength(1);
    await act(async () => { fireEvent.click(gold[0] as HTMLElement); });
    expect(r.calls.filter((c) => c.cmd === 'approval_open')).toEqual([{ cmd: 'approval_open', args: { deal_id: fails[0]?.id } }]);
    expectLayerHealthy(r);
  }, 60_000);
});

describe('Rescue lists (#12)', () => {
  it.each(['failed', 'progress', 'recovered', 'compare'])('%s is a windowed list', async (v) => {
    const r = await renderLayerAtScale(`#m=rescue&v=${v}`, 'large');
    expectLayerHealthy(r);
    expect(r.layer.querySelectorAll('.le-item').length).toBeLessThan(60);
  }, 60_000);

  it('the fix picked beside the list travels to the approval window as a draft', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=rescue&v=failed', 'large');
    await act(async () => { fireEvent.click(r.layer.querySelector('.le-row') as HTMLElement); });
    const panel = await waitFor(() => { const p = r.layer.querySelector<HTMLElement>('.rs-panel'); if (!p) throw new Error('no panel'); return p; });
    // "Do nothing" is picked at the start: silence never moves money.
    expect(within(panel).getByRole('radio', { name: new RegExp(RESCUE.doNothing) }).getAttribute('aria-checked')).toBe('true');
    const discount = within(panel).queryByRole('radio', { name: new RegExp(RESCUE.pick.DISCOUNT_THIS_CYCLE.name) });
    expect(discount, 'the large world offers a discount on its first renewal').not.toBeNull();
    if (discount && !(discount as HTMLButtonElement).disabled) {
      await act(async () => { fireEvent.click(discount); });
      await act(async () => { fireEvent.click(panel.querySelector('.ui-btn.gold') as HTMLElement); });
      const open = r.calls.filter((c) => c.cmd === 'approval_open').at(-1);
      expect(open?.args).toMatchObject({ target: 'deal', draft: { type: 'lever', lever: 'DISCOUNT_THIS_CYCLE' } });
    }
    expectLayerHealthy(r);
  }, 60_000);
});

describe('Rescue hand-offs', () => {
  it('replaying a renewal and the watch list open the approval window, nothing else', async () => {
    const r = await renderLayerAtScale('#m=rescue&v=failed', 'large');
    await act(async () => { fireEvent.click(within(r.layer).getByRole('button', { name: new RegExp(RESCUE.replay) })); });
    expect(r.calls.filter((c) => c.cmd === 'approval_open').at(-1)?.args).toEqual({ deal_id: null, target: 'rescue' });
    cleanup();
    const w = await renderLayerAtScale('#m=rescue&v=watch', 'large');
    await act(async () => { fireEvent.click(within(w.layer).getByRole('button', { name: new RegExp(`${RESCUE.watch.manage}|${RESCUE.watch.add}`) })); });
    expect(w.calls.filter((c) => c.cmd === 'approval_open').at(-1)?.args).toEqual({ deal_id: null, target: 'rescue_watch' });
    expectLayerHealthy(w);
  }, 60_000);

  it('recovered money is the wallet’s own figure', async () => {
    const r = await renderLayerAtScale('#m=rescue&v=recovered', 'large');
    await settle();
    const book = await mockBackend('main').invoke('rescue_book', null);
    const total = book.recovered.map((m) => formatMinor(m.minor, m.currency)).join(' · ');
    expect(r.layer.querySelector('.rs-total')?.textContent).toContain(total || RESCUE.recovered.noneYet);
    expect(document.querySelector('.cs-layer [data-layer-title]')?.textContent).toBe(RESCUE_VIEWS_TITLE.recovered);
  }, 60_000);
});
