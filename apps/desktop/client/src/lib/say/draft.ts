// From a reading to what the owner sees and what the approval window gets.
//   chips      each part of the sentence in the owner's words, how sure the wallet is of it (said, filled
//              in safely, left for the owner, or not sure and asking one question), and the one sentence
//              of what that part allows. Display only; every change goes back through read() as an answer.
//   rules      the typed draft (the Rust clause shapes) that approval_open carries to the approval window.
//              A part the wallet is not sure of is left out; the editor shows it as missing. Rust checks
//              the draft again and the owner signs there: nothing here signs, calls or stores anything.
//   reach      what the rules let an agent do without asking, in numbers, for the timeline and its headline.
import type { AgentSlot } from '@bindings/AgentSlot';
import type { Clause } from '@bindings/Clause';
import type { Currency } from '@bindings/Currency';
import { SAY_CHIP, SAY_SAYS } from '../words';
import { currencyText, whenWords, type Facts, type Question, type Reading, type SayCtx, type Slot } from './read';

const DAY = 86_400;

export type ChipState = 'said' | 'filled' | 'open' | 'unsure';
/** How a chip is edited in place: an amount, a whole number, words, an end (a day and an hour), or a choice of who. */
export type EditKind = 'amount' | 'count' | 'text' | 'when' | 'who';
export type Chip = {
  key: string;
  slot: Slot;
  state: ChipState;
  label: string;
  value: string;
  /** What this part allows, in one sentence. */
  says: string;
  /** The words it was read from (said parts only). */
  heard: string | null;
  question: Question | null;
  edit: EditKind | null;
  /** The text an edit starts from. */
  editValue: string;
  /** Which rule of the editor the chip feeds (the editor's own kind name), for the link into it. */
  rule: 'roles' | 'counterparties' | 'per_deal' | 'band' | 'velocity' | 'human_present_over' | 'payees' | null;
  /** 1 said · 0.5 filled in · 0 left for the owner or not sure. */
  confidence: number;
};

const conf: Record<ChipState, number> = { said: 1, filled: 0.5, open: 0, unsure: 0 };

