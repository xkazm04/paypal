// Book (payments ops cockpit) module page - the "Ledger Lens" (prototype/pages/book/variant-1).
// Owner: the book agent. Styles: ./book.css, scoped under .mod-book. Pure logic: ./book/model.ts.
//
// Simple (default): the answer ("where is my money this week?"), four plain totals (paid out, paid in,
// on hold, stopped; each currency on its own line, never added together), what needs attention, the
// Ask box with its quick views, and the recent payments as one simple row each (when, who, what,
// amount, status, PayPal statement). Detailed: the week's ledger grid whose four money columns carry
// their own totals, with the statement filter, audit trail and CSV export. A lens (a fixed BookQuery)
// is drafted, read, then run read-only over the same rows and dims the rows it did not return in the
// grid. Typed questions need the assistant's book_query tool, which this shell does not register:
// they get an honest UNAVAILABLE. Book only reads.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Deal } from '@bindings/Deal';
import type { AuditRow } from '@bindings/AuditRow';
import type { BookAnswer } from '@bindings/BookAnswer';
import type { Currency } from '@bindings/Currency';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { Money } from '@bindings/Money';
import { WalletError } from '../../../lib/contract';
import { clockLabel, formatMinor, shortId } from '../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../lib/hooks';
import { marketWords, modeWord, receiptWord, stateWord, timeLeftWords } from '../../../lib/words';
import { Glyph } from '../../../shared/modules';
import { Countdown, ModeBadge, WalletNotice } from '../../../shared/honesty';
import {
  AnswerBar, Btn, Chip, DetailToggle, Explainer, Field, Group, Icon, Kv, Loading, PageHead, Popover, Row, Section, Seg, Sheet, Silence, useDetail, useExperiment, useLayer, useLayerCount, useToast, Why,
  type ChipTone, type ExplainerStep, type IconName,
} from '../../../shared/ui';
import { amountTone, chipClass, dealTotal, decidedBy, ledgerScope, marketPosition, moneyNow, PENDING_BACKEND, type ChipClass } from '../logic';
import { useCpLookup } from '../ui';
import { useAllEvidence, useWorld } from '../world';
import type { ModuleProps } from './common';
import {
  BUCKET_LABEL, BUCKET_SUB, BUCKETS, bucketOf, dayKey, dayLabel, dirOf, KIND_ORDER, kindLabel, LENSES, queryText, readQuery, runQuery,
  STATEMENT_TIP, STATEMENT_WORD, statementCounts, sums, toCSV, type Bucket, type Ctx, type Group as LensGroup, type Lens, type Result, type Statement,
} from './book/model';
import { AskChips } from './book/AskChips';
import { MoneyWent } from './book/MoneyWent';
import { totalWhy, type TotalKey } from './book/where';
import './book.css';

type Phase = 'IDLE' | 'UNAVAILABLE' | 'BLOCKED' | 'DRAFTED' | 'RESULT' | 'EMPTY';
type StmtFilter = 'all' | Statement;

const TONE: Record<ChipClass, ChipTone | undefined> = { live: 'teal', wait: 'gold', held: 'coral', done: 'ok', bad: 'red', off: undefined };
const STMT_TONE: Record<Statement, ChipTone | undefined> = { matched: 'ok', pending_reporting: 'gold', mismatch: 'red', not_applicable: undefined, unknown: 'dashed' };
const NO_ENGINE = new WalletError({ code: 'UNAVAILABLE', message: PENDING_BACKEND.book ?? 'Typed questions need your agent app, which is not connected. The quick views below work without it.' });
const wordOf = (d: Deal) => stateWord(d.state, { side: d.side, kind: d.kind });
/** Where the deal price sits against the market, in words; the percentile stays in the tooltip. */
function marketText(d: Deal): { text: string; tip: string } | null {
  const m = d.market;
  const u = d.terms.unit_price;
  if (!m || m.median.currency !== u.currency) return null;
  return { text: marketWords(u.minor, m.p25.minor, m.median.minor, m.p75.minor).text, tip: `${marketPosition(u.minor, m.p25.minor, m.median.minor, m.p75.minor)} of the market range` };
}
const QUERY_KEY: Record<string, string> = { view: 'Looks at', filter: 'Only', group_by: 'One line per', metrics: 'Shows' };
const GROUP_NAME: Partial<Record<Deal['kind'], string>> = { haggle: 'Haggles', purchase: 'Purchases', shop_order: 'Shop orders', rescue: 'Rescues', invoice: 'Invoices' };

