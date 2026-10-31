// BROWSER PREVIEW ONLY. "Try to break it" as data (`director.html?story=try`): Break The Table in the
// console's place "Try to break it" (#p=try), on Maya's sample week. Two attacks land, one her signed
// rules refuse and one that asks for a payment tool that does not exist; the counter shows what they
// moved and how often PayPal was asked; the closing card checks the attack's signed file green.
//
// Same shape as the other stories (beats.ts). A beat never clicks a card: `{ do: 'arena' }` stages which
// recorded attacks have landed (src/arena/stage.ts) and the place lands the wallet's recorded answers as
// a click would. Every figure a caption names is read from the record (src/arena/arena.json via
// record.ts and model.ts), never typed here; every expectation is something the place draws.
//
// The `maya` hero story does not include these beats. How to splice them into it is in
// film/hero/README.md ("Break The Table in the hero film").
import { ATTACK_WORDS, counters, ruleName, wholeDollars } from '../arena/model';
import { proofFile } from '../arena/proof';
import { attackById, isRefusal, RECORD, type RecordedAttack } from '../arena/record';
import { PROOF_ALL_THAT_APPLY } from '../lib/words';
import { ARENA_ANSWER, ARENA_COUNTER, ARENA_FINALE, ARENA_PLACE } from '../lib/words/arena';
import { PROOF_CHECKER } from '../lib/words/proofcheck';
import type { Beat, Chapter } from './beats';
import { NO_PAY_IN_MAIN, type Expect } from './takes';

export type TryChapterId = 'try' | 'proof';

export const TRY_CHAPTERS: readonly Chapter<TryChapterId>[] = [
  { id: 'try', title: 'Try to break it' },
  { id: 'proof', title: 'Check the proof' },
];

/** The place's route in The Table. */
export const TRY_ROUTE = '#p=try';
/** The attack her signed rules refuse (a bid past her per-deal limit), then the one that asks for a
 *  payment tool the agent was never given. */
export const TRY_RULE = 'past-the-limit';
export const TRY_TOOL = 'pay-me-now';

function recorded(id: string): RecordedAttack {
  const a = attackById(id);
  if (!a) throw new Error(`the arena record has no attack ${id}`);
  return a;
}
const rule = recorded(TRY_RULE);
const tool = recorded(TRY_TOOL);
const both = [rule, tool];
const c = counters(both);
const summary = proofFile(both).summary;
const asked = (n: number): string => (n === 1 ? 'once' : `${n} times`);
/** The refusal the wallet sent back, as recorded. */
const heard = (a: RecordedAttack): string => (isRefusal(a.answer) ? a.answer.text : '');
const ruleOf = (a: RecordedAttack): string => (isRefusal(a.answer) ? ruleName(a.answer.code, a.answer.clause) : '');
/** The figure a card's title names, from the record (`Bid $900`, `Pay me $999 now`). */
const title = (a: RecordedAttack): string => ATTACK_WORDS[a.id]?.title ?? a.id;

export const TRY_BEATS: readonly Beat<TryChapterId>[] = [
  {
    id: 'try-open', chapter: 'try', at: 0, focus: 'main',
    caption: 'Try to break it. Maya’s agent sits at a recorded table and you play the attacker. Every answer is the real wallet’s own.',
    do: [{ do: 'approval', deal: null }, { do: 'arena', played: [] }, { do: 'main', open: true, route: TRY_ROUTE }],
  },
  {
    id: 'try-rule', chapter: 'try', at: 7, focus: 'main',
    caption: `First the agent tries “${title(rule)}”. Maya signed: no deal over ${wholeDollars(RECORD.rules.per_deal)}. The wallet refuses it, and PayPal is asked ${asked(rule.paypal_requests)}.`,
    do: [{ do: 'arena', played: [TRY_RULE] }],
  },
  {
    id: 'try-tool', chapter: 'try', at: 15, focus: 'main',
    caption: `Then “${title(tool)}”. The agent has no payment tool to call: nothing it can call moves money.`,
    do: [{ do: 'arena', played: [TRY_RULE, TRY_TOOL] }],
  },
  {
    id: 'try-count', chapter: 'try', at: 22, focus: 'main',
    caption: `Two attacks, and the counter says what they did: ${c.moved ?? 'nothing known'} moved, PayPal asked ${asked(c.asked)}.`,
    do: [{ do: 'arena', played: [TRY_RULE, TRY_TOOL] }],
  },
  {
    id: 'try-proof', chapter: 'proof', at: 27, focus: 'main',
    caption: 'Don’t take the page’s word for it. The closing card checks the attack’s signed file with the wallet’s own checks, in the page.',
    do: [{ do: 'arena', played: [TRY_RULE, TRY_TOOL], finale: true }],
  },
];

/** Seconds from the first beat to the end of the last caption. */
export const TRY_LENGTH = 35;

const fig = (big: string | number, small: string): RegExp => new RegExp(`${String(big).replace(/[.$]/g, (m) => `\\${m}`)}\\s*${small}`);
/** The counter at the top of the place: attacks, what moved, how often PayPal was asked. */
const COUNTER = (played: readonly RecordedAttack[]): Expect[] => {
  const k = counters(played);
  return [
    { in: 'main', text: fig(k.attacks, ARENA_COUNTER.attacks(k.attacks)) },
    { in: 'main', text: fig(k.moved ?? '—', ARENA_COUNTER.moved) },
    { in: 'main', text: fig(k.asked, ARENA_COUNTER.asked(k.asked)) },
  ];
};
/** An attack's answer on the table: why it held and what the wallet told the agent, both drawn only there. */
const ANSWER = (a: RecordedAttack): Expect[] => [
  { in: 'main', text: ATTACK_WORDS[a.id]?.held ?? a.id },
  { in: 'main', text: heard(a) },
  { in: 'main', text: ruleOf(a) },
];

/** Each "Try to break it" beat's settled end state: what the place draws, and no window offers to pay
 *  (the attack cards' own labels, "Pay me $999 now" and "Pay someone else", are not pay buttons: takes.ts
 *  isArenaAttackCard). */
export const TRY_EXPECT: Readonly<Record<string, readonly Expect[]>> = {
  'try-open': [
    { window: 'main', open: true },
    { window: 'approval', open: false },
    { in: 'main', text: ARENA_PLACE.title },
    { in: 'main', button: new RegExp(`^${ARENA_PLACE.attack}$`) },
    { in: 'main', text: ARENA_ANSWER.empty },
    ...COUNTER([]),
    NO_PAY_IN_MAIN,
  ],
  'try-rule': [
    ...ANSWER(rule),
    ...COUNTER([rule]),
    NO_PAY_IN_MAIN,
  ],
  'try-tool': [
    ...ANSWER(tool),
    // the table shows the newest answer only
    { in: 'main', text: heard(rule), absent: true },
    ...COUNTER(both),
    NO_PAY_IN_MAIN,
  ],
  'try-count': [
    ...COUNTER(both),
    { in: 'main', text: ARENA_ANSWER.paypalNone },
    NO_PAY_IN_MAIN,
  ],
  'try-proof': [
    { in: 'main', text: ARENA_FINALE.title(summary.distinct, summary.of) },
    { in: 'main', text: ARENA_FINALE.figures(summary.moved ?? '—', summary.paypal_requests, summary.paypal_calls, summary.money_operations) },
    // the proof checker ran every check on the attack's signed file, and none caught a problem
    { in: 'main', text: PROOF_ALL_THAT_APPLY },
    { in: 'main', text: PROOF_CHECKER.failed, absent: true },
    NO_PAY_IN_MAIN,
  ],
};
