// Event -> invalidation: the ONE map of which Rust event makes which read stale. Events are
// projections, not retained state: an event never writes into the cache, it only marks the reads it
// affects stale, and the reads that are on screen are read again (coalesced, lib/data/bus.ts).
//
// A hook can still name extra events (`useQuery(cmd, args, { refreshOn })`); those are added to
// this map for its key while it is mounted. A per-deal read named by a ledger event that carries a
// deal is narrowed to that deal: a change to deal A does not re-read deal B's transcript.
import type { QueryKey } from '@tanstack/react-query';
import type { EventName, PayloadOf } from '../contract';
import { COUNTERPARTIES_KEY, WORLD_KEYS, dealKey } from './keys';

/** A read to invalidate: every entry whose key starts with `key`, limited to one deal if `dealId`. */
export type Target = { key: QueryKey; dealId?: string };

/** The deal an event is about, or null when it is not about one deal. */
export function eventDealId(event: EventName, payload: unknown): string | null {
  if (event === 'deal:changed') return (payload as PayloadOf<'deal:changed'> | undefined)?.deal?.id ?? null;
  if (event === 'receipt:created') return (payload as PayloadOf<'receipt:created'> | undefined)?.deal_id ?? null;
  return null;
}

/** The deal-scoped reads a change to one deal makes stale. */
function dealReads(id: string | null): Target[] {
  if (id === null) {
    // A ledger event without a deal (never sent today): every per-deal read is stale.
    return [{ key: ['deal_display'] }, { key: ['deal_evidence'] }, { key: ['deal_transcript'] }, { key: ['cmd', 'deal_history'] }];
  }
  return [
    { key: dealKey('deal_display', id) },
    { key: dealKey('deal_evidence', id) },
    { key: dealKey('deal_transcript', id) },
    { key: ['cmd', 'deal_history'], dealId: id },
  ];
}

type Rule = (payload: unknown) => Target[];

/** The map. Order inside a rule does not matter: invalidations of one burst are flushed together. */
export const INVALIDATION: Partial<Record<EventName, Rule>> = {
  // A deal moved: the ledger list, what needs the owner (a deal change can add or clear an item), and
  // that deal's own reads. Counterparty names come with deals (a first deal with a new key).
  'deal:changed': (p) => [
    { key: WORLD_KEYS.deals },
    { key: WORLD_KEYS.attention },
    { key: COUNTERPARTIES_KEY },
    ...dealReads(eventDealId('deal:changed', p)),
  ],
  'attention:changed': () => [{ key: WORLD_KEYS.attention }],
  // Settings carry the lock and the mode; attention depends on both.
  'settings:changed': () => [{ key: WORLD_KEYS.settings }, { key: WORLD_KEYS.attention }],
  'agent:changed': () => [{ key: WORLD_KEYS.runs }],
  // A receipt: the ledger list and that deal's evidence and display. The toast stays in App.tsx.
  'receipt:created': (p) => {
    const id = eventDealId('receipt:created', p);
    return [
      { key: WORLD_KEYS.deals },
      ...(id === null ? [{ key: ['deal_evidence'] }, { key: ['deal_display'] }] : [{ key: dealKey('deal_evidence', id) }, { key: dealKey('deal_display', id) }]),
    ];
  },
};

/** The events the map listens to: subscribed once, by the provider, for the window's lifetime. */
export const MAPPED_EVENTS = Object.keys(INVALIDATION) as EventName[];

/** What one event invalidates by the map alone. */
export function targetsFor(event: EventName, payload: unknown): Target[] {
  return INVALIDATION[event]?.(payload) ?? [];
}