/** The Book page. The root (.module.mod-book, --mc) comes from ModuleView. */
export function Book({ nav }: Pick<ModuleProps, 'nav'>) {
  const w = useWorld();
  const now = useNow();
  const cp = useCpLookup();
  const toast = useToast();
  const all = w.deals.data ?? [];
  const scope = useMemo(() => ledgerScope(all, now), [all, now]);
  const ledger = scope.deals;
  const ev = useAllEvidence(w.deals.data, 0);
  const evLoading = !ev.map.size && !ev.error && !!all.length;
  const stmt = (d: Deal): Statement => ev.map.get(d.id)?.reconciliation ?? 'unknown';
  const ctx: Ctx = { stmt, cpName: (d) => cp(d.counterparty).name };
  const label = (d: Deal) => w.display(d).label;

  const [phase, setPhase] = useState<Phase>('IDLE');
  const [asked, setAsked] = useState('');
  const [lens, setLens] = useState<Lens | null>(null);
  const [res, setRes] = useState<(Result & { seq: number }) | null>(null);
  const [seq, setSeq] = useState(0);
  const [stmtF, setStmtF] = useState<StmtFilter>('all');
  const [bucketF, setBucketF] = useState<Bucket | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  // The lens's query, checked and answered by Rust (book_query, read-only). The window still
  // runs the same lens over its own rows to light them in the grid.
  const bq = useMutation('book_query');
  const [answer, setAnswer] = useState<BookAnswer | null>(null);
  const facts = useQuery('owner_facts', null, { refreshOn: ['deal:changed', 'receipt:created'] });
  const poll = facts.data?.last_reporting_poll ?? null;
  const ask = useRef<HTMLInputElement>(null);
  const layers = useLayerCount();
  const [detail, setDetail] = useDetail('book');
  const detailed = detail === 'detailed';
  const [showAll, setShowAll] = useState(false);
  // Round 2 (docs/ux/ROUND-2.md): bars, the PayPal-agrees meter, question chips and a Why? on each total. Off = round 1.
  const r2 = useExperiment('r2-book');

  const discard = () => { setPhase('IDLE'); setAsked(''); setLens(null); setRes(null); setAnswer(null); bq.reset(); };
  const pickLens = (l: Lens) => { setAsked(l.question); setLens(l); setRes(null); setPhase(l.unavailable ? 'BLOCKED' : 'DRAFTED'); if (ask.current) ask.current.value = l.question; };
  const run = () => {
    if (!lens || lens.unavailable) return;
    const n = seq + 1;
    const r = runQuery(lens.query, ledger, ctx);
    setAnswer(null);
    void bq.run({ query: lens.query as unknown as JsonValue }).then((a) => setAnswer(a ?? null));
    setSeq(n);
    setRes({ ...r, seq: n });
    setPhase(r.rows.length ? 'RESULT' : 'EMPTY');
    setReading(false);
  };
  const onAsk = (e: FormEvent) => {
    e.preventDefault();
    const q = ask.current?.value.trim() ?? '';
    if (!q) { ask.current?.focus(); return; }
    setAsked(q); setLens(null); setRes(null); setPhase('UNAVAILABLE');
  };

  // Esc clears the lens and the slip before it leaves the page (a layer, ahead of App's handler).
  useLayer(discard, 'other', phase !== 'IDLE');
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const k = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && phase === 'DRAFTED' && !sel) { e.preventDefault(); runRef.current(); return; }
      if (layers > (phase !== 'IDLE' ? 1 : 0)) return;
      const t = e.target as HTMLElement | null;
      if (e.key === '/' && !(t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) { e.preventDefault(); ask.current?.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [layers, phase, sel]);

  const lit = res && phase === 'RESULT' ? new Set(res.rows.map((d) => d.id)) : null;
  const visible = ledger.filter((d) => (stmtF === 'all' || stmt(d) === stmtF) && (!bucketF || bucketOf(d) === bucketF));
  const counts = statementCounts(ledger, stmt);
  const totals = sums(ledger);
  const selDeal = sel ? all.find((d) => d.id === sel) : undefined;

  const exportRows = (rows: Deal[], query: string, name: string) => {
    const csv = toCSV(rows, { ...ctx, label }, query);
    const modes = [...new Set(rows.map((d) => d.mode))].join('+') || 'empty';
    const file = `${name}-${modes}-${new Date(now * 1000).toISOString().slice(0, 10)}.csv`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = file;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(<><b>{file}</b> saved · {rows.length} rows, each marked {modes}. Nothing was uploaded.</>, 'ok');
  };

  return (
    <>
      <PageHead title="Book" icon={<Glyph module="book" />} focusKey="book"
        sub={<>All payments · {scope.scope === 'week' ? 'this week' : 'everything on record'} · as of {clockLabel(now)}</>}
        actions={<DetailToggle value={detail} onChange={setDetail} />} />

      <WeekAnswer deals={ledger} week={scope.scope === 'week'} />
      <Explainer id="book" title="How your book works" steps={HOW_BOOK} />
      {!detailed ? <Totals deals={ledger} why={r2} /> : null}

      <Outlook deals={ledger} label={label} onOpen={(id) => setSel(id)} simple={!detailed} />

      {r2 && !detailed ? <MoneyWent deals={ledger} stmt={evLoading ? () => null : stmt} checkedAt={poll && poll.status === 200 ? clockLabel(poll.at) : null}
        titleOf={(d) => w.display(d).title} onOpen={(id) => setSel(id)} /> : null}

      <section className="ui-section ask" aria-label="Ask the book">
        <form className="askrow" onSubmit={onAsk}>
          <Field ref={ask} search className="askf" autoComplete="off" aria-label="Ask the book" placeholder="Ask about your agents’ money, in your own words" />
          <Btn type="submit">Ask</Btn>
        </form>
        {r2 ? <AskChips activeId={lens?.id ?? null} onPick={(id) => { const l = LENSES.find((x) => x.id === id); if (l) pickLens(l); }} /> : (
        <div className="lenses" role="group" aria-label="Quick views">
          <span className="ui-hint">Quick views</span>
          {LENSES.map((l) => (
            <button key={l.id} type="button" className={`lens ${lens?.id === l.id ? 'on' : ''} ${l.unavailable ? 'unk' : ''}`} aria-pressed={lens?.id === l.id}
              title={l.unavailable ? `${l.question} · ${l.unavailable}` : l.question} onClick={() => pickLens(l)}>
              {l.short}
            </button>
          ))}
        </div>
        )}
        {phase !== 'IDLE' ? (
          <Slip phase={phase} asked={asked} lens={lens} res={res} answer={answer} answerError={bq.error} answering={bq.pending} detailed={detailed} onRead={() => setReading(true)} onRun={run} onDiscard={discard}
            onCsv={() => res && exportRows(res.rows, queryText(res.query), `book-lens-${res.seq}`)} />
        ) : null}
      </section>

      {!detailed ? (
        <RecentPayments deals={ledger} all={showAll} onAll={setShowAll} stmt={evLoading ? () => null : stmt} onOpen={(id) => setSel(id)}
          whoOf={(d) => cp(d.counterparty).name} titleOf={(d) => w.display(d).title} />
      ) : (
      <section className="ui-section" aria-label="The ledger">
        <div className="gridbox">
          <div className="ui-toolbar">
            <span className="gt-title">{scope.scope === 'week' ? 'The week’s ledger' : 'The ledger'}</span>
            <span className="ui-hint">{visible.length} of {ledger.length} deals{bucketF ? ` · ${BUCKET_LABEL[bucketF].toLowerCase()}` : ''}</span>
            {lit && res ? <><Chip tone="gold" title="Deals outside the answer are dimmed">{visible.filter((d) => lit.has(d.id)).length} in the answer</Chip>
              <Btn sm kind="plain" onClick={discard} title="Show every deal again (Esc)">Show all</Btn></> : null}
            <span className="ui-spacer" />
            <span className="ui-hint">PayPal statement</span>
            <Seg label="Filter by PayPal statement" value={stmtF} onChange={setStmtF} options={[
              { value: 'all', label: <>All <span className="cnt">{ledger.length}</span></> },
              { value: 'matched', label: <>On statement <span className="cnt">{counts.matched}</span></>, title: STATEMENT_TIP.matched },
              { value: 'pending_reporting', label: <>Not yet <span className="cnt">{counts.pending_reporting}</span></>, title: STATEMENT_TIP.pending_reporting },
              { value: 'mismatch', label: <>Differs <span className="cnt">{counts.mismatch}</span></>, title: STATEMENT_TIP.mismatch },
              { value: 'not_applicable', label: <>No payment <span className="cnt">{counts.not_applicable}</span></>, title: STATEMENT_TIP.not_applicable },
              ...(counts.unknown && !evLoading ? [{ value: 'unknown' as const, label: <>Unknown <span className="cnt">{counts.unknown}</span></>, title: STATEMENT_TIP.unknown }] : []),
            ]} />
            <GridHelp />
            <Btn sm onClick={() => setAuditOpen(true)} title="Everything that happened, newest first. Nothing in it can be changed.">Audit trail</Btn>
            <Btn sm onClick={() => exportRows(visible, '', 'book-ledger')} title="Save the deals you see as a spreadsheet file">Export CSV</Btn>
          </div>
          {ev.error && !ev.map.size ? <WalletNotice error={ev.error} what="PayPal statement" /> : null}
          <table className="ui-table ledger">
            <thead>
              <tr>
                <th>Deal</th><th>Status</th>
                {BUCKETS.map((b) => <th key={b} className="num" title={BUCKET_SUB[b]}>{BUCKET_LABEL[b]}</th>)}
                <th className="c-mkt" title="Where the price sits against similar listings">vs market</th><th title="Does PayPal’s own statement show it?">Statement</th>
              </tr>
              <tr className="tots">
                <th colSpan={2}><span className="ui-hint" title="Each column has its own total. A hold is not a payment, so they are never added together.">Totals, kept apart</span></th>
                {BUCKETS.map((b) => (
                  <th key={b} className="num">
                    <button type="button" className="tot" aria-pressed={bucketF === b} onClick={() => setBucketF((x) => (x === b ? null : b))}
                      title={`${BUCKET_LABEL[b]}: ${BUCKET_SUB[b]} · ${ledger.filter((d) => bucketOf(d) === b).length} deals. Click to filter.`}>
                      <MoneyLines out={totals[b].out} inn={totals[b].in} bucket={b} />
                    </button>
                  </th>
                ))}
                <th className="c-mkt" />
                <th><span className="ui-hint" title={poll ? `Your PayPal statement was last checked ${clockLabel(poll.at)}${poll.status === 200 ? '' : ` and did not answer (HTTP ${poll.status || 'none'})`}. It can lag up to 3 hours.` : facts.error ? 'When the statement was last checked is not readable here' : 'The statement has not been checked yet'}>
                  {evLoading ? 'reading…' : poll ? <>checked {clockLabel(poll.at)}{poll.status === 200 ? '' : ' · no answer'}</> : facts.data ? 'not checked yet' : 'can lag 3 h'}</span></th>
              </tr>
            </thead>
            <tbody>
              {!all.length ? <tr><td colSpan={8}><div className="ui-empty">No deals yet. They appear here as soon as an agent proposes one.</div></td></tr>
                : !visible.length ? <tr><td colSpan={8}><div className="ui-empty">No deals match this filter. All {ledger.length} are still here.</div></td></tr>
                : KIND_ORDER.map((k) => {
                  const rs = visible.filter((d) => d.kind === k).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0) || label(a).localeCompare(label(b)));
                  if (!rs.length) return null;
                  return [
                    <tr key={`g-${k}`} className="grp"><td colSpan={8}>{GROUP_NAME[k] ?? kindLabel(k)} · {rs.length}</td></tr>,
                    ...rs.map((d) => (
                      <GridRow key={d.id} deal={d} label={label(d)} title={w.display(d).title} cpName={cp(d.counterparty).name} statement={evLoading ? null : stmt(d)}
                        off={!!lit && !lit.has(d.id)} selected={sel === d.id} onOpen={() => setSel(d.id)} />
                    )),
                  ];
                })}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {reading && lens ? (
        <Sheet title={phase === 'DRAFTED' || phase === 'BLOCKED' ? 'What this view asks' : 'How this answer was asked'} size="wide" onClose={() => setReading(false)}
          footer={<>
            <Btn onClick={() => setReading(false)}>Close</Btn>
            {phase === 'DRAFTED' ? <Btn kind="primary" onClick={run}>Show answer</Btn> : null}
          </>}>
          <ReadBody lens={lens} rows={ledger.length} />
        </Sheet>
      ) : null}

      {auditOpen ? <AuditSheet label={(id) => { const d = all.find((x) => x.id === id); return d ? label(d) : shortId(id); }} onClose={() => setAuditOpen(false)} /> : null}

      {selDeal ? (
        <Sheet title={<>{label(selDeal)} · {w.display(selDeal).title}</>} size="wide" onClose={() => setSel(null)}
          footer={<><Btn onClick={() => setSel(null)}>Close</Btn><Btn kind="primary" onClick={() => { setSel(null); nav.onDeal(selDeal.id); }}>Open deal ›</Btn></>}>
          <RowDetail deal={selDeal} evidence={ev.map.get(selDeal.id)} evError={ev.error} />
        </Sheet>
      ) : null}
    </>
  );
}

