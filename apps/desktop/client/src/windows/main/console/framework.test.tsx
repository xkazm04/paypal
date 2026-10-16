// The layer framework (rebuild WP2.5): every layer id is registered exactly once and every route
// maps to one; a layer is hosted inside its boundary with the console's chrome owning Back (a
// nested DetailPage draws none); the module layer chrome (answer, Your call with its default on
// silence, summary cards that open views and give focus back, the view host, the calm empty line);
// and the shared row parts (amounts from minor units, states in words and never raw, unknowns dashed).
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { IF_NOTHING, MODULE_EMPTY, STATE_UNKNOWN, YOUR_CALL } from '../../../lib/words';
import { mockBackend, resetMockState } from '../../../mock/backend';
import { DetailPage, UNKNOWN } from '../../../shared/ui';
import { MODULE_KEYS, PLACES, type Route } from '../logic';
import { ToastProvider } from '../ui';
import { WorldProvider } from '../world';
import { defineLayer, LayerHost, layerIdOf, placeFromRoute, type LayerId, type LayerNav, type LayerProps } from './layers';
import { ALL_LAYERS, LAYER_PARTS, layerOf } from './layers.registry';
import { ModuleLayer } from './ModuleLayer';
import { defineModuleViews } from './ModuleSummary';
import { Amount, Countdown, StateChip, WhoChip } from './rows';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); history.replaceState(null, '', '/index.html'); resetMockState(); hoisted.current = mockBackend('main'); });
afterEach(() => { cleanup(); hoisted.current = null; });

const IDS: LayerId[] = ['centre', 'waiting', 'rewind', 'setup', 'deal', ...MODULE_KEYS, ...PLACES];

describe('the registry', () => {
  it('registers every layer exactly once', () => {
    const seen = ALL_LAYERS.map((d) => d.id);
    expect([...seen].sort()).toEqual([...IDS].sort());
    expect(new Set(seen).size).toBe(seen.length);
    // every layer but the centre and the waiting list is its own chunk
    expect(LAYER_PARTS).toHaveLength(ALL_LAYERS.length - 2);
  });
  it('maps every route to its layer, with a name in plain words', () => {
    const routes: Route[] = [
      { level: 'home' }, { level: 'waiting' }, { level: 'rewind' }, { level: 'setup' }, { level: 'deal', deal: 'x' },
      ...MODULE_KEYS.map((m): Route => ({ level: 'module', module: m })),
      ...PLACES.map((p): Route => ({ level: 'place', place: p })),
    ];
    for (const r of routes) {
      const def = layerOf(r);
      expect(def.id).toBe(layerIdOf(r));
      const t = def.title(r);
      expect(t.length).toBeGreaterThan(2);
      expect(t).not.toMatch(/_|[A-Z]{3,}/);
    }
  });
  it('a place opened from a module page or from Settings returns there', () => {
    expect(placeFromRoute({ level: 'module', module: 'spend' }, 'rules')).toBe('spend');
    expect(placeFromRoute({ level: 'place', place: 'settings' }, 'pairing')).toBe('settings');
    expect(placeFromRoute({ level: 'place', place: 'settings' }, 'settings')).toBeUndefined();
    expect(placeFromRoute({ level: 'home' }, 'rules')).toBeUndefined();
  });
});

const nav = (): LayerNav => ({ go: vi.fn(), back: vi.fn(), home: vi.fn(), module: vi.fn(), deal: vi.fn(), need: vi.fn(), place: vi.fn(), rewind: vi.fn(), setup: vi.fn(), quit: vi.fn() });
const STATE = { rewindAt: null, pairMode: undefined, firstRun: false, presence: { state: 'quiet' as const, word: 'Quiet', line: 'Nothing waits' } };
function host(route: Route, C: (p: LayerProps) => ReactNode, n: LayerNav = nav()) {
  const def = defineLayer({ id: layerIdOf(route), title: () => 'Test', component: C });
  return render(<ToastProvider><WorldProvider><LayerHost def={def} route={route} nav={n} state={STATE} resetKey="k" /></WorldProvider></ToastProvider>);
}

describe('the layer host', () => {
  it('owns Back: a DetailPage inside a layer draws none of its own', () => {
    host({ level: 'place', place: 'rules' }, () => <DetailPage title="Ledger" onBack={() => {}}>body</DetailPage>);
    expect(screen.getByRole('heading', { name: 'Ledger' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Back/ })).toBeNull();
  });
  it('a layer that throws shows its calm fallback, not a blank window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    host({ level: 'place', place: 'rules' }, () => { throw new Error('boom'); });
    expect(document.querySelector('.boundary')).toBeTruthy();
    expect(document.body.textContent).not.toContain('boom');
    spy.mockRestore();
  });
});

