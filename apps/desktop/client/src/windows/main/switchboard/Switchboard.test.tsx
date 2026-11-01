// The board in the main window, on the browser mock world (jsdom, the real hooks, the real App):
// the matrix against the mock, the day-one board, the hand-off to the approval window and nothing
// else, the assistant's ops moving the board, a failing engine, the keyboard path, the view switch.
// The mock world's clock is pinned (repo law): BOARD_PIN overrides it to run the same tests at another
// moment (Friday 19:30 by default; "2026-11-08T00:30:00" is Sunday 00:30).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend } from '../../../lib/contract';
import type { AssistantEngine, ValidatedReply } from '../../../lib/assistant';
import { formatMinor } from '../../../lib/format';
import { resetReadBudget } from '../../../lib/data/invoke';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { setHarnessBackend } from '../console/testing/runtime';
import { settle } from '../console/testing/scaleSmoke';
import { App } from '../App';
import { WorldProvider } from '../world';
import { Switchboard } from './Switchboard';
import type { AssistantDeps } from './useBoardAssistant';
import { resetHomeView, VIEW_KEY } from './view';

vi.mock('../../../lib/runtime', async () => (await import('../console/testing/runtime')).runtimeMock);

const PIN = new Date(process.env.BOARD_PIN ?? '2026-11-06T19:30:00');
type Call = { cmd: string; args: unknown };
let calls: Call[] = [];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = function scrollTo() {};
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
  localStorage.clear();
  resetHomeView();
});

function world(search: string): Backend {
  localStorage.clear();
  sessionStorage.clear();
  resetHomeView();
  history.replaceState(null, '', `/index.html${search}`);
  resetMockState();
  const real = mockBackend('main');
  calls = [];
  resetReadBudget();
  const wrapped: Backend = {
    kind: real.kind,
    label: real.label,
    // A browser cannot open the approval window here: the hand-off is recorded, not performed.
    invoke: async (cmd, args, opts) => { calls.push({ cmd, args }); if (cmd === 'approval_open') return null as never; return real.invoke(cmd, args, opts); },
    listen: real.listen,
  };
  setHarnessBackend(wrapped);
  return real;
}

const cell = (m: string, f: string) => document.querySelector<HTMLElement>(`[data-cell="${m}:${f}"]`)!;
async function boardReady(): Promise<void> {
  await waitFor(() => { if (!document.querySelector('[data-cell]') || !document.querySelector('[data-inst="room"] .sb-v')) throw new Error('not drawn'); }, { timeout: 15_000 });
  await settle();
}
async function openApp(search: string): Promise<void> {
  world(search);
  render(<App />);
  await boardReady();
}
async function openBoard(props: { engine?: AssistantEngine; deps?: AssistantDeps } = {}, search = ''): Promise<void> {
  world(search);
  render(<WorldProvider><Switchboard {...props} /></WorldProvider>);
  await boardReady();
}

/** The expected cell of each deal of Maya's week, by its label (the mock world's own). */
const WHERE: Record<string, [string, string]> = {
  'D-0193': ['tables', 'needs'], 'D-0199': ['tables', 'needs'],
  'D-0204': ['tables', 'moving'], 'D-0205': ['tables', 'moving'], 'D-0201': ['tables', 'moving'], 'D-0187': ['tables', 'moving'],
  'D-0176': ['tables', 'stopped'], 'D-0184': ['tables', 'stopped'],
  'D-0190': ['spend', 'needs'], 'D-0192': ['spend', 'stopped'], 'D-0180': ['spend', 'stopped'], 'D-0181': ['spend', 'stopped'], 'D-0186': ['spend', 'paid'], 'D-0183': ['spend', 'paid'],
  'D-0194': ['counter', 'needs'], 'Q-0207': ['counter', 'moving'], 'D-0189': ['counter', 'moving'], 'D-0185': ['counter', 'paid'],
  'D-0198': ['shield', 'needs'], 'D-0196': ['shield', 'stopped'],
  'D-0188': ['rescue', 'needs'], 'D-0182': ['rescue', 'moving'], 'D-0178': ['rescue', 'paid'],
};