// ---- Layer 1 pieces --------------------------------------------------------------------------------

const HOW_BOOK: readonly ExplainerStep[] = [
  { icon: 'book', title: 'Every payment, one list', text: 'All the money your agents moved or planned.' },
  { icon: 'hold', title: 'A hold isn’t a payment', text: 'PayPal keeps the money aside until it is collected.' },
  { icon: 'check', title: 'Checked against PayPal', text: 'Each payment is matched to PayPal’s own statement.' },
];

/** "$295.00 · €12.00": each currency on its own, never added together. */
const moneyList = (ms: readonly Money[]) => ms.map((m) => formatMinor(m.minor, m.currency)).join(' · ');
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The answer at the top: where the money is. Every figure is summed per state, direction and currency. */
function WeekAnswer({ deals, week }: { deals: Deal[]; week: boolean }) {
  const when = week ? 'This week' : 'On record';
  if (!deals.length) return <AnswerBar tone="calm" icon="book" title="Nothing yet. No payments are on record." sub="They appear here as soon as an agent proposes a deal." />;
  const s = sums(deals);
  const out = moneyList(s.captured.out);
  const inn = moneyList(s.captured.in);
  const held = moneyList([...s.held.out, ...s.held.in]);
  const stopped = deals.filter((d) => bucketOf(d) === 'stopped').length;
  const holds = deals.filter((d) => d.state === 'AUTHORIZED').length;
  const title = out && inn ? `${when}: ${out} paid out, ${inn} paid in.` : out ? `${when}: ${out} paid out. Nothing paid in yet.` : inn ? `${when}: ${inn} paid in. Nothing paid out.` : `${when}: no money has moved yet.`;
  const bits = [held ? `${held} is on hold at PayPal, not paid yet.` : '', stopped ? `${plural(stopped, 'payment was', 'payments were')} stopped or paid back.` : ''].filter(Boolean);
  return <AnswerBar tone={holds ? 'need' : 'calm'} icon={holds ? undefined : 'book'} title={title} sub={bits.length ? bits.join(' ') : undefined} />;
}

