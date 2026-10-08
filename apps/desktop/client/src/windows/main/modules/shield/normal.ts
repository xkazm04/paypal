// Round 2 for the Shield page (docs/ux/ROUND-2.md, experiment r2-shield): pure helpers, no React, no IPC.
//   weekStrip     the three big tiles: checked, paused, blocked (counts from the deals the page already has)
//   compareRows   "what's normal vs this payment", only from facts the client holds; unknown stays unknown
//   checkLights   which of the three check groups tripped, which passed, which are not shown here
//   whyFor        the two plain sentences behind a reason: deterministic, no invented number
// The contract gives the client the shield's verdict only (see matrix.ts), so a light is never green
// unless the client can derive that result itself from the typical price it holds. Unit-tested in normal.test.ts.
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import type { Deal } from '@bindings/Deal';
import { formatMinor } from '../../../../lib/format';
import { shieldRuleWord } from '../../../../lib/words';
import { ledgerScope } from '../../logic';
import { ago, checkCell, overMedian, STAGES, type ReasonKind, type Stage } from './matrix';

const DAY = 86400;
/** The shield pauses a price this far above typical (percent), the same line the reasons use. */
const PAUSE_PCT = 40;

// ---- the week strip ------------------------------------------------------------------------------------------

export type WeekStrip = {
  /** 'week' when every deal carries a timestamp; otherwise everything the wallet holds, said as such. */
  scope: 'week' | 'all';
  checked: number;
  paused: number;
  blocked: number;
  /** Checked and found nothing. */
  safe: number;
  /** Paused and still waiting for the owner. */
  waiting: number;
};

/** Checked = any deal with a shield verdict; paused = Paused for you or Check with you; blocked = Blocked. */
export function weekStrip(deals: readonly Deal[], now: number, waiting: (d: Deal) => boolean): WeekStrip {
  const scoped = ledgerScope([...deals], now);
  const seen = scoped.deals.filter((d) => d.shield !== null);
  const paused = seen.filter((d) => d.shield === 'HOLD' || d.shield === 'ASK');
  return {
    scope: scoped.scope,
    checked: seen.length,
    paused: paused.length,
    blocked: seen.filter((d) => d.shield === 'BLOCK').length,
    safe: seen.filter((d) => d.shield === 'CLEAR').length,
    waiting: paused.filter(waiting).length,
  };
}

// ---- who you already know --------------------------------------------------------------------------------------

/** How many connections have finished a deal with the owner; null when the list is not available. */
export function knownPayees(list: readonly CounterpartyDisplay[] | null | undefined): { known: number; total: number } | null {
  if (!list) return null;
  return { known: list.filter((c) => c.deals_closed > 0).length, total: list.length };
}

/** "5 min ago", "2 hours ago", then whole days ("today" never appears: the caller says "first seen"). */
export function seenWords(firstSeen: number, now: number): string {
  const s = Math.max(0, now - firstSeen);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < DAY) { const h = Math.floor(s / 3600); return `${h} ${h === 1 ? 'hour' : 'hours'} ago`; }
  return ago(firstSeen, now);
}

// ---- what's normal vs this payment -----------------------------------------------------------------------------------

export type CompareCell = { text: string; sub?: string; unknown?: boolean };
/** differs = highlighted; plain = the same or unremarkable; unknown = one side is not known (dashed, never green). */
export type CompareRow = { key: 'price' | 'who' | 'deals'; label: string; normal: CompareCell; here: CompareCell; tone: 'differs' | 'plain' | 'unknown' };