const VIEWS = defineModuleViews('spend', { recent: 'Recent purchases' });

describe('the module layer chrome', () => {
  it('says the one answer, Your call with its default on silence, and cards that open views', async () => {
    const n = nav();
    host({ level: 'module', module: 'spend' }, () => (
      <ModuleLayer module="spend" answer="Two purchases wait for you"
        cards={[{ id: 'recent', view: 'recent', label: 'Recent', value: '12 purchases', ifNothing: 'nothing is paid' }]}
        views={{ recent: { title: VIEWS.recent, render: () => <p>the list</p> } }} />
    ), n);
    expect(screen.getByRole('heading', { level: 1, name: 'Two purchases wait for you' })).toBeTruthy();
    // the default "Your call": the module's own open decisions from the World
    const call = await waitFor(() => screen.getByRole('button', { name: /decision.* here need/ }));
    expect(call.textContent).toContain(YOUR_CALL);
    expect(document.querySelector('.ml-silence')?.textContent).toContain(`${IF_NOTHING}:`);
    fireEvent.click(call);
    expect(n.go).toHaveBeenCalledWith({ level: 'waiting', module: 'spend' });
    // a needs-you card carries the "if you do nothing" line, and opens its view with focus to return to
    const card = document.querySelector<HTMLButtonElement>('[data-card="recent"]');
    expect(card?.textContent).toContain(`${IF_NOTHING}: nothing is paid`);
    fireEvent.click(card as HTMLButtonElement);
    expect(n.go).toHaveBeenCalledWith({ level: 'module', module: 'spend', view: 'recent' }, { focus: 'card:recent' });
  });
  it('hosts a detail view under its own heading', () => {
    host({ level: 'module', module: 'spend', view: 'recent' }, () => (
      <ModuleLayer module="spend" answer="x" views={{ recent: { title: VIEWS.recent, render: () => <p>the list</p> } }} />
    ));
    expect(screen.getByRole('heading', { level: 1, name: 'Recent purchases' })).toBeTruthy();
    expect(screen.getByText('the list')).toBeTruthy();
  });
  it('with nothing to show: one calm line', () => {
    host({ level: 'module', module: 'book' }, () => <ModuleLayer module="book" answer="Your book" yourCall={null} />);
    expect(screen.getByText(MODULE_EMPTY)).toBeTruthy();
    expect(screen.queryByText(YOUR_CALL)).toBeNull();
  });
});

describe('the row parts', () => {
  it('an amount comes from minor units, an unknown one is the dash', () => {
    render(<><Amount minor={32900} currency="USD" tone="held" /><Amount money={null} /><Amount minor={null} currency="USD" /></>);
    const all = [...document.querySelectorAll('.cs-amt')];
    expect(all[0]?.textContent).toBe('$329.00');
    expect(all[1]?.textContent).toBe(UNKNOWN);
    expect(all[2]?.textContent).toBe(UNKNOWN);
    expect(all[1]?.classList.contains('unknown')).toBe(true);
  });
  it('a state reads in words; one the words do not know is "Not available yet", never the raw name', () => {
    render(<><StateChip state="AWAITING_APPROVAL" /><StateChip state={'TELEPORTED' as never} /><StateChip state={null} /></>);
    const chips = [...document.querySelectorAll('.cs-state')];
    expect(chips[0]?.textContent).not.toMatch(/_/);
    expect(chips[1]?.textContent).toBe(STATE_UNKNOWN);
    expect(chips[1]?.classList.contains('dashed')).toBe(true);
    expect(chips[2]?.textContent).toBe(STATE_UNKNOWN);
    expect(document.body.textContent).not.toContain('TELEPORTED');
  });
  it('a long counterparty name truncates with the full name in its title; no deadline is said so', () => {
    act(() => { render(<><WhoChip name="Hamburg-Altona Gebrauchte Büro- und Computermöbel GmbH" /><WhoChip name={null} /><Countdown deadline={null} /></>); });
    const who = document.querySelector('.cs-who-chip');
    expect(who?.getAttribute('title')).toBe('Hamburg-Altona Gebrauchte Büro- und Computermöbel GmbH');
    expect(document.querySelectorAll('.cs-who-chip')[1]?.classList.contains('unknown')).toBe(true);
    expect(document.querySelector('.cs-cd.none')).toBeTruthy();
  });
});