type Tile = { k: string; label: string; icon: IconName; bucket: Bucket; out: Money[]; inn: Money[]; n: number; note: string };

/** Four plain totals. Each currency keeps its own line; a hold is never added to what was paid. */
function Totals({ deals, why }: { deals: Deal[]; why?: boolean }) {
  const s = sums(deals);
  const n = (b: Bucket, dir?: 'out' | 'in') => deals.filter((d) => bucketOf(d) === b && (!dir || dirOf(d) === dir)).length;
  const tiles: Tile[] = [
    { k: 'out', label: 'Paid out', icon: 'arrow', bucket: 'captured', out: s.captured.out, inn: [], n: n('captured', 'out'), note: 'the money moved' },
    { k: 'in', label: 'Paid in', icon: 'bank', bucket: 'captured', out: [], inn: s.captured.in, n: n('captured', 'in'), note: 'the money moved' },
    { k: 'held', label: 'On hold', icon: 'hold', bucket: 'held', out: s.held.out, inn: s.held.in, n: n('held'), note: 'not paid yet' },
    { k: 'stopped', label: 'Stopped', icon: 'block', bucket: 'stopped', out: s.stopped.out, inn: s.stopped.in, n: n('stopped'), note: 'never paid, or paid back' },
  ];
  return (
    <div className="totals" role="group" aria-label="Totals, each kept apart">
      {tiles.map((t) => {
        const both = t.out.length > 0 && t.inn.length > 0;
        return (
          <div key={t.k} className={`tile tl-${t.bucket} t-${t.k}`} title={BUCKET_SUB[t.bucket]}>
            <div className="tk"><Icon name={t.icon} size={15} />{t.label}
              {why ? <TotalWhy k={t.k as TotalKey} label={t.label} deals={deals} /> : null}
            </div>
            {t.out.length || t.inn.length ? (
              <div className="tv">
                {t.out.map((m) => <span key={`o${m.currency}`} className="fig">{formatMinor(m.minor, m.currency)}{both ? <small>going out</small> : null}</span>)}
                {t.inn.map((m) => <span key={`i${m.currency}`} className="fig">{formatMinor(m.minor, m.currency)}{both ? <small>coming in</small> : null}</span>)}
              </div>
            ) : <div className="tv"><span className="fig none">—</span></div>}
            <div className="tn">{plural(t.n, 'payment', 'payments')} · {t.note}</div>
          </div>
        );
      })}
    </div>
  );
}

/** "Why?" on a total: two sentences written from the deals themselves (round 2). */
function TotalWhy({ k, label, deals }: { k: TotalKey; label: string; deals: Deal[] }) {
  const [one, two] = totalWhy(k, deals);
  return <Why question={`Why this figure for “${label}”?`} className="tw"><p>{one}</p><p>{two}</p></Why>;
}

/** The newest payments, one simple row each: when, who and what, status, amount and PayPal's own statement. */
function RecentPayments({ deals, all, onAll, stmt, onOpen, whoOf, titleOf }: {
  deals: Deal[]; all: boolean; onAll: (v: boolean) => void; stmt: (d: Deal) => Statement | null; onOpen: (id: string) => void; whoOf: (d: Deal) => string; titleOf: (d: Deal) => string;
}) {
  const stamp = (d: Deal) => d.updated_at ?? d.created_at ?? 0;
  const sorted = [...deals].sort((a, b) => stamp(b) - stamp(a));
  const shown = all ? sorted : sorted.slice(0, 8);
  return (
    <Section title="Recent payments" end={`${deals.length} in all`}>
      <Group empty="No deals yet. They appear here as soon as an agent proposes one.">
        {shown.length ? shown.map((d) => {
          const t = dealTotal(d);
          const wd = wordOf(d);
          const tone = amountTone(d);
          return (
            <Row key={d.id} className="pay" onOpen={() => onOpen(d.id)}
              lead={<span className="when">{stamp(d) ? clockLabel(stamp(d)) : '—'}</span>}
              title={titleOf(d)} sub={<span className="cp">{whoOf(d)}</span>}>
              {d.mode !== 'sandbox' ? <ModeBadge mode={d.mode} /> : null}
              <span className="pst"><Chip tone={TONE[chipClass(d)]} title={wd.means}>{wd.text}</Chip></span>
              <span className="pstm"><StmtChip s={stmt(d)} /></span>
              <span className={`amt ${tone}`}>{formatMinor(t.minor, t.currency)}{dirOf(d) === 'in' ? <span className="in">in</span> : null}</span>
            </Row>
          );
        }) : null}
      </Group>
      {sorted.length > 8 ? <div className="more"><Btn sm kind="plain" onClick={() => onAll(!all)}>{all ? 'Show fewer' : `Show all ${sorted.length}`}</Btn></div> : null}
    </Section>
  );
}

function MoneyLines({ out, inn, bucket }: { out: Money[]; inn: Money[]; bucket: Bucket }) {
  if (!out.length && !inn.length) return <span className="dim">—</span>;
  return (
    <>
      {out.map((m) => <span key={`o${m.currency}`} className={`bk-${bucket}`}>{formatMinor(m.minor, m.currency)}</span>)}
      {inn.map((m) => <small key={`i${m.currency}`}>{formatMinor(m.minor, m.currency)} in</small>)}
    </>
  );
}

