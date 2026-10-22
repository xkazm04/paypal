// "Ask your book" (rebuild WP3b): a typed question is read by the wallet itself (a fixed word list,
// no AI: modules/book/understand.ts) into a closed, read-only query, shown back as chips the owner
// can remove or change; a question it cannot read says which words it did not get. A question chip
// (a fixed view) is drafted first, then shown. The window works the same query out over its own
// deals (the deals behind the answer, in one windowed list), and the wallet answers it too
// (book_query, read-only). Nothing here can change anything: Esc clears, Ctrl+Enter shows a draft.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { BookAnswer } from '@bindings/BookAnswer';
import type { Currency } from '@bindings/Currency';
import type { Deal } from '@bindings/Deal';
import type { JsonValue } from '@bindings/serde_json/JsonValue';
import { WalletError } from '../../../../../lib/contract';
import { formatMinor } from '../../../../../lib/format';
import { useMutation, useNow, useQuery } from '../../../../../lib/hooks';
import { BOOK, modeWord } from '../../../../../lib/words';
import { WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Field, Kv, Loading, useLayer } from '../../../../../shared/ui';
import { decidedBy } from '../../../logic';
import { AskChips } from '../../../modules/book/AskChips';
import { ReadingChips, UnsureLine } from '../../../modules/book/AskReading';
import {
  BUCKET_LABEL, BUCKETS, dayLabel, LENSES, queryText, readQuery, runQuery, serverStateLabel, STATEMENT_TIP, STATEMENT_WORD, UNCONFIRMED_STATEMENT_WORD, walletSumsApart,
  type Bucket, type Group as LensGroup, type Lens, type Result, type StatementKey,
} from '../../../modules/book/model';
import { compose, isUnsure, knownParties, lensAsRun, lensQuery, MAX_ASK, understand, type AskCtx, type ReadingChip, type Understood, type Unsure } from '../../../modules/book/understand';
import { useLayerNav } from '../../layers';
import { fewRows, ListEngine } from '../../ListEngine';
import { DealRow } from '../../rows';
import { useEvidenceOf } from './evidence';
import { useExport } from './Ledger';
import { outsideSpan } from './model';
import { type BookWorld } from './parts';

type Phase = 'IDLE' | 'UNSURE' | 'BLOCKED' | 'DRAFTED' | 'RESULT' | 'EMPTY';
/** Where the question is; once it ran, the phase is RESULT or EMPTY by its answer. */
type Step = 'IDLE' | 'UNSURE' | 'BLOCKED' | 'DRAFTED' | 'RAN';

const GROUP_NAME: Partial<Record<Deal['kind'], string>> = BOOK.ask.kinds;

