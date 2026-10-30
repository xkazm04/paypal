// The right of "now": every forecast line is exactly one tick (never merged, dropped or invented), a tick
// sits inside the forecast's 72 hours, and the headline counts only what the forecast states and is
// built from the same walkAway() the Tumbler uses, so the two can never disagree. An unreadable forecast
// is dashed, never zero.
import { describe, expect, it } from 'vitest';
import type { ForecastLine } from '@bindings/ForecastLine';
import { reachOf } from '../../../../../lib/say/draft';
import { read } from '../../../../../lib/say/read';
import { mockForecast } from '../../../../../mock/forecast';
import { buildMockState } from '../../../../../mock/fixtures';
import { walkAway } from '../../../../tumbler/logic';
import { futureSaid, futureTicks, HORIZON_SECS, headlineOf, plainMoney, ruleLine } from './future';

const NOW = 1_800_000_000;
const H = 3600;
const line = (o: Partial<ForecastLine> & Pick<ForecastLine, 'action'>): ForecastLine => ({
  deal_id: '01JD00000000000000000000A1', label: 'D-0189', trigger: 'deadline', at: NOW + 5 * H, authority: 'safe_default',
  direction: 'none', amount_minor: 9000, currency: 'USD', end_state: 'EXPIRED', before: null, ...o,
});
const capture = (o: Partial<ForecastLine> = {}) => line({ action: 'capture', authority: 'seller_mandate', direction: 'in', trigger: 'next_tick', at: null, end_state: 'RECEIPTED', ...o });

describe('one tick per forecast line', () => {
  const lines: ForecastLine[] = [
    line({ action: 'lapse', at: NOW + 30 * H, end_state: 'WITHDRAWN', deal_id: '01JD00000000000000000000A2' }),
    line({ action: 'auto_void', at: NOW + 5 * H, end_state: 'AUTO_VOIDED' }),
    capture({ deal_id: '01JD00000000000000000000A3' }),
    line({ action: 'authorize', trigger: 'buyer_approves', at: null, before: NOW + 9 * H, authority: 'seller_mandate', end_state: 'AUTHORIZED', deal_id: '01JD00000000000000000000A4' }),
    line({ action: 'expire', at: NOW + 71 * H, deal_id: '01JD00000000000000000000A5' }),
  ];
  it('keeps every line, in time order, as the same line', () => {
    const ticks = futureTicks(lines, NOW) ?? [];
    expect(ticks).toHaveLength(lines.length);
    for (const l of lines) expect(ticks.filter((t) => t.line === l)).toHaveLength(1);
    expect(ticks.map((t) => t.at)).toEqual([...ticks.map((t) => t.at)].sort((a, b) => a - b));
  });
  it('puts a deadline at its time, the next check at now, and a buyer’s approval at its deadline', () => {
    const by = (a: ForecastLine['action'], id?: string) => (futureTicks(lines, NOW) ?? []).find((t) => t.line.action === a && (!id || t.line.deal_id.endsWith(id)));
    expect(by('lapse')?.at).toBe(NOW + 30 * H);
    expect(by('capture')?.at).toBe(NOW);
    expect(by('capture')?.untimed).toBe(true);
    expect(by('authorize')?.at).toBe(NOW + 9 * H);
    expect(by('authorize')?.conditional).toBe(true);
    expect(by('authorize')?.tone).toBe('maybe');
  });
  it('colours by who would act', () => {
    const tone = (a: ForecastLine['action']) => (futureTicks(lines, NOW) ?? []).find((t) => t.line.action === a)?.tone;
    expect(tone('lapse')).toBe('default');
    expect(tone('capture')).toBe('buyer');
  });
  it('keeps every tick inside the next 72 hours', () => {
    const far = [line({ action: 'lapse', at: NOW + 200 * H }), line({ action: 'lapse', at: NOW - 3 * H })];
    for (const t of futureTicks(far, NOW) ?? []) {
      expect(t.at).toBeGreaterThanOrEqual(NOW);
      expect(t.at).toBeLessThanOrEqual(NOW + HORIZON_SECS);
    }
  });
  it('draws nothing, and promises nothing, when the forecast could not be read', () => {
    expect(futureTicks(null, NOW)).toBeNull();
    expect(futureTicks(undefined, NOW)).toBeNull();
    expect(futureTicks([], NOW)).toEqual([]);
  });
});