type PayeeDeal = Pick<Deal, 'terms' | 'market'>;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function compareRows(d: PayeeDeal, cp: CounterpartyDisplay | undefined, known: { known: number; total: number } | null, now: number): CompareRow[] {
  const u = d.terms.unit_price;
  const each = `${formatMinor(u.minor, u.currency)} each`;
  const p = overMedian(d);
  const m = d.market;

  const price: CompareRow = m && p !== null
    ? {
      key: 'price', label: 'Price',
      normal: { text: formatMinor(m.median.minor, m.median.currency), sub: `usually ${formatMinor(m.p25.minor, m.p25.currency)}–${formatMinor(m.p75.minor, m.p75.currency)}` },
      here: { text: each, sub: p === 0 ? 'right on typical' : `${Math.abs(p)}% ${p > 0 ? 'above' : 'below'} typical` },
      tone: p >= PAUSE_PCT ? 'differs' : 'plain',
    }
    : { key: 'price', label: 'Price', normal: { text: 'no typical price on file', unknown: true }, here: { text: each }, tone: 'unknown' };

  const normalWho: CompareCell = known
    ? { text: 'A payee you already know', sub: known.known ? `${plural(known.known, 'person has', 'people have')} finished deals with you` : undefined }
    : { text: 'not available yet', unknown: true };
  const fresh = !!cp && now - cp.first_seen < DAY;
  const who: CompareRow = !cp
    ? { key: 'who', label: 'Payee', normal: normalWho, here: { text: 'not on record', unknown: true }, tone: 'unknown' }
    : fresh
      ? { key: 'who', label: 'Payee', normal: normalWho, here: { text: 'New payee', sub: `first seen ${seenWords(cp.first_seen, now)}` }, tone: known ? 'differs' : 'unknown' }
      : { key: 'who', label: 'Payee', normal: normalWho, here: { text: 'A payee you know', sub: `first seen ${ago(cp.first_seen, now)}` }, tone: known ? 'plain' : 'unknown' };

  const normalDeals: CompareCell = known ? { text: '1 or more', sub: 'for the payees you know' } : { text: 'not available yet', unknown: true };
  const deals: CompareRow = !cp
    ? { key: 'deals', label: 'Deals before', normal: normalDeals, here: { text: 'not on record', unknown: true }, tone: 'unknown' }
    : cp.deals_closed > 0
      ? { key: 'deals', label: 'Deals before', normal: normalDeals, here: { text: String(cp.deals_closed), sub: 'finished with you' }, tone: known ? 'plain' : 'unknown' }
      : { key: 'deals', label: 'Deals before', normal: normalDeals, here: { text: 'None', sub: fresh ? 'first deal today' : 'no finished deal yet' }, tone: known ? 'differs' : 'unknown' };
  return [price, who, deals];
}

// ---- check lights -----------------------------------------------------------------------------------------------------

export type LightState = 'tripped' | 'passed' | 'skipped' | 'unknown';
export type Light = { stage: Stage; name: string; state: LightState; word: string; detail: string };

/** One light per check group, in the shield's order. Only a fact the client holds can trip or pass a
 *  light; everything else is "not shown here" (dashed). A light is never green on a guess. */
export function checkLights(d: PayeeDeal & Pick<Deal, 'shield_rule'>, cp: CounterpartyDisplay | undefined, now: number): Light[] {
  const fresh = !!cp && now - cp.first_seen < DAY;
  const p = overMedian(d);
  const rule = d.shield_rule ?? null;
  // The rule the wallet core recorded decides which light tripped; nothing is inferred over it.
  if (rule) {
    const w = shieldRuleWord(rule);
    const fixedRule = rule === 'payee_mismatch' || rule === 'friends_and_family' || rule === 'new_counterparty_over_threshold';
    const fixed: Light = fixedRule
      ? { stage: 'rules', name: STAGES.rules, state: 'tripped', word: w.text, detail: rule === 'new_counterparty_over_threshold' ? checkCell('newcp', d, cp, now).l : w.means }
      : { stage: 'rules', name: STAGES.rules, state: 'unknown', word: 'Not shown here', detail: 'The fixed checks (payee match, friends & family, new payee) did not decide this one; their own results do not report to this window.' };
    const price: Light = rule === 'price_over_market'
      ? { stage: 'market', name: STAGES.market, state: 'tripped', word: 'Too high', detail: checkCell('market', d, cp, now).l }
      : rule === 'no_market_reference'
        ? { stage: 'market', name: STAGES.market, state: 'skipped', word: 'No price to compare', detail: checkCell('market', d, cp, now).l }
        : p === null
          ? { stage: 'market', name: STAGES.market, state: 'skipped', word: 'No price to compare', detail: checkCell('market', d, cp, now).l }
          : { stage: 'market', name: STAGES.market, state: p >= PAUSE_PCT ? 'tripped' : 'passed', word: p >= PAUSE_PCT ? 'Too high' : 'Fine', detail: checkCell('market', d, cp, now).l };
    const ai: Light = rule === 'model_caution'
      ? { stage: 'engine', name: STAGES.engine, state: 'tripped', word: w.text, detail: w.means }
      : { stage: 'engine', name: STAGES.engine, state: 'unknown', word: 'Not shown here', detail: checkCell('typology', d, cp, now).l };
    return [fixed, price, ai];
  }
  const fixed: Light = fresh
    ? { stage: 'rules', name: STAGES.rules, state: 'tripped', word: 'New payee', detail: checkCell('newcp', d, cp, now).l }
    : { stage: 'rules', name: STAGES.rules, state: 'unknown', word: 'Not shown here', detail: cp ? 'This payee is not new. The other fixed checks (payee match, friends & family) do not report to this window.' : 'The wallet has no record of this payee, and the fixed checks do not report to this window.' };
  const price: Light = p === null
    ? { stage: 'market', name: STAGES.market, state: 'skipped', word: 'No price to compare', detail: checkCell('market', d, cp, now).l }
    : p >= PAUSE_PCT
      ? { stage: 'market', name: STAGES.market, state: 'tripped', word: 'Too high', detail: checkCell('market', d, cp, now).l }
      : { stage: 'market', name: STAGES.market, state: 'passed', word: 'Fine', detail: checkCell('market', d, cp, now).l };
  const ai: Light = { stage: 'engine', name: STAGES.engine, state: 'unknown', word: 'Not shown here', detail: checkCell('typology', d, cp, now).l };
  return [fixed, price, ai];
}

