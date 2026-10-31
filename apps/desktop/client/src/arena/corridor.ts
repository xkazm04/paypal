// Break The Table's table panel, as e4's corridor (console/areas/tables/Corridor.tsx) draws it: D-0193's
// recorded haggle (mock/haggle.json, table `dan`: the very table the arena's recorder replays before
// every attack), then one hit on her wall for every played attack that pushed a price past her band.
// Pure: the beats come from the recording and the record only, so the corridor can only draw what was
// signed, refused or recorded. Unit-tested in corridor.test.ts.
import { RECORDED, type RecordedHaggle } from '../mock/haggle';
import type { Beat, Haggle } from '../windows/main/modules/tables/corridor';
import { minorOf } from './model';
import { isRefusal, type RecordedAttack } from './record';

/** The price an attack sent on the haggle (an agent's offer or accept price, a re-sent envelope's), in
 *  minor units; null when it named none. */
export function attackPrice(a: RecordedAttack): number | null {
  const sent = a.sent as { price?: unknown; arguments?: { price?: unknown; amount?: unknown } };
  const v = sent.arguments?.price ?? sent.arguments?.amount ?? sent.price;
  return typeof v === 'string' && /^\d+(\.\d{1,2})?$/.test(v) ? minorOf(v) : null;
}

/** An attack that hits the wall: refused on the haggle itself, with a price past the most she pays.
 *  (The wallet checks her per-deal limit first, so the refusal it records may name that rule; the price
 *  is past her band either way, and the band is the wall the corridor draws.) */
export function hitsWall(a: RecordedAttack, rec: RecordedHaggle = RECORDED.dan): boolean {
  if (a.deal.which !== 'haggle' || !isRefusal(a.answer)) return false;
  const p = attackPrice(a);
  return p !== null && p > rec.rules.ceiling;
}

/** The recording's steps as the corridor's beats (the same reading haggleOf gives a live table's
 *  transcript and history: a refused yes is a gate at the price it tried, a refusal at her limit is the wall). */
export function recordedBeats(rec: RecordedHaggle): Beat[] {
  const beats: Beat[] = [];
  let theirs: number | null = null;
  let onTable: number | null = null;
  let sawOurs = false;
  const accepts: { you: number | null; them: number | null } = { you: null, them: null };
  for (const s of rec.steps) {
    const by = s.by === 'seller' ? 'them' : 'you';
    if (s.act === 'listing' || s.act === 'offer' || s.act === 'counter') {
      beats.push({ kind: 'price', by, price: s.price, first: by === 'you' && !sawOurs });
      if (by === 'you') sawOurs = true;
      else theirs = s.price;
      onTable = s.price;
    } else if (s.act === 'refused') {
      if (beats[beats.length - 1]?.kind === 'refused') continue;
      beats.push({ kind: 'refused', price: s.clause === 6 ? s.price : null, clause: s.clause ?? null });
    } else if (s.act === 'accept') {
      const price = onTable ?? theirs ?? s.price;
      if (s.by === 'owner') beats.push({ kind: 'owner', price });
      else beats.push({ kind: 'accept', by, price });
      accepts[s.by === 'seller' ? 'them' : 'you'] = price;
      if (accepts.you !== null && accepts.you === accepts.them) beats.push({ kind: 'agreed', price: accepts.you, byOwner: rec.steps.some((x) => x.by === 'owner') });
    } else if (s.act === 'withdraw') {
      beats.push({ kind: 'withdrawn', by });
    }
  }
  return beats;
}

/** D-0193's haggle for the corridor, with a wall hit for each played attack that pushed past her band. */
export function arenaHaggle(played: readonly RecordedAttack[], rec: RecordedHaggle = RECORDED.dan): Haggle {
  const hits: Beat[] = played.filter((a) => hitsWall(a, rec)).map(() => ({ kind: 'refused', price: null, clause: 4 }));
  return {
    currency: rec.currency, side: 'buyer',
    ceiling: rec.rules.ceiling, floor: rec.rules.floor, askAbove: rec.rules.ask_above, maxOffers: rec.rules.max_offers,
    market: { p25: rec.market.p25, median: rec.market.median, p75: rec.market.p75 },
    beats: [...recordedBeats(rec), ...hits],
  };
}