function StmtChip({ s }: { s: Statement | null }) {
  if (s === null) return <span className="dim" title="Reading the PayPal proof">…</span>;
  if (s === 'not_applicable') return <span className="dim" title={STATEMENT_TIP[s]}>—</span>;
  return <Chip tone={STMT_TONE[s]} className={s === 'pending_reporting' ? 'dashed' : undefined} title={STATEMENT_TIP[s]}>{STATEMENT_WORD[s]}</Chip>;
}

function GridRow({ deal, label, title, cpName, statement, off, selected, onOpen }: {
  deal: Deal; label: string; title: string; cpName: string; statement: Statement | null; off: boolean; selected: boolean; onOpen: () => void;
}) {
  const t = dealTotal(deal);
  const b = bucketOf(deal);
  const mkt = marketText(deal);
  const wd = wordOf(deal);
  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); onOpen(); return; }
    const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const rows = [...(e.currentTarget.closest('tbody')?.querySelectorAll<HTMLTableRowElement>('tr.r') ?? [])];
    rows[rows.indexOf(e.currentTarget) + dir]?.focus();
  };
  const day = dayKey(deal);
  return (
    <tr className={`r ${off ? 'off' : ''}`} tabIndex={0} aria-selected={selected} onClick={onOpen} onKeyDown={onKey}>
      <td className="clip">
        <span className="mono">{label}</span><span className="day">{day ? dayLabel(day).split(' ')[0] : ''}</span>{title} <span className="cp">· {cpName}</span>
        {deal.mode !== 'sandbox' ? <> <ModeBadge mode={deal.mode} /></> : null}
      </td>
      <td><Chip tone={TONE[chipClass(deal)]} title={wd.means}>{wd.text}</Chip></td>
      {BUCKETS.map((k) => (
        <td key={k} className={`num c-${k}`}>{k === b ? <>{formatMinor(t.minor, t.currency)}{dirOf(deal) === 'in' ? <span className="in">in</span> : null}</> : null}</td>
      ))}
      <td className="dim c-mkt" title={mkt?.tip}>{mkt ? mkt.text : '—'}</td>
      <td><StmtChip s={statement} /></td>
    </tr>
  );
}

type OutItem = { k: string; n: number; label: string; first: Deal | undefined; deadline: number | null; short: string; silence: string | null };

const OUT_ICON: Record<string, IconName> = { holds: 'hold', links: 'link', renew: 'renew' };

