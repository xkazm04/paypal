// The Book's record (rebuild WP3b, scale finding #16): the hash-chained audit log in the grid's infinite
// row model over audit_page, so its filter and its sort are executed by the database over the whole
// chain, never over the pages loaded so far (standard: table/client-server-split). Steps are read 200
// at a time as the grid asks for them; "Go to a day" reads on, page by page, until that day is on record
// and scrolls the list there. The chain is checked in the wallet before every page: a failed check
// shows no steps, says what that means and lets the owner check again. Read-only.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AuditRow } from '@bindings/AuditRow';
import type { AuditSort } from '@bindings/AuditSort';
import type { Deal } from '@bindings/Deal';
import { clockLabel } from '../../../../../lib/format';
import { useMutation } from '../../../../../lib/hooks';
import { AUDIT_BROKEN, BOOK, stateWord } from '../../../../../lib/words';
import { DataGrid, type DataGridHandle, type GridColumn, type GridSource } from '../../../../../shared/DataGrid';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Field, Loading } from '../../../../../shared/ui';
import { decidedBy } from '../../../logic';
import { ALL_STATES } from '../../../modules/book/model';
import { useLayerNav } from '../../layers';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '../../ListEngine';
import { type BookWorld } from './parts';
import { Reveal, RevealGroup } from '../../../../../design/Reveal';

/** Steps read per page (audit_page takes 1 to 200). */
export const RECORD_PAGE = 200;
/** "Go to a day" reads at most this many pages in one go (80,000 steps at 200 a page). */
const MAX_JUMP_PAGES = 400;

/** Who took a step, in the owner's words (the actor's kind; never its key). */
export function actorWord(actor: string): string {
  const head = actor.split(':')[0] ?? '';
  return Object.hasOwn(BOOK.record.actor, head) ? BOOK.record.actor[head as keyof typeof BOOK.record.actor] : BOOK.record.actorOther;
}
/** What a step was, in the owner's words; an action the words do not know is said generally. */
export function actionWord(action: string): string {
  if (Object.hasOwn(BOOK.record.action, action)) return BOOK.record.action[action as keyof typeof BOOK.record.action];
  if (action.startsWith('money.')) return BOOK.record.paypalStep;
  if (action.startsWith('deal.')) return BOOK.record.dealStep;
  return BOOK.record.actionOther;
}

