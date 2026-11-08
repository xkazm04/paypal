// The scorer of the board's view-choice evaluation. Pure functions: one case's outcome in, one score
// out; scores in, the aggregate out; the aggregate in, the printed table out.
//
// Every reply first passes the REAL door (validateReply), exactly as the board would receive it:
// schema validity is the first score, and everything after it is scored on what the owner would see
// (the validated reply), never on the raw text. An engine failure (timeout, no CLI, bad output) is
// scored as an unreadable reply, so it counts against schema validity and misses whatever was expected.
//
// Definitions (README.md repeats them):
//  - schema-valid: the door kept every part (nothing dropped) and the reply was readable. Cleaned text
//    (`repaired`) still counts as valid; it is reported on its own line.
//  - exact choice: the panels shown are exactly the panels expected (any order, identity fields
//    matching where the case names them, nothing extra). Only cases whose panels are labelled count.
//  - false trigger: a panel when the honest answer is a sentence, an act proposal the case did not
//    expect, or anything the case's must-not list names. Rate over every case.
//  - missed trigger: an expected panel kind that is absent, or an expected act proposal that is absent.
//    A right kind with the wrong identity (another deal) is a wrong choice, not a missed trigger. Rate
//    over the cases that expect something (a labelled panel or an act).
//  - pass: schema-valid, exact choice (when labelled), every expected act present, no false trigger.
import type { ActionRef, PanelKind, PanelSpec, UiOp, ValidatedReply } from '../contract';
import { PANEL_KINDS } from '../contract';
import { validateReply, type Known } from '../validate';
import { ACTION_CLASS } from '../vocabulary';
import { isNegative, type ActExpect, type EvalCase, type PanelExpect } from './cases';

/** What an arm produced for one case: a raw (untrusted) reply, or the engine's failure word. */
export type Outcome =
  | { ok: true; raw: unknown; ms?: number; cost_usd?: number | null }
  | { ok: false; error: string; ms?: number };

export type CaseScore = {
  id: string;
  negative: boolean;
  error: string | null;
  schema_valid: boolean;
  repaired: boolean;
  dropped: number;
  dropped_reasons: string[];
  shown: PanelSpec[];
  proposed: ActionRef[];
  /** null when the case does not label panels ('any'). */
  exact: boolean | null;
  missed_panels: PanelKind[];
  wrong_identity: PanelKind[];
  extra_panels: PanelKind[];
  missed_acts: string[];
  unexpected_acts: string[];
  must_not_hits: string[];
  /** Expected kind -> shown kind pairs for the confusion table ('-' is "no panel"). */
  pairs: [string, string][];
  panel_when_prose: boolean;
  false_trigger: boolean;
  missed_trigger: boolean;
  pass: boolean;
};

export const NONE = '-';

const IDENTITY = ['deal_id', 'module', 'fate'] as const;

function identityMatches(e: PanelExpect, s: PanelSpec): boolean {
  const shown = s as unknown as Record<string, unknown>;
  for (const k of IDENTITY) {
    if (!Object.prototype.hasOwnProperty.call(e, k)) continue;
    if (shown[k] !== e[k]) return false;
  }
  return true;
}

function actMatches(e: ActExpect, a: ActionRef): boolean {
  if (e.action !== a.action) return false;
  if (e.action === 'pause_agent') return a.action === 'pause_agent' && a.agent === e.agent;
  if (e.action === 'let_lapse') return a.action === 'let_lapse' && a.deal_id === e.deal_id;
  return true;
}

const actName = (a: ActionRef | ActExpect): string => {
  if (a.action === 'pause_agent') return `pause_agent:${a.agent}`;
  if (a.action === 'let_lapse') return `let_lapse:${a.deal_id}`;
  return a.action;
};

const isShow = (o: UiOp): o is Extract<UiOp, { op: 'show' }> => o.op === 'show';
const isPropose = (o: UiOp): o is Extract<UiOp, { op: 'propose' }> => o.op === 'propose';

