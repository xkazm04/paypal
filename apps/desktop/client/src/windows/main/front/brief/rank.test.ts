// The brief's ranking rule over Maya's week (deadline, then money at risk, then news), the cap of three,
// and try-first-sign-last on a brand-new wallet. The clock is pinned (repo law).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwaySummary } from '../../home/away';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { moduleOf } from '../../logic';
import { standingAnswers } from '../../switchboard/standing';
import { boardFromWorld, type BoardInputs, type BoardModel } from '../../switchboard/useBoardModel';
import { BRIEF_MAX, needsByUrgency, rankBrief } from './rank';

const PIN = new Date('2026-11-06T19:30:00');
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(PIN); });
afterEach(() => { vi.useRealTimers(); });

async function mockModel(over: Partial<Pick<BoardInputs, 'safety'>> & { noNeeds?: boolean } = {}): Promise<BoardModel> {
  resetMockState();
  const b = mockBackend('main');
  const deals = await b.invoke('list_deals', null);
  const att = await b.invoke('attention_list', null);
  const disp = new Map(await Promise.all(deals.map(async (d) => [d.id, await b.invoke('deal_display', { deal_id: d.id })] as const)));
  const byDeal = new Map(att.items.map((n) => [n.deal_id, n]));
  return boardFromWorld({
    ready: true, deals, needs: over.noNeeds ? [] : att.items,
    display: (d) => { const x = disp.get(d.id)!; return { label: x.label, title: x.title }; },
    moduleOfDeal: (d) => moduleOf(d, byDeal.get(d.id)),
    exposure: att.exposure, nowSec: Math.floor(Date.now() / 1000), rulesInForce: 1, gs: null,
    safety: 'safety' in over ? over.safety : { intact: true, records: 158 },
  });
}

const away = { lines: [], lead: 'No money moved.', sinceWords: 'since the start of today', text: '', partial: false } as unknown as AwaySummary;

describe('rankBrief', () => {
  it('leads with the need with the soonest deadline, counts the rest on it, and ends with the news', async () => {
    const model = await mockModel();
    const items = rankBrief(model, standingAnswers(model), away, null);
    expect(items.length).toBeLessThanOrEqual(BRIEF_MAX);
    const first = items[0]!;
    expect(first.kind).toBe('need');
    const needs = needsByUrgency(model);
    if (first.kind === 'need') { expect(first.key.id).toBe(needs[0]!.id); expect(first.more).toBe(needs.length - 1); }
    expect(items[items.length - 1]!.kind).toBe('away');
  });
  it('a broken safety record outranks everything', async () => {
    const model = await mockModel({ safety: { intact: false, records: 158 } });
    const items = rankBrief(model, standingAnswers(model), away, null);
    expect(items[0]).toMatchObject({ kind: 'risk', broken: true });
  });
  it('nothing waiting: only the news, and no "if you do nothing" line', async () => {
    const model = await mockModel({ noNeeds: true });
    expect(rankBrief(model, standingAnswers(model), away, null).map((i) => i.kind)).toEqual(['away']);
    expect(rankBrief(model, standingAnswers(model), null, null)).toEqual([]);
  });
  it('getting started: try first, sign last; a finished step sinks', async () => {
    const model = await mockModel({ noNeeds: true });
    const s = standingAnswers(model);
    expect(rankBrief(model, s, null, { tryDone: false, realDone: false }).map((i) => i.kind)).toEqual(['try', 'real']);
    expect(rankBrief(model, s, null, { tryDone: true, realDone: false }).map((i) => i.kind)).toEqual(['real', 'try']);
  });
});
