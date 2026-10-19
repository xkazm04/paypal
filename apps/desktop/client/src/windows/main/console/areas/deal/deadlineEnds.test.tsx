// Acceptance W6 and F3, the client half: a deadline that passes voids the hold once, and a lapse
// never calls PayPal (the Rust side proves the one confirmed void and the idempotent tick). This
// mounts the real deal page on Maya's preview wallet for a deal that ended AUTO_VOIDED (the power
// supply's hold ran out) and one that LAPSED (the monitor nobody approved in time): the owner's
// words say what happened, the page has no money control, and the story shows exactly one void
// step for the first and none for the second.
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName } from '../../../../../lib/contract';
import { DEAL_CARD, DEAL_DECIDED, stateWord } from '../../../../../lib/words';
import { renderLayerAtScale, settle } from '../../testing/scaleSmoke';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

/** The deal whose hold ran out, or the one a deadline lapsed. */
async function endedDeal(w: Backend, how: 'AUTO_VOIDED' | 'LAPSED') {
  for (const d of await w.invoke('list_deals', null)) {
    if (how === 'AUTO_VOIDED' ? d.state === 'AUTO_VOIDED' : d.state === 'WITHDRAWN' && d.decided_by?.type === 'safe_default') return d.id;
  }
  throw new Error(`the preview wallet has no ${how} deal`);
}
const card = (layer: HTMLElement, label: string) => {
  const c = [...layer.querySelectorAll<HTMLButtonElement>('button.pf-card')].find((b) => b.querySelector('.sc-label')?.textContent?.startsWith(label));
  if (!c) throw new Error(`no card ${label}`);
  return c;
};
/** Every way the app words a money step: a PayPal hand-off, a countersign, a capture, a release, an approval. */
const MONEY = /paypal >|open paypal|countersign|capture|void|approve|pay now|release/i;

async function openEnded(how: 'AUTO_VOIDED' | 'LAPSED') {
  const r = await renderLayerAtScale(async (w) => ({ level: 'deal', deal: await endedDeal(w, how) }), null);
  await settle();
  fireEvent.click(card(r.layer, DEAL_CARD.story));
  await waitFor(() => { if (!r.layer.querySelector('.dv-who-decided li')) throw new Error('no story rows'); });
  await settle();
  const rows = [...r.layer.querySelectorAll<HTMLElement>('.dv-who-decided li')];
  // No money control anywhere on the page (the closed banner says so), and nothing but reads was sent.
  const controls = [...r.layer.querySelectorAll<HTMLElement>('button, a[href], [role="button"]')];
  const money = controls.filter((c) => MONEY.test(`${c.textContent} ${c.getAttribute('aria-label') ?? ''}`)).map((c) => c.textContent);
  const acts = r.calls.filter((c) => AUTHORITY[c.cmd as CommandName]?.tier !== 'read');
  return { r, rows, money, acts };
}

describe('a deadline that passes, on the deal page', () => {
  it('a hold that ran out says so once, with one void step and no money control', async () => {
    const { r, rows, money, acts } = await openEnded('AUTO_VOIDED');
    const word = stateWord('AUTO_VOIDED');
    const page = r.layer.textContent ?? '';
    expect(page).toContain(word.text);
    expect(page).toContain(word.means);
    expect(page).toContain('This deal is closed. Nothing here can move money.');
    // Exactly one step is the deadline's void: the safe default's own row, naming the PayPal call.
    const voids = rows.filter((li) => li.classList.contains('t-default'));
    expect(voids).toHaveLength(1);
    expect(voids[0]!.querySelector('.say')?.textContent).toBe('The hold on Spare 65 W power supply ran out and released itself. Nothing was paid.');
    expect(voids[0]!.querySelector('.by')?.textContent).toBe(`The safe default · ${DEAL_DECIDED.call}`);
    expect(rows.filter((li) => /released itself/.test(li.textContent ?? ''))).toHaveLength(1);
    expect(money).toEqual([]);
    expect(acts).toEqual([]);
    expect(r.errors).toEqual([]);
  }, 60_000);

  it('a lapse says nobody acted in time, with no PayPal call and no money control', async () => {
    const { r, rows, money, acts } = await openEnded('LAPSED');
    const page = r.layer.textContent ?? '';
    expect(page).toContain('Nobody acted before the deadline, so it ended. No money moved.');
    expect(page).toContain('This deal is closed. Nothing here can move money.');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('.say')?.textContent).toBe('Nobody acted on Refurbished 27-inch QHD monitor in time, so it lapsed. No money moved.');
    expect(rows[0]!.querySelector('.by')?.textContent).toBe(`The safe default · ${DEAL_DECIDED.noCall}`);
    // The lapse is not a void: no step is worded as a release, and PayPal holds nothing for this deal.
    expect(rows.some((li) => /released itself|(?<!no )PayPal call/.test(li.textContent ?? ''))).toBe(false);
    expect(page).toContain(DEAL_CARD.proofNone);
    expect(money).toEqual([]);
    expect(acts).toEqual([]);
    expect(r.errors).toEqual([]);
  }, 60_000);
});
