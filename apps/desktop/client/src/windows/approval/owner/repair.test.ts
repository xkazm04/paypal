// One-click fixes for "This can't be signed yet": every repair is checked against the editor's
// own rules check (ruleProblems) before it is offered, and amounts are never filled in for you.
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULE_NAME } from '../../../lib/words';
import { emptyClause, newDraft, toLocalInput, type ClauseDraft, type MandateDraft } from '../mandateDraft';
import { templateDraft } from '../templates';
import { FixLine } from './FixLine';
import { applyAll, draftProblems, repairs } from './repair';

const T = 1_800_000_000;
const DAY = 86400;

afterEach(cleanup);

/** A draft that is complete apart from what the case changes: every required rule, amounts filled. */
function draft(over: Partial<Record<ClauseDraft['type'], ClauseDraft | null>>, extra: ClauseDraft[] = []): MandateDraft {
  const base: ClauseDraft[] = [
    { type: 'roles', roles: ['buy'] },
    { type: 'counterparties', rule: 'paired', keys: '' },
    { type: 'per_deal', kind: 'purchase', max: '50.00', categories: ['office'] },
    { type: 'velocity', deals: '3', total: '150.00' },
    { type: 'human_present_over', amount: '40.00' },
    { type: 'payees', payees: 'packrite' },
  ];
  const clauses = base.map((c) => (c.type in over ? over[c.type] : c)).filter((c): c is ClauseDraft => !!c);
  return { ...newDraft(T), clauses: [...clauses, ...extra] };
}
const whys = (d: MandateDraft) => draftProblems(d).map((p) => p.why);

const NEW = newDraft(T);
const RESCUE = draft({
  roles: { type: 'roles', roles: ['rescue'] },
  per_deal: { type: 'per_deal', kind: 'rescue', max: '50.00', categories: ['service'] },
});
const HAGGLE = draft({ per_deal: { type: 'per_deal', kind: 'haggle', max: '50.00', categories: ['office'] } });
const SELL_PURCHASE = draft({ roles: { type: 'roles', roles: ['sell'] } });
const LATE_BAND = draft({}, [{ type: 'band', items: 'dock', floor: '', ceiling: '45.00', rounds: '6', deadline: toLocalInput(T + 40 * DAY) }]);
const TWO_VELOCITY = draft({}, [{ type: 'velocity', deals: '9', total: '900.00' }]);

