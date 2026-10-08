import { describe, expect, it } from 'vitest';
import type { MandatePayload } from '@bindings/MandatePayload';
import { mockValidate } from '../../mock/simulate';
import { buildMandate, fromLocalInput, previewClauses, ruleProblems } from './mandateDraft';
import { connectedPayees, templateBlanks, templateDraft, TEMPLATES } from './templates';

const NOW = 1_800_000_000;
const fill = { payees: ['packrite-supply', 'HOUSE'], item: 'monitor-24-ips' };
const problems = (d: ReturnType<typeof templateDraft>) => ruleProblems(previewClauses(d), fromLocalInput(d.notBefore), fromLocalInput(d.expires));

describe('starting rule sets for a first signature', () => {
  it('there are three, named by what they do', () => {
    expect(TEMPLATES.map((t) => t.name)).toEqual(['Careful: asks me above $50', 'Shop assistant', 'Haggler for one item']);
  });

  for (const t of TEMPLATES) {
    it(`${t.name}: once filled in, it builds and passes every rule the wallet checks before signing`, () => {
      const d = templateDraft(t.key, NOW, fill);
      expect(templateBlanks(d)).toEqual([]);
      const built = buildMandate(d);
      expect(built).toMatchObject({ ok: true });
      expect(problems(d)).toEqual([]);
      if (!built.ok) return;
      // The browser mock's mirror of the wallet's own validate() accepts it too.
      const payload = { id: 'M-1', version: 1, agent_key: [], clauses: built.clauses, not_before: built.notBefore, expires: built.expires } as unknown as MandatePayload;
      expect(mockValidate(payload)).toBeNull();
      // Valid from now for 30 days, in one currency, with the ask-me limit the name promises.
      expect(Math.round((built.expires - built.notBefore) / 86400)).toBe(30);
      expect(built.clauses.find((c) => c.type === 'payees')).toEqual({ type: 'payees', payees: ['packrite-supply', 'HOUSE'] });
      expect(new Set(built.clauses.flatMap((c) => ('amount' in c ? [c.amount.currency] : 'max_amount' in c ? [c.max_amount.currency] : []))).size).toBe(1);
    });
  }

  it('the amounts are the ones the cards show', () => {
    const careful = buildMandate(templateDraft('careful', NOW, fill));
    const haggle = buildMandate(templateDraft('haggle', NOW, fill));
    if (!careful.ok || !haggle.ok) throw new Error('templates must build');
    expect(careful.clauses).toContainEqual({ type: 'human_present_over', amount: { minor: 5000, currency: 'USD' } });
    expect(careful.clauses).toContainEqual({ type: 'per_deal', kind: 'purchase', max_amount: { minor: 10000, currency: 'USD' }, categories: ['office', 'parts'] });
    expect(careful.clauses).toContainEqual({ type: 'velocity', max_deals_day: 3, max_total_day: { minor: 15000, currency: 'USD' } });
    const band = haggle.clauses.find((c) => c.type === 'band');
    expect(band).toMatchObject({ item_refs: ['monitor-24-ips'], floor: null, ceiling: { minor: 25000, currency: 'USD' }, max_rounds: 6 });
    expect(haggle.clauses).toContainEqual({ type: 'human_present_over', amount: { minor: 20000, currency: 'USD' } });
  });

  it('what the wallet cannot know stays a blank the owner fills, and blocks signing until then', () => {
    const careful = templateDraft('careful', NOW, { payees: [] });
    expect(templateBlanks(careful)).toEqual(['payees']);
    expect(buildMandate(careful)).toMatchObject({ ok: false });
    const haggle = templateDraft('haggle', NOW, { payees: [] });
    expect(templateBlanks(haggle)).toEqual(['payees', 'item']);
    expect(problems(haggle).some((p) => p.clause === 4)).toBe(true);
  });

  it('who agents may pay starts from the wallets already connected', () => {
    expect(connectedPayees([
      { declared_payee: 'HOUSE' }, { declared_payee: null }, { declared_payee: 'cablehaus' }, { declared_payee: 'HOUSE' },
    ])).toEqual(['HOUSE', 'cablehaus']);
    expect(connectedPayees(undefined)).toEqual([]);
    expect(templateDraft('restock', NOW, { payees: [' cablehaus ', 'cablehaus', ''] }).clauses.find((c) => c.type === 'payees')).toEqual({ type: 'payees', payees: 'cablehaus' });
  });

  it('a template is only a draft: no id, so signing makes new rules', () => {
    for (const t of TEMPLATES) expect(templateDraft(t.key, NOW, fill)).toMatchObject({ id: null, agent: t.agent, currency: 'USD' });
  });
});
