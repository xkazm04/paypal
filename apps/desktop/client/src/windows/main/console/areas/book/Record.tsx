// The Book's record (rebuild WP3b, scale finding #16): the hash-chained audit log, newest first, in
// one windowed list. Older steps are read 200 at a time (audit_page) as the list scrolls near its
// end, or on "Read older steps"; "Go to a day" reads on, page by page, until that day is on record
// and shows the list from there, so the oldest step is a few moves away, never a hundred clicks.
// Only the steps in view are in the page. The chain is checked in the wallet before every page: a
// failed check shows no steps, says what that means and lets the owner check again. Read-only.
import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import type { AuditRow } from '@bindings/AuditRow';
import type { Deal } from '@bindings/Deal';
import { clockLabel } from '../../../../../lib/format';
import { useMutation } from '../../../../../lib/hooks';
import { AUDIT_BROKEN, BOOK, stateWord } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Field, Loading } from '../../../../../shared/ui';
import { decidedBy } from '../../../logic';
import { useLayerNav } from '../../layers';
import { fewRows, ListEngine, type ListFilter } from '../../ListEngine';
import { type BookWorld } from './parts';

/** Steps read per page (audit_page takes 1 to 200). */
export const RECORD_PAGE = 200;
/** How close to the end of the list (px) a scroll reads the next page. */
const NEAR_END_PX = 600;
/** "Go to a day" reads at most this many pages in one go (5,000 steps at 200 a page is 25). */
const MAX_JUMP_PAGES = 60;

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

const FILTERS: readonly ListFilter<AuditRow>[] = [
  { value: 'money', label: BOOK.record.filter.money, test: (r) => r.to !== null },
  { value: 'decided', label: BOOK.record.filter.decided, test: (r) => r.decided_by !== null },
  { value: 'you', label: BOOK.record.filter.you, test: (r) => r.actor.startsWith('owner') },
];

/** A step's status change in the owner's words, worded as the deal's own status chip words it. */
export function stepChange(r: Pick<AuditRow, 'from' | 'to'>, deal: Pick<Deal, 'side' | 'kind'> | undefined): string | null {
  const ctx = { side: deal?.side, kind: deal?.kind };
  return r.to ? `${r.from ? `${stateWord(r.from, ctx).text} → ` : ''}${stateWord(r.to, ctx).text}` : null;
}

function StepRow({ r, deal, title }: { r: AuditRow; deal: Deal | undefined; title: string | null }) {
  const change = stepChange(r, deal);
  const by = r.decided_by ? decidedBy({ decided_by: r.decided_by }).text : null;
  return (
    <span className="bk-step">
      <span className="bk-when">{clockLabel(r.at)}</span>
      <span className="bk-what">
        <b>{actionWord(r.action)}</b>
        <span className="bk-sub">{actorWord(r.actor)}{title ? <> · <span className="bk-who" title={title}>{title}</span></> : null}</span>
      </span>
      <span className="bk-change">{by ? <span>{by}</span> : null}{by && change ? ' · ' : null}{change ?? (by ? null : <span className="bk-dim">{BOOK.dash}</span>)}</span>
    </span>
  );
}

type Page = { next: number | null; oldest: number | null };

export function Record({ b }: { b: BookWorld }) {
  const nav = useLayerNav();
  const read = useMutation('audit_page');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const [day, setDay] = useState('');
  const [jumping, setJumping] = useState(false);
  const busy = useRef(false);
  const byId = useMemo(() => new Map(b.all.map((d) => [d.id, d] as const)), [b.all]);

  /** Reads the page before `before`: how far it got, or undefined when it did not read. */
  const page = useCallback(async (before: number | null): Promise<Page | undefined> => {
    if (busy.current) return undefined;
    busy.current = true;
    try {
      const r = await read.run({ before, limit: RECORD_PAGE });
      if (!r) return undefined;
      // A page read twice must not list a step twice.
      setRows((x) => { const seen = new Set(x.map((o) => o.seq)); return [...x, ...r.rows.filter((n) => !seen.has(n.seq))]; });
      setNext(r.next_before);
      return { next: r.next_before, oldest: r.rows.at(-1)?.at ?? null };
    } finally {
      busy.current = false;
    }
  }, [read]);
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => { void pageRef.current(null); }, []);

  const broken = read.error?.code === 'LEDGER_TRUST';
  const again = () => { setRows([]); setNext(undefined); read.reset(); void page(null); };
  const older = () => { if (next) void page(next); };
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    if (!el.classList.contains('le-scroll') || !next) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_END_PX) older();
  };

  // "Go to a day": read older pages until a step of that day, or an older one, is on record.
  const goDay = async (key: string) => {
    setDay(key);
    const start = dayStartOf(key);
    if (start === null) return;
    let before = next ?? null;
    let oldest = rows.at(-1)?.at ?? null;
    setJumping(true);
    try {
      for (let i = 0; before !== null && (oldest === null || oldest >= start) && i < MAX_JUMP_PAGES; i++) {
        const got = await page(before);
        if (!got) break;
        before = got.next;
        oldest = got.oldest ?? oldest;
      }
    } finally {
      setJumping(false);
    }
  };
  const end = dayStartOf(day);
  const shown = useMemo(() => (end === null ? rows : rows.filter((r) => r.at < end + 86_400)), [rows, end]);
  const titleOf = (r: AuditRow) => { const d = r.deal_id ? byId.get(r.deal_id) : undefined; return d ? b.title(d) : null; };

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
    <div className="bk-record" onScrollCapture={onScroll}>
      {read.error ? <WalletNotice error={read.error} what={BOOK.record.what} /> : null}
      <div className="bk-rtools">
        <label className="bk-jump">
          <span>{BOOK.record.goDay}</span>
          <Field type="date" value={day} aria-label={BOOK.record.goDay} onChange={(e) => void goDay(e.currentTarget.value)} />
        </label>
        {day ? <Btn sm kind="plain" onClick={() => setDay('')}>{BOOK.record.newest}</Btn> : null}
        <span className="ui-spacer" />
        <span className="bk-dim" role="status">{jumping ? BOOK.record.reading : next === undefined ? null : next ? BOOK.record.readSoFar(rows.length) : BOOK.record.readAll(rows.length)}</span>
        {next ? <Btn sm disabled={read.pending} onClick={older}>{read.pending ? BOOK.record.reading : BOOK.record.older}</Btn> : null}
      </div>
      {/* Before the first page is read the list says nothing: a failed read is the notice above,
          never "nothing on record". */}
      {next === undefined ? (read.error ? null : <Loading what={BOOK.record.loading} />) : (
        <ListEngine<AuditRow> className={fewRows(shown.length)} label={BOOK.record.label} rows={shown} getKey={(r) => String(r.seq)} filters={FILTERS} filterLabel={BOOK.record.filter.label} estimateSize={52} toolbarMin={0}
          searchText={(r) => `${actionWord(r.action)} ${actorWord(r.actor)} ${titleOf(r) ?? ''}`}
          renderRow={(r) => <StepRow r={r} deal={r.deal_id ? byId.get(r.deal_id) : undefined} title={titleOf(r)} />}
          rowLabel={(r) => `${actionWord(r.action)}, ${clockLabel(r.at)}`}
          onOpen={(r) => { if (r.deal_id) nav.deal(r.deal_id); }}
          empty={BOOK.record.empty} />
      )}
      <p className="ui-hint">{BOOK.record.hint}</p>
    </div>
  );
}