describe('over the mock world: Maya’s week', () => {
  const st = buildMockState(NOW);
  const deals = st.deals.map((d) => ({ deal: d.deal, label: d.display.label, deadline: d.display.deadline }));
  const forecast = mockForecast(deals, { now: NOW, paused: false, executorConfigured: true });
  it('draws one tick for each forecast line the wallet states', () => {
    const ticks = futureTicks(forecast, NOW) ?? [];
    expect(forecast.length).toBeGreaterThan(0);
    expect(ticks).toHaveLength(forecast.length);
    expect(new Set(ticks.map((t) => t.line)).size).toBe(forecast.length);
  });
  it('words every step with the deal’s title and says nothing about money leaving', () => {
    for (const l of forecast) {
      const said = futureSaid(l, 'The monitor');
      expect(said).toContain('The monitor');
      expect(said).not.toMatch(/paid out|sent to the seller|leaves/);
    }
  });
});

describe('the headline', () => {
  it('says $0 leaves and counts only the holds that end on their own', () => {
    const h = headlineOf([line({ action: 'auto_void', at: NOW + 5 * H }), line({ action: 'auto_void', at: NOW + 8 * H, deal_id: '01JD00000000000000000000A2' }), line({ action: 'lapse', at: NOW + 9 * H, deal_id: '01JD00000000000000000000A3' })]);
    expect(h.known).toBe(true);
    expect(h.lead).toBe('If you walk away');
    expect(h.rest).toBe('$0 leaves. 2 holds end on their own.');
    expect(h.holds).toBe(2);
  });
  it('agrees with the Tumbler’s own words (the same walkAway)', () => {
    const f = [capture(), line({ action: 'auto_void' })];
    const w = walkAway({ forecast: f, wallet_spend_today_currency: 'USD' });
    const h = headlineOf(f);
    expect(w.known && w.out).toBe('$0.00');
    expect(h.out).toBe('$0.00');
    expect(h.holds).toBe(w.known ? w.releases : -1);
    expect(h.rest).toContain('$90 comes in');
  });
  it('says nothing is scheduled, still with $0', () => {
    expect(headlineOf([]).rest).toBe('$0 leaves. Nothing is scheduled.');
  });
  it('is dashed, never zero, when the forecast could not be read', () => {
    const h = headlineOf(null);
    expect(h.known).toBe(false);
    expect(h.out).toBeNull();
    expect(h.rest).not.toMatch(/\$0/);
  });
  it('writes whole dollars plainly', () => {
    expect(plainMoney('$0.00')).toBe('$0');
    expect(plainMoney('$12.50')).toBe('$12.50');
    expect(plainMoney('$1,200.00 + €10.00')).toBe('$1,200 + €10');
  });
});

describe('what the rules just said would allow', () => {
  const ctx = { now: NOW, offsetMin: 0, payees: [] };
  const reach = (text: string) => reachOf(read(text, ctx).facts, read(text, ctx).facts.ends);
  it('says how far an agent may go alone, and until when', () => {
    const r = reach('Haggle for a monitor, up to $340, ask me above $320, six offers, for 3 days');
    expect(r).toMatchObject({ alone: 32000, ceiling: 34000, perDay: 34000 });
    expect(ruleLine(r!, 'Mon 12:00')).toBe('With these rules your agent can agree up to $320 on its own, until Mon 12:00. Above that it asks you. Most $340 a day.');
  });
  it('says it asks every time when nothing may be agreed alone', () => {
    const r = reach('Haggle for a monitor up to $340, ask me every time');
    expect(r?.alone).toBe(0);
    expect(ruleLine(r!, 'Mon 12:00')).toBe('With these rules your agent asks you before every payment, until Mon 12:00.');
  });
  it('is nothing until the sentence is a rule', () => {
    expect(reach('blah')).toBeNull();
  });
});