/** The first sentence of the reading that is shown back as chips, in the order that reads best. */
export function chipsOf(r: Reading, ctx: SayCtx): Chip[] {
  const f = r.facts;
  const cur = f.currency;
  const out: Chip[] = [];
  const q = (slot: Slot): Question | null => r.questions.find((x) => x.slot === slot) ?? null;
  const state = (slot: Slot): ChipState => (q(slot) ? 'unsure' : r.from[slot] === 'said' ? 'said' : 'filled');
  const add = (c: Omit<Chip, 'confidence' | 'question'> & { question?: Question | null }) => out.push({ ...c, question: c.question ?? null, confidence: conf[c.state] });

  if (f.job === null && q('job')) {
    add({ key: 'job', slot: 'job', state: 'unsure', label: SAY_CHIP.job, value: '—', says: SAY_SAYS.job, heard: null, question: q('job'), edit: null, editValue: '', rule: 'roles' });
  }
  if (f.item || f.anything || q('item')) {
    const what = f.itemTitle ?? f.item ?? f.anything ?? '';
    add({
      key: 'item', slot: 'item', state: state('item'), label: SAY_CHIP.item, value: what || '—',
      says: f.item ? SAY_SAYS.itemOne(f.itemTitle ?? f.item) : f.anything ? SAY_SAYS.itemAny(f.anything) : SAY_SAYS.itemOne('…'),
      heard: r.heard.item ?? null, question: q('item'), edit: 'text', editValue: what, rule: f.item ? 'band' : 'per_deal',
    });
  }
  if (f.job === 'buy' || q('ceiling')) {
    add({
      key: 'ceiling', slot: 'ceiling', state: state('ceiling'), label: SAY_CHIP.ceiling, value: f.ceiling === null ? '—' : currencyText(f.ceiling, cur),
      says: f.ceiling === null ? '' : SAY_SAYS.ceiling(currencyText(f.ceiling, cur)), heard: r.heard.ceiling ?? null, question: q('ceiling'),
      edit: 'amount', editValue: f.ceiling === null ? '' : amountText(f.ceiling, cur), rule: f.item ? 'band' : 'per_deal',
    });
  }
  if (f.job === 'buy') {
    const every = f.ask === 0;
    add({
      key: 'ask', slot: 'ask', state: state('ask'), label: every ? SAY_CHIP.askAll : SAY_CHIP.ask, value: f.ask === null ? '—' : every ? SAY_CHIP.askAllValue : currencyText(f.ask, cur),
      says: f.ask === null ? '' : every ? SAY_SAYS.askAll : SAY_SAYS.ask(currencyText(f.ask, cur)), heard: r.heard.ask ?? null, question: q('ask'),
      edit: 'amount', editValue: f.ask === null ? '' : amountText(f.ask, cur), rule: 'human_present_over',
    });
    add({
      key: 'offers', slot: 'offers', state: state('offers'), label: SAY_CHIP.offers, value: f.offers === null ? '—' : String(f.offers),
      says: f.offers === null ? '' : SAY_SAYS.offers(f.offers), heard: r.heard.offers ?? null, question: q('offers'),
      edit: 'count', editValue: f.offers === null ? '' : String(f.offers), rule: f.item ? 'band' : null,
    });
    add({
      key: 'ends', slot: 'ends', state: state('ends'), label: SAY_CHIP.ends, value: f.ends === null ? '—' : whenWords(f.ends, ctx),
      says: f.ends === null ? '' : SAY_SAYS.ends(whenWords(f.ends, ctx)), heard: r.heard.ends ?? null, question: q('ends'),
      edit: 'when', editValue: '', rule: f.item ? 'band' : null,
    });
    add({
      key: 'dayTotal', slot: 'dayTotal', state: state('dayTotal'), label: SAY_CHIP.dayTotal, value: f.dayTotal === null ? '—' : currencyText(f.dayTotal, cur),
      says: f.dayTotal === null ? '' : SAY_SAYS.dayTotal(currencyText(f.dayTotal, cur)), heard: r.heard.dayTotal ?? null, question: q('dayTotal'),
      edit: 'amount', editValue: f.dayTotal === null ? '' : amountText(f.dayTotal, cur), rule: 'velocity',
    });
    add({
      key: 'dayDeals', slot: 'dayDeals', state: state('dayDeals'), label: SAY_CHIP.dayDeals, value: f.dayDeals === null ? '—' : String(f.dayDeals),
      says: f.dayDeals === null ? '' : SAY_SAYS.dayDeals(f.dayDeals), heard: r.heard.dayDeals ?? null, question: q('dayDeals'),
      edit: 'count', editValue: f.dayDeals === null ? '' : String(f.dayDeals), rule: 'velocity',
    });
    add({
      key: 'who', slot: 'who', state: r.from.who === 'said' ? 'said' : 'filled', label: SAY_CHIP.who, value: f.who === 'house' ? SAY_CHIP.whoHouse : SAY_CHIP.whoPaired,
      says: f.who === 'house' ? SAY_SAYS.whoHouse : SAY_SAYS.whoPaired, heard: r.heard.who ?? null, question: null,
      edit: 'who', editValue: f.who, rule: 'counterparties',
    });
    const list = payeesFor(f, ctx);
    add({
      key: 'payees', slot: 'payees', state: list.length ? 'filled' : 'open', label: SAY_CHIP.payees, value: list.length ? SAY_CHIP.payeesN(list.length) : SAY_CHIP.payeesNone,
      says: list.length ? SAY_SAYS.payees(list.join(', ')) : SAY_SAYS.payeesNone, heard: null, question: null, edit: null, editValue: '', rule: 'payees',
    });
  }
  // questions with no chip of their own: a currency, a lone amount, selling, an unreadable length
  const shown = new Set(out.map((c) => c.slot));
  const own = new Set(out.flatMap((c) => (c.question ? [c.question.id] : [])));
  for (const x of r.questions) {
    if (own.has(x.id) || (shown.has(x.slot) && x.slot !== 'leftover' && out.some((c) => c.slot === x.slot && c.state === 'unsure'))) continue;
    out.push({ key: x.id, slot: x.slot, state: 'unsure', label: SAY_CHIP.leftover, value: x.id.startsWith('lone:') ? currencyText(Number(x.id.slice(5)), cur) : '—', says: '', heard: null, question: x, edit: null, editValue: '', rule: null, confidence: 0 });
  }
  for (const w of r.leftover) {
    out.push({
      key: `leave:${w}`, slot: 'leftover', state: 'unsure', label: SAY_CHIP.leftover, value: w, says: SAY_SAYS.leftover(w), heard: w,
      question: { id: `leave:${w}`, slot: 'leftover', text: '', answer: { kind: 'choice', choices: [] } }, edit: null, editValue: '', rule: null, confidence: 0,
    });
  }
  return out;
}

/** Who the rules let agents pay on their own: for the house seller's table only the house's payee, otherwise the
 *  declared payees of the wallets already connected (as the ready-made rules do). Empty = the owner chooses. */
