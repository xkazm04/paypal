// T12 mock parity: mandate_simulate answers from the fixtures the way Rust's check would, on the
// card's three cases (docs/concepts/moonshot-cards.md "approval-window-2"), and keeps its gates.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clause } from '@bindings/Clause';
import type { MandateSimulation } from '@bindings/MandateSimulation';
import { mockBackend, resetMockState } from './backend';
import { fakeUlid } from './fixtures';

const NOW = 1_800_000_000;
const M12 = fakeUlid('M-12');
const M14 = fakeUlid('M-14');

function approval() {
  history.replaceState(null, '', '/approval.html?target=mandate');
  return mockBackend('approval');
}
async function simulate(id: string, edit: (cs: Clause[]) => Clause[]): Promise<MandateSimulation> {
  const a = approval();
  const m = (await a.invoke('mandate_list', null)).find((e) => e.payload.id === id)!;
  return a.invoke('mandate_simulate', { draft: { id, agent: m.agent, clauses: edit(m.payload.clauses), not_before: m.payload.not_before, expires: m.payload.expires } });
}
const at = (s: MandateSimulation, label: string) => s.lines.find((l) => l.label === label)!;

describe('mandate_simulate (browser mock)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW * 1000);
    localStorage.clear(); sessionStorage.clear(); resetMockState();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('unchanged rules: every line keeps its verdict; a deal with no category is not simulated', async () => {
    const s = await simulate(M12, (cs) => cs);
    expect(s.lines.every((l) => JSON.stringify(l.before) === JSON.stringify(l.after))).toBe(true);
    expect(at(s, 'D-0190').before).toEqual({ type: 'allow' });
    expect(at(s, 'D-0192').before).toMatchObject({ type: 'refuse', clause: 3, reason: 'max_amount $200 per deal; category compute not allowed' });
    expect(at(s, 'D-0180').before).toEqual({ type: 'not_simulated' });
    expect(s.not_simulated).toBe(1);
    expect(s.to - s.from).toBe(7 * 86400);
  });

  it('(a) ask-me lowered to $50: the $64 dock now asks, the $45 packing still passes', async () => {
    const s = await simulate(M12, (cs) => cs.map((c) => (c.type === 'human_present_over' ? { ...c, amount: { minor: 5000, currency: 'USD' } } : c)));
    expect(at(s, 'D-0190')).toMatchObject({ before: { type: 'allow' }, after: { type: 'ask', clause: 6 } });
    expect(at(s, 'D-0186')).toMatchObject({ before: { type: 'allow' }, after: { type: 'allow' } });
  });

  it('(b) compute added: the GPU order is still refused, now by the $200 per-deal limit', async () => {
    const s = await simulate(M12, (cs) => cs.map((c) => (c.type === 'per_deal' ? { ...c, categories: [...c.categories, 'compute'] } : c)));
    const gpu = at(s, 'D-0192');
    expect(gpu.before).toMatchObject({ type: 'refuse', clause: 3, reason: 'max_amount $200 per deal; category compute not allowed' });
    expect(gpu.after).toEqual({ type: 'refuse', clause: 3, reason: 'amount 11960.00 above max_amount $200 per deal' });
  });

  it('(c) north-desk removed from the payees: Dan’s haggles are refused by the payee rule', async () => {
    const s = await simulate(M14, (cs) => cs.map((c) => (c.type === 'payees' ? { ...c, payees: c.payees.filter((p) => p !== 'north-desk') } : c)));
    for (const label of ['D-0193', 'D-0187', 'D-0199']) {
      expect(at(s, label).before.type).not.toBe('refuse');
      expect(at(s, label).after).toMatchObject({ type: 'refuse', clause: 7 });
    }
    // The $455 monitor is over the $340 limit per deal: refused by that rule first, either way.
    expect(at(s, 'D-0176')).toMatchObject({ before: { type: 'refuse', clause: 3 }, after: { type: 'refuse', clause: 3 } });
    // The house seller's payee stays approved.
    expect(at(s, 'D-0201').after.type).not.toBe('refuse');
  });

  it('an invalid draft is REFUSED with its reason; other windows are refused; nothing is written', async () => {
    const before = localStorage.getItem('the-table-mock-state-v6');
    await expect(simulate(M12, (cs) => cs.filter((c) => c.type !== 'roles'))).rejects.toMatchObject({ code: 'REFUSED', message: 'mandate clause 1: required clause missing' });
    history.replaceState(null, '', '/index.html');
    const main = mockBackend('main');
    const m = (await main.invoke('mandate_list', null))[0]!;
    await expect(main.invoke('mandate_simulate', { draft: { id: m.payload.id, agent: m.agent, clauses: m.payload.clauses, not_before: m.payload.not_before, expires: m.payload.expires } })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(localStorage.getItem('the-table-mock-state-v6')).toBe(before);
  });

  it('a new mandate replays the deals of the agent it is for', async () => {
    const a = approval();
    const m = (await a.invoke('mandate_list', null)).find((e) => e.payload.id === M12)!;
    const s = await a.invoke('mandate_simulate', { draft: { id: null, agent: 'shopper', clauses: m.payload.clauses, not_before: m.payload.not_before, expires: m.payload.expires } });
    expect(s.lines.map((l) => l.label).sort()).toEqual(['D-0180', 'D-0181', 'D-0183', 'D-0186', 'D-0190', 'D-0192', 'D-0196', 'D-0198']);
  });
});
