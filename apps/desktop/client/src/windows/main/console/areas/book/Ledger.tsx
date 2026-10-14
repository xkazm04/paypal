// The Book's ledger view (rebuild WP3b): the totals, kept apart, then every deal of the week (or,
// one switch away, everything on record) in one windowed, searchable list. A row shows when, what,
// with whom, its status, its amount and whether PayPal's own statement shows it; that statement is
// read only for the rows in view (scale finding #17). On a wide window the picked row's PayPal proof
// sits beside the list; otherwise a row opens its deal. Where the money went and "PayPal agrees" are
// one disclosure down. Read-only: nothing here can move money.
import { useMemo, useState } from 'react';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import { dealKey } from '../../../../../lib/data/keys';
import { useDataClient } from '../../../../../lib/data/provider';
import { clockLabel } from '../../../../../lib/format';
import { useNow, useQuery } from '../../../../../lib/hooks';
import { BOOK, stateWord } from '../../../../../lib/words';
import { ModeBadge } from '../../../../../shared/honesty';
import { Btn, Seg, useToast } from '../../../../../shared/ui';
import { amountTone, dealTotal } from '../../../logic';
import { MoneyWent } from '../../../modules/book/MoneyWent';
import { bucketOf, dirOf, toCSV, type Bucket } from '../../../modules/book/model';
import { useLayerNav } from '../../layers';
import { ListEngine, type ListFilter, type ListSort } from '../../ListEngine';
import { Amount } from '../../rows';
import { useEvidenceOf } from './evidence';
import { stampOf } from './model';
import { fewRows, RowDetail, RowStatement, StatusChip, Totals, type BookWorld } from './parts';

export type LedgerScope = 'week' | 'all';

const BUCKET_FILTER: ReadonlyArray<[Bucket, string]> = [
  ['captured', BOOK.filter.paid], ['held', BOOK.filter.held], ['motion', BOOK.filter.motion], ['unconfirmed', BOOK.filter.unconfirmed], ['stopped', BOOK.filter.stopped],
];

const SORTS: readonly ListSort<Deal>[] = [
  { value: 'newest', label: BOOK.sort.newest, compare: (a, b) => (stampOf(b) ?? 0) - (stampOf(a) ?? 0) },
  { value: 'oldest', label: BOOK.sort.oldest, compare: (a, b) => (stampOf(a) ?? 0) - (stampOf(b) ?? 0) },
  { value: 'largest', label: BOOK.sort.largest, compare: (a, b) => dealTotal(b).minor - dealTotal(a).minor },
];

/** The scope switch, for the view's head. */
export function ScopeSwitch({ scope, onScope }: { scope: LedgerScope; onScope: (s: LedgerScope) => void }) {
  return <Seg label={BOOK.scope.label} value={scope} onChange={onScope} options={[{ value: 'week', label: BOOK.scope.week }, { value: 'all', label: BOOK.scope.all }]} />;
}

