// TOUR round 4, the rules step's proposal: a ready set of rules in plain words, read by the wallet's
// own fixed-grammar reader (lib/say, no model) into the approval window's rules draft.
//   - The proposal is a template (per deal, per day, ask me above, how long) said as ONE sentence and
//     read by read() + rulesOf(): the reader, not this file, decides the clauses.
//   - The payee is the practice shop. Signing rules needs at least one approved payee (the approval
//     editor: "Approved payees: list at least one payee"), and a brand-new wallet has none until the
//     shop is connected. The house seller always declares the payee "HOUSE" (pairing_confirm pins it
//     with declared_payee 'HOUSE'), so the reader's context names it up front and the rules can be
//     signed BEFORE the shop is met: mandate_sign checks the clauses' shape (validate()), not that a
//     payee is connected yet. That keeps the owner's order: keys, rules, then the next steps.
//   - "Change something": her answer is read by the same reader; every amount or end it SAID replaces
//     the template's, and the sentence is read again. Nothing it is unsure of is guessed.
// Pure: no React, no IO.
import type { ApprovalDraft } from '@bindings/ApprovalDraft';
import type { Clause } from '@bindings/Clause';
import { rulesOf } from '../../../../lib/say/draft';
import { read, type SayCtx, type Slot } from '../../../../lib/say/read';

/** The house seller's declared payee (mock/backend.ts pairing_confirm; Rust's house pin says the same). */
export const HOUSE_PAYEE = 'HOUSE';

/** The parts of the proposal she can change by saying so. Amounts in minor units (USD). */
export type RulesAsk = { perDeal: number; perDay: number; askAbove: number; ends: string };

/** The proposal the step opens with: small amounts, one week, practice shop only. */
export const RULES_START: RulesAsk = { perDeal: 100_00, perDay: 150_00, askAbove: 50_00, ends: 'for a week' };

const usd = (minor: number): string => `$${minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100)}`;

/** The proposal as one sentence the reader understands. */
export function sentenceOf(a: RulesAsk): string {
  return `Buy supplies up to ${usd(a.perDeal)} each, ${usd(a.perDay)} a day, ask me above ${usd(a.askAbove)}, from the house seller, ${a.ends}`;
}

/** The reader's context: the wallet's clock and the practice shop as the one payee. */
export function rulesCtx(now: number, offsetMin: number): SayCtx {
  return { now, offsetMin, payees: [HOUSE_PAYEE], housePayees: [HOUSE_PAYEE], items: [] };
}

/** What the summary card shows, read back from the clauses the draft carries (never from the template). */
export type RulesSummary = { perDeal: number | null; perDay: number | null; askAbove: number | null; payees: readonly string[]; until: number | null };

export type RulesProposal = { sentence: string; draft: Extract<ApprovalDraft, { type: 'rules' }>; summary: RulesSummary };

const clause = <T extends Clause['type']>(cs: readonly Clause[], t: T): Extract<Clause, { type: T }> | undefined =>
  cs.find((c): c is Extract<Clause, { type: T }> => c.type === t);

/** The proposal read into the approval window's rules draft; null when the reader cannot make rules of it. */
export function proposalOf(a: RulesAsk, ctx: SayCtx): RulesProposal | null {
  const sentence = sentenceOf(a);
  const r = rulesOf(read(sentence, ctx), ctx);
  if (!r) return null;
  const draft: RulesProposal['draft'] = { type: 'rules', agent: r.agent, not_before: r.not_before, clauses: r.clauses, ...(r.expires === undefined ? {} : { expires: r.expires }) };
  const cs = r.clauses;
  return {
    sentence,
    draft,
    summary: {
      perDeal: clause(cs, 'per_deal')?.max_amount.minor ?? null,
      perDay: clause(cs, 'velocity')?.max_total_day.minor ?? null,
      askAbove: clause(cs, 'human_present_over')?.amount.minor ?? null,
      payees: clause(cs, 'payees')?.payees ?? [],
      until: r.expires ?? null,
    },
  };
}

/** The reader takes a per-deal amount only after "up to" / "max" ("up to $80 each"); an answer to a
 *  proposal says it bare ("$80 per deal", "$80 each"). Only that phrase is reworded, to the reader's. */
export function perDealWords(answer: string): string {
  return answer.replace(/(^|[^\w$])(?<!up to |max |than |limit )(\$\s?\d[\d,]*(?:\.\d+)?)\s+(?:(?:per|a|each|every)\s+(?:deal|purchase|order|payment|buy)|each)\b/gi,
    (_m, pre: string, amt: string) => `${pre}up to ${amt} each`);
}

/** Which parts of the proposal her answer changed. */
export type RulesChange = { next: RulesAsk; changed: readonly (keyof RulesAsk)[] };

/** Her answer ("make it $80 a deal", "ask me above $20", "for 3 days"), read by the same reader:
 *  only what it SAID replaces the proposal's value. Nothing said, nothing changed. */
export function changeFrom(a: RulesAsk, answer: string, ctx: SayCtx): RulesChange {
  const r = read(perDealWords(answer), ctx);
  const said = (s: Slot) => r.from[s] === 'said' && !r.unsure.has(s);
  const next: RulesAsk = { ...a };
  const changed: (keyof RulesAsk)[] = [];
  const f = r.facts;
  if (said('ceiling') && f.ceiling !== null && f.ceiling > 0) { next.perDeal = f.ceiling; changed.push('perDeal'); }
  if (said('dayTotal') && f.dayTotal !== null && f.dayTotal > 0) { next.perDay = f.dayTotal; changed.push('perDay'); }
  if (said('ask') && f.ask !== null) { next.askAbove = f.ask; changed.push('askAbove'); }
  if (said('ends') && r.heard.ends) { next.ends = r.heard.ends; changed.push('ends'); }
  // A day can never hold less than one deal: a per-deal limit raised past the day's lifts the day too.
  if (next.perDay < next.perDeal) { next.perDay = next.perDeal; if (!changed.includes('perDay')) changed.push('perDay'); }
  // Asking above more than a deal may cost means never asking: keep it under the per-deal limit.
  if (next.askAbove > next.perDeal) { next.askAbove = next.perDeal; if (!changed.includes('askAbove')) changed.push('askAbove'); }
  return { next, changed };
}
