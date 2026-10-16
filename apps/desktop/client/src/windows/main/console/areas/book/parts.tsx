// Small parts of the Book layer (rebuild WP3b): the shared reading of the World (which deals, which
// are being checked with PayPal, who, what), the status and statement chips, the totals strip and a
// ledger row's detail (its PayPal proof). Display only: nothing here moves money.
import { useMemo, type ReactNode } from 'react';
import type { AttentionItem } from '@bindings/AttentionItem';
import type { Deal } from '@bindings/Deal';
import type { DealEvidence } from '@bindings/DealEvidence';
import type { FairPrice } from '@bindings/FairPrice';
import type { MoneyCheck } from '@bindings/MoneyCheck';
import type { Money } from '@bindings/Money';
import { clockLabel, formatMinor } from '../../../../../lib/format';
import { useNow } from '../../../../../lib/hooks';
import {
  BOOK, FAIR_PRICE_NAME, fairPriceWords, IF_NOTHING, marketWords, moneyCheckNow, moneyCheckPill, receiptWord, stateWord,
} from '../../../../../lib/words';
import { ModeBadge, WalletNotice } from '../../../../../shared/honesty';
import { Btn, Chip, Kv, Loading, Why, type ChipTone } from '../../../../../shared/ui';
import { chipClass, dealTotal, decidedBy, isTerminal, marketPosition, moneyNow, type ChipClass } from '../../../logic';
import { BUCKET_SUB, bucketOf, dirOf, kindLabel, STATEMENT_TIP, statementEnded, statementWords, type Bucket, type Statement } from '../../../modules/book/model';
import { totalWhy, type TotalKey } from '../../../modules/book/where';
import { useCpLookup } from '../../../ui';
import { useDeals, useNeeds, useWorldSelector, type World } from '../../../world';
import { Amount, Countdown } from '../../rows';
import { dealsIn, figures, weekSpan, type Figures, type Span } from './model';
import { useDealEvidence } from './evidence';

const NO_DEALS: readonly Deal[] = [];
const selDisplay = (w: World) => w.display;

export type BookWorld = {
  all: readonly Deal[];
  week: Span;
  weekDeals: Deal[];
  needOf: ReadonlyMap<string, AttentionItem>;
  /** A payment whose PayPal answer was lost: not a hold, and not paid (DECISIONS 31-36). */
  checking: (d: Deal) => boolean;
  who: (d: Deal) => string;
  /** A counterparty's name by its key (the wallet's answer groups by key). */
  whoKey: (key: string) => string;
  title: (d: Deal) => string;
  label: (d: Deal) => string;
  error: ReturnType<typeof useDeals>['error'];
  loaded: boolean;
};

/** The Book's one reading of the World: narrow selectors only. */
export function useBookWorld(): BookWorld {
  const q = useDeals();
  const all = q.data ?? NO_DEALS;
  const needs = useNeeds();
  const now = useNow();
  const cp = useCpLookup();
  const display = useWorldSelector(selDisplay);
  // The week only changes at midnight on Monday: memoise on its start, not on the ticking clock.
  const weekStart = weekSpan(now).start;
  const week = useMemo(() => weekSpan(weekStart), [weekStart]);
  const weekDeals = useMemo(() => dealsIn(all, week), [all, week]);
  const needOf = useMemo(() => new Map(needs.map((n) => [n.deal_id, n] as const)), [needs]);
  const error = q.error;
  const loaded = !!q.data;
  return useMemo(() => ({
    all, week, weekDeals, needOf, error, loaded,
    checking: (d: Deal) => !!needOf.get(d.id)?.money_check,
    who: (d: Deal) => cp(d.counterparty).name,
    whoKey: (key: string) => cp(key).name,
    title: (d: Deal) => display(d).title,
    label: (d: Deal) => display(d).label,
  }), [all, week, weekDeals, needOf, cp, display, error, loaded]);
}

/** "$295.00 · €12.00": each currency on its own, never added together. Empty when there is none. */
export const moneyList = (ms: readonly Money[]): string => ms.map((m) => formatMinor(m.minor, m.currency)).join(' · ');

