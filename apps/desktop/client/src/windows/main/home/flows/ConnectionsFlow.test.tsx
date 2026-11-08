// The Connections chat flow: one question per card, the commands the Connections page uses, pairing words
// only in the secure step (stood in for here, as in the guide's test), the agent app only after a consent press.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend, EventName } from '../../../../lib/contract';
import { mockBackend, resetMockState } from '../../../../mock/backend';
import { resetReadBudget } from '../../../../lib/data/invoke';
import { setHarnessBackend } from '../../console/testing/runtime';
import { ToastProvider } from '../../ui';
import { WorldProvider } from '../../world';
import type { SecureStepProps } from '../secure/contract';
import { FlowTurnView } from './FlowTurnView';
import { CONN_WORDS as W } from './connectionsWords';
import { FLOW_WORDS } from './words';
import { resetFlows, startFlow, useFlows } from './store';

vi.mock('../../../../lib/runtime', async () => (await import('../../console/testing/runtime')).runtimeMock);
vi.mock('../secure/SecureStep', () => ({
  SecureStep: (p: SecureStepProps) => (
    <div data-secure={p.kind} data-done={p.done ? 'true' : 'false'} data-pairing={p.pairing ?? ''} data-draft={p.draft ?? ''}>
      <button type="button" onClick={p.onCancel}>sheet cancel</button>
    </div>
  ),
}));

let calls: { cmd: string; args: unknown }[] = [];
let listeners: Map<string, ((p: unknown) => void)[]>;
let overrides: Partial<Record<string, () => unknown>> = {};

function world(): void {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/index.html?first_run=1');
  resetMockState();
  resetReadBudget();
  resetFlows();
  const real = mockBackend('main');
  calls = [];
  listeners = new Map();
  overrides = {};
  const wrapped: Backend = {
    kind: real.kind, label: real.label,
    invoke: async (cmd, args, opts) => {
      calls.push({ cmd, args });
      const o = overrides[cmd];
      return o ? (o() as never) : real.invoke(cmd, args, opts);
    },
    listen: (e, cb) => {
      listeners.set(e, [...(listeners.get(e) ?? []), cb as (p: unknown) => void]);
      return real.listen(e, cb);
    },
  };
  setHarnessBackend(wrapped);
}
const sent = (cmd: string) => calls.filter((c) => c.cmd === cmd);
const emit = async (e: EventName, p: unknown) => { await act(async () => { (listeners.get(e) ?? []).forEach((f) => f(p)); }); };

function Host() {
  const { turns } = useFlows();
  return <div>{turns.map((t) => <FlowTurnView key={t.serial} turn={t} />)}</div>;
}
const view = () => render(<ToastProvider><WorldProvider><Host /></WorldProvider></ToastProvider>);
const button = (name: string | RegExp) => screen.findByRole('button', { name });

beforeEach(() => { world(); });
afterEach(() => { cleanup(); setHarnessBackend(null); resetFlows(); history.replaceState(null, '', '/'); });