describe('A1: the full matrix on the default mock world', () => {
  it('every deal is in its module row and fate column, and the strip equals the mock exposure', async () => {
    await openApp('?view=board');
    expect(document.querySelector('[data-testid="switchboard"]')).not.toBeNull();
    expect(document.querySelector('.cs-app')).toBeNull();
    const perCell: Record<string, number> = {};
    for (const [m, f] of Object.values(WHERE)) perCell[`${m}:${f}`] = (perCell[`${m}:${f}`] ?? 0) + 1;
    for (const m of ['tables', 'spend', 'counter', 'book', 'shield', 'rescue']) {
      for (const f of ['needs', 'moving', 'stopped', 'paid']) {
        expect(Number(cell(m, f).dataset.count), `${m} ${f}`).toBe(perCell[`${m}:${f}`] ?? 0);
      }
    }
    // each key that is drawn sits in the right cell (a cell with more than three folds the rest into "+n more")
    let seen = 0;
    for (const key of document.querySelectorAll<HTMLElement>('[data-deal]')) {
      const label = /\((\w-\d+)\)/.exec(key.getAttribute('aria-label') ?? '')?.[1] ?? '';
      const [m, f] = WHERE[label] ?? ['?', '?'];
      expect(key.closest('[data-cell]')?.getAttribute('data-cell'), label).toBe(`${m}:${f}`);
      seen += 1;
    }
    expect(seen).toBeGreaterThan(15);
    expect(cell('tables', 'moving').querySelector('[data-more]')?.textContent).toBe('+1 more');
    expect(document.querySelector('[data-count="needs"]')?.textContent).toBe('6');
    // the strip
    const att = await mockBackend('main').invoke('attention_list', null);
    const row = att.exposure!.currencies[0]!;
    const cap = att.exposure!.limits!;
    const text = (id: string) => document.querySelector(`[data-inst="${id}"]`)!.textContent ?? '';
    expect(text('room')).toContain(formatMinor(cap.max_out_day.minor - row.out_today.minor, 'USD'));
    expect(text('deals')).toContain(String(row.deals_today));
    expect(text('deals')).toContain(`of ${cap.max_deals_day} a day`);
    expect(text('held')).toContain(formatMinor(row.held.minor + row.committed.minor, 'USD'));
    expect(text('confirmed')).toContain(formatMinor(row.paid_today.minor, 'USD'));
    expect(text('records')).toContain('Intact');
  });

  it('every needs-you key shows its If you do nothing line, and the page carries the mode and sample-data badges', async () => {
    await openApp('?view=board');
    const keys = [...document.querySelectorAll('.sb-key.f-needs')];
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.textContent).toContain('If you do nothing');
    expect(document.querySelector('.badge.sandbox')).not.toBeNull();
    expect(document.querySelector('.badge.mock')).not.toBeNull();
  });
});

