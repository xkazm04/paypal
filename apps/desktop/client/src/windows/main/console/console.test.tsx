// The console on the mock backend (jsdom): it opens on the decision centre, every decision carries
// its "if you do nothing" line, the gold action opens the approval window and calls nothing else
// (spied against @bindings/authority), the lock shows, the stale banner shows and retries, no raw
// enum or id is drawn at scale, the 500-deal world stays within the read budget, Escape walks the
// chain and gives focus back, the browser's Back walks it too, Find closes before anything else,
// and old links and the Tumbler's route event land where they did.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORITY } from '@bindings/authority';
import type { Backend, CommandName, EventName, PayloadOf } from '../../../lib/contract';
import { WalletError } from '../../../lib/contract';
import { readBudget, resetReadBudget } from '../../../lib/data/invoke';
import { READ_CONCURRENCY } from '../../../lib/readEach';
import {
  APPROVAL_LOCKED_TITLE, APPROVAL_OPEN_TITLE, CHARTER_TITLE, CENTRE_TITLE, FIND_LABEL, IF_NOTHING, MONEY_CHECK_ENDED_SILENCE, NOTICE_WHAT, PLACE, PLACE_NAME, SETUP_STEP_COPY, STALE_TITLE, UNREAD_TITLE, WAITING_TITLE,
} from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';

const h = vi.hoisted(() => ({
  current: null as Backend | null,
  cbs: new Map<string, Set<(p: unknown) => void>>(),
  calls: [] as { cmd: string; args: unknown }[],
  failSettings: false,
  holdOpen: null as null | (() => void),
  failOpen: false,
}));
vi.mock('../../../lib/runtime', () => ({ backend: () => h.current }));

import { App } from '../App';

function wrap(real: Backend): Backend {
  return {
    kind: real.kind,
    label: real.label,
    invoke: async (cmd, args, opts) => {
      h.calls.push({ cmd, args });
      if (cmd === 'approval_open') {
        if (h.failOpen) throw new WalletError({ code: 'UNAVAILABLE', message: 'The approval window did not open' });
        // A browser tab cannot open the approval window here; the hand-off is recorded instead.
        if (h.holdOpen === null) return null as never;
        await new Promise<void>((r) => { h.holdOpen = r; });
        return null as never;
      }
      if (cmd === 'get_settings' && h.failSettings) throw new WalletError({ code: 'UNAVAILABLE', message: 'settings store is busy' });
      return real.invoke(cmd, args, opts);
    },
    listen: async <E extends EventName>(e: E, cb: (p: PayloadOf<E>) => void) => {
      const s = h.cbs.get(e) ?? new Set();
      s.add(cb as (p: unknown) => void);
      h.cbs.set(e, s);
      return () => { s.delete(cb as (p: unknown) => void); };
    },
  };
}
const fire = (e: string, p: unknown) => { for (const cb of h.cbs.get(e) ?? []) cb(p); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function quiet(): Promise<void> {
  let last = -1;
  while (readBudget.total !== last || readBudget.inFlight > 0) {
    last = readBudget.total;
    await act(async () => { await sleep(120); });
  }
}

/** Opens the main window at a URL (search + hash) on a fresh mock world. */
async function open(url: string): Promise<Backend> {
  history.replaceState(null, '', url);
  resetMockState();
  const real = mockBackend('main');
  h.current = wrap(real);
  render(<App />);
  return real;
}
const layer = () => document.querySelector<HTMLElement>('.cs-layer');
/** The layer's heading once the layer has its content (not the centre's "reading" line). */
const heading = async () => waitFor(() => {
  const el = layer()?.querySelector<HTMLElement>('[data-layer-title]');
  if (!el || el.closest('.cs-centre.loading')) throw new Error('no heading yet');
  return el;
}, { timeout: 8000 });
const gold = () => layer()?.querySelector<HTMLButtonElement>('.cs-gold') ?? null;

const MAIN = new Set(Object.entries(AUTHORITY).filter(([, a]) => (a.labels as readonly string[]).includes('main')).map(([n]) => n));
const RELEASE = new Set(Object.entries(AUTHORITY).filter(([, a]) => a.release).map(([n]) => n));

beforeAll(() => {
  // jsdom has no matchMedia; the console asks it for reduced motion.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }) });
  }
});
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  h.cbs = new Map();
  h.calls = [];
  h.failSettings = false;
  h.holdOpen = null;
  h.failOpen = false;
  resetReadBudget();
});
afterEach(() => { cleanup(); history.replaceState(null, '', '/'); });

