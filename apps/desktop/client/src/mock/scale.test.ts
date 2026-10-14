import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { mockBackend, resetMockState } from './backend';
import { firstRunPreview, scalePreview, withFirstRun, worldKeys } from './firstRun';
import { buildScaleState, seeded, SCALE_NOW, type Scale } from './scale';
import { mockValidate } from './simulate';
import { beadKind } from '../windows/main/logic';

const SCALES: Scale[] = ['small', 'large'];
const states = Object.fromEntries(SCALES.map((s) => [s, buildScaleState(s, SCALE_NOW)])) as Record<Scale, ReturnType<typeof buildScaleState>>;
const count = <T,>(xs: readonly T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((a, x) => { const k = f(x); a[k] = (a[k] ?? 0) + 1; return a; }, {});
const DAY = 86400;

describe('the generator is deterministic', () => {
  it('the same seed gives the same numbers, another seed does not', () => {
    const a = seeded('x'); const b = seeded('x'); const c = seeded('y');
    const run = (r: ReturnType<typeof seeded>) => Array.from({ length: 8 }, () => r.int(0, 1_000_000));
    expect(run(a)).toEqual(run(b));
    expect(run(seeded('x'))).not.toEqual(run(c));
  });

  it.each(SCALES)('%s: the same `now` gives the same world, byte for byte', (scale) => {
    expect(JSON.stringify(buildScaleState(scale, SCALE_NOW))).toBe(JSON.stringify(buildScaleState(scale, SCALE_NOW)));
  });

  it.each(SCALES)('%s: never reads the wall clock or Math.random', (scale) => {
    const date = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now'); });
    const rand = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random'); });
    try {
      expect(buildScaleState(scale, SCALE_NOW).deals.length).toBeGreaterThan(0);
    } finally { date.mockRestore(); rand.mockRestore(); }
  });

  it.each(SCALES)('%s: another `now` shifts every time and keeps every shape', (scale) => {
    const later = buildScaleState(scale, SCALE_NOW + 7 * DAY);
    const base = states[scale];
    expect(later.deals.map((d) => d.display.label)).toEqual(base.deals.map((d) => d.display.label));
    expect(later.deals.map((d) => d.deal.id)).toEqual(base.deals.map((d) => d.deal.id));
    expect(later.deals.map((d) => d.deal.state)).toEqual(base.deals.map((d) => d.deal.state));
  });
});

describe.each(SCALES)('%s world: invariants', (scale) => {
  const s = states[scale];
  const now = SCALE_NOW;
  const ids = new Set(s.deals.map((d) => d.deal.id));
  const cps = new Map(s.counterparties.map((c) => [c.key_id, c]));

  it('ids and labels are unique, and every projection points at its deal', () => {
    expect(ids.size).toBe(s.deals.length);
    expect(new Set(s.deals.map((d) => d.display.label)).size).toBe(s.deals.length);
    expect(new Set(s.counterparties.map((c) => c.key_id)).size).toBe(s.counterparties.length);
    for (const d of s.deals) {
      expect(d.display.deal_id).toBe(d.deal.id);
      expect(d.evidence.deal_id).toBe(d.deal.id);
      if (d.attention) expect(d.attention.deal_id).toBe(d.deal.id);
    }
    for (const id of Object.keys(s.notes ?? {})) expect(ids.has(id)).toBe(true);
    for (const id of Object.keys(s.categories ?? {})) expect(ids.has(id)).toBe(true);
    for (const id of Object.keys(s.rescue ?? {})) expect(s.deals.find((d) => d.deal.id === id)?.deal.kind).toBe('rescue');
  });

  it('every deal references an existing counterparty and a mandate version signed before it began', () => {
    const rows = new Map(s.mandates.map((m) => [`${m.payload.id}:${m.payload.version}`, m]));
    expect(new Set(rows.keys()).size).toBe(s.mandates.length);
    for (const d of s.deals) {
      expect(cps.has(d.deal.counterparty), `${d.display.label} counterparty`).toBe(true);
      const m = rows.get(`${d.deal.mandate_id}:${d.deal.mandate_version}`);
      expect(m, `${d.display.label} mandate`).toBeDefined();
      expect(d.deal.created_at ?? 0, `${d.display.label} predates its mandate`).toBeGreaterThanOrEqual(m?.payload.not_before ?? Infinity);
    }
    for (const id of Object.keys(s.mandateSlots ?? {})) expect(s.mandates.some((m) => m.payload.id === id)).toBe(true);
  });

  it('money is integer minor units in one currency, never zero', () => {
    const whole = (m: { minor: number; currency: string }) => { expect(Number.isInteger(m.minor)).toBe(true); expect(m.currency).toBe('USD'); };
    for (const d of s.deals) {
      whole(d.deal.terms.unit_price);
      expect(d.deal.terms.unit_price.minor).toBeGreaterThan(0);
      expect(Number.isInteger(d.deal.terms.qty) && d.deal.terms.qty > 0).toBe(true);
      expect(d.deal.terms.currency).toBe('USD');
      if (d.deal.market) { whole(d.deal.market.p25); whole(d.deal.market.median); whole(d.deal.market.p75); }
      for (const t of d.transcript) if (t.price) whole(t.price);
      if (d.attention) { expect(Number.isInteger(d.attention.amount_minor)).toBe(true); expect(d.attention.currency).toBe('USD'); }
    }
    for (const r of Object.values(s.rescue ?? {})) {
      whole(r.offer.cycle); whole(r.offer.discount); whole(r.offer.invoice);
      expect(r.offer.cycle.minor - r.offer.discount.minor).toBe(r.offer.invoice.minor);
      expect(r.offer.discount.minor).toBeLessThanOrEqual(500);
    }
    expect(Number.isInteger(s.walletSpendTodayMinor)).toBe(true);
  });

  it('what waits for the owner has a deadline in the future; gates have distinct ones', () => {
    const items = s.deals.flatMap((d) => (d.attention ? [d.attention] : []));
    for (const a of items) {
      expect(a.deadline, a.label).not.toBeNull();
      expect((a.deadline as number) - now, a.label).toBeGreaterThan(0);
      expect(a.deadline).toBe(s.deals.find((d) => d.deal.id === a.deal_id)?.display.deadline);
      expect(a.headline.includes('{')).toBe(false);
    }
    const gates = items.filter((a) => a.kind === 'gate');
    expect(new Set(gates.map((a) => a.deadline)).size).toBe(gates.length);
    if (scale === 'large') {
      const left = gates.map((a) => (a.deadline as number) - now);
      expect(Math.min(...left)).toBeGreaterThanOrEqual(20 * 60);
      expect(Math.max(...left)).toBeLessThanOrEqual(4 * DAY + 60);
    }
    for (const d of s.deals) if (['LISTED', 'NEGOTIATING', 'AWAITING_APPROVAL', 'AUTHORIZED', 'PAIRING'].includes(d.deal.state)) expect(d.display.deadline ?? Infinity, d.display.label).toBeGreaterThan(now);
  });

  it('the record agrees with the deal: last state, one clock, ascending sequence', () => {
    const history = s.history ?? [];
    expect(history.map((h) => h.seq)).toEqual(history.map((_, i) => i + 1));
    for (let i = 1; i < history.length; i++) expect((history[i] as (typeof history)[number]).at).toBeGreaterThanOrEqual((history[i - 1] as (typeof history)[number]).at);
    for (const d of s.deals) {
      const mine = history.filter((h) => h.deal_id === d.deal.id);
      expect(mine.length, d.display.label).toBeGreaterThan(0);
      const last = [...mine].reverse().find((h) => h.state_after !== null);
      expect(last?.state_after, `${d.display.label} ${d.deal.state}`).toBe(d.deal.state);
      expect(d.deal.created_at).toBe((mine[0] as (typeof mine)[number]).at);
      expect(d.deal.updated_at).toBe((mine[mine.length - 1] as (typeof mine)[number]).at);
      expect(d.deal.updated_at ?? 0).toBeLessThanOrEqual(now);
    }
    const audit = s.audit ?? [];
    expect(audit.map((r) => r.seq)).toEqual(audit.map((_, i) => i + 1));
    for (let i = 1; i < audit.length; i++) expect((audit[i] as (typeof audit)[number]).at).toBeGreaterThanOrEqual((audit[i - 1] as (typeof audit)[number]).at);
    for (const r of audit) if (r.deal_id) expect(ids.has(r.deal_id)).toBe(true);
  });

  it('every signed rule passes the wallet’s own validation, and transcripts run in order', () => {
    for (const m of s.mandates) expect(mockValidate(m.payload), `${m.payload.id} v${m.payload.version}`).toBeNull();
    for (const d of s.deals) {
      expect(d.transcript.map((t) => t.seq)).toEqual(d.transcript.map((_, i) => i + 1));
      for (let i = 1; i < d.transcript.length; i++) expect((d.transcript[i] as (typeof d.transcript)[number]).at).toBeGreaterThanOrEqual((d.transcript[i - 1] as (typeof d.transcript)[number]).at);
    }
  });

  it('the bead kinds, the day’s numbers and the money checks are consistent', () => {
    const live = s.deals.filter((d) => d.deal.state === 'AUTHORIZED');
    for (const d of live) expect(d.deal.paypal.authorization).not.toBeNull();
    for (const d of s.deals.filter((x) => ['CAPTURED', 'RECEIPTED', 'RECONCILED'].includes(x.deal.state) && x.deal.kind !== 'rescue')) expect(d.deal.paypal.order, d.display.label).not.toBeNull();
    expect(s.inMotion).toBe(s.deals.filter((d) => ['AGREED', 'LISTED', 'NEGOTIATING', 'AWAITING_APPROVAL', 'PAIRING'].includes(d.deal.state) && !d.attention && d.deal.shield !== 'HOLD').length);
    expect(s.settings.first_run).toBe(false);
    expect(s.envelope?.payload.expires ?? 0).toBeGreaterThan(now);
  });

  it('the documented counts', () => {
    const att = s.deals.flatMap((d) => (d.attention ? [d.attention] : []));
    const bead = count(s.deals, (d) => beadKind(d.deal));
    const kinds = count(s.deals, (d) => d.deal.kind);
    if (scale === 'small') {
      expect(s.deals.length).toBe(12);
      expect(kinds).toEqual({ shop_order: 6, rescue: 3, purchase: 3 });
      expect(kinds.haggle).toBeUndefined(); // the empty module: Tables
      expect(att.filter((a) => a.kind === 'gate').length).toBe(2);
      expect(att.length).toBe(2);
      expect([bead.held, bead.stopped]).toEqual([1, 1]);
      expect(s.inMotion).toBe(2);
      expect(s.counterparties.filter((c) => !c.key_id.startsWith('sub_')).length).toBe(3);
      expect(s.counterparties.filter((c) => c.key_id.startsWith('sub_')).length).toBe(3);
      expect(new Set(s.mandates.map((m) => m.payload.id)).size).toBe(3);
      expect(new Set(s.mandates.map((m) => m.payload.agent_key.join())).size).toBe(2);
      expect(s.audit?.length).toBe(42);
      expect(s.rescueWatches?.length).toBe(1);
      expect(s.groups).toEqual([]);
    } else {
      expect(s.deals.length).toBe(500);
      expect(kinds).toEqual({ haggle: 94, purchase: 137, shop_order: 119, rescue: 150 });
      expect(att.filter((a) => a.kind === 'gate').length).toBe(32);
      expect(att.filter((a) => a.kind === 'hold').length).toBe(12);
      expect(count(att.filter((a) => a.kind === 'gate'), (a) => a.module)).toEqual({ rescue: 20, tables: 6, spend: 6 });
      expect(bead.held).toBe(15);
      expect(bead.stopped).toBe(30);
      expect(s.inMotion).toBe(10);
      expect(count(s.deals, (d) => d.deal.state)).toMatchObject({ RECONCILED: 52, REFUSED: 24, MISMATCH: 4, FAILED: 1, UNCONFIRMED: 1, AUTHORIZED: 8, NEGOTIATING: 8, LISTED: 1, AWAITING_APPROVAL: 7 });
      expect(s.counterparties.filter((c) => !c.key_id.startsWith('sub_')).length).toBe(45);
      expect(s.counterparties.filter((c) => c.key_id.startsWith('sub_')).length).toBe(150);
      expect(s.counterparties.filter((c) => c.display_name.length > 32).length).toBe(8);
      const active = s.mandates.filter((m) => !(s.revokedMandates ?? []).includes(`${m.payload.id}:${m.payload.version}`) && m.payload.version === Math.max(...s.mandates.filter((x) => x.payload.id === m.payload.id).map((x) => x.payload.version)));
      expect(active.length).toBe(8);
      expect(new Set(s.mandates.map((m) => m.payload.id)).size).toBe(12);
      expect(new Set(s.mandates.map((m) => m.payload.agent_key.join())).size).toBe(12);
      expect(s.audit?.length).toBe(5000);
      expect(Object.keys(s.rescue ?? {}).length).toBe(150);
      expect(s.rescueWatches?.length).toBe(20);
      expect(s.groups?.length).toBe(1);
      const prices = s.deals.map((d) => d.deal.terms.unit_price.minor * d.deal.terms.qty);
      expect(Math.max(...prices)).toBe(4_800_000);
      expect(s.deals.some((d) => d.deal.kind !== 'rescue' && d.deal.terms.unit_price.minor === 99)).toBe(true); // $0.99
      expect(Math.min(...Object.values(s.rescue ?? {}).map((v) => v.offer.invoice.minor))).toBeLessThan(100); // a $0.99 cycle, discounted
      expect(Math.max(...s.deals.map((d) => d.display.title.length))).toBeGreaterThanOrEqual(60);
      expect(s.deals.filter((d) => d.transcript.length >= 80).length).toBe(1);
      expect(Math.max(...s.deals.map((d) => d.transcript.filter((t) => t.by === 'you' && (t.typ === 'OFFER' || t.typ === 'COUNTER')).length))).toBe(40);
      const every = s.mandates.find((m) => m.payload.clauses.length === 9);
      expect(every && new Set(every.payload.clauses.map((c: Clause) => c.type)).size).toBe(9);
      expect(Math.max(...Object.values(s.notes ?? {}).map((n) => n.text.length))).toBeGreaterThan(300);
      const span = (s.audit ?? []).at(-1)!.at - (s.audit ?? [])[0]!.at;
      expect(span).toBeGreaterThan(85 * DAY);
      expect(span).toBeLessThanOrEqual(91 * DAY);
    }
  });
});

describe('?scale= in the preview', () => {
  it('reads the switch; a new wallet wins; every window and key follows it', () => {
    expect(scalePreview('?scale=small')).toBe('small');
    expect(scalePreview('?scale=large&degrade=1')).toBe('large');
    expect(scalePreview('?scale=huge')).toBeNull();
    expect(scalePreview('')).toBeNull();
    expect(scalePreview('?scale=large&first_run=1')).toBeNull();
    expect(worldKeys('k', 'c', false, 'large')).toEqual({ store: 'k:scale-large', channel: 'c:scale-large' });
    expect(worldKeys('k', 'c', true, 'large')).toEqual({ store: 'k:first-run', channel: 'c:first-run' });
    expect(worldKeys('k', 'c', false)).toEqual({ store: 'k', channel: 'c' });
    expect(withFirstRun('approval.html?deal=x', false, 'large')).toBe('approval.html?deal=x&scale=large');
    expect(withFirstRun('index.html#d=D-1', false, 'small')).toBe('index.html?scale=small#d=D-1');
    expect(withFirstRun('index.html?scale=small', false, 'small')).toBe('index.html?scale=small');
    expect(withFirstRun('approval.html', true, 'large')).toBe('approval.html?first_run=1');
    expect(withFirstRun('approval.html', false)).toBe('approval.html');
    expect(firstRunPreview('?scale=large')).toBe(false);
  });
});

describe.each(SCALES)('the mock backend boots on the %s world', (scale) => {
  class LocalChannel {
    static peers: LocalChannel[] = [];
    callback?: (event: { data: unknown }) => void;
    constructor(readonly name: string) { LocalChannel.peers.push(this); }
    addEventListener(_name: string, cb: (event: { data: unknown }) => void) { this.callback = cb; }
    postMessage(data: unknown) { for (const p of LocalChannel.peers) if (p !== this && p.name === this.name) p.callback?.({ data }); }
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SCALE_NOW * 1000);
    LocalChannel.peers = [];
    vi.stubGlobal('BroadcastChannel', LocalChannel);
    vi.spyOn(window, 'open').mockImplementation(() => null);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', `/index.html?scale=${scale}`);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

  it('serves every read the three windows make, without throwing', async () => {
    const main = mockBackend('main');
    const expected = states[scale];
    expect(await main.invoke('list_deals', null)).toHaveLength(expected.deals.length);
    expect(await main.invoke('get_settings', null)).toMatchObject({ first_run: false });
    const snap = await main.invoke('attention_list', null);
    expect(snap.items.length).toBe(expected.deals.filter((d) => d.attention).length);
    expect(snap.items.every((i) => i.deadline !== null && i.deadline > SCALE_NOW)).toBe(true);
    expect(await main.invoke('counterparty_list', null)).toHaveLength(expected.counterparties.length);
    expect((await main.invoke('mandate_list', null)).length).toBe(scale === 'large' ? 8 : 3);
    const book = await main.invoke('book_query', { query: { view: 'deals', metrics: ['count', 'sum_amount'], group_by: ['state'], filters: [], range: null, limit: 500 } });
    expect(book.rows.length).toBeGreaterThan(3);
    const page = await main.invoke('audit_page', { before: null, limit: 200 });
    expect(page.rows).toHaveLength(Math.min(200, expected.audit?.length ?? 0));
    expect((await main.invoke('deal_history', { deal_id: null, from: null, to: null })).steps.length).toBeLessThanOrEqual(500);
    const one = expected.deals[expected.deals.length - 1]!;
    expect((await main.invoke('deal_history', { deal_id: one.deal.id, from: null, to: null })).steps.length).toBeGreaterThan(0);
    expect((await main.invoke('rescue_book', null)).cases.length).toBe(Object.keys(expected.rescue ?? {}).length);
    expect(await main.invoke('deal_groups', null)).toHaveLength(expected.groups?.length ?? 0);
    expect((await main.invoke('envelope_get', null)).status).toBe('active');
    expect((await main.invoke('safety_record', null)).intact).toBe(true);
    expect((await main.invoke('owner_facts', null)).credentials).toHaveLength(2);
    expect((await main.invoke('quit_summary', null)).pending).toBeInstanceOf(Array);
    for (const d of expected.deals.slice(0, 5)) {
      expect((await main.invoke('deal_display', { deal_id: d.deal.id })).label).toBe(d.display.label);
      await main.invoke('deal_evidence', { deal_id: d.deal.id });
      await main.invoke('deal_transcript', { deal_id: d.deal.id });
    }
    // the tumbler and the approval window boot on the same world
    expect((await mockBackend('tumbler').invoke('attention_list', null)).items.length).toBe(snap.items.length);
    history.replaceState(null, '', `/approval.html?scale=${scale}&deal=${expected.deals.find((d) => d.attention?.kind === 'gate')?.deal.id}&target=deal`);
    const gate = expected.deals.find((d) => d.attention?.kind === 'gate')!;
    const approval = mockBackend('approval');
    const summary = await approval.invoke('approval_summary', { deal_id: gate.deal.id });
    expect(summary.deal.id).toBe(gate.deal.id);
    expect(summary.checks.length).toBeGreaterThan(0);
  });

  it('keeps the sample week untouched: its own storage key', async () => {
    const main = mockBackend('main');
    await main.invoke('pause_all_agents', null);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('the-table-mock-state-v')).every((k) => k.endsWith(`:scale-${scale}`))).toBe(true);
  });
});
