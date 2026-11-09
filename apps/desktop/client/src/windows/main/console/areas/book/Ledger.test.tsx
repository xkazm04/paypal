// The ledger's "Save proof files" and its header: each proof file is one native save window in the shell,
// so a month of them is saved strictly one at a time (never two windows open), said up front and confirmed
// above ten, stopped by the person or by two save windows closed in a row, and counted honestly (saved,
// not saved, no proof file and why). The header's spreadsheet export reads the clock when it names a
// file, so the ledger is not drawn again every second.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Deal } from '@bindings/Deal';
import { WalletError } from '../../../../../lib/contract';
import { BOOK_PROOFS } from '../../../../../lib/words';
import { CONFIRM_ABOVE, exportProofs, LedgerActions, monthsOf, ProofExport } from './Ledger';
import type { BookWorld } from './parts';

afterEach(() => { vi.useRealTimers(); cleanup(); });

/** Deals of one month (October 2026, UTC), an hour apart. */
const OCT = Date.UTC(2026, 9, 1) / 1000;
const month = (n: number, start = OCT): Deal[] => Array.from({ length: n }, (_, i) => ({ id: `D-${String(i).padStart(4, '0')}`, created_at: start + i * 3_600, updated_at: null }) as unknown as Deal);
const ids = (ds: readonly Deal[]) => ds.map((d) => d.id);

/** A save the test settles by hand (true: saved, false: the save window was closed, an Error: no proof
 *  file), counting how many are out at once. */
