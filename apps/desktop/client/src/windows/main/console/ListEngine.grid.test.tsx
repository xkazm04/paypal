// The grid is a chunk of its own (client perf): a plain list never asks for it, and a list drawn as a
// grid holds its place with a calm skeleton (and a "loading" status for a screen reader) until the
// chunk has arrived, never a blank. The chunk's loader is held here so the wait can be seen.
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIST_LOADING } from '../../../lib/words';

const gate = vi.hoisted(() => ({ asked: 0, release: () => {}, held: null as Promise<void> | null }));
vi.mock('../../../shared/DataGrid', async (orig) => {
  gate.asked += 1;
  await gate.held;
  return orig();
});

import { DataGridPart, ListEngine } from './ListEngine';

type Row = { id: string; title: string };
const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}`, title: `Monitor ${i}` }));
const columns = [{ id: 'title', header: 'What', value: (r: Row) => r.title }];

afterEach(() => cleanup());

describe('the grid chunk', () => {
  it('is not asked for by a plain list', () => {
    const { container } = render(<ListEngine<Row> label="Plain" rows={rows} getKey={(r) => r.id} estimateSize={36} renderRow={(r) => r.title} empty="none" />);
    expect(container.querySelector('.le-scroll[role="list"]')).not.toBeNull();
    expect(container.querySelector('.stg-skel')).toBeNull();
    expect(gate.asked).toBe(0);
    expect(DataGridPart.ready()).toBe(false);
  });

  it('holds the place of a grid list with a skeleton until it has loaded', async () => {
    gate.held = new Promise<void>((r) => { gate.release = r; });
    const { container } = render(<ListEngine<Row> label="Grid" rows={rows} getKey={(r) => r.id} estimateSize={36} renderRow={(r) => r.title} columns={columns} empty="none" />);
    expect(container.querySelector('.le-col .stg-skel')).not.toBeNull();
    expect(screen.getByRole('status').textContent).toBe(LIST_LOADING);
    gate.release();
    await waitFor(() => expect(container.querySelector('.sg-grid')).not.toBeNull());
    expect(container.querySelector('.le-col .stg-skel')).toBeNull();
    expect(gate.asked).toBe(1);
  });
});
