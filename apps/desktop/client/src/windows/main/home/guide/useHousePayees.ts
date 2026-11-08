// The payee the practice shop declared, once it is connected: rules that name it let an agent join the shop's
// table. Before the shop is connected there is none yet, so the placeholder stands (home/guide/rules.ts).
import { useQuery } from '../../../../lib/hooks';
import { HOUSE_PAYEE } from './rules';

export function useHousePayees(): readonly string[] {
  const cps = useQuery('counterparty_list', null, { refreshOn: ['settings:changed'] });
  const declared = (cps.data ?? []).filter((c) => c.house && c.declared_payee).map((c) => c.declared_payee as string);
  return declared.length ? [...new Set(declared)] : [HOUSE_PAYEE];
}