function Outlook({ deals, label, onOpen, simple }: { deals: Deal[]; label: (d: Deal) => string; onOpen: (id: string) => void; simple: boolean }) {
  const w = useWorld();
  const now = useNow();
  const [open, setOpen] = useState<{ k: string; a: HTMLElement } | null>(null);
  const dl = (d: Deal) => w.needOf(d.id)?.deadline ?? w.display(d).deadline;
  const sil = (d: Deal | undefined) => (d ? w.needOf(d.id)?.on_silence ?? w.display(d).on_silence : null);
  const first = (xs: Deal[]) => [...xs].sort((a, b) => (dl(a) ?? Infinity) - (dl(b) ?? Infinity))[0];
  const holds = deals.filter((d) => d.state === 'AUTHORIZED');
  const links = deals.filter((d) => d.state === 'AWAITING_APPROVAL');
  const failing = deals.filter((d) => d.kind === 'rescue' && d.state === 'FAILED');
  const items: OutItem[] = [
    { k: 'holds', n: holds.length, label: holds.length === 1 ? 'hold to decide' : 'holds to decide', first: first(holds), deadline: null, short: 'the hold is released, nothing is paid', silence: null },
    { k: 'links', n: links.length, label: links.length === 1 ? 'payment link open' : 'payment links open', first: first(links), deadline: null, short: 'the link lapses, no money moves', silence: null },
    { k: 'renew', n: failing.length, label: failing.length === 1 ? 'renewal failing' : 'renewals failing', first: first(failing), deadline: null, short: 'PayPal retries on its own', silence: null },
  ].map((it) => ({ ...it, deadline: it.first ? dl(it.first) : null, silence: sil(it.first) }));
  const cur = open ? items.find((x) => x.k === open.k) : undefined;
  const pop = open && cur ? (
    <Popover anchor={open.a} onClose={() => setOpen(null)} title={`${cur.n} ${cur.label}`}>
      <div className="bk-pop">
        {cur.first ? (
          <Kv items={[
            ['Deal', <Btn sm kind="plain" onClick={() => { setOpen(null); if (cur.first) onOpen(cur.first.id); }}>{label(cur.first)} · {w.display(cur.first).title}</Btn>],
            ['Amount', <span className="money">{formatMinor(dealTotal(cur.first).minor, dealTotal(cur.first).currency)}</span>],
            cur.deadline ? ['Deadline', <>{clockLabel(cur.deadline)} · <Countdown deadline={cur.deadline} /> left</>] : null,
            ['If you do nothing', cur.silence ?? cur.short],
          ]} />
        ) : <Kv items={[['Now', 'none'], ['If you do nothing', cur.short]]} />}
        <p className="ui-hint">Counted from your deals. Not a forecast.</p>
      </div>
    </Popover>
  ) : null;
  if (simple) {
    const due = items.filter((it) => it.n > 0);
    return (
      <Section title="Needs attention" end={due.length ? `${due.length} ${due.length === 1 ? 'thing' : 'things'}` : undefined}>
        {due.length ? (
          <div className="attn">
            {due.map((it) => {
              const t = it.first ? dealTotal(it.first) : null;
              return (
                <button key={it.k} type="button" className="at-card" aria-haspopup="dialog"
                  onClick={(e) => { const a = e.currentTarget; setOpen((o) => (o?.k === it.k ? null : { k: it.k, a })); }}>
                  <span className="at-ico"><Icon name={OUT_ICON[it.k] ?? 'alert'} size={18} /></span>
                  <span className="at-main">
                    <span className="at-t"><b>{it.n}</b> {it.label}</span>
                    <span className="at-s">{it.first && t ? <><span className="money">{formatMinor(t.minor, t.currency)}</span>{it.deadline ? ` · ${timeLeftWords(it.deadline - now)} left` : ''}</> : null}</span>
                    <Silence className="at-sil" text={it.short} />
                  </span>
                  <span className="chev" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        ) : <Group empty="Nothing needs your attention. No holds, open payment links or failing renewals." />}
        {pop}
      </Section>
    );
  }
  return (
    <Group className="outlook" label="Cash-flow outlook">
      {items.map((it) => {
        const t = it.first ? dealTotal(it.first) : null;
        return (
          <button key={it.k} type="button" className="ui-row two act" aria-haspopup="dialog"
            onClick={(e) => { const a = e.currentTarget; setOpen((o) => (o?.k === it.k ? null : { k: it.k, a })); }}>
            <span className="main">
              <span className="t1"><b>{it.n}</b> {it.label}{it.first && t ? <> · <span className="money">{formatMinor(t.minor, t.currency)}</span>{it.deadline ? <span className="dim"> · {timeLeftWords(it.deadline - now)} left</span> : null}</> : null}</span>
              <span className="t2"><Silence text={it.short} /></span>
            </span>
            <span className="chev" aria-hidden="true" />
          </button>
        );
      })}
      {pop}
    </Group>
  );
}

function Slip({ phase, asked, lens, res, answer, answerError, answering, detailed, onRead, onRun, onDiscard, onCsv }: {
  phase: Phase; asked: string; lens: Lens | null; res: (Result & { seq: number }) | null;
  answer: BookAnswer | null; answerError: WalletError | null; answering: boolean; detailed: boolean;
  onRead: () => void; onRun: () => void; onDiscard: () => void; onCsv: () => void;
}) {
  const q = lens ? queryText(lens.query) : '';
  let chip: ReactNode = null;
  let t2: ReactNode = null;
  let end: ReactNode = null;
  if (phase === 'UNAVAILABLE') {
    chip = <Chip tone="dashed">can’t answer yet</Chip>;
    t2 = <span className="t2">typed questions need your agent app · try a quick view below</span>;
    end = <Btn sm kind="plain" onClick={onDiscard}>Discard</Btn>;
  } else if (phase === 'BLOCKED') {
    chip = <Chip tone="dashed">can’t run</Chip>;
    t2 = <span className="t2">{lens?.unavailable ?? 'this view can’t run yet'}</span>;
    end = <><Btn sm onClick={onRead}>Details ›</Btn><Btn sm kind="plain" onClick={onDiscard}>Discard</Btn></>;
  } else if (phase === 'DRAFTED') {
    chip = <Chip tone="teal">ready</Chip>;
    t2 = <span className="t2" title={q}>only reads your deals · changes nothing</span>;
    end = <><Btn sm onClick={onRead}>Details ›</Btn>
      <Btn sm kind="primary" onClick={onRun} title="Ctrl+Enter">Show answer</Btn><Btn sm kind="plain" onClick={onDiscard}>Discard</Btn></>;
  } else if (res) {
    chip = <Chip tone={phase === 'RESULT' ? 'ok' : undefined}>{phase === 'RESULT' ? 'answer' : 'nothing found'}</Chip>;
    t2 = <span className="t2" title={q}>{res.rows.length} deal{res.rows.length === 1 ? '' : 's'} in the answer{detailed ? ' · highlighted below' : ''}</span>;
    end = <><Btn sm onClick={onRead}>Details ›</Btn>
      {phase === 'RESULT' ? <Btn sm onClick={onCsv}>Export CSV</Btn> : null}<Btn sm kind="plain" onClick={onDiscard}>Clear</Btn></>;
  }
  return (
    <div className="slip">
      <Group>
        <div className="ui-row two">
          {chip}
          <span className="main"><span className="t1">“{asked}”</span>{t2}</span>
          
          {end}
        </div>
        {phase === 'UNAVAILABLE' ? <WalletNotice error={NO_ENGINE} what="Ask the book" /> : null}
        {phase === 'BLOCKED' && lens?.unavailable ? <WalletNotice error={new WalletError({ code: 'UNAVAILABLE', message: lens.unavailable })} what={lens.short} /> : null}
        {phase === 'RESULT' && res ? <Pivot res={res} /> : null}
        {(phase === 'RESULT' || phase === 'EMPTY') && answering ? <Loading what="the wallet’s answer" /> : null}
        {(phase === 'RESULT' || phase === 'EMPTY') && answerError ? <WalletNotice error={answerError} what="The wallet’s answer" /> : null}
        {(phase === 'RESULT' || phase === 'EMPTY') && answer ? <WalletAnswer answer={answer} /> : null}
      </Group>
    </div>
  );
}

function SumCell({ out, inn, bucket }: { out: Money[]; inn: Money[]; bucket: Bucket }) {
  const parts = [...out.map((m) => <span key={`o${m.currency}`} className={`bk-${bucket}`}>{formatMinor(m.minor, m.currency)}</span>),
    ...inn.map((m) => <span key={`i${m.currency}`}><span className={`bk-${bucket}`}>{formatMinor(m.minor, m.currency)}</span><span className="dim"> in</span></span>)];
  if (!parts.length) return <span className="dim">—</span>;
  return <>{parts.flatMap((p, i) => (i ? [<span key={`s${i}`} className="dim"> · </span>, p] : [p]))}</>;
}

function StmtSummary({ c }: { c: Record<Statement, number> }) {
  const xs = (['matched', 'pending_reporting', 'mismatch', 'unknown'] as const).filter((s) => c[s]);
  if (!xs.length) return <span className="dim">—</span>;
  return <>{xs.map((s) => <Chip key={s} tone={STMT_TONE[s]} className={s === 'pending_reporting' ? 'dashed' : undefined} title={STATEMENT_TIP[s]}>{c[s]} {STATEMENT_WORD[s]}</Chip>)}</>;
}

/** The wallet's own answer to the view (book_query): totals per currency and mode, exact minor
 *  units and basis points, read on a read-only connection. */
function WalletAnswer({ answer }: { answer: BookAnswer }) {
  const groups = answer.query.group_by;
  const m = answer.query.metrics;
  const cell = (row: Record<string, JsonValue>, k: string) => row[k] ?? null;
  const money = (row: Record<string, JsonValue>, k: string) => {
    const v = cell(row, k);
    return typeof v === 'number' ? formatMinor(v, row.currency as Currency) : <span className="dim">—</span>;
  };
  return (
    <div className="ui-section">
      <p className="ui-hint">Checked by your wallet · {answer.rows.length} line{answer.rows.length === 1 ? '' : 's'} · each currency and mode on its own line</p>
      {answer.rows.length ? (
        <table className="ui-table pivot">
          <thead><tr>
            <th>Currency</th><th>Mode</th>{groups.map((g) => <th key={g}>{g === 'decided_by' ? 'decided by' : g.replace(/_/g, ' ')}</th>)}
            {m.includes('count') ? <th className="num">Rows</th> : null}
            {m.includes('sum_amount') ? <th className="num">Amount</th> : null}
            {m.includes('avg_vs_market_pct') ? <th className="num">vs market</th> : null}
            {m.includes('recovered_sum') ? <th className="num">Recovered</th> : null}
          </tr></thead>
          <tbody>
            {answer.rows.map((raw, i) => {
              const row = (raw ?? {}) as Record<string, JsonValue>;
              return (
                <tr key={i}>
                  <td className="mono">{String(cell(row, 'currency'))}</td>
                  <td>{(() => { const v = cell(row, 'mode'); return v === 'sandbox' || v === 'replay' || v === 'scripted_engine' ? modeWord(v) : String(v); })()}</td>
                  {groups.map((g) => {
                    const v = cell(row, g);
                    const text = g === 'decided_by' && typeof v === 'string' ? (() => { try { return decidedBy({ decided_by: JSON.parse(v) as Deal['decided_by'] }).text; } catch { return v; } })() : v === null ? '—' : String(v);
                    return <td key={g}>{text}</td>;
                  })}
                  {m.includes('count') ? <td className="num">{String(cell(row, 'count'))}</td> : null}
                  {m.includes('sum_amount') ? <td className="num">{money(row, 'sum_amount')}</td> : null}
                  {m.includes('avg_vs_market_pct') ? <td className="num">{typeof cell(row, 'avg_vs_market_bp') === 'number' ? `${(cell(row, 'avg_vs_market_bp') as number) / 100}%` : <span className="dim">no market price</span>}</td> : null}
                  {m.includes('recovered_sum') ? <td className="num">{money(row, 'recovered_sum')}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="ui-hint">No rows match.</p>}
    </div>
  );
}

/** The answer as numbers only: one line per group. */
function Pivot({ res }: { res: Result }) {
  const m = res.query.metrics;
  const gb = res.query.group_by ?? [];
  const groups: Array<LensGroup | (Result['all'] & { key: string; label: string })> = res.groups.length ? res.groups : [{ key: 'all', label: 'all rows', ...res.all }];
  return (
    <table className="ui-table pivot">
      <thead><tr>
        <th>{gb.length ? gb.join(' · ').replace(/_/g, ' ') : 'In this view'}</th>
        {m.includes('count') ? <th className="num">Deals</th> : null}
        {m.includes('sum_amount') ? BUCKETS.map((b) => <th key={b} className="num">{BUCKET_LABEL[b]}</th>) : null}
        {m.includes('avg_vs_market_pct') ? <th className="num">vs market</th> : null}
        {m.includes('recovered_sum') ? <th className="num">Recovered</th> : null}
        <th>PayPal statement</th>
      </tr></thead>
      <tbody>
        {groups.map((g) => (
          <tr key={g.key}>
            <td>{g.label}</td>
            {m.includes('count') ? <td className="num">{g.count}</td> : null}
            {m.includes('sum_amount') ? BUCKETS.map((b) => <td key={b} className="num"><SumCell out={g.sums[b].out} inn={g.sums[b].in} bucket={b} /></td>) : null}
            {m.includes('avg_vs_market_pct') ? <td className="num">{g.pct ? <>{g.pct.avg > 0 ? '+' : ''}{g.pct.avg}% <span className="dim" title="deals with a market price">of {g.pct.n}</span></> : <span className="dim">no market price</span>}</td> : null}
            {m.includes('recovered_sum') ? <td className="num">{g.recovered.length ? g.recovered.map((x) => formatMinor(x.minor, x.currency)).join(' · ') : <span className="dim">none</span>}</td> : null}
            <td><StmtSummary c={g.stmt} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GridHelp() {
  const [a, setA] = useState<HTMLElement | null>(null);
  return (
    <>
      <Btn sm kind="plain" aria-label="How to read the grid" onClick={(e) => { const t = e.currentTarget; setA((x) => (x ? null : t)); }}>ⓘ</Btn>
      {a ? (
        <Popover anchor={a} onClose={() => setA(null)} title="Reading this table">
          <div className="bk-pop">
            <Kv items={[
              ['Money', 'paid, on hold, in progress and stopped each have their own column and total. A hold is not a payment.'],
              ['On hold', 'PayPal is holding the money; it is not paid yet'],
              ['Statement', 'whether PayPal’s own statement shows the payment yet (it can lag up to 3 hours)'],
              ['Rows', 'click one for its PayPal proof'],
              ['Their notes', 'never shown here'],
            ]} />
          </div>
        </Popover>
      ) : null}
    </>
  );
}

// ---- Layer 2 -------------------------------------------------------------------------------------------

function ReadBody({ lens, rows }: { lens: Lens; rows: number }) {
  return (
    <div className="bk-l2">
      <h3>{lens.question}</h3>
      <Kv items={readQuery(lens.query).map(([k, v]) => [QUERY_KEY[k] ?? k, v] as const)} />
      {lens.unavailable ? <WalletNotice error={new WalletError({ code: 'UNAVAILABLE', message: lens.unavailable })} what="This view" /> : null}
      <p className="ui-hint">It only reads your {rows} deals: no PayPal call, and nothing can change. Your wallet checks the question before it answers.</p>
      <details className="ui-disclosure"><summary>The exact query</summary>
        <pre className="json">{JSON.stringify(lens.query, null, 1)}</pre>
      </details>
    </div>
  );
}

function MarketBand({ deal }: { deal: Deal }) {
  const m = deal.market;
  const u = deal.terms.unit_price;
  if (!m || m.median.currency !== u.currency) return <span className="dim">no market price to compare</span>;
  const W = 150, lo = Math.min(m.p25.minor, u.minor) * 0.97, hi = Math.max(m.p75.minor, u.minor) * 1.03;
  const x = (v: number) => 4 + ((v - lo) / (hi - lo || 1)) * (W - 8);
  const b = bucketOf(deal);
  return (
    <span className="mk" title={`${marketPosition(u.minor, m.p25.minor, m.median.minor, m.p75.minor)} · usual ${formatMinor(m.p25.minor, m.p25.currency)}–${formatMinor(m.p75.minor, m.p75.currency)} · typical ${formatMinor(m.median.minor, m.median.currency)}`}>
      <svg width={W} height={18} viewBox={`0 0 ${W} 18`} aria-hidden="true">
        <line x1={2} x2={W - 2} y1={9} y2={9} className="mk-axis" />
        <rect x={x(m.p25.minor)} y={4} width={Math.max(1, x(m.p75.minor) - x(m.p25.minor))} height={10} rx={2} className="mk-band" />
        <line x1={x(m.median.minor)} x2={x(m.median.minor)} y1={2} y2={16} className="mk-med" />
        <circle cx={x(u.minor)} cy={9} r={4} className={`mk-dot mk-${b}`} />
      </svg>
      <span>{marketWords(u.minor, m.p25.minor, m.median.minor, m.p75.minor).text}</span>
      <span className="dim">checked {clockLabel(m.retrieved_at)}</span>
    </span>
  );
}

function RowDetail({ deal, evidence, evError }: { deal: Deal; evidence: DealEvidence | undefined; evError: WalletError | null }) {
  const w = useWorld();
  const cp = useCpLookup()(deal.counterparty);
  const disp = w.display(deal);
  const need = w.needOf(deal.id);
  const t = dealTotal(deal);
  const b = bucketOf(deal);
  const s: Statement = evidence?.reconciliation ?? 'unknown';
  const pp = deal.paypal;
  const ids = [pp.order && `order ${pp.order}`, pp.authorization && `auth ${pp.authorization}`, pp.capture && `capture ${pp.capture}`, pp.subscription && `subscription ${pp.subscription}`].filter(Boolean).join(' · ');
  const deadline = need?.deadline ?? disp.deadline;
  const silence = need?.on_silence ?? disp.on_silence;
  return (
    <div className="bk-l2">
      <div className="chips">
        <Chip tone={TONE[chipClass(deal)]} title={wordOf(deal).means}>{wordOf(deal).text}</Chip>
        <StmtChip s={s} />
        <ModeBadge mode={deal.mode} />
      </div>
      <Kv items={[
        ['With', cp.name],
        ['What', `${GROUP_NAME[deal.kind] ?? kindLabel(deal.kind)} · you ${deal.side === 'seller' ? 'sell' : 'buy'} · ${deal.terms.qty > 1 ? `${deal.terms.qty} × ` : ''}${deal.terms.item_ref}`],
        ['Money', <><span className={`money bk-${b}`}>{formatMinor(t.minor, t.currency)}</span> {dirOf(deal) === 'in' ? 'coming in' : 'going out'} · {moneyNow(deal)}</>],
        ['When', <>{deal.created_at ? <>started {clockLabel(deal.created_at)}</> : 'no time recorded'}{deal.updated_at ? <> · last change {clockLabel(deal.updated_at)}</> : null}</>],
        deadline ? ['Deadline', <>{clockLabel(deadline)} · <Countdown deadline={deadline} /> left</>] : null,
        silence ? ['If you do nothing', silence] : null,
        ['Decided by', <DecidedText deal={deal} />],
        ['Receipt', evidence ? <span title={receiptWord(evidence.receipt).means}>{receiptWord(evidence.receipt).text}</span> : <span className="dim">unknown</span>],
        ['Statement', <>{STATEMENT_WORD[s]} <span className="dim">· {STATEMENT_TIP[s]}</span></>],
        ['Market', <MarketBand deal={deal} />],
        ['PayPal ids', ids ? <span className="mono dim">{ids}</span> : <span className="dim">no PayPal call</span>],
        ['Rules', <span className="dim" title={`${shortId(deal.mandate_id)} · version ${deal.mandate_version}`}>signed rules, version {deal.mandate_version}</span>],
      ]} />
      {evError && !evidence ? <WalletNotice error={evError} what="PayPal proof" /> : null}
      {!evidence && !evError ? <Loading what="the PayPal evidence" /> : null}
      <p className="ui-hint">Their notes never show here; open the deal to read them.</p>
    </div>
  );
}

/** The hash-chained audit log, newest first, one page at a time (audit_page). The chain is
 *  verified in Rust before every page; only closed facts cross: who, what, when, which deal, and
 *  the typed decision or transition a row records. */
function AuditSheet({ label, onClose }: { label: (id: string) => string; onClose: () => void }) {
  const read = useMutation('audit_page');
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [next, setNext] = useState<number | null | undefined>(undefined);
  const more = async (before: number | null) => {
    const r = await read.run({ before, limit: 50 });
    if (r) { setRows((x) => [...x, ...r.rows]); setNext(r.next_before); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void more(null); }, []);
  return (
    <Sheet title="Audit trail · newest first" size="wide" onClose={onClose}
      footer={<>{next ? <Btn disabled={read.pending} onClick={() => void more(next)}>{read.pending ? 'Reading…' : 'Older ›'}</Btn> : null}<Btn kind="primary" onClick={onClose}>Done</Btn></>}>
      {read.error ? <WalletNotice error={read.error} what="Audit trail" /> : null}
      {next === undefined && !read.error ? <Loading what="the audit trail" /> : (
        <table className="ui-table">
          <thead><tr><th>#</th><th>When</th><th>Who</th><th>What</th><th>Deal</th><th>Decided by · change</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seq}>
                <td className="num dim">{r.seq}</td>
                <td>{clockLabel(r.at)}</td>
                <td title={r.actor}>{r.actor.split(':')[0]}</td>
                <td title={r.action}>{r.action.replace(/[._]/g, ' ').toLowerCase()}</td>
                <td>{r.deal_id ? label(r.deal_id) : <span className="dim">—</span>}</td>
                <td>{r.decided_by ? decidedBy({ decided_by: r.decided_by }).text : null}{r.decided_by && r.to ? ' · ' : null}{r.to ? `${r.from ? `${stateWord(r.from).text} → ` : ''}${stateWord(r.to).text}` : null}{!r.decided_by && !r.to ? <span className="dim">—</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="ui-hint">Read-only. Each entry is chained to the one before it, so nothing can be changed or removed without it showing.</p>
    </Sheet>
  );
}

function DecidedText({ deal }: { deal: Deal }) {
  const f = decidedBy(deal);
  return <span className={f.who === 'none' ? 'dim' : undefined} title={f.why}>{f.text}</span>;
}
