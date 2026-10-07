// The what-if, worded (pure). Rust answers mandate_simulate with its own check for the rules in
// force ("before") and the draft ("after") on each recorded deal of the week; this file only
// counts and words that answer. Layer 1 names rules in words, never a clause number.
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import { ruleNameOf } from '../../../lib/words';

export type Outcome = 'refused' | 'asks' | 'policy' | 'unknown';
export const OUTCOMES: readonly Outcome[] = ['refused', 'asks', 'policy', 'unknown'];
export const OUTCOME_LABEL: Record<Outcome, string> = { refused: 'refused', asks: 'asks you', policy: 'agent may', unknown: 'not checked' };

export function outcomeOf(v: SimulatedVerdict): Outcome {
  switch (v.type) {
    case 'allow': return 'policy';
    case 'ask': return 'asks';
    case 'refuse': return 'refused';
    case 'not_simulated': return 'unknown';
  }
}

/** Same outcome, and for a refusal the same rule and reason (the limit that binds can move). */
export function sameVerdict(a: SimulatedVerdict, b: SimulatedVerdict): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'refuse' && b.type === 'refuse') return a.clause === b.clause && a.reason === b.reason;
  if (a.type === 'ask' && b.type === 'ask') return a.clause === b.clause;
  return true;
}
export const changed = (l: SimulatedLine): boolean => !sameVerdict(l.before, l.after);

/** What withdrawing does to every line: with no rules in force, the check refuses (as Rust does). */
export function ifWithdrawn(lines: readonly SimulatedLine[]): SimulatedLine[] {
  return lines.map((l) => ({ ...l, after: l.after.type === 'not_simulated' ? l.after : { type: 'refuse', clause: 1, reason: 'mandate is not active' } }));
}

export function counts(lines: readonly SimulatedLine[], side: 'before' | 'after'): Record<Outcome, number> {
  const out: Record<Outcome, number> = { refused: 0, asks: 0, policy: 0, unknown: 0 };
  for (const l of lines) out[outcomeOf(l[side])] += 1;
  return out;
}

/** The one line above Sign: "This version would have refused 1, asked you about 2, allowed 6." */
export function summaryWords(lines: readonly SimulatedLine[], subject = 'This version'): string {
  if (!lines.length) return 'No deals this week to try these rules on.';
  const c = counts(lines, 'after');
  const unchecked = c.unknown ? `; ${c.unknown} couldn’t be checked` : '';
  return `${subject} would have refused ${c.refused}, asked you about ${c.asks}, allowed ${c.policy}${unchecked}.`;
}

/** Rust's refusal reasons in plain words, said after the rule's name (so never repeating it).
 *  Unknown reasons fall back to the rule's name alone. */
const REASON: ReadonlyArray<[RegExp, string]> = [
  [/category (\w+) not allowed/, '$1 isn’t an allowed category'],
  [/above max_amount/, 'the amount is over it'],
  [/deal kind not allowed/, 'not a kind of deal it covers'],
  [/payee not allowed/, 'this payee isn’t on it'],
  [/counterparty is not/, 'not a wallet it allows'],
  [/item outside band/, 'no price range for this item'],
  [/above ceiling/, 'price over the most you’ll pay'],
  [/below floor/, 'price under the least you’ll accept'],
  [/deadline reached/, 'the price range has ended'],
  [/max_rounds reached/, 'no offers left'],
  [/required side of band missing|band missing/, 'no price range for this side'],
  [/max_deals_day reached/, 'too many deals that day'],
  [/max_total_day exceeded/, 'over that day’s money limit'],
  [/role not allowed|role does not match/, 'not something agents may do'],
];
export function reasonWords(reason: string): string | null {
  for (const [re, words] of REASON) {
    const m = reason.match(re);
    if (m) return words.replace('$1', m[1] ?? '');
  }
  return null;
}

/** A verdict as one short phrase: the outcome and, for a refusal or a question, the rule in words. */
export function verdictWords(v: SimulatedVerdict): string {
  switch (v.type) {
    case 'allow': return 'the agent may do it on its own';
    case 'ask': return ruleNameOf(v.clause);
    case 'refuse': {
      if (v.reason === 'mandate is not active') return 'No rules in force';
      const why = reasonWords(v.reason);
      return why ? `${ruleNameOf(v.clause)} · ${why}` : ruleNameOf(v.clause);
    }
    case 'not_simulated': return 'a fact this needs isn’t on record, so it isn’t guessed';
  }
}

const join = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** "refused D-0190 before PayPal was asked; asked you about D-0186 …" for the lines that changed. */
export function hitPhrase(lines: readonly SimulatedLine[]): string {
  const g = { refused: [] as string[], passed: [] as string[], asked: [] as string[], policy: [] as string[], other: [] as string[] };
  for (const l of lines) {
    if (!changed(l)) continue;
    const a = outcomeOf(l.before);
    const b = outcomeOf(l.after);
    const t = `${l.label} (${l.title})`;
    if (b === 'refused' && a !== 'refused') g.refused.push(t);
    else if (a === 'refused' && b !== 'refused') g.passed.push(t);
    else if (b === 'asks' && a === 'policy') g.asked.push(t);
    else if (b === 'policy' && a === 'asks') g.policy.push(t);
    else g.other.push(t);
  }
  const p: string[] = [];
  if (g.refused.length) p.push(`refused ${join(g.refused)} before PayPal was asked`);
  if (g.passed.length) p.push(`let ${join(g.passed)} through`);
  if (g.asked.length) p.push(`asked you about ${join(g.asked)} instead of letting the agent decide`);
  if (g.policy.length) p.push(`let the agent settle ${join(g.policy)} without asking you`);
  if (g.other.length) p.push(`changed which rule stops ${join(g.other)}`);
  return p.join('; ');
}

