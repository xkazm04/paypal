// Pure logic for the Spend page (The Gate, prototype/pages/spend/variant-2): which mandate clauses
// stand as gate columns, and what each ask's lane can honestly say at each clause.
//
// The contract carries no per-clause trace and no refusal text (no command returns them). Deal
// does carry decided_by, the authority Rust recorded. So a lane only states what follows from
// facts the client holds:
//   - a deal that reached PayPal passed every clause before its first call (the mandate check runs
//     before any network call, AGENTS.md) → "pass";
//   - a REFUSED ask whose decided_by names a policy clause → "fail" at that clause (Rust's recorded
//     decision), "pass" for the clauses Rust checked before it, "skip" after it;
//   - the clause an open attention item names → "you" (Rust says that clause kept the decision);
//   - a per-deal clause for another deal kind → "na";
//   - a REFUSED ask whose total is over a per-deal max → "fail", marked as computed here from the
//     signed mandate (not Rust's recorded reason); clauses after it → "skip" (not reached);
//   - everything else → "unknown" (drawn dashed, never as passed).
// No React, no IPC; unit-tested in gate.test.ts.
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Clause } from '@bindings/Clause';
import type { Deal } from '@bindings/Deal';
import type { DealState } from '@bindings/DealState';
import { formatMinor } from '../../../../lib/format';
import { kindWord, RULE_NAME, stateWord } from '../../../../lib/words';
import { dealTotal } from '../../logic';

export type GateColumn = { n: number; clause: Clause };
export type CellKind = 'pass' | 'you' | 'fail' | 'skip' | 'na' | 'unknown';
export type Cell = { n: number; kind: CellKind; text: string; computed: boolean };

/** Clauses that gate a purchase, numbered as the mandate numbers them (1-based, in order).
 *  The haggle band and the counterparty-pairing rule govern Tables, not purchases. */
export function gateColumns(clauses: readonly Clause[]): GateColumn[] {
  return clauses.map((clause, i) => ({ n: i + 1, clause })).filter((c) => c.clause.type !== 'band' && c.clause.type !== 'counterparties' && c.clause.type !== 'market_watch');
}

/** Short column titles for the gate (the full rule name, RULE_NAME, goes in tooltips and Layer 2). */
export const COLUMN_NAME: Record<Clause['type'], string> = {
  roles: 'Allowed', counterparties: 'Who', per_deal: 'Per purchase', band: 'Price range', velocity: 'Daily limit', human_present_over: 'Ask me', payees: 'Payees',
  market_watch: 'Prices',
};

const money = (m: { minor: number; currency: Parameters<typeof formatMinor>[1] }) => formatMinor(m.minor, m.currency).replace(/\.00$/, '');

/** The one figure a rule column carries under its title ("up to $200", "above $250", "2 approved"). */
export function columnValue(c: Clause): string {
  switch (c.type) {
    case 'roles': return c.roles.includes('buy') ? 'may buy' : 'may not buy';
    case 'per_deal': return `up to ${money(c.max_amount)}`;
    case 'velocity': return `${c.max_deals_day} a day`;
    case 'human_present_over': return `above ${money(c.amount)}`;
    case 'payees': return `${c.payees.length} approved`;
    case 'counterparties': return c.rule.type === 'paired' ? 'connected only' : c.rule.type === 'house' ? 'house only' : `${c.rule.keys.length} verified`;
    case 'band': return c.ceiling ? `up to ${money(c.ceiling)}` : 'any price';
    case 'market_watch': return `${c.max_refreshes_day} checks a day`;
  }
}

const AT_PAYPAL: ReadonlySet<DealState> = new Set<DealState>([
  'AWAITING_APPROVAL', 'APPROVED', 'AUTHORIZED', 'CAPTURED', 'RECEIPTED', 'RECONCILED', 'VOIDED', 'AUTO_VOIDED', 'REFUNDED', 'DISPUTED',
]);

/** Whether the ask got as far as a PayPal call (an id on file, or a state only PayPal produces). */
export function reachedPaypal(d: Pick<Deal, 'state' | 'paypal'>): boolean {
  const p = d.paypal;
  return !!(p.order || p.authorization || p.capture || p.subscription) || AT_PAYPAL.has(d.state);
}

/** A per-deal clause re-read against the deal's own total, here in the client. */
export function perDealCheck(d: Pick<Deal, 'kind' | 'terms'>, c: Extract<Clause, { type: 'per_deal' }>): { over: boolean; text: string } | null {
  if (c.kind !== d.kind) return null;
  const t = dealTotal(d);
  if (t.currency !== c.max_amount.currency) return { over: false, text: `priced in ${t.currency}, the limit is in ${c.max_amount.currency}, so they are not compared` };
  const over = t.minor > c.max_amount.minor;
  return { over, text: `${formatMinor(t.minor, t.currency)} is ${over ? 'over' : 'within'} the ${formatMinor(c.max_amount.minor, c.max_amount.currency)} limit` };
}

/** Rust's clause numbers (Clause::number): a refusal names the clause by type, not by position. */
export const CLAUSE_NO: Record<Clause['type'], number> = { roles: 1, counterparties: 2, per_deal: 3, band: 4, velocity: 5, human_present_over: 6, payees: 7, market_watch: 9 };