export function payeesFor(f: Pick<Facts, 'who'>, ctx: Pick<SayCtx, 'payees' | 'housePayees'>): readonly string[] {
  return f.who === 'house' ? (ctx.housePayees ?? []) : ctx.payees;
}

/** The core of the reading in one paragraph: what the rules allow, in plain words. */
export function plainWords(chips: readonly Chip[]): string {
  const core: Slot[] = ['item', 'ceiling', 'ask', 'offers', 'ends'];
  return core.flatMap((s) => chips.filter((c) => c.slot === s && c.state !== 'unsure' && c.says)).map((c) => c.says).join(' ');
}

/** "340" or "340.50": the text an amount edit starts from. */
export function amountText(minor: number, currency: Currency): string {
  return currencyText(minor, currency).replace(/^[^\d]+/, '').replace(/,/g, '');
}

// ---- the typed rules ---------------------------------------------------------------------------------

export type RulesDraft = { agent: AgentSlot; not_before: number; expires: number; clauses: Clause[]; /** The rule (1 to 9) the editor scrolls to. */ focus?: number };

/** The item as the editor and the wallet name it: lower-case words joined by dashes (Rust's ItemRef charset). */
export function itemRef(item: string): string {
  return item.toLowerCase().split(/\s+/).join('-').replace(/[^a-z0-9\-_.:@+]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '').slice(0, 128);
}

/**
 * The typed draft for the approval window, or null when the sentence read as no rule at all. A part that
 * is not sure, or that nobody can know yet, is left out or left empty for the editor to show; a said or a
 * safely filled part is carried exactly. The rules start now and end when the sentence said they end.
 */
export function rulesOf(r: Reading, ctx: SayCtx, focus?: number): RulesDraft | null {
  const f = r.facts;
  if (f.job !== 'buy' || r.selling) return null;
  const cur = f.currency;
  const money = (minor: number) => ({ minor, currency: cur });
  const haggle = f.item !== null;
  const expires = f.ends ?? ctx.now + 7 * DAY;
  const clauses: Clause[] = [
    { type: 'roles', roles: ['buy'] },
    { type: 'counterparties', rule: { type: f.who } },
  ];
  if (f.ceiling !== null) clauses.push({ type: 'per_deal', kind: haggle ? 'haggle' : 'purchase', max_amount: money(f.ceiling), categories: haggle ? ['office'] : ['office', 'parts'] });
  if (haggle) {
    // An item the owner has not yet picked between (r.unsure) is left out: the editor shows it missing.
    const refs = r.unsure.has('item') ? [] : [f.itemRef ?? itemRef(f.item ?? '')].filter(Boolean);
    clauses.push({ type: 'band', item_refs: refs, floor: null, ceiling: f.ceiling === null ? null : money(f.ceiling), max_rounds: f.offers ?? 6, deadline: expires });
  }
  if (f.dayTotal !== null) clauses.push({ type: 'velocity', max_deals_day: f.dayDeals ?? 2, max_total_day: money(f.dayTotal) });
  clauses.push({ type: 'human_present_over', amount: money(f.ask ?? 0) });
  clauses.push({ type: 'payees', payees: [...payeesFor(f, ctx)] });
  return { agent: 'negotiator', not_before: ctx.now, expires, clauses, ...(focus ? { focus } : {}) };
}

// ---- what the rules reach -----------------------------------------------------------------------------

export type Reach = {
  currency: Currency;
  /** Up to this an agent may agree on its own (a signed rule is the authority); 0 = it asks every time. */
  alone: number;
  /** The most it can ever agree to for one deal. */
  ceiling: number | null;
  /** The most a day may hold. */
  perDay: number | null;
  /** When the rules end. */
  until: number;
  /** The item, as said (or its title when it was tied to one of the owner's items). */
  item: string | null;
  /** The wallet's reference for that item when it was tied to one, else null: what an open deal's item is compared with. */
  itemRef: string | null;
  /** Above this an agent stops and asks (the threshold as said, 0 = every time). */
  ask: number;
};

/** The numbers the timeline draws for a reading; null while the sentence is no rule yet (a rule that names no
 *  most-you'll-pay allows nothing, and "it asks you every time" would say something it was never told). */
export function reachOf(f: Facts, ends: number | null): Reach | null {
  if (f.job !== 'buy' || f.ceiling === null) return null;
  const ceiling = f.ceiling;
  const ask = f.ask ?? 0;
  const alone = Math.min(ask, ceiling);
  return { currency: f.currency, alone, ceiling, perDay: f.dayTotal, until: ends ?? 0, item: f.itemTitle ?? f.item ?? f.anything, itemRef: f.itemRef, ask };
}