export function Ask({ b }: { b: BookWorld }) {
  const nav = useLayerNav();
  const now = useNow();
  const save = useExport(b);
  const cps = useQuery('counterparty_list', null, { refreshOn: ['deal:changed'] });
  const askCtx: AskCtx = useMemo(() => ({ now, offsetMin: -new Date(now * 1000).getTimezoneOffset(), parties: knownParties(cps.data ?? []) }), [now, cps.data]);
  const bq = useMutation('book_query');
  const [step, setStep] = useState<Step>('IDLE');
  const [asked, setAsked] = useState('');
  const [lens, setLens] = useState<Lens | null>(null);
  const [ran, setRan] = useState<{ lens: Lens; seq: number } | null>(null);
  const [answer, setAnswer] = useState<BookAnswer | null>(null);
  const [chips, setChips] = useState<ReadingChip[] | null>(null);
  const [unsure, setUnsure] = useState<Unsure | null>(null);
  const latest = useRef(0);
  const seq = useRef(0);
  const box = useRef<HTMLInputElement>(null);
  // The answer over the window's own deals; the statements of the deals behind it are read (the
  // shared per-deal entries) once it is shown, and fill its statement column as they land.
  const unknownCtx = useMemo(() => ({ stmt: () => 'unknown' as const, cpName: b.who, checking: b.checking }), [b.who, b.checking]);
  const base = useMemo(() => (ran ? runQuery(ran.lens.query, b.all, unknownCtx) : null), [ran, b.all, unknownCtx]);
  // Only the reconciliation view draws a statement, so only it reads them (the captures behind it);
  // any other question reads none, and its pivot has no statement column (evidence.ts: only what is drawn is read).
  const statements = ran?.lens.query.view === 'reconciliation';
  const ids = useMemo(() => (base && statements ? base.rows.map((d) => d.id) : []), [base, statements]);
  const ev = useEvidenceOf(ids);
  const res = useMemo(() => {
    if (!ran || !base) return null;
    const r = ev.map.size ? runQuery(ran.lens.query, b.all, { ...unknownCtx, stmt: (d) => ev.map.get(d.id)?.reconciliation ?? 'unknown' }) : base;
    return { ...r, seq: ran.seq };
  }, [ran, base, ev.map, b.all, unknownCtx]);
  const phase: Phase = res && step === 'RAN' ? (res.rows.length ? 'RESULT' : 'EMPTY') : step === 'RAN' ? 'EMPTY' : step;

  const discard = () => {
    setStep('IDLE'); setAsked(''); setLens(null); setRan(null); setAnswer(null); setChips(null); setUnsure(null); bq.reset();
    latest.current++;
    if (box.current) box.current.value = '';
  };
  const execute = (l: Lens, query: JsonValue) => {
    const mine = ++latest.current;
    seq.current += 1;
    setAnswer(null);
    void bq.run({ query }).then((a) => { if (latest.current === mine) setAnswer(a ?? null); });
    setRan({ lens: l, seq: seq.current });
    setStep('RAN');
  };
  const pickLens = (picked: Lens) => {
    const l = lensAsRun(picked, askCtx);
    setAsked(l.question); setLens(l); setRan(null); setChips(null); setUnsure(null); setStep(l.unavailable ? 'BLOCKED' : 'DRAFTED');
    if (box.current) box.current.value = l.question;
  };
  const run = () => {
    if (!lens || lens.unavailable) return;
    const l = lensAsRun(lens, askCtx);
    setLens(l);
    execute(l, l.query as unknown as JsonValue);
  };
  const answerAsked = (u: Understood, text: string) => {
    const l: Lens = { id: 'asked', short: BOOK.ask.yours, question: text, query: lensQuery(u.query) };
    setAsked(text); setLens(l); setChips(u.reading); setUnsure(null);
    execute(l, u.query as unknown as JsonValue);
  };
  const showUnsure = (u: Unsure, text: string) => {
    latest.current++;
    setAsked(text); setLens(null); setRan(null); setAnswer(null); setChips(null); setUnsure(u); setStep('UNSURE'); bq.reset();
  };
  const askText = (text: string) => { const u = understand(text, askCtx); if (isUnsure(u)) showUnsure(u, text); else answerAsked(u, text); };
  const onAsk = (e: FormEvent) => {
    e.preventDefault();
    const q = box.current?.value.trim() ?? '';
    if (!q) { box.current?.focus(); return; }
    askText(q);
  };
  const onTry = (text: string) => { if (box.current) box.current.value = text; askText(text); };
  const onChips = (next: ReadingChip[]) => { const u = compose(next, askCtx); if (isUnsure(u)) showUnsure(u, asked); else answerAsked(u, asked); };

  // Esc clears the question before it leaves the view (a layer, ahead of the console's Escape).
  useLayer(discard, 'other', phase !== 'IDLE');
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && phase === 'DRAFTED') { e.preventDefault(); runRef.current(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [phase]);
  useEffect(() => { box.current?.focus({ preventScroll: true }); }, []);

  const q = lens ? queryText(lens.query) : '';
  return (
    <div className="bk-ask">
      <form className="bk-askrow" onSubmit={onAsk} role="search" aria-label={BOOK.ask.label}>
        <Field ref={box} search autoComplete="off" aria-label={BOOK.ask.label} maxLength={MAX_ASK} placeholder={BOOK.ask.placeholder} title={BOOK.ask.title}
          onKeyDown={(e) => { if (e.key === 'Escape' && phase === 'IDLE' && e.currentTarget.value) { e.preventDefault(); e.stopPropagation(); e.currentTarget.value = ''; } }} />
        <Btn type="submit" kind="primary">{BOOK.ask.ask}</Btn>
      </form>
      <AskChips activeId={lens?.id ?? null} onPick={(id) => { const l = LENSES.find((x) => x.id === id); if (l) pickLens(l); }} />
      {phase !== 'IDLE' ? (
        <section className="bk-slip" aria-label={BOOK.ask.slip}>
          <div className="bk-sliphead">
            <SlipChip phase={phase} />
            <span className="bk-sliptext"><b>“{asked}”</b><span className="bk-dim" title={q}>{slipLine(phase, lens, res, b)}</span></span>
            <span className="cs-acts">
              {phase === 'DRAFTED' ? <Btn sm kind="primary" onClick={run} title={BOOK.ask.runKey}>{BOOK.ask.show}</Btn> : null}
              {phase === 'RESULT' && res ? <Btn sm onClick={() => save(res.rows, queryText(res.query), `book-lens-${res.seq}`)}>{BOOK.csv}</Btn> : null}
              <Btn sm kind="plain" onClick={discard} title={BOOK.ask.clearKey}>{phase === 'DRAFTED' || phase === 'BLOCKED' ? BOOK.ask.discard : BOOK.ask.clear}</Btn>
            </span>
          </div>
          {phase === 'UNSURE' && unsure ? <UnsureLine unsure={unsure} onTry={onTry} /> : null}
          {(phase === 'RESULT' || phase === 'EMPTY') && chips ? <ReadingChips reading={chips} ctx={askCtx} onChange={onChips} /> : null}
          {phase === 'BLOCKED' && lens?.unavailable ? <WalletNotice error={new WalletError({ code: 'UNAVAILABLE', message: lens.unavailable })} what={lens.short} /> : null}
          {lens && phase !== 'UNSURE' ? (
            <details className="ui-disclosure bk-asks"><summary>{phase === 'DRAFTED' || phase === 'BLOCKED' ? BOOK.ask.whatAsks : BOOK.ask.howAsked}</summary>
              <div className="ui-disclosure-body"><ReadBody lens={lens} rows={b.all.length} /></div>
            </details>
          ) : null}
          {phase === 'RESULT' && res ? <Pivot res={res} statements={statements} read={!ev.loading} /> : null}
          {(phase === 'RESULT' || phase === 'EMPTY') && bq.pending ? <Loading what={BOOK.ask.walletAnswering} /> : null}
          {(phase === 'RESULT' || phase === 'EMPTY') && bq.error ? <WalletNotice error={bq.error} what={BOOK.ask.walletWhat} /> : null}
          {(phase === 'RESULT' || phase === 'EMPTY') && answer ? <WalletAnswer answer={answer} cpName={b.whoKey} /> : null}
          {phase === 'RESULT' && res ? (
            <div className="bk-behind">
              <h2 className="bk-h">{BOOK.ask.behind(res.rows.length)}</h2>
              <ListEngine<Deal> className={fewRows(res.rows.length)} label={BOOK.ask.behindLabel} rows={res.rows} getKey={(d) => d.id} estimateSize={56} measure
                searchText={(d) => `${b.title(d)} ${b.who(d)}`}
                renderRow={(d) => <DealRow deal={d} need={b.needOf.get(d.id)} who={b.who(d)} />}
                rowLabel={(d) => b.title(d)} onOpen={(d) => nav.deal(d.id)} empty={BOOK.ask.none} />
            </div>
          ) : null}
        </section>
      ) : <p className="ui-hint">{BOOK.ask.readOnly}</p>}
    </div>
  );
}

