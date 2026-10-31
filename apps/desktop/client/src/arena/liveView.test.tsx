// Live mode in Break The Table: while live.ts reports the sandbox's table, the judge's own agent's newest
// move lands on the table in the same answer view as a recorded card, labelled "Live: your agent app",
// its closed refusal code named like a recorded one; a typed note goes to the live table, capped at the
// sandbox's 280 characters.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider } from '../lib/data/provider';
import { ARENA_LIVE_MODE, ARENA_NOTE_MAX, RULE_NAME } from '../lib/words/arena';
import { mockBackend, resetMockState } from '../mock/backend';
import { setHarnessBackend } from '../windows/main/console/testing/runtime';
import type { LiveState } from './live';

vi.mock('../lib/runtime', async () => (await import('../windows/main/console/testing/runtime')).runtimeMock);
const live = vi.hoisted(() => ({ state: { status: 'recorded' } as LiveState, sent: [] as string[] }));
vi.mock('./live', () => ({
  useLive: () => live.state,
  sendLiveNote: async (text: string) => { live.sent.push(text); return true; },
}));

const { BreakTheTable } = await import('./BreakTheTable');

describe('live mode', () => {
  beforeEach(() => { resetMockState(); live.sent = []; });
  afterEach(() => { cleanup(); setHarnessBackend(null); live.state = { status: 'recorded' }; });

  it('lands the newest live move in the answer view, labelled live, with its rule named', async () => {
    live.state = { status: 'live', table: 'T-1', answers: [
      { at: '2026-10-31T00:00:00.000Z', tool: 'send_offer', verdict: 'yes', rule: null, sentence: 'Offer sent.', paypalAsked: 0 },
      { at: '2026-10-31T00:00:01.000Z', tool: 'send_offer', verdict: 'no', rule: 'call_budget', sentence: 'Too many calls this turn. Nothing moved.', paypalAsked: 0 },
    ] };
    setHarnessBackend(mockBackend('main'));
    render(<DataProvider scope="main"><BreakTheTable host="page" /></DataProvider>);
    const card = await waitFor(() => { const el = document.querySelector<HTMLElement>('.ar-drop [data-live]'); if (!el) throw new Error('no live answer'); return el; });
    expect(card.textContent).toContain(ARENA_LIVE_MODE.label);
    expect(card.textContent).toContain('Too many calls this turn. Nothing moved.');
    expect(card.textContent).toContain(RULE_NAME.call_budget!);
    expect(card.querySelector('.ar-stamp')?.textContent).toBe(ARENA_LIVE_MODE.no);
  });

  it('sends a typed note to the live table, never more than the sandbox takes', async () => {
    live.state = { status: 'live', table: null, answers: [] };
    setHarnessBackend(mockBackend('main'));
    render(<DataProvider scope="main"><BreakTheTable host="page" /></DataProvider>);
    const box = screen.getByLabelText('Your note, as the seller') as HTMLTextAreaElement;
    expect(box.maxLength).toBe(ARENA_NOTE_MAX);
    fireEvent.change(box, { target: { value: 'x'.repeat(ARENA_NOTE_MAX + 20) } });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Send as the seller' })); });
    await waitFor(() => expect(live.sent).toHaveLength(1));
    expect(live.sent[0]).toHaveLength(ARENA_NOTE_MAX);
    await screen.findByText(ARENA_LIVE_MODE.noteSent);
  });
});