/** Score one case. `known` is the board's deal ids, as the board would pass them to the door. */
export function scoreCase(c: EvalCase, outcome: Outcome, known: Known): CaseScore {
  const v: ValidatedReply = outcome.ok ? validateReply(outcome.raw, known) : validateReply(undefined, known);
  const readable = !v.dropped.reasons.includes('unreadable');
  const schema_valid = outcome.ok && readable && v.dropped.count === 0;

  const shown = v.ops.filter(isShow).map((o) => o.panel);
  const proposed = v.ops.filter(isPropose).map((o) => o.action);
  const acts = proposed.filter((a) => ACTION_CLASS[a.action] === 'act');

  // Panels: exact matches first, then right kind with the wrong identity, then what is left.
  const expected = c.expect.panels === 'any' ? [] : c.expect.panels;
  const used = new Set<number>();
  const pairs: [string, string][] = [];
  const unmatched: PanelExpect[] = [];
  for (const e of expected) {
    const i = shown.findIndex((s, j) => !used.has(j) && s.kind === e.kind && identityMatches(e, s));
    if (i >= 0) { used.add(i); pairs.push([e.kind, e.kind]); } else unmatched.push(e);
  }
  const wrong_identity: PanelKind[] = [];
  const missing: PanelExpect[] = [];
  for (const e of unmatched) {
    const i = shown.findIndex((s, j) => !used.has(j) && s.kind === e.kind);
    if (i >= 0) { used.add(i); wrong_identity.push(e.kind); pairs.push([e.kind, e.kind]); } else missing.push(e);
  }
  const extra = shown.filter((_, j) => !used.has(j));
  if (c.expect.panels !== 'any') {
    const n = Math.max(missing.length, extra.length);
    for (let i = 0; i < n; i++) pairs.push([missing[i]?.kind ?? NONE, extra[i]?.kind ?? NONE]);
    if (expected.length === 0 && shown.length === 0) pairs.push([NONE, NONE]);
  }
  const missed_panels = missing.map((e) => e.kind);
  const extra_panels = c.expect.panels === 'any' ? [] : extra.map((s) => s.kind);
  const exact = c.expect.panels === 'any' ? null : missing.length === 0 && wrong_identity.length === 0 && extra.length === 0;

  // Acts: every expected act must appear; any other act is unexpected.
  const usedAct = new Set<number>();
  const missed_acts: string[] = [];
  for (const e of c.expect.propose ?? []) {
    const i = acts.findIndex((a, j) => !usedAct.has(j) && actMatches(e, a));
    if (i >= 0) usedAct.add(i); else missed_acts.push(actName(e));
  }
  const unexpected_acts = acts.filter((_, j) => !usedAct.has(j)).map(actName);

  const must_not_hits: string[] = [];
  for (const m of c.expect.must_not ?? []) {
    if (m.kind === 'panel') { if (shown.some((s) => s.kind === m.panel)) must_not_hits.push(`panel:${m.panel}`); }
    else if (m.kind === 'action') { for (const a of proposed) if (a.action === m.action) must_not_hits.push(`action:${actName(a)}`); }
    else for (const a of acts) must_not_hits.push(`any_act:${actName(a)}`);
  }

  const panel_when_prose = c.expect.panels !== 'any' && c.expect.panels.length === 0 && shown.length > 0;
  const false_trigger = panel_when_prose || unexpected_acts.length > 0 || must_not_hits.length > 0;
  const missed_trigger = missed_panels.length > 0 || missed_acts.length > 0;
  const pass = schema_valid && exact !== false && missed_acts.length === 0 && !false_trigger;

  return {
    id: c.id,
    negative: isNegative(c),
    error: outcome.ok ? null : outcome.error,
    schema_valid,
    repaired: v.repaired,
    dropped: v.dropped.count,
    dropped_reasons: [...v.dropped.reasons],
    shown,
    proposed,
    exact,
    missed_panels,
    wrong_identity,
    extra_panels,
    missed_acts,
    unexpected_acts,
    must_not_hits,
    pairs,
    panel_when_prose,
    false_trigger,
    missed_trigger,
    pass,
  };
}

export type Rate = { hit: number; of: number };

export type Aggregate = {
  n: number;
  negatives: number;
  errors: number;
  repaired: number;
  /** Cases where a panel of the right kind named the wrong deal, module or fate. */
  wrong_identity: number;
  schema_valid: Rate;
  exact_choice: Rate;
  false_trigger: Rate;
  false_trigger_by: { panel_when_prose: number; unexpected_act: number; must_not: number };
  missed_trigger: Rate;
  pass: Rate;
  /** confusion[expected][shown] = count; keys are panel kinds and '-' (no panel). */
  confusion: Record<string, Record<string, number>>;
};

const expectsSomething = (c: EvalCase): boolean => (c.expect.panels !== 'any' && c.expect.panels.length > 0) || (c.expect.propose ?? []).length > 0;