/** Every attention item of a world, in plain words as the World gives them. */
async function needsOf(real: Backend) {
  return (await real.invoke('attention_list', null)).items;
}

describe('the decision centre', () => {
  it.each(['/index.html', '/index.html?scale=small', '/index.html?scale=large'])('walks every decision with its "if you do nothing" line (%s)', async (url) => {
    const real = await open(url);
    const items = await needsOf(real);
    expect(items.length).toBeGreaterThan(0);
    await heading();
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i++) {
      const sil = await waitFor(() => { const el = layer()?.querySelector('.cs-silence'); if (!el) throw new Error('no silence line'); return el; });
      const text = sil.textContent ?? '';
      if (sil.classList.contains('ended')) expect(text).toContain(MONEY_CHECK_ENDED_SILENCE.split(' · ')[0] ?? '');
      else expect(text).toContain(`${IF_NOTHING}:`);
      seen.add(layer()?.querySelector('h1')?.textContent ?? '');
      const idx = layer()?.querySelector('.cs-idx')?.getAttribute('aria-label') ?? '';
      expect(idx).toBe(`Decision ${i + 1} of ${items.length}`);
      act(() => { fireEvent.keyDown(window, { key: 'ArrowRight' }); });
    }
    expect(seen.size).toBeGreaterThan(Math.min(2, items.length - 1));
  }, 60_000);

  it('the gold action opens the approval window for that deal and calls nothing else', async () => {
    const real = await open('/index.html');
    const top = (await needsOf(real))[0];
    await heading();
    await quiet();
    const button = await waitFor(() => { const b = gold(); if (!b) throw new Error('no gold'); return b; });
    expect(layer()?.querySelectorAll('.ui-btn.gold')).toHaveLength(1);
    expect(button.title).toBe(APPROVAL_OPEN_TITLE);
    h.calls = [];
    fireEvent.click(button);
    await waitFor(() => expect(h.calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    await quiet();
    const opened = h.calls.filter((c) => c.cmd === 'approval_open');
    expect(opened).toEqual([{ cmd: 'approval_open', args: { deal_id: top?.deal_id } }]);
    // Nothing moves on a click: no other command than the hand-off and reads was sent.
    expect(h.calls.filter((c) => c.cmd !== 'approval_open' && AUTHORITY[c.cmd as CommandName]?.tier !== 'read')).toEqual([]);
    // And the centre does not claim an outcome: the same decision is still in front.
    expect(layer()?.querySelector('.cs-idx')?.getAttribute('aria-label')).toMatch(/^Decision 1 of/);
  }, 30_000);

  it('never calls a command outside Main’s rows, and never a release command, while used', async () => {
    await open('/index.html?scale=small');
    await heading();
    fireEvent.click(gold() as HTMLButtonElement);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: /need you/ }));
    await heading();
    fireEvent.keyDown(window, { key: 'Escape' });
    await quiet();
    const called = new Set(h.calls.map((c) => c.cmd));
    expect([...called].filter((c) => !MAIN.has(c))).toEqual([]);
    expect([...called].filter((c) => RELEASE.has(c))).toEqual([]);
  }, 30_000);

  it('locked: the gold action carries the lock and says so, and waits while the window opens', async () => {
    await open('/index.html?locked=1');
    await heading();
    const button = await waitFor(() => { const b = gold(); if (!b || !b.classList.contains('locked')) throw new Error('not locked yet'); return b; });
    expect(button.title).toBe(APPROVAL_LOCKED_TITLE);
    h.holdOpen = () => {};
    fireEvent.click(button);
    await waitFor(() => expect(gold()?.disabled).toBe(true));
    await act(async () => { h.holdOpen?.(); await sleep(20); });
    await waitFor(() => expect(gold()?.disabled).toBe(false));
  }, 30_000);

  it('locked: the top bar lock opens the approval window, and says so when it could not', async () => {
    await open('/index.html?locked=1');
    await heading();
    const lock = await waitFor(() => { const b = document.querySelector<HTMLButtonElement>('.cs-bar .lockbtn.is-locked'); if (!b) throw new Error('not locked yet'); return b; });
    h.failOpen = true;
    h.calls = [];
    fireEvent.click(lock);
    await waitFor(() => expect(h.calls.some((c) => c.cmd === 'approval_open')).toBe(true));
    const said = await waitFor(() => { const t = document.querySelector('.ui-toasts .ui-toast.bad'); if (!t) throw new Error('no toast'); return t; });
    expect(said.textContent).toContain(NOTICE_WHAT.approval);
  }, 30_000);

  it('a failed read shows the stale banner in plain words, and Try again reads again', async () => {
    h.failSettings = true;
    await open('/index.html');
    const banner = await waitFor(() => { const el = document.querySelector('.cs-stale'); if (!el) throw new Error('no banner'); return el as HTMLElement; }, { timeout: 8000 });
    expect([UNREAD_TITLE, STALE_TITLE]).toContain(banner.querySelector('b')?.textContent);
    expect(banner.textContent).toContain('your settings');
    expect(banner.textContent).toContain('If you do nothing, no money moves.');
    expect(banner.textContent).not.toMatch(/UNAVAILABLE|get_settings|busy/);
    h.failSettings = false;
    fireEvent.click(within(banner).getByRole('button'));
    await waitFor(() => expect(document.querySelector('.cs-stale')).toBeNull(), { timeout: 8000 });
  }, 30_000);
});

