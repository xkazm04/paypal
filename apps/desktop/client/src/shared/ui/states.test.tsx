// The async-state family (components.tsx Placeholder / Empty / ReadFailed / ReadState; registry
// async-ui-states): empty is earned by an answer, never shown while the first one is on its way; a
// held answer survives a refresh (and a failed refresh); a failure is not an empty and its Try again
// asks the same read again; loading and failure are each announced once, not per row.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WalletError } from '../../lib/contract';
import { UI_WORDS } from '../../lib/words';
import { Empty, Placeholder, ReadFailed, ReadState, type ReadOf } from './components';

afterEach(cleanup);

const EMPTY = 'Nothing signed yet.';
const read = <T,>(o: Partial<ReadOf<T>>): ReadOf<T> => ({ data: undefined, error: null, refetch: async () => {}, ...o });
const unavailable = () => new WalletError({ code: 'UNAVAILABLE', message: 'not there' });

function List({ q }: { q: ReadOf<string[]> }) {
  return (
    <ReadState q={q} what="your rules" failWhat="Your rules">
      {(rows) => (rows.length ? <ul>{rows.map((r) => <li key={r}>{r}</li>)}</ul> : <Empty>{EMPTY}</Empty>)}
    </ReadState>
  );
}

describe('ReadState', () => {
  it('shows no empty state before the first answer settles: a placeholder, announced once', () => {
    render(<List q={read<string[]>({})} />);
    expect(screen.queryByText(EMPTY)).toBeNull();
    const status = screen.getAllByRole('status');
    expect(status).toHaveLength(1);
    expect(status[0]?.textContent).toBe(UI_WORDS.reading('your rules'));
    expect(status[0]?.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(1);
  });

  it('shows the empty state once an answer came back with nothing in it', () => {
    render(<List q={read<string[]>({ data: [] })} />);
    expect(screen.getByText(EMPTY)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps held content through a refresh, and through a refresh that failed (said above it)', () => {
    const { rerender } = render(<List q={read({ data: ['Spend rules'] })} />);
    expect(screen.getByText('Spend rules')).toBeTruthy();
    // A refresh in flight: nothing changes on screen.
    rerender(<List q={read({ data: ['Spend rules'] })} />);
    expect(screen.getByText('Spend rules')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    // The refresh failed: the last good answer stays, the failure is admitted beside it.
    rerender(<List q={read({ data: ['Spend rules'], error: unavailable() })} />);
    expect(screen.getByText('Spend rules')).toBeTruthy();
    expect(screen.getByRole('button', { name: UI_WORDS.tryAgain })).toBeTruthy();
  });

  it('a read that never answered is a failure, not an empty, and Try again asks it again', async () => {
    const refetch = vi.fn(async () => {});
    render(<List q={read<string[]>({ error: new WalletError({ code: 'REFUSED', message: 'no' }), refetch })} />);
    expect(screen.queryByText(EMPTY)).toBeNull();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: UI_WORDS.tryAgain })); });
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ReadFailed', () => {
  it('offers no Try again where asking again cannot help (locked, not allowed, not supported)', () => {
    for (const code of ['LOCKED', 'PERMISSION', 'UNSUPPORTED'] as const) {
      render(<ReadFailed error={new WalletError({ code, message: 'x' })} what="Your deals" onRetry={() => {}} />);
      expect(screen.queryByRole('button', { name: UI_WORDS.tryAgain })).toBeNull();
      cleanup();
    }
  });

  it('is busy while the retry runs, then ready again', async () => {
    let done: () => void = () => {};
    const onRetry = () => new Promise<void>((r) => { done = r; });
    render(<ReadFailed error={unavailable()} what="Your deals" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: UI_WORDS.tryAgain }) as HTMLButtonElement;
    await act(async () => { fireEvent.click(btn); });
    expect(btn.disabled).toBe(true);
    await act(async () => { done(); });
    expect(btn.disabled).toBe(false);
  });
});

describe('Placeholder and Empty', () => {
  it('draws the shape asked for', () => {
    const { container } = render(<><Placeholder what="the deal" shape="pane" /><Placeholder what="your book" shape="cards" count={3} /></>);
    expect(container.querySelector('.ui-ph.pane')?.querySelectorAll('.ui-ph-b')).toHaveLength(3);
    expect(container.querySelector('.ui-ph.cards')?.querySelectorAll('.ui-ph-b')).toHaveLength(3);
  });

  it('carries the module plate quietly (hidden from assistive technology) and the next step', () => {
    const { container } = render(<Empty art="spend" action={<button type="button">Open rules</button>}>{EMPTY}</Empty>);
    expect(container.querySelector('svg.ui-empty-art')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Open rules' })).toBeTruthy();
  });
});