/** Saves rows as a spreadsheet file, here only (nothing is uploaded). */
export function useExport(b: BookWorld) {
  const toast = useToast();
  const now = useNow();
  const client = useDataClient();
  return (rows: readonly Deal[], query: string, name: string) => {
    // A statement already read (a row that was in view, the deal page) is exported as read; one
    // never read is "unknown", never guessed.
    const stmt = (d: Deal) => client.getQueryData<DealEvidence>(dealKey('deal_evidence', d.id))?.reconciliation ?? 'unknown';
    const csv = toCSV([...rows], { stmt, cpName: b.who, checking: b.checking, label: b.label }, query);
    const modes = [...new Set(rows.map((d) => d.mode))].join('+') || 'empty';
    const file = `${name}-${modes}-${new Date(now * 1000).toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = file;
    document.body.appendChild(a);
    a.click();
    queueMicrotask(() => { URL.revokeObjectURL(a.href); a.remove(); });
    toast(BOOK.saved(file, rows.length, modes), 'ok');
  };
}

function LedgerRow({ deal, b }: { deal: Deal; b: BookWorld }) {
  const need = b.needOf.get(deal.id);
  const at = stampOf(deal);
  return (
    <span className="bk-row">
      <span className="bk-when">{at ? clockLabel(at) : BOOK.dash}</span>
      <span className="bk-what">
        <b title={b.title(deal)}>{b.title(deal)}</b>
        <span className="bk-sub"><span className="bk-who" title={b.who(deal)}>{b.who(deal)}</span>{deal.mode !== 'sandbox' ? <> <ModeBadge mode={deal.mode} /></> : null}</span>
      </span>
      <span className="bk-st"><StatusChip deal={deal} check={need?.money_check} /></span>
      <span className="bk-stm"><RowStatement deal={deal} /></span>
      <span className="bk-amt"><Amount money={dealTotal(deal)} tone={amountTone(deal)} />{dirOf(deal) === 'in' ? <span className="bk-in">{BOOK.in}</span> : null}</span>
    </span>
  );
}

/** The ledger: totals and the list. `initialSort` lets "Recent payments" open it newest first. */
export function Ledger({ b, scope }: { b: BookWorld; scope: LedgerScope }) {
  const nav = useLayerNav();
  const rows = scope === 'week' ? b.weekDeals : b.all;
  const checking = b.checking;
  const filters = useMemo<readonly ListFilter<Deal>[]>(() => [
    ...BUCKET_FILTER.map(([k, label]) => ({ value: k, label, test: (d: Deal) => !checking(d) && bucketOf(d) === k })),
    { value: 'checking', label: BOOK.filter.checking, test: checking, title: BOOK.filter.checkingTitle },
  ], [checking]);
  // "PayPal agrees" reads the week's paid and held deals' statements, nothing else (bounded).
  const paidIds = useMemo(() => b.weekDeals.filter((d) => bucketOf(d) === 'captured').map((d) => d.id), [b.weekDeals]);
  const [agreeOpen, setAgreeOpen] = useState(false);
  return (
    <div className="bk-ledger">
      <Totals deals={rows} checking={checking} />
      {/* Read only once opened: the statement reads of the week's paid deals wait for the owner. */}
      <details className="ui-disclosure bk-went" onToggle={(e) => setAgreeOpen(e.currentTarget.open)}>
        <summary>{BOOK.went}</summary>
        <div className="ui-disclosure-body">{agreeOpen ? <Went b={b} ids={paidIds} /> : null}</div>
      </details>
      <ListEngine<Deal> className={fewRows(rows.length)} label={scope === 'week' ? BOOK.list.week : BOOK.list.all} rows={rows} getKey={(d) => d.id}
        searchText={(d) => `${b.title(d)} ${b.who(d)} ${b.label(d)} ${stateWord(d.state, { side: d.side, kind: d.kind }).text}`}
        filters={filters} filterLabel={BOOK.filter.label} sorts={SORTS} estimateSize={56} wideAt={1200}
        renderRow={(d) => <LedgerRow deal={d} b={b} />}
        rowLabel={(d) => `${b.title(d)}, ${b.who(d)}`}
        onOpen={(d) => nav.deal(d.id)}
        detail={(d) => <RowDetail deal={d} need={b.needOf.get(d.id)} who={b.who(d)} title={b.title(d)} onOpen={() => nav.deal(d.id)} />}
        empty={scope === 'week' ? BOOK.list.emptyWeek : BOOK.list.empty} noMatch={BOOK.list.noMatch} />
    </div>
  );
}

/** Where the money went and "PayPal agrees": the week's paid deals' statements (bounded reads). */
function Went({ b, ids }: { b: BookWorld; ids: readonly string[] }) {
  const ev = useEvidenceOf(ids);
  const facts = useQuery('owner_facts', null, { refreshOn: ['deal:changed', 'receipt:created'] });
  const poll = facts.data?.last_reporting_poll ?? null;
  const nav = useLayerNav();
  return (
    <MoneyWent deals={b.weekDeals} stmt={(d) => ev.map.get(d.id)?.reconciliation ?? (ev.loading ? null : 'unknown')}
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