function SlipChip({ phase }: { phase: Phase }) {
  if (phase === 'UNSURE') return <Chip tone="dashed">{BOOK.ask.chip.unsure}</Chip>;
  if (phase === 'BLOCKED') return <Chip tone="dashed">{BOOK.ask.chip.blocked}</Chip>;
  if (phase === 'DRAFTED') return <Chip tone="teal">{BOOK.ask.chip.ready}</Chip>;
  return <Chip tone={phase === 'RESULT' ? 'ok' : undefined}>{phase === 'RESULT' ? BOOK.ask.chip.answer : BOOK.ask.chip.none}</Chip>;
}

function slipLine(phase: Phase, lens: Lens | null, res: Result | null, b: BookWorld): ReactNode {
  if (phase === 'UNSURE') return BOOK.ask.line.unsure;
  if (phase === 'BLOCKED') return lens?.unavailable ?? BOOK.ask.line.blocked;
  if (phase === 'DRAFTED') return BOOK.ask.line.drafted;
  if (!res) return null;
  // An answer reaches the whole ledger, not the week list the summary shows: say so.
  const older = outsideSpan(res.rows, b.week);
  const reach = !older ? null : res.rows.length === b.all.length ? BOOK.ask.line.everything : BOOK.ask.line.older(older);
  return reach ? `${BOOK.ask.line.result(res.rows.length)} · ${reach}` : BOOK.ask.line.result(res.rows.length);
}

/** A query line in the owner's words: a status the wallet names in capitals is said as its label. */
const plainLine = (k: string, v: string): string => (k === 'filter' ? v.replace(/\b[A-Z][A-Z_]{2,}\b/g, (st) => serverStateLabel(st)) : v);

