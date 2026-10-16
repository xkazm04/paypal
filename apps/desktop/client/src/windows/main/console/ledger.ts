// What the wallet is watching, for the seal and the empty centre: money on hold at PayPal (the
// same figures as Book's "On hold": a payment being checked with PayPal is not counted as held) and
// the deals in progress that ask nothing of the owner. Read from the narrow World selectors.
import { useMemo } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import { heldAtPayPal, heldLine } from '../home/model';
import { isLive } from '../logic';
import { useDeals, useNeeds } from '../world';

export type Watching = { held: number; heldText: string; moving: Deal[] };

const NO_DEALS: readonly Deal[] = [];

export function watchingOf(deals: readonly Deal[], needs: readonly AttentionItem[]): Watching {
  const checking = new Set(needs.filter((n) => n.money_check).map((n) => n.deal_id));
  const asked = new Set(needs.map((n) => n.deal_id));
  const held = heldAtPayPal(deals.filter((d) => d.state === 'AUTHORIZED'), checking);
  return { held: held.deals.length, heldText: heldLine(held), moving: deals.filter((d) => isLive(d) && !asked.has(d.id) && d.state !== 'AUTHORIZED') };
}

export function useWatching(): Watching {
  const deals = useDeals().data ?? NO_DEALS;
  const needs = useNeeds();
  return useMemo(() => watchingOf(deals, needs), [deals, needs]);
}