describe('A2: day one', () => {
  it('shows the setup steps as the answer, an honest empty board and one gold button: the next step', async () => {
    await openApp('?first_run=1&view=board');
    expect(document.querySelector('[data-setup]')).not.toBeNull();
    expect(document.querySelector('[data-answer="setup"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-deal]').length).toBe(0);
    expect(document.querySelector('[data-empty-board]')?.textContent).toMatch(/nothing on the board yet/i);
    const gold = document.querySelectorAll('.ui-btn.gold');
    expect(gold.length).toBe(1);
    expect(gold[0]!.textContent).toMatch(/PayPal/);
    // an unknown money number is dashed, never 0
    expect(document.querySelector('[data-inst="room"] .sb-na')).not.toBeNull();
    expect(document.querySelector('[data-inst="room"] .sb-v')!.textContent).not.toMatch(/^\$?0/);
    fireEvent.click(gold[0]!);
    await waitFor(() => expect(calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    expect(calls.filter((c) => c.cmd === 'approval_open').map((c) => c.args)).toEqual([{ deal_id: null, target: 'credentials' }]);
  });
});

describe('A3: a needs-you key opens its decision; the gold button hands off and nothing else', () => {
  it('opens the decision, and the single gold button calls approval_open with that deal id', async () => {
    await openApp('?view=board');
    const key = cell('spend', 'needs').querySelector<HTMLElement>('[data-deal]')!;
    const id = key.dataset.deal!;
    fireEvent.click(key);
    const dec = await waitFor(() => { const d = document.querySelector('[data-decision]'); if (!d) throw new Error('no decision'); return d; });
    expect(dec.getAttribute('data-decision')).toBe(id);
    expect(dec.textContent).toContain('If you do nothing');
    expect(document.querySelector('.sb-crumb')?.textContent).toMatch(/Board.*Spend.*Needs you.*D-0190/s);
    const gold = document.querySelectorAll<HTMLButtonElement>('.ui-btn.gold');
    expect(gold.length).toBe(1);
    expect(gold[0]!.textContent).toBe('Review in approval window');
    calls = [];
    fireEvent.click(gold[0]!);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(calls.map((c) => c.cmd)).toEqual(['approval_open']);
    expect(calls[0]!.args).toEqual({ deal_id: id, target: null });
  });

  it('a closed mismatch has no review button: only a way to the console', async () => {
    await openApp('?view=board');
    const key = [...cell('tables', 'needs').querySelectorAll<HTMLElement>('[data-deal]')].find((k) => /D-0199/.test(k.getAttribute('aria-label') ?? ''));
    expect(key).toBeDefined();
    fireEvent.click(key!);
    await waitFor(() => { if (!document.querySelector('[data-decision]')) throw new Error('no decision'); });
    expect(document.querySelectorAll('.ui-btn.gold').length).toBe(0);
    expect(document.querySelector('[data-decision]')!.textContent).toMatch(/Open in the console/);
  });

  it('nothing on the page names or sends a decision, owner or session command', () => {
    const dirs = [__dirname];
    const files = dirs.flatMap(function walk(dir: string): string[] {
      return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []));
    });
    expect(files.length).toBeGreaterThan(8);
    const release = Object.entries(AUTHORITY).filter(([, a]) => a.release).map(([n]) => n);
    const found = files.flatMap((f) => { const t = readFileSync(f, 'utf8'); return release.filter((n) => (n.includes('_') ? t.includes(n) : new RegExp(`(useMutation|useQuery|invoke)\\s*(<[^>]*>)?\\(\\s*['"\`]${n}['"\`]`).test(t))).map((n) => `${f}: ${n}`); });
    expect(found).toEqual([]);
    // and the only mutation the page opens is approval_open
    const muts = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/useMutation\(\s*'([a-z_]+)'/g)].map((m) => m[1]));
    expect(new Set(muts)).toEqual(new Set(['approval_open']));
  });
});

// ---- the assistant: a fake engine and a fake validator result (WP2's behaviour is not relied on) ----

const reply = (over: Partial<ValidatedReply> = {}): ValidatedReply => ({ say: '', ops: [], dropped: { count: 0, reasons: [] }, repaired: false, ...over });
const fakeEngine = (ask: AssistantEngine['ask'], id: 'scripted' | 'claude-code' = 'claude-code'): AssistantEngine => ({ info: { id, label: id }, ask });
async function ask(q: string): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('.sb-ask input')!;
  fireEvent.change(input, { target: { value: q } });
  fireEvent.submit(input.closest('form')!);
}

