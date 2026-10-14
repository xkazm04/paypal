// Agent rules (rebuild WP3c). Scale finding #15: on the busy merchant's eight rule sets (three of
// them the shopper's), every set reads differently - its agent, what it is for, its limits and its
// version - and picking one shows its full text in plain words with no rule numbers; Change and the
// "Your call" only hand off to the approval window (approval_open, target mandate).
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import { RULES_ACT, RULES_LIST } from '../../../../../lib/words';
import { expectLayerHealthy, renderLayerAtScale, settle } from '../../testing/scaleSmoke';
import { purposeOf } from './RulesLayer';

vi.mock('../../../../../lib/runtime', async () => (await import('../../testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

describe('agent rules', () => {
  it('names every rule set apart on the busy merchant (#15), and shows the picked one in full', async () => {
    const r = await renderLayerAtScale({ level: 'place', place: 'rules' }, 'large');
    expectLayerHealthy(r);
    const list = within(r.layer).getByRole('region', { name: RULES_LIST.label });
    const rows = [...list.querySelectorAll<HTMLButtonElement>('.le-row')];
    expect(rows.length).toBe(8);
    const labels = rows.map((b) => b.textContent ?? '');
    expect(new Set(labels).size).toBe(labels.length);
    for (const l of labels) expect(l).toMatch(/^(Shopper|Negotiator|Assistant) · /);
    fireEvent.click(rows[3] as HTMLButtonElement);
    const doc = await waitFor(() => { const d = r.layer.querySelector<HTMLElement>('.rl-doc'); if (!d) throw new Error('no doc'); return d; });
    expect(doc.textContent).not.toMatch(/clause|§|\b[1-9]\.\s|rule \d/i);
    const before = r.calls.length;
    fireEvent.click(within(doc).getByRole('button', { name: new RegExp(`^${RULES_ACT.changeOne}`) }));
    await settle();
    expect(r.calls.slice(before).filter((c) => c.cmd !== 'mandate_list' && c.cmd !== 'get_settings')).toEqual([{ cmd: 'approval_open', args: { deal_id: null, target: 'mandate' } }]);
  }, 60_000);

  it('says what a rule set is for in Maya’s words', () => {
    const per = (kind: 'purchase' | 'haggle', categories: Extract<Clause, { type: 'per_deal' }>['categories']): Clause => ({ type: 'per_deal', kind, max_amount: { minor: 50_000, currency: 'USD' }, categories });
    expect(purposeOf([per('purchase', ['office', 'parts'])])).toBe('purchase · office supplies, parts');
    expect(purposeOf([per('haggle', [])])).toBe('haggle');
    expect(purposeOf([{ type: 'roles', roles: ['buy'] }])).toMatch(/^may /);
  });
});
