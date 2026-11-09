// Cutting off a connected wallet (counterparty_revoke) in the approval window: a row action per
// pinned wallet opens one confirmation that says who (name and the key's short form), what stops,
// what happens to open deals and that the row stays listed; only a full hold sends the command (a
// click never does), with the window's token; busy, done and refused each show; a locked window asks
// to unlock first; each row's button has its own accessible name; a wallet cut off reads "cut off".
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CounterpartyDisplay } from '@bindings/CounterpartyDisplay';
import { WalletError } from '../../../lib/contract';
import { APPROVAL_CUT_OFF as W } from '../../../lib/words';
import { HOLD_MS } from '../../../design/motion';

const call = vi.fn();
const unlock = vi.fn();
const session = { tokenReady: true, pending: null as string | null, unlocking: false, call, unlock };
vi.mock('../session', () => ({ useSession: () => session }));

const { ConnectedRow, ConnectedSheet, keyShort, listed, resetCut } = await import('./Connected');

const KEY_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const KEY_B = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
const KEY_C = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const cp = (key_id: string, display_name: string, pairing: CounterpartyDisplay['pairing'] = 'words_confirmed'): CounterpartyDisplay => ({
  key_id, display_name, house: pairing === 'house_pinned', first_seen: 1_790_000_000, deals_closed: 2, pairing, declared_payee: null,
} as CounterpartyDisplay);
const LIST = [cp(KEY_A, 'packrite-supply'), cp(KEY_B, 'cablehaus'), cp(KEY_C, 'Unpaired counterparty', 'unpaired')];

/** A full hold of the gesture: pointer down, HOLD_MS of frames, released after. */
function hold(btn: HTMLElement) {
  fireEvent.pointerDown(btn, { button: 0 });
  act(() => { vi.advanceTimersByTime(HOLD_MS + 50); });
  fireEvent.pointerUp(btn);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  resetCut();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  call.mockReset();
  unlock.mockReset();
  session.pending = null;
});

const open = (locked = false, onChanged = vi.fn()) => {
  const r = render(<ConnectedSheet list={LIST} locked={locked} onClose={() => {}} onChanged={onChanged} />);
  return { ...r, onChanged };
};

describe('connected wallets in the approval window', () => {
  it('lists every pinned wallet, never a key that was never confirmed', () => {
    expect(listed(LIST, new Map()).map((r) => r.name)).toEqual(['packrite-supply', 'cablehaus']);
  });

  it('the owner page row counts them and opens the sheet', () => {
    const onOpen = vi.fn();
    render(<ConnectedRow list={LIST} error={null} onOpen={onOpen} />);
    expect(screen.getByText(W.rowSub(2))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: W.manageLabel }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('each row has its own Cut off, named by who and their key', () => {
    open();
    const names = screen.getAllByRole('button', { name: /^Cut off / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([W.actLabel('packrite-supply', keyShort(KEY_A)), W.actLabel('cablehaus', keyShort(KEY_B))]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('the confirmation says who, the key’s short form, what stops, open deals and that the row stays', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: W.actLabel('cablehaus', keyShort(KEY_B)) }));
    const sheet = screen.getByRole('dialog', { name: W.ask('cablehaus') });
    const text = sheet.textContent ?? '';
    expect(text).toContain(keyShort(KEY_B));
    expect(text).not.toContain(KEY_B);
    for (const line of [W.stopsWhat, W.openWhat, W.afterWhat, W.money]) expect(text).toContain(line);
  });

  it('a click never cuts off; a full hold sends counterparty_revoke with the key and the token', async () => {
    let answer!: (v: unknown) => void;
    call.mockImplementation(() => { session.pending = 'counterparty_revoke'; return new Promise((r) => { answer = r; }); });
    const { onChanged, rerender } = open();
    fireEvent.click(screen.getByRole('button', { name: W.actLabel('cablehaus', keyShort(KEY_B)) }));
    const btn = screen.getByRole('button', { name: new RegExp(W.hold('cablehaus')) });
    fireEvent.click(btn);
    fireEvent.keyDown(btn, { key: 'Enter' });
    act(() => { vi.advanceTimersByTime(HOLD_MS * 2); });
    expect(call).not.toHaveBeenCalled();
    hold(btn);
    expect(call).toHaveBeenCalledWith('counterparty_revoke', { key_id: KEY_B }, true);
    // Busy: the hold reads "Cutting off…" and cannot be held again.
    rerender(<ConnectedSheet list={LIST} locked={false} onClose={() => {}} onChanged={onChanged} />);
    const busy = screen.getByRole('button', { name: new RegExp(W.cutting) });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    session.pending = null;
    await act(async () => { answer({ ok: true, value: null }); });
    // Done: back on the list, the row reads cut off (no Cut off of its own), and the list is read again.
    expect(screen.getByRole('status').textContent).toBe(W.done('cablehaus'));
    const row = screen.getByText('cablehaus').closest('.ui-row') as HTMLElement;
    expect(within(row).getByText(W.cutOff)).toBeTruthy();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it('stays listed as cut off after the wallet lists the key as unpaired', () => {
    const after = [cp(KEY_A, 'packrite-supply'), cp(KEY_B, 'Unpaired counterparty', 'unpaired')];
    const rows = listed(after, new Map([[KEY_B, 'cablehaus']]));
    expect(rows.map((r) => [r.name, r.state])).toEqual([['packrite-supply', 'connected'], ['cablehaus', 'cut']]);
  });

  it('a refusal stays on screen in the wallet’s words, and nothing is marked', async () => {
    call.mockResolvedValue({ ok: false, error: new WalletError({ code: 'NOT_FOUND', message: 'no pinned counterparty with this key' }) });
    const { onChanged } = open();
    fireEvent.click(screen.getByRole('button', { name: W.actLabel('packrite-supply', keyShort(KEY_A)) }));
    await act(async () => { hold(screen.getByRole('button', { name: new RegExp(W.hold('packrite-supply')) })); });
    const notice = screen.getByRole('alert');
    expect(notice.textContent).toContain(W.failed);
    expect(notice.textContent).toContain('no pinned counterparty with this key');
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: W.ask('packrite-supply') })).toBeTruthy();
    // The hold can be held again after a refusal.
    await act(async () => { hold(screen.getByRole('button', { name: new RegExp(W.hold('packrite-supply')) })); });
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('a locked window asks to unlock first and offers no hold', () => {
    open(true);
    fireEvent.click(screen.getByRole('button', { name: W.actLabel('cablehaus', keyShort(KEY_B)) }));
    expect(screen.queryByRole('button', { name: new RegExp(W.hold('cablehaus')) })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(W.unlock) }));
    expect(unlock).toHaveBeenCalledOnce();
    expect(call).not.toHaveBeenCalled();
  });
});
