// The Shield layer's story, pure (rebuild WP3b): which payments the shield checked, which wait for
// the owner, which it stopped, which the owner let go on and which looked safe. The summary, its
// cards and every list are cut from the same sets, so a count always matches its list. No React,
// no IPC; the check facts themselves are modules/shield/matrix.ts and normal.ts.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { Module } from '@bindings/Module';
import { shieldNeed } from '../../../modules/shield/matrix';

export type ShieldSets = {
  /** Every deal the shield looked at: this module's own first, then the others it checked. */
  checked: Deal[];
  /** Paused for the owner (a decision waits). */
  paused: Deal[];
  /** Blocked for good, paused then closed, or ended another way: stopped for safety. */
  stopped: Deal[];
  blocked: Deal[];
  closed: Deal[];
  /** A hold the owner released: it goes on for its terms (not stopped). */
  released: Deal[];
  /** Checked and nothing found. */
  cleared: Deal[];
};

/** The shield's own attention item on a deal, or a live HOLD's (another module's decision stays there). */
export const needFor = (d: Deal, need: AttentionItem | undefined): AttentionItem | undefined => shieldNeed(d, need);

/** The sets, from the deals, the module each belongs to and the open decisions. */
export function shieldSets(deals: readonly Deal[], moduleOf: (d: Deal) => Module, needOf: (id: string) => AttentionItem | undefined): ShieldSets {
  const own = deals.filter((d) => moduleOf(d) === 'shield');
  const ownIds = new Set(own.map((d) => d.id));
  const others = deals.filter((d) => !ownIds.has(d.id) && d.shield);
  const need = (d: Deal) => needFor(d, needOf(d.id));
  // Paused first, then the rest, each group in the list's order (the World's order).
  const rank = (d: Deal) => (need(d) ? 0 : 1);
  const checked = [...own, ...others].sort((a, b) => rank(a) - rank(b));
  const paused = checked.filter((d) => d.shield !== 'BLOCK' && !!need(d));
  const blocked = checked.filter((d) => d.shield === 'BLOCK');
  const closed = checked.filter((d) => d.shield === 'HOLD' && !need(d) && !d.shield_release);
  const cleared = checked.filter((d) => d.shield === 'CLEAR' && !need(d));
  const released = checked.filter((d) => d.shield !== 'BLOCK' && !!d.shield_release && !need(d));
  const other = checked.filter((d) => d.shield !== 'BLOCK' && d.shield !== 'HOLD' && d.shield !== 'CLEAR' && !d.shield_release && !need(d));
  return { checked, paused, stopped: [...blocked, ...closed, ...other], blocked, closed, released, cleared };
}