describe('A4: the assistant moves the board (fake engine, fake validator)', () => {
  it('show, focus, filter and propose are applied; the proposal is armed only if the host resolves it', async () => {
    let dealId = '';
    const validate = vi.fn((_raw: unknown, _known: { dealIds: ReadonlySet<string> }): ValidatedReply => reply({
      say: 'Here is what needs you. <img src=x onerror=alert(1)>',
      ops: [
        { op: 'show', panel: { kind: 'money' } },
        { op: 'focus', module: 'rescue', fate: null, deal_id: null },
        { op: 'filter', module: 'shield', fate: null },
        { op: 'propose', action: { action: 'open_decision', deal_id: dealId }, why: 'It is the soonest one.' },
        { op: 'propose', action: { action: 'open_decision', deal_id: 'not-a-deal' }, why: 'Trust me.' },
        { op: 'propose', action: { action: 'open_setup', target: 'mandate' }, why: 'Rules first.' },
      ],
    }));
    const engine = fakeEngine(async () => ({ v: 1 }));
    await openBoard({ engine, deps: { validate: validate as never } });
    dealId = cell('spend', 'needs').querySelector<HTMLElement>('[data-deal]')!.dataset.deal!;
    calls = [];
    await ask('what needs me?');
    await waitFor(() => { if (document.querySelector('[data-answer]')?.getAttribute('data-answer') !== 'money') throw new Error('not yet'); });
    // the validator saw the digest's deal ids
    expect(validate.mock.calls[0]![1].dealIds.has(dealId)).toBe(true);
    // show -> the answer panel
    expect(document.querySelector('[data-answer="money"]')).not.toBeNull();
    // focus -> the Rescue row head is lit
    expect(document.querySelector('[data-rowhead="rescue"]')!.classList.contains('lit')).toBe(true);
    // filter -> every cell outside Shield is dimmed; Shield's are not
    expect(cell('tables', 'moving').classList.contains('dim')).toBe(true);
    expect(cell('shield', 'needs').classList.contains('dim')).toBe(false);
    expect(document.querySelector('[data-rowhead="shield"]')!.getAttribute('aria-pressed')).toBe('true');
    // say is text, never HTML
    expect(document.querySelector('.sb-say')!.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(document.querySelector('.sb-say img')).toBeNull();
    // propose -> three chips; the unknown deal is disarmed and says why
    const props = [...document.querySelectorAll('[data-proposal]')];
    expect(props.length).toBe(3);
    const btn = (p: Element) => p.querySelector('button')!;
    expect(btn(props[0]!).disabled).toBe(false);
    expect(props[0]!.textContent).toContain('It is the soonest one.');
    expect(btn(props[1]!).disabled).toBe(true);
    expect(props[1]!.textContent).toMatch(/Not available: that deal is not on the board/);
    // the confirmation comes from the resolved action, not from the proposal's words
    expect(props[0]!.textContent).toContain('Opens the approval window. Nothing is approved on this page.');
    expect(props[0]!.textContent).not.toContain('Trust me');
    fireEvent.click(btn(props[0]!));
    await waitFor(() => expect(calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    expect(calls.filter((c) => c.cmd === 'approval_open').map((c) => c.args)).toEqual([{ deal_id: dealId, target: null }]);
    fireEvent.click(btn(props[2]!));
    await waitFor(() => expect(calls.filter((c) => c.cmd === 'approval_open').length).toBe(2));
    expect(calls.filter((c) => c.cmd === 'approval_open')[1]!.args).toEqual({ deal_id: null, target: 'mandate' });
  });

  it('a reply with dropped parts says so', async () => {
    await openBoard({ engine: fakeEngine(async () => ({})), deps: { validate: (() => reply({ say: 'Partly.', dropped: { count: 2, reasons: ['unknown deal', 'bad op'] }, repaired: true })) as never } });
    await ask('anything');
    await waitFor(() => expect(document.querySelector('[data-note="dropped"]')?.textContent).toBe('2 parts could not be shown'));
    expect(document.querySelector('.sb-say')!.textContent).toBe('Partly.');
  });

  it('a failing live engine falls back to the scripted one for that question and says so', async () => {
    const scripted = fakeEngine(async () => ({ from: 'scripted' }), 'scripted');
    const validate = vi.fn((raw: unknown) => reply({ say: (raw as { from?: string }).from === 'scripted' ? 'From the preview.' : 'Live.' }));
    await openBoard({ engine: fakeEngine(async () => { throw new Error('unavailable'); }), deps: { scripted, validate: validate as never } });
    expect(document.querySelector('[data-engine="claude-code"]')).not.toBeNull();
    await ask('hello');
    await waitFor(() => expect(document.querySelector('[data-note="fallback"]')?.textContent).toMatch(/scripted preview/));
    expect(document.querySelector('.sb-say')!.textContent).toBe('From the preview.');
  });

  it('with no live engine the chip says it is a scripted preview, not a live model', async () => {
    await openBoard({ deps: { scripted: fakeEngine(async () => ({}), 'scripted'), probe: async () => false, validate: (() => reply({ say: 'ok' })) as never } });
    expect(document.querySelector('.sb-engine')!.textContent).toBe('Scripted preview, not a live model');
  });

  it('asking can be cancelled', async () => {
    const engine = fakeEngine((_q, _i, signal) => new Promise((_res, rej) => { signal?.addEventListener('abort', () => rej(new Error('aborted'))); }));
    await openBoard({ engine, deps: { validate: (() => reply({ say: 'never' })) as never } });
    await ask('slow');
    await waitFor(() => expect(document.querySelector('.sb-busy')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-cancel]')!);
    await waitFor(() => expect(document.querySelector('.sb-a')?.textContent).toContain('Stopped. Nothing changed.'));
    expect(document.querySelector('.sb-busy')).toBeNull();
  });

  it('a closed-vocabulary panel renders for each kind without an error', async () => {
    const kinds: Array<{ kind: string } & Record<string, unknown>> = [
      { kind: 'needs', module: null }, { kind: 'money' }, { kind: 'rules', module: null }, { kind: 'rescue' }, { kind: 'safety' }, { kind: 'book', module: 'spend', fate: 'paid' }, { kind: 'week' }, { kind: 'setup' },
    ];
    let i = 0;
    await openBoard({ engine: fakeEngine(async () => ({})), deps: { validate: (() => reply({ ops: [{ op: 'show', panel: kinds[i++]! as never }] })) as never } });
    for (const k of kinds) {
      await ask(`show ${k.kind}`);
      await waitFor(() => expect(document.querySelector(`[data-answer="${k.kind}"]`)).not.toBeNull());
      await waitFor(() => expect(document.querySelector('.sb-answer-b')!.textContent!.length).toBeGreaterThan(5));
      await waitFor(() => expect(document.querySelector('.sb-busy')).toBeNull());
    }
  });
});

describe('A7: the keyboard path', () => {
  it('arrows move between keys (one tab stop), `/` focuses the input, Esc backs out and never leaves', async () => {
    await openBoard();
    const stops = () => [...document.querySelectorAll('.sb-matrix [data-slot]')].filter((e) => (e as HTMLElement).tabIndex === 0);
    expect(stops().length).toBe(1);
    const first = stops()[0] as HTMLElement;
    first.focus();
    expect(document.activeElement).toBe(first);
    // right: the next column of the same row that has a key
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    await waitFor(() => { if (document.activeElement === first) throw new Error('did not move'); });
    const second = document.activeElement as HTMLElement;
    expect(second.closest('[data-row]')).toBe(first.closest('[data-row]'));
    expect(second.closest('[data-cell]')).not.toBe(first.closest('[data-cell]'));
    expect(stops().length).toBe(1);
    // left comes back
    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(first));
    // down: the next key in the cell, else the next row's
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    await waitFor(() => { if (document.activeElement === first) throw new Error('did not move'); });
    // keys are native buttons: Enter and Space open them; the click is what they send
    fireEvent.click(document.activeElement as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-answer="decision"], [data-answer="deal"]')).not.toBeNull());
    // Esc: back to the overview, and the page keeps the event (the shell never sees it)
    const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => { document.activeElement!.dispatchEvent(esc); });
    expect(esc.defaultPrevented).toBe(true);
    await waitFor(() => expect(document.querySelector('[data-answer="none"]')).not.toBeNull());
    // `/` goes to the input; Esc in the input goes back to the board
    const slash = new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true });
    act(() => { document.body.dispatchEvent(slash); });
    expect(slash.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(document.querySelector('.sb-ask input'));
    act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await waitFor(() => expect(document.activeElement?.closest('.sb-matrix')).not.toBeNull());
  });

  it('heads filter, a second click clears, and Esc clears a filter', async () => {
    await openBoard();
    fireEvent.click(document.querySelector('[data-rowhead="spend"]')!);
    expect(cell('tables', 'moving').classList.contains('dim')).toBe(true);
    expect(cell('spend', 'paid').classList.contains('dim')).toBe(false);
    fireEvent.click(document.querySelector('[data-col="needs"]')!);
    expect(cell('spend', 'paid').classList.contains('dim')).toBe(true);
    expect(cell('spend', 'needs').classList.contains('dim')).toBe(false);
    fireEvent.click(document.querySelector('[data-rowhead="spend"]')!);
    fireEvent.click(document.querySelector('[data-col="needs"]')!);
    expect(document.querySelectorAll('.sb-cell.dim').length).toBe(0);
    fireEvent.click(document.querySelector('[data-rowhead="shield"]')!);
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelectorAll('.sb-cell.dim').length).toBe(0);
  });
});

