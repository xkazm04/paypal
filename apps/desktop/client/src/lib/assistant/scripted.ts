// The deterministic engine: canned intents with keyword matching over the digest input. Always
// available, the fallback for every other engine. Ported from the prototype's brain (scored keywords:
// longer words weigh more). It reads ONLY the DigestInput it is given, so it can never say what the
// board does not know; a value that is null is spoken as "not available yet". Every reply passes
// validateReply unchanged (scripted.test.ts). Pure; the clock is `input.now_ms`.
import { exponent, formatMinor } from '../format';
import {
  ASSISTANT_DUR,
  ASSISTANT_ENGINE_SCRIPTED,
  ASSISTANT_MODULE_NAME,
  ASSISTANT_NO_MONEY_MOVES,
  ASSISTANT_SAY,
  ASSISTANT_SETUP_STEP,
  ASSISTANT_SUGGESTIONS,
  ASSISTANT_WHY,
} from '../words/assistant';
import type { Currency } from '@bindings/Currency';
import type { Module } from '@bindings/Module';
import type { AssistantEngine, AssistantReply, BoardDeal, DigestInput, Fate, PanelSpec, UiOp } from './contract';
import { ASSISTANT_V, MODULE_KEYS } from './contract';
import { cleanText } from './validate';
import { WHY_MAX } from './vocabulary';

type Intent = {
  id: string;
  words: readonly string[];
  weight?: number;
  reply: (c: Ctx) => AssistantReply;
};

type Ctx = { input: DigestInput; q: string; deals: BoardDeal[]; needs: BoardDeal[] };

const reply = (say: string, ops: UiOp[] = []): AssistantReply => ({ v: ASSISTANT_V, say, ops });
const show = (panel: PanelSpec): UiOp => ({ op: 'show', panel });
const focus = (module: Module | null, fate: Fate | null, deal_id: string | null = null): UiOp => ({ op: 'focus', module, fate, deal_id });
const propose = (action: Extract<UiOp, { op: 'propose' }>['action'], why: string): UiOp => ({ op: 'propose', action, why: cleanText(why, WHY_MAX) });

const label = (d: BoardDeal): string => cleanText(d.label, 60) || 'A deal';
const minutesLeft = (d: BoardDeal, now: number): number | null => (d.deadline_ms === null || !Number.isFinite(d.deadline_ms) ? null : Math.round((d.deadline_ms - now) / 60000));
const left = (d: BoardDeal, now: number): string | null => {
  const m = minutesLeft(d, now);
  return m === null ? null : ASSISTANT_DUR(m);
};
const silence = (d: BoardDeal): string | null => (d.on_silence ? cleanText(d.on_silence, 120) || null : null);

function money(minor: number | null, currency: string | null): string | null {
  if (minor === null || !Number.isFinite(minor) || currency === null || exponent(currency as Currency) === undefined) return null;
  return formatMinor(minor, currency as Currency);
}

