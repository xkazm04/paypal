// The figures in the board's sentence (spark the-proof-table, WP0 contract; WP2 implements).
// A reply is plain text (lib/assistant/contract.ts `say`). A figure in it becomes a key only when it
// EQUALS the board's data: a deal label that exists, an amount equal to that deal's or a money fact,
// a count equal to the column or row it names, an area name. Anything else stays plain text, so a live
// model's wording links less, never wrongly. Each figure carries what it lights (a LitSet) and a line
// saying what it is. Figure refs on the wire wait for the assistant contract (pinned to 2026-11-12).
// Pure: no React, no IO. Words come from lib/words/board.ts (BOARD_FIGURE).
//
// The matcher (ported from the r2 prototype's figures.js, over the app's BoardModel):
// - One table of figure kinds, each a regex and a check against the model. The scan walks the sentence
//   left to right; at each point the earliest match wins, then the longest, then the table order. The
//   winning span becomes a figure if its check passes and stays plain text if not: a span that failed
//   is never re-read as a shorter figure ("6 deals need you" that is wrong never links "6 deals").
// - Scope instead of the prototype's litRows (the reply's focus op, which this signature does not see):
//   a count after an area name in the same sentence is that area's ("Spend: 6 deals, 1 needs you"), and
//   only that area's; a time left or an amount after a deal label in the same sentence is that deal's.
// - Equality only. Money is compared as the app prints it (lib/format.ts formatMinor and shortMoney in the
//   board's currency); a time left as the assistant prints it (ASSISTANT_DUR) or as the board reads it
//   aloud (countdownWords), both at the model's own now (digest.now_ms, the time the reply was asked at).
import type { Currency } from '@bindings/Currency';
import type { Module } from '@bindings/Module';
import { FATES, MODULE_KEYS, type Fate } from '../../../lib/assistant';
import { countdownWords, exponent, formatMinor, shortMoney } from '../../../lib/format';
import { ASSISTANT_DUR, ASSISTANT_MODULE_NAME } from '../../../lib/words/assistant';
import { BOARD_FIGURE, BOARD_MODULE_ROLE } from '../../../lib/words/board';
import { FATE_TONE, litDeal, litOf, NO_LIT, type LitSet, type Tone } from './lit';
import type { BoardKey, BoardModel } from './useBoardModel';

export type Figure = {
  /** UTF-16 offsets into the sentence, start inclusive, end exclusive. */
  readonly start: number;
  readonly end: number;
  /** The sentence's own text for the figure (say.slice(start, end)). */
  readonly text: string;
  readonly tone: Tone;
  /** What the figure is, in plain words ("6 deals need you: Tables 2, Spend 1, ..."). */
  readonly what: string;
  readonly lit: LitSet;
};

type Made = { tone: Tone; what: string; lit: LitSet };
/** What the scan knows at a point: the last deal and the last area named in the current sentence. */
type Ctx = { deal: BoardKey | null; area: Module | null };
type Kind = { id: string; re: RegExp; make: (m: RegExpExecArray, w: World, ctx: Ctx) => Made | null };

/** The model, read once per call into what the kinds compare against. */
type World = {
  model: BoardModel;
  byLabel: ReadonlyMap<string, BoardKey | null>;
  currency: Currency | null;
  nowMs: number;
  total: number;
};

const MODULE_BY_NAME = new Map<string, Module>(MODULE_KEYS.map((m) => [ASSISTANT_MODULE_NAME[m], m]));
const areaName = (m: Module): string => ASSISTANT_MODULE_NAME[m];

/** A currency the app can format, else null (formatMinor needs a known exponent). */
const knownCurrency = (c: string | null): Currency | null => (c !== null && exponent(c as Currency) !== undefined ? (c as Currency) : null);

/** Every way the app prints this amount: "$1,000.00" and "$1,000". */
function printed(minor: number | null, currency: string | null): string[] {
  const c = knownCurrency(currency);
  if (minor === null || !Number.isFinite(minor) || !c) return [];
  const full = formatMinor(minor, c);
  const short = shortMoney(minor, c);
  return full === short ? [full] : [full, short];
}

const amountOf = (k: BoardKey): string | null => printed(k.amount_minor, k.currency)[0] ?? null;

/** The fate a count phrase names. */
function fateOfPhrase(s: string): Fate | null {
  if (/\b(?:need|needs|wait|waits|waiting)\b/.test(s)) return 'needs';
  if (/\b(?:moving|retrying)\b/.test(s)) return 'moving';
  if (/\bstopped\b/.test(s)) return 'stopped';
  if (/\b(?:paid|recovered)\b/.test(s)) return 'paid';
  return null;
}

/** "Tables 2", "Spend 1", ... for the areas that hold deals of this fate. */
const byArea = (model: BoardModel, fate: Fate): string[] =>
  MODULE_KEYS.filter((m) => model.cells[m][fate].count > 0).map((m) => BOARD_FIGURE.areaCount(areaName(m), model.cells[m][fate].count));

