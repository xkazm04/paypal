// Lever tracks: a slider in whole major units over minor-unit money, carrying this week's deals as
// ticks coloured by the draft's answer from the wallet. Pure; the component only draws it.
import type { Currency } from '@bindings/Currency';
import type { SimulatedLine } from '@bindings/SimulatedLine';
import { exponent, formatMinor } from '../../../lib/format';
import { outcomeOf, type Outcome } from './simulation';

export type Tick = { id: string; x: number; outcome: Outcome; tip: string };
export type LeverRange = { min: number; max: number; unit: number };

/** One major unit in minor units (100 for USD, 1 for JPY). */
export const majorUnit = (cur: Currency) => 10 ** exponent(cur);

/** 1-2-5 rounding up, in major units. */
export function niceCeil(units: number): number {
  if (units <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(units));
  for (const f of [1, 2, 5, 10]) if (f * p >= units) return f * p;
  return 10 * p;
}

/**
 * Track range from the signed value (so dragging never rescales the track under the pointer):
 * 0 … twice the signed value, rounded up. A new mandate (no signed value) scales to the busier
 * ticks instead. Ticks past the end are reported as off scale, not squeezed in.
 */
export function leverRange(signed: number | null, ticks: readonly number[], cur: Currency, fallback: number | null = null): LeverRange {
  const unit = majorUnit(cur);
  const sorted = [...ticks].sort((a, b) => a - b);
  const p75 = sorted.length ? sorted[Math.floor(0.75 * (sorted.length - 1))]! : 0;
  // `fallback` (the first amount typed or filled in) sets the scale only when nothing else can.
  const base = signed ?? (sorted.length ? Math.max(p75, 0) : Math.max(fallback ?? 0, 0));
  const units = niceCeil(Math.max(10, Math.ceil((base * 2) / unit)));
  return { min: 0, max: units * unit, unit };
}

/** Position on the track, 0..1 (clamped). */
export function frac(r: LeverRange, x: number): number {
  return r.max <= r.min ? 0 : Math.min(1, Math.max(0, (x - r.min) / (r.max - r.min)));
}

/** Slider value (major units) → minor units; minor → slider value (rounded down to a unit). */
export const toMinor = (r: LeverRange, slider: number) => slider * r.unit;
export const toSlider = (r: LeverRange, minor: number) => Math.floor(minor / r.unit);

/** Ticks for an amount lever (deal totals), optionally only one deal kind, coloured by the draft's answer. */
export function amountTicks(lines: readonly SimulatedLine[], filter: (l: SimulatedLine) => boolean): Tick[] {
  return lines
    .filter((l) => l.amount && filter(l))
    .map((l) => ({ id: l.deal_id, x: l.amount!.minor, outcome: outcomeOf(l.after), tip: `${l.label} · ${l.title} · ${formatMinor(l.amount!.minor, l.amount!.currency)}` }));
}

/** Ticks for a band lever (unit prices of the band's items). */
export function priceTicks(lines: readonly SimulatedLine[], items: readonly string[]): Tick[] {
  return lines
    .filter((l) => items.includes(l.item_ref))
    .map((l) => ({ id: l.deal_id, x: l.unit_price.minor, outcome: outcomeOf(l.after), tip: `${l.label} · ${l.title} · unit ${formatMinor(l.unit_price.minor, l.unit_price.currency)}` }));
}
