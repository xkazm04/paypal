// What the what-if replay reads. Both are read-only.
//   list_deals        - main-only in Rust today (dispatcher.rs allowed(label, ["main"]) and the
//                       approval capability lacks allow-list-deals), so in this window it answers
//                       PERMISSION and the replay renders UNAVAILABLE. When a mandate_preview
//                       command (or approval read access) lands, the replay lights up unchanged.
//   counterparty_list - allowed here; exactly the word-confirmed counterparties (+ HOUSE flag).
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import type { WalletError } from '../../../lib/contract';
import { useQuery } from '../../../lib/hooks';

export type ReplayData = {
  /** undefined = still reading; null = not readable here (see dealsError). */
  deals: Deal[] | null | undefined;
  dealsError: WalletError | null;
  counterparties: CounterpartyDisplay[] | null;
};

export function useReplayData(): ReplayData {
  const deals = useQuery('list_deals', null, { refreshOn: ['settings:changed'] });
  const cps = useQuery('counterparty_list', null, { refreshOn: ['settings:changed'] });
  return {
    deals: deals.error ? null : deals.loading && deals.data === undefined ? undefined : deals.data ?? null,
    dealsError: deals.error,
    counterparties: cps.error ? null : cps.data ?? null,
  };
}