/** A count of one fate, in the area the sentence names or on the whole board. Equal, or null. */
function fateCount(n: number, fate: Fate, w: World, ctx: Ctx): Made | null {
  const { model } = w;
  if (ctx.area) {
    const m = ctx.area;
    return model.cells[m][fate].count === n ? { tone: FATE_TONE[fate], what: BOARD_FIGURE.cellCount(areaName(m), n, fate), lit: litOf(m, fate) } : null;
  }
  return model.colCount[fate] === n ? { tone: FATE_TONE[fate], what: BOARD_FIGURE.count(n, fate, byArea(model, fate)), lit: litOf(null, fate) } : null;
}

/** The time left on a needs-you deal, as the assistant and the board's screen-reader words print it. */
function leftTexts(k: BoardKey, nowMs: number): string[] {
  if (k.fate !== 'needs' || k.deadline_ms === null || !Number.isFinite(k.deadline_ms)) return [];
  const min = Math.round((k.deadline_ms - nowMs) / 60000);
  const out = [countdownWords(k.deadline_ms / 1000, nowMs / 1000)];
  if (min >= 0) out.push(ASSISTANT_DUR(min));
  return out;
}

/** The board's soonest needs-you deal (soonest deadline first, as the Needs you column orders it). */
function soonestNeed(model: BoardModel): BoardKey | null {
  let best: BoardKey | null = null;
  for (const k of model.keys) if (k.fate === 'needs' && k.deadline_ms !== null && (!best || k.deadline_ms < best.deadline_ms!)) best = k;
  return best;
}

type FactKey = keyof typeof BOARD_FIGURE.fact;
/** The money facts a sum may equal, in the strip's order, with the tone of what each is. */
function facts(model: BoardModel): readonly (readonly [FactKey, number | null, Tone])[] {
  const i = model.instruments;
  return [
    ['room', model.money.room_left_minor, 'teal'],
    ['cap', model.money.day_cap_minor, 'market'],
    ['held', model.money.held_minor, 'coral'],
    ['heldAt', i.held_at_paypal_minor, 'coral'],
    ['heldBefore', i.held_before_minor, 'coral'],
    ['heldCap', i.held_cap_minor, 'market'],
    ['paidOut', model.money.paid_today_minor, 'ok'],
    ['paidIn', i.paid_in_minor, 'ok'],
    ['outToday', i.out_today_minor, 'teal'],
  ];
}

const union = (deals: readonly BoardKey[]): LitSet => {
  const cells: [Module, Fate][] = [];
  for (const k of deals) if (!cells.some(([m, f]) => m === k.module && f === k.fate)) cells.push([k.module, k.fate]);
  return { ...NO_LIT, cells, deals: deals.map((k) => k.id) };
};

const MONEY = /(?:[$€£]\d+(?:,\d{3})*(?:\.\d+)?|\b\d+(?:,\d{3})*(?:\.\d+)? [A-Z]{3}\b)/g;
const DUR = /\b(?:\d+ min left|\d+ h(?: \d{2} m)? left|\d+ days? left|\d+ (?:days?|hours?|minutes?)(?: \d+ (?:hours?|minutes?))? left)\b/g;
const AREA = new RegExp(`\\b(?:${[...MODULE_BY_NAME.keys()].join('|')})\\b`, 'g');
/** "6 things wait on you", "1 needs you", "7 moving by themselves", "6 stopped", "4 paid", "1 recovered",
 *  "1 is retrying by itself", "2 deals were stopped", "6 things are waiting for you". */
const COUNT = /\b\d+ (?:things? (?:waits?|(?:is|are) waiting) (?:on|for) you|(?:deals? )?needs? you|(?:deals? )?(?:(?:is|are) )?(?:moving(?: by (?:itself|themselves))?|retrying by (?:itself|themselves))|(?:deals? )?(?:(?:was|were) )?(?:stopped|paid|recovered))\b/g;