describe('the Connections flow', () => {
  it('asks one question first: three choices', async () => {
    startFlow('connections', 'choose');
    view();
    expect(await button(W.choose.wallet)).toBeTruthy();
    expect(screen.getByRole('button', { name: W.choose.shop })).toBeTruthy();
    expect(screen.getByRole('button', { name: W.choose.app })).toBeTruthy();
    expect(sent('pairing_join')).toHaveLength(0);
  });

  it('joins another wallet by code: code, payee, then the secure step; done when Rust pins it', async () => {
    startFlow('connections', 'choose');
    view();
    fireEvent.click(await button(W.choose.wallet));
    fireEvent.click(await button(W.wallet.have));
    const code = await screen.findByLabelText(W.wallet.codeQ);
    fireEvent.change(code, { target: { value: ' otter-basil-1234 ' } });
    fireEvent.click(screen.getByRole('button', { name: W.wallet.next }));
    const payee = await screen.findByLabelText(W.wallet.payeeQ);
    fireEvent.change(payee, { target: { value: 'maya@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: W.wallet.joinAct }));
    const step = await waitFor(() => { const e = document.querySelector('[data-secure="pairing"]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    expect(sent('pairing_join')).toEqual([{ cmd: 'pairing_join', args: { code: 'otter-basil-1234', side: 'buyer', payee: 'maya@example.com', peer: null } }]);
    // The chat never shows the four words or takes a secret: only the secure step carries the pairing.
    expect(document.body.textContent).not.toMatch(/otter|basil|quartz|meadow/);
    expect(document.querySelector('input[type="password"]')).toBeNull();
    const pairing = JSON.parse(step.getAttribute('data-pairing') ?? 'null') as number[];
    expect(Array.isArray(pairing)).toBe(true);
    await emit('pairing:pinned', { pairing_id: pairing, key_id: 'kp_x', house: false });
    expect(await screen.findByText(W.wallet.connected)).toBeTruthy();
    expect(document.querySelector('[data-secure]')).toBeNull();
    // Nothing but pairing commands ran: no signing, no confirm, no credentials.
    const cmds = new Set(calls.map((c) => c.cmd));
    for (const bad of ['pairing_confirm', 'credentials_save', 'mandate_sign', 'approval_open']) expect(cmds.has(bad)).toBe(false);
  });

  it('refuses a payee Rust would refuse, without calling anything', async () => {
    startFlow('connections', 'wallet');
    view();
    fireEvent.click(await button(W.wallet.make));
    const payee = await screen.findByLabelText(W.wallet.payeeQ);
    fireEvent.change(payee, { target: { value: 'has space' } });
    expect(await screen.findByText(W.wallet.payeeProblem.chars)).toBeTruthy();
    expect((screen.getByRole('button', { name: W.wallet.makeAct }) as HTMLButtonElement).disabled).toBe(true);
    expect(sent('pairing_create')).toHaveLength(0);
  });

  it('makes a code to share, shows it, and ends the offer when cancelled', async () => {
    startFlow('connections', 'wallet');
    view();
    fireEvent.click(await button(W.wallet.make));
    fireEvent.change(await screen.findByLabelText(W.wallet.payeeQ), { target: { value: 'maya' } });
    fireEvent.click(screen.getByRole('button', { name: W.wallet.makeAct }));
    const shown = await waitFor(() => { const e = document.querySelector('[data-code]'); expect(e).not.toBeNull(); return e as HTMLElement; });
    const offered = shown.textContent ?? '';
    expect(offered).toMatch(/^otter-basil-/);
    expect(sent('pairing_create')).toEqual([{ cmd: 'pairing_create', args: { side: 'seller', payee: 'maya' } }]);
    await waitFor(() => expect(sent('pairing_poll').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: FLOW_WORDS.cancel }));
    expect(await screen.findByText(FLOW_WORDS.cancelled)).toBeTruthy();
    await waitFor(() => expect(sent('pairing_abort')).toEqual([{ cmd: 'pairing_abort', args: { pairing_id: null, code: offered } }]));
  });

  it('hands their words to the secure step once they used the code', async () => {
    startFlow('connections', 'wallet');
    view();
    fireEvent.click(await button(W.wallet.make));
    fireEvent.change(await screen.findByLabelText(W.wallet.payeeQ), { target: { value: 'maya' } });
    const real = mockBackend('main');
    const words = await real.invoke('pairing_join', { code: 'HOUSE', side: 'buyer', payee: 'x', peer: null });
    overrides.pairing_poll = () => words;
    fireEvent.click(screen.getByRole('button', { name: W.wallet.makeAct }));
    await waitFor(() => expect(document.querySelector('[data-secure="pairing"]')).not.toBeNull());
    expect(sent('pairing_abort')).toHaveLength(0);
  });

  it('cancel in the secure step stops the pairing by its id', async () => {
    startFlow('connections', 'shop');
    view();
    fireEvent.click(await button(W.shop.connect));
    fireEvent.change(await screen.findByLabelText(W.shop.payeeQ), { target: { value: 'maya' } });
    fireEvent.click(screen.getByRole('button', { name: W.shop.connect }));
    await waitFor(() => expect(document.querySelector('[data-secure="pairing"]')).not.toBeNull());
    expect(sent('house_wake')).toHaveLength(1);
    expect(sent('pairing_join')[0]?.args).toMatchObject({ code: 'HOUSE', side: 'buyer', payee: 'maya' });
    fireEvent.click(screen.getByRole('button', { name: 'sheet cancel' }));
    expect(await screen.findByText(W.shop.stopped)).toBeTruthy();
    await waitFor(() => expect(sent('pairing_abort')).toHaveLength(1));
  });

  it('says the practice shop state in one line', async () => {
    startFlow('connections', 'shop');
    view();
    expect(await screen.findByText(W.shop.off)).toBeTruthy();
  });

  it('changes the agent app only after the consent press, with the Connections page command', async () => {
    startFlow('connections', 'app');
    view();
    expect(await screen.findByText(W.app.noneYet)).toBeTruthy();
    const practice = await button(W.app.practice);
    await waitFor(() => expect((practice as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(practice);
    expect(sent('engine_select')).toHaveLength(0);
    expect(await screen.findByText(W.app.consentQ(W.app.practice))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: W.app.consent(W.app.practice) }));
    expect(await screen.findByText(W.app.switched(W.app.practice))).toBeTruthy();
    expect(sent('engine_select')).toEqual([{ cmd: 'engine_select', args: { engine: 'scripted' } }]);
  });

  it('shows a failed switch where it was pressed and does not end the flow', async () => {
    startFlow('connections', 'app-consent', { engine: 'scripted' });
    view();
    overrides.engine_select = () => { throw new Error('nope'); };
    fireEvent.click(await button(W.app.consent(W.app.practice)));
    await waitFor(() => expect(document.querySelector('.notice')).not.toBeNull());
    expect(document.querySelector('.fc[data-step="app-consent"]')).not.toBeNull();
  });

  it('cancel leaves everything as it was', async () => {
    startFlow('connections', 'choose');
    view();
    fireEvent.click(await button(FLOW_WORDS.cancel));
    expect(await screen.findByText(FLOW_WORDS.cancelled)).toBeTruthy();
    expect(calls.filter((c) => /^(pairing_|engine_select|house_wake)/.test(c.cmd))).toHaveLength(0);
  });
});
