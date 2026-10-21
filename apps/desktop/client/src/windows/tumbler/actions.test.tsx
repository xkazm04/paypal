// The Tumbler's own actions on the real page (mock wallet): what reaches the wallet, and how often.
// A safe-direction action is still a signed act (Withdraw writes a WITHDRAW envelope, W7), so it
// is sent once per decision, whatever the keyboard does while the wallet is answering.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { Tumbler } from './Tumbler';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); setHarnessBackend(null); });

type Harness = {
  root: HTMLElement;
  calls: string[];
  /** Deliver an event to the page as the wallet would. */
  emit: (event: string, payload: unknown) => void;
  /** Resolve every held call to `cmd`. */
  release: (cmd: string) => void;
};

/** The Tumbler on the mock wallet. `hold` names commands whose answer waits for `release`;
 *  `fail` names commands that reject as an unavailable wallet. */
async function mount(o: { hold?: string[]; fail?: string[] } = {}): Promise<Harness> {
  resetMockState();
  const real = mockBackend('tumbler');
  const calls: string[] = [];
  const held = new Map<string, (() => void)[]>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const wrapped: Backend = {
    ...real,
    invoke: (async (cmd: string, args: unknown, opts: unknown) => {
      calls.push(cmd);
      if (o.fail?.includes(cmd)) throw { code: 'UNAVAILABLE', message: 'The wallet is not running' };
      if (o.hold?.includes(cmd)) await new Promise<void>((r) => held.set(cmd, [...(held.get(cmd) ?? []), r]));
      return (real.invoke as (c: string, a: unknown, o: unknown) => Promise<unknown>)(cmd, args, opts);
    }) as Backend['invoke'],
    listen: (async (event: string, cb: (p: unknown) => void) => {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      const off = await (real.listen as (e: string, c: (p: unknown) => void) => Promise<() => void>)(event, cb);
      return () => { set.delete(cb); off(); };
    }) as Backend['listen'],
  };
  setHarnessBackend(wrapped);
  const { container } = render(<Tumbler />);
  const root = container.querySelector<HTMLElement>('.tum');
  if (!root) throw new Error('no Tumbler root');
  return {
    root, calls,
    emit: (event, payload) => act(() => { for (const cb of listeners.get(event) ?? []) cb(payload); }),
    release: (cmd) => { for (const r of held.get(cmd) ?? []) r(); held.delete(cmd); },
  };
}

describe('a read of the cards that fails', () => {
  it('says what is shown may be out of date, instead of drawing it as current', async () => {
    const h = await mount({ fail: ['attention_list'] });
    // the first read is done once the page asks for its resting form
    await waitFor(() => expect(h.calls).toContain('tumbler_set_form'));
    await waitFor(() => expect(h.root.className).toMatch(/\bform-rest\b/));
    h.emit('tumbler:form', 'stack');
    await waitFor(() => expect(h.root.querySelector('.f.stack')).not.toBeNull());
    await waitFor(() => expect(h.root.textContent).toMatch(/may be out of date/));
  });
});

describe('Withdraw from the Tumbler', () => {
  it('sends one withdraw, however often W is pressed while the wallet answers', async () => {
    const h = await mount({ hold: ['deal_withdraw'] });
    await waitFor(() => expect(h.root.className).toMatch(/\bring-gold\b/));
    const att = await mockBackend('main').invoke('attention_list', null);
    const gate = att.items.find((i) => i.kind === 'gate' && i.actions.includes('withdraw'));
    if (!gate) throw new Error('the mock world has a decision that can be withdrawn');
    h.emit('tumbler:selected', { deal_id: gate.deal_id });
    const card = await waitFor(() => {
      const el = h.root.querySelector<HTMLElement>('.f.card');
      if (!el) throw new Error('no card yet');
      return el;
    });
    fireEvent.keyDown(card, { key: 'w' }); // asks once
    await waitFor(() => expect(card.textContent).toMatch(/Walk away from this deal/));
    fireEvent.keyDown(card, { key: 'w' }); // confirms: the withdraw is on its way
    await waitFor(() => expect(h.calls.filter((c) => c === 'deal_withdraw')).toHaveLength(1));
    // The wallet has not answered yet: more presses must not send it again.
    fireEvent.keyDown(h.root.querySelector<HTMLElement>('.f.card') ?? card, { key: 'w' });
    fireEvent.keyDown(h.root.querySelector<HTMLElement>('.f.card') ?? card, { key: 'W' });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(h.calls.filter((c) => c === 'deal_withdraw')).toHaveLength(1);
    await act(async () => { h.release('deal_withdraw'); await new Promise((r) => setTimeout(r, 20)); });
    expect(h.calls.filter((c) => c === 'deal_withdraw')).toHaveLength(1);
  });
});