function ReadBody({ lens, rows }: { lens: Lens; rows: number }) {
  return (
    <div className="bk-l2">
      <p className="bk-q">{lens.question}</p>
      <Kv items={readQuery(lens.query).map(([k, v]) => [BOOK.ask.queryKey[k as keyof typeof BOOK.ask.queryKey] ?? k, plainLine(k, v)] as const)} />
      {lens.unavailable ? <WalletNotice error={new WalletError({ code: 'UNAVAILABLE', message: lens.unavailable })} what={BOOK.ask.thisView} /> : null}
      <p className="ui-hint">{BOOK.ask.onlyReads(rows)}</p>
    </div>
  );
}

function SumCell({ out, inn, bucket }: { out: { minor: number; currency: Currency }[]; inn: { minor: number; currency: Currency }[]; bucket: Bucket }) {
  const parts = [...out.map((m) => <span key={`o${m.currency}`} className={`bk-${bucket}`}>{formatMinor(m.minor, m.currency)}</span>),
    ...inn.map((m) => <span key={`i${m.currency}`}><span className={`bk-${bucket}`}>{formatMinor(m.minor, m.currency)}</span><span className="bk-dim"> {BOOK.in}</span></span>)];
  if (!parts.length) return <span className="bk-dim">{BOOK.dash}</span>;
  return <>{parts.flatMap((p, i) => (i ? [<span key={`s${i}`} className="bk-dim"> · </span>, p] : [p]))}</>;
}

function StmtSummary({ c, read }: { c: Record<StatementKey, number>; read: boolean }) {
  // A statement still being read is a quiet dash, never "unknown" (which says it could not be read).
  const xs = (['matched', 'pending_reporting', 'unconfirmed', 'mismatch', 'unknown'] as const).filter((s) => c[s] && (read || s !== 'unknown'));
  if (!xs.length) return <span className="bk-dim">{BOOK.dash}</span>;
  return <>{xs.map((s) => (s === 'unconfirmed'
    ? <Chip key={s} tone="dashed">{c[s]} {UNCONFIRMED_STATEMENT_WORD}</Chip>
    : <Chip key={s} tone={s === 'matched' ? 'ok' : s === 'mismatch' ? 'red' : s === 'unknown' ? 'dashed' : 'gold'} title={STATEMENT_TIP[s]}>{c[s]} {STATEMENT_WORD[s]}</Chip>))}</>;
}

