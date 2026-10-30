// The sentence the owner said, read: the store's words and answers, the wallet's clock and the payee names
// of the wallets already connected, through the fixed-grammar reader. Derived on every render, never stored.
import { useMemo } from 'react';
import { useNow, useQuery } from '../../../lib/hooks';
import { chipsOf, rulesOf, type Chip, type RulesDraft } from '../../../lib/say/draft';
import { read, type Answers, type Reading, type SayCtx } from '../../../lib/say/read';
import { useSayState } from '../../../lib/say/store';

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
  const housePayees = useMemo(() => housePayeesOf(cps.data), [cps.data]);
  // To the minute: the reading's "now" does not need to move every second.
  const minute = Math.floor(now / 60) * 60;
  const ctx = useMemo<SayCtx>(() => ({ now: minute, offsetMin: -new Date(minute * 1000).getTimezoneOffset(), payees, housePayees }), [minute, payees, housePayees]);
  return useMemo(() => {
    const reading = text.trim() ? read(text, ctx, answers) : null;
    return { text, answers, ctx, reading, chips: reading ? chipsOf(reading, ctx) : [], rules: reading ? rulesOf(reading, ctx) : null };
  }, [text, answers, ctx]);
}