describe('repairs (owner/repair.ts)', () => {
  it('case 1: a new draft gets one fix that adds the three missing required rules at once', () => {
    expect(whys(NEW).filter((w) => w.endsWith('is required'))).toHaveLength(3);
    const rs = repairs(NEW, T);
    expect(rs.map((r) => r.label)).toEqual([`Add ${RULE_NAME.per_deal}, ${RULE_NAME.velocity} and ${RULE_NAME.payees}`]);
    const after = rs[0]!.apply(NEW);
    expect(after.clauses.map((c) => c.type)).toEqual(expect.arrayContaining(['per_deal', 'velocity', 'payees']));
    expect(whys(after).filter((w) => w.endsWith('is required'))).toEqual([]);
  });

  it('case 2: rescue rules get "add the fixes rule" and "your own subscribers"; fixing all clears both', () => {
    expect(draftProblems(RESCUE).map((p) => p.clause).sort()).toEqual([2, 8]);
    const labels = repairs(RESCUE, T).map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining([`Add ${RULE_NAME.lever}`, 'Deal only with your own subscribers']));
    const all = applyAll(RESCUE, T);
    expect(draftProblems(all).filter((p) => p.clause === 2 || p.clause === 8)).toEqual([]);
  });

  it('case 3: a haggle without a price range gets "Add a price range", which appends an empty one', () => {
    expect(whys(HAGGLE)).toContain('haggles and shop orders need a price range');
    const r = repairs(HAGGLE, T).find((x) => x.label === 'Add a price range');
    expect(r).toBeDefined();
    const after = r!.apply(HAGGLE);
    expect(after.clauses.at(-1)).toEqual(emptyClause('band', T));
    expect(whys(after)).not.toContain('haggles and shop orders need a price range');
  });

  it('case 4: selling with purchase deals switches the deal kind to invoice (haggle would need a range)', () => {
    const nothing = 'none of what you allowed agents to do fits this kind of deal, so nothing would ever be allowed';
    expect(whys(SELL_PURCHASE)).toContain(nothing);
    const rs = repairs(SELL_PURCHASE, T);
    expect(rs).toHaveLength(1);
    const after = rs[0]!.apply(SELL_PURCHASE);
    expect(after.clauses.find((c) => c.type === 'per_deal')).toMatchObject({ kind: 'invoice', max: '50.00' });
    expect(whys(after)).not.toContain(nothing);
  });

  it('case 5: a price range that ends after the rules gets moved to the rules’ end', () => {
    expect(whys(LATE_BAND)).toContain('it ends after the rules themselves end');
    const rs = repairs(LATE_BAND, T);
    expect(rs).toHaveLength(1);
    const after = rs[0]!.apply(LATE_BAND);
    expect(after.clauses.find((c) => c.type === 'band')).toMatchObject({ deadline: LATE_BAND.expires, ceiling: '45.00' });
    expect(whys(after)).not.toContain('it ends after the rules themselves end');
  });

  it('case 6: a rule listed twice loses the later copy', () => {
    expect(whys(TWO_VELOCITY)).toContain('it appears twice; there can be only one of each kind');
    const rs = repairs(TWO_VELOCITY, T);
    expect(rs).toHaveLength(1);
    const after = rs[0]!.apply(TWO_VELOCITY);
    expect(after.clauses.filter((c) => c.type === 'velocity')).toEqual([{ type: 'velocity', deals: '3', total: '150.00' }]);
    expect(draftProblems(after)).toEqual([]);
  });

  it('case 7: every repair offered strictly lowers the problem count; signable rules get none', () => {
    for (const d of [NEW, RESCUE, HAGGLE, SELL_PURCHASE, LATE_BAND, TWO_VELOCITY]) {
      const before = draftProblems(d).length;
      const rs = repairs(d, T);
      expect(rs.length).toBeGreaterThan(0);
      for (const r of rs) expect(draftProblems(r.apply(d)).length).toBeLessThan(before);
    }
    const careful = templateDraft('careful', T, { payees: ['packrite'] });
    expect(draftProblems(careful)).toEqual([]);
    expect(repairs(careful, T)).toEqual([]);
  });

  it('a fix never fills in an amount', () => {
    for (const d of [NEW, RESCUE, HAGGLE]) {
      const amounts = (x: MandateDraft) => x.clauses.flatMap((c) => ('max' in c ? [c.max] : 'total' in c ? [c.total] : 'amount' in c ? [c.amount] : 'ceiling' in c ? [c.floor, c.ceiling] : []));
      const after = applyAll(d, T);
      expect(amounts(after).filter(Boolean).sort()).toEqual(amounts(d).filter(Boolean).sort());
    }
  });
});

describe('FixLine', () => {
  it('case 8: the problem with a "Fix: …" button that applies the repair once; no repair, no button', () => {
    const p = draftProblems(HAGGLE)[0]!;
    const r = repairs(HAGGLE, T)[0]!;
    const onApply = vi.fn();
    render(createElement(FixLine, { draft: HAGGLE, now: T, problems: [p], repairs: [r], onApply }));
    fireEvent.click(screen.getByRole('button', { name: `Fix: ${r.label}` }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(r.apply(HAGGLE));
    expect(screen.queryByRole('button', { name: 'Fix all' })).toBeNull();
    cleanup();

    render(createElement(FixLine, { draft: HAGGLE, now: T, problems: [p], repairs: [], onApply }));
    expect(screen.getByText(new RegExp(p.why))).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('several fixes offer "Fix all", which applies every verified fix in one step', () => {
    const onApply = vi.fn();
    render(createElement(FixLine, { draft: RESCUE, now: T, problems: draftProblems(RESCUE), repairs: repairs(RESCUE, T), onApply }));
    fireEvent.click(screen.getByRole('button', { name: 'Fix all' }));
    expect(onApply).toHaveBeenCalledWith(applyAll(RESCUE, T));
  });
});
