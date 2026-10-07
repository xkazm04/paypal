// The quit sheet's projection of `QuitSummary` (pure, tested in quit.test.ts). Every sentence is
// Rust-composed from the walk-away forecast; this file only groups the lines and adds the deal
// number and amount in front. Quitting stops the wallet process; closing a window does not.
import type { QuitLine } from '@bindings/QuitLine';
import type { QuitSummary } from '@bindings/QuitSummary';
import { formatMinor } from '../../lib/format';

export type QuitRow = { key: string; label: string; amount: string; text: string };
export type QuitSection = { key: 'while_off' | 'at_paypal'; title: string; rows: QuitRow[] };
export type QuitView = {
  /** "2 deals are still open." */
  lead: string;
  sections: QuitSection[];
  /** The forecast could not be read: nothing per deal is promised (older shell, or a failed read). */
  unknown: boolean;
  /** Rust's general sentence. */
  note: string;
};

const rows = (lines: readonly QuitLine[]): QuitRow[] =>
  lines.map((l, i) => ({ key: `${l.deal_id}:${l.effect}:${i}`, label: l.label, amount: formatMinor(l.amount_minor, l.currency), text: l.text }));

export function quitView(s: QuitSummary): QuitView {
  const n = s.pending.length;
  const lead = n === 0 ? 'Nothing is waiting for you.' : n === 1 ? '1 deal is still open.' : `${n} deals are still open.`;
  const unknown = !s.while_off || !s.at_paypal;
  const sections: QuitSection[] = [];
  if (s.while_off?.length) sections.push({ key: 'while_off', title: 'Won’t happen while The Table is off', rows: rows(s.while_off) });
  if (s.at_paypal?.length) sections.push({ key: 'at_paypal', title: 'Still happens at PayPal, by itself', rows: rows(s.at_paypal) });
  return { lead, sections, unknown: unknown && n > 0, note: s.on_quit };
}
