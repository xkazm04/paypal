// One-click fixes for "This can't be signed yet". Each candidate is tried against the editor's own
// rules check (ruleProblems, the client's one mirror of Rust's validate) and offered only when it
// strictly lowers the number of problems, so this file holds no copy of the rules. A fix only
// shapes the draft: it never fills in an amount, never signs, and Rust re-checks on sign.
import { ruleRefusals } from '../../../lib/mandateRules';
import { joinWords, kindWord, RULE_NAME } from '../../../lib/words';
import { CLAUSE_NUMBER, emptyClause, fromLocalInput, KINDS, previewClauses, ruleProblems, type ClauseDraft, type ClauseType, type MandateDraft, type RuleProblem } from '../mandateDraft';

export type Repair = {
  /** What the fix does, in the owner's words ("Add a price range"); the button reads "Fix: <label>". */
  label: string;
  /** The rule number of the problem it removes. */
  clause: number;
  /** The problem it removes (the first one gone after applying it). */
  fixes: RuleProblem;
  apply: (d: MandateDraft) => MandateDraft;
};

/** The draft's problems, exactly as the editor's footer reads them. */
export function draftProblems(d: MandateDraft): RuleProblem[] {
  return ruleProblems(previewClauses(d), fromLocalInput(d.notBefore), fromLocalInput(d.expires));
}

const REQUIRED: readonly ClauseType[] = (Object.keys(CLAUSE_NUMBER) as ClauseType[])
  .filter((t) => [1, 2, 3, 5, 6, 7].includes(CLAUSE_NUMBER[t]))
  .sort((a, b) => CLAUSE_NUMBER[a] - CLAUSE_NUMBER[b]);

const append = (d: MandateDraft, ...cs: ClauseDraft[]): MandateDraft => ({ ...d, clauses: [...d.clauses, ...cs] });
const mapType = <T extends ClauseType>(d: MandateDraft, type: T, f: (c: Extract<ClauseDraft, { type: T }>) => ClauseDraft, onlyFirst = false): MandateDraft => {
  let done = false;
  return {
    ...d,
    clauses: d.clauses.map((c) => {
      if (c.type !== type || (onlyFirst && done)) return c;
      done = true;
      return f(c as Extract<ClauseDraft, { type: T }>);
    }),
  };
};

type Candidate = { label: string; apply: (d: MandateDraft) => MandateDraft };

/** Every fix worth trying for the draft's current refusals (unverified). */
function candidates(d: MandateDraft, now: number): Candidate[] {
  const pclauses = previewClauses(d);
  const refusals = ruleRefusals(pclauses, fromLocalInput(d.notBefore), fromLocalInput(d.expires));
  const has = (reason: string) => refusals.some((r) => r.reason === reason);
  const out: Candidate[] = [];
  const roles = d.clauses.find((c): c is Extract<ClauseDraft, { type: 'roles' }> => c.type === 'roles');
  const rescue = !!roles?.roles.includes('rescue');

  if (has('duplicate clause')) {
    // The later copy goes: Rust reads the first one.
    for (const t of new Set(d.clauses.map((c) => c.type))) {
      if (d.clauses.filter((c) => c.type === t).length < 2) continue;
      out.push({
        label: `Remove the second ${RULE_NAME[t]}`,
        apply: (x) => ({ ...x, clauses: x.clauses.filter((c, i) => c.type !== t || x.clauses.findIndex((y) => y.type === t) === i) }),
      });
    }
  }
  if (has('required clause missing')) {
    const missing = REQUIRED.filter((t) => !d.clauses.some((c) => c.type === t));
    if (missing.length) out.push({ label: `Add ${joinWords(missing.map((t) => RULE_NAME[t]))}`, apply: (x) => append(x, ...missing.map((t) => emptyClause(t, now))) });
  }
  if (has('the rescue role and the fixes clause go together') && rescue && !d.clauses.some((c) => c.type === 'lever')) {
    out.push({ label: `Add ${RULE_NAME.lever}`, apply: (x) => append(x, emptyClause('lever', now)) });
  }
  if (has('rescue deals only with your own subscribers, in a mandate of its own') && rescue) {
    const cp = d.clauses.find((c) => c.type === 'counterparties');
    if (!cp || cp.rule !== 'subscribers') {
      out.push({
        label: 'Deal only with your own subscribers',
        apply: (x) => (x.clauses.some((c) => c.type === 'counterparties')
          ? mapType(x, 'counterparties', (c) => ({ ...c, rule: 'subscribers', keys: '' }))
          : append(x, { type: 'counterparties', rule: 'subscribers', keys: '' })),
      });
    }
    if (roles && roles.roles.length > 1) out.push({ label: 'Allow only rescuing renewals', apply: (x) => mapType(x, 'roles', (c) => ({ ...c, roles: ['rescue'] }), true) });
  }
  if (has('band required for haggle and shop orders') && !d.clauses.some((c) => c.type === 'band')) {
    out.push({ label: 'Add a price range', apply: (x) => append(x, emptyClause('band', now)) });
  }
  if (has('no role in the roles clause can act on the per-deal kind')) {
    // The first deal kind, in KINDS order, that the allowed jobs can act on and that leaves fewer
    // problems (a haggle without a price range only trades one problem for another).
    const per = d.clauses.find((c): c is Extract<ClauseDraft, { type: 'per_deal' }> => c.type === 'per_deal');
    const count = draftProblems(d).length;
    const kind = per && KINDS.find((k) => k !== per.kind && draftProblems(mapType(d, 'per_deal', (c) => ({ ...c, kind: k }), true)).length < count);
    if (kind) out.push({ label: `Switch to ${kindWord(kind)} deals`, apply: (x) => mapType(x, 'per_deal', (c) => ({ ...c, kind }), true) });
  }
  if (refusals.some((r) => r.reason === 'invalid band' && (r.why === 'it ends after the rules themselves end' || r.why === 'it ends before the rules start')) && fromLocalInput(d.expires) !== null) {
    out.push({ label: 'End the price range when the rules end', apply: (x) => mapType(x, 'band', (c) => ({ ...c, deadline: x.expires }), true) });
  }
  return out;
}

const key = (p: RuleProblem) => `${p.clause}\u0000${p.why}`;

/** The fixes for this draft, each verified to strictly lower its problem count, in the order of
 *  the problems they remove. Empty when the draft has no problem a fix can remove. */
export function repairs(d: MandateDraft, now: number): Repair[] {
  const before = draftProblems(d);
  if (!before.length) return [];
  const out: Repair[] = [];
  for (const c of candidates(d, now)) {
    const after = draftProblems(c.apply(d));
    if (after.length >= before.length) continue;
    // The first problem it removes, counting repeats (two "appears twice" lines are two problems).
    const left = new Map<string, number>();
    for (const p of after) left.set(key(p), (left.get(key(p)) ?? 0) + 1);
    const fixes = before.find((p) => {
      const n = left.get(key(p)) ?? 0;
      left.set(key(p), n - 1);
      return n <= 0;
    }) ?? before[0]!;
    out.push({ label: c.label, clause: fixes.clause, fixes, apply: c.apply });
  }
  const at = (r: Repair) => before.indexOf(r.fixes);
  return out.sort((a, b) => at(a) - at(b));
}

/** Every fix, one at a time, each re-verified against the draft it applies to. Stops when no fix
 *  is left; each step strictly lowers the problem count, so it always ends. */
export function applyAll(d: MandateDraft, now: number): MandateDraft {
  let x = d;
  for (;;) {
    const r = repairs(x, now)[0];
    if (!r) return x;
    x = r.apply(x);
  }
}
