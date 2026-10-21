// The deal page (rebuild WP3c): its heading is the deal's title, the decision hands off to the
// approval window and calls nothing else, each card opens its view on the same sheet and that view
// reads its own record only when it opens (scale finding #17), Escape closes the view first and
// then goes a layer up, and nothing on the page names a raw state or id.
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName } from '../../../../../lib/contract';
import { DEAL_CARD } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

/** A deal that waits for the owner's review, in the world's own order. */
const reviewDeal = async (w: Backend) => {
  const items = (await w.invoke('attention_list', null)).items;
  const it = items.find((i) => i.actions.includes('review'));
  return { level: 'deal' as const, deal: it?.deal_id ?? 'none' };
};
/** A live deal PayPal has no record of yet (nothing to prove). */
const freshDeal = async (w: Backend) => {
  const deals = await w.invoke('list_deals', null);
  const d = deals.find((x) => !x.paypal.order && !x.paypal.authorization && !x.paypal.capture && !x.paypal.subscription && ['LISTED', 'NEGOTIATING', 'PAIRING', 'AGREED', 'AWAITING_APPROVAL'].includes(x.state));
  return { level: 'deal' as const, deal: d?.id ?? 'none' };
};
const card = (layer: HTMLElement, label: string) => {
  const c = [...layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
  if (!c) throw new Error(`no card ${label}`);
  return c;
};
const readsOf = (calls: { cmd: string; args: unknown }[], cmd: string, id: string) => calls.filter((c) => c.cmd === cmd && (c.args as { deal_id?: string } | null)?.deal_id === id).length;

describe('the deal page', () => {
  it('the gold decision opens the approval window for that deal and calls nothing else', async () => {
    const r = await renderLayerAtScale(reviewDeal, 'large');
    expectLayerHealthy(r);
    const id = new URLSearchParams(location.hash.slice(1)).get('d') ?? '';
    const gold = r.layer.querySelector<HTMLButtonElement>('.dc-opt.gold');
    expect(gold).not.toBeNull();
    expect(r.layer.textContent).toContain('If you do nothing');
    const before = r.calls.length;
    fireEvent.click(gold as HTMLButtonElement);
    await settle();
    const sent = r.calls.slice(before).filter((c) => AUTHORITY[c.cmd as CommandName]?.tier !== 'read');
    expect(sent).toEqual([{ cmd: 'approval_open', args: { deal_id: id } }]);
  }, 60_000);

  it('reads each view’s record only when its card opens it', async () => {
    const r = await renderLayerAtScale(freshDeal, 'large');
    const id = new URLSearchParams(location.hash.slice(1)).get('d') ?? '';
    expect(id).not.toBe('none');
    // on open: the conversation and the rules, never the proof or the record of a deal PayPal has nothing for
    expect(readsOf(r.calls, 'deal_transcript', id)).toBe(1);
    expect(readsOf(r.calls, 'deal_evidence', id)).toBe(0);
    expect(readsOf(r.calls, 'deal_history', id)).toBe(0);
    fireEvent.click(card(r.layer, DEAL_CARD.proof));
    await waitFor(() => expect(r.layer.querySelector('.dv-proof')).not.toBeNull());
    await settle();
    expect(readsOf(r.calls, 'deal_evidence', id)).toBe(1);
    expect(readsOf(r.calls, 'deal_history', id)).toBe(0);
    fireEvent.click(card(r.layer, DEAL_CARD.story));
    await waitFor(() => expect(r.layer.querySelector('.dv-who-decided')).not.toBeNull());
    await settle();
    expect(readsOf(r.calls, 'deal_history', id)).toBe(1);
    expectLayerHealthy(r);
  }, 60_000);

  it('names the house seller as a name, never as the shout HOUSE, on the page, its story and its record', async () => {
    const houseDeal = async (w: Backend) => {
      const house = (await w.invoke('counterparty_list', null)).find((c) => c.house);
      const d = (await w.invoke('list_deals', null)).find((x) => x.counterparty === house?.key_id && x.kind === 'haggle' && x.state === 'NEGOTIATING');
      return { level: 'deal' as const, deal: d?.id ?? 'none' };
    };
    const r = await renderLayerAtScale(houseDeal, null);
    const SHOUT = /\bHOUSE\b/;
    expect(r.layer.textContent).toContain('House seller');
    expect(r.layer.textContent ?? '').not.toMatch(SHOUT);
    fireEvent.click(card(r.layer, DEAL_CARD.story));
    await waitFor(() => expect(r.layer.querySelector('.dv-chat .msg')).not.toBeNull());
    await settle();
    const labels = [...r.layer.querySelectorAll('.dv-chat .bub')].map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((l) => l.startsWith('House seller '))).toBe(true);
    expect(`${r.layer.textContent} ${labels.join(' ')}`).not.toMatch(SHOUT);
  }, 60_000);

  it('Escape closes an open view first, then goes one layer up', async () => {
    const r = await renderLayerAtScale(freshDeal, 'large');
    const c = card(r.layer, DEAL_CARD.who);
    fireEvent.click(c);
    await waitFor(() => expect(document.activeElement?.hasAttribute('data-view-title')).toBe(true));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    await waitFor(() => expect(r.layer.querySelector('.pf-view')).toBeNull());
    expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).toBe('deal');
    await waitFor(() => expect(document.activeElement).toBe(card(document.querySelector('.cs-layer') as HTMLElement, DEAL_CARD.who)));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.querySelector('.cs-layer')?.getAttribute('data-layer')).not.toBe('deal'));
  }, 60_000);
});
