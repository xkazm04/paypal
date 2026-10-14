// Query keys for the read layer (lib/data). One place decides which key a read lives under, so two
// components that read the same thing share one cache entry and one IPC call.
//
// - The world reads of the main window have names: ['world','settings'|'deals'|'attention'|'runs'].
// - Reads that are kept across mounts have a named key: ['counterparties'], ['mandates'], and the
//   per-deal reads ['deal_display', id], ['deal_evidence', id], ['deal_transcript', id],
//   ['counterparty_note', id].
// - Every other read is ['cmd', name, args]: shared while mounted, dropped once nothing shows it
//   (the "fresh" policy below), so a read the event map does not cover is read again on every mount,
//   as before the query layer.
//
// The approval token never goes in a key: it travels in the query function only.
import type { QueryKey } from '@tanstack/react-query';
import type { ArgsOf, CommandName } from '../contract';

export const WORLD_KEYS = {
  settings: ['world', 'settings'],
  deals: ['world', 'deals'],
  attention: ['world', 'attention'],
  runs: ['world', 'runs'],
} as const satisfies Record<string, QueryKey>;

export const COUNTERPARTIES_KEY = ['counterparties'] as const;
export const MANDATES_KEY = ['mandates'] as const;

/** The per-deal reads with a named key. */
export const PER_DEAL_COMMANDS = ['deal_display', 'deal_evidence', 'deal_transcript', 'counterparty_note'] as const;
export type PerDealCommand = (typeof PER_DEAL_COMMANDS)[number];

export const dealKey = (cmd: PerDealCommand, dealId: string): QueryKey => [cmd, dealId];

const WORLD_BY_COMMAND: Partial<Record<CommandName, QueryKey>> = {
  get_settings: WORLD_KEYS.settings,
  list_deals: WORLD_KEYS.deals,
  attention_list: WORLD_KEYS.attention,
  agent_runs: WORLD_KEYS.runs,
  counterparty_list: COUNTERPARTIES_KEY,
  mandate_list: MANDATES_KEY,
};

/** How long an entry is fresh, and how long it is kept with nothing showing it. */
export type Policy = { staleTime: number; gcTime: number };
/** Named reads: fresh for a few seconds (events invalidate them sooner), kept five minutes. */
export const NAMED_POLICY: Policy = { staleTime: 5_000, gcTime: 5 * 60_000 };
/** Every other read: stale at once and dropped as soon as nothing shows it, so a remount reads again. */
export const FRESH_POLICY: Policy = { staleTime: 0, gcTime: 0 };

export type KeyInfo = {
  key: QueryKey;
  /** The one deal this read is about, or null. Ledger events about another deal leave it alone. */
  dealId: string | null;
  policy: Policy;
};

function dealIdOf(args: unknown): string | null {
  if (args && typeof args === 'object' && 'deal_id' in args) {
    const id = (args as { deal_id: unknown }).deal_id;
    return typeof id === 'string' && id !== '' ? id : null;
  }
  return null;
}

/** The key, the deal and the cache policy of one read. */
export function keyOf<K extends CommandName>(cmd: K, args: ArgsOf<K>): KeyInfo {
  const world = WORLD_BY_COMMAND[cmd];
  if (world) return { key: world, dealId: null, policy: NAMED_POLICY };
  const id = dealIdOf(args);
  if ((PER_DEAL_COMMANDS as readonly string[]).includes(cmd) && id !== null) {
    return { key: [cmd, id], dealId: id, policy: NAMED_POLICY };
  }
  // deal_history for one deal is about that deal; a range over every deal (deal_id null) is not.
  const scoped = cmd === 'deal_history' ? id : null;
  return { key: ['cmd', cmd, args], dealId: scoped, policy: FRESH_POLICY };
}

/** The meta every query of this layer carries, read by the invalidation matcher. */
export type ReadMeta = { dealId: string | null };

export function metaDealId(meta: unknown): string | null {
  if (meta && typeof meta === 'object' && 'dealId' in meta) {
    const id = (meta as { dealId: unknown }).dealId;
    return typeof id === 'string' ? id : null;
  }
  return null;
}