/** Soonest deadline first, none last, then id: stable. */
function bySoonest(a: BoardDeal, b: BoardDeal): number {
  const da = a.deadline_ms ?? Number.POSITIVE_INFINITY;
  const db = b.deadline_ms ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da < db ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const count = (deals: readonly BoardDeal[], fate: Fate): number => deals.filter((d) => d.fate === fate).length;

function dealReply(d: BoardDeal, c: Ctx, many = 0): AssistantReply {
  const amount = money(d.amount_minor, d.currency);
  const head = many > 1 ? `${ASSISTANT_SAY.dealMany(many)} ` : '';
  if (d.fate === 'needs') {
    return reply(`${head}${ASSISTANT_SAY.dealNeeds(label(d), d.state_word, amount, left(d, c.input.now_ms), silence(d))}`, [
      show({ kind: 'decision', deal_id: d.id }),
      focus(d.module, d.fate, d.id),
      propose({ action: 'open_decision', deal_id: d.id }, ASSISTANT_WHY.decision(silence(d))),
    ]);
  }
  return reply(`${head}${ASSISTANT_SAY.dealOther(label(d), cleanText(d.state_word, 40), amount)}`, [show({ kind: 'deal', deal_id: d.id }), focus(d.module, d.fate, d.id)]);
}

function setupReply(c: Ctx): AssistantReply {
  const steps = c.input.setup;
  if (steps.length === 0 || steps.every((s) => s.done === null)) return reply(ASSISTANT_SAY.setupUnknown, [show({ kind: 'setup' })]);
  const next = steps.find((s) => s.done !== true);
  if (!next) return reply(ASSISTANT_SAY.setupDone, [show({ kind: 'setup' })]);
  const ops: UiOp[] = [show({ kind: 'setup' })];
  if (next.key === 'paypal') ops.push(propose({ action: 'open_setup', target: 'credentials' }, ASSISTANT_WHY.credentials));
  if (next.key === 'rules') ops.push(propose({ action: 'open_setup', target: 'mandate' }, ASSISTANT_WHY.mandate));
  const head = c.input.first_run ? `${ASSISTANT_SAY.setupFirstRun} ` : '';
  return reply(`${head}${ASSISTANT_SAY.setupNext(ASSISTANT_SETUP_STEP[next.key])}`, ops);
}

function needsReply(c: Ctx): AssistantReply {
  if (c.needs.length === 0) {
    if (c.input.first_run && c.deals.length === 0) return reply(ASSISTANT_SAY.needsFirstRun, [show({ kind: 'setup' })]);
    return reply(ASSISTANT_SAY.needsNone, [show({ kind: 'needs', module: null }), focus(null, 'needs')]);
  }
  const first = c.needs[0] as BoardDeal;
  return reply(ASSISTANT_SAY.needsSome(c.needs.length, label(first), left(first, c.input.now_ms)), [
    show({ kind: 'needs', module: null }),
    focus(null, 'needs'),
    propose({ action: 'open_decision', deal_id: first.id }, ASSISTANT_WHY.decision(silence(first))),
  ]);
}

function silenceReply(c: Ctx): AssistantReply {
  if (c.needs.length === 0) return reply(ASSISTANT_SAY.silenceNone, [show({ kind: 'needs', module: null })]);
  const shown = c.needs.slice(0, 3);
  const say = [ASSISTANT_SAY.silenceHead, ...shown.map((d) => ASSISTANT_SAY.silenceItem(label(d), silence(d)))];
  if (c.needs.length > shown.length) say.push(ASSISTANT_SAY.silenceMore(c.needs.length - shown.length));
  return reply(say.join(' '), [show({ kind: 'needs', module: null }), focus(null, 'needs')]);
}

function moneyReply(c: Ctx): AssistantReply {
  const m = c.input.money;
  const cur = m.currency;
  const room = money(m.room_left_minor, cur);
  const cap = money(m.day_cap_minor, cur);
  const held = money(m.held_minor, cur);
  const paid = money(m.paid_today_minor, cur);
  const ops: UiOp[] = [show({ kind: 'money' })];
  if (!room && !held && !paid && m.deals_today === null) {
    const rules = c.input.setup.find((s) => s.key === 'rules');
    if (rules && rules.done !== true) ops.push(propose({ action: 'open_setup', target: 'mandate' }, ASSISTANT_WHY.mandate));
    return reply(ASSISTANT_SAY.moneyNone, ops);
  }
  const parts = [
    room ? ASSISTANT_SAY.moneyRoom(room, cap) : ASSISTANT_SAY.moneyRoomUnknown,
    held ? ASSISTANT_SAY.moneyHeld(held) : ASSISTANT_SAY.moneyHeldUnknown,
    paid ? ASSISTANT_SAY.moneyPaid(paid) : '',
    m.deals_today !== null ? ASSISTANT_SAY.moneyDeals(m.deals_today, m.deals_cap) : '',
  ].filter(Boolean);
  return reply(parts.join(' '), ops);
}

function rulesReply(c: Ctx): AssistantReply {
  const n = c.input.rules_in_force;
  const ops: UiOp[] = [show({ kind: 'rules', module: null })];
  if (n === null) return reply(ASSISTANT_SAY.rulesUnknown, ops);
  if (n === 0) {
    ops.push(propose({ action: 'open_setup', target: 'mandate' }, ASSISTANT_WHY.mandate));
    return reply(ASSISTANT_SAY.rulesNone, ops);
  }
  return reply(ASSISTANT_SAY.rulesSome(n), ops);
}

function rescueReply(c: Ctx): AssistantReply {
  const r = c.deals.filter((d) => d.module === 'rescue');
  if (r.length === 0) return reply(ASSISTANT_SAY.rescueNone, [show({ kind: 'rescue' })]);
  const ops: UiOp[] = [show({ kind: 'rescue' }), focus('rescue', null)];
  const need = r.filter((d) => d.fate === 'needs').sort(bySoonest)[0];
  if (need) ops.push(propose({ action: 'open_decision', deal_id: need.id }, ASSISTANT_WHY.decision(silence(need))));
  const say = ASSISTANT_SAY.rescueSome(count(r, 'needs'), count(r, 'moving'), count(r, 'stopped'), count(r, 'paid'));
  return reply(need ? `${say} ${ASSISTANT_NO_MONEY_MOVES}` : say, ops);
}

function safetyReply(c: Ctx): AssistantReply {
  if (c.deals.length === 0) return reply(ASSISTANT_SAY.safetyNone, [show({ kind: 'safety' })]);
  const stopped = c.deals.filter((d) => d.fate === 'stopped');
  const byShield = stopped.filter((d) => d.module === 'shield').length;
  return reply(ASSISTANT_SAY.safetyStopped(stopped.length, byShield), [show({ kind: 'safety' }), focus(null, 'stopped')]);
}

function bookReply(c: Ctx): AssistantReply {
  const d = c.deals;
  return reply(ASSISTANT_SAY.bookCounts(d.length, count(d, 'needs'), count(d, 'moving'), count(d, 'stopped'), count(d, 'paid')), [show({ kind: 'book', module: null, fate: null })]);
}

function weekReply(c: Ctx): AssistantReply {
  const d = c.deals;
  if (d.length === 0) return reply(`${ASSISTANT_SAY.weekHead} ${ASSISTANT_SAY.bookCounts(0, 0, 0, 0, 0)}`, [show({ kind: 'week' })]);
  const counts = ASSISTANT_SAY.bookCounts(d.length, count(d, 'needs'), count(d, 'moving'), count(d, 'stopped'), count(d, 'paid'));
  return reply(`${ASSISTANT_SAY.weekHead} ${counts}`, [show({ kind: 'week' })]);
}

function fateOfQuestion(q: string): Fate | null {
  if (/\b(stop|stopp|block|refus|declin|reject)/.test(q)) return 'stopped';
  if (/\b(paid|pay|done|settled)/.test(q)) return 'paid';
  if (/\bmoving\b|by itself|on its own/.test(q)) return 'moving';
  if (/\b(need|wait|pending|decid)/.test(q)) return 'needs';
  return null;
}

function moduleReply(module: Module, c: Ctx): AssistantReply {
  const name = ASSISTANT_MODULE_NAME[module];
  const mine = c.deals.filter((d) => d.module === module);
  const fate = fateOfQuestion(c.q);
  const ops: UiOp[] = [show({ kind: 'book', module, fate }), { op: 'filter', module, fate }, focus(module, fate)];
  if (fate === 'stopped') return reply(ASSISTANT_SAY.moduleStopped(name, count(mine, 'stopped')), ops);
  if (fate) return reply(ASSISTANT_SAY.moduleFate(name, fate, count(mine, fate)), ops);
  return reply(ASSISTANT_SAY.moduleCounts(name, mine.length, count(mine, 'needs'), count(mine, 'stopped')), ops);
}

const moduleIntent = (module: Module, words: readonly string[]): Intent => ({ id: `module:${module}`, words, weight: 3, reply: (c) => moduleReply(module, c) });

const INTENTS: readonly Intent[] = [
  { id: 'help', words: ['help', 'what can you', 'what can i ask', 'how do i use'], weight: 3, reply: () => reply(ASSISTANT_SAY.help) },
  { id: 'silence', words: ['do nothing', 'silence', 'ignore', 'if i wait', 'no answer', 'not respond', "don't answer", 'what happens if'], weight: 2, reply: silenceReply },
  { id: 'needs', words: ['need', 'waiting', 'todo', 'to do', 'decide', 'urgent', 'what now', 'pending', 'on me', 'attention'], reply: needsReply },
  { id: 'money', words: ['money', 'limit', 'room', 'left', 'budget', 'cap', 'held', 'hold', 'balance', 'today', 'afford'], reply: moneyReply },
  { id: 'rules', words: ['rule', 'mandate', 'clause', 'signed', 'allowed', 'allowlist', 'ceiling', 'policy', 'permission'], reply: rulesReply },
  { id: 'rescue', words: ['renewal', 'rescue', 'subscri', 'failed', 'churn', 'discount', 'care plan'], reply: rescueReply },
  { id: 'safety', words: ['scam', 'safety', 'suspicious', 'stranger', 'intact', 'record', 'fraud', 'refused', 'blocked'], reply: safetyReply },
  { id: 'book', words: ['book', 'ledger', 'receipt', 'payment', 'paid', 'total', 'how much', 'audit trail'], reply: bookReply },
  { id: 'week', words: ['happen', 'week', 'timeline', 'history', 'log', 'since', 'yesterday', 'recent', 'audit', 'replay', 'rewind'], reply: weekReply },
  { id: 'setup', words: ['setup', 'set up', 'set me up', 'get me started', 'start', 'onboard', 'begin', 'first', 'connect', 'keys', 'engine', 'install', 'get going'], reply: setupReply },
  moduleIntent('tables', ['tables', 'haggle', 'negotiat', 'bargain']),
  moduleIntent('spend', ['spend', 'purchase', 'bought', 'buying']),
  moduleIntent('counter', ['counter', 'shop', 'quote', 'sell', 'customer', 'order']),
  moduleIntent('shield', ['shield']),
];

const STOP = new Set(['what', 'which', 'when', 'where', 'about', 'with', 'from', 'that', 'this', 'show', 'tell', 'deal', 'deals', 'does', 'have', 'there', 'their', 'your', 'mine']);

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Deals the question points at by id (whole or fragment, any punctuation), best first. */
function byId(q: string, deals: readonly BoardDeal[]): BoardDeal[] {
  const tokens = q.split(/[^a-z0-9_.-]+/).map(norm).filter((t) => t.length >= 3 && /\d/.test(t));
  if (tokens.length === 0) return [];
  const exact = deals.filter((d) => tokens.includes(norm(d.id)));
  if (exact.length) return exact;
  return deals.filter((d) => tokens.some((t) => norm(d.id).includes(t)));
}

/** Deals whose label shares a word (4+ letters) with the question. */
function byLabel(q: string, deals: readonly BoardDeal[]): BoardDeal[] {
  const words = new Set(q.split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
  if (words.size === 0) return [];
  return deals.filter((d) => cleanText(d.label, 60).toLowerCase().split(/[^a-z0-9]+/).some((w) => words.has(w)));
}

function miss(c: Ctx): AssistantReply {
  const setupFirst = c.input.first_run && c.deals.length === 0;
  const near = setupFirst ? ASSISTANT_SAY.missNearestSetup : ASSISTANT_SAY.missNearestNeeds;
  return reply(ASSISTANT_SAY.miss(near), [setupFirst ? show({ kind: 'setup' }) : show({ kind: 'needs', module: null })]);
}

/** Pure: the whole answer from the question and the digest input. Exported for tests. */
export function answerScripted(question: string, input: DigestInput): AssistantReply {
  const deals = input.deals;
  const needs = deals.filter((d) => d.fate === 'needs').sort(bySoonest);
  const q = ` ${String(question ?? '').slice(0, 300).toLowerCase().trim()} `;
  const c: Ctx = { input, q, deals, needs };

  const ids = byId(q, deals);
  if (ids.length) {
    const best = [...ids].sort((a, b) => (a.fate === 'needs' ? 0 : 1) - (b.fate === 'needs' ? 0 : 1) || bySoonest(a, b))[0] as BoardDeal;
    return dealReply(best, c, ids.length);
  }

  let best: Intent | null = null;
  let bestScore = 0;
  for (const it of INTENTS) {
    let s = 0;
    for (const w of it.words) if (q.includes(w)) s += (w.length > 4 ? 2 : 1) * (it.weight ?? 1);
    if (s > bestScore) { best = it; bestScore = s; }
  }
  if (best && bestScore >= 2) return best.reply(c);

  const labelled = byLabel(q, deals);
  if (labelled.length) return dealReply([...labelled].sort(bySoonest)[0] as BoardDeal, c, labelled.length);
  if (best && bestScore > 0) return best.reply(c);
  return miss(c);
}

export const SCRIPTED_QUESTIONS: readonly string[] = [...ASSISTANT_SUGGESTIONS, ...MODULE_KEYS.map((m) => `Tell me about ${ASSISTANT_MODULE_NAME[m]}`), 'Set me up', 'Help'];

export function createScriptedEngine(): AssistantEngine {
  return {
    info: { id: 'scripted', label: ASSISTANT_ENGINE_SCRIPTED },
    async ask(question, input) {
      return answerScripted(question, input);
    },
  };
}