/** Local midnight of a `YYYY-MM-DD` day, in Unix seconds; null for anything else. */
export function dayStartOf(key: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const t = new Date(`${key}T00:00:00`).getTime();
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** A step's status change in the owner's words, worded as the deal's own status chip words it. */
export function stepChange(r: Pick<AuditRow, 'from' | 'to'>, deal: Pick<Deal, 'side' | 'kind'> | undefined): string | null {
  const ctx = { side: deal?.side, kind: deal?.kind };
  return r.to ? `${r.from ? `${stateWord(r.from, ctx).text} → ` : ''}${stateWord(r.to, ctx).text}` : null;
}

// ---- what the search box means --------------------------------------------------------------------

type Stored = readonly [owner: string, stored: string];
const OWNER_WORDS: readonly Stored[] = [
  ...ALL_STATES.map((s): Stored => [stateWord(s).text.toLowerCase(), s]),
  ...Object.entries(BOOK.record.action).map(([k, v]): Stored => [v.toLowerCase(), k]),
  ...Object.entries(BOOK.record.actor).map(([k, v]): Stored => [v.toLowerCase(), k]),
];

/** One stored name for a set of them, or null when they share none: the server filter is one substring. */
function oneStored(names: readonly string[]): string | null {
  return names.find((n) => names.every((o) => o.includes(n))) ?? null;
}

/** The stored name to search for what the owner typed: the database holds "CAPTURED" and the screen says "Paid". An
 *  exact owner word, or a prefix of exactly one, is that stored name; anything else is searched as typed. */
export function recordSearchTerm(typed: string): string {
  const t = typed.trim();
  const low = t.toLowerCase();
  if (!low) return '';
  const exact = OWNER_WORDS.filter(([w]) => w === low).map(([, s]) => s);
  const hit = oneStored(exact);
  if (hit) return hit;
  if (exact.length) return t;
  const prefix = oneStored([...new Set(OWNER_WORDS.filter(([w]) => w.startsWith(low)).map(([, s]) => s))]);
  return prefix ?? t;
}

const stepBy = (r: AuditRow): string | null => (r.decided_by ? decidedBy({ decided_by: r.decided_by }).text : null);

/** Who decided a step and the status it moved the deal to; a dash when it did neither. */
function StepChange({ r, deal }: { r: AuditRow; deal: Deal | undefined }) {
  const change = stepChange(r, deal);
  const by = stepBy(r);
  return <span className="bk-change">{by ? <span>{by}</span> : null}{by && change ? ' · ' : null}{change ?? (by ? null : <span className="bk-dim">{BOOK.dash}</span>)}</span>;
}

/** The record as grid columns. Only the time sorts, and nothing filters per column: the server's one
 *  filter and one sort are the only ones the whole chain can answer. */
function stepColumns(dealOf: (r: AuditRow) => Deal | undefined, titleOf: (r: AuditRow) => string | null): GridColumn<AuditRow>[] {
  return [
    { id: 'when', header: BOOK.record.col.when, width: 104, filter: false, sort: 'desc', className: 'sg-dim', value: (r) => r.at, cell: (r) => clockLabel(r.at) },
    { id: 'what', header: BOOK.record.col.what, flex: 1, minWidth: 160, filter: false, sortable: false, className: 'sg-strong', value: (r) => actionWord(r.action) },
    { id: 'change', header: BOOK.record.col.change, flex: 1.2, minWidth: 180, filter: false, sortable: false, value: (r) => [stepBy(r), stepChange(r, dealOf(r))].filter(Boolean).join(' · ') || null, cell: (r) => <StepChange r={r} deal={dealOf(r)} /> },
    { id: 'who', header: BOOK.record.col.who, flex: 1, minWidth: 160, filter: false, sortable: false, value: (r) => `${actorWord(r.actor)} ${titleOf(r) ?? ''}`.trim(),
      cell: (r) => { const title = titleOf(r); return <span className="bk-sub">{actorWord(r.actor)}{title ? <> · <span className="bk-who">{title}</span></> : null}</span>; } },
  ];
}

/** The steps read so far for one filter and one order. */
type Trail = { filter: string; sort: AuditSort; rows: AuditRow[]; next: number | null | undefined; total: number | null };
const newTrail = (filter: string, sort: AuditSort): Trail => ({ filter, sort, rows: [], next: undefined, total: null });

const FILL = { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0, minWidth: 0 } as const;

export function Record({ b }: { b: BookWorld }) {
  const nav = useLayerNav();
  const read = useMutation('audit_page');
  const readRef = useRef(read);
  readRef.current = read;
  const [typed, setTyped] = useState('');
  const filter = recordSearchTerm(useDebounced(typed, SEARCH_DEBOUNCE_MS));
  const [day, setDay] = useState('');
  const [jumping, setJumping] = useState(false);
  const [short, setShort] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const trail = useRef<Trail>(newTrail('', 'newest'));
  const gridRef = useRef<DataGridHandle>(null);
  const byId = useMemo(() => new Map(b.all.map((d) => [d.id, d] as const)), [b.all]);

  const out = useRef<Promise<boolean> | null>(null);
  /** Reads the next page of `t`; false when it could not be read. A page already out (a scroll
   *  started it) is waited for, never doubled or skipped: a jump must not stop on it. */
  const readNext = useCallback((t: Trail): Promise<boolean> => {
    if (out.current) return out.current;
    const mine = (async (): Promise<boolean> => {
      try {
        const r = await readRef.current.run({ before: t.next ?? null, limit: RECORD_PAGE, filter: t.filter || null, sort: t.sort });
        if (!r) return false;
        const seen = new Set(t.rows.map((o) => o.seq));
        t.rows.push(...r.rows.filter((n) => !seen.has(n.seq)));
        t.next = r.next_before;
        t.total = r.total_matching;
        if (t === trail.current) setTotal(r.total_matching);
        return true;
      } finally {
        out.current = null;
      }
    })();
    out.current = mine;
    return mine;
  }, []);

  useEffect(() => { void readNext(trail.current); }, [readNext]);

  // A new filter or order is a new read from the start: nothing already read is reused or filtered here.
  const source = useMemo<GridSource<AuditRow>>(() => ({
    getRows: async (start, end, sort) => {
      const wire: AuditSort = sort === 'asc' ? 'oldest' : 'newest';
      if (trail.current.sort !== wire || trail.current.filter !== filter) trail.current = newTrail(filter, wire);
      const t = trail.current;
      while (t.rows.length < end && t.next !== null) {
        if (!(await readNext(t))) throw new Error('audit_page');
      }
      return { rows: t.rows.slice(start, end), total: t.total ?? t.rows.length };
    },
  }), [filter, readNext]);

  const broken = read.error?.code === 'LEDGER_TRUST';
  const again = () => { trail.current = newTrail(filter, trail.current.sort); setTotal(null); read.reset(); void readNext(trail.current); };

  // "Go to a day": read on until a step of that day, or one past it, is on record, then scroll to it.
  const goDay = async (key: string) => {
    setDay(key);
    const start = dayStartOf(key);
    if (start === null) return;
    const t = trail.current;
    const newest = t.sort === 'newest';
    const past = () => { const last = t.rows.at(-1)?.at; return last !== undefined && (newest ? last < start : last >= start); };
    setJumping(true);
    setShort(false);
    try {
      for (let i = 0; !past() && t.next !== null && i < MAX_JUMP_PAGES; i++) {
        if (!(await readNext(t))) break;
      }
      // Stopped before the day, with more steps unread: say so, never show a list that only looks empty.
      if (!past() && t.next !== null) setShort(true);
      const end = start + 86_400;
      const at = t.rows.findIndex((r) => (newest ? r.at < end : r.at >= start));
      gridRef.current?.showIndex(at < 0 ? Math.max(t.rows.length - 1, 0) : at);
    } finally {
      setJumping(false);
    }
  };
  const title = b.title;
  const dealOf = useCallback((r: AuditRow) => (r.deal_id ? byId.get(r.deal_id) : undefined), [byId]);
  const titleOf = useCallback((r: AuditRow) => { const d = dealOf(r); return d ? title(d) : null; }, [dealOf, title]);
  const columns = useMemo(() => stepColumns(dealOf, titleOf), [dealOf, titleOf]);
  const open = useCallback((r: AuditRow) => { if (r.deal_id) nav.deal(r.deal_id); }, [nav]);
  const rowLabel = useCallback((r: AuditRow) => `${actionWord(r.action)}, ${clockLabel(r.at)}`, []);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && typed && !e.defaultPrevented) { e.preventDefault(); setTyped(''); } };

  if (broken) {
    return (
      <div className="bk-broken" role="alert">
        <p className="bk-broken-t">{AUDIT_BROKEN.title}</p>
        <p>{AUDIT_BROKEN.means}</p>
        <h2>{BOOK.record.todo}</h2>
        <ol>{AUDIT_BROKEN.todo.map((t) => <li key={t}>{t}</li>)}</ol>
        <div className="cs-acts"><Btn disabled={read.pending} onClick={again}>{read.pending ? BOOK.record.checking : BOOK.record.again}</Btn></div>
      </div>
    );
  }
  return (
    <RevealGroup className="bk-record" onKeyDown={onKey}>
      {read.error ? <WalletNotice error={read.error} what={BOOK.record.what} /> : null}
      <Reveal className="bk-rtools">
        <span className="le-search bk-rsearch">
          <Field search type="search" value={typed} maxLength={200} placeholder={BOOK.record.searchPlaceholder} aria-label={BOOK.record.search} onChange={(e) => setTyped(e.currentTarget.value)} />
        </span>
        <label className="bk-jump">
          <span>{BOOK.record.goDay}</span>
          <Field type="date" value={day} aria-label={BOOK.record.goDay} onChange={(e) => void goDay(e.currentTarget.value)} />
        </label>
        {day ? <Btn sm kind="plain" onClick={() => { setDay(''); setShort(false); gridRef.current?.showIndex(0); }}>{BOOK.record.newest}</Btn> : null}
        <span className="ui-spacer" />
        <span className="bk-dim" role="status">{jumping ? BOOK.record.reading : short && day ? BOOK.record.dayShort : total === null ? null : filter ? BOOK.record.matchingOf(total) : BOOK.record.matching(total)}</span>
      </Reveal>
      {/* Before the first page is read the list says nothing: a failed read is the notice above,
          never "nothing on record". */}
      {total === null ? (read.error ? null : <Loading what={BOOK.record.loading} />) : (
        <Reveal style={FILL}><div className="le-col">
          <DataGrid<AuditRow> label={BOOK.record.label} source={source} blockSize={RECORD_PAGE} handle={gridRef} getKey={(r) => String(r.seq)} columns={columns}
            rowLabel={rowLabel} onActivate={open} onEnter={open}
            noMatch={filter ? BOOK.record.noMatch : BOOK.record.empty} />
        </div></Reveal>
      )}
      <Reveal><p className="ui-hint">{BOOK.record.hint}</p></Reveal>
    </RevealGroup>
  );
}