describe('the stack row fills its free slots', () => {
  it('a small shop fills the row with what happened while the owner was away or what the wallet watches, and a card opens its deal', async () => {
    await open('/index.html?scale=small');
    await heading();
    const fill = await waitFor(() => { const c = layer()?.querySelectorAll<HTMLButtonElement>('.cs-card.fill'); if (!c?.length) throw new Error('no fill yet'); return [...c]; }, { timeout: 8000 });
    expect(fill.length).toBeGreaterThan(0);
    // never gold: only the decision's action is
    for (const c of fill) expect(c.classList.contains('gold')).toBe(false);
    for (const c of fill) {
      expect(c.querySelector('.wk')?.textContent).toMatch(/^(While you were away|Watching · )/);
      expect(c.querySelector('b')?.textContent ?? '').not.toBe('');
    }
    fireEvent.click(fill[0] as HTMLButtonElement);
    await waitFor(() => expect(['deal', 'rewind']).toContain(layer()?.dataset.level));
  }, 30_000);
});

describe('at scale', () => {
  const RAW = /^[A-Z]{2,}_|D-\d{4}|_list|_query|UNAVAILABLE/;
  const texts = (root: ParentNode) => {
    const out: string[] = [];
    const w = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) { const t = n.textContent?.trim(); if (t) out.push(t); }
    return out;
  };
  it('draws no raw enum name or id on the centre or the waiting list of the busy merchant', async () => {
    await open('/index.html?scale=large');
    await heading();
    await quiet();
    expect(texts(document.body).filter((t) => RAW.test(t))).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /need you/ }));
    await waitFor(() => expect(layer()?.dataset.level).toBe('waiting'));
    await quiet();
    expect(texts(document.body).filter((t) => RAW.test(t))).toEqual([]);
  }, 60_000);

  it('opens the 500-deal world within the read budget', async () => {
    const t0 = performance.now();
    await open('/index.html?scale=large');
    await heading();
    const shown = performance.now() - t0;
    await quiet();
    expect(readBudget.byCommand.get('list_deals')?.total).toBe(1);
    expect(readBudget.byCommand.get('attention_list')?.total).toBe(1);
    expect(readBudget.byCommand.get('get_settings')?.total).toBe(1);
    expect(readBudget.byCommand.get('deal_display')?.total).toBeLessThanOrEqual(500);
    expect(readBudget.byCommand.get('deal_display')?.maxInFlight).toBeLessThanOrEqual(READ_CONCURRENCY);
    expect(readBudget.maxInFlight).toBeLessThanOrEqual(16);
    // jsdom is slower than the shell; this is a guard against a runaway, not the shell's timing.
    expect(shown).toBeLessThan(8000);
  }, 60_000);
});