/** One lane: what the ask can be said to have met at each gate column. */
export function laneCells(d: Pick<Deal, 'kind' | 'terms' | 'state' | 'paypal'> & Partial<Pick<Deal, 'decided_by'>>, cols: readonly GateColumn[], need?: Pick<AttentionItem, 'clause'> | null): Cell[] {
  const youAt = need?.clause?.number ?? null;
  const refused = d.state === 'REFUSED';
  const reached = reachedPaypal(d);
  // The clause Rust recorded as refusing this ask, and its column (absent when it is not drawn).
  const recorded = refused && d.decided_by?.type === 'policy' ? d.decided_by.clause : null;
  const recordedCol = recorded === null ? undefined : cols.find((c) => CLAUSE_NO[c.clause.type] === recorded);
  let stopped = false;
  return cols.map(({ n, clause }): Cell => {
    if (stopped) return { n, kind: 'skip', text: 'not checked, an earlier rule stopped it', computed: true };
    if (clause.type === 'per_deal' && clause.kind !== d.kind) return { n, kind: 'na', text: `only for ${kindWord(clause.kind)} deals`, computed: false };
    if (recordedCol && recordedCol.n === n) {
      stopped = true;
      // The recorded decision names the rule; for a per-purchase limit the amounts say why, in words.
      const why = clause.type === 'per_deal' ? perDealCheck(d, clause) : null;
      return { n, kind: 'fail', text: why?.over ? why.text : 'this rule refused it', computed: false };
    }
    if (recordedCol && n < recordedCol.n) return { n, kind: 'pass', text: 'passed', computed: false };
    // AttentionItem.clause.number is Rust's Clause::number (by type), not the clause's position.
    if (youAt === CLAUSE_NO[clause.type]) return { n, kind: 'you', text: 'leaves this decision to you', computed: false };
    if (refused && clause.type === 'per_deal') {
      const r = perDealCheck(d, clause);
      if (r?.over) { stopped = true; return { n, kind: 'fail', text: r.text, computed: true }; }
    }
    if (reached) return { n, kind: 'pass', text: 'passed', computed: true };
    return { n, kind: 'unknown', text: refused ? 'not known: the refusal did not name a rule' : 'not checked yet', computed: false };
  });
}

export type Outcome = { kind: 'refused' | 'held' | 'paid' | 'voided' | 'waiting' | 'other'; label: string; tone: 'red' | 'gold' | 'ok' | 'line' | 'teal' };

/** The "At PayPal" end of a lane. */
export function outcomeOf(d: Pick<Deal, 'state'>): Outcome {
  switch (d.state) {
    case 'REFUSED': return { kind: 'refused', label: 'Refused', tone: 'red' };
    case 'AUTHORIZED': return { kind: 'held', label: 'On hold', tone: 'gold' };
    case 'CAPTURED': case 'RECEIPTED': case 'RECONCILED': return { kind: 'paid', label: 'Paid', tone: 'ok' };
    case 'VOIDED': case 'AUTO_VOIDED': return { kind: 'voided', label: 'Hold released', tone: 'line' };
    case 'AWAITING_APPROVAL': case 'APPROVED': return { kind: 'waiting', label: stateWord(d.state).text, tone: 'gold' };
    default: return { kind: 'other', label: stateWord(d.state).text, tone: 'teal' };
  }
}

export type RuleLine = { kind: 'pass' | 'ask' | 'fail' | 'unknown'; text: string };

/** One plain line for a purchase's row: did it pass the owner's rules? Built only from the lane's
 *  cells, so it never says "passed" for a rule the client could not place (that is `unknown`). */
export function ruleLine(cells: readonly Cell[], cols: readonly GateColumn[]): RuleLine {
  const clauseOf = (c: Cell) => cols.find((x) => x.n === c.n)?.clause;
  const fail = cells.find((c) => c.kind === 'fail');
  if (fail) {
    const cl = clauseOf(fail);
    return { kind: 'fail', text: cl?.type === 'per_deal' ? `Over the per-deal limit (${money(cl.max_amount)})` : `Stopped by your “${cl ? RULE_NAME[cl.type] : 'rules'}” rule` };
  }
  const you = cells.find((c) => c.kind === 'you');
  if (you) {
    const cl = clauseOf(you);
    return { kind: 'ask', text: cl ? `Your “${RULE_NAME[cl.type]}” rule asks you` : 'Your rules ask you' };
  }
  if (!cells.length || cells.some((c) => c.kind === 'unknown' || c.kind === 'skip')) return { kind: 'unknown', text: 'Not every rule could be shown here' };
  return { kind: 'pass', text: 'Passed your rules' };
}

export type ClauseGroups =Record<'fail' | 'you' | 'pass' | 'unknown', string[]>;

/** "This week at clause n": which lanes it stopped, sent to you, passed, or cannot be said. */
export function clauseGroups(lanes: ReadonlyArray<{ id: string; cells: readonly Cell[] }>, n: number): ClauseGroups {
  const g: ClauseGroups = { fail: [], you: [], pass: [], unknown: [] };
  for (const l of lanes) {
    const c = l.cells.find((x) => x.n === n);
    if (!c || c.kind === 'na') continue;
    if (c.kind === 'skip') g.unknown.push(l.id);
    else g[c.kind].push(l.id);
  }
  return g;
}

/** Clause-5 meter: today's wallet spend against the velocity cap, or null (unknown) when the
 *  meters are not attached or the currencies differ. Never a fake zero. */
export function velocityFill(spentMinor: number, spentCurrency: string | null | undefined, cap: Extract<Clause, { type: 'velocity' }> | undefined, available: boolean): number | null {
  if (!available || !cap || !spentCurrency || spentCurrency !== cap.max_total_day.currency || cap.max_total_day.minor <= 0) return null;
  return Math.min(1, Math.max(0, spentMinor / cap.max_total_day.minor));
}
