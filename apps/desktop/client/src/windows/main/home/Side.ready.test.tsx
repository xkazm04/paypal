// The side list does not claim an empty wallet while the wallet is still being read: not ready draws
// the shared Placeholder (no empty sentence, no zero count), ready-and-empty draws the sentence.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Module } from '@bindings/Module';
import { MODULE_KEYS } from '../../../lib/assistant';
import type { BoardModel } from '../switchboard/useBoardModel';
import type { ModuleList } from './rows/rows';
import { START_NAV } from './nav';
import { Side } from './Side';
import { STAGE } from './words';

const lists = Object.fromEntries(MODULE_KEYS.map((m) => [m, { module: m, columns: [], rows: [], empty: 'Nothing in this module.' }])) as unknown as Record<Module, ModuleList>;
const modelOf = (ready: boolean) =>
  ({ ready, byId: new Map(), cells: Object.fromEntries(MODULE_KEYS.map((m) => [m, { needs: { count: 0 } }])) }) as unknown as BoardModel;

const mount = (ready: boolean, query = '') =>
  render(<Side lists={lists} nav={{ ...START_NAV, query }} model={modelOf(ready)} selected={null} calm
    onScope={vi.fn()} onQuery={vi.fn()} onClearFate={vi.fn()} onOpen={vi.fn()} />);

describe('Side while the wallet is being read', () => {
  it('shows the placeholder, never the empty sentence or a zero count, and keeps the chrome', () => {
    const { container } = mount(false);
    expect(screen.queryByText(STAGE.nothing)).toBeNull();
    expect(screen.queryByText(STAGE.count(0, 0))).toBeNull();
    expect(container.querySelector('.ui-ph')).not.toBeNull();
    expect(screen.getByLabelText(STAGE.filterLabel)).toBeTruthy();
    expect(container.querySelector('.fs-lh')).not.toBeNull();
  });

  it('shows the empty sentence and the count once ready and really empty', () => {
    const { container } = mount(true);
    expect(screen.getByText(STAGE.nothing)).toBeTruthy();
    expect(screen.getByText(STAGE.count(0, 0))).toBeTruthy();
    expect(container.querySelector('.ui-ph')).toBeNull();
  });

  it('still shows its no-match text for a filter that matches nothing', () => {
    mount(true, 'zzz');
    expect(screen.getByText(STAGE.noMatch('zzz'))).toBeTruthy();
  });
});