describe('the chain of layers', () => {
  it('Escape goes one layer up and gives focus back to what opened the layer', async () => {
    await open('/index.html');
    await heading();
    const all = await waitFor(() => { const b = layer()?.querySelector<HTMLButtonElement>('[data-fk="all-waiting"]'); if (!b) throw new Error('no all-waiting'); return b; });
    all.focus();
    fireEvent.click(all);
    await waitFor(() => expect(layer()?.dataset.level).toBe('waiting'));
    expect(location.hash).toBe('#w=waiting');
    await waitFor(() => expect(document.activeElement?.textContent).toContain('wait for you'));
    expect(screen.getByRole('navigation', { name: 'Where you are' }).textContent).toContain(WAITING_TITLE);
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Escape' });
    await waitFor(() => expect(layer()?.dataset.level).toBe('home'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.fk).toBe('all-waiting'));
    // At the centre Escape stays: the console never leaves itself.
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => { await sleep(50); });
    expect(layer()?.dataset.level).toBe('home');
  }, 30_000);

  it('Find closes before anything else, and Back walks the same chain', async () => {
    await open('/index.html#w=waiting');
    await waitFor(() => expect(layer()?.dataset.level).toBe('waiting'));
    fireEvent.keyDown(window, { key: '/' });
    const dialog = await screen.findByRole('dialog', { name: FIND_LABEL });
    expect(document.querySelector('.cs-app')?.hasAttribute('inert')).toBe(true);
    const input = within(dialog).getByRole('combobox');
    expect(input.getAttribute('aria-activedescendant')).toMatch(/^cs-find-/);
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: FIND_LABEL })).toBeNull());
    expect(layer()?.dataset.level).toBe('waiting');
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(layer()?.dataset.level).toBe('home'));
    // into a module, then the browser's Back returns to the centre
    fireEvent.click(screen.getByRole('tab', { name: /Spend/ }));
    await waitFor(() => expect(layer()?.dataset.level).toBe('module'));
    expect(location.hash).toBe('#m=spend');
    act(() => { history.back(); });
    await waitFor(() => expect(layer()?.dataset.level).toBe('home'), { timeout: 5000 });
  }, 30_000);

  it('Find picks a deal and opens it a layer down from where it was found', async () => {
    await open('/index.html#m=spend');
    await waitFor(() => expect(layer()?.dataset.level).toBe('module'));
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = within(await screen.findByRole('dialog', { name: FIND_LABEL })).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'usb-c dock' } });
    const opts = await screen.findAllByRole('option');
    // the decision comes first (it opens the centre at it); the deal row opens the deal
    expect(opts[0]?.id).toMatch(/^cs-find-n-/);
    const deal = opts.find((o) => o.id.startsWith('cs-find-d-'));
    expect(deal).toBeTruthy();
    fireEvent.click(deal as HTMLElement);
    await waitFor(() => expect(layer()?.dataset.level).toBe('deal'));
    expect(location.hash).toMatch(/^#d=[^&]+&m=spend$/);
  }, 30_000);
});

describe('old links and the Tumbler', () => {
  it('#m=, #d= and #s=setup land where they did', async () => {
    await open('/index.html#m=spend');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Spend/ }).getAttribute('aria-selected')).toBe('true'));
    cleanup();
    await open('/index.html#d=D-0193');
    await waitFor(() => expect(layer()?.dataset.level).toBe('deal'));
    await waitFor(() => expect(layer()?.querySelector('h1')?.textContent ?? '').toMatch(/monitor/i), { timeout: 8000 });
    cleanup();
    await open('/index.html#s=setup&step=rules');
    expect(await screen.findByRole('heading', { name: SETUP_STEP_COPY.rules.lead })).toBeTruthy();
  }, 30_000);

  it('a main:route event opens the deal, or the centre', async () => {
    const real = await open('/index.html');
    await heading();
    const d = (await real.invoke('list_deals', null))[0];
    await act(async () => { fire('main:route', { deal_id: d?.id ?? null }); });
    await waitFor(() => expect(layer()?.dataset.level).toBe('deal'));
    await act(async () => { fire('main:route', { deal_id: null }); });
    await waitFor(() => expect(layer()?.dataset.level).toBe('home'));
    expect(screen.getByRole('region', { name: CENTRE_TITLE })).toBeTruthy();
  }, 30_000);

  it('a brand-new wallet opens on the Charter instead of the centre', async () => {
    await open('/index.html?first_run=1');
    await waitFor(() => expect(screen.getByRole('region', { name: CHARTER_TITLE })).toBeTruthy(), { timeout: 8000 });
    expect(layer()?.querySelector('.cs-centre')).toBeNull();
    expect(await screen.findByRole('heading', { name: SETUP_STEP_COPY.keys.lead })).toBeTruthy();
  }, 30_000);
});

