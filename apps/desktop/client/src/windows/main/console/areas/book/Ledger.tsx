// The Book's ledger view (rebuild WP3b): the totals, kept apart, then every deal of the week (or,
// one switch away, everything on record) in one windowed, searchable list. A row shows when, what,
// with whom, its status, its amount and whether PayPal's own statement shows it; that statement is
// read only for the rows in view (scale finding #17). On a wide window the picked row's PayPal proof
// sits beside the list; otherwise a row opens its deal. Where the money went and "PayPal agrees" are
// one disclosure down, and so is "Save proof files" (a proof file per deal in view or in one month,
// through the deal page's own export, one save window at a time). Read-only: nothing here can move money.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import { toWalletError } from '../../../../../lib/contract';
import { useDataClient } from '../../../../../lib/data/provider';
import { clockLabel, formatMinor, nowUnix } from '../../../../../lib/format';
import { useQuery } from '../../../../../lib/hooks';
import { backend } from '../../../../../lib/runtime';
import { BOOK, BOOK_PROOFS, moneyCheckPill, stateWord } from '../../../../../lib/words';
import { ModeBadge } from '../../../../../shared/honesty';
import type { GridColumn } from '../../../../../shared/DataGrid';
import { Btn, Seg, useToast } from '../../../../../shared/ui';
import { amountTone, dealTotal, isTerminal } from '../../../logic';
import { MoneyWent } from '../../../modules/book/MoneyWent';
import { bucketOf, dirOf, toCSV, type Bucket } from '../../../modules/book/model';
import { useLayerNav } from '../../layers';
import { fewRows, ListEngine, type ListFilter } from '../../ListEngine';
import { Amount } from '../../rows';
import { Reveal, RevealGroup } from '../../../../../design/Reveal';
import { evidenceForExport, useEvidenceOf } from './evidence';
import { stampOf } from './model';
import { RowDetail, RowStatement, StatusChip, Totals, type BookWorld } from './parts';
import { SpendingChart } from './SpendingChart';
import { totalsLine } from './totalsLine';

export type LedgerScope = 'week' | 'all';

const BUCKET_FILTER: ReadonlyArray<[Bucket, string]> = [
  ['captured', BOOK.filter.paid], ['held', BOOK.filter.held], ['motion', BOOK.filter.motion], ['unconfirmed', BOOK.filter.unconfirmed], ['stopped', BOOK.filter.stopped],
];

/** The scope switch, for the view's head. */
export function ScopeSwitch({ scope, onScope }: { scope: LedgerScope; onScope: (s: LedgerScope) => void }) {
  return <Seg label={BOOK.scope.label} value={scope} onChange={onScope} options={[{ value: 'week', label: BOOK.scope.week }, { value: 'all', label: BOOK.scope.all }]} />;
}