const KINDS: readonly Kind[] = [
  { id: 'deal', re: /\b[DQ]-\d{4}\b/g, make(m, w, ctx) {
    const k = w.byLabel.get(m[0]);
    if (!k) return null; // unknown, or two keys share the label: not this board's one deal
    ctx.deal = k;
    return { tone: FATE_TONE[k.fate], what: BOARD_FIGURE.deal(k.label, k.title, amountOf(k), k.state_word), lit: litDeal(k) };
  } },
  { id: 'money', re: MONEY, make(m, w, ctx) {
    const text = m[0];
    const hit = facts(w.model).filter(([, v]) => printed(v, w.currency).includes(text));
    // An amount after a deal in the same sentence is that deal's when it equals it; else every equal deal.
    const own = ctx.deal && printed(ctx.deal.amount_minor, ctx.deal.currency).includes(text) ? [ctx.deal] : null;
    const deals = own ?? w.model.keys.filter((k) => printed(k.amount_minor, k.currency).includes(text));
    if (!hit.length && !deals.length) return null;
    const fates = new Set(deals.map((k) => k.fate));
    const tone: Tone = hit.length ? hit[0]![2] : fates.size === 1 ? FATE_TONE[deals[0]!.fate] : 'market';
    return { tone, what: BOARD_FIGURE.money(text, hit.map(([key]) => BOARD_FIGURE.fact[key]), deals), lit: deals.length ? union(deals) : NO_LIT };
  } },
  { id: 'today', re: /\b(\d+)(?: of (\d+))? deals? today\b/g, make(m, w) {
    const { deals_today: n, deals_cap: cap } = w.model.money;
    if (n === null || Number(m[1]) !== n) return null;
    // "of 6" must be the signed cap; without it the count alone is the figure.
    if (m[2] !== undefined && (cap === null || Number(m[2]) !== cap)) return null;
    return { tone: 'teal', what: BOARD_FIGURE.today(n, cap), lit: NO_LIT };
  } },
  { id: 'rules', re: /\b(\d+) (?:rule sets? (?:is|are)|sets? of rules (?:is|are)) in force\b/g, make(m, w) {
    const n = w.model.rulesInForce;
    return n !== null && Number(m[1]) === n ? { tone: 'market', what: BOARD_FIGURE.rules(n), lit: NO_LIT } : null;
  } },
  { id: 'count', re: COUNT, make(m, w, ctx) {
    const fate = fateOfPhrase(m[0]);
    return fate ? fateCount(Number.parseInt(m[0], 10), fate, w, ctx) : null;
  } },
  { id: 'stoppedN', re: /\bstopped (\d+) deals?\b/g, make(m, w, ctx) { return fateCount(Number(m[1]), 'stopped', w, ctx); } },
  { id: 'deals', re: /\b(\d+) deals?(?: on the board)?\b(?! (?:match|touched))/g, make(m, w, ctx) {
    const n = Number(m[1]);
    if (ctx.area) {
      const a = ctx.area;
      return w.model.rowCount[a] === n ? { tone: 'market', what: BOARD_FIGURE.rowTotal(areaName(a), n), lit: litOf(a, null) } : null;
    }
    if (n !== w.total) return null;
    return { tone: 'market', what: BOARD_FIGURE.whole(n, FATES.map((f) => BOARD_FIGURE.fateCount(w.model.colCount[f], f))), lit: { ...NO_LIT, cols: FATES } };
  } },
  { id: 'left', re: DUR, make(m, w, ctx) {
    const k = ctx.deal ?? null;
    if (!k || !leftTexts(k, w.nowMs).includes(m[0])) return null;
    return { tone: 'gold', what: BOARD_FIGURE.dealLeft(k.label, m[0].replace(/ left$/, ''), k.on_silence), lit: litDeal(k) };
  } },
  { id: 'area', re: AREA, make(m, w, ctx) {
    const a = MODULE_BY_NAME.get(m[0]);
    if (!a) return null;
    ctx.area = a;
    const { model } = w;
    const parts = FATES.map((f) => BOARD_FIGURE.fateCount(model.cells[a][f].count, f));
    return { tone: 'market', what: BOARD_FIGURE.area(areaName(a), BOARD_MODULE_ROLE[a], model.rowCount[a], parts), lit: litOf(a, null) };
  } },
];

/** Where each sentence ends: a full stop, question or exclamation mark followed by space or the end. */
const sentenceEnds = (say: string): number[] => [...say.matchAll(/[.!?](?=\s|$)/g)].map((x) => x.index! + 1);

/** Non-overlapping figures, ascending by start. */
export function findFigures(say: string, model: BoardModel): Figure[] {
  if (!say) return [];
  const byLabel = new Map<string, BoardKey | null>();
  for (const k of model.keys) byLabel.set(k.label, byLabel.has(k.label) ? null : k);
  const w: World = {
    model,
    byLabel,
    currency: knownCurrency(model.money.currency ?? model.instruments.currency),
    nowMs: model.digest.now_ms,
    total: model.keys.length,
  };
  // "the soonest is D-0193, 3 h 58 m left" names its deal; a sentence that only says "soonest" means the board's soonest.
  const ends = sentenceEnds(say);
  const sentenceOf = (i: number): number => ends.filter((e) => e <= i).length;
  const out: Figure[] = [];
  let ctx: Ctx = { deal: null, area: null };
  let sentence = 0;
  let from = 0;
  while (from < say.length) {
    let best: { kind: Kind; m: RegExpExecArray } | null = null;
    for (const kind of KINDS) {
      kind.re.lastIndex = from;
      const m = kind.re.exec(say);
      if (!m) continue;
      if (!best || m.index < best.m.index || (m.index === best.m.index && m[0].length > best.m[0].length)) best = { kind, m };
    }
    if (!best) break;
    const { kind, m } = best;
    const s = sentenceOf(m.index);
    if (s !== sentence) {
      sentence = s;
      ctx = { deal: null, area: null };
    }
    if (kind.id === 'left' && !ctx.deal && /\bsoonest\b/i.test(say.slice(s === 0 ? 0 : ends[s - 1]!, m.index))) ctx.deal = soonestNeed(model);
    const made = kind.make(m, w, ctx);
    const end = m.index + m[0].length;
    if (made) out.push({ start: m.index, end, text: m[0], ...made });
    from = end;
  }
  return out;
}
