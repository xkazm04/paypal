// The Shield layer on the mock world (rebuild WP3b): the summary at both scales carries the
// decision (Your call, what happens if you do nothing, one gold hand-off that opens the approval
// window on the first paused payment and calls nothing else); locked, it carries the lock and says
// so; the checks side by side are rows with a fixed set of columns however many payees there are
// (#13), windowed and filterable; the picked payment's story reads their note only when asked.
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Backend } from '../../../../../lib/contract';
import { APPROVAL_LOCKED_TITLE, IF_NOTHING, SHIELD, SHIELD_VIEWS_TITLE, YOUR_CALL } from '../../../../../lib/words';
import { wordsOf } from '../tables/wordsOf';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { App } from '../../../App';
import { setHarnessBackend } from '../../testing/runtime';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { shieldSets } from './model';
import { needFor } from './model';
import { moduleOf } from '../../../logic';
import { releaseCase } from '../../../modules/shield/matrix';
import { ToastProvider } from '../../../../../shared/ui';
import { PausedDecision, ReleaseHandoff, type ShieldWorld } from './parts';

const bare = vi.hoisted(() => ({ on: false }));
vi.mock('../../../world', async (orig) => {
  const w = await orig<typeof import('../../../world')>();
  return { ...w, useLocked: () => (bare.on ? false : w.useLocked()) };
});
vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 }); });

async function paused(): Promise<string[]> {
  const w = mockBackend('main');
  const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
  const byId = new Map(att.items.map((n) => [n.deal_id, n] as const));
  return shieldSets(deals, (d) => moduleOf(d, byId.get(d.id)), (id) => byId.get(id)).paused.map((d) => d.id);
}

describe('Shield summary', () => {
  it.each(['small', 'large'] as const)('answers in one line, cards open the lists (%s)', async (scale) => {
    const r = await renderLayerAtScale('#m=shield', scale);
    expectLayerHealthy(r);
    expect(r.layer.querySelectorAll('.ml-cards .ui-sumcard')).toHaveLength(4);
  }, 60_000);

  it('carries the decision: Your call, the default, and one gold hand-off to the approval window', async () => {
    const r = await renderLayerAtScale('#m=shield', 'large');
    const ids = await paused();
    expect(ids.length).toBeGreaterThan(0);
    const call = r.layer.querySelector('.ml-call');
    expect(call?.textContent).toContain(YOUR_CALL);
    expect(call?.textContent).toContain(String(ids.length));
    expect(r.layer.querySelector('.ml-silence')?.textContent).toContain(IF_NOTHING);
    const gold = r.layer.querySelectorAll('.ml-head .ui-btn.gold');
    expect(gold).toHaveLength(1);
    await act(async () => { fireEvent.click(gold[0] as HTMLElement); });
    const opens = r.calls.filter((c) => c.cmd === 'approval_open');
    expect(opens).toEqual([{ cmd: 'approval_open', args: { deal_id: ids[0] } }]);
    expectLayerHealthy(r);
  }, 60_000);

  it('Your call opens the paused payments, each one a row', async () => {
    const r = await renderLayerAtScale('#m=shield', 'large');
    await act(async () => { fireEvent.click(r.layer.querySelector('.ml-call') as HTMLElement); });
    await waitFor(() => expect(document.querySelector('.cs-layer [data-layer-title]')?.textContent).toBe(SHIELD_VIEWS_TITLE.paused));
    await settle();
    expect(document.querySelectorAll('.cs-layer .le-item').length).toBe((await paused()).length);
  }, 60_000);
});

describe('Shield, locked', () => {
  it('the hand-off carries the lock and says so', async () => {
    await renderLayerAtScale('#m=centre', 'small'); // sizes jsdom for the windowed lists
    cleanup();
    history.replaceState(null, '', '/index.html?scale=large&locked=1#m=shield');
    resetMockState();
    const real = mockBackend('main');
    const calls: string[] = [];
    const wrapped: Backend = { kind: real.kind, label: real.label, listen: real.listen, invoke: async (cmd, args, o) => { calls.push(cmd); if (cmd === 'approval_open') return null as never; return real.invoke(cmd, args, o); } };
    setHarnessBackend(wrapped);
    render(<App />);
    const gold = await waitFor(() => { const b = document.querySelector<HTMLElement>('.cs-layer .ml-head .ui-btn.gold'); if (!b) throw new Error('no hand-off yet'); return b; });
    expect(gold.classList.contains('locked')).toBe(true);
    expect(gold.title).toBe(APPROVAL_LOCKED_TITLE);
  }, 60_000);
});

