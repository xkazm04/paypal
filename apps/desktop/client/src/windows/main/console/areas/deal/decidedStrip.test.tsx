// "Who decided" on the deal page shows each owner decision from the wallet's own record (the
// owner_decided step deal_history projects from the owner.decision row) as its strip: when, how many
// lines were recorded with it, and whether the lines checked later passed before payment.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../../../lib/contract';
import { mockBackend, resetMockState, STORE_KEY } from '../../../../../mock/backend';
import { buildMockState } from '../../../../../mock/fixtures';
import { shownTime } from '../../../deal/shown';
import { WorldProvider } from '../../../world';
import { StoryView } from './StoryView';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

describe('who decided, with the owner’s decisions', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); resetMockState(); });
  afterEach(() => { cleanup(); hoisted.current = null; });

  it('shows the decision strip for each owner decision, beside its money steps', async () => {
    const now = Math.floor(Date.now() / 1000);
    const world = buildMockState(now);
    const deal = world.deals.find((d) => d.display.label === 'D-0186')!;
    const at = now - 3600;
    const seq = (world.history ?? []).reduce((m, s) => Math.max(m, s.seq), 0) + 1;
    world.history = [...(world.history ?? []),
      { at, deal_id: deal.deal.id, seq, kind: 'owner_decided', state_after: null, authority: { type: 'owner' }, paypal: { type: 'none' },
        decision: { decision: 'deal_countersign', operation: 'create', checks: 6, later: 3, later_passed: 3, before_payment: true } },
      { at: at + 60, deal_id: deal.deal.id, seq: seq + 1, kind: 'owner_decided', state_after: null, authority: { type: 'owner' }, paypal: { type: 'none' },
        decision: { decision: 'deal_capture', operation: 'capture', checks: 6, later: 0, later_passed: 0, before_payment: false } },
    ];
    localStorage.setItem(STORE_KEY, JSON.stringify(world));
    hoisted.current = mockBackend('main');
    const { container } = render(
      <WorldProvider><StoryView deal={deal.deal} steps={[]} error={null} clauses={[]} theirName="Packrite" facts={[]} factsTitle="" title="Packing foam" /></WorldProvider>,
    );
    await waitFor(() => expect(container.querySelectorAll('.dv-decided')).toHaveLength(2), { timeout: 8000 });
    const strips = [...container.querySelectorAll('.dv-decided')].map((e) => e.textContent);
    expect(strips).toEqual([
      `Approved ${shownTime(at, now)} · 6 checks · 3 checked later, all passed before payment`,
      `Approved ${shownTime(at + 60, now)} · 6 checks`,
    ]);
    // Who decided it, in the list's own words: you, and the decision itself called nobody at PayPal.
    const row = container.querySelector('.dv-decided')!.closest('li')!;
    expect(row.querySelector('.by')?.textContent).toBe('You · no PayPal call');
  });
});
