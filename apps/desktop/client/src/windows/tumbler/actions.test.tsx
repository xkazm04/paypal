// The Tumbler's own actions on the real page (mock wallet): what reaches the wallet, and how often.
// A safe-direction action is still a signed act (Withdraw writes a WITHDRAW envelope, W7), so it
// is sent once per decision, whatever the keyboard does while the wallet is answering.
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Backend } from '../../lib/contract';
import { mockBackend, resetMockState } from '../../mock/backend';
import { setHarnessBackend } from '../main/console/testing/runtime';
import { CardForm } from './forms';
import { Tumbler } from './Tumbler';

vi.mock('../../lib/runtime', async () => (await import('../main/console/testing/runtime')).runtimeMock);

afterEach(() => { cleanup(); setHarnessBackend(null); });

type Harness = {
  root: HTMLElement;
  calls: string[];
  /** every call with its arguments */
  sent: { cmd: string; args: unknown }[];
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
  const sent: { cmd: string; args: unknown }[] = [];
  const held = new Map<string, (() => void)[]>();
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const wrapped: Backend = {
    ...real,
    invoke: (async (cmd: string, args: unknown, opts: unknown) => {
      calls.push(cmd);
      sent.push({ cmd, args });
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
    root, calls, sent,
    emit: (event, payload) => act(() => { for (const cb of listeners.get(event) ?? []) cb(payload); }),
    release: (cmd) => { for (const r of held.get(cmd) ?? []) r(); held.delete(cmd); },
  };
}

describe('a read of the cards that fails', () => {
  it('says what is shown may be out of date, instead of drawing it as current', async () => {
    const h = await mount({ fail: ['attention_list'] });
    await waitFor(() => expect(h.calls).toContain('attention_list'));
    // The page's own start-up ends by asking for rest, which may land after this test's stack:
    // keep asking for the stack until it is the form on screen.
    await waitFor(() => {
      if (!h.root.querySelector('.f.stack')) h.emit('tumbler:form', 'stack');
      expect(h.root.querySelector('.f.stack')?.closest('.tum')?.textContent).toMatch(/may be out of date/);
    }, { timeout: 5000 });
    // and the puck never says the calm thing it cannot know
    const puck = h.root.querySelector('button.puck');
    expect(puck?.getAttribute('aria-label')).toMatch(/cards not read yet/);
    expect(puck?.getAttribute('aria-label')).not.toMatch(/nothing needs you/);
  });
});

describe('the card’s spoken keys', () => {
  const base: AttentionItem = {
    deal_id: '01JD00000000000000000000K1', label: 'D-0001', kind: 'gate', module: 'spend', headline: 'Pay or release $64.00', amount_minor: 6400, currency: 'USD',
    counterparty: null, clause: null, deadline: Math.floor(Date.now() / 1000) + 3 * 3600, on_silence: 'the hold releases itself', urgency: 'calm', mode: 'sandbox',
    actions: ['review', 'open_in_table'],
  };
  const spoken = (item: AttentionItem): string => {
    setHarnessBackend(mockBackend('tumbler'));
    const r = render(<CardForm item={item} items={[item]} now={Math.floor(Date.now() / 1000)} locked={false} confirming={false} reviewed={false}
      busy={false} pending={null} failure={null} onAction={() => {}} onConfirm={() => {}} onNav={() => {}} onStack={() => {}} onKey={() => {}} />);
    const label = r.container.querySelector('.f.card')?.getAttribute('aria-label') ?? '';
    r.unmount();
    return label;
  };
  it('name only the keys that act on this card (the same rules as the key handler)', () => {
    // a held authorization: Review, no Withdraw (its default is the auto-void)
    expect(spoken(base)).toMatch(/Enter reviews/);
    expect(spoken(base)).not.toMatch(/W withdraws/);
    expect(spoken({ ...base, actions: ['review', 'withdraw', 'open_in_table'] })).toMatch(/Enter reviews, W withdraws/);
    // a pause: no Review; Withdraw only when Rust lists it
    expect(spoken({ ...base, kind: 'hold', actions: ['withdraw', 'open_in_table'] })).toMatch(/: Pay or release \$64\.00\. W withdraws, Escape returns to rest\.$/);
    expect(spoken({ ...base, kind: 'hold', actions: ['open_in_table'] })).toMatch(/\. Escape returns to rest\.$/);
  });
});

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const stackControls = async (h: Harness) => {
  // the page's start-up ends by asking for rest (after it has read the settings and the cards): let it finish, then ask for the stack
  await waitFor(() => expect(h.calls).toContain('attention_list'));
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  h.emit('tumbler:form', 'stack');
  // the stack may be redrawn while the page starts up: look the buttons up afresh each time
  const get = (label: string) => {
    const el = h.root.querySelector<HTMLButtonElement>(`.f.stack button[aria-label="${label}"]`);
    if (!el) throw new Error(`no ${label} button`);
    return el;
  };
  await waitFor(() => { get('Always on top'); get('Do not disturb'); });
  return { pin: () => get('Always on top'), dnd: () => get('Do not disturb') };
};
const written = (h: Harness) => h.sent.filter((s) => s.cmd === 'settings_write').map((s) => s.args as { pinned: boolean; dnd: boolean });

describe('Pin and Do not disturb from the stack', () => {
  it('keeps the pin just made when Do not disturb is pressed before the pin has answered', async () => {
    const h = await mount({ hold: ['tumbler_pin'] });
    const { pin, dnd } = await stackControls(h);
    const before = pin().getAttribute('aria-pressed') === 'true';
    fireEvent.click(pin());
    await waitFor(() => expect(h.calls).toContain('tumbler_pin'));
    // both controls are busy; a second press does nothing
    await waitFor(() => expect(dnd().disabled && pin().disabled).toBe(true));
    expect(dnd().getAttribute('aria-busy')).toBe('true');
    expect(pin().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(dnd());
    fireEvent.click(pin());
    await settle();
    expect(h.calls).not.toContain('settings_write');
    expect(h.calls.filter((c) => c === 'tumbler_pin')).toHaveLength(1);
    // the pin lands; the controls are free again, and the next write carries the pin as it is now
    await act(async () => { h.release('tumbler_pin'); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(dnd().disabled || pin().disabled).toBe(false));
    expect(pin().hasAttribute('aria-busy')).toBe(false);
    fireEvent.click(dnd());
    await waitFor(() => expect(written(h)).toHaveLength(1));
    expect(written(h)[0]?.pinned).toBe(!before);
    expect(written(h)[0]?.dnd).toBe(true);
  });

  it('frees both controls after a write that fails, and says so', async () => {
    const h = await mount({ fail: ['settings_write'] });
    const { pin, dnd } = await stackControls(h);
    fireEvent.click(dnd());
    await waitFor(() => expect(h.calls).toContain('settings_write'));
    await waitFor(() => expect(dnd().disabled).toBe(false));
    expect(pin().disabled).toBe(false);
    expect(dnd().hasAttribute('aria-busy')).toBe(false);
    await waitFor(() => expect(h.root.querySelector('.f.stack')?.textContent).toMatch(/Do not disturb/));
  });
});

describe('Snooze from the Tumbler', () => {
  it('sends one snooze, however often S is pressed while the wallet answers', async () => {
    const h = await mount({ hold: ['deal_snooze'] });
    await waitFor(() => expect(h.root.className).toMatch(/\bring-gold\b/));
    const att = await mockBackend('main').invoke('attention_list', null);
    const gate = att.items.find((i) => i.kind === 'gate' && i.actions.includes('snooze30') && i.deadline !== null && i.deadline - Math.floor(Date.now() / 1000) > 46 * 60);
    if (!gate) throw new Error('the mock world has a decision that can be snoozed');
    h.emit('tumbler:selected', { deal_id: gate.deal_id });
    const card = await waitFor(() => {
      const el = h.root.querySelector<HTMLElement>('.f.card');
      if (!el) throw new Error('no card yet');
      return el;
    });
    fireEvent.keyDown(card, { key: 's' });
    fireEvent.keyDown(card, { key: 'S' }); // same round trip, before any render
    await waitFor(() => expect(h.calls.filter((c) => c === 'deal_snooze')).toHaveLength(1));
    await settle();
    expect(h.calls.filter((c) => c === 'deal_snooze')).toHaveLength(1);
    // The held call is never released on purpose: the mock wallet's state is shared across this
    // file's tests, and a real snooze would take this deal out of the next test's world.
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
