// "Say it" on the Charter's rules line: one sentence becomes chips; what it is sure of is solid, what it
// filled in is marked, what it is not sure of is dashed and asks one question; an edit goes back through the
// reader; the one button hands the rules to the approval window as a typed draft and signs nothing; speech
// is only input, behind a feature check, and typing is the whole feature without it.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalOpenArgs } from '@bindings/ApprovalOpenArgs';
import type { Backend } from '../../../lib/contract';
import { sayClear } from '../../../lib/say/store';
import { SAY } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { ToastProvider } from '../ui';
import { WorldProvider } from '../world';
import { Charter } from './Charter';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null, opened: [] as unknown[], calls: [] as string[] }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

function stubbed(): Backend {
  const real = mockBackend('main');
  return {
    kind: real.kind,
    label: real.label,
    listen: (e, cb) => real.listen(e, cb),
    invoke: async (cmd, args, opts) => {
      hoisted.calls.push(cmd);
      if (cmd === 'approval_open') { hoisted.opened.push(args); return null as never; }
      return real.invoke(cmd, args, opts);
    },
  };
}

const MAYA = 'Haggle for a monitor, up to $340, ask me above $320, six offers, until Friday';

async function say(text: string) {
  render(<ToastProvider><WorldProvider><Charter step="rules" onStep={vi.fn()} onDone={vi.fn()} /></WorldProvider></ToastProvider>);
  const box = await screen.findByRole('textbox', { name: SAY.label });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: SAY.read }));
  return box;
}
const pill = (slot: string) => document.querySelector<HTMLElement>(`.say-pill[data-chip="${slot}"]`);