function heldSaves(outcome: (id: string) => boolean | Error = () => true) {
  const waiting: Array<() => void> = [];
  const calls: string[] = [];
  let out = 0;
  let most = 0;
  const save = (id: string) => new Promise<boolean>((resolve, reject) => {
    calls.push(id);
    out += 1;
    most = Math.max(most, out);
    waiting.push(() => {
      out -= 1;
      const r = outcome(id);
      if (r instanceof Error) reject(r);
      else resolve(r);
    });
  });
  const settle = async (n = Infinity) => {
    for (let i = 0; i < n && waiting.length; i += 1) {
      waiting.shift()?.();
      // let the loop take its next deal
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { save, calls, settle, most: () => most };
}

const drain = async (h: ReturnType<typeof heldSaves>, run: Promise<unknown>) => {
  let finished = false;
  void run.then(() => { finished = true; });
  for (let guard = 0; !finished && guard < 10_000; guard += 1) await h.settle(1);
};

describe('a month of proof files', () => {
  it('at 200 deals never has more than one save out at once, and counts what came of each', async () => {
    const preview = 'This preview has no keys to sign a proof with.';
    const h = heldSaves((id) => {
      const n = Number(id.slice(2));
      if (n % 10 === 3) return new WalletError({ code: 'UNAVAILABLE', message: preview });
      if (n % 50 === 7) return false; // one save window closed, not two in a row
      return true;
    });
    const progress: number[] = [];
    const run = exportProofs(ids(month(200)), h.save, { onProgress: (t) => progress.push(t.done) });
    await Promise.resolve();
    // one asked for, no second until it settles
    expect(h.calls).toHaveLength(1);
    await drain(h, run);
    const tally = await run;
    expect(h.most()).toBe(1);
    expect(h.calls).toEqual(ids(month(200)));
    expect(tally).toEqual({ total: 200, started: 200, done: 200, written: 176, closed: 4, missing: [[preview, 20]], stopped: false, closedTwice: false });
    expect(progress).toEqual(Array.from({ length: 200 }, (_, i) => i + 1));
  });

  it('stops asking when cancelled: the save already out finishes and is counted, the rest is never asked for', async () => {
    const h = heldSaves();
    const stop = new AbortController();
    const run = exportProofs(ids(month(200)), h.save, { signal: stop.signal });
    await Promise.resolve();
    await h.settle(12);
    stop.abort();
    expect(h.calls).toHaveLength(13); // 12 settled, 1 still out
    await drain(h, run);
    const tally = await run;
    expect(h.calls).toHaveLength(13);
    expect(tally).toMatchObject({ total: 200, started: 13, done: 13, written: 13, stopped: true, closedTwice: false });
  });

  it('stops after two save windows closed in a row', async () => {
    const h = heldSaves((id) => !['D-0005', 'D-0006'].includes(id));
    const run = exportProofs(ids(month(200)), h.save);
    await drain(h, run);
    const tally = await run;
    expect(h.calls).toEqual(ids(month(7)));
    expect(tally).toMatchObject({ total: 200, started: 7, written: 5, closed: 2, stopped: true, closedTwice: true });
  });

  it('groups deals by their month in the wallet’s calendar, newest first', () => {
    const ms = monthsOf([...month(3), ...month(2, Date.UTC(2026, 10, 2) / 1000)]);
    expect(ms.map((m) => [m.key, m.label, m.deals.length])).toEqual([['2026-11', 'November 2026', 2], ['2026-10', 'October 2026', 3]]);
  });
});

describe('the Save proof files control', () => {
  it('says how many save windows it means and asks first above ten, then saves one at a time with progress and a stop', async () => {
    const h = heldSaves((id) => (id === 'D-0001' ? new WalletError({ code: 'UNAVAILABLE', message: 'no signed record yet' }) : true));
    const deals = month(200);
    render(<ProofExport rows={deals} inView={deals.slice(0, 5)} save={h.save} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-10' } });
    expect(screen.getByText(BOOK_PROOFS.windows(200))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.save(200) }));
    // more than ten: nothing opens until the person says yes
    expect(200).toBeGreaterThan(CONFIRM_ABOVE);
    expect(screen.getByRole('alert').textContent).toContain(BOOK_PROOFS.confirm(200));
    expect(h.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.confirmYes(200) }));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(screen.getByRole('progressbar')).toBeTruthy();
    await act(async () => { await h.settle(3); });
    expect(screen.getByText(BOOK_PROOFS.progress(3, 200))).toBeTruthy();
    expect(h.most()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.stop }));
    expect(screen.getByText(BOOK_PROOFS.stopping)).toBeTruthy();
    await act(async () => { await h.settle(); });
    await screen.findByText(BOOK_PROOFS.written(3, 200));
    expect(h.calls).toHaveLength(4);
    expect(screen.getByText(BOOK_PROOFS.missing(1, 'no signed record yet'))).toBeTruthy();
    expect(screen.getByText(BOOK_PROOFS.stopped(196))).toBeTruthy();
  });

  it('ten or fewer start without asking, and "Not now" asks for nothing', async () => {
    const h = heldSaves();
    const deals = month(200);
    render(<ProofExport rows={deals} inView={deals.slice(0, 5)} save={h.save} />);
    expect(screen.getByRole('option', { name: BOOK_PROOFS.month('October 2026', 200) })).toBeTruthy();
    expect(screen.getByText(BOOK_PROOFS.windows(5))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.save(5) }));
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => { await h.settle(); });
    await screen.findByText(BOOK_PROOFS.written(5, 5));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '2026-10' } });
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.save(200) }));
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.confirmNo }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(h.calls).toHaveLength(5);
  });

  it('says it stopped when two save windows were closed in a row', async () => {
    const deals = month(8);
    render(<ProofExport rows={deals} inView={deals} save={async (id) => !['D-0002', 'D-0003'].includes(id)} />);
    fireEvent.click(screen.getByRole('button', { name: BOOK_PROOFS.save(8) }));
    await screen.findByText(BOOK_PROOFS.closedTwice);
    expect(screen.getByText(BOOK_PROOFS.written(2, 8))).toBeTruthy();
    expect(screen.getByText(BOOK_PROOFS.closed(2))).toBeTruthy();
    expect(screen.getByText(BOOK_PROOFS.stopped(4))).toBeTruthy();
  });
});

describe('the ledger header', () => {
  it('is not drawn again by the clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 10, 9, 9, 0)));
    const b = { all: [], weekDeals: [], checking: () => false, who: () => '', title: () => '', label: () => '' } as unknown as BookWorld;
    let renders = 0;
    render(<Profiler id="actions" onRender={() => { renders += 1; }}><LedgerActions b={b} scope="week" onScope={() => {}} onProof={() => {}} /></Profiler>);
    const first = renders;
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(renders).toBe(first);
  });
});
