// Shop around (T8), pure: which open tables the owner can group, and where a group stands. Display
// only: Rust decides who may group, refuses a second agreement and withdraws the other tables.
import type { Deal } from '@bindings/Deal';
import type { DealGroupView } from '@bindings/DealGroupView';
import type { GroupTable } from '@bindings/GroupTable';

/** Most tables one group may hold (table-ledger MAX_GROUP_TABLES). */
export const MAX_GROUP_TABLES = 8;
const OPEN: ReadonlySet<Deal['state']> = new Set(['PAIRING', 'LISTED', 'NEGOTIATING']);

/** True for a table that is still bargaining. */
export const isOpenTable = (t: Pick<GroupTable, 'state'>): boolean => OPEN.has(t.state);

/**
 * Sets of open tables the owner could shop around with: open buyer haggles in no group, for the
 * same item under the same rules, one table per seller, two or more sellers. Rust checks it again
 * (and refuses a table that already holds the owner's acceptance).
 */
export function shopAroundSets(deals: readonly Deal[], groups: readonly DealGroupView[]): Deal[][] {
  const grouped = new Set(groups.flatMap((g) => g.tables.map((t) => t.deal_id)));
  const sets = new Map<string, Deal[]>();
  const ordered = [...deals].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || a.id.localeCompare(b.id));
  for (const d of ordered) {
    if (d.side !== 'buyer' || d.kind !== 'haggle' || !OPEN.has(d.state) || grouped.has(d.id)) continue;
    const key = `${d.mandate_id}\u0000${d.terms.item_ref}`;
    const set = sets.get(key) ?? [];
    if (set.length < MAX_GROUP_TABLES && !set.some((x) => x.counterparty === d.counterparty)) set.push(d);
    sets.set(key, set);
  }
  return [...sets.values()].filter((s) => s.length >= 2);
}

export type GroupStanding =
  /** Still bargaining: `best` is the open table with the lowest seller price (null before any). */
  | { kind: 'bargaining'; open: number; best: GroupTable | null }
  /** One seller agreed first; the others are being, or were, told no. */
  | { kind: 'won'; winner: GroupTable }
  /** Every table ended without an agreement (withdrawn or lapsed): nothing was bought. */
  | { kind: 'ended' };

export function groupStanding(g: DealGroupView): GroupStanding {
  const winner = g.winner ? g.tables.find((t) => t.deal_id === g.winner) ?? null : null;
  if (winner) return { kind: 'won', winner };
  const open = g.tables.filter(isOpenTable);
  if (!open.length) return { kind: 'ended' };
  const priced = open.filter((t) => t.seller_price !== null);
  const best = priced.reduce<GroupTable | null>((a, t) => (!a || (t.seller_price?.minor ?? 0) < (a.seller_price?.minor ?? 0) ? t : a), null);
  return { kind: 'bargaining', open: open.length, best };
}

/** The group a deal belongs to, if any. */
export const groupOf = (groups: readonly DealGroupView[], dealId: string): DealGroupView | undefined =>
  groups.find((g) => g.tables.some((t) => t.deal_id === dealId));