/** The question a reason's Why? answers. */
export function whyQuestion(kind: ReasonKind): string {
  switch (kind) {
    case 'price': return 'Why does the price matter?';
    case 'noprice': return 'Why does a missing typical price matter?';
    case 'newcp': return 'Why does a new payee matter?';
    case 'norecord': return 'Why does an unknown payee matter?';
    case 'payee': return 'Why does the payee matter?';
    case 'ff': return 'Why does friends & family matter?';
    case 'second': return 'What is the second look?';
    case 'other': return 'Why was it paused?';
  }
}

// ---- Why? ---------------------------------------------------------------------------------------------------------------

/** The two sentences behind a reason. Facts only: figures come from the deal, the 1.4 × line and the
 *  24-hour newness window are the shield's documented rules; no model, no guess. */
export function whyFor(kind: ReasonKind, d: PayeeDeal, cp: CounterpartyDisplay | undefined, now: number): [string, string] {
  const u = d.terms.unit_price;
  switch (kind) {
    case 'price': {
      const m = d.market;
      return [
        'The shield pauses any payment priced more than 1.4 × the typical price.',
        m ? `This one is ${formatMinor(u.minor, u.currency)} each, where a typical price is ${formatMinor(m.median.minor, m.median.currency)}.` : `This one is ${formatMinor(u.minor, u.currency)} each.`,
      ];
    }
    case 'noprice':
      return ['There is no typical price on file for this item, so the shield has nothing to compare it with.', 'It never waves through a price it cannot compare, so it asks you.'];
    case 'newcp':
      return [
        'A payee first seen in the last 24 hours who wants a large amount needs your OK.',
        cp ? `This payee was first seen ${seenWords(cp.first_seen, now)}, with ${cp.deals_closed ? plural(cp.deals_closed, 'finished deal', 'finished deals') : 'no finished deals'} before.` : 'This payee is new to the wallet.',
      ];
    case 'norecord':
      return ['The wallet has no record of this payee, so it cannot tell how long you have known them.', 'The shield asks you instead of guessing.'];
    case 'payee':
      return ['The money would go to someone other than the payee you agreed with.', 'That is how most payment scams work, so the shield blocks it for good.'];
    case 'ff':
      return ['A friends & family payment has no buyer protection.', 'A request to be paid that way is a common scam sign, so the shield blocks it for good.'];
    case 'second':
      return ['A second look at this payment asked for caution.', 'It can only make a payment safer, never approve one, and it never reads their words as instructions.'];
    case 'other':
      return ['This window receives the shield’s verdict, not which of its checks found something.', 'Nothing was sent to PayPal, and nothing moves until you decide.'];
  }
}
