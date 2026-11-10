// The item page of an ended deal says nothing about time left: the wallet keeps the deadline it
// stored while the deal was live, and a countdown to it would sit at 0:00:00. A live deal with a
// future deadline still shows its time left and its countdown.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Backend } from '../../../lib/contract';
import { IF_NOTHING } from '../../../lib/words';
import { mockBackend, resetMockState, type MockBackend } from '../../../mock/backend';
import { CounterpartyProvider } from '../ui';
import { WorldProvider } from '../world';
import type { PanelHost } from '../switchboard/Answer';
import { ItemStage } from './ItemStage';
import type { ModuleRow } from './rows/rows';

const hoisted = vi.hoisted(() => ({ current: null as Backend | null }));
vi.mock('../../../lib/runtime', () => ({ backend: () => hoisted.current }));

const PIN = new Date('2026-11-06T09:30:00');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PIN);
  localStorage.clear();
  sessionStorage.clear();
  resetMockState();
  history.replaceState(null, '', '/index.html');
});
afterEach(() => { cleanup(); vi.useRealTimers(); hoisted.current = null; });

const host = { model: { byId: new Map() }, run: () => {}, pending: false, error: null, locked: false, pick: () => {}, filterTo: () => {} } as unknown as PanelHost;

async function stage(label: string) {
  const w: MockBackend = mockBackend('main');
  hoisted.current = w;
  const held = w.world.deal(label);
  if (!held) throw new Error(`no deal ${label}`);
  held.display.deadline = Math.floor(Date.now() / 1000) + 3600;
  const row: ModuleRow = { id: held.deal.id, module: 'counter', deal_id: held.deal.id, title: held.display.title, cells: [], sub: null, fate: null, deadline_s: null };
  const open = { kind: 'row', module: row.module, id: row.id } as never;
  const r = render(<WorldProvider><CounterpartyProvider><ItemStage open={open} row={row} list={null} host={host} gs={{} as never} onJump={() => {}} onBack={() => {}} below={null} /></CounterpartyProvider></WorldProvider>);
  await waitFor(() => expect(r.container.querySelector('.dv-figs')).not.toBeNull());
  return r;
}

describe('the item page and a stored deadline', () => {
  it('an ended deal (a hold that ran out) shows no time left and no countdown', async () => {
    const { container } = await stage('D-0181');
    await new Promise((r) => setTimeout(r, 100));
    expect(container.textContent).not.toMatch(/Time left/);
    expect(container.querySelector('[role="timer"]')).toBeNull();
    expect(container.textContent).not.toContain(IF_NOTHING);
  });

  it('a live deal with a future deadline still shows its time left and a countdown', async () => {
    const { container } = await stage('D-0194');
    await waitFor(() => expect(container.querySelector('.dv-figs [role="timer"]')).not.toBeNull());
    expect(container.textContent).toMatch(/Time left/);
  });
});