describe('the owner places are layers (WP2.5)', () => {
  it('Rules from the top bar is a layer; the wallet limits are one below; Escape walks back with focus', async () => {
    await open('/index.html');
    await heading();
    const rules = screen.getByRole('button', { name: PLACE.rules });
    rules.focus();
    fireEvent.click(rules);
    await waitFor(() => expect(layer()?.dataset.layer).toBe('rules'));
    expect(location.hash).toBe('#p=rules');
    expect(document.querySelector('.ui-sheet')).toBeNull();
    // Going in, focus lands on the layer's heading (since WP3c the place's one answer line).
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.closest('.cs-layer')?.getAttribute('data-layer') === 'rules' && document.activeElement?.hasAttribute('data-layer-title')).toBe(true));
    const toLimits = await waitFor(() => { const b = layer()?.querySelector<HTMLButtonElement>('[data-fk="to-limits"]'); if (!b) throw new Error('no limits link'); return b; });
    toLimits.focus();
    fireEvent.click(toLimits);
    await waitFor(() => expect(layer()?.dataset.layer).toBe('limits'));
    expect(location.hash).toBe('#p=limits');
    expect(screen.getByRole('navigation', { name: 'Where you are' }).textContent).toContain(PLACE_NAME.rules);
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(layer()?.dataset.layer).toBe('rules'));
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.fk).toBe('to-limits'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(layer()?.dataset.level).toBe('home'));
    await waitFor(() => expect(document.activeElement?.id).toBe('cs-place-rules'));
  }, 30_000);

  it('old sheet and safety links open their layer, and Back goes where the old sheet sat', async () => {
    await open('/index.html#s=settings');
    await waitFor(() => expect(layer()?.dataset.layer).toBe('settings'));
    expect(location.hash).toBe('#p=settings');
    expect(document.querySelector('.ui-sheet')).toBeNull();
    cleanup();
    await open('/index.html#m=book&p=safety');
    await waitFor(() => expect(layer()?.dataset.layer).toBe('safety'));
    expect(location.hash).toBe('#p=safety&m=book');
    fireEvent.click(screen.getByRole('button', { name: /^Back$/ }));
    await waitFor(() => expect(layer()?.dataset.layer).toBe('book'));
    cleanup();
    await open('/index.html#s=pairing');
    await waitFor(() => expect(layer()?.dataset.layer).toBe('pairing'));
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(layer()?.dataset.layer).toBe('connections'));
  }, 30_000);

  it('the beads are buttons named by their deal, one tab stop; the arrows move along them, Enter opens', async () => {
    await open('/index.html');
    await heading();
    const beads = await waitFor(() => { const b = [...document.querySelectorAll<HTMLButtonElement>('.cs-bead')]; if (b.length < 2) throw new Error('no beads'); return b; });
    expect(beads.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    for (const b of beads) expect(b.getAttribute('aria-label') ?? '').not.toBe('');
    const idx = layer()?.querySelector('.cs-idx')?.getAttribute('aria-label');
    act(() => { beads[0]?.focus(); });
    fireEvent.keyDown(beads[0] as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(beads[1]);
    // the centre's own Left / Right (walk the queue) did not run
    expect(layer()?.querySelector('.cs-idx')?.getAttribute('aria-label')).toBe(idx);
    fireEvent.click(beads[1] as HTMLElement);
    await waitFor(() => expect(layer()?.dataset.layer).toBe('deal'));
  }, 30_000);
});
