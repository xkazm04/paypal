// The spending chart's figures: money PayPal confirmed going out (never in, never on hold, never a
// payment still being checked), one series per currency, by local day, or by week when the days shown
// would not fit. Minor units stay exact; the chart converts only to draw an axis. Pure.
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import { dealTotal } from '../../../logic';
import { bucketOf, dirOf } from '../../../modules/book/model';
import { stampOf } from './model';

/** Past this many days the chart counts weeks. */
export const CHART_MAX_DAYS = 62;

export type SpendPoint = { key: string; label: string; minor: number };
export type SpendSeries = { currency: Currency; points: SpendPoint[]; total: number; byWeek: boolean };

/** "25 May": short enough for one line under a bar. */
const shortDay = (key: string): string => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
const keyOf = (t: Date): string => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
const midnight = (sec: number): Date => { const t = new Date(sec * 1000); t.setHours(0, 0, 0, 0); return t; };
/** The Monday of a local day (a new Date: `d` is left alone). */
const mondayOf = (d: Date): Date => { const t = new Date(d); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return t; };

/** Per currency, largest total first, the days between filled in so the axis never compresses time. */
export function spendingSeries(deals: readonly Deal[], checking: (d: Deal) => boolean): SpendSeries[] {
  const paid: Array<{ day: Date; minor: number; currency: Currency }> = [];
  for (const d of deals) {
    if (checking(d) || bucketOf(d) !== 'captured' || dirOf(d) !== 'out') continue;
    const at = stampOf(d);
    if (at === undefined) continue;
    const m = dealTotal(d);
    paid.push({ day: midnight(at), minor: m.minor, currency: m.currency });
  }
  if (!paid.length) return [];
  const first = Math.min(...paid.map((p) => p.day.getTime()));
  const last = Math.max(...paid.map((p) => p.day.getTime()));
  const byWeek = Math.round((last - first) / 86_400_000) + 1 > CHART_MAX_DAYS;
  const start = byWeek ? mondayOf(new Date(first)) : new Date(first);
  const out = new Map<Currency, Map<string, number>>();
  for (const p of paid) {
    const k = keyOf(byWeek ? mondayOf(p.day) : p.day);
    const line = out.get(p.currency) ?? new Map<string, number>();
    line.set(k, (line.get(k) ?? 0) + p.minor);
    out.set(p.currency, line);
  }
  const keys: string[] = [];
  for (const t = new Date(start); t.getTime() <= last; t.setDate(t.getDate() + (byWeek ? 7 : 1))) keys.push(keyOf(t));
  return [...out.entries()]
    .map(([currency, line]) => ({ currency, byWeek, total: [...line.values()].reduce((a, b) => a + b, 0), points: keys.map((key) => ({ key, label: shortDay(key), minor: line.get(key) ?? 0 })) }))
    .sort((a, b) => b.total - a.total || a.currency.localeCompare(b.currency));
}
