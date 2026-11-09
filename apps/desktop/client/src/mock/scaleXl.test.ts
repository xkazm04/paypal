import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockBackend, resetMockState } from './backend';
import { buildScaleState, SCALE_NOW } from './scale';
import { XL_DEALS } from './scaleXl';
import { demoFromSearch, scalePreview } from '../lib/preview';

const DAY = 86_400;
const large = buildScaleState('large', SCALE_NOW);
const started = performance.now();
const xl = buildScaleState('xl', SCALE_NOW);
const builtInMs = performance.now() - started;

describe('the xl world: the large world at 5,000 deals', () => {
  it('is addressed as ?scale=xl', () => {
    expect(scalePreview('?scale=xl')).toBe('xl');
    expect(scalePreview('?scale=huge')).toBeNull();
    expect(demoFromSearch('?scale=xl')).toMatchObject({ world: 'xl' });
  });

  it('holds 5,000 deals with unique ids and labels, built in well under a second or two', () => {
    expect(xl.deals).toHaveLength(XL_DEALS);
    expect(new Set(xl.deals.map((d) => d.deal.id)).size).toBe(XL_DEALS);
    expect(new Set(xl.deals.map((d) => d.display.label)).size).toBe(XL_DEALS);
    expect(builtInMs).toBeLessThan(3000);
  });

  it('keeps the large world as its first 500 and adds nothing that waits for the owner', () => {
    expect(xl.deals.slice(0, large.deals.length).map((d) => d.deal.id)).toEqual(large.deals.map((d) => d.deal.id));
    expect(xl.deals.filter((d) => d.attention)).toHaveLength(large.deals.filter((d) => d.attention).length);
    expect(xl.stoppedToday).toBe(large.stoppedToday);
    expect(xl.inMotion).toBe(large.inMotion);
    expect(xl.walletSpendTodayMinor).toBe(large.walletSpendTodayMinor);
    // the added deals are all older than anything the large world shows, by days, never in the future
    const oldest = Math.min(...large.deals.map((d) => d.deal.created_at ?? 0));
    const added = xl.deals.slice(large.deals.length);
    expect(added.every((d) => (d.deal.updated_at ?? d.deal.created_at ?? 0) < SCALE_NOW - 2 * DAY + 86_400)).toBe(true);
    expect(added.some((d) => (d.deal.created_at ?? 0) < oldest)).toBe(true);
  });

  it('has audit rows to match: numbered 1..n in time order, every deal row naming a deal that exists', () => {
    const audit = xl.audit ?? [];
    expect(audit.length).toBeGreaterThan(5 * (large.audit?.length ?? 0) / 2);
    expect(audit.map((r) => r.seq)).toEqual(audit.map((_, i) => i + 1));
    expect(audit.every((r, i) => i === 0 || (audit[i - 1] as typeof r).at <= r.at)).toBe(true);
    const ids = new Set(xl.deals.map((d) => d.deal.id));
    expect(audit.every((r) => r.deal_id === null || ids.has(r.deal_id))).toBe(true);
    const withDeal = new Set(audit.filter((r) => r.deal_id).map((r) => r.deal_id));
    expect(withDeal.size).toBeGreaterThan(XL_DEALS * 0.9);
    const steps = xl.history ?? [];
    expect(steps.map((s) => s.seq)).toEqual(steps.map((_, i) => i + 1));
    expect(steps.every((s) => ids.has(s.deal_id))).toBe(true);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildScaleState('xl', SCALE_NOW))).toBe(JSON.stringify(xl));
  });
});

describe('audit_page in the mock honours filter and sort like the wallet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SCALE_NOW * 1000);
    vi.stubGlobal('BroadcastChannel', undefined);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
    history.replaceState(null, '', '/index.html?scale=large');
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

  const all = large.audit ?? [];

  it('pages newest first by default and oldest first on request, with a count of every row', async () => {
    const main = mockBackend('main');
    const a = await main.invoke('audit_page', { before: null, limit: 50 });
    expect(a.rows.map((r) => r.seq)).toEqual(all.slice(-50).map((r) => r.seq).reverse());
    expect(a.total_matching).toBe(all.length);
    const b = await main.invoke('audit_page', { before: a.next_before, limit: 50 });
    expect(b.rows[0]!.seq).toBe(a.rows[49]!.seq - 1);
    const o = await main.invoke('audit_page', { before: null, limit: 50, sort: 'oldest' });
    expect(o.rows.map((r) => r.seq)).toEqual(all.slice(0, 50).map((r) => r.seq));
    expect(o.next_before).toBe(50);
    const o2 = await main.invoke('audit_page', { before: o.next_before, limit: 50, sort: 'oldest' });
    expect(o2.rows[0]!.seq).toBe(51);
  });

  it('filters over all rows and counts them, whatever the page', async () => {
    const main = mockBackend('main');
    const mine = all.filter((r) => r.actor.toLowerCase().includes('owner'));
    expect(mine.length).toBeGreaterThan(200);
    const page = await main.invoke('audit_page', { before: null, limit: 10, filter: ' OWNER ', sort: null });
    expect(page.total_matching).toBe(mine.length);
    expect(page.rows).toHaveLength(10);
    expect(page.rows.every((r) => r.actor.toLowerCase().includes('owner'))).toBe(true);
    expect(page.next_before).toBe(page.rows[9]!.seq);
    const awaiting = all.filter((r) => r.to === 'AWAITING_APPROVAL').length;
    expect(awaiting).toBeGreaterThan(0);
    expect((await main.invoke('audit_page', { before: null, limit: 1, filter: 'awaiting approval' })).total_matching).toBeGreaterThanOrEqual(awaiting);
    const none = await main.invoke('audit_page', { before: null, limit: 10, filter: 'no such step anywhere' });
    expect(none).toEqual({ rows: [], next_before: null, total_matching: 0 });
    await expect(main.invoke('audit_page', { before: null, limit: 10, filter: 'x'.repeat(201) })).rejects.toMatchObject({ code: 'INVALID' });
  });
});
