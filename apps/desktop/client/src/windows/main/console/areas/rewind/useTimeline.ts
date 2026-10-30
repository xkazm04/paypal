// What the Rewind's timeline needs, in one hook, so the Rewind page and the Charter's "Say it" panel draw
// the same timeline from the same reads: the week's record (useRewind), the forecast that is already in the
// World (AttentionSnapshot.forecast: no read of its own), the deal titles, and the rules the owner just said.
import { useEffect, useMemo, useRef } from 'react';
import type { Deal } from '@bindings/Deal';
import { OPEN_TABLE } from '@bindings/dealStates';
import { useNow, usePrefersReducedMotion, useQuery } from '../../../../../lib/hooks';
import { peekTables, type OpenTable } from '../../../../../lib/say/join';
import type { Reach } from '../../../../../lib/say/draft';
import { houseWords, REWIND_AHEAD } from '../../../../../lib/words';
import { shortTitle } from '../../../home/model';
import { useAttention, useWorldSelector, type World } from '../../../world';
import { useRewind, type RewindState } from './clock';
import { futureTicks, headlineOf } from './future';
import type { Ahead, Labeller } from './Scrubber';

const sel = (w: World) => ({ deals: w.deals.data, display: w.display });
const same = (a: ReturnType<typeof sel>, b: ReturnType<typeof sel>) => a.deals === b.deals && a.display === b.display;

export type Timeline = { r: RewindState; labelOf: Labeller; ahead: Ahead };

/** The sentence whose consequences already glided in, so coming back to a page does not play it again. */
let glided: string | null = null;

/** `sentence`: the words the rules came from; a new one glides the playhead from now to where the rules end, once. */
export function useTimeline(reach: Reach | null, sentence: string | null = null): Timeline {
  const reduced = usePrefersReducedMotion();
  const now = useNow();
  const att = useAttention();
  const { deals, display } = useWorldSelector(sel, same);
  const forecast = att.data ? att.data.forecast ?? null : undefined;
  // Still reading the forecast is not "can't forecast": nothing is drawn and nothing is claimed.
  const ticks = useMemo(() => (forecast === undefined ? [] : futureTicks(forecast, now)), [forecast, now]);
  const stops = useMemo(() => (ticks ?? []).map((t) => t.at), [ticks]);
  const r = useRewind(true, now, reduced, stops);
  const { glide, seek } = r;
  const live = useRef({ now: r.now, limit: r.limit, ahead: r.ahead });
  live.current = { now: r.now, limit: r.limit, ahead: r.ahead };
  const until = reach?.until ?? 0;
  useEffect(() => {
    if (!sentence || !until || sentence === glided || !live.current.ahead) return;
    const goal = Math.min(until, live.current.limit);
    if (goal <= live.current.now) return;
    seek(live.current.now);
    // Marked as played only when it starts: an effect that is cleaned up and run again (StrictMode) must still play it.
    const id = requestAnimationFrame(() => { glided = sentence; glide(goal); });
    return () => cancelAnimationFrame(id);
  }, [sentence, until, glide, seek]);
  // The tables open now for the item the sentence was tied to, and where each one's latest price lands against it.
  const cps = useQuery('counterparty_list', null, { refreshOn: ['settings:changed', 'deal:changed'] });
  const tables = useMemo<OpenTable[]>(() => {
    const who = new Map((cps.data ?? []).map((c) => [c.key_id, (c.house ? houseWords(c.display_name) : c.display_name).split(/\s+·\s+/)[0] ?? c.display_name] as const));
    return (deals ?? []).filter((d) => d.side === 'buyer' && OPEN_TABLE.has(d.state)).map((d) => ({
      id: d.id, ref: d.terms.item_ref, title: shortTitle(display(d).title), who: who.get(d.counterparty) ?? null,
      price: d.terms.unit_price.minor * d.terms.qty, currency: d.terms.currency,
    }));
  }, [deals, display, cps.data]);
  const peeks = useMemo(() => peekTables(reach, tables), [reach, tables]);
  const labelOf = useMemo<Labeller>(() => {
    const by = new Map((deals ?? []).map((d) => [d.id, d] as const));
    return (id: string): { deal: Deal; label: string; title: string } | null => {
      const d = by.get(id);
      if (!d) return null;
      const disp = display(d);
      return { deal: d, label: disp.label, title: shortTitle(disp.title) };
    };
  }, [deals, display]);
  const currency = att.data?.wallet_spend_today_currency ?? null;
  const headline = useMemo(() => (forecast === undefined ? { ...headlineOf(null), rest: REWIND_AHEAD.reading } : headlineOf(forecast, currency)), [forecast, currency]);
  const ahead = useMemo<Ahead>(() => ({
    ticks, headline, reach, peeks,
    titleOf: (id, fallback) => labelOf(id)?.title ?? fallback,
  }), [ticks, headline, reach, peeks, labelOf]);
  return { r, labelOf, ahead };
}
