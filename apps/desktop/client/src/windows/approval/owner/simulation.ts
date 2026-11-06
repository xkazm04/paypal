// The what-if, worded (pure). Rust answers mandate_simulate with its own check for the rules in
// force ("before") and the draft ("after") on each recorded deal of the week; this file only
// counts and words that answer. Layer 1 names rules in words, never a clause number.
import type { SimulatedLine } from '@bindings/SimulatedLine';
import type { SimulatedVerdict } from '@bindings/SimulatedVerdict';
import type { Money } from '@bindings/Money';
import { formatMoney } from '../../../lib/format';
import { ruleNameOf, WHATIF_FIRST_RULE, WHATIF_NO_CHANGE } from '../../../lib/words';

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
/** The deal's OUTCOME differs (refused / asks / agent may); a refusal that only changes which rule stops it does not count. */
export const outcomeChanged = (l: SimulatedLine): boolean => outcomeOf(l.before) !== outcomeOf(l.after);
/** Still the same outcome, but a different rule or reason stops or asks. */
export const ruleOnlyChanged = (l: SimulatedLine): boolean => changed(l) && !outcomeChanged(l);

/** "1 deal", "3 deals". */
export const countOf = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Money on deals whose outcome changes, from each row's own amount, one total per currency.
 *  null when nothing moves or any such row has no known amount (shown as a dash, never guessed). */
export function movedMoney(lines: readonly SimulatedLine[]): Money[] | null {
  const rows = lines.filter(outcomeChanged);
  if (!rows.length || rows.some((l) => !l.amount || l.before.type === 'not_simulated' || l.after.type === 'not_simulated')) return null;
  const by = new Map<string, number>();
  for (const l of rows) by.set(l.amount!.currency, (by.get(l.amount!.currency) ?? 0) + l.amount!.minor);
  return [...by].map(([currency, minor]) => ({ minor, currency }) as Money);
}
export const movedMoneyWords = (lines: readonly SimulatedLine[]): string => {
  const m = movedMoney(lines);
  return m ? m.map((x) => formatMoney(x)).join(' + ') : '—';
};

/** The headline: only deals whose outcome changes are "gone differently"; rule-only changes are said apart. */
export function headlineWords(lines: readonly SimulatedLine[], firstRule = false): string {
  if (firstRule) return WHATIF_FIRST_RULE;
  const o = lines.filter(outcomeChanged).length;
  const r = lines.filter(ruleOnlyChanged).length;
  const head = o ? `${countOf(o, 'deal would', 'deals would')} have gone differently this week (${movedMoneyWords(lines)} moved differently).` : WHATIF_NO_CHANGE;
  return r ? `${head} ${countOf(r, 'other deal is', 'other deals are')} still refused, by a different rule.` : head;
}

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
  [/currency not allowed|currency outside band|threshold currency mismatch/, 'the deal is in another currency'],
  [/invalid daily currency or total/, 'that day’s total couldn’t be added up in its currency'],
  [/invalid terms or amount/, 'the deal’s amount couldn’t be worked out'],
  [/fixes clause missing/, 'no “Fixes for failed renewals” rule'],
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

