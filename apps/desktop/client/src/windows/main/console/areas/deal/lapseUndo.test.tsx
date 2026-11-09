// Undo a "Let it lapse" (deal_lapse_undo): offered after the owner let a deal lapse, until the
// deadline the lapse runs to, then gone with a line that says why. Busy, done and refused each show;
// the button's accessible name names the deal, so two rows never share one. The clock is pinned.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Backend } from '../../../../../lib/contract';
import { DEAL_DECIDE, LAPSE_UNDO } from '../../../../../lib/words';
import { mockBackend, resetMockState } from '../../../../../mock/backend';
import { WorldProvider } from '../../../world';
import { DealDecision } from './Decision';
import { LapseUndo } from './LapseUndo';
import { markLapsed, resetLapsed } from './lapsed';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const NOW = 1_800_000_000;
type Call = { cmd: string; args: unknown };

/** A backend whose invoke answers `answer(cmd)`; every call is recorded. */
function fake(answer: (cmd: string) => Promise<unknown>): { calls: Call[] } {
  const calls: Call[] = [];
  hoisted.current = { invoke: (cmd: string, args: unknown) => { calls.push({ cmd, args }); return answer(cmd); } } as unknown as Backend;
  return { calls };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
  resetLapsed();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  hoisted.current = null;
});

describe('LapseUndo', () => {
  it('shows nothing for a deal the owner did not let lapse here, or one that ended', () => {
    fake(async () => null);
    const { container, rerender } = render(<LapseUndo dealId="d1" title="Desk lamp" ended={false} />);
    expect(container.textContent).toBe('');
    markLapsed('d1', NOW + 3600);
    rerender(<LapseUndo dealId="d1" title="Desk lamp" ended />);
    expect(container.textContent).toBe('');
  });

  it('calls deal_lapse_undo with the deal, says it is busy, then leaves once the wallet answers', async () => {
    let answer!: (v: null) => void;
    const { calls } = fake(() => new Promise((r) => { answer = r; }));
    markLapsed('d1', NOW + 3600);
    render(<LapseUndo dealId="d1" title="Desk lamp" ended={false} />);
    const btn = screen.getByRole('button', { name: LAPSE_UNDO.undoLabel('Desk lamp') });
    fireEvent.click(btn);
    expect(calls).toEqual([{ cmd: 'deal_lapse_undo', args: { deal_id: 'd1' } }]);
    await waitFor(() => expect(btn.textContent).toBe(LAPSE_UNDO.undoing));
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { answer(null); });
    await waitFor(() => expect(screen.queryByRole('button', { name: LAPSE_UNDO.undoLabel('Desk lamp') })).toBeNull());
    expect(document.body.textContent).not.toContain(LAPSE_UNDO.gone);
  });

  it('a refusal stays on screen in the wallet’s words, and the undo can be tried again', async () => {
    fake(async () => { throw { code: 'INVALID', message: 'Invalid or stale wallet command' }; });
    markLapsed('d1', NOW + 3600);
    render(<LapseUndo dealId="d1" title="Desk lamp" ended={false} />);
    fireEvent.click(screen.getByRole('button', { name: LAPSE_UNDO.undoLabel('Desk lamp') }));
    const notice = await screen.findByRole('alert');
    expect(notice.textContent).toContain(LAPSE_UNDO.failed);
    expect(notice.textContent).toContain('Invalid or stale wallet command');
    expect((screen.getByRole('button', { name: LAPSE_UNDO.undoLabel('Desk lamp') }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('two lapsed deals: two undo buttons, two accessible names', () => {
    fake(async () => null);
    markLapsed('d1', NOW + 3600);
    markLapsed('d2', NOW + 7200);
    render(<><LapseUndo dealId="d1" title="Desk lamp" ended={false} /><LapseUndo dealId="d2" title="Monitor arm" ended={false} /></>);
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([LAPSE_UNDO.undoLabel('Desk lamp'), LAPSE_UNDO.undoLabel('Monitor arm')]);
    expect(new Set(names).size).toBe(2);
  });

  it('after the deadline the undo is gone and the line says why', () => {
    const { calls } = fake(async () => null);
    markLapsed('d1', NOW - 1);
    render(<LapseUndo dealId="d1" title="Desk lamp" ended={false} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(LAPSE_UNDO.gone)).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it('the deadline passing while it is on screen takes the button away (on the next clock tick)', async () => {
    fake(async () => null);
    markLapsed('d1', NOW + 60);
    render(<LapseUndo dealId="d1" title="Desk lamp" ended={false} />);
    expect(screen.getByRole('button', { name: LAPSE_UNDO.undoLabel('Desk lamp') })).toBeTruthy();
    vi.setSystemTime((NOW + 61) * 1000);
    await waitFor(() => expect(screen.queryByRole('button')).toBeNull(), { timeout: 2500 });
    expect(screen.getByText(LAPSE_UNDO.gone)).toBeTruthy();
  });
});

describe('the deal page: Let it lapse, then Undo', () => {
  it('after the wallet accepts the lapse, the page offers the undo; the undo puts the item back', async () => {
    localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html');
    resetMockState();
    const mock = mockBackend('main');
    const calls: Call[] = [];
    hoisted.current = { ...mock, invoke: (cmd: string, args: unknown, o?: unknown) => { calls.push({ cmd, args }); return (mock.invoke as (c: string, a: unknown, o?: unknown) => Promise<unknown>)(cmd, args, o); } } as unknown as Backend;
    const items = (await mock.invoke('attention_list', null)).items;
    const need = items.find((i: AttentionItem) => i.actions.includes('let_lapse') && i.deadline !== null)!;
    expect(need).toBeTruthy();
    const deal = await mock.invoke('get_deal', { deal_id: need.deal_id });
    const page = (n: AttentionItem | undefined) => <WorldProvider><DealDecision deal={deal} need={n} canWithdraw={false} theirName="them" them="them" readings={[]} deadline={need.deadline} /></WorldProvider>;
    const { rerender } = render(page(need));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(DEAL_DECIDE.lapse) }));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'deal_let_lapse')).toBe(true));
    // The item left the list (attention:changed): the page renders without it, and offers the undo.
    rerender(page(undefined));
    const undo = await screen.findByRole('button', { name: /^Undo letting / });
    fireEvent.click(undo);
    await waitFor(() => expect(calls.filter((c) => c.cmd === 'deal_lapse_undo')).toEqual([{ cmd: 'deal_lapse_undo', args: { deal_id: need.deal_id } }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo letting / })).toBeNull());
    const after = (await mock.invoke('attention_list', null)).items;
    expect(after.some((i: AttentionItem) => i.deal_id === need.deal_id)).toBe(true);
  });
});
