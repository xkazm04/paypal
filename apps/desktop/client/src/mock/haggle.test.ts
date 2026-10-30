// One truth for Maya's haggle rules: the mandate the preview shows her signing (M-14, the one Dan's
// table D-0193 runs under) says exactly what the engine's recording ran under (mock/haggle.json, written
// by table-runtime's haggle recorder, which the arena replays): her top price, her limit per deal, the
// price above which she decides, and her number of offers.
import { describe, expect, it } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { buildMockState } from './fixtures';
import { DAN_LABEL, RECORDED } from './haggle';

describe('the recorded rules are the rules Maya signed', () => {
  it('M-14 (Dan’s table’s mandate) equals haggle.json’s rules', () => {
    const state = buildMockState(1_800_000_000);
    const dan = state.deals.find((d) => d.display.label === DAN_LABEL);
    if (!dan) throw new Error('no D-0193');
    const signed = state.mandates.find((m) => m.payload.id === dan.deal.mandate_id && m.payload.version === dan.deal.mandate_version);
    if (!signed) throw new Error('D-0193 names no mandate the world holds');
    const clause = <T extends Clause['type']>(type: T) => signed.payload.clauses.find((c): c is Extract<Clause, { type: T }> => c.type === type);
    const band = clause('band');
    const rules = RECORDED.dan.rules;
    expect(RECORDED.house.rules).toEqual(rules);
    expect(band?.ceiling?.minor).toBe(rules.ceiling);
    expect(band?.floor?.minor ?? null).toBe(rules.floor);
    expect(band?.max_rounds).toBe(rules.max_offers);
    expect(clause('per_deal')?.max_amount.minor).toBe(rules.per_deal);
    expect(clause('human_present_over')?.amount.minor).toBe(rules.ask_above);
  });
});