/** The figures of a set of deals, memoised on the set. */
export function useFigures(deals: readonly Deal[], checking: (d: Deal) => boolean): Figures {
  return useMemo(() => figures(deals, checking), [deals, checking]);
}

const TONE: Record<ChipClass, ChipTone | undefined> = { live: 'teal', wait: 'gold', held: 'coral', done: 'ok', bad: 'red', off: undefined };
const STMT_TONE: Record<Statement, ChipTone | undefined> = { matched: 'ok', pending_reporting: 'gold', mismatch: 'red', not_applicable: undefined, unknown: 'dashed' };

/** The deal's status chip; a payment whose PayPal answer was lost reads "Checking with PayPal",
 *  dashed like every unknown, never paid and never failed (moneyCheckPill). */
export function StatusChip({ deal, check }: { deal: Deal; check: MoneyCheck | null | undefined }) {
  if (check) {
    const pill = moneyCheckPill(check, isTerminal(deal));
    return <Chip tone="dashed" title={pill.means}>{pill.text}</Chip>;
  }
  const wd = stateWord(deal.state, { side: deal.side, kind: deal.kind });
  return <Chip tone={TONE[chipClass(deal)]} title={wd.means}>{wd.text}</Chip>;
}

/** The deal's PayPal statement chip. `null` = still being read (a quiet dash, never a figure). */
export function StmtChip({ s, state, read }: { s: Statement | null; state: Deal['state']; read?: boolean | null }) {
  if (s === null) return <span className="bk-dim" title={BOOK.stmtReading}>{BOOK.dash}</span>;
  if (s === 'not_applicable') return <span className="bk-dim" title={STATEMENT_TIP[s]}>{BOOK.dash}</span>;
  const words = statementWords(s, state, read ?? null);
  if (statementEnded(s, state)) return <Chip tone="dashed" title={words.tip}>{words.word}</Chip>;
  return <Chip tone={STMT_TONE[s]} className={s === 'pending_reporting' ? 'dashed' : undefined} title={words.tip}>{words.word}</Chip>;
}

/** A visible row's statement chip: its own evidence, read only while the row is drawn. */
export function RowStatement({ deal }: { deal: Deal }) {
  const ev = useDealEvidence(deal.id);
  if (ev.error && !ev.data) return <span className="bk-dim" title={BOOK.stmtUnread}>{BOOK.dash}</span>;
  return <StmtChip s={ev.data ? ev.data.reconciliation : null} state={deal.state} />;
}

// ---- the totals strip ---------------------------------------------------------------------------

type Tile = { k: TotalKey; label: string; bucket: Bucket; money: Array<{ m: Money; dir: 'out' | 'in' }>; n: number; note: string };

/** Paid out, paid in, on hold, stopped: each its own figure, each currency its own line; a hold is
 *  never added to what was paid, and a payment being checked with PayPal is in none of them. */