describe('A8: the view switch', () => {
  it('opens on the console by default, switches both ways, remembers the choice and keeps the address truthful', async () => {
    world('');
    render(<App />);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    expect(document.querySelector('[data-testid="switchboard"]')).toBeNull();
    fireEvent.click(document.getElementById('cs-place-board')!);
    await waitFor(() => expect(document.querySelector('[data-testid="switchboard"]')).not.toBeNull());
    expect(document.querySelector('.cs-app')).toBeNull();
    expect(localStorage.getItem(VIEW_KEY)).toBe('board');
    await boardReady();
    fireEvent.click([...document.querySelectorAll('.sb-bar button')].find((b) => b.textContent === 'Console')!);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    expect(localStorage.getItem(VIEW_KEY)).toBe('console');
  });

  it('a remembered choice opens the board; the address wins over it', async () => {
    world('');
    localStorage.setItem(VIEW_KEY, 'board');
    resetHomeView();
    render(<App />);
    await boardReady();
    expect(document.querySelector('[data-testid="switchboard"]')).not.toBeNull();
    cleanup();
    world('?view=console');
    localStorage.setItem(VIEW_KEY, 'board');
    resetHomeView();
    render(<App />);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    fireEvent.click(document.getElementById('cs-place-board')!);
    await waitFor(() => expect(document.querySelector('[data-testid="switchboard"]')).not.toBeNull());
    expect(window.location.search).toContain('view=board');
  });

  it('blocked storage does not break the switch', async () => {
    world('');
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<App />);
    await waitFor(() => expect(document.querySelector('.cs-app')).not.toBeNull());
    fireEvent.click(document.getElementById('cs-place-board')!);
    await waitFor(() => expect(document.querySelector('[data-testid="switchboard"]')).not.toBeNull());
    spy.mockRestore();
  });
});

describe('at scale: 500 deals', () => {
  it('cells aggregate: counts and "+n more", never every deal', async () => {
    await openApp('?scale=large&view=board');
    const total = [...document.querySelectorAll<HTMLElement>('[data-cell]')].reduce((s, c) => s + Number(c.dataset.count), 0);
    expect(total).toBeGreaterThan(400);
    expect(document.querySelectorAll('[data-deal]').length).toBeLessThanOrEqual(6 * 4 * 3);
    const more = cell('spend', 'paid').querySelector<HTMLElement>('[data-more]');
    expect(more).not.toBeNull();
    expect(more!.textContent).toMatch(/^\+\d+ more$/);
    fireEvent.click(more!);
    await waitFor(() => expect(document.querySelector('[data-answer="book"]')).not.toBeNull());
    expect(cell('tables', 'paid').classList.contains('dim')).toBe(true);
    expect(cell('spend', 'paid').classList.contains('dim')).toBe(false);
    // the list is paged, not 100+ rows at once
    expect(document.querySelectorAll('[data-pick]').length).toBeLessThanOrEqual(40);
    expect(document.querySelector('.sb-answer-b')!.textContent).toMatch(/Showing 40 of \d+/);
  }, 60_000);
});
