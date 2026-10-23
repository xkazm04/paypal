// W7 in the approval window, on the mock backend's own deals: Withdraw (the button, or the W key
// with nothing focused) opens the "Withdraw <label>?" sheet; "Keep the deal" closes it and sends
// nothing; "Withdraw now" sends exactly one deal_withdraw for that deal and asks for no unlock
// (no Windows Hello); the sheet says so; and a deal that cannot be withdrawn has no Withdraw control.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';

const h = vi.hoisted(() => ({ current: null as Backend | null, calls: [] as { cmd: string; args: unknown }[] }));
vi.mock('../../lib/runtime', () => ({ backend: () => h.current }));

const { App } = await import('./App');

const SHEET_TITLE = (label: string) => `Withdraw ${label}?`;
const HELLO_LINE = 'Withdrawing can only stop money, so it doesn’t need Windows Hello.';
const NO_HELLO = new Set(['unlock', 'approval_unlock']);

beforeAll(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
beforeEach(() => { h.calls = []; });
afterEach(() => { cleanup(); resetMockState(); history.replaceState(null, '', '/'); });

/** Opens the approval window on one of the mock's deals, recording every command it sends. */
async function open(label: string) {
  history.replaceState(null, '', '/index.html');
  resetMockState();
  const deal = mockBackend('main').world.deal(label)!.deal;
  history.replaceState(null, '', `/approval.html?deal=${deal.id}`);
  const real = mockBackend('approval');
  h.current = {
    kind: real.kind, label: real.label, listen: real.listen,
    invoke: async (cmd, args, opts) => { h.calls.push({ cmd, args }); return real.invoke(cmd, args, opts); },
  };
  render(<App />);
  return { real, deal };
}
const sent = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);
const withdrawButton = () => screen.queryByRole('button', { name: 'Withdraw' });
const waitForWithdraw = () => waitFor(() => { const b = withdrawButton(); if (!b) throw new Error('no Withdraw yet'); return b; }, { timeout: 8000 });
const sheet = (label: string) => screen.queryByRole('dialog', { name: SHEET_TITLE(label) }) ?? screen.queryByText(SHEET_TITLE(label));

describe('W7: the withdraw confirmation in the approval window', () => {
  it('Withdraw opens the "Withdraw <label>?" sheet, which says it needs no Windows Hello', async () => {
    const { deal } = await open('D-0193');
    const label = 'D-0193';
    fireEvent.click(await waitForWithdraw());
    await waitFor(() => expect(sheet(label)).not.toBeNull());
    expect(screen.getByText(HELLO_LINE)).toBeTruthy();
    expect(sent('deal_withdraw')).toHaveLength(0);
    expect(deal.id).toBeTruthy();
  });

  it('the W key opens the same sheet when no input or sheet has focus', async () => {
    await open('D-0193');
    await waitForWithdraw();
    expect(sheet('D-0193')).toBeNull();
    fireEvent.keyDown(window, { key: 'w' });
    await waitFor(() => expect(sheet('D-0193')).not.toBeNull());
    expect(sent('deal_withdraw')).toHaveLength(0);
  });

  it('"Keep the deal" closes the sheet and sends no deal_withdraw', async () => {
    const { real } = await open('D-0193');
    fireEvent.click(await waitForWithdraw());
    await waitFor(() => expect(sheet('D-0193')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Keep the deal' }));
    await waitFor(() => expect(sheet('D-0193')).toBeNull());
    expect(sent('deal_withdraw')).toHaveLength(0);
    expect(real.world.deal('D-0193')!.deal.state).not.toBe('WITHDRAWN');
  });

  it('"Withdraw now" sends exactly one deal_withdraw for that deal and asks for no unlock', async () => {
    const { real, deal } = await open('D-0193');
    fireEvent.click(await waitForWithdraw());
    await waitFor(() => expect(sheet('D-0193')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw now' }));
    await waitFor(() => expect(sent('deal_withdraw')).toHaveLength(1));
    expect(sent('deal_withdraw')[0]?.args).toEqual({ deal_id: deal.id });
    await waitFor(() => expect(real.world.deal('D-0193')!.deal.state).toBe('WITHDRAWN'));
    expect(h.calls.filter((c) => NO_HELLO.has(c.cmd))).toHaveLength(0);
    expect(sheet('D-0193')).toBeNull();
  });

  it('a deal that cannot be withdrawn renders no Withdraw control and the W key opens nothing', async () => {
    const { real } = await open('D-0187');
    expect(real.world.deal('D-0187')!.deal.state).not.toBe('WITHDRAWN');
    await waitFor(() => expect(h.calls.some((c) => c.cmd === 'approval_summary')).toBe(true));
    // Let the review draw (its heading), then look for the control.
    await waitFor(() => expect(document.getElementById('dr-h')).not.toBeNull(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(withdrawButton()).toBeNull();
    expect(within(document.body).queryByText(/^Withdraw$/)).toBeNull();
    fireEvent.keyDown(window, { key: 'W' });
    await new Promise((r) => setTimeout(r, 100));
    expect(sheet('D-0187')).toBeNull();
  });
});