describe('Shield checks, side by side (#13)', () => {
  it('one row per payment and the same columns whatever the number of payees', async () => {
    const r = await renderLayerAtScale('#m=shield&v=week', 'large');
    expectLayerHealthy(r);
    const rows = [...r.layer.querySelectorAll('.sh-crow')];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.children).toHaveLength(7);
    // Everything checked is one switch away, still windowed.
    fireEvent.click(within(r.layer).getByRole('button', { name: SHIELD.scope.all }));
    await settle();
    expect(r.rows()).toBeLessThanOrEqual(250);
  }, 60_000);

  it('a wide window shows the picked payment beside the list; their note is read only when opened', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1600 });
    const r = await renderLayerAtScale('#m=shield&v=week', 'large');
    await act(async () => { fireEvent.click(r.layer.querySelector('.le-row') as HTMLElement); });
    const story = await waitFor(() => { const s = r.layer.querySelector<HTMLElement>('.sh-story'); if (!s) throw new Error('no story'); return s; });
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'counterparty_note')).toHaveLength(0);
    const details = story.querySelector('details.sh-note') as HTMLDetailsElement;
    details.open = true;
    await act(async () => { details.dispatchEvent(new Event('toggle')); });
    await settle();
    expect(r.calls.filter((c) => c.cmd === 'counterparty_note')).toHaveLength(1);
    expectLayerHealthy(r);
  }, 60_000);
});

describe('Shield model', () => {
  it('a released hold is let through, never also stopped', async () => {
    const w = mockBackend('main');
    const [deals, att] = await Promise.all([w.invoke('list_deals', null), w.invoke('attention_list', null)]);
    const byId = new Map(att.items.map((n) => [n.deal_id, n] as const));
    const s = shieldSets(deals, (d) => moduleOf(d, byId.get(d.id)), (id) => byId.get(id));
    const stopped = new Set(s.stopped.map((d) => d.id));
    expect(s.released.filter((d) => stopped.has(d.id))).toEqual([]);
    for (const d of s.paused) expect(needFor(d, byId.get(d.id))).toBeDefined();
  });
});

describe('Shield model, a payment the shield asked about', () => {
  const NONE: Deal['paypal'] = { order: null, authorization: null, capture: null, subscription: null };
  const usd = { minor: 12000, currency: 'USD' as const };
  const ask = (id: string, state: Deal['state'], paypal = NONE): Deal => ({
    id, kind: 'purchase', side: 'buyer', counterparty: 'K', state, mandate_id: 'M', mandate_version: 1,
    transcript_head: [] as unknown as Deal['transcript_head'], paypal, mode: 'sandbox', market: null,
    shield: 'ASK', shield_rule: 'new_counterparty_over_threshold',
    terms: { item_ref: 'x', qty: 1, unit_price: usd, currency: 'USD', delivery: { type: 'digital_now' } },
  });
  it('is stopped only when it ended unpaid; one still going or paid is not "stopped for your safety"', () => {
    const live = ask('live', 'AWAITING_APPROVAL', { ...NONE, order: 'O' });
    const paid = ask('paid', 'CAPTURED', { ...NONE, order: 'O', capture: 'C' });
    const ended = ask('ended', 'EXPIRED');
    // An ASK waits in the module that owns the purchase (Spend), not in the shield's queue.
    const need = { module: 'spend' } as unknown as AttentionItem;
    const s = shieldSets([live, paid, ended], () => 'spend', (id) => (id === 'live' ? need : undefined));
    expect(s.checked.map((d) => d.id)).toEqual(['live', 'paid', 'ended']);
    expect(s.stopped.map((d) => d.id)).toEqual(['ended']);
  });
});

describe('Shield panel words', () => {
  it('say nothing a vendor, an id or a raw state would: every panel string comes from the words file', () => {
    for (const w of wordsOf(SHIELD)) {
      expect(w).not.toMatch(/claude|codex|openai|anthropic|gpt/i);
      expect(w).not.toMatch(/[A-Z]{3,}_[A-Z_]+|D-\d{4}|mandate|clause|_set/);
    }
  });
  it('keeps no user-facing text inline in the round-2 panels file', () => {
    const src = readFileSync(join(process.cwd(), 'src/windows/main/modules/shield/Panels.tsx'), 'utf8');
    const jsxText = [...src.matchAll(/>([^<>{}\n]*[A-Za-z][^<>{}\n]*)</g)].map((m) => m[1]!.trim()).filter(Boolean);
    const quotedAttrs = [...src.matchAll(/\b(?:aria-label|title|label|sub)="([^"]+)"/g)].map((m) => m[1]);
    expect([...jsxText, ...quotedAttrs]).toEqual([]);
  });
});

