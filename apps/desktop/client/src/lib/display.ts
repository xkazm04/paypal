// Display helpers over the pending projections, with honest fallbacks for the current shell:
// no label → short ULID, no title → item_ref, no counterparty name → short key id.
import { useMemo } from 'react';
import type { Deal } from '@bindings/Deal';
import type { CounterpartyDisplay, DealDisplay } from './pending';
import { shortId } from './format';
import { useQuery } from './hooks';

export function fallbackDisplay(deal: Deal): DealDisplay {
  return { deal_id: deal.id, label: shortId(deal.id), title: deal.terms.item_ref, deadline: null, on_silence: null, band: null };
}

export function useDealDisplay(deal: Deal | undefined): DealDisplay | undefined {
  const q = useQuery('deal_display', { deal_id: deal?.id ?? '' }, { enabled: !!deal, refreshOn: ['deal:changed'] });
  if (!deal) return undefined;
  return q.data ?? fallbackDisplay(deal);
}

/** key_id → display name, falling back to a short key id until counterparty_list exists. */
export function useCounterparties(): (key: string) => { name: string; house: boolean; known: boolean; entry?: CounterpartyDisplay } {
  const q = useQuery('counterparty_list', null, { refreshOn: ['deal:changed'] });
  return useMemo(() => {
    const map = new Map((q.data ?? []).map((c) => [c.key_id, c]));
    return (key: string) => {
      const c = map.get(key);
      return c ? { name: c.house ? houseName(c.display_name) : c.display_name, house: c.house, known: true, entry: c } : { name: shortId(key), house: false, known: false };
    };
  }, [q.data]);
}

/** The built-in house seller reads as a name, not a shout: "HOUSE seller" → "House seller". */
export const houseName = (n: string): string => n.replace(/\bHOUSE\b/g, 'House');
