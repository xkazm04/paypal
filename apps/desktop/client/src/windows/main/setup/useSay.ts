// The sentence the owner said, read: the store's words and answers, the wallet's clock and the payee names
// of the wallets already connected, through the fixed-grammar reader. Derived on every render, never stored.
import { useMemo } from 'react';
import { OPEN_TABLE } from '@bindings/dealStates';
import { useNow, useQuery } from '../../../lib/hooks';
import { shortTitle } from '../home/model';
import { useDeals, useWorldSelector, type World } from '../world';
import { chipsOf, rulesOf, type Chip, type RulesDraft } from '../../../lib/say/draft';
import { read, type Answers, type Reading, type SayCtx } from '../../../lib/say/read';
import { useSayState } from '../../../lib/say/store';

const selDisplay = (w: World) => w.display;

export type Said = { text: string; answers: Answers; ctx: SayCtx; reading: Reading | null; chips: Chip[]; rules: RulesDraft | null };

/** Payee names the connected wallets declared (what "may pay" is filled from). */
const payeesOf = (list: ReadonlyArray<{ declared_payee: string | null }> | null | undefined): string[] =>
  [...new Set((list ?? []).map((c) => c.declared_payee).filter((p): p is string => !!p))];
const housePayeesOf = (list: ReadonlyArray<{ declared_payee: string | null; house: boolean }> | null | undefined): string[] => payeesOf((list ?? []).filter((c) => c.house));

export function useSayReading(): Said {
  const { text, answers } = useSayState();
  const now = useNow();
  const cps = useQuery('counterparty_list', null, { refreshOn: ['settings:changed', 'deal:changed'] });
  const payees = useMemo(() => payeesOf(cps.data), [cps.data]);
  // The items the owner's own deals already name: what "a monitor" can be tied to.
  const deals = useDeals().data;
  const display = useWorldSelector(selDisplay);
  const items = useMemo(() => {
    const seen = new Map<string, { title: string; open: boolean }>();
    // open tables first, so the title shown is the one on the table now
    const ordered = [...(deals ?? [])].filter((d) => d.side === 'buyer').sort((a, b) => Number(OPEN_TABLE.has(b.state)) - Number(OPEN_TABLE.has(a.state)));
    for (const d of ordered) if (!seen.has(d.terms.item_ref)) seen.set(d.terms.item_ref, { title: shortTitle(display(d).title), open: OPEN_TABLE.has(d.state) });
    return [...seen].map(([ref, v]) => ({ ref, title: v.title, open: v.open }));
  }, [deals, display]);
  const housePayees = useMemo(() => housePayeesOf(cps.data), [cps.data]);
  // To the minute: the reading's "now" does not need to move every second.
  const minute = Math.floor(now / 60) * 60;
  const ctx = useMemo<SayCtx>(() => ({ now: minute, offsetMin: -new Date(minute * 1000).getTimezoneOffset(), payees, housePayees, items }), [minute, payees, housePayees, items]);
  return useMemo(() => {
    const reading = text.trim() ? read(text, ctx, answers) : null;
    return { text, answers, ctx, reading, chips: reading ? chipsOf(reading, ctx) : [], rules: reading ? rulesOf(reading, ctx) : null };
  }, [text, answers, ctx]);
}