/** Saves rows as a spreadsheet file, here only (nothing is uploaded). */
export function useExport(b: BookWorld) {
  const toast = useToast();
  const client = useDataClient();
  return async (rows: readonly Deal[], query: string, name: string) => {
    // Every row's statement is read before the file is written (rows not yet in view included), so
    // "unknown" in the file means the read failed, never that it had not happened yet.
    const reads = new Map<string, DealEvidence | null>();
    await Promise.all(rows.map(async (d) => { reads.set(d.id, await evidenceForExport(client, d.id)); }));
    const stmt = (d: Deal) => reads.get(d.id)?.reconciliation ?? 'unknown';
    const unread = rows.filter((d) => stmt(d) === 'unknown').length;
    const csv = toCSV([...rows], { stmt, cpName: b.who, checking: b.checking, label: b.label }, query);
    const modes = [...new Set(rows.map((d) => d.mode))].join('+') || 'empty';
    // The clock is read when the file is named, not held in state: a ticking clock would draw the ledger again every second.
    const file = `${name}-${modes}-${new Date(nowUnix() * 1000).toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    // UTF-8 byte-order mark: without it Excel reads the file as ANSI and garbles the middle dot in decided_by.
    a.href = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
    a.download = file;
    document.body.appendChild(a);
    a.click();
    queueMicrotask(() => { URL.revokeObjectURL(a.href); a.remove(); });
    toast(BOOK.saved(file, rows.length, modes) + (unread ? ` ${BOOK.savedUnread(unread)}` : ''), 'ok');
  };
}

/** How a run of proof saves stands: how many were asked for and finished, and what came of them. */
export type ProofExportTally = {
  total: number;
  /** Saves asked for so far (a stopped run asks for no more). */
  started: number;
  done: number;
  written: number;
  /** The person closed the save window: that deal's file was not saved. */
  closed: number;
  /** Deals with no proof file, by the wallet's reason. */
  missing: ReadonlyArray<readonly [why: string, n: number]>;
  stopped: boolean;
  /** Stopped because the person closed two save windows in a row. */
  closedTwice: boolean;
};

/** Saves one proof file per deal through `save` (the wallet's own per-deal export), strictly one at a
 *  time and in list order: each export opens a save window in the shell, so two are never open at once
 *  (the same path runs in the preview). `signal` stops it asking for more; the save already asked for
 *  still finishes (a wallet call cannot be taken back) and is counted. Two save windows closed in a row
 *  read as "stop here". */
export async function exportProofs(ids: readonly string[], save: (dealId: string) => Promise<boolean>,
  opts: { signal?: AbortSignal; onProgress?: (tally: ProofExportTally) => void } = {}): Promise<ProofExportTally> {
  let next = 0;
  let written = 0;
  let closed = 0;
  let closedInARow = 0;
  const missing = new Map<string, number>();
  const tally = (): ProofExportTally => ({
    total: ids.length, started: next, done: next, written, closed, missing: [...missing],
    stopped: (!!opts.signal?.aborted || closedInARow >= 2) && next < ids.length, closedTwice: closedInARow >= 2 && next < ids.length,
  });
  while (next < ids.length && !opts.signal?.aborted && closedInARow < 2) {
    const id = ids[next] as string;
    try {
      if (await save(id)) {
        written += 1;
        closedInARow = 0;
      } else {
        closed += 1;
        closedInARow += 1;
      }
    } catch (e) {
      const why = toWalletError(e).message;
      missing.set(why, (missing.get(why) ?? 0) + 1);
    }
    next += 1;
    opts.onProgress?.(tally());
  }
  return tally();
}

/** One deal's proof file, saved where the person picks (the deal page's "Save signed proof"). */
const saveProof = (dealId: string): Promise<boolean> => backend().invoke('deal_export_proof', { deal_id: dealId });

/** The months the deals fall in (the wallet's UTC calendar), newest first, each with its deals. */
export function monthsOf(rows: readonly Deal[]): Array<{ key: string; label: string; deals: Deal[] }> {
  const by = new Map<string, Deal[]>();
  for (const d of rows) {
    const at = stampOf(d);
    if (at === undefined) continue;
    const key = new Date(at * 1000).toISOString().slice(0, 7);
    const list = by.get(key);
    if (list) list.push(d);
    else by.set(key, [d]);
  }
  return [...by.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, deals]) => ({
    key, deals, label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  }));
}

/** Above this many files the person confirms first: each file is one save window. */
export const CONFIRM_ABOVE = 10;

/** "Save proof files": a signed proof file for each deal in view, or in one month, one save window at a
 *  time, said up front (and confirmed above ten), with its progress, a stop, and an honest count at the
 *  end (saved, not saved, no proof file and why). */
export function ProofExport({ rows, inView, save = saveProof }: { rows: readonly Deal[]; inView: readonly Deal[]; save?: (dealId: string) => Promise<boolean> }) {
  const [which, setWhich] = useState('view');
  const [run, setRun] = useState<{ tally: ProofExportTally; running: boolean; stopping: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const months = useMemo(() => monthsOf(rows), [rows]);
  const picked = which === 'view' ? inView : months.find((m) => m.key === which)?.deals ?? [];
  const running = run?.running === true;
  const start = async () => {
    setConfirming(false);
    const mine = new AbortController();
    abort.current = mine;
    const ids = picked.map((d) => d.id);
    setRun({ tally: { total: ids.length, started: 0, done: 0, written: 0, closed: 0, missing: [], stopped: false, closedTwice: false }, running: true, stopping: false });
    const tally = await exportProofs(ids, save, { signal: mine.signal, onProgress: (t) => { if (abort.current === mine) setRun((r) => ({ tally: t, running: true, stopping: r?.stopping ?? false })); } });
    if (abort.current === mine) setRun({ tally, running: false, stopping: false });
  };
  const stop = () => {
    abort.current?.abort();
    setRun((r) => (r ? { ...r, stopping: true } : r));
  };
  const t = run?.tally;
  return (
    <details className="ui-disclosure bk-went">
      <summary>{BOOK_PROOFS.head}</summary>
      <div className="ui-disclosure-body">
        <p className="ui-hint">{BOOK_PROOFS.intro}</p>
        <p>
          <label className="le-sort">{BOOK_PROOFS.which}{' '}
            <select value={which} disabled={running} onChange={(e) => { setWhich(e.target.value); setConfirming(false); }}>
              <option value="view">{BOOK_PROOFS.inView(inView.length)}</option>
              {months.map((m) => <option key={m.key} value={m.key}>{BOOK_PROOFS.month(m.label, m.deals.length)}</option>)}
            </select>
          </label>{' '}
          {running
            ? <Btn sm onClick={stop} disabled={run?.stopping}>{BOOK_PROOFS.stop}</Btn>
            : <Btn sm disabled={picked.length === 0 || confirming} onClick={() => { if (picked.length > CONFIRM_ABOVE) setConfirming(true); else void start(); }}>{picked.length ? BOOK_PROOFS.save(picked.length) : BOOK_PROOFS.none}</Btn>}
        </p>
        {picked.length && !running ? <p className="ui-hint">{BOOK_PROOFS.windows(picked.length)}</p> : null}
        {confirming && !running ? (
          <p role="alert">
            {BOOK_PROOFS.confirm(picked.length)}{' '}
            <Btn sm kind="primary" onClick={() => void start()}>{BOOK_PROOFS.confirmYes(picked.length)}</Btn>{' '}
            <Btn sm kind="plain" onClick={() => setConfirming(false)}>{BOOK_PROOFS.confirmNo}</Btn>
          </p>
        ) : null}
        {t && running ? (
          <>
            <div className="ui-meter" role="progressbar" aria-label={BOOK_PROOFS.head} aria-valuemin={0} aria-valuemax={t.total} aria-valuenow={t.done}>
              <i style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }} />
            </div>
            <p className="ui-hint" role="status">{run?.stopping ? BOOK_PROOFS.stopping : BOOK_PROOFS.progress(t.done, t.total)}</p>
          </>
        ) : null}
        {t && !running ? (
          <ul className="ui-hint" role="status">
            <li>{BOOK_PROOFS.written(t.written, t.total)}</li>
            {t.closed ? <li>{BOOK_PROOFS.closed(t.closed)}</li> : null}
            {t.missing.map(([why, n]) => <li key={why}>{BOOK_PROOFS.missing(n, why)}</li>)}
            {t.closedTwice ? <li>{BOOK_PROOFS.closedTwice}</li> : null}
            {t.stopped ? <li>{BOOK_PROOFS.stopped(t.total - t.started)}</li> : null}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

/** The ledger row's columns: when, what, status, PayPal statement, amount, then the counterparty as the
 *  note (hidden on a narrow window: it lives in the detail pane and the row's title). */
const LEDGER_COLS = { '--cols': '5.5rem minmax(9rem, 1.6fr) minmax(9rem, max-content) minmax(10rem, max-content) 8rem minmax(0, 1fr)' } as CSSProperties;

/** A ledger row, on one line. `statement` false leaves the PayPal statement cell empty, so drawing the row reads
 *  nothing (the summary's Latest strip; the statement is one click away in the ledger). */
export function LedgerRow({ deal, b, statement = true }: { deal: Deal; b: BookWorld; statement?: boolean }) {
  const need = b.needOf.get(deal.id);
  const at = stampOf(deal);
  return (
    <span className="row1 bk-row" style={LEDGER_COLS} title={`${b.title(deal)} · ${b.who(deal)}`}>
      <span className="bk-when">{at ? clockLabel(at) : BOOK.dash}</span>
      <b className="bk-t" title={b.title(deal)}>{b.title(deal)}</b>
      <span className="bk-st"><StatusChip deal={deal} check={need?.money_check} />{deal.mode !== 'sandbox' ? <ModeBadge mode={deal.mode} /> : null}</span>
      <span className="bk-stm">{statement ? <RowStatement deal={deal} /> : null}</span>
      <span className="bk-amt"><Amount money={dealTotal(deal)} tone={amountTone(deal)} />{dirOf(deal) === 'in' ? <span className="bk-in">{BOOK.in}</span> : null}</span>
      <span className="bk-who c-note" title={b.who(deal)}>{b.who(deal)}</span>
    </span>
  );
}

/** The ledger as grid columns: the same cells as the row, each one sortable and filterable. */
function ledgerColumns(b: BookWorld): GridColumn<Deal>[] {
  return [
    { id: 'when', header: BOOK.col.when, width: 104, sort: 'desc', filter: false, className: 'sg-dim', value: (d) => stampOf(d) ?? null, cell: (d) => { const at = stampOf(d); return at ? clockLabel(at) : BOOK.dash; } },
    { id: 'what', header: BOOK.col.what, flex: 2, minWidth: 160, className: 'sg-strong', value: (d) => b.title(d) },
    { id: 'status', header: BOOK.col.status, width: 215, group: true,
      // A payment being checked sorts, filters and groups as it reads: "Checking with PayPal", never as paid.
      value: (d) => { const check = b.needOf.get(d.id)?.money_check; return check ? moneyCheckPill(check, isTerminal(d)).text : stateWord(d.state, { side: d.side, kind: d.kind }).text; },
      cell: (d) => <><StatusChip deal={d} check={b.needOf.get(d.id)?.money_check} />{d.mode !== 'sandbox' ? <ModeBadge mode={d.mode} /> : null}</> },
    { id: 'statement', header: BOOK.col.statement, width: 135, sortable: false, filter: false, value: () => null, cell: (d) => <RowStatement deal={d} /> },
    { id: 'amount', header: BOOK.col.amount, width: 130, end: true, aggregate: true, filter: 'number', value: (d) => dealTotal(d).minor, filterValue: (d) => dealTotal(d).minor / 100,
      cell: (d) => <><Amount money={dealTotal(d)} tone={amountTone(d)} />{dirOf(d) === 'in' ? <span className="bk-in">{BOOK.in}</span> : null}</> },
    { id: 'who', header: BOOK.col.who, flex: 1, minWidth: 130, className: 'sg-who', group: true, value: (d) => b.who(d) },
  ];
}

const FILL = { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 } as const;

/** The ledger: totals and the list. `initialSort` lets "Recent payments" open it newest first. */
export function Ledger({ b, scope }: { b: BookWorld; scope: LedgerScope }) {
  const nav = useLayerNav();
  const rows = scope === 'week' ? b.weekDeals : b.all;
  const checking = b.checking;
  const filters = useMemo<readonly ListFilter<Deal>[]>(() => [
    ...BUCKET_FILTER.map(([k, label]) => ({ value: k, label, test: (d: Deal) => !checking(d) && bucketOf(d) === k })),
    { value: 'checking', label: BOOK.filter.checking, test: checking, title: BOOK.filter.checkingTitle },
  ], [checking]);
  // "PayPal agrees" reads the statements of the week's deals that reached a PayPal capture, nothing
  // else (bounded): only those can have a place on the statement. That includes a seller's word PayPal
  // later matched and an ending PayPal never confirmed, which are not in the paid bucket.
  const paidIds = useMemo(() => b.weekDeals.filter((d) => !!d.paypal.capture).map((d) => d.id), [b.weekDeals]);
  const [agreeOpen, setAgreeOpen] = useState(false);
  const columns = useMemo(() => ledgerColumns(b), [b]);
  const totals = useCallback((ds: readonly Deal[]) => totalsLine(ds, checking), [checking]);
  // What the grid shows after every filter (the chips, the search, the column filters): the chart follows it.
  const [filtered, setFiltered] = useState<readonly Deal[] | null>(null);
  const shownByGrid = filtered ?? rows;
  return (
    <RevealGroup className="bk-ledger">
      <Reveal><Totals deals={rows} checking={checking} /></Reveal>
      {/* Read only once opened: the statement reads of the week's paid deals wait for the owner. */}
      <Reveal><details className="ui-disclosure bk-went" onToggle={(e) => setAgreeOpen(e.currentTarget.open)}>
        <summary>{BOOK.went}</summary>
        <div className="ui-disclosure-body">{agreeOpen ? <Went b={b} ids={paidIds} /> : null}</div>
      </details></Reveal>
      <Reveal><ProofExport rows={rows} inView={shownByGrid} /></Reveal>
      <Reveal><SpendingChart rows={shownByGrid} checking={checking} /></Reveal>
      <Reveal style={FILL}><ListEngine<Deal> className={fewRows(rows.length)} label={scope === 'week' ? BOOK.list.week : BOOK.list.all} rows={rows} getKey={(d) => d.id}
        searchText={(d) => `${b.title(d)} ${b.who(d)} ${b.label(d)} ${stateWord(d.state, { side: d.side, kind: d.kind }).text} ${formatMinor(dealTotal(d).minor, dealTotal(d).currency)}`}
        filters={filters} filterLabel={BOOK.filter.label} columns={columns} totals={totals} onFilteredRows={setFiltered} estimateSize={36} wideAt={1200}
        renderRow={(d) => <LedgerRow deal={d} b={b} />}
        rowLabel={(d) => `${b.title(d)}, ${b.who(d)}`}
        onOpen={(d) => nav.deal(d.id)}
        detail={(d) => <RowDetail deal={d} need={b.needOf.get(d.id)} who={b.who(d)} title={b.title(d)} onOpen={() => nav.deal(d.id)} />}
        empty={scope === 'week' ? BOOK.list.emptyWeek : BOOK.list.empty} noMatch={BOOK.list.noMatch} /></Reveal>
    </RevealGroup>
  );
}

/** Where the money went and "PayPal agrees": the statements of the week's captured deals (bounded
 *  reads). A deal that never reached a capture has no place on the statement ("no payment"), never
 *  "couldn't be checked"; a captured one whose read failed stays unknown. */
function Went({ b, ids }: { b: BookWorld; ids: readonly string[] }) {
  const ev = useEvidenceOf(ids);
  const read = useMemo(() => new Set(ids), [ids]);
  const facts = useQuery('owner_facts', null, { refreshOn: ['deal:changed', 'receipt:created'] });
  const poll = facts.data?.last_reporting_poll ?? null;
  const nav = useLayerNav();
  return (
    <MoneyWent deals={b.weekDeals} stmt={(d) => (!read.has(d.id) ? 'not_applicable' : ev.map.get(d.id)?.reconciliation ?? (ev.loading ? null : 'unknown'))}
      checkedAt={poll && poll.status === 200 ? clockLabel(poll.at) : null} titleOf={b.title} onOpen={(id) => nav.deal(id)} />
  );
}

/** The ledger view's actions: the scope, the proof check and the spreadsheet. */
export function LedgerActions({ b, scope, onScope, onProof }: { b: BookWorld; scope: LedgerScope; onScope: (s: LedgerScope) => void; onProof: () => void }) {
  const save = useExport(b);
  return (
    <>
      <ScopeSwitch scope={scope} onScope={onScope} />
      <Btn sm onClick={onProof} title={BOOK.proofTitle}>{BOOK.proofOpen}</Btn>
      <Btn sm onClick={() => save(scope === 'week' ? b.weekDeals : b.all, '', 'book-ledger')} title={BOOK.csvTitle}>{BOOK.csv}</Btn>
    </>
  );
}