/** Aggregate the scores of a run. `cases` must be the cases the scores came from (same ids). */
export function aggregate(cases: readonly EvalCase[], scores: readonly CaseScore[]): Aggregate {
  const byId = new Map(cases.map((c) => [c.id, c]));
  const of = (pred: (s: CaseScore, c: EvalCase) => boolean, within: (s: CaseScore, c: EvalCase) => boolean = () => true): Rate => {
    let hit = 0;
    let n = 0;
    for (const s of scores) {
      const c = byId.get(s.id);
      if (!c || !within(s, c)) continue;
      n++;
      if (pred(s, c)) hit++;
    }
    return { hit, of: n };
  };
  const confusion: Record<string, Record<string, number>> = {};
  for (const s of scores) for (const [e, g] of s.pairs) {
    const row = (confusion[e] ??= {});
    row[g] = (row[g] ?? 0) + 1;
  }
  return {
    n: scores.length,
    negatives: scores.filter((s) => s.negative).length,
    errors: scores.filter((s) => s.error !== null).length,
    repaired: scores.filter((s) => s.repaired).length,
    wrong_identity: scores.filter((s) => s.wrong_identity.length > 0).length,
    schema_valid: of((s) => s.schema_valid),
    exact_choice: of((s) => s.exact === true, (_, c) => c.expect.panels !== 'any'),
    false_trigger: of((s) => s.false_trigger),
    false_trigger_by: {
      panel_when_prose: scores.filter((s) => s.panel_when_prose).length,
      unexpected_act: scores.filter((s) => s.unexpected_acts.length > 0).length,
      must_not: scores.filter((s) => s.must_not_hits.length > 0).length,
    },
    missed_trigger: of((s) => s.missed_trigger, (_, c) => expectsSomething(c)),
    pass: of((s) => s.pass),
    confusion,
  };
}

export const pct = (r: Rate): string => (r.of === 0 ? 'n/a' : `${((r.hit / r.of) * 100).toFixed(1)}%`);
const rate = (label: string, r: Rate): string => `${label.padEnd(16)}${`${r.hit}/${r.of}`.padStart(7)}  ${pct(r).padStart(6)}`;

/** Why a case failed, in a few fixed words (for the table's failure list). */
export function failureWords(s: CaseScore): string {
  const parts: string[] = [];
  if (s.error) parts.push(`engine ${s.error}`);
  else if (!s.schema_valid) parts.push(`dropped ${s.dropped} (${s.dropped_reasons.join(', ')})`);
  if (s.missed_panels.length) parts.push(`missed ${s.missed_panels.join('+')}`);
  if (s.wrong_identity.length) parts.push(`wrong identity ${s.wrong_identity.join('+')}`);
  if (s.panel_when_prose) parts.push('panel when prose');
  if (s.extra_panels.length) parts.push(`extra ${s.extra_panels.join('+')}`);
  if (s.missed_acts.length) parts.push(`missed act ${s.missed_acts.join('+')}`);
  if (s.unexpected_acts.length) parts.push(`unexpected act ${s.unexpected_acts.join('+')}`);
  if (s.must_not_hits.length) parts.push(`must-not ${s.must_not_hits.join('+')}`);
  return parts.join('; ');
}

/** The printed table: the five figures, the false-trigger breakdown, the confusion counts, the failures. */
export function formatTable(title: string, agg: Aggregate, scores: readonly CaseScore[] = []): string {
  const kinds = [...PANEL_KINDS, NONE].filter((k) => agg.confusion[k] || Object.values(agg.confusion).some((r) => r[k]));
  const rows = [...PANEL_KINDS, NONE].filter((k) => agg.confusion[k]);
  const cell = (s: string): string => s.padStart(9);
  const lines = [
    title,
    `n ${agg.n}, negatives ${agg.negatives}, engine errors ${agg.errors}, repaired ${agg.repaired}, wrong identity ${agg.wrong_identity}`,
    rate('schema-valid', agg.schema_valid),
    rate('exact choice', agg.exact_choice),
    rate('false trigger', agg.false_trigger) + `  (panel when prose ${agg.false_trigger_by.panel_when_prose}, unexpected act ${agg.false_trigger_by.unexpected_act}, must-not ${agg.false_trigger_by.must_not})`,
    rate('missed trigger', agg.missed_trigger),
    rate('pass', agg.pass),
    `confusion (rows expected, columns shown, ${NONE} = no panel):`,
    `${''.padEnd(10)}${kinds.map(cell).join('')}`,
    ...rows.map((r) => `${r.padEnd(10)}${kinds.map((k) => cell(String(agg.confusion[r]?.[k] ?? '.'))).join('')}`),
  ];
  const failed = scores.filter((s) => !s.pass);
  if (failed.length) lines.push(`failed (${failed.length}):`, ...failed.map((s) => `  ${s.id}: ${failureWords(s)}`));
  return lines.join('\n');
}