/** The answer as numbers only: one line per group, each money state its own column. */
function Pivot({ res, statements, read }: { res: Result; statements: boolean; read: boolean }) {
  const m = res.query.metrics;
  const gb = res.query.group_by ?? [];
  const groups: Array<LensGroup | (Result['all'] & { key: string; label: string })> = res.groups.length ? res.groups : [{ key: 'all', label: BOOK.ask.allRows, ...res.all }];
  return (
    <div className="bk-tablewrap">
      <table className="ui-table bk-pivot">
        <thead><tr>
          <th>{gb.length ? gb.map((g) => BOOK.ask.groupHead[g] ?? g).join(' · ') : BOOK.ask.inView}</th>
          {m.includes('count') ? <th className="num">{BOOK.ask.deals}</th> : null}
          {m.includes('sum_amount') ? BUCKETS.map((bk) => <th key={bk} className="num">{BUCKET_LABEL[bk]}</th>) : null}
          {m.includes('avg_vs_market_pct') ? <th className="num">{BOOK.ask.vsMarket}</th> : null}
          {m.includes('recovered_sum') ? <th className="num">{BOOK.ask.recovered}</th> : null}
          {statements ? <th>{BOOK.ask.statement}</th> : null}
        </tr></thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td>{g.label}</td>
              {m.includes('count') ? <td className="num">{g.count}</td> : null}
              {m.includes('sum_amount') ? BUCKETS.map((bk) => <td key={bk} className="num"><SumCell out={g.sums[bk].out} inn={g.sums[bk].in} bucket={bk} /></td>) : null}
              {m.includes('avg_vs_market_pct') ? <td className="num">{g.pct ? <>{g.pct.avg > 0 ? '+' : ''}{g.pct.avg}% <span className="bk-dim">{BOOK.ask.ofN(g.pct.n)}</span></> : <span className="bk-dim">{BOOK.ask.noMarket}</span>}</td> : null}
              {m.includes('recovered_sum') ? <td className="num">{g.recovered.length ? g.recovered.map((x) => formatMinor(x.minor, x.currency)).join(' · ') : <span className="bk-dim">{BOOK.ask.noneWord}</span>}</td> : null}
              {statements ? <td><StmtSummary c={g.stmt} read={read} /></td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The wallet's own answer (book_query): one line per currency, mode and direction, exact minor
 *  units, read on a read-only connection. Its amount adds every state the query reaches, so the
 *  column shows only when each line holds one money state (walletSumsApart). */
export function WalletAnswer({ answer, cpName }: { answer: BookAnswer; cpName: (key: string) => string }) {
  const groups = answer.query.group_by;
  const m = answer.query.metrics;
  const showAmount = m.includes('sum_amount') && walletSumsApart(answer.query);
  const amountLeftOut = m.includes('sum_amount') && !showAmount;
  const cell = (row: Record<string, JsonValue>, k: string) => row[k] ?? null;
  const money = (row: Record<string, JsonValue>, k: string) => {
    const v = cell(row, k);
    if (typeof v !== 'number') return <span className="bk-dim">{BOOK.dash}</span>;
    const text = formatMinor(v, row.currency as Currency);
    return cell(row, 'direction') === 'out' ? text : <>{text}<span className="bk-dim"> {BOOK.in}</span></>;
  };
  const groupText = (g: string, v: JsonValue): string => {
    if (g === 'decided_by' && typeof v === 'string') { try { return decidedBy({ decided_by: JSON.parse(v) as Deal['decided_by'] }).text; } catch { return BOOK.dash; } }
    if (v === null) return BOOK.dash;
    if (typeof v !== 'string') return String(v);
    if (g === 'counterparty') return cpName(v);
    if (g === 'state') return serverStateLabel(v);
    if (g === 'kind') return GROUP_NAME[v as Deal['kind']] ?? BOOK.dash;
    if (g === 'day') return dayLabel(v);
    return v;
  };
  return (
    <div className="bk-wallet">
      <p className="ui-hint">{BOOK.ask.walletLine(answer.rows.length)}</p>
      {answer.truncated ? <p className="ui-hint">{BOOK.ask.cutLine(answer.rows.length)}</p> : null}
      {amountLeftOut ? <p className="ui-hint">{BOOK.ask.amountLeftOut}</p> : null}
      {answer.rows.length ? (
        <div className="bk-tablewrap">
          <table className="ui-table bk-pivot">
            <thead><tr>
              <th>{BOOK.ask.currency}</th><th>{BOOK.ask.mode}</th><th>{BOOK.ask.money}</th>{groups.map((g) => <th key={g}>{BOOK.ask.groupHead[g] ?? BOOK.dash}</th>)}
              {m.includes('count') ? <th className="num">{BOOK.ask.rows}</th> : null}
              {showAmount ? <th className="num">{BOOK.ask.amount}</th> : null}
              {m.includes('avg_vs_market_pct') ? <th className="num">{BOOK.ask.vsMarket}</th> : null}
              {m.includes('recovered_sum') ? <th className="num">{BOOK.ask.recovered}</th> : null}
            </tr></thead>
            <tbody>
              {answer.rows.map((raw, i) => {
                const row = (raw ?? {}) as Record<string, JsonValue>;
                const mode = cell(row, 'mode');
                return (
                  <tr key={i}>
                    <td className="mono">{String(cell(row, 'currency'))}</td>
                    <td>{mode === 'sandbox' || mode === 'replay' || mode === 'scripted_engine' ? modeWord(mode) : BOOK.dash}</td>
                    <td>{cell(row, 'direction') === 'out' ? BOOK.out : <span className="bk-dim">{BOOK.in}</span>}</td>
                    {groups.map((g) => <td key={g}>{groupText(g, cell(row, g))}</td>)}
                    {m.includes('count') ? <td className="num">{String(cell(row, 'count'))}</td> : null}
                    {showAmount ? <td className="num">{money(row, 'sum_amount')}</td> : null}
                    {m.includes('avg_vs_market_pct') ? <td className="num">{typeof cell(row, 'avg_vs_market_bp') === 'number' ? `${(cell(row, 'avg_vs_market_bp') as number) / 100}%` : <span className="bk-dim">{BOOK.ask.noMarket}</span>}</td> : null}
                    {m.includes('recovered_sum') ? <td className="num">{money(row, 'recovered_sum')}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <p className="ui-hint">{BOOK.ask.noRows}</p>}
    </div>
  );
}
