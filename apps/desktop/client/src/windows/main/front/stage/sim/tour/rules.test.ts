// The rules proposal: the template reads into rules naming the practice shop as payee, a brand-new
// wallet can sign them in the approval context BEFORE the shop is connected, and her answer changes
// only what it said.
import { afterEach, describe, expect, it } from 'vitest';
import { mockBackend, resetMockState } from '../../../../../../mock/backend';
import { changeFrom, HOUSE_PAYEE, proposalOf, rulesCtx, RULES_START } from './rules';

const NOW = Math.floor(new Date('2026-11-06T09:30:00').getTime() / 1000);
const ctx = rulesCtx(NOW, -new Date(NOW * 1000).getTimezoneOffset());

afterEach(() => { history.replaceState(null, '', '/'); localStorage.clear(); });

describe('TOUR rules proposal', () => {
  it('reads the template into rules: per deal, per day, ask above, the practice shop, a week', () => {
    const p = proposalOf(RULES_START, ctx);
    expect(p).not.toBeNull();
    expect(p!.summary).toMatchObject({ perDeal: 100_00, perDay: 150_00, askAbove: 50_00, payees: [HOUSE_PAYEE] });
    expect(p!.summary.until).toBeGreaterThan(NOW + 6 * 86400);
  });

  it('a brand-new wallet signs it in the approval context before the shop is connected', async () => {
    localStorage.clear();
    history.replaceState(null, '', '/approval.html?target=mandate&first_run=1');
    resetMockState();
    const approval = mockBackend('approval');
    expect(await approval.invoke('counterparty_list', null)).toEqual([]);
    const d = proposalOf(RULES_START, ctx)!.draft;
    const token = await approval.invoke('approval_token', null);
    const m = await approval.invoke('mandate_sign', { id: null, agent: d.agent, clauses: d.clauses, not_before: d.not_before, expires: d.expires ?? NOW + 7 * 86400 }, { token });
    expect(m.payload.clauses.some((c) => c.type === 'payees' && c.payees.includes(HOUSE_PAYEE))).toBe(true);
  });

  it('her answer changes only what it said', () => {
    expect(changeFrom(RULES_START, 'make it $80 per deal', ctx)).toMatchObject({ next: { perDeal: 80_00, perDay: 150_00 }, changed: ['perDeal'] });
    expect(changeFrom(RULES_START, 'ask me above $20', ctx).next.askAbove).toBe(20_00);
    expect(changeFrom(RULES_START, 'for 3 days', ctx)).toMatchObject({ changed: ['ends'] });
    expect(changeFrom(RULES_START, 'what are rules?', ctx).changed).toEqual([]);
    const big = changeFrom(RULES_START, 'up to $300 each', ctx);
    expect(big.next.perDay).toBe(300_00);
    expect(proposalOf(big.next, ctx)?.summary.perDeal).toBe(300_00);
  });
});
