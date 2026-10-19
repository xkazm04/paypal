// Acceptance H1, the client half: when an agent's step is refused (the MCP side proves the wire
// error and zero PayPal rows), the deal page says so in the owner's words, offers no money
// action, and shows no PayPal record for the deal. Mounted on Maya's preview wallet, whose
// haggling agent was refused on a monitor deal before PayPal was asked.
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName } from '../../../../../lib/contract';
import { DEAL_CARD, DEAL_DECIDED, DEAL_PROOF } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

/** The deal whose agent was refused and that never reached PayPal. */
async function refusedDeal(w: Backend) {
  for (const d of await w.invoke('list_deals', null)) {
    if (d.paypal.order || d.paypal.authorization || d.paypal.capture || d.paypal.subscription) continue;
    const { steps } = await w.invoke('deal_history', { deal_id: d.id });
    if (steps.some((s) => s.kind === 'intent_refused')) return { id: d.id, steps };
  }
  throw new Error('the preview wallet has no refused agent step');
}
const card = (layer: HTMLElement, label: string) => {
  const c = [...layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
  if (!c) throw new Error(`no card ${label}`);
  return c;
};
/** Every way the app words a money step: a PayPal hand-off, a countersign, a capture, a void, an approval. */
const MONEY = /paypal >|open paypal|countersign|capture|void|approve|pay now|release/i;

describe('a refused agent step on the deal page', () => {
  it('is shown in the owner’s words, with no money control and no PayPal record', async () => {
    let refused!: Awaited<ReturnType<typeof refusedDeal>>;
    const r = await renderLayerAtScale(async (w) => { refused = await refusedDeal(w); return { level: 'deal', deal: refused.id }; }, null);

    // 1. The refusal, in plain words (the story view's "who decided" record).
    fireEvent.click(card(r.layer, DEAL_CARD.story));
    const who = await waitFor(() => { const s = r.layer.querySelector<HTMLElement>('.dv-who-decided li.t-refused'); if (!s) throw new Error('no refusal row'); return s; });
    await settle();
    const rows = [...r.layer.querySelectorAll<HTMLElement>('.dv-who-decided li.t-refused')];
    expect(rows).toHaveLength(refused.steps.filter((s) => s.kind === 'intent_refused').length);
    expect(who.querySelector('.say')?.textContent).toMatch(/^Your rules stopped your agent on .+\. PayPal was never asked\.$/);
    expect(who.querySelector('.by')?.textContent).toBe(DEAL_DECIDED.refused);
    expect(r.errors).toEqual([]);

    // 2. No money control anywhere on the page, and nothing but reads was sent.
    const controls = [...r.layer.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')];
    expect(controls.filter((c) => MONEY.test(`${c.textContent} ${c.getAttribute('aria-label') ?? ''}`)).map((c) => c.textContent)).toEqual([]);
    const acts = r.calls.filter((c) => AUTHORITY[c.cmd as CommandName]?.tier !== 'read');
    expect(acts).toEqual([]);

    // 3. No PayPal row: the card says nothing is there, and so does the proof view.
    expect(refused.steps.every((s) => s.paypal.type === 'none')).toBe(true);
    expect(card(r.layer, DEAL_CARD.proof).textContent).toContain(DEAL_CARD.proofNone);
    fireEvent.click(card(r.layer, DEAL_CARD.proof));
    await waitFor(() => expect(r.layer.querySelector('.dv-proof')).not.toBeNull());
    await settle();
    expect(r.layer.textContent).toContain(DEAL_PROOF.nothingSent);
    expect(r.layer.querySelectorAll('.dv-proof table')).toHaveLength(0);
  }, 60_000);
});