export function Totals({ deals, checking }: { deals: readonly Deal[]; checking: (d: Deal) => boolean }) {
  const f = useFigures(deals, checking);
  const counted = useMemo(() => deals.filter((d) => !checking(d)), [deals, checking]);
  const tiles: Tile[] = [
    { k: 'out', label: BOOK.tiles.out, bucket: 'captured', money: f.paidOut.map((m) => ({ m, dir: 'out' })), n: f.nOut, note: BOOK.tiles.outNote },
    { k: 'in', label: BOOK.tiles.in, bucket: 'captured', money: f.paidIn.map((m) => ({ m, dir: 'in' })), n: f.nIn, note: BOOK.tiles.inNote },
    { k: 'held', label: BOOK.tiles.held, bucket: 'held', money: [...f.heldOut.map((m) => ({ m, dir: 'out' as const })), ...f.heldIn.map((m) => ({ m, dir: 'in' as const }))], n: f.nHeld, note: BOOK.tiles.heldNote },
    { k: 'stopped', label: BOOK.tiles.stopped, bucket: 'stopped', money: [...f.stoppedOut.map((m) => ({ m, dir: 'out' as const })), ...f.stoppedIn.map((m) => ({ m, dir: 'in' as const }))], n: f.nStopped, note: BOOK.tiles.stoppedNote },
  ];
  return (
    <div className="bk-totals" role="group" aria-label={BOOK.tiles.label}>
      {tiles.map((t) => {
        const both = t.money.some((x) => x.dir === 'out') && t.money.some((x) => x.dir === 'in');
        const [one, two] = totalWhy(t.k, counted);
        return (
          <div key={t.k} className={`bk-tile tl-${t.bucket}`} title={BUCKET_SUB[t.bucket]}>
            <div className="tk"><span>{t.label}</span><Why question={BOOK.tiles.why(t.label)} className="tw"><p>{one}</p><p>{two}</p></Why></div>
            <div className="tv">
              {t.money.length ? t.money.map((x) => (
                <span key={`${x.dir}${x.m.currency}`} className="fig">
                  <Amount money={x.m} tone={t.bucket === 'captured' ? 'moved' : t.bucket === 'held' ? 'held' : 'struck'} />
                  {both ? <small>{x.dir === 'out' ? BOOK.goingOut : BOOK.comingIn}</small> : null}
                </span>
              )) : <span className="fig none">{BOOK.dash}</span>}
            </div>
            <div className="tn">{BOOK.payments(t.n)} · {t.note}</div>
          </div>
        );
      })}
      {f.checking ? <p className="bk-checking">{BOOK.checkingLine(f.checking)}</p> : null}
    </div>
  );
}

// ---- a ledger row's detail ----------------------------------------------------------------------

function marketText(d: Deal, fair: FairPrice | null): { text: string; tip: string } | null {
  const m = d.market;
  const u = d.terms.unit_price;
  if (fair && (fair.state === 'broken' || (fair.state === 'rechecked' && fair.percentile !== null))) {
    const fp = fairPriceWords(fair, u);
    return { text: fp.short, tip: fp.means };
  }
  if (!m || m.median.currency !== u.currency) return null;
  return { text: marketWords(u.minor, m.p25.minor, m.median.minor, m.p75.minor).text, tip: `${marketPosition(u.minor, m.p25.minor, m.median.minor, m.p75.minor)} ${BOOK.ofMarket}` };
}

/** The deal price against the band on file, drawn to scale. */
function MarketBand({ deal }: { deal: Deal }) {
  const m = deal.market;
  const u = deal.terms.unit_price;
  if (!m || m.median.currency !== u.currency) return <span className="bk-dim">{BOOK.noMarket}</span>;
  const W = 150;
  const lo = Math.min(m.p25.minor, u.minor) * 0.97;
  const hi = Math.max(m.p75.minor, u.minor) * 1.03;
  const x = (v: number) => 4 + ((v - lo) / (hi - lo || 1)) * (W - 8);
  return (
    <span className="bk-mk" title={BOOK.marketTip(marketPosition(u.minor, m.p25.minor, m.median.minor, m.p75.minor), formatMinor(m.p25.minor, m.p25.currency), formatMinor(m.p75.minor, m.p75.currency), formatMinor(m.median.minor, m.median.currency))}>
      <svg width={W} height={18} viewBox={`0 0 ${W} 18`} aria-hidden="true">
        <line x1={2} x2={W - 2} y1={9} y2={9} className="mk-axis" />
        <rect x={x(m.p25.minor)} y={4} width={Math.max(1, x(m.p75.minor) - x(m.p25.minor))} height={10} rx={2} className="mk-band" />
        <line x1={x(m.median.minor)} x2={x(m.median.minor)} y1={2} y2={16} className="mk-med" />
        <circle cx={x(u.minor)} cy={9} r={4} className={`mk-dot mk-${bucketOf(deal)}`} />
      </svg>
      <span>{marketWords(u.minor, m.p25.minor, m.median.minor, m.p75.minor).text}</span>
      <span className="bk-dim">{BOOK.checkedAt(clockLabel(m.retrieved_at))}</span>
    </span>
  );
}

/** One deal's money and PayPal proof, beside the ledger on a wide window (its evidence is the
 *  shared per-deal entry: opening the deal reads nothing again). Their notes never show here. */