describe('Say it on the Charter', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html?first_run=1');
    resetMockState(); hoisted.opened = []; hoisted.calls = []; hoisted.current = stubbed(); sayClear();
  });
  afterEach(() => { cleanup(); hoisted.current = null; sayClear(); vi.unstubAllGlobals(); });

  it('shows the sentence from the brief as five solid chips and says what each allows', async () => {
    await say(MAYA);
    for (const [slot, label, value] of [['item', 'Item', 'monitor'], ['ceiling', 'Most you’ll pay', '$340'], ['ask', 'Ask you above', '$320'], ['offers', 'Offers', '6']] as const) {
      const p = pill(slot);
      expect(p?.textContent, slot).toContain(label);
      expect(p?.textContent, slot).toContain(value);
      expect(p?.getAttribute('data-state'), slot).toBe('said');
    }
    expect(pill('ends')?.textContent).toMatch(/Ends\s*\w{3} 18:00/);
    expect(pill('ends')?.getAttribute('data-state')).toBe('said');
    // what it will allow, in one plain paragraph
    const plain = document.querySelector('.say-plain')?.textContent ?? '';
    expect(plain).toContain('never agrees to more than $340');
    expect(plain).toContain('Above $320 it stops and asks you');
    expect(plain).toContain('at most 6 offers');
  });

  it('marks what it filled in, and leaves who it may pay for the owner to choose', async () => {
    await say(MAYA);
    expect(pill('dayTotal')?.getAttribute('data-state')).toBe('filled');
    expect(pill('dayDeals')?.getAttribute('data-state')).toBe('filled');
    expect(pill('payees')?.getAttribute('data-state')).toBe('open');
    expect(pill('payees')?.textContent).toContain('you choose');
  });

  it('hands the rules to the approval window as a typed draft, and signs nothing', async () => {
    await say(MAYA);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SAY.review) }));
    await waitFor(() => expect(hoisted.opened).toHaveLength(1));
    const args = hoisted.opened[0] as ApprovalOpenArgs;
    expect(args.deal_id).toBeNull();
    expect(args.target).toBe('mandate');
    const d = args.draft;
    expect(d?.type).toBe('rules');
    if (d?.type !== 'rules') return;
    expect(d.agent).toBe('negotiator');
    const by = <T extends string>(type: T) => d.clauses.find((c) => c.type === type);
    expect(by('human_present_over')).toMatchObject({ amount: { minor: 32000, currency: 'USD' } });
    expect(by('band')).toMatchObject({ item_refs: ['monitor'], ceiling: { minor: 34000 }, floor: null, max_rounds: 6 });
    expect(by('per_deal')).toMatchObject({ kind: 'haggle', max_amount: { minor: 34000 } });
    expect(by('roles')).toMatchObject({ roles: ['buy'] });
    expect(d.expires).toBeGreaterThan(d.not_before);
    // Nothing but the hand-off ran: no signing, no release, no deal command.
    expect(hoisted.calls.filter((c) => /sign|release|countersign|capture|void|approve|credentials/.test(c))).toEqual([]);
  });

  it('asks one question for what it is not sure of, never guesses, and an answer settles it', async () => {
    await say('Haggle for a monitor until friday');
    const q = document.querySelector('.say-q[data-q="ceiling"]');
    expect(q?.textContent).toContain('most you’ll pay for the monitor');
    expect(pill('ceiling')?.getAttribute('data-state')).toBe('unsure');
    // the draft carries no limit it was never told
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SAY.review) }));
    await waitFor(() => expect(hoisted.opened).toHaveLength(1));
    const d = (hoisted.opened[0] as ApprovalOpenArgs).draft;
    if (d?.type !== 'rules') throw new Error('rules');
    expect(d.clauses.some((c) => c.type === 'per_deal')).toBe(false);
    expect(d.clauses.find((c) => c.type === 'band')).toMatchObject({ ceiling: null });
    // answering it
    const input = within(q as HTMLElement).getByRole('textbox');
    fireEvent.change(input, { target: { value: '340' } });
    fireEvent.click(within(q as HTMLElement).getByRole('button', { name: SAY.apply }));
    await waitFor(() => expect(document.querySelector('.say-q[data-q="ceiling"]')).toBeNull());
    expect(pill('ceiling')?.textContent).toContain('$340');
    expect(pill('ceiling')?.getAttribute('data-state')).toBe('said');
  });

  it('shows words it did not read and lets the owner leave them out', async () => {
    await say('Haggle for a monitor up to $340 please hurry');
    const q = document.querySelector('.say-q[data-q="leave:hurry"]');
    expect(q?.textContent).toContain('hurry');
    fireEvent.click(within(q as HTMLElement).getByRole('button', { name: SAY.leaveOut }));
    await waitFor(() => expect(document.querySelector('.say-q[data-q="leave:hurry"]')).toBeNull());
  });

  it('a chip is edited in place and the rules follow', async () => {
    await say(MAYA);
    fireEvent.click(within(pill('ceiling') as HTMLElement).getByRole('button'));
    const edit = await screen.findByRole('textbox', { name: SAY.edit('Most you’ll pay') });
    fireEvent.change(edit, { target: { value: '350' } });
    fireEvent.click(screen.getByRole('button', { name: SAY.apply }));
    await waitFor(() => expect(pill('ceiling')?.textContent).toContain('$350'));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(SAY.review) }));
    await waitFor(() => expect(hoisted.opened).toHaveLength(1));
    const d = (hoisted.opened[0] as ApprovalOpenArgs).draft;
    if (d?.type !== 'rules') throw new Error('rules');
    expect(d.clauses.find((c) => c.type === 'band')).toMatchObject({ ceiling: { minor: 35000 } });
  });

  it('a typed edit that is not an amount is refused where it is typed', async () => {
    await say(MAYA);
    fireEvent.click(within(pill('ceiling') as HTMLElement).getByRole('button'));
    const edit = await screen.findByRole('textbox', { name: SAY.edit('Most you’ll pay') });
    fireEvent.change(edit, { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: SAY.apply }));
    expect((await screen.findByRole('alert')).textContent).toBe(SAY.invalidEdit);
    expect(pill('ceiling')?.textContent).toContain('$340');
  });

  it('offers sentences that always read when nothing has been said', async () => {
    render(<ToastProvider><WorldProvider><Charter step="rules" onStep={vi.fn()} onDone={vi.fn()} /></WorldProvider></ToastProvider>);
    const lines = await screen.findAllByRole('button', { name: SAY.tryLines[0] });
    fireEvent.click(lines[0] as HTMLElement);
    await waitFor(() => expect(pill('ceiling')?.textContent).toContain('$340'));
  });

  it('the Review rules button is off until the sentence is a rule', async () => {
    render(<ToastProvider><WorldProvider><Charter step="rules" onStep={vi.fn()} onDone={vi.fn()} /></WorldProvider></ToastProvider>);
    const btn = await screen.findByRole('button', { name: new RegExp(SAY.review) });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('speech is only an input behind a feature check', () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html?first_run=1');
    resetMockState(); hoisted.opened = []; hoisted.calls = []; hoisted.current = stubbed(); sayClear();
  });
  afterEach(() => { cleanup(); hoisted.current = null; sayClear(); vi.unstubAllGlobals(); });

  it('without a recogniser there is no microphone and the panel says to type', async () => {
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    render(<ToastProvider><WorldProvider><Charter step="rules" onStep={vi.fn()} onDone={vi.fn()} /></WorldProvider></ToastProvider>);
    await screen.findByRole('textbox', { name: SAY.label });
    expect(screen.queryByRole('button', { name: SAY.speak })).toBeNull();
    expect(document.querySelector('.say')?.textContent).toContain(SAY.noSpeech);
  });

  it('with one, what is heard is typed for the owner to check and read like typing', async () => {
    let rec: { onresult?: (e: unknown) => void; onend?: () => void } = {};
    class Fake {
      lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult: ((e: unknown) => void) | null = null; onerror: ((e: { error: string }) => void) | null = null; onend: (() => void) | null = null;
      constructor() { rec = this; }
      start() { /* listening */ }
      stop() { this.onend?.(); }
      abort() { /* nothing */ }
    }
    vi.stubGlobal('SpeechRecognition', Fake);
    render(<ToastProvider><WorldProvider><Charter step="rules" onStep={vi.fn()} onDone={vi.fn()} /></WorldProvider></ToastProvider>);
    const mic = await screen.findByRole('button', { name: SAY.speak });
    fireEvent.click(mic);
    const result = (t: string) => ({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
    act(() => { rec.onresult?.(result('haggle for a monitor up to three hundred and forty dollars')); });
    const box = screen.getByRole('textbox', { name: SAY.label }) as HTMLInputElement;
    expect(box.value).toBe('haggle for a monitor up to three hundred and forty dollars');
    // not read yet: it is the owner's to check; ending the recording reads it like typing
    expect(document.querySelector('.say-pills')).toBeNull();
    act(() => { rec.onend?.(); });
    await waitFor(() => expect(pill('ceiling')?.textContent).toContain('$340'));
    // and it signed nothing
    expect(hoisted.opened).toEqual([]);
  });
});