// What a release tells the owner, per deal (shield-screening, council r3 VALUE): the seller mandate
// takes the money on a released hold once the buyer has approved, so "you still approve on PayPal
// after" is true only for a buyer deal.
describe('Release words, per deal case', () => {
  // The parts are rendered bare (no world): the unlocked hand-off is what is under test.
  beforeAll(() => { bare.on = true; });
  afterAll(() => { bare.on = false; });
  const NONE: Deal['paypal'] = { order: null, authorization: null, capture: null, subscription: null };
  const hold = (side: Deal['side'], state: Deal['state']): Deal => ({
    id: `H-${side}-${state}`, kind: 'purchase', side, counterparty: 'K', state, mandate_id: 'M', mandate_version: 1,
    transcript_head: [] as unknown as Deal['transcript_head'], paypal: NONE, mode: 'sandbox', market: null,
    shield: 'HOLD', shield_rule: 'price_over_market',
    terms: { item_ref: 'x', qty: 1, unit_price: { minor: 12000, currency: 'USD' as const }, currency: 'USD', delivery: { type: 'digital_now' } },
  });
  const need = { deal_id: 'x', module: 'shield', actions: ['review'], headline: 'h', on_silence: 's', deadline: null } as unknown as AttentionItem;
  const CASES = [
    ['buyer', hold('buyer', 'AGREED'), 'buyer'],
    ['seller approved', hold('seller', 'APPROVED'), 'seller-approved'],
    ['seller authorized', hold('seller', 'AUTHORIZED'), 'seller-approved'],
    ['seller negotiating', hold('seller', 'NEGOTIATING'), 'seller-waiting'],
    ['seller agreed', hold('seller', 'AGREED'), 'seller-waiting'],
  ] as const;
  const CLAIM = 'approve the payment on PayPal after';

  it('the case table', () => {
    for (const [, d, c] of CASES) expect(releaseCase(d)).toBe(c);
  });

  it('the words never claim a PayPal step after the release on a seller deal, and no word has a dash', () => {
    for (const k of ['seller-approved', 'seller-waiting'] as const) {
      expect(SHIELD.releaseMeans[k]).not.toContain(CLAIM);
      expect(SHIELD.opened[k]).not.toMatch(/you still approve/i);
    }
    expect(SHIELD.releaseMeans.buyer).toContain(CLAIM);
    for (const w of [...Object.values(SHIELD.releaseMeans), ...Object.values(SHIELD.opened)]) expect(w).not.toContain('—');
    expect(SHIELD.releaseMeans['seller-approved']).toMatch(/last step/);
    expect(SHIELD.releaseMeans['seller-waiting']).toMatch(/doesn’t take the money yet/);
  });

  it.each(CASES)('the hand-off toast says the %s words and calls approval_open only', async (_n, d, c) => {
    const calls: unknown[] = [];
    const w = mockBackend('main');
    setHarnessBackend({ ...w, invoke: async (cmd: string, args: unknown) => { calls.push({ cmd, args }); return null; } } as unknown as Backend);
    const r = render(<ToastProvider><ReleaseHandoff deal={d} need={need} /></ToastProvider>);
    await act(async () => { fireEvent.click(r.container.querySelector('[data-fk="shield-release"]') as HTMLElement); });
    await waitFor(() => expect(document.body.textContent).toContain(SHIELD.opened[c]));
    expect(calls).toEqual([{ cmd: 'approval_open', args: { deal_id: d.id } }]);
    if (c !== 'buyer') expect(document.body.textContent).not.toContain(CLAIM);
  });

  it.each(CASES)('the paused decision hint shows the %s words', (_n, d, c) => {
    const s = {
      need: () => need, who: () => 'K', cpEntry: () => undefined, title: () => 'T', moduleName: () => 'Shield', known: null,
    } as unknown as ShieldWorld;
    const r = render(<ToastProvider><PausedDecision deal={d} s={s} onDeal={() => {}} /></ToastProvider>);
    expect(r.container.querySelector('.ui-hint')?.textContent).toBe(SHIELD.releaseMeans[c]);
    if (c !== 'buyer') expect(r.container.textContent).not.toContain(CLAIM);
  });
});