export function RowDetail({ deal, need, who, title, onOpen }: { deal: Deal; need: AttentionItem | undefined; who: string; title: string; onOpen: () => void }) {
  const ev = useDealEvidence(deal.id);
  const evidence: DealEvidence | undefined = ev.data;
  const t = dealTotal(deal);
  const b = bucketOf(deal);
  const s: Statement | null = evidence ? evidence.reconciliation : null;
  const sw = s ? statementWords(s, deal.state, evidence?.statement_unmatched ?? null) : null;
  const check = evidence?.money_check ?? need?.money_check;
  const mkt = marketText(deal, evidence?.fair_price ?? null);
  const by = decidedBy(deal);
  return (
    <div className="bk-detail">
      <h2 className="bk-dtitle" title={title}>{title}</h2>
      <div className="bk-chips">
        <StatusChip deal={deal} check={check} />
        <StmtChip s={s} state={deal.state} read={evidence?.statement_unmatched} />
        <ModeBadge mode={deal.mode} />
      </div>
      <Kv items={[
        [BOOK.k.with, <span className="bk-who" title={who}>{who}</span>],
        [BOOK.k.what, BOOK.what(kindLabel(deal.kind), deal.side === 'seller', deal.terms.qty, deal.terms.item_ref)],
        [BOOK.k.money, <><Amount money={t} tone={b === 'captured' ? 'moved' : b === 'held' ? 'held' : b === 'stopped' ? 'struck' : 'proposed'} /> {dirOf(deal) === 'in' ? BOOK.comingIn : BOOK.goingOut} · {check ? moneyCheckNow(isTerminal(deal)) : moneyNow(deal)}</>],
        [BOOK.k.when, deal.created_at ? BOOK.when(clockLabel(deal.created_at), deal.updated_at ? clockLabel(deal.updated_at) : null) : BOOK.noTime],
        need?.deadline ? [BOOK.k.deadline, <Countdown deadline={need.deadline} />] : null,
        need ? [IF_NOTHING, need.on_silence] : null,
        [BOOK.k.decided, <span className={by.who === 'none' ? 'bk-dim' : undefined} title={by.why}>{by.text}</span>],
        [BOOK.k.receipt, evidence ? <span title={receiptWord(evidence.receipt).means}>{receiptWord(evidence.receipt).text}</span> : <span className="bk-dim">{BOOK.dash}</span>],
        [BOOK.k.statement, sw ? <>{sw.word} <span className="bk-dim">· {sw.tip}</span></> : <span className="bk-dim">{BOOK.dash}</span>],
        [BOOK.k.market, <MarketBand deal={deal} />],
        evidence?.fair_price ? [FAIR_PRICE_NAME, <span title={fairPriceWords(evidence.fair_price, deal.terms.unit_price).means}>{fairPriceWords(evidence.fair_price, deal.terms.unit_price).text}</span>] : mkt ? [BOOK.k.vsMarket, <span title={mkt.tip}>{mkt.text}</span>] : null,
        [BOOK.k.rules, BOOK.rulesVersion(deal.mandate_version)],
      ]} />
      {ev.error && !evidence ? <WalletNotice error={ev.error} what={BOOK.proofWhat} /> : null}
      {!evidence && !ev.error ? <Loading what={BOOK.proofLoading} /> : null}
      <p className="ui-hint">{BOOK.notesNever}</p>
      <div className="cs-acts"><Btn onClick={onOpen} data-fk="open-deal">{BOOK.openDeal}</Btn></div>
    </div>
  );
}

/** One line of money per currency, or the dash. */
export function MoneyText({ ms, children }: { ms: readonly Money[]; children?: ReactNode }) {
  if (!ms.length) return <span className="bk-dim">{BOOK.dash}</span>;
  return <>{ms.map((m, i) => <span key={m.currency}>{i ? ' · ' : null}<Amount money={m} /></span>)}{children}</>;
}

/** A list this short is drawn at its own height (no long empty band under a few rows). */
export const FEW_ROWS = 6;
export const fewRows = (n: number): string | undefined => (n <= FEW_ROWS ? 'few' : undefined);
